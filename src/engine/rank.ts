// Classements — point d'entrée du moteur.
// Plusieurs recettes peuvent partager un outputId (recettes alternatives, champ `variant`) :
// chacune est évaluée et classée séparément ; aucune structure n'est indexée par outputId seul.
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
  /** Statistiques globales (classements raffinage + craft, hors Black Market). */
  stats: RankStats;
  /** Statistiques propres au Black Market (mêmes raisons d'échec, évaluées vers le BM). */
  bmStats: RankStats;
}

/** Tri des classements : score décroissant ; égalité → profit unitaire décroissant, puis outputId/variant (déterministe). */
export function compareRanked(a: RouteResult, b: RouteResult): number {
  const ka = a.recipe.outputId + (a.recipe.variant ?? '');
  const kb = b.recipe.outputId + (b.recipe.variant ?? '');
  return (b.score ?? 0) - (a.score ?? 0) || b.unitProfit - a.unitProfit || (ka < kb ? -1 : ka > kb ? 1 : 0);
}

export function rankAll(snapshot: MarketSnapshot, recipes: RecipesFile, settings: Settings, now: Date): Rankings {
  const index = buildPriceIndex(snapshot, settings, now);
  const craftCache = new Map<string, { loc: Location; rrr: number }>();
  const refining: RouteResult[] = [];
  const crafting: RouteResult[] = [];
  const blackMarket: RouteResult[] = [];
  const stats: RankStats = { evaluated: 0, missing: 0, stale: 0, suspect: 0, lowVolume: 0 };
  const bmStats: RankStats = { evaluated: 0, missing: 0, stale: 0, suspect: 0, lowVolume: 0 };

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
    bmStats.evaluated++;
    if (bm.ok) blackMarket.push(bm.result);
    else if (bm.reason !== 'unprofitable') bmStats[bm.reason]++;
  }

  const byScore = compareRanked;
  refining.sort(byScore);
  crafting.sort(byScore);
  blackMarket.sort((a, b) => b.unitProfit - a.unitProfit);
  return { refining, crafting, blackMarket, stats, bmStats };
}
