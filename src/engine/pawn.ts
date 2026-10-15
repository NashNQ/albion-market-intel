// Prêts sur gage de la guilde — fonctions pures (aucune dépendance UI).
// Valeur du gage aux prix du snapshot, dynamique du prix (historique AODP 30 j), projection prudente,
// date limite conseillée (au-delà, mieux vaut saisir le gage) et synthèse pour le tableau de bord.
import { LOCATIONS, type Location, type MarketItem } from '../types';
import { ORDER_FEE, TAX_PREMIUM, TAX_STANDARD } from './cost';
import { isSuspect, volumeAt } from './filters';
import { DAY_MS, lastDays, type DailyPoint } from './history-metrics';

/** Quantile de la loi normale à 90 % : la valeur réelle n'a qu'environ 1 chance sur 10 de passer sous la valeur prudente. */
export const Z_PRUDENT = 1.28;
/** Volatilité journalière supposée sans historique (3 %/jour). */
export const DEFAULT_SIGMA = 0.03;
/** Horizon de recherche de la date limite (jours). */
export const HORIZON_DAYS = 90;
/** « À surveiller » : date limite dans 3 jours ou moins. */
export const WATCH_DAYS = 3;
/** Fenêtre d'historique (jours) et minimum de jours avec données pour l'utiliser. */
export const HISTORY_WINDOW = 30;
export const MIN_HISTORY_DAYS = 5;
/**
 * Tendance retenue bornée : une hausse n'est jamais comptée (0 au plus : on ne prête pas sur une flambée, qu'un
 * emprunteur peut d'ailleurs provoquer quelques jours avant de demander le prêt), baisse bornée à −10 %/jour.
 */
export const TREND_MAX = 0;
export const TREND_MIN = -0.1;
/** Prix plus vieux qu'une semaine : ignorés pour évaluer un gage. */
export const MAX_QUOTE_AGE_H = 168;
/**
 * Liquidité de la revente rapide : on ne compte pas plus d'unités que la ville n'en vend en 3 jours
 * (volume journalier médian × 3, au moins 1 unité : l'ordre d'achat visible en prend au moins une).
 * Saisir 50 armes T8 qui se vendent 2 fois par jour ne vaut pas 50 × l'ordre d'achat.
 */
export const QUICK_SALE_DAYS = 3;

// ---------------------------------------------------------------------------
// Dates (jours UTC au format AAAA-MM-JJ)
// ---------------------------------------------------------------------------

export const isoDay = (d: Date): string => d.toISOString().slice(0, 10);
/**
 * Jour civil LOCAL (fuseau du navigateur) au format AAAA-MM-JJ : c'est le jour que l'officier lit sur son calendrier et
 * saisit dans les champs date. Avec isoDay (UTC), à 1 h du matin à Paris le prêt « du 16 » était encore daté du 15
 * et une échéance « le 15 » ne passait en retard qu'à 2 h du matin.
 */
export const localDay = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const dayMs = (iso: string): number => Date.parse(iso + 'T00:00:00Z');
export const addDays = (iso: string, n: number): string => isoDay(new Date(dayMs(iso) + n * DAY_MS));
/** Nombre de jours de `from` à `to` (positif si `to` est après). */
export const daysBetween = (from: string, to: string): number => Math.round((dayMs(to) - dayMs(from)) / DAY_MS);

// ---------------------------------------------------------------------------
// 1) Valeur du gage
// ---------------------------------------------------------------------------

export interface CollateralQuote {
  loc: Location;
  /** Prix unitaire du marché (meilleur ordre d'achat ou vente minimale). */
  unitPrice: number;
  /** Valeur nette unitaire, taxes et frais déduits. */
  unitNet: number;
  /** unitNet × quantité. */
  total: number;
  at: string;
  ageH: number;
  /** Plus vieux que l'âge maximal réglé. */
  stale: boolean;
  /** Ventes par jour dans cette ville (médiane 7 j) ; null si inconnu. */
  dailyVolume: number | null;
  /** Unités réellement comptées dans `total` (revente rapide : bornée par la liquidité ; mise en vente : toutes). */
  countedQty: number;
}

