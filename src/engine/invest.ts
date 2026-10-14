// Simulateur d'investissement de guilde — fonctions pures.
// Un investisseur finance un membre ; le membre produit un objet et reverse une part de ses profits.
import type { BonusTable, Recipe, RouteResult, Settings } from '../types';
import { unitCost } from './cost';
import { isSuspect } from './filters';
import { bestCraftLocation, bestRoute, type PriceIndex, type RouteFailure } from './route';
import type { JournalPrices, UnitEconomics } from './leveling';
import { JOURNAL_PREFIX } from './leveling';

export type ScenarioKey = 'prudent' | 'central' | 'favorable';

export interface ScenarioDef {
  key: ScenarioKey;
  label: string;
  /** Facteur appliqué au prix de vente (donc au revenu net par unité). */
  priceFactor: number;
  /** Facteur appliqué au volume vendable par jour. */
  volumeFactor: number;
}

export const SCENARIOS: readonly ScenarioDef[] = [
  { key: 'prudent', label: 'Prudent', priceFactor: 0.9, volumeFactor: 0.5 },
  { key: 'central', label: 'Central', priceFactor: 1, volumeFactor: 1 },
  { key: 'favorable', label: 'Favorable', priceFactor: 1.05, volumeFactor: 1.2 },
];

/** Au-delà, le point mort est présenté comme « plus d'un an ». */
export const PAYBACK_HORIZON_DAYS = 365;

/** Activité financée, aux réglages courants (issue d'une route du moteur). */
export interface InvestActivity {
  unitCost: number;
  /** Revenu net par unité (après taxe et frais). */
  unitRevenue: number;
  unitProfit: number;
  /** Unités vendables par jour (Q). */
  q: number;
}

export interface InvestInput {
  /** Capital total investi (ag), coût de montée compris. */
  capital: number;
  /** Part du capital consommée par la montée en compétence (non récupérable). */
  levelingCost: number;
  /** Part des profits reversée à l'investisseur (0..1). */
  investorShare: number;
  /** Capacité de production du membre (unités/jour). null = suit les ventes vendables du scénario. */
  unitsPerDay: number | null;
  /** Jours entre l'achat des matières et la vente. */
  rotationDays: number;
}

export const DEFAULT_INVEST_INPUT: InvestInput = {
  capital: 1_000_000,
  levelingCost: 0,
  investorShare: 0.5,
  unitsPerDay: null,
  rotationDays: 2,
};

export interface ScenarioResult {
  def: ScenarioDef;
  unitCost: number;
  unitRevenue: number;
  unitProfit: number;
  /** Unités vendables par jour dans ce scénario. */
  sellable: number;
  /** Unités visées avant la limite de capital (min capacité, vendable). */
  targetUnits: number;
  /** Unités produites et vendues par jour (min capacité, vendable, capital). */
  unitsPerDay: number;
  limitedBy: 'capacity' | 'market' | 'capital';
  /** Fonds de roulement nécessaire pour produire la capacité visée. */
  workingCapitalNeeded: number;
  /** Fonds de roulement réellement engagé (récupérable). */
  workingCapitalUsed: number;
  profitPerDay: number;
  investorPerDay: number;
  /** Jours pour que la part cumulée rembourse le capital total (null = jamais). */
  paybackTotal: number | null;
  /** Jours pour rembourser le seul coût de montée (0 si aucun ; null = jamais). */
  paybackLeveling: number | null;
  /** ROI = part cumulée ÷ capital − 1, à 30 et 90 jours (lecture prudente : fonds de roulement non compté). */
  roi30: number;
  roi90: number;
  /** ROI en comptant la récupération du fonds de roulement engagé. */
  roi30Recovered: number;
  roi90Recovered: number;
}

export type InvestFailure = 'unprofitable' | 'invalid' | 'levelingExceedsCapital';

export type InvestOutcome =
  | { ok: true; available: number; scenarios: Record<ScenarioKey, ScenarioResult> }
  | { ok: false; reason: InvestFailure };

