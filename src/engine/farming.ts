// Fermes des îles : rentabilité des cultures, herbes et animaux de ferme, classement et planificateur.
// Fonctions pures, sans dépendance navigateur. Les constantes incertaines sont regroupées dans
// FarmAssumptions (modifiables dans l'interface).
import type { FarmAnimal, FarmCrop, FarmingData, Location, Settings } from '../types';
import { volumeAt } from './filters';
import type { PriceIndex, SellCandidate } from './route';

// ---------------------------------------------------------------------------
// Hypothèses
// ---------------------------------------------------------------------------

export interface FarmAssumptions {
  /** Emplacements par parcelle (ferme, jardin d'herbes, pâturage). */
  slotsPerPlot: number;
  /** Multiplicateur de récolte des cultures/herbes avec le premium. */
  premiumYieldMultiplier: number;
  /** Multiplicateur du temps de croissance des animaux avec le premium. */
  premiumGrowthMultiplier: number;
  /** Multiplicateur de la production (œufs, lait) avec le premium. */
  premiumProductMultiplier: number;
  /** Nombre de divisions par 2 du coût en focus à spécialisation 100 (3 → ÷8). */
  focusHalvingsAtMaxSpec: number;
  /**
   * Passages à la ferme par jour (récolte, collecte, abattage). Un cycle de durée T n'est récolté qu'au premier
   * passage après sa fin : cycles/jour = passages ÷ ⌈T × passages / 24 h⌉ (cultures 22 h, animaux 44 h ou 22 h).
   * Nom historique conservé pour la compatibilité du stockage local.
   */
  cropCyclesPerDay: number;
  /** Seuil d'avertissement : part du volume médian 7 j vendue par jour. */
  maxVolumeShare: number;
}

export const DEFAULT_FARM_ASSUMPTIONS: FarmAssumptions = {
  slotsPerPlot: 9,
  premiumYieldMultiplier: 2,
  premiumGrowthMultiplier: 0.5,
  premiumProductMultiplier: 1,
  focusHalvingsAtMaxSpec: 3,
  cropCyclesPerDay: 1,
  maxVolumeShare: 0.1,
};

/**
 * Cycles complets réellement récoltés par jour pour un cycle de `cycleSeconds` et `visitsPerDay` passages
 * régulièrement espacés : on ne récolte qu'au premier passage après la fin du cycle. 0 si entrée invalide.
 */
export function harvestsPerDay(cycleSeconds: number, visitsPerDay: number): number {
  if (!(cycleSeconds > 0) || !(visitsPerDay > 0) || !Number.isFinite(cycleSeconds) || !Number.isFinite(visitsPerDay)) return 0;
  // Tolérance : 79 200 s × 24/22 passages = exactement 1 intervalle, sans arrondi flottant vers 2.
  const intervals = Math.max(1, Math.ceil((cycleSeconds * visitsPerDay) / 86400 - 1e-9));
  return visitsPerDay / intervals;
}

/** Probabilité de retour (graine, petit) : chance de base + bonus d'arrosage/soin, plafonnée à 1 (au plus 1 par emplacement). */
export function returnChance(base: number, focusBonus: number, focused: boolean): number {
  const v = (Number.isFinite(base) ? base : 0) + (focused && Number.isFinite(focusBonus) ? focusBonus : 0);
  return Math.min(1, Math.max(0, v));
}