export interface CollateralValuation {
  /** Taxe de vente appliquée (0,04 premium, 0,08 sinon). */
  tax: number;
  /** Revente rapide : vendre tout de suite au meilleur ordre d'achat, × (1 − taxe). */
  quick: CollateralQuote | null;
  /** Mise en vente : vente minimale × (1 − taxe − 2,5 % de frais d'ordre) ; attendre un acheteur. */
  listing: CollateralQuote | null;
  /** Prix écartés car suspects (plus de 3 × la moyenne 7 j). */
  suspectExcluded: number;
}

export interface ValuationOpts {
  premium: boolean;
  maxPriceAgeH: number;
  now: Date;
}

interface Cand {
  loc: Location;
  price: number;
  at: string;
  ageH: number;
  vol: number | null;
}

/** Unités revendables tout de suite dans une ville (voir QUICK_SALE_DAYS) ; volume inconnu → pas de plafond. */
export function quickSellableQty(qty: number, dailyVolume: number | null): number {
  if (dailyVolume == null || !Number.isFinite(dailyVolume)) return qty;
  return Math.min(qty, Math.max(1, Math.floor(Math.max(0, dailyVolume) * QUICK_SALE_DAYS)));
}

/** Meilleur candidat frais selon `score`, sinon meilleur candidat périmé (signalé). */
function pick(cands: Cand[], maxAgeH: number, score: (c: Cand) => number): (Cand & { stale: boolean }) | null {
  const fresh = cands.filter((c) => c.ageH < maxAgeH).sort((a, b) => score(b) - score(a));
  if (fresh.length) return { ...fresh[0], stale: false };
  const old = cands.slice().sort((a, b) => score(b) - score(a));
  return old.length ? { ...old[0], stale: true } : null;
}

/**
 * Valeur du gage dans la meilleure ville, aux prix du snapshot. Les prix suspects (au-dessus de 3 × la moyenne
 * 7 jours du lieu) sont écartés : un ordre d'achat aberrant gonflerait le gage. Aucun prix → null (rien n'est inventé).
 */
export function valueCollateral(item: MarketItem | null | undefined, qty: number, opts: ValuationOpts): CollateralValuation {
  const tax = opts.premium ? TAX_PREMIUM : TAX_STANDARD;
  const out: CollateralValuation = { tax, quick: null, listing: null, suspectExcluded: 0 };
  if (!item || !(qty > 0)) return out;
  const nowMs = opts.now.getTime();
  const age = (iso: string | null): number | null => {
    if (!iso) return null;
    const t = Date.parse(iso);
    return Number.isNaN(t) ? null : Math.max(0, (nowMs - t) / 3_600_000);
  };
  const buys: Cand[] = [];
  const sells: Cand[] = [];
  for (const loc of LOCATIONS) {
    const p = item.prices[loc];
    if (!p) continue;
    const ba = age(p.buyAt);
    if (p.buy != null && p.buy > 0 && ba != null && ba <= MAX_QUOTE_AGE_H) {
      if (isSuspect(p.buy, item, loc)) out.suspectExcluded++;
      else buys.push({ loc, price: p.buy, at: p.buyAt as string, ageH: ba, vol: volumeAt(item, loc) });
    }
    const sa = age(p.sellAt);
    // On ne peut pas mettre en vente au Black Market (il n'achète que par ses propres ordres).
    if (loc !== 'Black Market' && p.sell != null && p.sell > 0 && sa != null && sa <= MAX_QUOTE_AGE_H) {
      if (isSuspect(p.sell, item, loc)) out.suspectExcluded++;
      else sells.push({ loc, price: p.sell, at: p.sellAt as string, ageH: sa, vol: volumeAt(item, loc) });
    }
  }
  // Revente rapide : la ville qui rapporte le plus en comptant la liquidité (un ordre d'achat élevé dans une ville
  // où rien ne se vend ne vaut qu'une unité), à prix égal la plus liquide.
  const q = pick(buys, opts.maxPriceAgeH, (c) => c.price * quickSellableQty(qty, c.vol) + (c.vol ?? 0) * 1e-9);
  if (q) {
    const unitNet = q.price * (1 - tax);
    const counted = quickSellableQty(qty, q.vol);
    out.quick = { loc: q.loc, unitPrice: q.price, unitNet, total: unitNet * counted, at: q.at, ageH: q.ageH, stale: q.stale, dailyVolume: q.vol, countedQty: counted };
  }
  const l = pick(sells, opts.maxPriceAgeH, (c) => c.price);
  if (l) {
    const unitNet = l.price * (1 - tax - ORDER_FEE);
    out.listing = { loc: l.loc, unitPrice: l.price, unitNet, total: unitNet * qty, at: l.at, ageH: l.ageH, stale: l.stale, dailyVolume: l.vol, countedQty: qty };
  }
  return out;
}

