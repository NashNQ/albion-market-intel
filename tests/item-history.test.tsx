// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DEFAULT_SETTINGS, type MarketSnapshot } from '../src/types';
import { AppDataContext, buildIndexes, type AppData } from '../src/ui/context';
import { ItemMarket } from '../src/ui/components/ItemMarket';
import {
  ApiError,
  HISTORY_CACHE_PREFIX,
  HISTORY_TTL_MS,
  fetchHistory,
  fetchLivePrices,
  historyUrl,
} from '../src/ui/data/history';

const ID = 'T4_PLANKS';
const NOW = new Date(Date.UTC(2026, 9, 9, 12, 0, 0));
const DAY = 86_400_000;
const today = Date.UTC(2026, 9, 9);
/** Format AODP : UTC sans suffixe. */
const apiDate = (t: number) => new Date(t).toISOString().slice(0, 19);

// 30 jours à Martlock : prix 1000 + 10 × i, 4 tranches de 100 ventes (400/jour).
const historyBody = [
  {
    location: 'Martlock',
    item_id: ID,
    quality: 1,
    data: Array.from({ length: 30 }, (_, i) =>
      [0, 6, 12, 18].map((h) => ({
        avg_price: 1000 + 10 * i,
        item_count: 100,
        timestamp: apiDate(today - (29 - i) * DAY + h * 3_600_000),
      })),
    ).flat(),
  },
  { location: 'Atlantis', item_id: ID, quality: 1, data: [{ avg_price: 1, item_count: 1, timestamp: apiDate(today) }] },
];

const pricesBody = [
  {
    item_id: ID,
    city: 'Martlock',
    quality: 1,
    sell_price_min: 1600,
    sell_price_min_date: apiDate(NOW.getTime() - 30 * 60_000),
    buy_price_max: 1400,
    buy_price_max_date: apiDate(NOW.getTime() - 48 * 3_600_000),
  },
  {
    item_id: ID,
    city: 'Lymhurst',
    quality: 1,
    sell_price_min: 0,
    sell_price_min_date: '0001-01-01T00:00:00',
    buy_price_max: 900,
    buy_price_max_date: apiDate(NOW.getTime() - 3 * 3_600_000),
  },
];