/** Coût en focus d'une action à une spécialisation donnée (0–100) : focusCost × 0,5^(k·spec/100), arrondi. */
export function focusCostAtSpec(focusCost: number, spec: number, a: Pick<FarmAssumptions, 'focusHalvingsAtMaxSpec'> = DEFAULT_FARM_ASSUMPTIONS): number {
  const s = Math.min(100, Math.max(0, Number.isFinite(spec) ? spec : 0));
  return Math.round(focusCost * 0.5 ** ((a.focusHalvingsAtMaxSpec * s) / 100));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PlotType = 'ferme' | 'jardin' | 'pâturage';
export type AnimalStrategy = 'sell' | 'meat' | 'produce';
export type FarmFlag = 'missing' | 'estimated' | 'low-volume' | 'red-zone' | 'mists' | 'surplus-unpriced';
export type SellPlace = Location | 'auto';

export const STRATEGY_LABEL: Record<AnimalStrategy, string> = {
  sell: 'Élever et vendre l’adulte',
  meat: 'Élever et abattre',
  produce: 'Garder et produire',
};

export const PLOT_LABEL: Record<PlotType, string> = {
  ferme: 'Ferme',
  jardin: 'Jardin d’herbes',
  pâturage: 'Pâturage',
};

export interface FarmOptions {
  /** Lieu de vente forcé (hors Black Market) ; 'auto' = meilleur lieu par produit. */
  sellAt: SellPlace;
  /** Nourriture des animaux : achetée au marché, ou produite sur l'île (coût d'opportunité = prix de vente net). */
  foodSource: 'market' | 'island';
  /** Ville de l'île (bonus de rendement), null = sans bonus. */
  islandCity: Location | null;
  /** Spécialisations (0–100) par ID de graine ou de petit. */
  specs: Record<string, number>;
}

export const DEFAULT_FARM_OPTIONS: FarmOptions = { sellAt: 'auto', foodSource: 'market', islandCity: null, specs: {} };

export interface FarmContext {
  farming: FarmingData;
  index: PriceIndex;
  settings: Pick<Settings, 'premium' | 'mode' | 'minVolume'>;
  assumptions: FarmAssumptions;
  options: FarmOptions;
}

/** Ligne d'achat / de vente par parcelle et par jour. */
export interface FarmFlow {
  id: string;
  qty: number;
  loc: Location | 'npc' | 'island';
  unitPrice: number;
}

export interface FarmStep {
  label: string;
  formula: string;
  value: string;
}

export interface FarmEval {
  /** Identifiant d'activité sans arrosage : crop:<graine> ou animal:<petit>:<stratégie>. */
  activityId: string;
  /** Identifiant de ligne (activité + arrosage). */
  rowId: string;
  kind: 'crop' | 'herb' | 'animal';
  plotType: PlotType;
  strategy: AnimalStrategy | null;
  focused: boolean;
  /** ID de la graine ou du petit (clé de spécialisation). */
  sourceId: string;
  /** Sortie principale (récolte, adulte, viande, produit). */
  mainId: string;
  tier: number;
  ok: boolean;
  /** ID dont le prix manque (sortie principale ou nourriture). */
  missing: string[];
  profitPerPlotDay: number | null;
  focusPerPlotDay: number;
  /** Silver gagné par point de focus (lignes arrosées/soignées) : (P_focus − P_sans) / F. */
  silverPerFocus: number | null;
  sellAt: Location | null;
  oldestPriceAgeH: number;
  volume7d: number | null;
  flags: FarmFlag[];
  cityBonus: number;
  buys: FarmFlow[];
  sells: FarmFlow[];
  steps: FarmStep[];
}

export const FARM_FLAG_LABEL: Record<FarmFlag, { short: string; long: string }> = {
  missing: { short: 'Données manquantes', long: 'Prix de la sortie principale ou de la nourriture absent ou trop vieux : profit non calculé.' },
  estimated: { short: 'Estimé', long: 'Au moins un prix récent manquait : la moyenne 7 jours du même lieu a été utilisée.' },
  'low-volume': { short: 'Volume faible', long: 'Volume médian 7 jours sous le volume minimum des réglages au lieu de vente.' },
  'red-zone': { short: 'Zone rouge', long: 'Vente à Caerleon : trajet en zone rouge (risque de perte totale).' },
  mists: { short: 'Brumes', long: 'Vente à Brecilien, accessible uniquement par les Brumes.' },
  'surplus-unpriced': {
    short: 'Sous-produit non valorisé',
    long: 'Graines ou petits excédentaires, ou vers, sans prix de vente valide : comptés à 0 (profit sous-estimé).',
  },
};

// ---------------------------------------------------------------------------
// Prix
// ---------------------------------------------------------------------------

interface Quote {
  loc: Location | 'npc';
  price: number;
  /** Revenu net (vente) ou prix (achat). */
  net: number;
  ageH: number;
  estimated: boolean;
}

function sellOf(ctx: FarmContext, id: string): Quote | null {
  const ip = ctx.index.get(id);
  if (!ip) return null;
  const forced = ctx.options.sellAt;
  const c: SellCandidate | undefined =
    forced === 'auto' ? ip.sells[0] : ip.sells.find((s) => s.loc === forced);
  if (!c) return null;
  return { loc: c.loc, price: c.price, net: c.net, ageH: c.ageH, estimated: !!c.estimated };
}

/** Prix d'achat : min(meilleur prix marché valide, prix PNJ). */
function buyOf(ctx: FarmContext, id: string, npc: number | null): Quote | null {
  const b = ctx.index.get(id)?.bestBuy ?? null;
  if (b && (npc == null || b.price <= npc)) return { loc: b.loc, price: b.price, net: b.price, ageH: b.ageH, estimated: !!b.estimated };
  if (npc != null && npc > 0) return { loc: 'npc', price: npc, net: npc, ageH: 0, estimated: false };
  return null;
}

const fmt = (n: number, d = 2) =>
  Number.isFinite(n) ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: d }).format(n).replace(/[  ]/g, ' ') : '—';

class Tracker {
  ages: number[] = [];
  estimated = false;
  use(q: Quote | null) {
    if (!q) return;
    if (q.loc !== 'npc') this.ages.push(q.ageH);
    if (q.estimated) this.estimated = true;
  }
  oldest() {
    return this.ages.length ? Math.max(...this.ages) : 0;
  }
}