/** Tolérance au-dessus du prix moyen récent avant de plafonner un ordre d'achat (fluctuations normales du marché). */
export const AVG_CAP_RATIO = 1.25;

/** Prix moyen payé sur les 7 derniers jours (pondéré par les ventes), sinon sur 30 jours ; null sans données. */
export function recentAveragePrice(daily: readonly DailyPoint[] | null | undefined, nowMs: number): number | null {
  if (!daily || daily.length === 0) return null;
  for (const n of [7, 30]) {
    const win = lastDays(daily, n, nowMs).filter((d) => Number.isFinite(d.price) && d.price > 0);
    if (!win.length) continue;
    const vol = win.reduce((s, d) => s + Math.max(0, d.volume), 0);
    return vol > 0 ? win.reduce((s, d) => s + d.price * Math.max(0, d.volume), 0) / vol : win.reduce((s, d) => s + d.price, 0) / win.length;
  }
  return null;
}

/**
 * Plafonne la revente rapide à 125 % du prix moyen réellement payé récemment dans la ville (historique AODP) : un
 * ordre d'achat posé juste sous le seuil « suspect » (ex. 2,5 × la moyenne) puis annulé une fois le prêt accordé ne
 * doit pas gonfler le gage. Sans moyenne, la valorisation est rendue telle quelle.
 */
export function capQuickToAverage(v: CollateralValuation, avgPrice: number | null): CollateralValuation & { cappedToAverage: boolean } {
  const q = v.quick;
  if (!q || avgPrice == null || !Number.isFinite(avgPrice) || avgPrice <= 0) return { ...v, cappedToAverage: false };
  const cap = avgPrice * AVG_CAP_RATIO;
  if (q.unitPrice <= cap) return { ...v, cappedToAverage: false };
  const unitNet = cap * (1 - v.tax);
  return { ...v, quick: { ...q, unitPrice: cap, unitNet, total: unitNet * q.countedQty }, cappedToAverage: true };
}

/** Ville dont l'historique sert à projeter le gage : celle de la revente rapide, sinon celle de la mise en vente. */
export const valuationCity = (v: CollateralValuation): Location | null => v.quick?.loc ?? v.listing?.loc ?? null;

// ---------------------------------------------------------------------------
// 2) Dynamique du prix
// ---------------------------------------------------------------------------

export interface PriceDynamics {
  /** Tendance retenue (rendement logarithmique par jour, bornée). */
  trend: number;
  /** Tendance mesurée avant bornage (null sans historique). */
  rawTrend: number | null;
  /** Volatilité : écart-type des rendements journaliers logarithmiques. */
  sigma: number;
  /** Jours d'historique utilisés. */
  days: number;
  /** false = estimation sans historique (tendance 0, volatilité 3 %/jour). */
  fromHistory: boolean;
}

