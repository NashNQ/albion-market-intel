// Indicateurs d'historique de marché (fiche objet) — fonctions pures, sans dépendance UI.
// Entrée : points AODP (pas de 6 h ou 24 h) ; sortie : jours UTC agrégés et indicateurs joueur.

export const DAY_MS = 86_400_000;

/** Point brut d'historique : horodatage (ms UTC), prix moyen de la tranche, nombre de ventes. */
export interface RawPoint {
  t: number;
  avgPrice: number;
  count: number;
}

/** Jour UTC agrégé. `day` = minuit UTC en ms. */
export interface DailyPoint {
  day: number;
  /** Prix moyen pondéré par le nombre de ventes de chaque tranche. */
  price: number;
  /** Somme des ventes du jour. */
  volume: number;
}

export const startOfUtcDay = (t: number): number => Math.floor(t / DAY_MS) * DAY_MS;

/**
 * Regroupe des tranches (6 h) en jours UTC : volume = somme des ventes, prix = moyenne pondérée
 * par le nombre de ventes (moyenne simple si toutes les tranches ont 0 vente). Les points au prix
 * nul, négatif ou non fini sont ignorés. Résultat trié par jour croissant.
 */
export function aggregateDaily(points: readonly RawPoint[]): DailyPoint[] {
  const byDay = new Map<number, { w: number; n: number; sum: number; k: number }>();
  for (const p of points) {
    if (!Number.isFinite(p.t) || !Number.isFinite(p.avgPrice) || p.avgPrice <= 0) continue;
    const count = Number.isFinite(p.count) && p.count > 0 ? p.count : 0;
    const d = startOfUtcDay(p.t);
    const acc = byDay.get(d) ?? { w: 0, n: 0, sum: 0, k: 0 };
    acc.w += p.avgPrice * count;
    acc.n += count;
    acc.sum += p.avgPrice;
    acc.k += 1;
    byDay.set(d, acc);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, a]) => ({ day, price: a.n > 0 ? a.w / a.n : a.sum / a.k, volume: a.n }));
}

/**
 * Jours de la fenêtre des `n` derniers jours UTC, jour en cours inclus
 * (`includeToday = false` : n jours complets, jour en cours exclu).
 */
export function lastDays(daily: readonly DailyPoint[], n: number, nowMs: number, includeToday = true): DailyPoint[] {
  const today = startOfUtcDay(nowMs);
  const end = includeToday ? today : today - DAY_MS;
  const start = end - (n - 1) * DAY_MS;
  return daily.filter((d) => d.day >= start && d.day <= end);
}

/** Moyenne 30 jours pondérée par le volume (moyenne simple des jours si aucun volume). */
export function average30d(daily: readonly DailyPoint[], nowMs: number): number | null {
  const win = lastDays(daily, 30, nowMs);
  if (win.length === 0) return null;
  let w = 0;
  let n = 0;
  for (const d of win) {
    w += d.price * d.volume;
    n += d.volume;
  }
  return n > 0 ? w / n : win.reduce((s, d) => s + d.price, 0) / win.length;
}

/** Écart relatif (current − ref) / ref ; null si une valeur manque ou si ref ≤ 0. */
export function deviationPct(current: number | null | undefined, ref: number | null | undefined): number | null {
  if (current == null || ref == null || !Number.isFinite(current) || !Number.isFinite(ref) || ref <= 0) return null;
  return (current - ref) / ref;
}

export type TrendDir = 'up' | 'down' | 'flat';
export interface Trend {
  dir: TrendDir;
  /** Variation estimée sur 7 jours, relative au prix moyen de la fenêtre (0,05 = +5 %). */
  pct: number;
  /** Jours utilisés pour la régression. */
  days: number;
}

/** Seuil sous lequel la tendance est dite « stable » (variation 7 j en valeur absolue). */
export const TREND_FLAT = 0.03;

/**
 * Tendance 7 jours : régression linéaire (moindres carrés) du prix journalier sur le temps,
 * sur les 7 derniers jours UTC (jour en cours inclus). pct = pente/jour × 7 / prix moyen.
 * Exige au moins 3 jours avec données.
 */
export function trend7d(daily: readonly DailyPoint[], nowMs: number, flat = TREND_FLAT): Trend | null {
  const win = lastDays(daily, 7, nowMs);
  if (win.length < 3) return null;
  const xs = win.map((d) => (d.day - win[0].day) / DAY_MS);
  const ys = win.map((d) => d.price);
  const n = win.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  if (den === 0 || my <= 0) return null;
  const pct = ((num / den) * 7) / my;
  const dir: TrendDir = Math.abs(pct) < flat ? 'flat' : pct > 0 ? 'up' : 'down';
  return { dir, pct, days: n };
}

export function median(values: readonly number[]): number | null {
  const v = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * Ventes par jour : médiane du volume des `n` derniers jours complets (jour en cours exclu,
 * car partiel). Les jours sans données sont ignorés, comme pour le volume médian 7 j du collecteur.
 */
export function medianDailySales(daily: readonly DailyPoint[], nowMs: number, n = 7): number | null {
  return median(lastDays(daily, n, nowMs, false).map((d) => d.volume));
}

/**
 * Jours estimés pour écouler `qty` unités : qty / min(ventes/jour × part de marché, plafond).
 * null si la quantité ou le débit est nul ou invalide.
 */
export function daysToSell(qty: number, dailySales: number | null, share: number, cap = Infinity): number | null {
  if (!Number.isFinite(qty) || qty <= 0 || dailySales == null || !Number.isFinite(dailySales)) return null;
  const perDay = Math.min(dailySales * share, cap);
  if (!(perDay > 0)) return null;
  return qty / perDay;
}

/** Catégorie d'âge d'un prix : < 1 h frais, < 6 h correct, ≤ 24 h vieux, > 24 h périmé. */
export type AgeClass = 'fresh' | 'ok' | 'old' | 'stale' | 'none';
export function ageClass(ageH: number | null | undefined): AgeClass {
  if (ageH == null || !Number.isFinite(ageH)) return 'none';
  if (ageH < 1) return 'fresh';
  if (ageH < 6) return 'ok';
  if (ageH <= 24) return 'old';
  return 'stale';
}
