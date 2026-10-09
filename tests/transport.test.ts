import { describe, expect, it } from 'vitest';
import {
  EMPTY_TRANSPORT_FILTERS,
  applyTransportFilters,
  computeTransport,
  metaWeight,
} from '../src/engine/transport';
import type { MarketItem, MarketSnapshot } from '../src/types';
import { LOCATIONS } from '../src/types';
import { META_BY_ID, NOW, SETTINGS, SNAPSHOT, at } from './transport-fixture';

const find = (rows: ReturnType<typeof computeTransport>['rows'], id: string, to?: string) =>
  rows.find((r) => r.itemId === id && (!to || r.sellAt === to));

describe('computeTransport — mode instantané', () => {
  const { rows, evaluated } = computeTransport(SNAPSHOT, SETTINGS, NOW, META_BY_ID);

  it('meilleur couple par objet : sac Bridgewatch → Martlock', () => {
    expect(evaluated).toBe(5);
    const bag = rows.filter((r) => r.itemId === 'T4_BAG');
    expect(bag).toHaveLength(1);
    const r = bag[0];
    // Achat : sell min BW = 1 000. Vente : buy max MAR = 1 500 × (1 − 4 %) = 1 440.
    expect(r.buyAt).toBe('Bridgewatch');
    expect(r.sellAt).toBe('Martlock');
    expect(r.buyPrice).toBe(1000);
    expect(r.sellPrice).toBe(1500);
    expect(r.sellNet).toBeCloseTo(1440, 6);
    expect(r.unitProfit).toBeCloseTo(440, 6);
    expect(r.margin).toBeCloseTo(0.44, 6);
    // 200 × 10 % = 20 / jour ; 20 × 440 = 8 800 (Caerleon : 10 × 632 = 6 320, moins bon).
    expect(r.sellablePerDay).toBeCloseTo(20, 6);
    expect(r.dailyProfit).toBeCloseTo(8800, 6);
    expect(r.weight).toBe(2.5);
    expect(r.profitPerKg).toBeCloseTo(176, 6);
    expect(r.oldestAgeH).toBeCloseTo(2, 6);
    expect(r.flags).toEqual([]);
  });

  it('Black Market seulement en destination, marqué zone rouge', () => {
    const sw = find(rows, 'T5_MAIN_SWORD')!;
    // 1 000 à Thetford → 2 000 × 0,96 = 1 920 ; profit 920 × (50 × 10 % = 5) = 4 600.
    expect(sw.buyAt).toBe('Thetford');
    expect(sw.sellAt).toBe('Black Market');
    expect(sw.unitProfit).toBeCloseTo(920, 6);
    expect(sw.dailyProfit).toBeCloseTo(4600, 6);
    expect(sw.flags).toContain('red-zone');
    expect(rows.some((r) => r.buyAt === 'Black Market')).toBe(false);
  });

  it('prix périmé exclu par défaut, inclus et marqué avec l’option', () => {
    expect(find(rows, 'T4_PLANKS')).toBeUndefined();
    const withStale = computeTransport(SNAPSHOT, SETTINGS, NOW, META_BY_ID, { includeStale: true }).rows;
    const pl = find(withStale, 'T4_PLANKS')!;
    // 100 → 180 × 0,96 = 172,8 ; profit 72,8 × min(1 000 × 10 %, 1 000) = 7 280.
    expect(pl.unitProfit).toBeCloseTo(72.8, 6);
    expect(pl.dailyProfit).toBeCloseTo(7280, 6);
    expect(pl.flags).toEqual(['mists', 'stale']);
    expect(pl.oldestAgeH).toBeCloseTo(10, 6);
  });

  it('suspect marqué, volume nul et profit ≤ 0 exclus', () => {
    // 100 → 900 × 0,96 = 864, mais 900 > 3 × 200.
    expect(find(rows, 'T4_LEATHER')!.flags).toEqual(['suspect']);
    expect(find(rows, 'T4_ORE')).toBeUndefined();
    expect(rows.every((r) => r.unitProfit > 0)).toBe(true);
  });

  it('toutes les paires', () => {
    const all = computeTransport(SNAPSHOT, SETTINGS, NOW, META_BY_ID, { allPairs: true }).rows;
    const bag = all.filter((r) => r.itemId === 'T4_BAG').map((r) => `${r.buyAt}>${r.sellAt}:${r.unitProfit.toFixed(2)}`);
    // BW→MAR 440 ; BW→CAE 1 700 × 0,96 − 1 000 = 632 ; MAR→CAE 1 632 − 1 600 = 32.
    expect(bag.sort()).toEqual(['Bridgewatch>Caerleon:632.00', 'Bridgewatch>Martlock:440.00', 'Martlock>Caerleon:32.00']);
    // Tri global par profit/jour décroissant.
    for (let i = 1; i < all.length; i++) expect(all[i - 1].dailyProfit).toBeGreaterThanOrEqual(all[i].dailyProfit);
  });
});

