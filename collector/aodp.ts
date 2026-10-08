// Client AODP (Albion Online Data Project) — serveur Europe.
// Limiteur de débit à fenêtres glissantes, retry exponentiel, découpage en lots, normalisation.
import { LOCATIONS, type Location, type PricePoint } from '../src/types';

export const AODP_BASE = 'https://europe.albion-online-data.com';
export const USER_AGENT = 'albion-market-intel (+https://github.com)';
export const MAX_URL_LENGTH = 4000;
export const HISTORY_BATCH_SIZE = 60;

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export type Clock = () => number;
export type Sleep = (ms: number) => Promise<void>;

export const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export interface RateWindow {
  limit: number;
  windowMs: number;
}

/** Plafonds internes (officiel : 180/min et 300/5 min). */
export const DEFAULT_WINDOWS: RateWindow[] = [
  { limit: 150, windowMs: 60_000 },
  { limit: 250, windowMs: 300_000 },
];

/**
 * Limiteur à fenêtres glissantes : avant chaque requête, attend jusqu'à ce que
 * toutes les fenêtres aient de la place. Horloge et sommeil injectables (tests).
 */
export class RateLimiter {
  /** Horodatages de toutes les requêtes émises (pour les stats). */
  readonly history: number[] = [];
  private readonly maxWindow: number;

  constructor(
    private readonly windows: RateWindow[] = DEFAULT_WINDOWS,
    private readonly now: Clock = Date.now,
    private readonly sleep: Sleep = realSleep,
  ) {
    this.maxWindow = Math.max(...windows.map((w) => w.windowMs));
  }

  async acquire(): Promise<void> {
    for (;;) {
      const t = this.now();
      let waitMs = 0;
      for (const w of this.windows) {
        // Requêtes encore dans la fenêtre : t - ts < windowMs
        const inWindow = this.history.filter((ts) => t - ts < w.windowMs);
        if (inWindow.length >= w.limit) {
          // La plus ancienne qui doit sortir pour libérer une place
          const oldest = inWindow[inWindow.length - w.limit];
          waitMs = Math.max(waitMs, oldest + w.windowMs - t);
        }
      }
      if (waitMs <= 0) {
        this.history.push(t);
        this.prune(t);
        return;
      }
      await this.sleep(waitMs);
    }
  }

  private prune(t: number): void {
    // On garde tout pour les stats si l'historique est raisonnable ; sinon on coupe.
    if (this.history.length > 100_000) {
      const keep = this.history.filter((ts) => t - ts < this.maxWindow);
      this.history.length = 0;
      this.history.push(...keep);
    }
  }

