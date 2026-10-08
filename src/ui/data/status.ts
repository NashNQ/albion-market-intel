import type { DataStatus } from '../../types';

export type MarketStatus = DataStatus | 'loading' | 'empty';

/** Seuil au-delà duquel une copie est considérée comme périmée (minutes). */
export const STALE_AFTER_MIN = 30;

/**
 * Statut des données marché (fonction pure).
 * - copie en mémoire + dernier fetch en échec → 'error'
 * - copie en mémoire → 'fresh' (< 30 min) ou 'stale'
 * - pas de copie : 404 → 'empty', échec réseau → 'error', sinon 'loading'
 */
export function computeStatus(
  updatedAt: Date | null,
  now: Date,
  lastFetchFailed: boolean,
  hasData: boolean,
  notFound: boolean,
): MarketStatus {
  if (hasData && updatedAt) {
    if (lastFetchFailed) return 'error';
    const ageMin = (now.getTime() - updatedAt.getTime()) / 60_000;
    return ageMin < STALE_AFTER_MIN ? 'fresh' : 'stale';
  }
  if (notFound) return 'empty';
  if (lastFetchFailed) return 'error';
  return 'loading';
}
