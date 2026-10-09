// Historique et prix en direct d'un objet, interrogés depuis le navigateur sur l'API AODP (Europe).
// Cache sessionStorage (15 min, par objet), annulation par AbortController, 429 et erreurs réseau typés.
import { useCallback, useEffect, useRef, useState } from 'react';
import { LOCATIONS, type Location } from '../../types';
import { aggregateDaily, type DailyPoint, type RawPoint } from '../../engine/history-metrics';

export const AODP_BASE = 'https://europe.albion-online-data.com/api/v2/stats';
export const HISTORY_TTL_MS = 15 * 60_000;
export const HISTORY_CACHE_PREFIX = 'ami.hist.v1:';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type ApiErrorKind = 'rate-limit' | 'http' | 'network' | 'parse';
export class ApiError extends Error {
  constructor(
    public kind: ApiErrorKind,
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Message joueur pour une erreur d'API. */
export function apiErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.kind === 'rate-limit') return 'API saturée, réessayez dans une minute.';
    if (e.kind === 'network') return 'Impossible de joindre l’API Albion Online Data (réseau indisponible ou bloqué).';
    if (e.kind === 'parse') return 'Réponse de l’API illisible.';
    return `L’API a répondu par une erreur (code ${e.status ?? '?'}).`;
  }
  return 'Erreur inattendue lors de l’interrogation de l’API.';
}

const isLocation = (s: unknown): s is Location => typeof s === 'string' && (LOCATIONS as readonly string[]).includes(s);

/** Les dates AODP sont en UTC sans suffixe : on ajoute « Z » si aucun fuseau n'est donné. */
export function parseApiDate(s: unknown): number | null {
  if (typeof s !== 'string' || s === '' || s.startsWith('0001-01-01')) return null;
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

export const historyUrl = (id: string, timeScale: 6 | 24 = 6): string =>
  `${AODP_BASE}/history/${encodeURIComponent(id)}.json?time-scale=${timeScale}&qualities=1&locations=${LOCATIONS.map(encodeURIComponent).join(',')}`;

export const pricesUrl = (id: string): string => `${AODP_BASE}/prices/${encodeURIComponent(id)}.json?qualities=1`;

async function getJson(url: string, fetchImpl: FetchLike, signal?: AbortSignal): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, { signal });
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') throw e;
    throw new ApiError('network', String((e as Error)?.message ?? e));
  }
  if (res.status === 429) throw new ApiError('rate-limit', 'HTTP 429', 429);
  if (!res.ok) throw new ApiError('http', `HTTP ${res.status}`, res.status);
  try {
    return await res.json();
  } catch {
    throw new ApiError('parse', 'JSON invalide');
  }
}

// ---------------------------------------------------------------------------
// Historique

export type HistoryByLoc = Partial<Record<Location, DailyPoint[]>>;

/** Parse la réponse brute de /stats/history : agrégation journalière par lieu (qualité 1). */
export function parseHistory(raw: unknown): HistoryByLoc {
  if (!Array.isArray(raw)) throw new ApiError('parse', 'tableau attendu');
  const pts = new Map<Location, RawPoint[]>();
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue;
    const r = s as { location?: unknown; quality?: unknown; data?: unknown };
    if (!isLocation(r.location) || (r.quality != null && r.quality !== 1) || !Array.isArray(r.data)) continue;
    const list = pts.get(r.location) ?? [];
    for (const d of r.data as { avg_price?: unknown; item_count?: unknown; timestamp?: unknown }[]) {
      const t = parseApiDate(d?.timestamp);
      if (t == null || typeof d.avg_price !== 'number') continue;
      list.push({ t, avgPrice: d.avg_price, count: typeof d.item_count === 'number' ? d.item_count : 0 });
    }
    pts.set(r.location, list);
  }
  const out: HistoryByLoc = {};
  for (const [loc, list] of pts) {
    const daily = aggregateDaily(list);
    if (daily.length) out[loc] = daily;
  }
  return out;
}

const isDailyPoint = (d: unknown): boolean => {
  const p = d as DailyPoint | null;
  return !!p && typeof p === 'object' && Number.isFinite(p.day) && Number.isFinite(p.price) && Number.isFinite(p.volume);
};

/** Entrée de cache bien formée (une valeur corrompue ou d'un ancien format ferait planter la fiche). */
export function isHistoryByLoc(v: unknown): v is HistoryByLoc {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  for (const [k, days] of Object.entries(v)) {
    if (!isLocation(k) || !Array.isArray(days) || !days.every(isDailyPoint)) return false;
  }
  return true;
}

interface CacheEntry {
  at: number;
  data: HistoryByLoc;
}

function readCache(id: string, nowMs: number): HistoryByLoc | null {
  try {
    const txt = window.sessionStorage.getItem(HISTORY_CACHE_PREFIX + id);
    if (!txt) return null;
    const e = JSON.parse(txt) as CacheEntry;
    if (!e || typeof e.at !== 'number' || nowMs - e.at > HISTORY_TTL_MS || nowMs < e.at) return null;
    return isHistoryByLoc(e.data) ? e.data : null;
  } catch {
    return null;
  }
}

function writeCache(id: string, data: HistoryByLoc, nowMs: number): void {
  try {
    window.sessionStorage.setItem(HISTORY_CACHE_PREFIX + id, JSON.stringify({ at: nowMs, data } satisfies CacheEntry));
  } catch {
    /* stockage indisponible ou plein : pas de cache */
  }
}

