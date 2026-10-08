// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { computeStatus } from '../src/ui/data/status';
import { useSettings, sanitizeSettings, SETTINGS_KEY } from '../src/ui/data/useSettings';
import { useMarket } from '../src/ui/data/useMarket';
import { DEFAULT_SETTINGS } from '../src/types';

const NOW = new Date('2026-10-08T12:00:00Z');
const minAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

describe('computeStatus', () => {
  it('loading quand rien n’est chargé', () => {
    expect(computeStatus(null, NOW, false, false, false)).toBe('loading');
  });
  it('empty sur 404 sans copie', () => {
    expect(computeStatus(null, NOW, false, false, true)).toBe('empty');
  });
  it('fresh < 30 min, stale sinon', () => {
    expect(computeStatus(minAgo(10), NOW, false, true, false)).toBe('fresh');
    expect(computeStatus(minAgo(29.9), NOW, false, true, false)).toBe('fresh');
    expect(computeStatus(minAgo(30), NOW, false, true, false)).toBe('stale');
    expect(computeStatus(minAgo(300), NOW, false, true, false)).toBe('stale');
  });
  it('error si échec avec copie existante', () => {
    expect(computeStatus(minAgo(5), NOW, true, true, false)).toBe('error');
  });
  it('error si échec réseau sans copie (non-404)', () => {
    expect(computeStatus(null, NOW, true, false, false)).toBe('error');
  });
});

describe('sanitizeSettings', () => {
  it('ramène les valeurs hors bornes aux défauts', () => {
    const s = sanitizeSettings({
      marketShare: 1.5, dailyCap: 0, maxPriceAgeH: 49, minVolume: -1,
      stationFee: 5001, dailyBonus: 0.15, mode: 'x', premium: 'yes',
    });
    expect(s).toEqual(DEFAULT_SETTINGS);
  });
  it('conserve les valeurs valides (bornes incluses)', () => {
    const s = sanitizeSettings({
      marketShare: 1, dailyCap: 1, maxPriceAgeH: 48, minVolume: 0,
      stationFee: 5000, dailyBonus: 0.2, mode: 'orders', premium: false, focus: true,
    });
    expect(s).toEqual({
      ...DEFAULT_SETTINGS, marketShare: 1, dailyCap: 1, maxPriceAgeH: 48, minVolume: 0,
      stationFee: 5000, dailyBonus: 0.2, mode: 'orders', premium: false, focus: true,
    });
  });
  it('gère null / JSON non-objet / NaN', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings(42)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({ marketShare: NaN }).marketShare).toBe(DEFAULT_SETTINGS.marketShare);
  });
});

describe('useSettings', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('défauts au premier chargement', () => {
    const { result } = renderHook(() => useSettings());
    expect(result.current[0]).toEqual(DEFAULT_SETTINGS);
  });

  it('persiste et survit à un rechargement', () => {
    const first = renderHook(() => useSettings());
    act(() => first.result.current[1]({ stationFee: 800, focus: true }));
    expect(first.result.current[0].stationFee).toBe(800);
    first.unmount();
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).stationFee).toBe(800);

    const second = renderHook(() => useSettings());
    expect(second.result.current[0]).toEqual({ ...DEFAULT_SETTINGS, stationFee: 800, focus: true });
  });

  it('valide les patchs et les données stockées', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ marketShare: 3, minVolume: 50 }));
    const { result } = renderHook(() => useSettings());
    expect(result.current[0].marketShare).toBe(DEFAULT_SETTINGS.marketShare);
    expect(result.current[0].minVolume).toBe(50);
    act(() => result.current[1]({ maxPriceAgeH: 100 }));
    expect(result.current[0].maxPriceAgeH).toBe(DEFAULT_SETTINGS.maxPriceAgeH);
  });

  it('JSON corrompu → défauts', () => {
    localStorage.setItem(SETTINGS_KEY, '{oops');
    const { result } = renderHook(() => useSettings());
    expect(result.current[0]).toEqual(DEFAULT_SETTINGS);
  });

  it('reset remet les défauts et vide la clé', () => {
    const { result } = renderHook(() => useSettings());
    act(() => result.current[1]({ dailyCap: 5 }));
    act(() => result.current[2]());
    expect(result.current[0]).toEqual(DEFAULT_SETTINGS);
    expect(localStorage.getItem(SETTINGS_KEY)).toBeNull();
  });

  it('fonctionne si localStorage lève une exception', () => {
    const boom = () => { throw new Error('SecurityError'); };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(boom);
    const { result } = renderHook(() => useSettings());
    expect(result.current[0]).toEqual(DEFAULT_SETTINGS);
    act(() => result.current[1]({ premium: false }));
    expect(result.current[0].premium).toBe(false);
    act(() => result.current[2]());
    expect(result.current[0]).toEqual(DEFAULT_SETTINGS);
  });
});