function cityBonusFor(ctx: FarmContext, key: string): number {
  const city = ctx.options.islandCity;
  if (!city) return 0;
  return ctx.farming.cityBonuses[city]?.[key] ?? 0;
}

function locFlags(loc: Location | null, flags: FarmFlag[]) {
  if (loc === 'Caerleon' || loc === 'Black Market') flags.push('red-zone');
  if (loc === 'Brecilien') flags.push('mists');
}

function finishFlags(ctx: FarmContext, mainId: string, loc: Location | null, t: Tracker, flags: FarmFlag[]): number | null {
  locFlags(loc, flags);
  if (t.estimated) flags.push('estimated');
  if (!loc) return null;
  const item = ctx.index.get(mainId)?.item;
  const vol = item ? volumeAt(item, loc) : null;
  if (vol == null || vol < ctx.settings.minVolume) flags.push('low-volume');
  return vol;
}

// ---------------------------------------------------------------------------
// Cultures et herbes
// ---------------------------------------------------------------------------

export function evaluateCrop(c: FarmCrop, focused: boolean, ctx: FarmContext): FarmEval {
  const a = ctx.assumptions;
  const slots = a.slotsPerPlot;
  const cycles = harvestsPerDay(c.growSeconds > 0 ? c.growSeconds : 79200, a.cropCyclesPerDay);
  const bonus = cityBonusFor(ctx, c.seedId);
  const premMul = ctx.settings.premium ? a.premiumYieldMultiplier : 1;
  const R = c.harvestAvg * premMul * (1 + bonus);
  const S = returnChance(c.seedChance, c.focusBonus, focused);
  const dS = S - 1;
  const t = new Tracker();
  const flags: FarmFlag[] = [];
  const steps: FarmStep[] = [];
  const buys: FarmFlow[] = [];
  const sells: FarmFlow[] = [];

  const crop = sellOf(ctx, c.cropId);
  const worm = c.wormChance > 0 ? sellOf(ctx, c.wormId) : null;
  const seedSell = sellOf(ctx, c.seedId);
  const seedBuy = buyOf(ctx, c.seedId, c.npcSeedPrice);
  const spec = ctx.options.specs[c.seedId] ?? 0;
  const F = focused ? slots * focusCostAtSpec(c.focusCost, spec, a) * cycles : 0;
  const base = {
    activityId: `crop:${c.seedId}`,
    rowId: `crop:${c.seedId}:${focused ? 'f' : 'n'}`,
    kind: c.kind,
    plotType: (c.kind === 'crop' ? 'ferme' : 'jardin') as PlotType,
    strategy: null,
    focused,
    sourceId: c.seedId,
    mainId: c.cropId,
    tier: c.tier,
    focusPerPlotDay: F,
    silverPerFocus: null,
    cityBonus: bonus,
  };

  steps.push({
    label: 'Récolte par emplacement',
    formula: `R = ${fmt(c.harvestAvg)} × ${fmt(premMul)} (premium) × (1 + ${fmt(bonus)}) (bonus de ville)`,
    value: fmt(R),
  });
  steps.push({
    label: 'Graines récupérées',
    formula: `S = ${focused ? 'min(1 ; ' : ''}${fmt(c.seedChance, 4)}${focused ? ` + ${fmt(c.focusBonus, 4)} (arrosage))` : ''} ; ΔS = S − 1`,
    value: `S = ${fmt(S, 4)} ; ΔS = ${fmt(dS, 4)}`,
  });

  if (!crop || (dS < 0 && !seedBuy)) {
    const missing = [!crop ? c.cropId : null, dS < 0 && !seedBuy ? c.seedId : null].filter(Boolean) as string[];
    flags.push('missing');
    return { ...base, ok: false, missing, profitPerPlotDay: null, sellAt: crop ? (crop.loc as Location) : null, oldestPriceAgeH: 0, volume7d: null, flags, buys, sells, steps };
  }
  t.use(crop);
  const cropVal = R * crop.net;
  steps.push({
    label: 'Valeur de la récolte',
    formula: `R × prix net = ${fmt(R)} × ${fmt(crop.net)} (${fmt(crop.price)} à ${crop.loc}, net de taxe)`,
    value: fmt(cropVal),
  });
  sells.push({ id: c.cropId, qty: R * slots * cycles, loc: crop.loc as Location, unitPrice: crop.net });

  let wormVal = 0;
  if (c.wormChance > 0) {
    if (worm) {
      t.use(worm);
      wormVal = c.wormChance * worm.net;
      sells.push({ id: c.wormId, qty: c.wormChance * slots * cycles, loc: worm.loc as Location, unitPrice: worm.net });
    } else flags.push('surplus-unpriced');
    steps.push({
      label: 'Vers',
      formula: worm ? `${fmt(c.wormChance)} × ${fmt(worm.net)} (${worm.loc})` : `${fmt(c.wormChance)} × prix absent → compté 0`,
      value: fmt(wormVal),
    });
  }

  let seedVal = 0;
  if (dS >= 0) {
    if (dS > 0) {
      if (seedSell) {
        t.use(seedSell);
        seedVal = dS * seedSell.net;
        sells.push({ id: c.seedId, qty: dS * slots * cycles, loc: seedSell.loc as Location, unitPrice: seedSell.net });
      } else flags.push('surplus-unpriced');
    }
    steps.push({
      label: 'Graines excédentaires vendues',
      formula: seedSell ? `ΔS × prix net = ${fmt(dS, 4)} × ${fmt(seedSell.net)} (${seedSell.loc})` : `ΔS = ${fmt(dS, 4)} sans prix de vente → 0`,
      value: fmt(seedVal),
    });
  } else {
    t.use(seedBuy);
    seedVal = dS * seedBuy!.price;
    buys.push({ id: c.seedId, qty: -dS * slots * cycles, loc: seedBuy!.loc, unitPrice: seedBuy!.price });
    steps.push({
      label: 'Graines à racheter',
      formula: `ΔS × prix d’achat = ${fmt(dS, 4)} × ${fmt(seedBuy!.price)} (${seedBuy!.loc === 'npc' ? 'PNJ fermier' : seedBuy!.loc})`,
      value: fmt(seedVal),
    });
  }

  const V = cropVal + wormVal + seedVal;
  const P = slots * V * cycles;
  steps.push({ label: 'Valeur par emplacement et par récolte', formula: 'V = récolte + vers + graines', value: fmt(V) });
  steps.push({
    label: 'Profit par parcelle et par jour',
    formula: `${slots} emplacements × V × ${fmt(cycles, 3)} récolte(s)/jour (croissance ${fmt((c.growSeconds || 79200) / 3600, 1)} h, ${fmt(a.cropCyclesPerDay)} passage(s)/jour)`,
    value: fmt(P, 0),
  });
  if (focused) {
    steps.push({
      label: 'Focus par parcelle et par jour',
      formula: `${slots} × ${fmt(focusCostAtSpec(c.focusCost, spec, a), 0)} (coût à spécialisation ${fmt(spec, 0)}) × ${fmt(cycles, 3)}`,
      value: fmt(F, 0),
    });
  }
  const loc = crop.loc as Location;
  const volume7d = finishFlags(ctx, c.cropId, loc, t, flags);
  return { ...base, ok: true, missing: [], profitPerPlotDay: P, sellAt: loc, oldestPriceAgeH: t.oldest(), volume7d, flags, buys, sells, steps };
}

