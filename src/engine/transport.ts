// Transport pur : acheter dans un lieu, revendre dans un autre, sans rien fabriquer — fonctions pures.
import { LOCATIONS, PRODUCTION_LOCATIONS, type ItemMeta, type Location, type MarketSnapshot, type Settings } from '../types';
import { ORDER_FEE, unitRevenue } from './cost';
import { isSuspect, isSuspectLow, liquidity } from './filters';
import { STALE_MAX_AGE_H, isImplausibleProfit } from './route';

export type TransportFlag = 'red-zone' | 'mists' | 'suspect' | 'stale';

export interface TransportRow {
  itemId: string;
  buyAt: Location;
  /** Prix d'achat unitaire (instantané : sell min ; ordres : (buy max + 1) × 1,025). */
  buyPrice: number;
  buyAgeH: number;
  sellAt: Location;
  /** Prix de vente brut (instantané : buy max ; ordres : sell min − 1). */
  sellPrice: number;
  sellAgeH: number;
  /** Revenu net par unité (taxe et frais d'ordre déduits). */
  sellNet: number;
  unitProfit: number;
  /** Profit / prix d'achat. */
  margin: number;
  /** Poids unitaire (kg) si connu. */
  weight: number | null;
  profitPerKg: number | null;
  /** Volume médian vendu par jour (7 j) au lieu de vente. */
  volume: number;
  /** Quantité vendable par jour = min(volume × part de marché, plafond). */
  sellablePerDay: number;
  dailyProfit: number;
  oldestAgeH: number;
  flags: TransportFlag[];
}

export interface TransportOptions {
  /** Inclure les prix plus vieux que settings.maxPriceAgeH (marqués « stale »), jusqu'à 7 jours au plus. */
  includeStale?: boolean;
  /** Toutes les paires (A, B) rentables au lieu du meilleur couple par objet. */
  allPairs?: boolean;
}

export interface TransportResult {
  rows: TransportRow[];
  /** Objets examinés. */
  evaluated: number;
}

/** Lieux d'achat : toutes les villes (le Black Market ne vend rien). */
export const TRANSPORT_BUY_LOCATIONS: Location[] = PRODUCTION_LOCATIONS;
/** Lieux de vente : toutes les villes + Black Market. */
export const TRANSPORT_SELL_LOCATIONS: Location[] = [...LOCATIONS];

/** Poids d'un objet lu de façon tolérante (champ optionnel ajouté à ItemMeta). */
export function metaWeight(meta: ItemMeta | undefined): number | null {
  const w = (meta as { weight?: unknown } | undefined)?.weight;
  return typeof w === 'number' && Number.isFinite(w) && w > 0 ? w : null;
}

const MS_PER_H = 3_600_000;

/** Âge (h) d'un horodatage ISO, avec cache par chaîne (beaucoup d'horodatages se répètent). */
function makeAge(now: Date) {
  const nowMs = now.getTime();
  const cache = new Map<string, number>();
  return (at: string | null | undefined): number => {
    if (!at) return Infinity;
    let h = cache.get(at);
    if (h === undefined) {
      const t = Date.parse(at);
      h = Number.isNaN(t) ? Infinity : Math.max(0, (nowMs - t) / MS_PER_H);
      cache.set(at, h);
    }
    return h;
  };
}

const isRed = (l: Location) => l === 'Caerleon' || l === 'Black Market';

