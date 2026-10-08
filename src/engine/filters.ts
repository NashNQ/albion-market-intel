// Filtres et confiance — fonctions pures.
import type { Location, MarketItem, Settings } from '../types';

export const SUSPECT_RATIO = 3;
export const THIN_HISTORY_DAYS = 5;

/** Confiance C selon l'âge (h) du prix le plus vieux utilisé. */
export function confidence(oldestAgeH: number, maxPriceAgeH: number): number {
  if (oldestAgeH <= 1) return 1;
  const span = maxPriceAgeH - 1;
  const c = span > 0 ? 1 - (0.5 * (oldestAgeH - 1)) / span : 0.5;
  return Math.min(1, Math.max(0.5, c));
}

/** Historique trop mince au lieu de vente (< 5 jours sur 7). */
export function isThinHistory(item: MarketItem, loc: Location): boolean {
  const d = item.historyDays?.[loc];
  return (d ?? 0) < THIN_HISTORY_DAYS;
}

/** Prix de vente suspect : > 3 × moyenne 7 j (si connue). */
export function isSuspect(sellPrice: number, item: MarketItem, loc: Location): boolean {
  const avg = item.avgPrice7d?.[loc];
  return avg != null && avg > 0 && sellPrice > SUSPECT_RATIO * avg;
}

/** Prix d'achat anormalement bas (< 1/3 de la moyenne 7 j) : ordre piège ou erreur de collecte. */
export function isSuspectLow(buyPrice: number, item: MarketItem, loc: Location): boolean {
  const avg = item.avgPrice7d?.[loc];
  return avg != null && avg > 0 && buyPrice * SUSPECT_RATIO < avg;
}

/** Volume 7 j au lieu de vente, ou null si inconnu. */
export function volumeAt(item: MarketItem, loc: Location): number | null {
  const v = item.volume7d?.[loc];
  return v == null || !Number.isFinite(v) ? null : v;
}

/** Volume suffisant ? */
export function hasEnoughVolume(volume: number | null, settings: Pick<Settings, 'minVolume'>): boolean {
  // Volume nul = aucune vente observée : jamais retenu, même avec minVolume = 0.
  return volume != null && volume > 0 && volume >= settings.minVolume;
}

/** Quantité écoulable par jour Q = min(volume × part de marché, plafond). */
export function liquidity(volume: number, settings: Pick<Settings, 'marketShare' | 'dailyCap'>): number {
  return Math.min(volume * settings.marketShare, settings.dailyCap);
}