export const FALLBACK_DYNAMICS: PriceDynamics = { trend: 0, rawTrend: null, sigma: DEFAULT_SIGMA, days: 0, fromHistory: false };

/**
 * Tendance et volatilité sur les 30 derniers jours (prix moyen journalier de la ville de revente).
 * Tendance = pente de la régression linéaire (moindres carrés) de ln(prix) sur le jour : +0,01 ≈ +1 %/jour.
 * Volatilité = écart-type (n − 1) des rendements ln(p_j / p_i) / √(j − i) entre jours consécutifs disponibles
 * (un trou de k jours compte comme k jours de variation). Moins de 5 jours → repli FALLBACK_DYNAMICS.
 */
export function priceDynamics(daily: readonly DailyPoint[] | null | undefined, nowMs: number): PriceDynamics {
  if (!daily || daily.length === 0) return { ...FALLBACK_DYNAMICS };
  const win = lastDays(daily, HISTORY_WINDOW, nowMs).filter((d) => Number.isFinite(d.price) && d.price > 0);
  if (win.length < MIN_HISTORY_DAYS) return { ...FALLBACK_DYNAMICS };
  const xs = win.map((d) => (d.day - win[0].day) / DAY_MS);
  const ys = win.map((d) => Math.log(d.price));
  const n = win.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const rawTrend = den > 0 ? num / den : 0;
  const rets: number[] = [];
  for (let i = 1; i < n; i++) {
    const gap = xs[i] - xs[i - 1];
    if (gap > 0) rets.push((ys[i] - ys[i - 1]) / Math.sqrt(gap));
  }
  let sigma = DEFAULT_SIGMA;
  if (rets.length >= 2) {
    const m = rets.reduce((s, r) => s + r, 0) / rets.length;
    sigma = Math.sqrt(rets.reduce((s, r) => s + (r - m) ** 2, 0) / (rets.length - 1));
  }
  return { trend: Math.min(TREND_MAX, Math.max(TREND_MIN, rawTrend)), rawTrend, sigma, days: n, fromHistory: true };
}

/** Valeur prudente du gage au jour t : V0 × exp(tendance × t − z × σ × √t). */
export function prudentValue(v0: number, dyn: Pick<PriceDynamics, 'trend' | 'sigma'>, t: number, z = Z_PRUDENT): number {
  return v0 * Math.exp(dyn.trend * t - z * dyn.sigma * Math.sqrt(Math.max(0, t)));
}

// ---------------------------------------------------------------------------
// 3) Évaluation d'un prêt
// ---------------------------------------------------------------------------

export interface PawnRules {
  maxLtv: number;
  safetyMargin: number;
  maxTermDays: number;
}

export interface LoanTerms {
  amount: number;
  rate: number;
  startDate: string;
  /** Échéance convenue (pour « En retard »). */
  dueDate?: string | null;
}

export interface LoanEvaluation {
  /** Montant dû = montant × (1 + taux). */
  due: number;
  interest: number;
  /** Valeur de revente rapide du gage aujourd'hui (null : pas de prix). */
  v0: number | null;
  /** Montant / valeur de revente rapide. */
  ltv: number | null;
  /**
   * Prêt max conseillé = min(maxLtv × revente rapide, montant dont le dû reste couvert jusqu'à la fin de la durée max :
   * valeur prudente à cette date × (1 − marge) ÷ (1 + intérêt)).
   */
  maxLoan: number | null;
  /** Contrainte qui fixe le prêt max : la LTV, ou la couverture jusqu'à la fin de la durée max (gage volatil). */
  maxLoanBy: 'ltv' | 'term' | null;
  dynamics: PriceDynamics;
  /** Jours entre aujourd'hui et la date limite conseillée (0 = déjà insuffisant) ; null si aucune dans l'horizon. */
  limitDay: number | null;
  limitDate: string | null;
  /** Retour idéal : min(date limite, début + durée max), jamais avant demain. */
  idealDate: string;
  /** Le gage couvre le dû (marge comprise) sur tout l'horizon de 90 jours. */
  coveredBeyondHorizon: boolean;
  /** La valeur prudente (marge déduite) est déjà sous le montant dû. */
  insufficientNow: boolean;
  /** Échéance convenue dépassée. */
  overdue: boolean;
  /** Valeur prudente marge déduite, jour 0 → HORIZON_DAYS (vide sans prix). */
  projection: number[];
}