describe('useMarket', () => {
  const recipes = { generatedAt: '2026-10-01T00:00:00Z', recipes: [], meta: [], bonuses: {} };
  const snap = (iso: string) => ({ updatedAt: iso, volumesUpdatedAt: null, items: [] });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  let marketResponses: (() => Response | Promise<Response>)[];
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    marketResponses = [];
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.cache).toBe('no-cache');
      if (url.endsWith('recipes.json')) return json(recipes);
      const next = marketResponses.shift();
      if (!next) throw new Error('pas de réponse prévue');
      return next();
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('404 → empty', async () => {
    marketResponses.push(() => new Response('Not Found', { status: 404 }));
    const { result } = renderHook(() => useMarket());
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('empty'));
    expect(result.current.snapshot).toBeNull();
    await waitFor(() => expect(result.current.recipes).toEqual(recipes));
  });

  it('données récentes → fresh', async () => {
    const iso = new Date(Date.now() - 5 * 60_000).toISOString();
    marketResponses.push(() => json(snap(iso)));
    const { result } = renderHook(() => useMarket());
    await waitFor(() => expect(result.current.status).toBe('fresh'));
    expect(result.current.updatedAt?.toISOString()).toBe(iso);
    expect(result.current.ageMinutes).toBeGreaterThanOrEqual(4.9);
    expect(result.current.ageMinutes).toBeLessThan(6);
  });

  it('données anciennes → stale', async () => {
    marketResponses.push(() => json(snap(new Date(Date.now() - 45 * 60_000).toISOString())));
    const { result } = renderHook(() => useMarket());
    await waitFor(() => expect(result.current.status).toBe('stale'));
  });

  it('échec après succès → error avec copie conservée', async () => {
    const s = snap(new Date(Date.now() - 2 * 60_000).toISOString());
    marketResponses.push(() => json(s));
    marketResponses.push(() => Promise.reject(new TypeError('network down')));
    const { result } = renderHook(() => useMarket());
    await waitFor(() => expect(result.current.status).toBe('fresh'));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.snapshot).toEqual(s);
  });

  it('ignore une réponse plus ancienne que la copie en mémoire', async () => {
    const newer = snap(new Date(Date.now() - 1 * 60_000).toISOString());
    const older = snap(new Date(Date.now() - 20 * 60_000).toISOString());
    marketResponses.push(() => json(newer));
    marketResponses.push(() => json(older));
    const { result } = renderHook(() => useMarket());
    await waitFor(() => expect(result.current.snapshot).toEqual(newer));
    act(() => result.current.reload());
    await waitFor(() => expect(marketResponses.length).toBe(0));
    await act(async () => {});
    expect(result.current.snapshot).toEqual(newer);
    expect(result.current.status).toBe('fresh');
  });

  it('refetch toutes les 5 min et nettoie l’intervalle au démontage', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const iso = new Date(Date.now() - 60_000).toISOString();
    for (let i = 0; i < 3; i++) marketResponses.push(() => json(snap(iso)));
    const { result, unmount } = renderHook(() => useMarket());
    const flush = async () => { for (let i = 0; i < 10; i++) await act(async () => {}); };
    await flush(); // waitFor utilise setInterval (simulé ici) : on vide les promesses à la main
    expect(result.current.status).toBe('fresh');
    const marketCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).endsWith('market.json')).length;
    expect(marketCalls()).toBe(1);
    await act(async () => { vi.advanceTimersByTime(5 * 60_000); });
    await flush();
    expect(marketCalls()).toBe(2);
    unmount();
    vi.advanceTimersByTime(10 * 60_000);
    expect(marketCalls()).toBe(2);
    // recipes chargé une seule fois
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith('recipes.json')).length).toBe(1);
  });
});
