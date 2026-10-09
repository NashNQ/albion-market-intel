// Collecteur de recettes : ao-bin-dumps (items.json, formatted/items.json, craftingmodifiers.json)
// → out/recipes.json (type RecipesFile), JSON compact.
//
// Usage : pnpm tsx collector/recipes.ts [--local <dossier>] [--out <fichier>]
import { mkdir, readFile, writeFile, stat, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BonusTable, ItemMeta, Location, Recipe, RecipeInput, RecipesFile } from '../src/types';
import { parseApiId, recipeKey, refiningFamily, toApiId } from '../src/engine/ids';
import { buildFarming, farmingIds } from './farming';

const BASE_URL = 'https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master';

const CLUSTER_TO_LOCATION: Record<string, Location> = {
  '0000': 'Thetford',
  '1000': 'Lymhurst',
  '2000': 'Bridgewatch',
  '3004': 'Martlock',
  '4000': 'Fort Sterling',
  '3003': 'Caerleon',
  '5000': 'Brecilien',
};

type Raw = Record<string, any>;

function arr<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function num(v: unknown, def = 0): number {
  const n = Number(v);
  return v === undefined || v === null || v === '' || !Number.isFinite(n) ? def : n;
}

/** Niveau d'enchantement d'un uniquename : suffixe _LEVELn, sinon 0. */
function levelFromName(uniquename: string): number {
  const m = /_LEVEL(\d+)$/.exec(uniquename);
  return m ? Number(m[1]) : 0;
}

/**
 * ID API d'une craftresource : @enchantmentlevel de la ressource prioritaire, puis celui de la définition
 * de l'item (ressources brutes/raffinées _LEVELn), sinon suffixe _LEVELn si l'item est inconnu.
 * Un item défini sans @enchantmentlevel est de niveau 0 même si son nom finit par _LEVELn
 * (T1_ALCHEMY_EXTRACT_LEVEL1, T1_FISHSAUCE_LEVEL1 : ID API sans « @ »).
 */
function resourceApiId(res: Raw, def?: Raw): string {
  const name = String(res['@uniquename']);
  const lvlAttr = res['@enchantmentlevel'] ?? def?.['@enchantmentlevel'];
  const level = lvlAttr !== undefined ? num(lvlAttr) : def ? 0 : levelFromName(name);
  return toApiId(name, level);
}

/** Recettes sans ingrédient FACTION (et avec au moins un ingrédient), dans l'ordre du fichier. */
function usableRequirements(reqs: unknown): Raw[] {
  const out: Raw[] = [];
  for (const r of arr(reqs as Raw | Raw[])) {
    const res = arr(r?.craftresource as Raw | Raw[]);
    if (res.length === 0) continue;
    if (res.some((c) => String(c['@uniquename']).includes('FACTION'))) continue;
    out.push(r);
  }
  return out;
}

/** Première recette sans ingrédient FACTION (et avec au moins un ingrédient). */
function pickRequirement(reqs: unknown): Raw | null {
  return usableRequirements(reqs)[0] ?? null;
}

/**
 * Raison d'exclusion d'un item non vendable à l'hôtel des ventes, ou null s'il est exploitable.
 * Critères vérifiés sur items.json (72 ID du périmètre concernés) :
 * @showinmarketplace="false", @tradable="false", présence de @requiredaccesslevel (GM/interne),
 * nom contenant _PROTOTYPE (objets non sortis), ou @unlockedtoequip="true".
 */
export function unsellableReason(uniquename: string, it: Raw | undefined): string | null {
  if (uniquename.includes('_PROTOTYPE')) return 'prototype';
  if (!it) return null;
  if (String(it['@showinmarketplace'] ?? '') === 'false') return 'showinmarketplace=false';
  if (String(it['@tradable'] ?? '') === 'false') return 'tradable=false';
  if (it['@requiredaccesslevel'] !== undefined) return 'requiredaccesslevel';
  // Objets débloqués à l'équipement (récompenses, vanités) : non vendus à l'hôtel des ventes.
  // Sauf nourriture et potions (@slottype food/potion, poissons crus compris) : tous portent
  // @unlockedtoequip="true" dans items.json et se vendent pourtant normalement (générateur v4).
  const slot = String(it['@slottype'] ?? '');
  if (String(it['@unlockedtoequip'] ?? '') === 'true' && slot !== 'food' && slot !== 'potion') return 'unlockedtoequip';
  return null;
}

