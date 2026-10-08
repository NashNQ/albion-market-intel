import { useMemo } from 'react';
import { rankAll, type Rankings } from '../../engine';
import type { MarketSnapshot, RecipesFile, RouteResult, Settings } from '../../types';

export interface RankingsResult {
  rankings: Rankings | null;
  /** Durée du dernier calcul (ms), 0 si rien n'a été calculé. */
  computeMs: number;
}

/** Fenêtre d'ancrage : si la collecte a du retard, les prix sont évalués à updatedAt + 30 min. */
export const ANCHOR_MS = 30 * 60_000;

/** Heure d'évaluation ancrée sur la dernière collecte (+30 min au plus). */
export function anchoredNow(snapshot: Pick<MarketSnapshot, 'updatedAt'>, nowMs: number): number {
  const anchor = Date.parse(snapshot.updatedAt);
  return Number.isFinite(anchor) ? Math.min(nowMs, anchor + ANCHOR_MS) : nowMs;
}

/** Retard (h) entre l'heure réelle et l'heure d'évaluation ancrée : à ajouter aux âges affichés. */
export function anchorLagH(snapshot: Pick<MarketSnapshot, 'updatedAt'> | null, nowMs: number): number {
  if (!snapshot) return 0;
  return Math.max(0, (nowMs - anchoredNow(snapshot, nowMs)) / 3_600_000);
}

const shift = (rows: RouteResult[], lagH: number): RouteResult[] =>
  rows.map((r) => ({ ...r, oldestPriceAgeH: r.oldestPriceAgeH + lagH }));

export function useRankings(
  snapshot: MarketSnapshot | null,
  recipes: RecipesFile | null,
  settings: Settings,
  nowMs?: number,
): RankingsResult {
  const base = useMemo(() => {
    if (!snapshot || !recipes) return { rankings: null, computeMs: 0 };
    const t0 = performance.now();
    // Ancrage : si la collecte a du retard, on évalue les prix à l'heure de la dernière collecte
    // (+30 min) pour que les classements ne se vident pas ; le bandeau signale le retard réel.
    const rankings = rankAll(snapshot, recipes, settings, new Date(anchoredNow(snapshot, Date.now())));
    return { rankings, computeMs: performance.now() - t0 };
  }, [snapshot, recipes, settings]);

  // L'âge AFFICHÉ reste l'âge réel : on ajoute le retard d'ancrage (M9), sans recalculer les classements.
  const lagH = snapshot ? anchorLagH(snapshot, nowMs ?? Date.now()) : 0;
  const lagKey = Math.round(lagH * 60); // à la minute près
  return useMemo(() => {
    const r = base.rankings;
    if (!r || lagKey === 0) return base;
    const l = lagKey / 60;
    return {
      computeMs: base.computeMs,
      rankings: { ...r, refining: shift(r.refining, l), crafting: shift(r.crafting, l), blackMarket: shift(r.blackMarket, l) },
    };
  }, [base, lagKey]);
}
