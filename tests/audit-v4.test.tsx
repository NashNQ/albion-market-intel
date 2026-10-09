// @vitest-environment jsdom
// Audit v4 : prix > 7 j ignorés au transport, profits invraisemblables signalés, fiche objet
// (ville par défaut cohérente, aucune donnée de la fiche précédente, cache corrompu, colonnes mobiles).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { DEFAULT_SETTINGS, type MarketItem, type MarketSnapshot, type Recipe, type RecipesFile } from '../src/types';
import { computeTransport } from '../src/engine/transport';
import { rankAll, isImplausibleProfit, STALE_MAX_AGE_H } from '../src/engine';
import { HISTORY_CACHE_PREFIX, fetchHistory, isHistoryByLoc, useItemHistory, useLivePrices } from '../src/ui/data/history';
import { pickDefaultCity, ItemMarket } from '../src/ui/components/ItemMarket';
import { AppDataContext, buildIndexes, type AppData } from '../src/ui/context';
import { NOW, SETTINGS, at } from './transport-fixture';

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

const snap = (items: MarketItem[]): MarketSnapshot => ({ updatedAt: NOW.toISOString(), volumesUpdatedAt: null, items });

describe('transport : « inclure les prix plus vieux » plafonné à 7 jours', () => {
  const item = (buyAt: string | null): MarketItem => ({
    id: 'T4_X',
    prices: {
      Thetford: { sell: 100, sellAt: buyAt, buy: 90, buyAt },
      Martlock: { sell: 300, sellAt: at(1), buy: 250, buyAt: at(1) },
    },
    volume7d: { Martlock: 100 },
    avgPrice7d: {},
    historyDays: {},
  });

  it('prix de 10 jours ou daté 0001-01-01 : jamais utilisé, même avec includeStale', () => {
    for (const d of [at(240), '0001-01-01T00:00:00Z']) {
      const r = computeTransport(snap([item(d)]), SETTINGS, NOW, undefined, { includeStale: true, allPairs: true });
      expect(r.rows).toEqual([]);
    }
  });

  it('prix de 3 jours : inclus mais marqué périmé', () => {
    const r = computeTransport(snap([item(at(72))]), SETTINGS, NOW, undefined, { includeStale: true });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].flags).toContain('stale');
    expect(r.rows[0].oldestAgeH).toBeLessThan(STALE_MAX_AGE_H);
  });

  it('marge > 500 % sans moyenne 7 j connue : drapeau suspect (masqué par défaut)', () => {
    const it2: MarketItem = { ...item(at(1)), prices: { Thetford: { sell: 100, sellAt: at(1), buy: 90, buyAt: at(1) }, Martlock: { sell: 1000, sellAt: at(1), buy: 900, buyAt: at(1) } } };
    const r = computeTransport(snap([it2]), SETTINGS, NOW);
    expect(r.rows[0].margin).toBeGreaterThan(5);
    expect(r.rows[0].flags).toContain('suspect');
  });
});

describe('classements : profit invraisemblable signalé', () => {
  it('isImplausibleProfit : marge > 500 % ou > 10 M/unité', () => {
    expect(isImplausibleProfit(600, 100)).toBe(true);
    expect(isImplausibleProfit(400, 100)).toBe(false);
    expect(isImplausibleProfit(11e6, 50e6)).toBe(true);
  });

  it('artefact bradé sans moyenne 7 j revendu au Black Market : route « suspect », confiance ≤ 0,5', () => {
    const recipe: Recipe = {
      outputId: 'T4_OUT',
      outputQty: 1,
      inputs: [{ id: 'T4_ART', qty: 1, returnable: false }],
      itemValue: 16,
      kind: 'crafting',
      bonusKey: 'x',
      category: 'shoes',
      subcategory: 'plate_shoes',
      tier: 4,
      enchant: 0,
    };
    const recipes = { generatedAt: '', recipes: [recipe], meta: [], bonuses: {} } as unknown as RecipesFile;
    const items: MarketItem[] = [
      { id: 'T4_ART', prices: { Lymhurst: { sell: 280, sellAt: at(1), buy: null, buyAt: null } }, volume7d: {}, avgPrice7d: {}, historyDays: {} },
      {
        id: 'T4_OUT',
        prices: { 'Black Market': { sell: null, sellAt: null, buy: 9000, buyAt: at(1) } },
        volume7d: { 'Black Market': 40 },
        avgPrice7d: {},
        historyDays: { 'Black Market': 7 },
      },
    ];
    const r = rankAll(snap(items), recipes, { ...DEFAULT_SETTINGS }, NOW);
    expect(r.blackMarket).toHaveLength(1);
    expect(r.blackMarket[0].flags).toContain('suspect');
    expect(r.blackMarket[0].confidence).toBeLessThanOrEqual(0.5);
  });
});