/** Calcule les opportunités de transport. Tri : profit/jour décroissant. */
export function computeTransport(
  snapshot: MarketSnapshot | null,
  settings: Settings,
  now: Date,
  metaById?: Map<string, ItemMeta>,
  opts: TransportOptions = {},
): TransportResult {
  const rows: TransportRow[] = [];
  if (!snapshot) return { rows, evaluated: 0 };
  // Même au-delà de l'âge réglé, un prix de plus de 7 jours (ou daté 0001-01-01) n'est jamais utilisé.
  const maxAge = opts.includeStale ? Math.max(STALE_MAX_AGE_H, settings.maxPriceAgeH) : settings.maxPriceAgeH;
  const staleAt = settings.maxPriceAgeH;
  const nBuy = TRANSPORT_BUY_LOCATIONS.length;
  const nSell = TRANSPORT_SELL_LOCATIONS.length;
  // Tampons réutilisés (pas d'allocation par objet).
  const bPrice = new Float64Array(nBuy);
  const bAge = new Float64Array(nBuy);
  const sPrice = new Float64Array(nSell);
  const sNet = new Float64Array(nSell);
  const sAge = new Float64Array(nSell);
  const sVol = new Float64Array(nSell);
  let evaluated = 0;
  const orders = settings.mode === 'orders';
  const ageOf = makeAge(now);

  for (const item of snapshot.items) {
    evaluated++;
    let anyBuy = false;
    for (let i = 0; i < nBuy; i++) {
      const loc = TRANSPORT_BUY_LOCATIONS[i];
      // Même règle que buyQuote (cost.ts) : instantané = sell min ; ordres = (buy max + 1) × (1 + 2,5 %).
      bPrice[i] = 0;
      const p = item.prices?.[loc];
      if (!p) continue;
      const raw = orders ? p.buy : p.sell;
      if (raw == null || !(raw > 0) || !Number.isFinite(raw)) continue;
      const age = ageOf(orders ? p.buyAt : p.sellAt);
      if (!(age < maxAge)) continue;
      bPrice[i] = orders ? (raw + 1) * (1 + ORDER_FEE) : raw;
      bAge[i] = age;
      anyBuy = true;
    }
    if (!anyBuy) continue;
    let anySell = false;
    for (let j = 0; j < nSell; j++) {
      const loc = TRANSPORT_SELL_LOCATIONS[j];
      // Même règle que sellQuote (cost.ts) : instantané ou Black Market = buy max ; ordres = sell min − 1.
      sPrice[j] = 0;
      const v = item.volume7d?.[loc];
      if (v == null || !(v > 0) || !Number.isFinite(v)) continue;
      const p = item.prices?.[loc];
      if (!p) continue;
      const bm = loc === 'Black Market';
      const instant = !orders || bm;
      const raw = instant ? p.buy : p.sell;
      if (raw == null || !(raw > 0) || !Number.isFinite(raw)) continue;
      const age = ageOf(instant ? p.buyAt : p.sellAt);
      if (!(age < maxAge)) continue;
      const price = instant ? raw : raw - 1;
      if (!(price > 0)) continue;
      sPrice[j] = price;
      sNet[j] = unitRevenue(price, settings, bm);
      sAge[j] = age;
      sVol[j] = v;
      anySell = true;
    }
    if (!anySell) continue;

    const weight = metaWeight(metaById?.get(item.id));
    let best: TransportRow | null = null;
    for (let i = 0; i < nBuy; i++) {
      const buyPrice = bPrice[i];
      if (!(buyPrice > 0)) continue;
      const a = TRANSPORT_BUY_LOCATIONS[i];
      for (let j = 0; j < nSell; j++) {
        if (!(sPrice[j] > 0)) continue;
        const b = TRANSPORT_SELL_LOCATIONS[j];
        if (a === b) continue;
        const unitProfit = sNet[j] - buyPrice;
        if (!(unitProfit > 0)) continue;
        const sellablePerDay = liquidity(sVol[j], settings);
        const dailyProfit = unitProfit * sellablePerDay;
        if (!opts.allPairs && best && !(dailyProfit > best.dailyProfit || (dailyProfit === best.dailyProfit && unitProfit > best.unitProfit))) continue;
        const flags: TransportFlag[] = [];
        if (isRed(a) || isRed(b)) flags.push('red-zone');
        if (a === 'Brecilien' || b === 'Brecilien') flags.push('mists');
        if (isSuspect(sPrice[j], item, b) || isSuspectLow(buyPrice, item, a) || isImplausibleProfit(unitProfit, buyPrice))
          flags.push('suspect');
        const oldestAgeH = Math.max(bAge[i], sAge[j]);
        if (!(oldestAgeH < staleAt)) flags.push('stale');
        const row: TransportRow = {
          itemId: item.id,
          buyAt: a,
          buyPrice,
          buyAgeH: bAge[i],
          sellAt: b,
          sellPrice: sPrice[j],
          sellAgeH: sAge[j],
          sellNet: sNet[j],
          unitProfit,
          margin: unitProfit / buyPrice,
          weight,
          profitPerKg: weight ? unitProfit / weight : null,
          volume: sVol[j],
          sellablePerDay,
          dailyProfit,
          oldestAgeH,
          flags,
        };
        if (opts.allPairs) rows.push(row);
        else best = row;
      }
    }
    if (!opts.allPairs && best) rows.push(best);
  }
  rows.sort((x, y) => y.dailyProfit - x.dailyProfit || y.unitProfit - x.unitProfit);
  return { rows, evaluated };
}