/**
 * Version du générateur : À INCRÉMENTER à chaque changement du périmètre ou du format de recipes.json.
 * Le workflow prices.yml régénère recipes.json si celui de la branche data porte une autre version
 * (ou n'en porte pas), pour que les nouveaux ID soient collectés dès le cycle suivant.
 * 2 : exclusion des non vendables, équipement @4, recettes alternatives (variant).
 * 3 : fermes des îles (champ `farming`, ID agricoles collectés), sources loot.json + farmingmodifiers.json.
 * 4 : consommables (cuisine + alchimie, @0–@3, quantité produite @amountcrafted), poids `weight` dans meta.
 */
export const GENERATOR_VERSION = 4;

/** Niveau d'enchantement maximal des consommables (nourriture et potions : @1 à @3). */
export const MAX_CONSUMABLE_ENCHANT = 3;

/** Sous-catégories de consommables retenues (@shopsubcategory1) → clé de bonus par défaut (@craftingcategory). */
const CONSUMABLE_SUBCATEGORIES: Record<string, string> = { food: 'food', potions: 'potion' };

/** Consommables événementiels ou uniques (récompenses, prototypes) : jamais crafés en ville ni vendus. */
export function isEventConsumable(uniquename: string): boolean {
  return uniquename.startsWith('UNIQUE_') || uniquename.includes('_EVENT_') || uniquename.includes('_PROTOTYPE');
}

/** Sources facultatives des fermes (loot.json, farmingmodifiers.json). */
export interface FarmingSources {
  loot?: any;
  farmingModifiers?: any;
}

/** Niveau d'enchantement maximal de l'équipement (le jeu définit @1 à @4). */
export const MAX_EQUIPMENT_ENCHANT = 4;

export function buildRecipesFile(
  itemsJson: any,
  formattedJson: any,
  modifiersJson: any,
  generatedAt: string,
  farmingSources?: FarmingSources,
): RecipesFile {
  return buildRecipesReport(itemsJson, formattedJson, modifiersJson, generatedAt, farmingSources).file;
}

export interface RecipesReport {
  file: RecipesFile;
  /** Sorties écartées car non vendables (elles-mêmes ou un de leurs ingrédients). */
  excludedIds: string[];
}