/** Part cumulée de l'investisseur au jour `day` : rien avant la première vente (après la rotation). */
export function investorCumulative(s: Pick<ScenarioResult, 'investorPerDay'>, rotationDays: number, day: number): number {
  return s.investorPerDay * Math.max(0, day - Math.max(0, rotationDays));
}

function payback(amount: number, perDay: number, rotation: number): number | null {
  if (!(amount > 0)) return 0;
  if (!(perDay > 0)) return null;
  return rotation + amount / perDay;
}

const finiteNonNeg = (n: number) => Number.isFinite(n) && n >= 0;

/** Calcule les 3 scénarios d'un investissement. */
export function simulateInvestment(activity: InvestActivity, input: InvestInput): InvestOutcome {
  const { capital, levelingCost, investorShare, rotationDays } = input;
  if (
    !(Number.isFinite(capital) && capital > 0) ||
    !finiteNonNeg(levelingCost) ||
    !finiteNonNeg(rotationDays) ||
    !(investorShare >= 0 && investorShare <= 1) ||
    !(activity.unitCost > 0) ||
    !Number.isFinite(activity.unitRevenue) ||
    !finiteNonNeg(activity.q) ||
    (input.unitsPerDay != null && !finiteNonNeg(input.unitsPerDay))
  )
    return { ok: false, reason: 'invalid' };
  if (!(activity.unitRevenue - activity.unitCost > 0)) return { ok: false, reason: 'unprofitable' };
  if (levelingCost > capital) return { ok: false, reason: 'levelingExceedsCapital' };

  const available = capital - levelingCost;
  // Rotation 0 : la vente est le jour même, il faut quand même financer une journée de production.
  const rot = Math.max(rotationDays, 0);
  const wcDays = Math.max(rot, 1);
  const scenarios = {} as Record<ScenarioKey, ScenarioResult>;
  for (const def of SCENARIOS) {
    const unitRevenue = activity.unitRevenue * def.priceFactor;
    const unitProfit = unitRevenue - activity.unitCost;
    const sellable = activity.q * def.volumeFactor;
    // Capacité automatique : le membre suit les ventes possibles du scénario (volume ×0,5 / ×1,2 compris).
    const capacity = input.unitsPerDay ?? sellable;
    const targetUnits = Math.min(capacity, sellable);
    let units = targetUnits;
    // Capacité saisie (manuelle ou focus) strictement sous les ventes possibles → limite du membre ; sinon le marché.
    let limitedBy: ScenarioResult['limitedBy'] = input.unitsPerDay != null && capacity < sellable ? 'capacity' : 'market';
    const workingCapitalNeeded = activity.unitCost * units * wcDays;
    if (available < workingCapitalNeeded) {
      units = available / (activity.unitCost * wcDays);
      limitedBy = 'capital';
    }
    const workingCapitalUsed = activity.unitCost * units * wcDays;
    const profitPerDay = units * unitProfit;
    const investorPerDay = profitPerDay * investorShare;
    const ipd = investorPerDay > 0 ? investorPerDay : 0;
    const cum = (d: number) => ipd * Math.max(0, d - rot);
    const roi = (d: number) => cum(d) / capital - 1;
    const roiRec = (d: number) => (cum(d) + (d > rot ? workingCapitalUsed : 0)) / capital - 1;
    scenarios[def.key] = {
      def,
      unitCost: activity.unitCost,
      unitRevenue,
      targetUnits,
      unitProfit,
      sellable,
      unitsPerDay: units,
      limitedBy,
      workingCapitalNeeded,
      workingCapitalUsed,
      profitPerDay,
      investorPerDay,
      paybackTotal: payback(capital, ipd, rot),
      paybackLeveling: payback(levelingCost, ipd, rot),
      roi30: roi(30),
      roi90: roi(90),
      roi30Recovered: roiRec(30),
      roi90Recovered: roiRec(90),
    };
  }
  return { ok: true, available, scenarios };
}

