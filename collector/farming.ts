// Données agricoles des îles : items.json (farmableitem), loot.json (récoltes, produits),
// farmingmodifiers.json (bonus de rendement par ville) → FarmingData (champ `farming` de recipes.json).
import type { FarmAnimal, FarmCrop, FarmingData, FarmOtherAnimal, Location } from '../src/types';

type Raw = Record<string, any>;

export const FARM_CLUSTER_TO_LOCATION: Record<string, Location> = {
  '0000': 'Thetford',
  '1000': 'Lymhurst',
  '2000': 'Bridgewatch',
  '3004': 'Martlock',
  '4000': 'Fort Sterling',
  '3003': 'Caerleon',
  '5000': 'Brecilien',
};

/** Animaux de ferme classés (famille → ordre). Les montures (cheval, bœuf, cerf…) sont seulement collectées. */
export const FARM_ANIMAL_FAMILIES = ['chicken', 'goat', 'goose', 'sheep', 'pig', 'cow'] as const;

const arr = <T>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const num = (v: unknown, def = 0): number => {
  const n = Number(v);
  return v === undefined || v === null || v === '' || !Number.isFinite(n) ? def : n;
};

interface LootEntry {
  id: string;
  chance: number;
  avg: number;
}

/** Index des listes de butin : nom → entrées (ID, chance, quantité moyenne). */
export function indexLoot(lootJson: any): Map<string, LootEntry[]> {
  const out = new Map<string, LootEntry[]>();
  for (const l of arr(lootJson?.LootDefinition?.Lootlist as Raw | Raw[])) {
    const name = l?.['@name'];
    if (!name) continue;
    const entries: LootEntry[] = [];
    for (const it of arr(l.Item as Raw | Raw[])) {
      const amount = String(it?.['@amount'] ?? '1');
      const [lo, hi] = amount.includes('-') ? amount.split('-').map(Number) : [Number(amount), Number(amount)];
      if (!it?.['@type']) continue;
      const avg = (lo + hi) / 2;
      // Quantité illisible (« ? », « 3- ») → entrée ignorée plutôt qu'un NaN propagé dans les rendements.
      if (!Number.isFinite(avg) || avg < 0) continue;
      entries.push({ id: String(it['@type']), chance: num(it['@chance'], 1), avg });
    }
    out.set(String(name), entries);
  }
  return out;
}

/**
 * Construit FarmingData. `simple` : simpleitem par uniquename (récoltes, viandes), `farm` : farmableitem.
 * Retourne null si items.json ne contient aucun farmableitem (fichiers de test minimaux).
 */