describe('fiche objet', () => {
  it('ville par défaut : seules les villes avec historique sont candidates une fois l’historique chargé', () => {
    const sales = { Caerleon: 9000, Martlock: 40, Thetford: 30 };
    expect(pickDefaultCity(sales)).toBe('Caerleon');
    expect(pickDefaultCity(sales, new Set(['Martlock', 'Thetford'] as const))).toBe('Martlock');
  });

  it('cache sessionStorage de forme invalide : ignoré, nouvelle requête', async () => {
    window.sessionStorage.setItem(HISTORY_CACHE_PREFIX + 'T4_X', JSON.stringify({ at: Date.now(), data: { Martlock: 'x' } }));
    expect(isHistoryByLoc({ Martlock: 'x' })).toBe(false);
    expect(isHistoryByLoc({ Martlock: [{ day: 0, price: 1, volume: 2 }] })).toBe(true);
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => [] }) as unknown as Response);
    await expect(fetchHistory('T4_X', { fetchImpl: f })).resolves.toEqual({});
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('changement rapide de fiche : jamais l’historique ni les prix en direct de l’objet précédent', async () => {
    const body = (id: string) => [
      { location: 'Martlock', quality: 1, data: [{ avg_price: id === 'A' ? 111 : 222, item_count: 1, timestamp: '2026-10-09T00:00:00' }] },
    ];
    const live = [{ city: 'Martlock', quality: 1, sell_price_min: 5, sell_price_min_date: '2026-10-09T00:00:00', buy_price_max: 0, buy_price_max_date: '0001-01-01T00:00:00' }];
    const f = vi.fn(async (url: string) => {
      const id = url.includes('/A.json') ? 'A' : 'B';
      return { ok: true, status: 200, json: async () => (url.includes('/history/') ? body(id) : live) } as unknown as Response;
    });
    const seen: string[] = [];
    const { result, rerender } = renderHook(
      ({ id }) => {
        const h = useItemHistory(id, f);
        const l = useLivePrices(id, f);
        if (h[0].state === 'ok') seen.push(`${id}:${h[0].data.Martlock?.[0].price}`);
        if (l[0].state === 'ok') seen.push(`${id}:live`);
        return { h, l };
      },
      { initialProps: { id: 'A' } },
    );
    await waitFor(() => expect(result.current.h[0].state).toBe('ok'));
    act(() => result.current.l[1]());
    await waitFor(() => expect(result.current.l[0].state).toBe('ok'));
    rerender({ id: 'B' });
    expect(result.current.h[0].state).toBe('loading');
    expect(result.current.l[0].state).toBe('idle');
    await waitFor(() => expect(result.current.h[0].state).toBe('ok'));
    expect(seen.filter((s) => s.startsWith('B:'))).toEqual(seen.filter((s) => s === 'B:222'));
  });

  it('tableau des prix : les cellules d’âge sont « secondary » comme leurs en-têtes (colonnes alignées sur mobile)', async () => {
    const s = snap([{ id: 'T4_X', prices: { Martlock: { sell: 10, sellAt: at(1), buy: 8, buyAt: at(1) } }, volume7d: {}, avgPrice7d: {}, historyDays: {} }]);
    const data: AppData = {
      snapshot: s,
      recipes: null,
      rankings: null,
      settings: { ...DEFAULT_SETTINGS },
      updateSettings: () => {},
      resetSettings: () => {},
      now: NOW,
      ...buildIndexes(s, null),
    };
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => [] }) as unknown as Response);
    render(
      <AppDataContext.Provider value={data}>
        <ItemMarket id="T4_X" item={data.itemById.get('T4_X')} fetchImpl={f} />
      </AppDataContext.Provider>,
    );
    const table = (await screen.findByRole('heading', { name: 'Prix par lieu' })).closest('section')!.querySelector('table')!;
    const thSecondary = [...table.querySelectorAll('thead th')].map((th) => th.classList.contains('secondary'));
    for (const tr of table.querySelectorAll('tbody tr')) {
      const cells = [...tr.children].map((c) => c.classList.contains('secondary'));
      expect(cells).toEqual(thSecondary);
    }
  });
});

describe('favoris : meilleur prix', () => {
  it('ignore un ordre de vente piège (> 3 × la moyenne 7 j)', async () => {
    const { bestQuote } = await import('../src/ui/pages/Favorites');
    const item: MarketItem = {
      id: 'T4_X',
      prices: {
        Martlock: { sell: 999_999, sellAt: at(1), buy: 100, buyAt: at(1) },
        Thetford: { sell: 120, sellAt: at(1), buy: 110, buyAt: at(1) },
      },
      volume7d: {},
      avgPrice7d: { Martlock: 120, Thetford: 120 },
      historyDays: {},
    };
    const q = bestQuote(item, 'sell', { ...DEFAULT_SETTINGS, mode: 'orders' }, NOW);
    expect(q?.loc).toBe('Thetford');
  });
});