export function buildRecipesReport(
  itemsJson: any,
  formattedJson: any,
  modifiersJson: any,
  generatedAt: string,
  farmingSources?: FarmingSources,
): RecipesReport {
  // --- Index de tous les items par uniquename ---
  const items = new Map<string, Raw>();
  const root: Raw = itemsJson?.items ?? {};
  for (const [key, val] of Object.entries(root)) {
    if (key.startsWith('@') || key === 'shopcategories') continue;
    for (const it of arr(val as Raw | Raw[])) {
      if (it && typeof it === 'object' && it['@uniquename']) items.set(it['@uniquename'], it);
    }
  }

  // --- Valeur d'item (@itemvalue, sinon somme des ingrédients, récursif) ---
  const valueMemo = new Map<string, number>();
  const baseValue = (uniquename: string, seen = new Set<string>()): number => {
    if (valueMemo.has(uniquename)) return valueMemo.get(uniquename)!;
    const it = items.get(uniquename);
    let v = 0;
    if (it) {
      if (it['@itemvalue'] !== undefined) v = num(it['@itemvalue']);
      else if (!seen.has(uniquename)) {
        seen.add(uniquename);
        const req = pickRequirement(it.craftingrequirements);
        if (req) v = requirementValue(req, seen);
      }
    }
    valueMemo.set(uniquename, v);
    return v;
  };
  const requirementValue = (req: Raw, seen = new Set<string>()): number => {
    let sum = 0;
    for (const c of arr(req.craftresource as Raw | Raw[])) {
      sum += baseValue(String(c['@uniquename']), seen) * num(c['@count'], 1);
    }
    return sum / Math.max(1, num(req['@amountcrafted'], 1));
  };

  // Exclusion des items non vendables (sortie ou ingrédient).
  const excluded = new Set<string>();
  const isUnsellable = (apiId: string): boolean => {
    const { base } = parseApiId(apiId);
    return unsellableReason(base, items.get(base)) !== null;
  };

  /** Clé unique d'une recette : outputId, + '|' + variant pour une recette alternative. */
  const recipes = new Map<string, Recipe>();
  const addRecipe = (r: Recipe) => {
    if (isUnsellable(r.outputId) || r.inputs.some((i) => isUnsellable(i.id))) {
      excluded.add(r.outputId);
      return;
    }
    recipes.set(recipeKey(r), r);
  };
  const toInputs = (req: Raw): RecipeInput[] =>
    arr(req.craftresource as Raw | Raw[]).map((c) => ({
      id: resourceApiId(c, items.get(String(c['@uniquename']))),
      qty: num(c['@count'], 1),
      returnable: String(c['@maxreturnamount'] ?? '') !== '0',
    }));

  // --- Raffinage : simpleitem raffinés T2–T8, @0–@4 ---
  for (const it of arr(root.simpleitem as Raw | Raw[])) {
    const name = String(it['@uniquename']);
    const family = refiningFamily(name);
    if (!family) continue;
    const tier = num(it['@tier']);
    const level = it['@enchantmentlevel'] !== undefined ? num(it['@enchantmentlevel']) : levelFromName(name);
    if (tier < 2 || tier > 8 || level < 0 || level > 4) continue;
    const reqs = usableRequirements(it.craftingrequirements);
    const req = reqs[0];
    if (!req) continue;
    const outputId = toApiId(name, level);
    const itemValue = num(it['@itemvalue']) || requirementValue(req);
    const common = {
      kind: 'refining' as const,
      bonusKey: family,
      category: String(it['@shopcategory'] ?? ''),
      subcategory: String(it['@shopsubcategory1'] ?? ''),
      tier,
      enchant: level,
    };
    addRecipe({
      outputId,
      outputQty: num(req['@amountcrafted'], 1),
      inputs: toInputs(req),
      itemValue,
      ...common,
    });
    // Recettes alternatives (ex. STONEBLOCK depuis ROCK_LEVEL1/2/3, sortie ×2/×4/×8) :
    // variant = ID API de la ressource brute enchantée utilisée.
    for (const alt of reqs.slice(1)) {
      const inputs = toInputs(alt);
      const enchanted = inputs.find((i) => parseApiId(i.id).level > 0);
      if (!enchanted) continue;
      const outputQty = num(alt['@amountcrafted'], 1);
      addRecipe({
        outputId,
        outputQty,
        inputs,
        // Hypothèse : les frais de station portent sur la valeur de tout ce qui est produit.
        itemValue: itemValue * outputQty,
        ...common,
        variant: enchanted.id,
      });
    }
  }

  // --- Équipement : equipmentitem + weapon, T4–T8, @0–@4 ---
  for (const it of [...arr(root.equipmentitem as Raw | Raw[]), ...arr(root.weapon as Raw | Raw[])]) {
    const name = String(it['@uniquename']);
    const tier = num(it['@tier']);
    if (tier < 4 || tier > 8) continue;
    const common = {
      kind: 'crafting' as const,
      bonusKey: String(it['@craftingcategory'] || it['@shopsubcategory1'] || ''),
      category: String(it['@shopcategory'] ?? ''),
      subcategory: String(it['@shopsubcategory1'] ?? ''),
      tier,
    };
    const baseReq = pickRequirement(it.craftingrequirements);
    if (!baseReq) continue;
    const base = baseValue(name);
    addRecipe({
      outputId: name,
      outputQty: num(baseReq['@amountcrafted'], 1),
      inputs: toInputs(baseReq),
      itemValue: base,
      ...common,
      enchant: 0,
    });
    for (const ench of arr(it.enchantments?.enchantment as Raw | Raw[])) {
      const level = num(ench['@enchantmentlevel']);
      if (level < 1 || level > MAX_EQUIPMENT_ENCHANT) continue;
      const req = pickRequirement(ench.craftingrequirements);
      if (!req) continue;
      const outputId = toApiId(name, level);
      addRecipe({
        outputId,
        outputQty: num(req['@amountcrafted'], 1),
        inputs: toInputs(req),
        // Hypothèse : sans @itemvalue sur l'enchantement, valeur de base × 2^niveau.
        itemValue: ench['@itemvalue'] !== undefined ? num(ench['@itemvalue']) : base * 2 ** level,
        ...common,
        enchant: level,
      });
    }
  }

  // --- Consommables : consumableitem, cuisine (food) et alchimie (potions), @0–@3 ---
  // Les poissons crus (crafting/fish) n'ont pas de recette et ne sont que des ingrédients.
  for (const it of arr(root.consumableitem as Raw | Raw[])) {
    const name = String(it['@uniquename']);
    if (String(it['@shopcategory'] ?? '') !== 'consumables') continue;
    const subcategory = String(it['@shopsubcategory1'] ?? '');
    const defaultKey = CONSUMABLE_SUBCATEGORIES[subcategory];
    if (!defaultKey || isEventConsumable(name)) continue;
    const common = {
      kind: 'crafting' as const,
      // Bonus de ville : @craftingcategory (food → Caerleon, potion → Brecilien dans craftingmodifiers.json).
      bonusKey: String(it['@craftingcategory'] || defaultKey),
      category: 'consumables',
      subcategory,
      tier: num(it['@tier']),
    };
    const consumableRecipe = (outputId: string, req: Raw, enchant: number) => {
      const outputQty = num(req['@amountcrafted'], 1);
      addRecipe({
        outputId,
        outputQty,
        inputs: toInputs(req),
        // Sans @itemvalue : valeur de l'item = Σ valeurs des ingrédients / quantité produite ;
        // les frais de station portent sur tout ce qui est produit (même hypothèse que les variantes).
        itemValue:
          it['@itemvalue'] !== undefined ? num(it['@itemvalue']) * outputQty : requirementValue(req) * outputQty,
        ...common,
        enchant,
      });
    };
    const baseReq = pickRequirement(it.craftingrequirements);
    if (!baseReq) continue;
    consumableRecipe(name, baseReq, 0);
    for (const ench of arr(it.enchantments?.enchantment as Raw | Raw[])) {
      const level = num(ench['@enchantmentlevel']);
      if (level < 1 || level > MAX_CONSUMABLE_ENCHANT) continue;
      const req = pickRequirement(ench.craftingrequirements);
      if (req) consumableRecipe(toApiId(name, level), req, level);
    }
  }

  // --- Noms localisés ---
  const names = new Map<string, Raw | null>();
  for (const f of arr(formattedJson as Raw | Raw[])) {
    if (f && f.UniqueName) names.set(String(f.UniqueName), f.LocalizedNames ?? null);
  }

  // --- Fermes (si loot.json est fourni) ---
  const farming = farmingSources?.loot ? buildFarming(root, farmingSources.loot, farmingSources.farmingModifiers) : null;

  // --- Méta : sorties + tous les ingrédients + ID agricoles ---
  const metaIds = new Set<string>(farmingIds(farming));
  for (const r of recipes.values()) {
    metaIds.add(r.outputId);
    for (const i of r.inputs) metaIds.add(i.id);
  }
  const meta: ItemMeta[] = [];
  for (const id of [...metaIds].sort()) {
    const { base, level } = parseApiId(id);
    const it = items.get(base);
    const loc = names.get(id) ?? null;
    const en = loc?.['EN-US'];
    const fr = loc?.['FR-FR'];
    const tierMatch = /^T(\d+)_/.exec(base);
    const m: ItemMeta = {
      id,
      nameFr: fr || en || id,
      nameEn: en || id,
      tier: it?.['@tier'] !== undefined ? num(it['@tier']) : tierMatch ? Number(tierMatch[1]) : 0,
      enchant: level,
      category: String(it?.['@shopcategory'] ?? ''),
      subcategory: String(it?.['@shopsubcategory1'] ?? ''),
    };
    // Poids unitaire (kg) : @weight de l'item de base (l'enchantement ne change pas le poids).
    const weight = Number(it?.['@weight']);
    if (it?.['@weight'] !== undefined && it['@weight'] !== '' && Number.isFinite(weight) && weight >= 0) m.weight = weight;
    meta.push(m);
  }

  // --- Bonus de ville ---
  const bonuses: BonusTable = {};
  for (const loc of arr(modifiersJson?.craftingmodifiers?.craftinglocation as Raw | Raw[])) {
    const cid = loc?.['@clusterid'];
    if (cid === undefined) continue;
    const place = CLUSTER_TO_LOCATION[String(cid)];
    if (!place) continue;
    const modifiers: Record<string, number> = {};
    for (const m of arr(loc.craftingmodifier as Raw | Raw[])) {
      if (m?.['@name'] !== undefined) modifiers[String(m['@name'])] = num(m['@value']);
    }
    bonuses[place] = {
      refiningBase: num(loc.refiningbonus?.['@value']),
      craftingBase: num(loc.craftingbonus?.['@value']),
      modifiers,
    };
  }

  const recipeList = [...recipes.values()].sort((a, b) => {
    const ka = recipeKey(a);
    const kb = recipeKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  // Un item exclu ne doit pas réapparaître via une autre recette.
  for (const r of recipeList) excluded.delete(r.outputId);
  const file: RecipesFile = { generatedAt, generatorVersion: GENERATOR_VERSION, recipes: recipeList, meta, bonuses };
  if (farming) file.farming = farming;
  return { file, excludedIds: [...excluded].sort() };
}

// ---------------------------------------------------------------------------
// Script

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function loadLocal(dir: string) {
  const readJson = async (p: string) => JSON.parse(await readFile(p, 'utf8'));
  const formattedPath = (await exists(join(dir, 'items-formatted.json')))
    ? join(dir, 'items-formatted.json')
    : join(dir, 'formatted', 'items.json');
  const optional = async (name: string) => ((await exists(join(dir, name))) ? readJson(join(dir, name)) : null);
  return Promise.all([
    readJson(join(dir, 'items.json')),
    readJson(formattedPath),
    readJson(join(dir, 'craftingmodifiers.json')),
    optional('loot.json'),
    optional('farmingmodifiers.json'),
  ]);
}

async function loadRemote() {
  const get = async (path: string) => {
    const url = `${BASE_URL}/${path}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
    return res.json();
  };
  return Promise.all([
    get('items.json'),
    get('formatted/items.json'),
    get('craftingmodifiers.json'),
    get('loot.json'),
    get('farmingmodifiers.json'),
  ]);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--print-version')) {
    console.log(GENERATOR_VERSION);
    return;
  }
  const opt = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const localDir = opt('--local');
  const outPath = resolve(opt('--out') ?? 'out/recipes.json');

  const [itemsJson, formattedJson, modifiersJson, lootJson, farmingModifiersJson] = localDir
    ? await loadLocal(localDir)
    : await loadRemote();
  if (!lootJson) console.warn('loot.json absent : pas de données agricoles (farming).');
  const { file, excludedIds } = buildRecipesReport(itemsJson, formattedJson, modifiersJson, new Date().toISOString(), {
    loot: lootJson,
    farmingModifiers: farmingModifiersJson,
  });

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(file));
  const size = (await stat(outPath)).size;

  const byKind: Record<string, number> = {};
  const byCat: Record<string, number> = {};
  for (const r of file.recipes) {
    byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    byCat[r.category] = (byCat[r.category] ?? 0) + 1;
  }
  const frCount = file.meta.filter((m) => m.nameFr !== m.id && m.nameFr !== m.nameEn).length;
  const frOrSame = file.meta.filter((m) => m.nameFr !== m.id).length;
  console.log(`Recettes : ${file.recipes.length} (dont ${file.recipes.filter((r) => r.variant).length} alternatives)`);
  console.log(`Sorties exclues (non vendables) : ${excludedIds.length}`);
  console.log(`Équipement @4 : ${file.recipes.filter((r) => r.kind === 'crafting' && r.enchant === 4).length}`);
  console.log('Par kind :', byKind);
  console.log('Par category :', byCat);
  const consumables = file.recipes.filter((r) => r.category === 'consumables');
  console.log(
    `Consommables : ${consumables.length} (cuisine ${consumables.filter((r) => r.subcategory === 'food').length}, alchimie ${consumables.filter((r) => r.subcategory === 'potions').length})`,
  );
  console.log(`Poids renseignés : ${file.meta.filter((m) => m.weight !== undefined).length}/${file.meta.length}`);
  console.log(`Méta : ${file.meta.length} items ; noms FR : ${((100 * frOrSame) / file.meta.length).toFixed(2)} % (dont ${frCount} distincts de l'anglais)`);
  const missing = file.meta.filter((m) => m.nameFr === m.id).map((m) => m.id);
  if (missing.length) console.log(`Sans nom (${missing.length}) :`, missing.slice(0, 20).join(', '));
  console.log('Bonus :', Object.keys(file.bonuses).join(', '));
  if (file.farming) {
    console.log(
      `Fermes : ${file.farming.crops.length} cultures/herbes, ${file.farming.animals.length} animaux, ${farmingIds(file.farming).length} ID agricoles`,
    );
  }
  console.log(`Fichier : ${outPath} — ${(size / 1024 / 1024).toFixed(2)} Mo (${size} octets)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