// ---------------------------------------------------------------------------
// Animaux
// ---------------------------------------------------------------------------

export function animalStrategies(an: FarmAnimal): AnimalStrategy[] {
  const out: AnimalStrategy[] = ['sell'];
  if (an.meatId && an.meatPerAdult > 0) out.push('meat');
  if (an.productId && an.productAvg && an.productionSeconds) out.push('produce');
  return out;
}

/** Unités de nourriture pour `nutrition` points, selon la nourriture (favorite → ×(1 + bonus)). */
export function foodUnits(an: FarmAnimal, nutrition: number, foodId: string, farming: FarmingData): number {
  const raw = farming.foodNutrition[foodId];
  const per = typeof raw === 'number' && raw > 0 ? raw : 48;
  const mul = foodId === an.favoriteFood && an.favoriteBonus > 0 ? 1 + an.favoriteBonus : 1;
  return nutrition / (per * mul);
}

export function evaluateAnimal(an: FarmAnimal, strategy: AnimalStrategy, focused: boolean, ctx: FarmContext): FarmEval {
  const a = ctx.assumptions;
  const slots = a.slotsPerPlot;
  const flags: FarmFlag[] = [];
  const steps: FarmStep[] = [];
  const buys: FarmFlow[] = [];
  const sells: FarmFlow[] = [];
  const t = new Tracker();
  const spec = ctx.options.specs[an.babyId] ?? 0;
  const foodId = an.favoriteFood ?? '';
  const mainId = strategy === 'sell' ? an.grownId : strategy === 'meat' ? an.meatId ?? an.grownId : an.productId ?? an.grownId;
  const bonus = strategy === 'produce' ? cityBonusFor(ctx, an.grownId) : 0;
  const T = an.growSeconds * (ctx.settings.premium ? a.premiumGrowthMultiplier : 1);
  // Cycles réellement récoltés par jour (même règle de passages que les cultures) : 44 h → 0,5 ; 22 h → 1.
  const cyclesPerDay =
    strategy === 'produce' ? harvestsPerDay(an.productionSeconds ?? 0, a.cropCyclesPerDay) : harvestsPerDay(T, a.cropCyclesPerDay);
  const F = focused && strategy !== 'produce' ? slots * focusCostAtSpec(an.focusCost, spec, a) * cyclesPerDay : 0;
  const base = {
    activityId: `animal:${an.babyId}:${strategy}`,
    rowId: `animal:${an.babyId}:${strategy}:${focused ? 'f' : 'n'}`,
    kind: 'animal' as const,
    plotType: 'pâturage' as PlotType,
    strategy,
    focused,
    sourceId: an.babyId,
    mainId,
    tier: an.tier,
    focusPerPlotDay: F,
    silverPerFocus: null,
    cityBonus: bonus,
  };

  // Prix de la nourriture : achat marché, ou coût d'opportunité (vente nette) si produite sur l'île.
  const foodQ = foodId ? (ctx.options.foodSource === 'island' ? sellOf(ctx, foodId) : buyOf(ctx, foodId, null)) : null;
  const out = sellOf(ctx, mainId);
  const missing: string[] = [];
  if (!out) missing.push(mainId);
  if (!foodQ) missing.push(foodId || 'nourriture');
  if (!(cyclesPerDay > 0)) missing.push(strategy === 'produce' ? `${an.babyId}:production` : `${an.babyId}:croissance`);
  const babyBuy = buyOf(ctx, an.babyId, an.npcBabyPrice);
  const babySell = sellOf(ctx, an.babyId);
  const B = returnChance(an.offspringChance, an.focusBonus, focused);
  const dB = B - 1;
  if (strategy !== 'produce' && dB < 0 && !babyBuy) missing.push(an.babyId);
  if (missing.length) {
    flags.push('missing');
    return { ...base, ok: false, missing, profitPerPlotDay: null, sellAt: out ? (out.loc as Location) : null, oldestPriceAgeH: 0, volume7d: null, flags, buys, sells, steps };
  }
  t.use(out);
  t.use(foodQ);
  const foodLoc = ctx.options.foodSource === 'island' ? ('island' as const) : foodQ!.loc;
  const foodPrice = foodQ!.net;
  const loc = out!.loc as Location;

  let P: number;
  if (strategy === 'produce') {
    // Nourriture d'un cycle de production (864 nutrition / 22 h), multipliée par les cycles récoltés par jour.
    const units = foodUnits(an, (an.adultConsumptionPerDay * an.productionSeconds!) / 86400, foodId, ctx.farming) * cyclesPerDay;
    const prodMul = ctx.settings.premium ? a.premiumProductMultiplier : 1;
    const perDay = an.productAvg! * prodMul * (1 + bonus) * cyclesPerDay;
    const revenue = perDay * out!.net;
    const foodCost = units * foodPrice;
    const V = revenue - foodCost;
    P = slots * V;
    steps.push({
      label: 'Production par adulte et par jour',
      formula: `${fmt(an.productAvg!)} × ${fmt(prodMul)} (premium) × (1 + ${fmt(bonus)}) × ${fmt(cyclesPerDay, 3)} cycle(s)/jour (${fmt(an.productionSeconds! / 3600, 1)} h)`,
      value: fmt(perDay),
    });
    steps.push({ label: 'Revenu', formula: `${fmt(perDay)} × ${fmt(out!.net)} (net, ${loc})`, value: fmt(revenue) });
    steps.push({
      label: 'Nourriture par jour',
      formula: `${fmt((an.adultConsumptionPerDay * an.productionSeconds!) / 86400, 1)} nutrition/cycle × ${fmt(cyclesPerDay, 3)} ÷ (${fmt(ctx.farming.foodNutrition[foodId] ?? 48, 0)} × ${foodId === an.favoriteFood ? fmt(1 + an.favoriteBonus) : '1'}) = ${fmt(units)} unités × ${fmt(foodPrice)}`,
      value: `−${fmt(foodCost)}`,
    });
    steps.push({ label: 'Profit par parcelle et par jour', formula: `${slots} adultes × (revenu − nourriture) ; petit initial amorti (ignoré)`, value: fmt(P, 0) });
    sells.push({ id: mainId, qty: perDay * slots, loc, unitPrice: out!.net });
    if (foodLoc !== 'island') buys.push({ id: foodId, qty: units * slots, loc: foodLoc, unitPrice: foodPrice });
    else buys.push({ id: foodId, qty: units * slots, loc: 'island', unitPrice: foodPrice });
  } else {
    const units = foodUnits(an, an.nutritionMax, foodId, ctx.farming);
    const foodCost = units * foodPrice;
    steps.push({
      label: 'Croissance',
      formula: `T = ${fmt(an.growSeconds, 0)} s × ${ctx.settings.premium ? fmt(a.premiumGrowthMultiplier) : '1'} ; cycles/jour = ${fmt(a.cropCyclesPerDay)} passage(s) ÷ ⌈T × passages / 24 h⌉`,
      value: `${fmt(T / 3600, 1)} h ; ${fmt(cyclesPerDay, 3)} cycle(s)/jour`,
    });
    steps.push({
      label: 'Nourriture pendant la croissance',
      formula: `${fmt(an.nutritionMax, 0)} ÷ (${fmt(ctx.farming.foodNutrition[foodId] ?? 48, 0)} × ${foodId === an.favoriteFood ? fmt(1 + an.favoriteBonus) : '1'}) = ${fmt(units)} unités × ${fmt(foodPrice)}`,
      value: `−${fmt(foodCost)}`,
    });
    let outVal: number;
    if (strategy === 'sell') {
      outVal = out!.net;
      steps.push({ label: 'Vente de l’adulte', formula: `${fmt(out!.price)} à ${loc}, net de taxe`, value: fmt(outVal) });
      sells.push({ id: mainId, qty: slots * cyclesPerDay, loc, unitPrice: out!.net });
    } else {
      outVal = an.meatPerAdult * out!.net;
      steps.push({
        label: 'Abattage',
        formula: `${an.meatPerAdult} viandes × ${fmt(out!.net)} (net, ${loc}) ; focus d’abattage ignoré`,
        value: fmt(outVal),
      });
      sells.push({ id: mainId, qty: an.meatPerAdult * slots * cyclesPerDay, loc, unitPrice: out!.net });
    }
    let babyVal = 0;
    if (dB >= 0) {
      if (dB > 0) {
        if (babySell) {
          t.use(babySell);
          babyVal = dB * babySell.net;
          sells.push({ id: an.babyId, qty: dB * slots * cyclesPerDay, loc: babySell.loc as Location, unitPrice: babySell.net });
        } else flags.push('surplus-unpriced');
      }
      steps.push({
        label: 'Petits excédentaires',
        formula: `B = ${focused ? 'min(1 ; ' : ''}${fmt(an.offspringChance, 4)}${focused ? ` + ${fmt(an.focusBonus, 4)} (soin))` : ''} ; ΔB = ${fmt(dB, 4)}${dB > 0 ? (babySell ? ` × ${fmt(babySell.net)}` : ' (sans prix → 0)') : ''}`,
        value: fmt(babyVal),
      });
    } else {
      t.use(babyBuy);
      babyVal = dB * babyBuy!.price;
      buys.push({ id: an.babyId, qty: -dB * slots * cyclesPerDay, loc: babyBuy!.loc, unitPrice: babyBuy!.price });
      steps.push({
        label: 'Petits à racheter',
        formula: `B = ${focused ? 'min(1 ; ' : ''}${fmt(an.offspringChance, 4)}${focused ? ` + ${fmt(an.focusBonus, 4)} (soin))` : ''} ; ΔB × prix d’achat = ${fmt(dB, 4)} × ${fmt(babyBuy!.price)} (${babyBuy!.loc === 'npc' ? 'PNJ' : babyBuy!.loc})`,
        value: fmt(babyVal),
      });
    }
    buys.push({ id: foodId, qty: units * slots * cyclesPerDay, loc: foodLoc, unitPrice: foodPrice });
    const V = outVal + babyVal - foodCost;
    P = slots * V * cyclesPerDay;
    steps.push({ label: 'Valeur par animal', formula: 'V = sortie + petits − nourriture', value: fmt(V) });
    steps.push({ label: 'Profit par parcelle et par jour', formula: `${slots} × V × ${fmt(cyclesPerDay, 3)} cycle(s)/jour`, value: fmt(P, 0) });
    if (focused) {
      steps.push({
        label: 'Focus par parcelle et par jour',
        formula: `${slots} × ${fmt(focusCostAtSpec(an.focusCost, spec, a), 0)} (spécialisation ${fmt(spec, 0)}) × ${fmt(cyclesPerDay, 3)}`,
        value: fmt(F, 0),
      });
    }
  }
  const volume7d = finishFlags(ctx, mainId, loc, t, flags);
  return { ...base, ok: true, missing: [], profitPerPlotDay: P, sellAt: loc, oldestPriceAgeH: t.oldest(), volume7d, flags, buys, sells, steps };
}

