// Construction de la meilleure route (achat → production → vente) — fonctions pures.
import {
  LOCATIONS,
  PRODUCTION_LOCATIONS,
  type BonusTable,
  type Location,
  type MarketItem,
  type MarketSnapshot,
  type Recipe,
  type RouteResult,
  type Settings,
} from '../types';
import { recipeRrr } from './rrr';
import { buyQuote, sellQuote, unitCost, unitRevenue } from './cost';
import { confidence, hasEnoughVolume, isSuspect, isSuspectLow, isThinHistory, liquidity, volumeAt } from './filters';
import { score } from './score';

export interface LocatedQuote {
  loc: Location;
  price: number; // prix brut (achat ou vente) selon le mode
  ageH: number;
}

export interface SellCandidate extends LocatedQuote {
  net: number; // revenu net par unité
}

export interface ItemPrices {
  item: MarketItem;
  /** Meilleur prix d'achat valide parmi PRODUCTION_LOCATIONS (null si aucun). */
  bestBuy: LocatedQuote | null;
  /** Vrai si l'item a au moins un prix > 0 quelque part, même périmé (pour distinguer stale / missing). */
  hasAnyPrice: boolean;
  /** Candidats de vente hors Black Market, triés par revenu net décroissant. */
  sells: SellCandidate[];
  /** Vente au Black Market (achat instantané par le BM), ou null. */
  blackMarket: SellCandidate | null;
}

export type PriceIndex = Map<string, ItemPrices>;

const SELL_LOCATIONS = LOCATIONS.filter((l) => l !== 'Black Market');

/** Pré-calcule, pour chaque item, le meilleur achat valide et les ventes par lieu. */
export function buildPriceIndex(snapshot: MarketSnapshot, settings: Settings, now: Date): PriceIndex {
  const index: PriceIndex = new Map();
  const { mode, maxPriceAgeH } = settings;
  for (const item of snapshot.items) {
    let bestBuy: LocatedQuote | null = null;
    let hasAnyPrice = false;
    for (const loc of PRODUCTION_LOCATIONS) {
      const p = item.prices[loc];
      if (!p) continue;
      if ((p.sell ?? 0) > 0 || (p.buy ?? 0) > 0) hasAnyPrice = true;
      const q = buyQuote(p, mode, now, maxPriceAgeH);
      if (q && isSuspectLow(q.price, item, loc)) continue; // ordre piège très bas
      if (q && (!bestBuy || q.price < bestBuy.price)) bestBuy = { loc, price: q.price, ageH: q.ageH };
    }
    const sells: SellCandidate[] = [];
    for (const loc of SELL_LOCATIONS) {
      const q = sellQuote(item.prices[loc], mode, now, maxPriceAgeH);
      if (q) sells.push({ loc, price: q.price, ageH: q.ageH, net: unitRevenue(q.price, settings) });
    }
    sells.sort((a, b) => b.net - a.net);
    const bmP = item.prices['Black Market'];
    if (bmP && ((bmP.sell ?? 0) > 0 || (bmP.buy ?? 0) > 0)) hasAnyPrice = true;
    const bq = sellQuote(bmP, mode, now, maxPriceAgeH, true);
    const blackMarket = bq
      ? { loc: 'Black Market' as Location, price: bq.price, ageH: bq.ageH, net: unitRevenue(bq.price, settings, true) }
      : null;
    index.set(item.id, { item, bestBuy, hasAnyPrice, sells, blackMarket });
  }
  return index;
}

/** Lieu de production au plus fort RRR (égalité → premier dans PRODUCTION_LOCATIONS). */
export function bestCraftLocation(
  recipe: Pick<Recipe, 'kind' | 'bonusKey'>,
  bonuses: BonusTable,
  settings: Settings,
): { loc: Location; rrr: number } {
  let best: { loc: Location; rrr: number } = { loc: PRODUCTION_LOCATIONS[0], rrr: -1 };
  for (const loc of PRODUCTION_LOCATIONS) {
    const r = recipeRrr(recipe, loc, bonuses, settings);
    if (r > best.rrr) best = { loc, rrr: r };
  }
  return best;
}

export type RouteFailure = 'missing' | 'stale' | 'suspect' | 'lowVolume' | 'unprofitable';
export type RouteOutcome = { ok: true; result: RouteResult } | { ok: false; reason: RouteFailure };

