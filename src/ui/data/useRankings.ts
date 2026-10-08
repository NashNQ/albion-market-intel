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
    const rankings = rankAll(snapshot, recipes, settings, new Date());
    return { rankings, computeMs: performance.now() - t0 };
  }, [snapshot, recipes, settings]);
}
