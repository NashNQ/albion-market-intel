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
import { ORDER_FEE, buyQuote, sellQuote, unitCost, unitRevenue } from './cost';
import { confidence, hasEnoughVolume, isSuspect, isSuspectLow, isThinHistory, liquidity, volumeAt } from './filters';
import { score } from './score';

export interface LocatedQuote {
  loc: Location;
  price: number; // prix brut (achat ou vente) selon le mode
  ageH: number;
  /** Prix estimé (moyenne 7 jours du lieu) faute de prix récent valide — repli historyFallback. */
  estimated?: boolean;
  /** Prix réel mais plus vieux que maxPriceAgeH — repli showStale. */
  stale?: boolean;
}

/** Jours d'historique minimum pour utiliser la moyenne 7 jours comme prix estimé. */
export const FALLBACK_MIN_HISTORY_DAYS = 3;
/** Plafond de confiance d'une route qui utilise au moins un prix estimé. */
export const ESTIMATED_MAX_CONFIDENCE = 0.6;
/** Facteur appliqué à la confiance d'une route qui n'existe que grâce à des prix périmés. */
export const STALE_CONFIDENCE_FACTOR = 0.5;
/** Âge au-delà duquel un prix est ignoré même avec showStale (7 jours). */
export const STALE_MAX_AGE_H = 168;
/** Garde-fous : au-delà, un profit est jugé invraisemblable (prix piège ou erreur de collecte). */
export const IMPLAUSIBLE_PROFIT = 10_000_000;
export const IMPLAUSIBLE_MARGIN = 5;

/** Profit unitaire > 10 M ou marge > 500 % du coût : drapeau « suspect », jamais présenté comme sûr. */
export function isImplausibleProfit(unitProfit: number, unitCost: number): boolean {
  return unitProfit > IMPLAUSIBLE_PROFIT || (unitCost > 0 && unitProfit / unitCost > IMPLAUSIBLE_MARGIN);
}

