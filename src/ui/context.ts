import { createContext, useContext } from 'react';
import type { ItemMeta, MarketItem, MarketSnapshot, RecipesFile, Recipe, RouteResult, Settings } from '../types';

export interface RankStatsView {
  evaluated: number;
  missing: number;
  stale: number;
  suspect: number;
  lowVolume: number;
}

export interface RankingsView {
  refining: RouteResult[];
  crafting: RouteResult[];
  blackMarket: RouteResult[];
  /** Statistiques globales (raffinage + craft). */
  stats: RankStatsView;
  /** Statistiques propres au Black Market (absentes des anciennes formes). */
  bmStats?: RankStatsView;
  ms: number;
}

/**
 * Normalise la sortie de useRankings : accepte la forme du contrat
 * ({ refining, crafting, blackMarket, stats, ms }) ou la forme { rankings, computeMs }.
 */
export function toRankingsView(raw: unknown): RankingsView | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if ('rankings' in r) {
    const inner = r.rankings as Omit<RankingsView, 'ms'> | null;
    if (!inner) return null;
    return { ...inner, ms: typeof r.computeMs === 'number' ? r.computeMs : 0 };
  }
  if (Array.isArray(r.refining)) {
    const v = r as unknown as RankingsView;
    return { ...v, ms: typeof v.ms === 'number' ? v.ms : 0 };
  }
  return null;
}

export interface AppData {
  snapshot: MarketSnapshot | null;
  recipes: RecipesFile | null;
  rankings: RankingsView | null;
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  resetSettings: () => void;
  metaById: Map<string, ItemMeta>;
  itemById: Map<string, MarketItem>;
  /** Recette principale par outputId (sans variant). */
  recipeByOutput: Map<string, Recipe>;
  /** Toutes les recettes d'un outputId (principale d'abord, puis alternatives). */
  recipesByOutput: Map<string, Recipe[]>;
  now: Date;
}

export const AppDataContext = createContext<AppData | null>(null);

export function useAppData(): AppData {
  const v = useContext(AppDataContext);
  if (!v) throw new Error('AppDataContext manquant');
  return v;
}

export function buildIndexes(snapshot: MarketSnapshot | null, recipes: RecipesFile | null) {
  const metaById = new Map<string, ItemMeta>();
  const itemById = new Map<string, MarketItem>();
  const recipeByOutput = new Map<string, Recipe>();
  const recipesByOutput = new Map<string, Recipe[]>();
  for (const m of recipes?.meta ?? []) metaById.set(m.id, m);
  for (const r of recipes?.recipes ?? []) {
    const list = recipesByOutput.get(r.outputId);
    if (list) list.push(r);
    else recipesByOutput.set(r.outputId, [r]);
  }
  for (const [id, list] of recipesByOutput) {
    list.sort((a, b) => (a.variant ? 1 : 0) - (b.variant ? 1 : 0));
    recipeByOutput.set(id, list[0]);
  }
  for (const i of snapshot?.items ?? []) itemById.set(i.id, i);
  return { metaById, itemById, recipeByOutput, recipesByOutput };
}