// ---------------------------------------------------------------------------
// Classement
// ---------------------------------------------------------------------------

/** Évalue une activité (sans arrosage + avec) ; null si l'ID est inconnu. */
export function evaluateActivity(activityId: string, focused: boolean, ctx: FarmContext): FarmEval | null {
  const [type, id, strat] = activityId.split(':');
  if (type === 'crop') {
    const c = ctx.farming.crops.find((x) => x.seedId === id);
    return c ? evaluateCrop(c, focused, ctx) : null;
  }
  if (type === 'animal') {
    const an = ctx.farming.animals.find((x) => x.babyId === id);
    if (!an || !animalStrategies(an).includes(strat as AnimalStrategy)) return null;
    if (strat === 'produce' && focused) return null;
    return evaluateAnimal(an, strat as AnimalStrategy, focused, ctx);
  }
  return null;
}

function withSilverPerFocus(focusedRow: FarmEval, plain: FarmEval): FarmEval {
  if (focusedRow.ok && plain.ok && focusedRow.focusPerPlotDay > 0) {
    focusedRow.silverPerFocus = (focusedRow.profitPerPlotDay! - plain.profitPerPlotDay!) / focusedRow.focusPerPlotDay;
  }
  return focusedRow;
}

/**
 * Toutes les activités : 15 graines × {arrosé, non} ; 6 animaux × stratégies × {soigné, non}
 * (« Garder et produire » : sans soin, le focus n'agit que sur les petits).
 * Tri : profit/parcelle/jour décroissant, lignes sans données à la fin.
 */