  /** Nombre maximal de requêtes observé sur une fenêtre glissante de `windowMs`. */
  maxObserved(windowMs = 60_000): number {
    let max = 0;
    let lo = 0;
    for (let hi = 0; hi < this.history.length; hi++) {
      while (this.history[hi] - this.history[lo] >= windowMs) lo++;
      max = Math.max(max, hi - lo + 1);
    }
    return max;
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} pour ${url}`);
  }
}

export interface ClientOptions {
  fetch?: FetchLike;
  baseUrl?: string;
  limiter?: RateLimiter;
  now?: Clock;
  sleep?: Sleep;
  maxAttempts?: number;
  log?: (msg: string) => void;
}

/** Attente avant l'essai n+1 (n = 1 après le premier échec) : 2 s, 4 s, 8 s… plafonné à 60 s. */
export function backoffMs(failedAttempt: number): number {
  return Math.min(60_000, 2000 * 2 ** (failedAttempt - 1));
}

export class AodpClient {
  readonly fetchImpl: FetchLike;
  readonly baseUrl: string;
  readonly limiter: RateLimiter;
  readonly now: Clock;
  readonly sleep: Sleep;
  readonly maxAttempts: number;
  readonly log: (msg: string) => void;
  requests = 0;
  retries = 0;

  constructor(opts: ClientOptions = {}) {
    this.fetchImpl = opts.fetch ?? ((url, init) => fetch(url, init));
    this.baseUrl = opts.baseUrl ?? AODP_BASE;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? realSleep;
    this.limiter = opts.limiter ?? new RateLimiter(DEFAULT_WINDOWS, this.now, this.sleep);
    this.maxAttempts = opts.maxAttempts ?? 4;
    this.log = opts.log ?? ((m) => console.log(m));
  }

  /** GET JSON avec limiteur + retry (429, 5xx, erreur réseau). Les autres 4xx échouent aussitôt. */
  async getJson<T>(url: string): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      await this.limiter.acquire();
      this.requests++;
      let retryable = true;
      try {
        const res = await this.fetchImpl(url, {
          headers: { 'Accept-Encoding': 'gzip', 'User-Agent': USER_AGENT, Accept: 'application/json' },
        });
        if (res.ok) return (await res.json()) as T;
        lastErr = new HttpError(res.status, url);
        retryable = res.status === 429 || res.status >= 500;
      } catch (e) {
        lastErr = e; // erreur réseau (ou JSON invalide) : on retente
      }
      if (!retryable || attempt === this.maxAttempts) break;
      const wait = backoffMs(attempt);
      this.retries++;
      this.log(`  retry ${attempt}/${this.maxAttempts - 1} dans ${wait / 1000}s : ${String((lastErr as Error)?.message ?? lastErr)}`);
      await this.sleep(wait);
    }
    throw lastErr;
  }

  stats() {
    return { requests: this.requests, retries: this.retries, maxPerMinute: this.limiter.maxObserved(60_000) };
  }
}

// ---------- Construction des URL et découpage en lots ----------

export function locationsQuery(): string {
  return LOCATIONS.map((l) => encodeURIComponent(l)).join(',');
}

export function pricesUrl(ids: string[], baseUrl = AODP_BASE): string {
  return `${baseUrl}/api/v2/stats/prices/${ids.join(',')}.json?locations=${locationsQuery()}&qualities=1`;
}

export function historyUrl(ids: string[], date: string, baseUrl = AODP_BASE): string {
  return `${baseUrl}/api/v2/stats/history/${ids.join(',')}.json?time-scale=24&locations=${locationsQuery()}&qualities=1&date=${date}`;
}

/**
 * Découpe glouton : ajoute des ID tant que l'URL produite reste ≤ maxLen et que le lot
 * ne dépasse pas maxIds. Un ID seul trop long forme un lot à lui seul (cas dégénéré).
 */
export function makeBatches(
  ids: string[],
  buildUrl: (batch: string[]) => string,
  maxLen = MAX_URL_LENGTH,
  maxIds = Infinity,
): string[][] {
  const batches: string[][] = [];
  let cur: string[] = [];
  for (const id of ids) {
    const candidate = [...cur, id];
    if (cur.length > 0 && (candidate.length > maxIds || buildUrl(candidate).length > maxLen)) {
      batches.push(cur);
      cur = [id];
    } else {
      cur = candidate;
    }
  }
  if (cur.length) batches.push(cur);
  return batches;
}

export function priceBatches(ids: string[], baseUrl = AODP_BASE, maxLen = MAX_URL_LENGTH): string[][] {
  return makeBatches(ids, (b) => pricesUrl(b, baseUrl), maxLen);
}

export function historyBatches(ids: string[], date: string, baseUrl = AODP_BASE, maxLen = MAX_URL_LENGTH): string[][] {
  return makeBatches(ids, (b) => historyUrl(b, date, baseUrl), maxLen, HISTORY_BATCH_SIZE);
}

// ---------- Normalisation ----------

const LOCATION_SET = new Set<string>(LOCATIONS);
const LOCATION_CODES: Record<string, Location> = {
  '3005': 'Caerleon',
  '3013-Auction2': 'Caerleon',
  '5003': 'Brecilien',
};

/** Nom ou code AODP → Location ; null si inconnu (à ignorer). */
export function mapLocation(raw: string): Location | null {
  if (raw in LOCATION_CODES) return LOCATION_CODES[raw];
  return LOCATION_SET.has(raw) ? (raw as Location) : null;
}

/** "2026-10-08T07:45:00" (UTC sans Z) → "2026-10-08T07:45:00.000Z" ; 0001-01-01 / vide → null. */
export function normDate(d: string | null | undefined): string | null {
  if (!d || d.startsWith('0001-01-01')) return null;
  const hasTz = /(Z|[+-]\d\d:?\d\d)$/.test(d);
  const t = Date.parse(hasTz ? d : `${d}Z`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Prix 0 ou date nulle → { value: null, at: null }. */
export function normPrice(price: number | null | undefined, date: string | null | undefined): { value: number | null; at: string | null } {
  const at = normDate(date);
  if (!price || price <= 0 || at === null) return { value: null, at: null };
  return { value: price, at };
}

export interface RawPriceRow {
  item_id: string;
  city: string;
  quality: number;
  sell_price_min: number;
  sell_price_min_date: string;
  sell_price_max: number;
  sell_price_max_date: string;
  buy_price_min: number;
  buy_price_min_date: string;
  buy_price_max: number;
  buy_price_max_date: string;
}

export type ItemPrices = Partial<Record<Location, PricePoint>>;

function newer(a: string | null, b: string | null): boolean {
  return a !== null && (b === null || a > b);
}

/** Lignes brutes → prix normalisés par item et lieu (qualité 1 uniquement). */
export function parsePrices(rows: RawPriceRow[]): Map<string, ItemPrices> {
  const out = new Map<string, ItemPrices>();
  for (const r of rows) {
    if (r.quality !== 1) continue;
    const loc = mapLocation(r.city);
    if (!loc) continue;
    const sell = normPrice(r.sell_price_min, r.sell_price_min_date);
    const buy = normPrice(r.buy_price_max, r.buy_price_max_date);
    const p: PricePoint = { sell: sell.value, sellAt: sell.at, buy: buy.value, buyAt: buy.at };
    const item = out.get(r.item_id) ?? {};
    const prev = item[loc];
    if (!prev) {
      item[loc] = p;
    } else {
      // Doublon (ex. code de lieu + nom) : on garde, champ par champ, l'observation la plus récente.
      if (newer(p.sellAt, prev.sellAt)) {
        prev.sell = p.sell;
        prev.sellAt = p.sellAt;
      }
      if (newer(p.buyAt, prev.buyAt)) {
        prev.buy = p.buy;
        prev.buyAt = p.buyAt;
      }
    }
    out.set(r.item_id, item);
  }
  return out;
}

export interface RawHistoryRow {
  location: string;
  item_id: string;
  quality: number;
  data: { item_count: number; avg_price: number; timestamp: string }[];
}

export interface ItemVolumes {
  volume7d: Partial<Record<Location, number | null>>;
  avgPrice7d: Partial<Record<Location, number | null>>;
  historyDays: Partial<Record<Location, number>>;
}

export function utcDay(ms: number, offsetDays = 0): string {
  const d = new Date(ms);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Historique → volumes. Fenêtre = 7 derniers jours COMPLETS (J-7..J-1 UTC).
 * volume7d = médiane des item_count (jour absent = 0) ; avgPrice7d = moyenne des avg_price
 * des jours présents ; historyDays = nb de jours présents.
 * Si plusieurs marchés renvoient au même lieu (ex. 3005 et 3013-Auction2), les comptes d'un
 * même jour sont additionnés et le prix moyen pondéré par les volumes.
 */
export function computeVolumes(rows: RawHistoryRow[], nowMs: number): Map<string, ItemVolumes> {
  const days: string[] = [];
  for (let k = -7; k <= -1; k++) days.push(utcDay(nowMs, k));
  const daySet = new Set(days);

  // item -> lieu -> jour -> {count, weighted}
  const agg = new Map<string, Map<Location, Map<string, { count: number; priceSum: number; priceWeight: number; n: number; plain: number }>>>();
  for (const r of rows) {
    if (r.quality !== undefined && r.quality !== 1) continue;
    const loc = mapLocation(r.location);
    if (!loc) continue;
    const byLoc = agg.get(r.item_id) ?? new Map();
    agg.set(r.item_id, byLoc);
    const byDay = byLoc.get(loc) ?? new Map();
    byLoc.set(loc, byDay);
    for (const d of r.data ?? []) {
      const day = (d.timestamp ?? '').slice(0, 10);
      if (!daySet.has(day)) continue;
      const cell = byDay.get(day) ?? { count: 0, priceSum: 0, priceWeight: 0, n: 0, plain: 0 };
      cell.count += d.item_count || 0;
      cell.priceSum += (d.avg_price || 0) * (d.item_count || 0);
      cell.priceWeight += d.item_count || 0;
      cell.plain += d.avg_price || 0;
      cell.n++;
      byDay.set(day, cell);
    }
  }

  const out = new Map<string, ItemVolumes>();
  for (const [id, byLoc] of agg) {
    const v: ItemVolumes = { volume7d: {}, avgPrice7d: {}, historyDays: {} };
    for (const [loc, byDay] of byLoc) {
      const counts = days.map((d) => byDay.get(d)?.count ?? 0);
      const prices = [...byDay.values()]
        .map((c) => (c.priceWeight > 0 ? c.priceSum / c.priceWeight : c.plain / c.n))
        .filter((p) => p > 0);
      v.volume7d[loc] = median(counts);
      v.avgPrice7d[loc] = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null;
      v.historyDays[loc] = byDay.size;
    }
    out.set(id, v);
  }
  return out;
}

// ---------- Collecte par lots ----------

export interface BatchRun<T> {
  results: T[];
  okBatches: number;
  totalBatches: number;
  failedIds: string[];
}

export async function runBatches<T>(
  client: AodpClient,
  batches: string[][],
  urlFor: (batch: string[]) => string,
): Promise<BatchRun<T>> {
  const results: T[] = [];
  const failedIds: string[] = [];
  let ok = 0;
  for (let i = 0; i < batches.length; i++) {
    const b = batches[i];
    try {
      const rows = await client.getJson<T[]>(urlFor(b));
      if (!Array.isArray(rows)) throw new Error('réponse non tableau');
      results.push(...rows);
      ok++;
    } catch (e) {
      failedIds.push(...b);
      client.log(`  lot ${i + 1}/${batches.length} en échec (${b.length} ID) : ${String((e as Error)?.message ?? e)}`);
    }
  }
  return { results, okBatches: ok, totalBatches: batches.length, failedIds };
}

export const MIN_SUCCESS_RATIO = 0.9;

export function successRatioOk(ok: number, total: number, min = MIN_SUCCESS_RATIO): boolean {
  if (total === 0) return true;
  return ok / total >= min;
}
