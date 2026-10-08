import { useMemo } from 'react';
import { rankAll, type Rankings } from '../../engine';
import type { MarketSnapshot, RecipesFile, Settings } from '../../types';

export interface RankingsResult {
  rankings: Rankings | null;
  /** Durée du dernier calcul (ms), 0 si rien n'a été calculé. */
  computeMs: number;
}

export function useRankings(
  snapshot: MarketSnapshot | null,
  recipes: RecipesFile | null,
  settings: Settings,
): RankingsResult {
  return useMemo(() => {
    if (!snapshot || !recipes) return { rankings: null, computeMs: 0 };
    const t0 = performance.now();
    // Ancrage : si la collecte a du retard, on évalue les prix à l'heure de la dernière collecte
    // (+30 min) pour que les classements ne se vident pas ; le bandeau signale le retard réel.
    const anchor = Date.parse(snapshot.updatedAt);
    const nowMs = Number.isFinite(anchor) ? Math.min(Date.now(), anchor + 30 * 60_000) : Date.now();
    const rankings = rankAll(snapshot, recipes, settings, new Date(nowMs));
    return { rankings, computeMs: performance.now() - t0 };
  }, [snapshot, recipes, settings]);
}