export function rankFarming(ctx: FarmContext): FarmEval[] {
  const rows: FarmEval[] = [];
  for (const c of ctx.farming.crops) {
    const n = evaluateCrop(c, false, ctx);
    rows.push(n, withSilverPerFocus(evaluateCrop(c, true, ctx), n));
  }
  for (const an of ctx.farming.animals) {
    for (const s of animalStrategies(an)) {
      const n = evaluateAnimal(an, s, false, ctx);
      rows.push(n);
      if (s !== 'produce') rows.push(withSilverPerFocus(evaluateAnimal(an, s, true, ctx), n));
    }
  }
  return rows.sort((x, y) => (y.profitPerPlotDay ?? -Infinity) - (x.profitPerPlotDay ?? -Infinity));
}

// ---------------------------------------------------------------------------
// Planificateur d'îles
// ---------------------------------------------------------------------------

export interface PlannerPlot {
  id: string;
  type: PlotType;
  activity: 'auto' | string;
}

export interface PlannerIsland {
  id: string;
  name: string;
  city: Exclude<Location, 'Black Market'>;
  plots: PlannerPlot[];
}

export interface PlannerInput {
  islands: PlannerIsland[];
  focusPerDay: number;
  specs: Record<string, number>;
}

export interface PlotPlan {
  islandId: string;
  plotId: string;
  type: PlotType;
  activityId: string | null;
  auto: boolean;
  focused: boolean;
  profitPerDay: number | null;
  focusPerDay: number;
  /** Gain du passage arrosé/soigné (P_focus − P_sans), si disponible. */
  focusGain: number | null;
  eval: FarmEval | null;
  note: string | null;
}