const res = (status: number, body?: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

type Handler = (url: string) => Response | Promise<Response>;
function mockFetch(handler: Handler) {
  return vi.fn(async (url: string, _init?: RequestInit) => handler(url));
}
const ok: Handler = (url) => res(200, url.includes('/history/') ? historyBody : pricesBody);

const snapshot: MarketSnapshot = {
  updatedAt: NOW.toISOString(),
  volumesUpdatedAt: null,
  items: [
    {
      id: ID,
      prices: { Martlock: { sell: 1500, sellAt: new Date(NOW.getTime() - 2 * 3_600_000).toISOString(), buy: 1300, buyAt: null } },
      volume7d: { Martlock: 380 },
      avgPrice7d: {},
      historyDays: { Martlock: 7 },
    },
  ],
};

function renderMarket(fetchImpl?: ReturnType<typeof mockFetch>) {
  const data: AppData = {
    snapshot,
    recipes: null,
    rankings: null,
    settings: { ...DEFAULT_SETTINGS },
    updateSettings: () => {},
    resetSettings: () => {},
    now: NOW,
    ...buildIndexes(snapshot, null),
  };
  return render(
    <AppDataContext.Provider value={data}>
      <ItemMarket id={ID} item={data.itemById.get(ID)} fetchImpl={fetchImpl} />
    </AppDataContext.Provider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('data/history : fetch, parse et cache', () => {
  it('succès : URL AODP et agrégation journalière (lieux inconnus ignorés)', async () => {
    const f = mockFetch(ok);
    const h = await fetchHistory(ID, { fetchImpl: f });
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe(historyUrl(ID));
    expect(f.mock.calls[0][0]).toContain('time-scale=6&qualities=1&locations=Bridgewatch,Fort%20Sterling,');
    expect(Object.keys(h)).toEqual(['Martlock']);
    expect(h.Martlock).toHaveLength(30);
    expect(h.Martlock![29]).toEqual({ day: today, price: 1290, volume: 400 });
  });

  it('cache sessionStorage : pas de seconde requête avant 15 min, puis expiration', async () => {
    const f = mockFetch(ok);
    await fetchHistory(ID, { fetchImpl: f });
    await fetchHistory(ID, { fetchImpl: f });
    expect(f).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(HISTORY_CACHE_PREFIX + ID)).toBeTruthy();
    vi.setSystemTime(NOW.getTime() + HISTORY_TTL_MS + 1);
    await fetchHistory(ID, { fetchImpl: f });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('cache illisible ou stockage indisponible : requête normale, sans planter', async () => {
    window.sessionStorage.setItem(HISTORY_CACHE_PREFIX + ID, '{pas du json');
    const f = mockFetch(ok);
    await expect(fetchHistory(ID, { fetchImpl: f })).resolves.toHaveProperty('Martlock');
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    window.sessionStorage.clear();
    await expect(fetchHistory(ID, { fetchImpl: f })).resolves.toHaveProperty('Martlock');
    spy.mockRestore();
  });

  it('429 → ApiError « rate-limit » ; 500 → « http » ; réseau → « network »', async () => {
    await expect(fetchHistory(ID, { fetchImpl: mockFetch(() => res(429)) })).rejects.toMatchObject({ kind: 'rate-limit' });
    await expect(fetchHistory(ID, { fetchImpl: mockFetch(() => res(500)) })).rejects.toMatchObject({ kind: 'http', status: 500 });
    const net = mockFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const err = await fetchHistory(ID, { fetchImpl: net }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.kind).toBe('network');
    // une erreur n'est jamais mise en cache
    expect(window.sessionStorage.getItem(HISTORY_CACHE_PREFIX + ID)).toBeNull();
  });

  it('prix en direct : prix 0 / date 0001-01-01 = absent', async () => {
    const p = await fetchLivePrices(ID, { fetchImpl: mockFetch(ok) });
    expect(p.Martlock).toEqual({
      sell: 1600,
      sellAt: NOW.getTime() - 30 * 60_000,
      buy: 1400,
      buyAt: NOW.getTime() - 48 * 3_600_000,
    });
    expect(p.Lymhurst?.sell).toBeNull();
    expect(p.Lymhurst?.buy).toBe(900);
  });
});

describe('ItemMarket : fiche objet', () => {
  it('succès : écart vs moyenne 30 j, ventes/jour, tendance, calculateur et graphique', async () => {
    const f = mockFetch(ok);
    const { container } = renderMarket(f);
    expect(screen.getByText('Chargement de l’historique des ventes…')).toBeTruthy();
    // moyenne 30 j = 1 145 ag ; 1 500 / 1 145 − 1 = +31 %
    expect(await screen.findByText('+31 % vs moyenne 30 j')).toBeTruthy();
    expect(screen.getByText(/Anormalement haut/)).toBeTruthy();
    expect(screen.getByText('≈ 400 ventes/jour')).toBeTruthy();
    // pente 10 ag/j sur 1 260 ag de moyenne → +6 % sur 7 j
    expect(screen.getByText('En hausse')).toBeTruthy();
    expect(screen.getByText(/\+6 % sur 7 jours/)).toBeTruthy();
    // 100 unités à 10 % de 400/j = 40/j → 2,5 j → 3 jours
    expect(within(container.querySelector('.im-calc-out')!).getByText('3 jours')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Quantité à vendre'), { target: { value: '20' } });
    expect(within(container.querySelector('.im-calc-out')!).getByText('moins d’un jour')).toBeTruthy();
    // graphique + données accessibles
    expect(container.querySelector('svg.hc-svg path.hc-line')).toBeTruthy();
    expect(container.querySelectorAll('path.hc-bar')).toHaveLength(30);
    expect(screen.getByText('Voir les données')).toBeTruthy();
    expect(screen.getAllByRole('row').length).toBeGreaterThan(30);
    // une seule requête (historique), aucune pour les prix avant le clic
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('cache : un second affichage ne refait pas de requête', async () => {
    const f = mockFetch(ok);
    renderMarket(f);
    await screen.findByText('+31 % vs moyenne 30 j');
    cleanup();
    renderMarket(f);
    await screen.findByText('+31 % vs moyenne 30 j');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('429 : message « API saturée » puis Réessayer', async () => {
    let n = 0;
    const f = mockFetch((u) => (n++ === 0 ? res(429) : ok(u)));
    renderMarket(f);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('API saturée, réessayez dans une minute.');
    fireEvent.click(within(alert).getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('+31 % vs moyenne 30 j')).toBeTruthy();
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('erreur réseau : message et bouton Réessayer (fetch global)', async () => {
    const f = mockFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', f);
    renderMarket();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Impossible de joindre l’API/);
    expect(within(alert).getByRole('button', { name: 'Réessayer' })).toBeTruthy();
    expect(f).toHaveBeenCalled();
  });

  it('Actualiser les prix : prix en direct avec âge et prix périmé grisé mais visible', async () => {
    const f = mockFetch(ok);
    const { container } = renderMarket(f);
    await screen.findByText('+31 % vs moyenne 30 j');
    // avant le clic : prix de la collecte
    expect(screen.getByText('1 500 ag')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Actualiser les prix' }));
    expect(await screen.findByText('1 600 ag')).toBeTruthy();
    expect(f.mock.calls.some(([u]) => String(u).includes('/prices/T4_PLANKS.json?qualities=1'))).toBe(true);
    const row = screen.getByText('Martlock', { selector: '.loc-full' }).closest('tr')!;
    expect(within(row).getByText('30 min').className).toContain('age-fresh');
    // achat vieux de 48 h : affiché, grisé, marqué périmé
    expect(within(row).getByText('1 400 ag').className).toContain('price-stale');
    expect(within(row).getByText('périmé')).toBeTruthy();
    // l'écart utilise le prix en direct : 1 600 / 1 145 − 1 = +40 %
    expect(screen.getByText('+40 % vs moyenne 30 j')).toBeTruthy();
    expect(container.querySelector('.im-source')!.textContent).toMatch(/Prix en direct/);
  });

  it('Actualiser les prix en 429 : message dédié, prix précédents conservés', async () => {
    const f = mockFetch((u) => (u.includes('/prices/') ? res(429) : ok(u)));
    renderMarket(f);
    await screen.findByText('+31 % vs moyenne 30 j');
    fireEvent.click(screen.getByRole('button', { name: 'Actualiser les prix' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('API saturée, réessayez dans une minute.');
    expect(screen.getByText('1 500 ag')).toBeTruthy();
  });
});