/**
 * Évalue un prêt aujourd'hui. Date limite conseillée = premier jour t (depuis aujourd'hui) où
 * V(t) × (1 − marge) < montant dû : passé ce jour, si l'emprunteur n'a pas remboursé, saisir et revendre le gage
 * est plus sûr que d'attendre.
 */
export function evaluateLoan(
  terms: LoanTerms,
  v0: number | null,
  dyn: PriceDynamics,
  rules: PawnRules,
  today: Date,
): LoanEvaluation {
  const amount = Math.max(0, terms.amount);
  const rate = Math.max(0, terms.rate);
  const due = amount * (1 + rate);
  const t0 = localDay(today);
  const tomorrow = addDays(t0, 1);
  const hasV = v0 != null && Number.isFinite(v0) && v0 > 0;
  const margin = Math.min(0.9, Math.max(0, rules.safetyMargin));

  const projection: number[] = [];
  let limitDay: number | null = null;
  if (hasV) {
    for (let t = 0; t <= HORIZON_DAYS; t++) {
      const v = prudentValue(v0, dyn, t) * (1 - margin);
      projection.push(v);
      if (limitDay == null && v < due) limitDay = t;
    }
  }
  const limitDate = limitDay == null ? null : addDays(t0, limitDay);
  const termEnd = addDays(terms.startDate, Math.max(1, Math.round(rules.maxTermDays)));
  let ideal = limitDate != null && limitDate < termEnd ? limitDate : termEnd;
  if (ideal < tomorrow) ideal = tomorrow;
  let maxLoan: number | null = null;
  let maxLoanBy: LoanEvaluation['maxLoanBy'] = null;
  if (hasV) {
    const byLtv = Math.max(0, Math.min(1, rules.maxLtv)) * v0;
    const horizon = Math.max(1, daysBetween(t0, termEnd));
    const byTerm = (prudentValue(v0, dyn, horizon) * (1 - margin)) / (1 + rate);
    maxLoan = Math.min(byLtv, byTerm);
    maxLoanBy = byTerm < byLtv ? 'term' : 'ltv';
  }

  return {
    due,
    interest: due - amount,
    v0: hasV ? v0 : null,
    ltv: hasV ? amount / v0 : null,
    maxLoan,
    maxLoanBy,
    dynamics: dyn,
    limitDay,
    limitDate,
    idealDate: ideal,
    coveredBeyondHorizon: hasV && limitDay == null,
    insufficientNow: limitDay === 0,
    overdue: !!terms.dueDate && terms.dueDate < t0,
    projection,
  };
}

// ---------------------------------------------------------------------------
// 4) Statut, urgence, gain ou perte
// ---------------------------------------------------------------------------

export type LoanHealth = 'overdue' | 'insufficient' | 'watch' | 'unpriced' | 'covered' | 'repaid' | 'seized';

export const HEALTH_LABEL: Record<LoanHealth, string> = {
  overdue: 'En retard',
  insufficient: 'Gage insuffisant',
  watch: 'À surveiller',
  unpriced: 'Gage non évalué',
  covered: 'Couvert',
  repaid: 'Remboursé',
  seized: 'Gage saisi',
};