export interface ShoppingLine {
  id: string;
  loc: Location | 'npc' | 'island';
  qtyPerDay: number;
  unitPrice: number;
  totalPerDay: number;
}

export interface PlanResult {
  plots: PlotPlan[];
  totalProfitPerDay: number;
  /** Parcelles exclues du total faute de prix valides ou d'activité compatible (jamais comptées à 0 en silence). */
  plotsWithoutProfit: number;
  focusUsed: number;
  focusLeft: number;
  buys: ShoppingLine[];
  sells: ShoppingLine[];
  warnings: VolumeWarning[];
}

/** Quantité vendue par jour supérieure à la part admise du volume médian 7 j (ou volume inconnu). */
export interface VolumeWarning {
  id: string;
  loc: Location;
  qtyPerDay: number;
  volume: number | null;
}

export function plotAccepts(type: PlotType, e: Pick<FarmEval, 'kind'>): boolean {
  return type === 'ferme' ? e.kind === 'crop' : type === 'jardin' ? e.kind === 'herb' : e.kind === 'animal';
}

/** Activités possibles pour un type de parcelle. */
export function activitiesFor(type: PlotType, farming: FarmingData): { id: string; sourceId: string; strategy: AnimalStrategy | null }[] {
  if (type === 'pâturage') {
    return farming.animals.flatMap((an) => animalStrategies(an).map((s) => ({ id: `animal:${an.babyId}:${s}`, sourceId: an.babyId, strategy: s })));
  }
  const kind = type === 'ferme' ? 'crop' : 'herb';
  return farming.crops.filter((c) => c.kind === kind).map((c) => ({ id: `crop:${c.seedId}`, sourceId: c.seedId, strategy: null }));
}

function addLine(map: Map<string, ShoppingLine>, f: FarmFlow) {
  const key = `${f.id}|${f.loc}`;
  const cur = map.get(key);
  if (cur) {
    cur.totalPerDay += f.qty * f.unitPrice;
    cur.qtyPerDay += f.qty;
    cur.unitPrice = cur.qtyPerDay > 0 ? cur.totalPerDay / cur.qtyPerDay : f.unitPrice;
  } else map.set(key, { id: f.id, loc: f.loc, qtyPerDay: f.qty, unitPrice: f.unitPrice, totalPerDay: f.qty * f.unitPrice });
}