// ---------------------------------------------------------------------------
// Filtres d'affichage (purs, testables).

export interface TransportFilters {
  from: Location | '';
  to: Location | '';
  excludeRedZone: boolean;
  hideSuspect: boolean;
  /** Budget maximal ; null = pas de limite. */
  budget: number | null;
  budgetMode: 'unit' | 'total';
  minUnitProfit: number | null;
  /** Charge maximale de la monture (kg) ; null = non renseignée. */
  maxLoadKg: number | null;
  search: string;
}

export const EMPTY_TRANSPORT_FILTERS: TransportFilters = {
  from: '',
  to: '',
  excludeRedZone: false,
  hideSuspect: true,
  budget: null,
  budgetMode: 'unit',
  minUnitProfit: null,
  maxLoadKg: null,
  search: '',
};

export interface TransportView extends TransportRow {
  /** Quantité effectivement achetable/vendable par jour (plafonnée par le budget total). */
  dayQty: number;
  /** Profit/jour après plafond de budget. */
  dayProfit: number;
  /** Quantité par trajet = min(vendable/jour, ⌊charge / poids⌋, budget) ; null si charge ou poids inconnu. */
  tripQty: number | null;
  tripProfit: number | null;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Applique les filtres et calcule profit/trajet ; retrie par profit/jour effectif. */
export function applyTransportFilters(
  rows: TransportRow[],
  f: TransportFilters,
  metaById?: Map<string, ItemMeta>,
): TransportView[] {
  const q = norm(f.search);
  const out: TransportView[] = [];
  const budget = f.budget != null && f.budget > 0 ? f.budget : null;
  const load = f.maxLoadKg != null && f.maxLoadKg > 0 ? f.maxLoadKg : null;
  for (const r of rows) {
    if (f.from && r.buyAt !== f.from) continue;
    if (f.to && r.sellAt !== f.to) continue;
    if (f.excludeRedZone && r.flags.includes('red-zone')) continue;
    if (f.hideSuspect && r.flags.includes('suspect')) continue;
    if (f.minUnitProfit != null && r.unitProfit < f.minUnitProfit) continue;
    if (budget != null && r.buyPrice > budget) continue;
    if (q) {
      const m = metaById?.get(r.itemId);
      const hay = norm(`${m?.nameFr ?? ''} ${m?.nameEn ?? ''} ${r.itemId}`);
      if (!hay.includes(q)) continue;
    }
    let dayQty = r.sellablePerDay;
    if (budget != null && f.budgetMode === 'total') dayQty = Math.min(dayQty, Math.floor(budget / r.buyPrice));
    let tripQty: number | null = null;
    if (load != null && r.weight != null) tripQty = Math.max(0, Math.min(Math.floor(dayQty), Math.floor(load / r.weight)));
    out.push({
      ...r,
      dayQty,
      dayProfit: dayQty * r.unitProfit,
      tripQty,
      tripProfit: tripQty == null ? null : tripQty * r.unitProfit,
    });
  }
  out.sort((x, y) => y.dayProfit - x.dayProfit || y.unitProfit - x.unitProfit);
  return out;
}
