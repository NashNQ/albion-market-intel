import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AodpClient,
  RateLimiter,
  backoffMs,
  computeVolumes,
  historyBatches,
  historyUrl,
  mapLocation,
  normDate,
  normPrice,
  parsePrices,
  priceBatches,
  pricesUrl,
  successRatioOk,
  type FetchLike,
  type RawHistoryRow,
  type RawPriceRow,
} from '../collector/aodp';
import { collectIds } from '../collector/ids-perimeter';
import { collectPrices, main as pricesMain, type PricesFile } from '../collector/prices';
import { main as volumesMain, type VolumesFile } from '../collector/volumes';
import { buildSnapshot, mergeStore } from '../collector/store';
import type { MarketSnapshot, RecipesFile } from '../src/types';

const FIX = join(__dirname, 'fixtures');
const recipes: RecipesFile = JSON.parse(readFileSync(join(FIX, 'collector-recipes.json'), 'utf8'));
const priceRows: RawPriceRow[] = JSON.parse(readFileSync(join(FIX, 'collector-prices.json'), 'utf8'));
const historyRows: RawHistoryRow[] = JSON.parse(readFileSync(join(FIX, 'collector-history.json'), 'utf8'));
const NOW = Date.parse('2026-10-08T08:00:00Z');

/** Fausse horloge : sleep avance le temps instantanément. */
function fakeClock(start = NOW) {
  let t = start;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
    sleeps,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function idsFromUrl(url: string): string[] {
  const m = /\/stats\/(?:prices|history)\/([^?]+)\.json/.exec(url);
  return m ? decodeURIComponent(m[1]).split(',') : [];
}

/** Faux AODP : renvoie les lignes de fixture des ID demandés. */
function fakeAodp(opts: { failIds?: Set<string> } = {}): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const fetch: FetchLike = async (url) => {
    calls.push(url);
    const ids = idsFromUrl(url);
    if (opts.failIds && ids.some((i) => opts.failIds!.has(i))) return jsonResponse({ error: 'boom' }, 503);
    if (url.includes('/stats/prices/')) return jsonResponse(priceRows.filter((r) => ids.includes(r.item_id)));
    return jsonResponse(historyRows.filter((r) => ids.includes(r.item_id)));
  };
  return { fetch, calls };
}

const silent = () => {};

describe('limiteur de débit', () => {
  it('ne dépasse jamais 150 req / 60 s ni 250 req / 300 s (fausse horloge)', async () => {
    const clk = fakeClock();
    const lim = new RateLimiter(undefined, clk.now, clk.sleep);
    for (let i = 0; i < 700; i++) {
      await lim.acquire();
      if (i % 3 === 0) clk.advance(50); // rafales irrégulières
    }
    const h = lim.history;
    expect(h).toHaveLength(700);
    for (let i = 0; i < h.length; i++) {
      const in60 = h.filter((t) => t >= h[i] && t - h[i] < 60_000).length;
      const in300 = h.filter((t) => t >= h[i] && t - h[i] < 300_000).length;
      expect(in60).toBeLessThanOrEqual(150);
      expect(in300).toBeLessThanOrEqual(250);
    }
    expect(lim.maxObserved(60_000)).toBe(150);
    expect(lim.maxObserved(300_000)).toBe(250);
    // 700 requêtes à 250 / 5 min → au moins 2 fenêtres pleines écoulées
    expect(h[h.length - 1] - h[0]).toBeGreaterThanOrEqual(600_000);
  });
});

describe('découpage des lots', () => {
  const many = Array.from({ length: 2000 }, (_, i) => `T${(i % 8) + 1}_SOME_LONG_ITEM_NAME_${i}@${i % 4}`);

  it('prix : chaque URL ≤ 4000 caractères, tous les ID couverts une fois, ordre conservé', () => {
    const batches = priceBatches(many);
    expect(batches.length).toBeGreaterThan(1);
    for (const b of batches) expect(pricesUrl(b).length).toBeLessThanOrEqual(4000);
    expect(batches.flat()).toEqual(many);
    // Glouton : ajouter l'ID suivant dépasserait la limite
    for (let i = 0; i < batches.length - 1; i++) {
      expect(pricesUrl([...batches[i], batches[i + 1][0]]).length).toBeGreaterThan(4000);
    }
  });

  it('historique : lots de 60 ID max et URL ≤ 4000', () => {
    const short = Array.from({ length: 250 }, (_, i) => `T4_X${i}`);
    const batches = historyBatches(short, '2026-09-30');
    expect(batches.map((b) => b.length)).toEqual([60, 60, 60, 60, 10]);
    for (const b of historyBatches(many, '2026-09-30')) {
      expect(b.length).toBeLessThanOrEqual(60);
      expect(historyUrl(b, '2026-09-30').length).toBeLessThanOrEqual(4000);
    }
  });

  it('URL conformes (lieux encodés, qualité 1, time-scale 24)', () => {
    expect(pricesUrl(['A', 'B'])).toBe(
      'https://europe.albion-online-data.com/api/v2/stats/prices/A,B.json?locations=Bridgewatch,Fort%20Sterling,Lymhurst,Martlock,Thetford,Brecilien,Caerleon,Black%20Market&qualities=1',
    );
    expect(historyUrl(['A'], '2026-09-30')).toContain('time-scale=24&locations=Bridgewatch,Fort%20Sterling');
    expect(historyUrl(['A'], '2026-09-30')).toMatch(/&qualities=1&date=2026-09-30$/);
  });
});