/** Moyenne 7 jours utilisable comme prix estimé au lieu `loc`, ou null. */
export function estimatedPrice(item: MarketItem, loc: Location): number | null {
  const avg = item.avgPrice7d?.[loc];
  const days = item.historyDays?.[loc] ?? 0;
  if (avg == null || !(avg > 0) || !Number.isFinite(avg)) return null;
  if (days < FALLBACK_MIN_HISTORY_DAYS) return null;
  return avg;
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
  const { mode, maxPriceAgeH, historyFallback, showStale } = settings;
  for (const item of snapshot.items) {
    let bestBuy: LocatedQuote | null = null;
    let staleBuy: LocatedQuote | null = null;
    let hasAnyPrice = false;
    for (const loc of PRODUCTION_LOCATIONS) {
      const p = item.prices?.[loc];
      if (!p) continue;
      if ((p.sell ?? 0) > 0 || (p.buy ?? 0) > 0) hasAnyPrice = true;
      const q = buyQuote(p, mode, now, maxPriceAgeH);
      if (q && isSuspectLow(q.price, item, loc)) continue; // ordre piège très bas
      if (q && (!bestBuy || q.price < bestBuy.price)) bestBuy = { loc, price: q.price, ageH: q.ageH };
      if (!q && showStale) {
        const sq = buyQuote(p, mode, now, STALE_MAX_AGE_H);
        if (sq && !isSuspectLow(sq.price, item, loc) && (!staleBuy || sq.price < staleBuy.price))
          staleBuy = { loc, price: sq.price, ageH: sq.ageH, stale: true };
      }
    }
    // Repli : aucun prix d'achat récent valide → moyenne 7 jours du lieu (prix estimé).
    if (!bestBuy && historyFallback) {
      for (const loc of PRODUCTION_LOCATIONS) {
        const avg = estimatedPrice(item, loc);
        if (avg == null) continue;
        const price = mode === 'instant' ? avg : (avg + 1) * (1 + ORDER_FEE);
        if (!bestBuy || price < bestBuy.price) bestBuy = { loc, price, ageH: 0, estimated: true };
      }
    }
    // Repli prix périmés : uniquement si ni prix récent ni prix estimé.
    if (!bestBuy && staleBuy) bestBuy = staleBuy;
    const sells: SellCandidate[] = [];
    const estimatedSells: SellCandidate[] = [];
    const staleSells: SellCandidate[] = [];
    for (const loc of SELL_LOCATIONS) {
      const q = sellQuote(item.prices?.[loc], mode, now, maxPriceAgeH);
      if (q) sells.push({ loc, price: q.price, ageH: q.ageH, net: unitRevenue(q.price, settings) });
      else {
        if (historyFallback) {
          // Repli : pas de prix de vente récent valide dans ce lieu → moyenne 7 jours du même lieu.
          const avg = estimatedPrice(item, loc);
          if (avg != null) estimatedSells.push({ loc, price: avg, ageH: 0, net: unitRevenue(avg, settings), estimated: true });
        }
        if (showStale) {
          const sq = sellQuote(item.prices?.[loc], mode, now, STALE_MAX_AGE_H);
          if (sq) staleSells.push({ loc, price: sq.price, ageH: sq.ageH, net: unitRevenue(sq.price, settings), stale: true });
        }
      }
    }
    sells.sort((a, b) => b.net - a.net);
    // Les prix récents restent prioritaires : les estimés puis les périmés ne servent que si aucun récent ne passe les filtres.
    estimatedSells.sort((a, b) => b.net - a.net);
    staleSells.sort((a, b) => b.net - a.net);
    sells.push(...estimatedSells, ...staleSells);
    const bmP = item.prices?.['Black Market'];
    if (bmP && ((bmP.sell ?? 0) > 0 || (bmP.buy ?? 0) > 0)) hasAnyPrice = true;
    const bq = sellQuote(bmP, mode, now, maxPriceAgeH, true);
    let blackMarket: SellCandidate | null = bq
      ? { loc: 'Black Market' as Location, price: bq.price, ageH: bq.ageH, net: unitRevenue(bq.price, settings, true) }
      : null;
    if (!blackMarket && historyFallback) {
      const avg = estimatedPrice(item, 'Black Market');
      if (avg != null)
        blackMarket = { loc: 'Black Market', price: avg, ageH: 0, net: unitRevenue(avg, settings, true), estimated: true };
    }
    if (!blackMarket && showStale) {
      const sq = sellQuote(bmP, mode, now, STALE_MAX_AGE_H, true);
      if (sq) blackMarket = { loc: 'Black Market', price: sq.price, ageH: sq.ageH, net: unitRevenue(sq.price, settings, true), stale: true };
    }
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
  // 0. Recette sans ingrédient : non évaluable (pas de coût réel).
  if (!recipe.inputs || recipe.inputs.length === 0) return { ok: false, reason: 'missing' };

  // 1. Ingrédients
  const buyPrices: number[] = new Array(recipe.inputs.length);
  const buyFrom: Partial<Record<string, Location>> = {};
  let oldestIngredient = 0;
  let estimated = false;
  let stale = false;
  for (let i = 0; i < recipe.inputs.length; i++) {
    const inp = recipe.inputs[i];
    const ip = index.get(inp.id);
    if (!ip || !ip.bestBuy) return { ok: false, reason: ip?.hasAnyPrice ? 'stale' : 'missing' };
    buyPrices[i] = ip.bestBuy.price;
    buyFrom[inp.id] = ip.bestBuy.loc;
    if (ip.bestBuy.stale) stale = true;
    if (ip.bestBuy.estimated) estimated = true;
    else if (ip.bestBuy.ageH > oldestIngredient) oldestIngredient = ip.bestBuy.ageH;
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
  if (chosen.estimated) estimated = true;
  if (chosen.stale) stale = true;
  // L'âge d'un prix estimé n'a pas de sens : seuls les prix récents comptent pour l'âge.
  const oldest = Math.max(oldestIngredient, chosen.estimated ? 0 : chosen.ageH);
  let c = confidence(oldest, settings.maxPriceAgeH);
  if (estimated) {
    c = Math.min(c, ESTIMATED_MAX_CONFIDENCE);
    flags.push('estimated');
  }
  if (isThinHistory(out.item, chosen.loc)) {
    c = Math.min(c, 0.5);
    flags.push('thin-history');
  }
  if (stale) {
    // Route qui n'existe que grâce à des prix plus vieux que l'âge maximal réglé.
    c *= STALE_CONFIDENCE_FACTOR;
    flags.push('stale');
  }
  if (isImplausibleProfit(unitProfit, cost)) {
    // Ex. artefact affiché 280 ag dans une ville sans moyenne 7 j, revendu 9 000 ag au Black Market.
    c = Math.min(c, 0.5);
    flags.push('suspect');
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
