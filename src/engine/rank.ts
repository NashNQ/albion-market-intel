// Classements — point d'entrée du moteur.
import type { Location, MarketSnapshot, RecipesFile, RouteResult, Settings } from '../types';
import { bestCraftLocation, bestRoute, buildPriceIndex } from './route';

export interface RankStats {
  evaluated: number;
  missing: number;
  stale: number;
  suspect: number;
  lowVolume: number;
}

export interface Rankings {
  refining: RouteResult[];
  crafting: RouteResult[];
  blackMarket: RouteResult[];
  stats: RankStats;
}

export function rankAll(snapshot: MarketSnapshot, recipes: RecipesFile, settings: Settings, now: Date): Rankings {
  const index = buildPriceIndex(snapshot, settings, now);
  const craftCache = new Map<string, { loc: Location; rrr: number }>();
  const refining: RouteResult[] = [];
  const crafting: RouteResult[] = [];
  const blackMarket: RouteResult[] = [];
  const stats: RankStats = { evaluated: 0, missing: 0, stale: 0, suspect: 0, lowVolume: 0 };

  for (const recipe of recipes.recipes) {
    stats.evaluated++;
    const key = recipe.kind + '|' + recipe.bonusKey;
    let craft = craftCache.get(key);
    if (!craft) {
      craft = bestCraftLocation(recipe, recipes.bonuses, settings);
      craftCache.set(key, craft);
    }
    const main = bestRoute(recipe, index, recipes.bonuses, settings, { craft });
    if (main.ok) {
      (recipe.kind === 'refining' ? refining : crafting).push(main.result);
    } else if (main.reason !== 'unprofitable') {
      stats[main.reason]++;
    }
    const bm = bestRoute(recipe, index, recipes.bonuses, settings, { craft, blackMarket: true });
    if (bm.ok) blackMarket.push(bm.result);
  }

  const byScore = (a: RouteResult, b: RouteResult) => (b.score ?? 0) - (a.score ?? 0);
  refining.sort(byScore);
  crafting.sort(byScore);
  blackMarket.sort((a, b) => b.unitProfit - a.unitProfit);
  return { refining, crafting, blackMarket, stats };
}