export function loanHealth(status: 'open' | 'repaid' | 'seized', ev: LoanEvaluation): LoanHealth {
  if (status === 'repaid') return 'repaid';
  if (status === 'seized') return 'seized';
  if (ev.overdue) return 'overdue';
  if (ev.v0 == null) return 'unpriced';
  if (ev.insufficientNow) return 'insufficient';
  if (ev.limitDay != null && ev.limitDay <= WATCH_DAYS) return 'watch';
  return 'covered';
}

const HEALTH_RANK: Record<LoanHealth, number> = { overdue: 0, insufficient: 1, watch: 2, unpriced: 3, covered: 4, seized: 5, repaid: 6 };

/** Tri par urgence : en retard, gage insuffisant, à surveiller, non évalué, couvert (date limite la plus proche d'abord), puis clos. */
export function compareUrgency(
  a: { health: LoanHealth; ev: LoanEvaluation; dueDate: string },
  b: { health: LoanHealth; ev: LoanEvaluation; dueDate: string },
): number {
  const r = HEALTH_RANK[a.health] - HEALTH_RANK[b.health];
  if (r !== 0) return r;
  const la = a.ev.limitDay ?? Infinity;
  const lb = b.ev.limitDay ?? Infinity;
  if (la !== lb) return la - lb;
  return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;
}

/** Gain (positif) ou perte d'un gage saisi : valeur de revente rapide − montant prêté. */
export function seizedResult(quickValue: number | null, amount: number): number | null {
  return quickValue == null || !Number.isFinite(quickValue) ? null : quickValue - amount;
}

// ---------------------------------------------------------------------------
// 5) Synthèse (tableau de bord du mode guilde)
// ---------------------------------------------------------------------------

export interface LoanLike {
  itemId: string;
  qty: number;
  amount: number;
  rate: number;
  dueDate: string;
  status: 'open' | 'repaid' | 'seized';
}

export interface LoansSummary {
  /** Nombre de prêts en cours. */
  open: number;
  /** Argent prêté encore dehors (ag). */
  lentOpen: number;
  /** Total dû par les emprunteurs, intérêts compris (ag). */
  dueOpen: number;
  /** Valeur de revente rapide des gages évalués (ag). */
  collateralValue: number;
  /** Prêts en cours dont le gage (marge déduite) ne couvre plus le dû. */
  atRisk: number;
  /** Prêts en cours dont l'échéance est dépassée. */
  overdue: number;
  /** Prêts en cours sans prix pour le gage. */
  unpriced: number;
}

/**
 * Synthèse des prêts en cours. `valueOf(itemId)` = valeur nette unitaire de revente rapide (ag) ou null.
 * `opts.safetyMargin` (0 par défaut) est retirée de la valeur du gage pour compter les prêts à risque.
 */
export function summarizeLoans(
  loans: readonly LoanLike[],
  valueOf: (itemId: string) => number | null,
  today: Date,
  opts: { safetyMargin?: number; totalOf?: (itemId: string, qty: number) => number | null } = {},
): LoansSummary {
  const t0 = localDay(today);
  const margin = Math.min(0.9, Math.max(0, opts.safetyMargin ?? 0));
  const s: LoansSummary = { open: 0, lentOpen: 0, dueOpen: 0, collateralValue: 0, atRisk: 0, overdue: 0, unpriced: 0 };
  for (const l of loans) {
    if (l.status !== 'open') continue;
    const due = l.amount * (1 + l.rate);
    s.open++;
    s.lentOpen += l.amount;
    s.dueOpen += due;
    if (l.dueDate < t0) s.overdue++;
    // `totalOf` (si fourni) tient compte de la liquidité : préférable à valeur unitaire × quantité.
    const unit = opts.totalOf ? null : valueOf(l.itemId);
    const v = opts.totalOf ? opts.totalOf(l.itemId, l.qty) : unit == null ? null : unit * l.qty;
    if (v == null || !Number.isFinite(v)) {
      s.unpriced++;
      continue;
    }
    s.collateralValue += v;
    if (v * (1 - margin) < due) s.atRisk++;
  }
  return s;
}