/** Série journalière de la part cumulée (jour 0..days). */
export function cumulativeSeries(s: Pick<ScenarioResult, 'investorPerDay'>, rotationDays: number, days: number): number[] {
  const out: number[] = [];
  for (let d = 0; d <= days; d++) out.push(investorCumulative({ investorPerDay: Math.max(0, s.investorPerDay) }, rotationDays, d));
  return out;
}

/** Horizon du graphique : 30 à 365 jours, assez pour voir le point mort prudent s'il existe. */
export function chartHorizon(scenarios: Record<ScenarioKey, ScenarioResult>): number {
  const pts = SCENARIOS.map((d) => scenarios[d.key].paybackTotal).filter((x): x is number => x != null && x <= PAYBACK_HORIZON_DAYS);
  const max = pts.length ? Math.max(...pts) : 90;
  return Math.min(PAYBACK_HORIZON_DAYS, Math.max(30, Math.ceil(max * 1.15)));
}

/** Lecture d'un point mort : « ≈ 23 jours », « plus d'un an », « jamais ». */
export type PaybackKind = 'days' | 'overYear' | 'never';
export function paybackKind(days: number | null): PaybackKind {
  if (days == null || !Number.isFinite(days)) return 'never';
  return days > PAYBACK_HORIZON_DAYS ? 'overYear' : 'days';
}

// ---------------------------------------------------------------------------
// Activité depuis le moteur de routes
// ---------------------------------------------------------------------------

export type ActivityOutcome =
  | { ok: true; route: RouteResult; activity: InvestActivity }
  | { ok: false; reason: RouteFailure };

/** Route du moteur aux réglages courants → activité finançable (pas de chiffre si la route échoue). */
export function activityFor(recipe: Recipe, index: PriceIndex, bonuses: BonusTable, settings: Settings): ActivityOutcome {
  const out = bestRoute(recipe, index, bonuses, settings);
  if (!out.ok) return out;
  const r = out.result;
  return {
    ok: true,
    route: r,
    activity: { unitCost: r.unitCost, unitRevenue: r.unitRevenue, unitProfit: r.unitProfit, q: r.q ?? 0 },
  };
}

/**
 * Coût et revenu net d'une recette même non rentable (montée en compétence) : meilleur achat, meilleur lieu de
 * production, meilleure vente non suspecte (sans filtre de volume). null si un prix manque.
 */
export function unitEconomics(recipe: Recipe, index: PriceIndex, bonuses: BonusTable, settings: Settings): UnitEconomics | null {
  if (!recipe.inputs?.length) return null;
  const prices: number[] = [];
  for (const inp of recipe.inputs) {
    const ip = index.get(inp.id);
    if (!ip?.bestBuy) return null;
    prices.push(ip.bestBuy.price);
  }
  const out = index.get(recipe.outputId);
  const sell = out?.sells.find((c) => !isSuspect(c.price, out.item, c.loc));
  if (!out || !sell) return null;
  const craft = bestCraftLocation(recipe, bonuses, settings);
  return { unitCost: unitCost(recipe, prices, craft.rrr, settings), unitRevenue: sell.net };
}

/** Prix d'un journal de guerrier (plein : revenu net de vente ; vide : prix d'achat), si les deux existent. */
export function journalPrices(index: PriceIndex, tier: number): JournalPrices | null {
  const full = index.get(`T${tier}_${JOURNAL_PREFIX}_FULL`)?.sells[0]?.net;
  const empty = index.get(`T${tier}_${JOURNAL_PREFIX}`)?.bestBuy?.price;
  if (full == null || empty == null) return null;
  return { full, empty };
}

/** Unités/jour permises par le focus (null si le coût en focus est inconnu). */
export function focusLimitedUnits(focusPerDay: number, focusCostPerCraft: number | null | undefined, outputQty = 1): number | null {
  if (!(focusCostPerCraft != null && focusCostPerCraft > 0) || !(focusPerDay >= 0)) return null;
  return Math.floor(focusPerDay / focusCostPerCraft) * (outputQty > 0 ? outputQty : 1);
}