export interface FetchOpts {
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
  now?: () => number;
  /** Ignore le cache (forcer l'actualisation). */
  force?: boolean;
}

/** Historique 30 jours (pas de 6 h) agrégé en jours, avec cache sessionStorage de 15 min. */
export async function fetchHistory(id: string, opts: FetchOpts = {}): Promise<HistoryByLoc> {
  const now = opts.now ?? Date.now;
  if (!opts.force) {
    const hit = readCache(id, now());
    if (hit) return hit;
  }
  const raw = await getJson(historyUrl(id), opts.fetchImpl ?? ((u, i) => fetch(u, i)), opts.signal);
  const data = parseHistory(raw);
  writeCache(id, data, now());
  return data;
}

// ---------------------------------------------------------------------------
// Prix en direct

export interface LivePrice {
  sell: number | null;
  sellAt: number | null;
  buy: number | null;
  buyAt: number | null;
}
export type LivePrices = Partial<Record<Location, LivePrice>>;

/** Parse /stats/prices : prix 0 ou date 0001-01-01 = absent. */
export function parsePrices(raw: unknown): LivePrices {
  if (!Array.isArray(raw)) throw new ApiError('parse', 'tableau attendu');
  const out: LivePrices = {};
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || !isLocation(r.city) || (r.quality != null && r.quality !== 1)) continue;
    const sellAt = parseApiDate(r.sell_price_min_date);
    const buyAt = parseApiDate(r.buy_price_max_date);
    const sellOk = typeof r.sell_price_min === 'number' && r.sell_price_min > 0 && sellAt != null;
    const buyOk = typeof r.buy_price_max === 'number' && r.buy_price_max > 0 && buyAt != null;
    out[r.city] = {
      sell: sellOk ? (r.sell_price_min as number) : null,
      sellAt: sellOk ? sellAt : null,
      buy: buyOk ? (r.buy_price_max as number) : null,
      buyAt: buyOk ? buyAt : null,
    };
  }
  return out;
}

/** Prix actuels de toutes les villes, sans cache (requête au clic uniquement). */
export async function fetchLivePrices(id: string, opts: FetchOpts = {}): Promise<LivePrices> {
  const raw = await getJson(pricesUrl(id), opts.fetchImpl ?? ((u, i) => fetch(u, i)), opts.signal);
  return parsePrices(raw);
}

// ---------------------------------------------------------------------------
// Hooks

export type Loadable<T> =
  | { state: 'idle' }
  | { state: 'loading'; prev?: T }
  | { state: 'ok'; data: T; at: number }
  | { state: 'error'; message: string; rateLimited: boolean; prev?: T };

const toError = <T,>(e: unknown, prev?: T): Loadable<T> => ({
  state: 'error',
  message: apiErrorMessage(e),
  rateLimited: e instanceof ApiError && e.kind === 'rate-limit',
  prev,
});

const isAbort = (e: unknown) => (e as { name?: string })?.name === 'AbortError';

/** Historique de l'objet : requête à l'ouverture de la fiche, annulée au démontage. */
export function useItemHistory(id: string, fetchImpl?: FetchLike): [Loadable<HistoryByLoc>, () => void] {
  // L'état mémorise l'objet auquel il se rapporte : en changeant de fiche, l'historique de l'objet
  // précédent n'est jamais rendu, même le temps d'un affichage (l'effet ne s'exécute qu'après).
  const [st, setSt] = useState<{ id: string; v: Loadable<HistoryByLoc> }>({ id, v: { state: 'loading' } });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const ac = new AbortController();
    setSt({ id, v: { state: 'loading' } });
    fetchHistory(id, { fetchImpl, signal: ac.signal }).then(
      (data) => {
        if (!ac.signal.aborted) setSt({ id, v: { state: 'ok', data, at: Date.now() } });
      },
      (e) => {
        if (!ac.signal.aborted && !isAbort(e)) setSt({ id, v: toError(e) });
      },
    );
    return () => ac.abort();
  }, [id, fetchImpl, nonce]);
  return [st.id === id ? st.v : { state: 'loading' }, useCallback(() => setNonce((n) => n + 1), [])];
}

/** Prix en direct : rien tant que le joueur n'a pas cliqué sur « Actualiser les prix ». */
export function useLivePrices(id: string, fetchImpl?: FetchLike): [Loadable<LivePrices>, () => void] {
  const [st, setSt] = useState<{ id: string; v: Loadable<LivePrices> }>({ id, v: { state: 'idle' } });
  const acRef = useRef<AbortController | null>(null);
  const lastRef = useRef<LivePrices | undefined>(undefined);

  useEffect(() => {
    setSt({ id, v: { state: 'idle' } });
    lastRef.current = undefined;
    return () => acRef.current?.abort();
  }, [id]);

  const refresh = useCallback(() => {
    acRef.current?.abort();
    const ac = new AbortController();
    acRef.current = ac;
    setSt({ id, v: { state: 'loading', prev: lastRef.current } });
    fetchLivePrices(id, { fetchImpl, signal: ac.signal }).then(
      (data) => {
        if (ac.signal.aborted) return;
        lastRef.current = data;
        setSt({ id, v: { state: 'ok', data, at: Date.now() } });
      },
      (e) => {
        if (!ac.signal.aborted && !isAbort(e)) setSt({ id, v: toError(e, lastRef.current) });
      },
    );
  }, [id, fetchImpl]);

  // Prix en direct d'un autre objet (fiche précédente) : jamais affichés.
  return [st.id === id ? st.v : { state: 'idle' }, refresh];
}