describe('client HTTP : retry', () => {
  it('retente sur 429 avec attente 2 s puis 4 s, puis réussit', async () => {
    const clk = fakeClock();
    let n = 0;
    const fetch: FetchLike = async (_url, init) => {
      n++;
      expect((init?.headers as Record<string, string>)['User-Agent']).toBe('albion-market-intel (+https://github.com)');
      expect((init?.headers as Record<string, string>)['Accept-Encoding']).toBe('gzip');
      return n <= 2 ? jsonResponse({}, 429) : jsonResponse([{ ok: true }]);
    };
    const c = new AodpClient({ fetch, now: clk.now, sleep: clk.sleep, log: silent });
    await expect(c.getJson('https://x/y')).resolves.toEqual([{ ok: true }]);
    expect(n).toBe(3);
    expect(clk.sleeps).toEqual([2000, 4000]);
  });

  it('abandonne après 4 essais (5xx / réseau), pas de retry sur 404', async () => {
    const clk = fakeClock();
    let n = 0;
    const c = new AodpClient({
      fetch: async () => {
        n++;
        if (n % 2) throw new TypeError('fetch failed');
        return jsonResponse({}, 502);
      },
      now: clk.now,
      sleep: clk.sleep,
      log: silent,
    });
    await expect(c.getJson('https://x/y')).rejects.toBeTruthy();
    expect(n).toBe(4);
    expect(clk.sleeps).toEqual([2000, 4000, 8000]);

    let m = 0;
    const c2 = new AodpClient({ fetch: async () => (m++, jsonResponse({}, 404)), now: clk.now, sleep: clk.sleep, log: silent });
    await expect(c2.getJson('https://x/z')).rejects.toThrow('HTTP 404');
    expect(m).toBe(1);
  });

  it('attente exponentielle plafonnée à 60 s', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 10].map(backoffMs)).toEqual([2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
  });
});

describe('normalisation', () => {
  it('0 ou 0001-01-01 → null (prix ET date), dates en ISO Z', () => {
    expect(normDate('2026-10-08T07:45:00')).toBe('2026-10-08T07:45:00.000Z');
    expect(normDate('0001-01-01T00:00:00')).toBeNull();
    expect(normPrice(0, '2026-10-08T07:45:00')).toEqual({ value: null, at: null });
    expect(normPrice(500, '0001-01-01T00:00:00')).toEqual({ value: null, at: null });
    expect(normPrice(994, '2026-10-08T07:45:00')).toEqual({ value: 994, at: '2026-10-08T07:45:00.000Z' });
  });

  it('parsePrices : sell = sell_price_min, buy = buy_price_max, qualité 1, lieux inconnus ignorés', () => {
    const p = parsePrices(priceRows);
    const t5 = p.get('T5_PLANKS')!;
    expect(t5.Martlock).toEqual({ sell: 994, sellAt: '2026-10-08T07:45:00.000Z', buy: null, buyAt: null });
    expect(t5.Caerleon).toEqual({ sell: 1100, sellAt: '2026-10-08T06:00:00.000Z', buy: 950, buyAt: '2026-10-08T06:10:00.000Z' });
    expect(t5['Black Market']).toEqual({ sell: null, sellAt: null, buy: 1400, buyAt: '2026-10-08T07:00:00.000Z' });
    expect(Object.keys(t5).sort()).toEqual(['Black Market', 'Caerleon', 'Martlock']);
    expect(p.get('T4_PLANKS')!.Brecilien?.sell).toBe(340);
  });
});

describe('codes de lieux', () => {
  it('3005 / 3013-Auction2 → Caerleon, 5003 → Brecilien, noms connus conservés, inconnus ignorés', () => {
    expect(mapLocation('3005')).toBe('Caerleon');
    expect(mapLocation('3013-Auction2')).toBe('Caerleon');
    expect(mapLocation('5003')).toBe('Brecilien');
    expect(mapLocation('Fort Sterling')).toBe('Fort Sterling');
    expect(mapLocation('Black Market')).toBe('Black Market');
    expect(mapLocation('9999-Mystery')).toBeNull();
    expect(mapLocation('Arthurs Rest')).toBeNull();
  });
});