describe('computeTransport — mode ordres', () => {
  it('ordre d’achat + 2,5 % et ordre de vente − taxe − 2,5 %', () => {
    const { rows } = computeTransport(SNAPSHOT, { ...SETTINGS, mode: 'orders' }, NOW, META_BY_ID, { allPairs: true });
    const r = find(rows, 'T4_BAG', 'Martlock')!;
    // Achat : (900 + 1) × 1,025 = 923,525. Vente : (1 600 − 1) × (1 − 0,04 − 0,025) = 1 495,065.
    expect(r.buyPrice).toBeCloseTo(923.525, 6);
    expect(r.sellPrice).toBe(1599);
    expect(r.sellNet).toBeCloseTo(1495.065, 6);
    expect(r.unitProfit).toBeCloseTo(571.54, 6);
    expect(r.dailyProfit).toBeCloseTo(11430.8, 6);
    // Black Market : toujours vente instantanée (buy max), sans frais d'ordre : 2 000 × 0,96 − (800 + 1) × 1,025.
    const sw = find(rows, 'T5_MAIN_SWORD', 'Black Market')!;
    expect(sw.sellNet).toBeCloseTo(1920, 6);
    expect(sw.unitProfit).toBeCloseTo(1920 - 821.025, 6);
  });

  it('sans premium : taxe 8 %', () => {
    const { rows } = computeTransport(SNAPSHOT, { ...SETTINGS, premium: false }, NOW, META_BY_ID);
    // 1 500 × 0,92 − 1 000 = 380 (CAE : 1 700 × 0,92 − 1 000 = 564 × 10 = 5 640 < 7 600).
    expect(find(rows, 'T4_BAG')!.unitProfit).toBeCloseTo(380, 6);
  });
});

describe('applyTransportFilters', () => {
  const { rows } = computeTransport(SNAPSHOT, SETTINGS, NOW, META_BY_ID, { allPairs: true });

  it('charge max → profit par trajet', () => {
    const v = applyTransportFilters(rows, { ...EMPTY_TRANSPORT_FILTERS, maxLoadKg: 30 }, META_BY_ID);
    const bag = v.find((r) => r.itemId === 'T4_BAG' && r.sellAt === 'Martlock')!;
    // ⌊30 / 2,5⌋ = 12 < 20 vendables → 12 × 440 = 5 280.
    expect(bag.tripQty).toBe(12);
    expect(bag.tripProfit).toBeCloseTo(5280, 6);
    // Poids inconnu → pas de profit par trajet.
    expect(v.find((r) => r.itemId === 'T5_MAIN_SWORD')!.tripProfit).toBeNull();
  });

  it('budget total plafonne la quantité ; budget unitaire filtre', () => {
    const tot = applyTransportFilters(rows, { ...EMPTY_TRANSPORT_FILTERS, budget: 5000, budgetMode: 'total', maxLoadKg: 30 }, META_BY_ID);
    const bag = tot.find((r) => r.itemId === 'T4_BAG' && r.sellAt === 'Martlock')!;
    expect(bag.dayQty).toBe(5);
    expect(bag.dayProfit).toBeCloseTo(2200, 6);
    expect(bag.tripQty).toBe(5);
    const unit = applyTransportFilters(rows, { ...EMPTY_TRANSPORT_FILTERS, budget: 999 }, META_BY_ID);
    expect(unit.some((r) => r.buyPrice > 999)).toBe(false);
    expect(unit.some((r) => r.itemId === 'T4_BAG' && r.buyAt === 'Bridgewatch')).toBe(false);
  });

  it('villes, zone rouge, suspects, profit min, recherche sans accents', () => {
    const f = EMPTY_TRANSPORT_FILTERS;
    expect(applyTransportFilters(rows, { ...f, from: 'Martlock' }).every((r) => r.buyAt === 'Martlock')).toBe(true);
    expect(applyTransportFilters(rows, { ...f, to: 'Caerleon' }).every((r) => r.sellAt === 'Caerleon')).toBe(true);
    expect(applyTransportFilters(rows, { ...f, excludeRedZone: true }).some((r) => r.flags.includes('red-zone'))).toBe(false);
    expect(applyTransportFilters(rows, f).some((r) => r.itemId === 'T4_LEATHER')).toBe(false);
    expect(applyTransportFilters(rows, { ...f, hideSuspect: false }).some((r) => r.itemId === 'T4_LEATHER')).toBe(true);
    expect(applyTransportFilters(rows, { ...f, minUnitProfit: 500 }).map((r) => r.unitProfit).every((p) => p >= 500)).toBe(true);
    const s = applyTransportFilters(rows, { ...f, search: 'epee' }, META_BY_ID);
    expect(s.map((r) => r.itemId)).toEqual(['T5_MAIN_SWORD']);
  });
});

describe('poids et performance', () => {
  it('metaWeight tolérant', () => {
    expect(metaWeight(undefined)).toBeNull();
    expect(metaWeight(META_BY_ID.get('T5_MAIN_SWORD'))).toBeNull();
    expect(metaWeight(META_BY_ID.get('T4_BAG'))).toBe(2.5);
  });

  it('7 600 objets × 7 × 8 paires évaluées en moins de 150 ms (meilleur couple par objet)', () => {
    const items: MarketItem[] = [];
    for (let k = 0; k < 7600; k++) {
      const prices: MarketItem['prices'] = {};
      const volume7d: MarketItem['volume7d'] = {};
      LOCATIONS.forEach((l, i) => {
        const base = 1000 + ((k * 7 + i * 131) % 400);
        prices[l] = { sell: base, sellAt: at(1 + (k % 300) / 1000), buy: base - 50, buyAt: at(1 + ((k + i) % 300) / 1000) };
        volume7d[l] = 10 + (k % 90);
      });
      items.push({ id: `T4_X${k}`, prices, volume7d, avgPrice7d: {}, historyDays: {} });
    }
    const snap: MarketSnapshot = { updatedAt: at(0), volumesUpdatedAt: null, items };
    computeTransport(snap, SETTINGS, NOW); // échauffement JIT
    // Meilleur de 3 mesures : la suite tourne en parallèle sur plusieurs workers.
    let ms = Infinity;
    let n = 0;
    for (let k = 0; k < 3; k++) {
      const t0 = performance.now();
      n = computeTransport(snap, SETTINGS, NOW, META_BY_ID).rows.length;
      ms = Math.min(ms, performance.now() - t0);
    }
    expect(n).toBe(7600);
    expect(ms).toBeLessThan(150);
  });
});