export function buildFarming(
  root: Raw,
  lootJson: any,
  farmingModifiersJson: any,
): FarmingData | null {
  const farm = new Map<string, Raw>();
  for (const it of arr(root?.farmableitem as Raw | Raw[])) if (it?.['@uniquename']) farm.set(it['@uniquename'], it);
  if (farm.size === 0) return null;
  const simple = new Map<string, Raw>();
  for (const it of arr(root?.simpleitem as Raw | Raw[])) if (it?.['@uniquename']) simple.set(it['@uniquename'], it);
  const loot = indexLoot(lootJson);

  const foodNutrition: Record<string, number> = {};
  const crops: FarmCrop[] = [];
  for (const [seedId, x] of farm) {
    if (x['@kind'] !== 'plant' || !x.harvest) continue;
    const sub = String(x['@shopsubcategory1'] ?? '');
    if (sub !== 'farm' && sub !== 'herbgarden') continue;
    const entries = loot.get(String(x.harvest['@lootlist'])) ?? [];
    const main = entries[0];
    if (!main) continue;
    const worm = entries.find((e) => e.id.includes('WORM'));
    const nutrition = num(simple.get(main.id)?.['@nutrition'], 48);
    foodNutrition[main.id] = nutrition;
    const silver = x.craftingrequirements?.['@silver'];
    crops.push({
      kind: sub === 'farm' ? 'crop' : 'herb',
      seedId,
      cropId: main.id,
      tier: num(x['@tier']),
      growSeconds: num(x.harvest['@growtime']),
      harvestAvg: main.avg * main.chance,
      wormChance: worm ? worm.chance * worm.avg : 0,
      wormId: worm?.id ?? 'T1_WORM',
      seedChance: num(x.harvest.seed?.['@chance']),
      focusBonus: num(x['@activefarmbonus']),
      focusCost: num(x['@activefarmfocuscost']),
      npcSeedPrice: silver !== undefined && num(silver) > 0 ? num(silver) : null,
      nutrition,
    });
  }
  crops.sort((a, b) => (a.kind === b.kind ? a.tier - b.tier : a.kind === 'crop' ? -1 : 1));

  // Viande : simpleitem dont la recette consomme 1 animal adulte.
  const meatOf = new Map<string, { id: string; amount: number }>();
  for (const [id, m] of simple) {
    const cr = m.craftingrequirements;
    if (!cr || Array.isArray(cr)) continue;
    const res = arr(cr.craftresource as Raw | Raw[]);
    if (res.length === 1 && farm.has(String(res[0]['@uniquename']))) {
      meatOf.set(String(res[0]['@uniquename']), { id, amount: num(cr['@amountcrafted'], 1) });
    }
  }

  const animals: FarmAnimal[] = [];
  const otherAnimals: FarmOtherAnimal[] = [];
  for (const [babyId, x] of farm) {
    if (x['@kind'] !== 'animal' || !x.grownitem || x['@shopsubcategory1'] !== 'pasture') continue;
    const grownId = String(x.grownitem['@uniquename']);
    const family = String(x['@shopsubcategory3'] ?? '');
    const tier = num(x['@tier']);
    if (!(FARM_ANIMAL_FAMILIES as readonly string[]).includes(family)) {
      otherAnimals.push({ babyId, grownId, tier });
      continue;
    }
    const food = x.consumption?.food ?? {};
    const accepted = arr(food.acceptedfood as Raw | Raw[])[0] ?? {};
    const grown = farm.get(grownId) ?? {};
    const grownFood = grown.consumption?.food ?? {};
    const product = grown.products?.product;
    const productLoot = product ? (loot.get(String(product['@lootlist'])) ?? [])[0] : undefined;
    const meat = meatOf.get(grownId);
    const silver = x.craftingrequirements?.['@silver'];
    const nutritionMaxAdult = num(grownFood['@nutritionmax'], 864);
    const secPerNut = num(grownFood['@secondspernutrition'], 0);
    animals.push({
      babyId,
      grownId,
      tier,
      growSeconds: num(x.grownitem['@growtime']),
      offspringChance: num(x.grownitem.offspring?.['@chance']),
      focusBonus: num(x['@activefarmbonus']),
      focusCost: num(x['@activefarmfocuscost']),
      npcBabyPrice: silver !== undefined && num(silver) > 0 ? num(silver) : null,
      nutritionMax: num(food['@nutritionmax'], 864),
      favoriteFood: accepted['@favorite'] ? String(accepted['@favorite']) : null,
      favoriteBonus: num(accepted['@favoritebonus'], 0),
      productId: productLoot ? productLoot.id : null,
      productAvg: productLoot ? productLoot.avg * productLoot.chance : null,
      productionSeconds: product ? num(product['@productiontime']) : null,
      // 864 nutrition × 91,67 s/nutrition ≈ 79 200 s = 22 h (arrondi à l'heure) → 864 × 24 / 22 par jour.
      adultConsumptionPerDay: (nutritionMaxAdult * 86400) / adultCycleSeconds(nutritionMaxAdult, secPerNut),
      meatId: meat?.id ?? null,
      meatPerAdult: meat?.amount ?? 0,
    });
  }
  animals.sort((a, b) => a.tier - b.tier);
  otherAnimals.sort((a, b) => (a.babyId < b.babyId ? -1 : 1));

  const cityBonuses: FarmingData['cityBonuses'] = {};
  for (const loc of arr(farmingModifiersJson?.farmingmodifiers?.location as Raw | Raw[])) {
    const place = FARM_CLUSTER_TO_LOCATION[String(loc?.['@clusterid'])];
    if (!place) continue;
    const mods: Record<string, number> = {};
    for (const m of arr(loc.farmingyieldmodifier as Raw | Raw[])) {
      if (!m?.['@farmable']) continue;
      // Les fermes sont sur les îles : @islandvalue prioritaire, sinon @value.
      mods[String(m['@farmable'])] = num(m['@islandvalue'] ?? m['@value']);
    }
    cityBonuses[place] = mods;
  }

  return { crops, animals, otherAnimals, cityBonuses, foodNutrition };
}

/** Durée de la jauge de nourriture adulte, arrondie à l'heure (864 × 91,67 s → 22 h) ; 22 h par défaut. */
function adultCycleSeconds(nutritionMax: number, secondsPerNutrition: number): number {
  const s = Math.round((nutritionMax * secondsPerNutrition) / 3600) * 3600;
  return s > 0 ? s : 79200;
}

/** Tous les ID agricoles (graines, récoltes, ver, petits, adultes, produits, viandes, montures). */
export function farmingIds(f: FarmingData | null | undefined): string[] {
  const ids = new Set<string>();
  if (!f) return [];
  for (const c of f.crops) {
    ids.add(c.seedId);
    ids.add(c.cropId);
    if (c.wormChance > 0) ids.add(c.wormId);
  }
  for (const a of f.animals) {
    ids.add(a.babyId);
    ids.add(a.grownId);
    if (a.productId) ids.add(a.productId);
    if (a.meatId) ids.add(a.meatId);
    if (a.favoriteFood) ids.add(a.favoriteFood);
  }
  for (const a of f.otherAnimals ?? []) {
    ids.add(a.babyId);
    ids.add(a.grownId);
  }
  return [...ids].sort();
}