/**
 * 1) activité « auto » = meilleure activité non arrosée compatible avec la parcelle (bonus de la ville de l'île) ;
 * 2) allocation gloutonne du focus par gain/F décroissant, sans arrosage partiel ;
 * 3) totaux, liste de courses, avertissements de volume.
 */
export function planIslands(input: PlannerInput, base: Omit<FarmContext, 'options'> & { options?: Partial<FarmOptions> }): PlanResult {
  const plots: PlotPlan[] = [];
  const pairs: { plan: PlotPlan; plain: FarmEval | null; foc: FarmEval | null }[] = [];
  const cache = new Map<string, FarmContext>();
  const ctxFor = (city: Location): FarmContext => {
    let c = cache.get(city);
    if (!c) {
      c = { ...base, options: { ...DEFAULT_FARM_OPTIONS, ...base.options, islandCity: city, specs: input.specs } };
      cache.set(city, c);
    }
    return c;
  };

  for (const isl of input.islands) {
    const ctx = ctxFor(isl.city);
    for (const p of isl.plots) {
      let activityId: string | null = null;
      let plain: FarmEval | null = null;
      let note: string | null = null;
      const auto = p.activity === 'auto';
      if (auto) {
        for (const act of activitiesFor(p.type, ctx.farming)) {
          const e = evaluateActivity(act.id, false, ctx);
          if (e?.ok && (!plain || e.profitPerPlotDay! > plain.profitPerPlotDay!)) plain = e;
        }
        activityId = plain?.activityId ?? null;
        if (!plain) note = 'Aucune activité avec des prix valides pour cette parcelle.';
      } else {
        activityId = p.activity;
        const e = evaluateActivity(p.activity, false, ctx);
        if (!e || !plotAccepts(p.type, e)) {
          note = 'Activité incompatible avec ce type de parcelle.';
          activityId = null;
        } else {
          plain = e;
          if (!e.ok) note = 'Données manquantes : profit non calculé.';
        }
      }
      const foc = activityId ? evaluateActivity(activityId, true, ctx) : null;
      const plan: PlotPlan = {
        islandId: isl.id,
        plotId: p.id,
        type: p.type,
        activityId,
        auto,
        focused: false,
        profitPerDay: plain?.ok ? plain.profitPerPlotDay : null,
        focusPerDay: 0,
        focusGain: plain?.ok && foc?.ok ? foc.profitPerPlotDay! - plain.profitPerPlotDay! : null,
        eval: plain,
        note,
      };
      plots.push(plan);
      pairs.push({ plan, plain, foc });
    }
  }

  // Allocation gloutonne du focus.
  let left = Math.max(0, Number.isFinite(input.focusPerDay) ? input.focusPerDay : 0);
  const candidates = pairs
    .filter((x) => x.plain?.ok && x.foc?.ok && x.foc.focusPerPlotDay > 0 && x.plan.focusGain! > 0)
    .sort((x, y) => y.plan.focusGain! / y.foc!.focusPerPlotDay - x.plan.focusGain! / x.foc!.focusPerPlotDay);
  for (const c of candidates) {
    const F = c.foc!.focusPerPlotDay;
    if (F <= left) {
      left -= F;
      c.plan.focused = true;
      c.plan.focusPerDay = F;
      c.plan.profitPerDay = c.foc!.profitPerPlotDay;
      c.plan.eval = c.foc;
    }
  }

  // Totaux et liste de courses.
  const buyMap = new Map<string, ShoppingLine>();
  const sellMap = new Map<string, ShoppingLine>();
  let total = 0;
  let used = 0;
  let without = 0;
  for (const p of plots) {
    if (p.profitPerDay != null) total += p.profitPerDay;
    else without += 1;
    used += p.focusPerDay;
    if (!p.eval?.ok) continue;
    for (const b of p.eval.buys) addLine(buyMap, b);
    for (const s of p.eval.sells) addLine(sellMap, s);
  }
  const sortLines = (m: Map<string, ShoppingLine>) => [...m.values()].sort((a, b) => b.totalPerDay - a.totalPerDay);
  const sells = sortLines(sellMap);
  const warnings: VolumeWarning[] = [];
  for (const s of sells) {
    if (s.loc === 'npc' || s.loc === 'island') continue;
    const item = base.index.get(s.id)?.item;
    const vol = item ? volumeAt(item, s.loc) : null;
    if (vol == null || vol <= 0 || s.qtyPerDay > base.assumptions.maxVolumeShare * vol)
      warnings.push({ id: s.id, loc: s.loc, qtyPerDay: s.qtyPerDay, volume: vol != null && vol > 0 ? vol : null });
  }
  return { plots, totalProfitPerDay: total, plotsWithoutProfit: without, focusUsed: used, focusLeft: left, buys: sortLines(buyMap), sells, warnings };
}