describe('volumes 7 jours', () => {
  it('médiane sur J-7..J-1 avec jours manquants = 0, moyenne des prix des jours présents', () => {
    const v = computeVolumes(historyRows, NOW);
    const t4 = v.get('T4_PLANKS')!;
    // Martlock : 01→10, 02→20, 03→0, 04→30, 05→0, 06→40, 07→0 (09-30 et 10-08 exclus)
    expect(t4.volume7d.Martlock).toBe(10);
    expect(t4.historyDays.Martlock).toBe(4);
    expect(t4.avgPrice7d.Martlock).toBe(318); // (300+310+320+340)/4 = 317.5 arrondi
    // Caerleon = 3005 + 3013-Auction2 cumulés sur le 05 : 200 ; médiane 0
    expect(t4.volume7d.Caerleon).toBe(0);
    expect(t4.historyDays.Caerleon).toBe(1);
    expect(t4.avgPrice7d.Caerleon).toBe(365); // pondéré (50×350 + 150×370) / 200
    expect(Object.keys(t4.volume7d).sort()).toEqual(['Caerleon', 'Martlock']);
    const t5 = v.get('T5_PLANKS')!;
    expect(t5.volume7d.Brecilien).toBe(7);
    expect(t5.historyDays.Brecilien).toBe(7);
    expect(t5.avgPrice7d.Brecilien).toBe(1000);
  });

  it('aucun jour présent dans la fenêtre → volume 0, prix null, 0 jour', () => {
    const v = computeVolumes(
      [{ location: 'Lymhurst', item_id: 'X', quality: 1, data: [{ item_count: 5, avg_price: 9, timestamp: '2026-09-01T00:00:00' }] }],
      NOW,
    );
    expect(v.get('X')).toEqual({ volume7d: { Lymhurst: 0 }, avgPrice7d: { Lymhurst: null }, historyDays: { Lymhurst: 0 } });
  });
});

describe('périmètre des ID', () => {
  it('sorties + ingrédients, dédoublonnés et triés', () => {
    expect(collectIds(recipes)).toEqual(['T3_PLANKS', 'T4_BAG', 'T4_CLOTH', 'T4_LEATHER', 'T4_PLANKS', 'T4_WOOD', 'T5_PLANKS', 'T5_WOOD']);
  });
});