export interface RouteOptions {
  blackMarket?: boolean;
  /** Lieu de production pré-calculé (cache par kind/bonusKey). */
  craft?: { loc: Location; rrr: number };
}

function zoneFlags(locs: Iterable<Location>, flags: RouteResult['flags']): void {
  let red = false;
  let mists = false;
  for (const l of locs) {
    if (l === 'Caerleon' || l === 'Black Market') red = true;
    if (l === 'Brecilien') mists = true;
  }
  if (red) flags.push('red-zone');
  if (mists) flags.push('mists');
}

/**
 * Meilleure route pour une recette.
 * Vente : lieu au meilleur revenu net parmi ceux qui passent les filtres (volume, prix non suspect) ;
 * si aucun ne passe, la raison retournée est celle du meilleur candidat.
 */
export function bestRoute(
  recipe: Recipe,
  index: PriceIndex,
  bonuses: BonusTable,
  settings: Settings,
  opts: RouteOptions = {},
): RouteOutcome {
  // 1. Ingrédients
  const buyPrices: number[] = new Array(recipe.inputs.length);
  const buyFrom: Partial<Record<string, Location>> = {};
  let oldestIngredient = 0;
  for (let i = 0; i < recipe.inputs.length; i++) {
    const inp = recipe.inputs[i];
    const ip = index.get(inp.id);
    if (!ip || !ip.bestBuy) return { ok: false, reason: ip?.hasAnyPrice ? 'stale' : 'missing' };
    buyPrices[i] = ip.bestBuy.price;
    buyFrom[inp.id] = ip.bestBuy.loc;
    if (ip.bestBuy.ageH > oldestIngredient) oldestIngredient = ip.bestBuy.ageH;
  }

  // 2. Sortie
  const out = index.get(recipe.outputId);
  const candidates: SellCandidate[] = out
    ? opts.blackMarket
      ? out.blackMarket
        ? [out.blackMarket]
        : []
      : out.sells
    : [];
  if (!out || candidates.length === 0) return { ok: false, reason: out?.hasAnyPrice ? 'stale' : 'missing' };

  // 3. Production
  const craft = opts.craft ?? bestCraftLocation(recipe, bonuses, settings);
  const cost = unitCost(recipe, buyPrices, craft.rrr, settings);

  // 4. Vente
  let firstFailure: RouteFailure | null = null;
  let chosen: SellCandidate | null = null;
  let volume: number | null = null;
  for (const c of candidates) {
    if (isSuspect(c.price, out.item, c.loc)) {
      firstFailure ??= 'suspect';
      continue;
    }
    const v = volumeAt(out.item, c.loc);
    if (!opts.blackMarket) {
      if (!hasEnoughVolume(v, settings)) {
        firstFailure ??= 'lowVolume';
        continue;
      }
    } else if (v == null || v <= 0) {
      // Black Market : aucune vente observée sur 7 jours → pas de débouché réel.
      firstFailure ??= 'lowVolume';
      continue;
    }
    volume = v;
    chosen = c;
    break;
  }
  if (!chosen) return { ok: false, reason: firstFailure ?? 'missing' };

  const unitProfit = chosen.net - cost;
  if (!(unitProfit > 0)) return { ok: false, reason: 'unprofitable' };

  const flags: RouteResult['flags'] = [];
  const oldest = Math.max(oldestIngredient, chosen.ageH);
  let c = confidence(oldest, settings.maxPriceAgeH);
  if (isThinHistory(out.item, chosen.loc)) {
    c = Math.min(c, 0.5);
    flags.push('thin-history');
  }
  const routeLocs = new Set<Location>(Object.values(buyFrom) as Location[]);
  routeLocs.add(craft.loc);
  routeLocs.add(chosen.loc);
  zoneFlags(routeLocs, flags);

  const q = opts.blackMarket || volume == null ? null : liquidity(volume, settings);
  return {
    ok: true,
    result: {
      recipe,
      buyFrom,
      craftAt: craft.loc,
      sellAt: chosen.loc,
      rrr: craft.rrr,
      unitCost: cost,
      unitRevenue: chosen.net,
      unitProfit,
      volume,
      q,
      confidence: c,
      score: q == null ? null : score(unitProfit, q, c),
      oldestPriceAgeH: oldest,
      flags,
    },
  };
}
