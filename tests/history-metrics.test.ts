import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  ageClass,
  aggregateDaily,
  average30d,
  daysToSell,
  deviationPct,
  lastDays,
  median,
  medianDailySales,
  trend7d,
  type DailyPoint,
} from '../src/engine/history-metrics';

const D0 = Date.UTC(2026, 9, 1); // 1er octobre 2026, minuit UTC
const H = 3_600_000;
const day = (i: number) => D0 + i * DAY_MS;
const dp = (i: number, price: number, volume = 10): DailyPoint => ({ day: day(i), price, volume });

describe('aggregateDaily', () => {
  it('somme les ventes et pondère le prix par le nombre de ventes', () => {
    const out = aggregateDaily([
      { t: day(0) + 0 * H, avgPrice: 100, count: 10 },
      { t: day(0) + 6 * H, avgPrice: 200, count: 30 },
      { t: day(1) + 12 * H, avgPrice: 50, count: 0 },
      { t: day(1) + 18 * H, avgPrice: 70, count: 0 },
      { t: day(1) + 19 * H, avgPrice: 0, count: 99 }, // prix nul ignoré
    ]);
    // (100×10 + 200×30) / 40 = 175 ; jour sans ventes : moyenne simple (50+70)/2 = 60
    expect(out).toEqual([
      { day: day(0), price: 175, volume: 40 },
      { day: day(1), price: 60, volume: 0 },
    ]);
  });

  it('trie par jour et ignore les points non finis', () => {
    const out = aggregateDaily([
      { t: day(2), avgPrice: 10, count: 1 },
      { t: Number.NaN, avgPrice: 10, count: 1 },
      { t: day(1), avgPrice: 20, count: 1 },
    ]);
    expect(out.map((d) => d.day)).toEqual([day(1), day(2)]);
  });
});

describe('fenêtres et moyenne 30 j', () => {
  const now = day(40) + 12 * H;
  it('lastDays inclut ou exclut le jour en cours', () => {
    const daily = [dp(10, 1), dp(11, 1), dp(39, 1), dp(40, 1)];
    expect(lastDays(daily, 30, now).map((d) => d.day)).toEqual([day(11), day(39), day(40)]);
    expect(lastDays(daily, 2, now, false).map((d) => d.day)).toEqual([day(39)]);
  });

  it('moyenne 30 j pondérée par le volume', () => {
    // (100×10 + 200×30) / 40 = 175 ; le jour 5 est hors fenêtre
    const daily = [dp(5, 9999, 1000), dp(20, 100, 10), dp(40, 200, 30)];
    expect(average30d(daily, now)).toBe(175);
    expect(average30d([], now)).toBeNull();
    // sans volume : moyenne simple
    expect(average30d([dp(39, 100, 0), dp(40, 300, 0)], now)).toBe(200);
  });

  it('écart relatif', () => {
    expect(deviationPct(210, 175)).toBeCloseTo(0.2, 10);
    expect(deviationPct(140, 175)).toBeCloseTo(-0.2, 10);
    expect(deviationPct(null, 175)).toBeNull();
    expect(deviationPct(100, 0)).toBeNull();
  });
});

describe('trend7d', () => {
  const now = day(10) + 3 * H;
  it('hausse : pente 10 ag/j sur 4 jours, prix moyen 115 → +60,9 % sur 7 j', () => {
    const t = trend7d([dp(7, 100), dp(8, 110), dp(9, 120), dp(10, 130)], now)!;
    expect(t.dir).toBe('up');
    expect(t.pct).toBeCloseTo(70 / 115, 10);
    expect(t.days).toBe(4);
  });

  it('baisse', () => {
    const t = trend7d([dp(8, 300), dp(9, 250), dp(10, 200)], now)!;
    // pente −50/j, moyenne 250 → −350/250 = −1,4
    expect(t.dir).toBe('down');
    expect(t.pct).toBeCloseTo(-1.4, 10);
  });

  it('stable sous 3 % : 100, 101, 100, 101 → pente 0,2/j, 1,4/100,5 ≈ 1,4 %', () => {
    const t = trend7d([dp(7, 100), dp(8, 101), dp(9, 100), dp(10, 101)], now)!;
    expect(t.pct).toBeCloseTo(1.4 / 100.5, 10);
    expect(t.dir).toBe('flat');
  });

  it('null sous 3 jours dans la fenêtre (jours anciens ignorés)', () => {
    expect(trend7d([dp(1, 100), dp(2, 200), dp(9, 100), dp(10, 120)], now)).toBeNull();
  });
});

describe('ventes par jour et écoulement', () => {
  it('médiane', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it('médiane des 7 derniers jours complets, jour en cours exclu', () => {
    const now = day(10) + 5 * H;
    const daily = [dp(1, 1, 9999), dp(7, 1, 10), dp(8, 1, 30), dp(9, 1, 20), dp(10, 1, 1000)];
    expect(medianDailySales(daily, now)).toBe(20);
    expect(medianDailySales([dp(6, 1, 10), dp(7, 1, 20), dp(8, 1, 30), dp(9, 1, 40)], now)).toBe(25);
    expect(medianDailySales([dp(10, 1, 5)], now)).toBeNull();
  });

  it('jours pour écouler', () => {
    // 200 ventes/j × 10 % = 20/j → 100 / 20 = 5 j
    expect(daysToSell(100, 200, 0.1)).toBe(5);
    // plafond à 5/j → 20 j
    expect(daysToSell(100, 200, 0.1, 5)).toBe(20);
    expect(daysToSell(0, 200, 0.1)).toBeNull();
    expect(daysToSell(10, null, 0.1)).toBeNull();
    expect(daysToSell(10, 200, 0)).toBeNull();
  });

  it('classe d’âge des prix', () => {
    expect(ageClass(0.5)).toBe('fresh');
    expect(ageClass(1)).toBe('ok');
    expect(ageClass(5.9)).toBe('ok');
    expect(ageClass(6)).toBe('old');
    expect(ageClass(24)).toBe('old');
    expect(ageClass(25)).toBe('stale');
    expect(ageClass(null)).toBe('none');
  });
});