describe('règle des 90 %', () => {
  it('seuil', () => {
    expect(successRatioOk(9, 10)).toBe(true);
    expect(successRatioOk(17, 19)).toBe(false); // 89,5 %
    expect(successRatioOk(0, 0)).toBe(true);
  });

  it('cycle prix : < 90 % des lots → ok=false et main() sort en 1 sans écrire', async () => {
    const dir = join(__dirname, '..', 'out-test-90');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'recipes.json'), JSON.stringify(recipes));
    const clk = fakeClock();
    // lots d'un seul ID via baseUrl très long → 8 lots ; on en fait échouer 1 → 87,5 %
    const ids = collectIds(recipes);
    const oneIdMax = Math.max(...ids.map((i) => pricesUrl([i]).length)); // force 1 ID par lot
    const { fetch } = fakeAodp({ failIds: new Set(['T4_CLOTH']) });
    const client = new AodpClient({ fetch, now: clk.now, sleep: clk.sleep, log: silent });
    const res = await collectPrices(ids, client, null, oneIdMax);
    expect(res.file.totalBatches).toBe(8);
    expect(res.file.okBatches).toBe(7);
    expect(res.ok).toBe(false);

    // main() avec URL normales : 1 seul lot qui échoue → 0 %
    const client2 = new AodpClient({ fetch, now: clk.now, sleep: clk.sleep, log: silent });
    const code = await pricesMain(['--out', dir], client2);
    expect(code).toBe(1);
    expect(existsSync(join(dir, 'prices-latest.json'))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('lots en échec au-dessus du seuil : les prix précédents de ces ID sont conservés', async () => {
    const clk = fakeClock();
    const ids = Array.from({ length: 20 }, (_, i) => `ID${String(i).padStart(2, '0')}`);
    const prev = {
      items: { ID00: { Martlock: { sell: 1, sellAt: '2026-10-08T00:00:00.000Z', buy: null, buyAt: null } } },
    } as unknown as PricesFile;
    const { fetch } = fakeAodp({ failIds: new Set(['ID00']) });
    const client = new AodpClient({ fetch, now: clk.now, sleep: clk.sleep, log: silent });
    const res = await collectPrices(ids, client, prev, pricesUrl(['ID00']).length);
    expect(res.ok).toBe(true); // 19/20 = 95 %
    expect(res.file.failedIds).toEqual(['ID00']);
    expect(res.file.items.ID00.Martlock?.sell).toBe(1);
  });
});

describe('fusion MarketSnapshot', () => {
  const prices: PricesFile = {
    startedAt: '2026-10-08T07:59:00.000Z',
    updatedAt: '2026-10-08T08:00:00.000Z',
    okBatches: 1,
    totalBatches: 1,
    failedIds: [],
    items: {
      B: { Martlock: { sell: 10, sellAt: '2026-10-08T07:00:00.000Z', buy: null, buyAt: null } },
      A: {},
    },
  };
  const volumes: VolumesFile = {
    startedAt: '2026-10-08T06:13:00.000Z',
    updatedAt: '2026-10-08T06:14:00.000Z',
    fromDate: '2026-09-30',
    okBatches: 1,
    totalBatches: 1,
    failedIds: [],
    items: { B: { volume7d: { Martlock: 12 }, avgPrice7d: { Martlock: 11 }, historyDays: { Martlock: 5 } } },
  };

  it('buildSnapshot : items triés, volumes joints, horodatages', () => {
    const s = buildSnapshot(prices, volumes);
    expect(s.updatedAt).toBe(prices.updatedAt);
    expect(s.volumesUpdatedAt).toBe(volumes.updatedAt);
    expect(s.items.map((i) => i.id)).toEqual(['A', 'B']);
    expect(s.items[1]).toEqual({
      id: 'B',
      prices: prices.items.B,
      volume7d: { Martlock: 12 },
      avgPrice7d: { Martlock: 11 },
      historyDays: { Martlock: 5 },
    });
    expect(s.items[0]).toEqual({ id: 'A', prices: {}, volume7d: {}, avgPrice7d: {}, historyDays: {} });
    expect(buildSnapshot(prices, null).volumesUpdatedAt).toBeNull();
  });

  it('cycle prix seul : volumes repris de --prev, recettes copiées', () => {
    const root = join(__dirname, '..', 'out-test-merge');
    rmSync(root, { recursive: true, force: true });
    const out = join(root, 'out');
    const prev = join(root, 'prev');
    mkdirSync(out, { recursive: true });
    mkdirSync(prev, { recursive: true });
    writeFileSync(join(out, 'prices-latest.json'), JSON.stringify(prices));
    writeFileSync(join(prev, 'volumes-latest.json'), JSON.stringify(volumes));
    writeFileSync(join(prev, 'recipes.json'), JSON.stringify(recipes));
    writeFileSync(join(prev, 'prices-latest.json'), JSON.stringify({ ...prices, updatedAt: '2000-01-01T00:00:00.000Z' }));
    const snap = mergeStore(out, prev);
    expect(snap.updatedAt).toBe(prices.updatedAt); // prix courants prioritaires
    expect(snap.volumesUpdatedAt).toBe(volumes.updatedAt);
    expect(snap.items.find((i) => i.id === 'B')!.volume7d.Martlock).toBe(12);
    for (const f of ['market.json', 'recipes.json', 'volumes-latest.json', 'prices-latest.json']) {
      expect(existsSync(join(out, f))).toBe(true);
    }
    rmSync(root, { recursive: true, force: true });
  });
});

describe('dry-run de bout en bout (faux fetch)', () => {
  it('produit out-dry/market.json', async () => {
    const out = join(__dirname, '..', 'out-dry');
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'recipes.json'), JSON.stringify(recipes));
    const clk = fakeClock();
    const { fetch, calls } = fakeAodp();
    const mk = () => new AodpClient({ fetch, now: clk.now, sleep: clk.sleep, log: silent });

    expect(await pricesMain(['--out', out], mk())).toBe(0);
    expect(await volumesMain(['--out', out], mk())).toBe(0);
    mergeStore(out, null);

    expect(calls.some((u) => u.includes('/stats/prices/'))).toBe(true);
    expect(calls.some((u) => u.includes('/stats/history/') && u.endsWith('date=2026-09-30'))).toBe(true);
    const snap: MarketSnapshot = JSON.parse(readFileSync(join(out, 'market.json'), 'utf8'));
    expect(snap.items).toHaveLength(8);
    expect(snap.updatedAt).toBe(new Date(NOW).toISOString());
    expect(snap.volumesUpdatedAt).not.toBeNull();
    const t5 = snap.items.find((i) => i.id === 'T5_PLANKS')!;
    expect(t5.prices.Martlock?.sell).toBe(994);
    expect(t5.volume7d.Brecilien).toBe(7);
    const t4 = snap.items.find((i) => i.id === 'T4_PLANKS')!;
    expect(t4.prices.Brecilien?.buy).toBe(300);
    expect(t4.volume7d.Martlock).toBe(10);
  });
});
