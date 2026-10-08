// Prix, coûts et revenus — fonctions pures.
import type { PricePoint, Recipe, Settings } from '../types';

export const STATION_FEE_FACTOR = 0.1125;
export const ORDER_FEE = 0.025;
export const TAX_PREMIUM = 0.04;
export const TAX_STANDARD = 0.08;

export interface PriceQuote {
  price: number;
  ageH: number;
}

const MS_PER_H = 3_600_000;

/** Âge en heures d'un horodatage ISO par rapport à `now` (Infinity si absent/illisible). */
export function priceAgeH(at: string | null | undefined, now: Date): number {
  if (!at) return Infinity;
  const t = Date.parse(at);
  if (Number.isNaN(t)) return Infinity;
  return Math.max(0, (now.getTime() - t) / MS_PER_H);
}

/** Prix valide : non null, > 0, et âge < maxPriceAgeH. */
export function validQuote(
  price: number | null | undefined,
  at: string | null | undefined,
  now: Date,
  maxPriceAgeH: number,
): PriceQuote | null {
  if (price == null || !(price > 0) || !Number.isFinite(price)) return null;
  const ageH = priceAgeH(at, now);
  if (!(ageH < maxPriceAgeH)) return null;
  return { price, ageH };
}

/** Prix d'achat unitaire dans un lieu selon le mode. */
export function buyQuote(
  p: PricePoint | undefined,
  mode: Settings['mode'],
  now: Date,
  maxPriceAgeH: number,
): PriceQuote | null {
  if (!p) return null;
  if (mode === 'instant') return validQuote(p.sell, p.sellAt, now, maxPriceAgeH);
  const q = validQuote(p.buy, p.buyAt, now, maxPriceAgeH);
  return q ? { price: (q.price + 1) * (1 + ORDER_FEE), ageH: q.ageH } : null;
}

/** Prix de vente brut dans un lieu selon le mode. `forceInstant` pour le Black Market (pas d'ordre de vente). */
export function sellQuote(
  p: PricePoint | undefined,
  mode: Settings['mode'],
  now: Date,
  maxPriceAgeH: number,
  forceInstant = false,
): PriceQuote | null {
  if (!p) return null;
  if (mode === 'instant' || forceInstant) return validQuote(p.buy, p.buyAt, now, maxPriceAgeH);
  const q = validQuote(p.sell, p.sellAt, now, maxPriceAgeH);
  if (!q || q.price - 1 <= 0) return null;
  return { price: q.price - 1, ageH: q.ageH };
}

/** Frais de station pour une fabrication. */
export function stationFee(itemValue: number, stationFeePer100: number): number {
  return (itemValue * STATION_FEE_FACTOR * stationFeePer100) / 100;
}

/**
 * Coût par unité produite.
 * @param buyPrices prix d'achat unitaire de chaque ingrédient, dans l'ordre de recipe.inputs.
 */
export function unitCost(
  recipe: Pick<Recipe, 'inputs' | 'outputQty' | 'itemValue'>,
  buyPrices: number[],
  rrrValue: number,
  settings: Pick<Settings, 'stationFee'>,
): number {
  let total = 0;
  for (let i = 0; i < recipe.inputs.length; i++) {
    const inp = recipe.inputs[i];
    total += inp.qty * buyPrices[i] * (inp.returnable ? 1 - rrrValue : 1);
  }
  total += stationFee(recipe.itemValue, settings.stationFee);
  return total / (recipe.outputQty > 0 ? recipe.outputQty : 1);
}

/** Taux total prélevé à la vente (taxe + frais d'ordre). */
export function saleDeduction(settings: Pick<Settings, 'premium' | 'mode'>, forceInstant = false): number {
  const tax = settings.premium ? TAX_PREMIUM : TAX_STANDARD;
  const orderFee = settings.mode === 'orders' && !forceInstant ? ORDER_FEE : 0;
  return tax + orderFee;
}

/** Revenu net par unité vendue. */
export function unitRevenue(
  sellPrice: number,
  settings: Pick<Settings, 'premium' | 'mode'>,
  forceInstant = false,
): number {
  return sellPrice * (1 - saleDeduction(settings, forceInstant));
}
