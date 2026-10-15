// Audit des prêts sur gage : liquidité, prix piège, prêt max borné par la volatilité, jour local, mode des réglages.
import { describe, expect, it } from 'vitest';
import type { MarketItem } from '../src/types';
import {
  QUICK_SALE_DAYS,
  recentAveragePrice,
  capQuickToAverage,
  evaluateLoan,
  localDay,
  priceDynamics,
  quickSellableQty,
  summarizeLoans,
  valueCollateral,
  type PriceDynamics,
} from '../src/engine/pawn';
import { modeForRoute } from '../src/ui/data/mode';
import { DAY_MS, startOfUtcDay } from '../src/engine/history-metrics';

const NOW = new Date('2026-10-15T12:00:00.000Z');
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const RULES = { maxLtv: 0.6, safetyMargin: 0.1, maxTermDays: 14 };
const dyn = (trend: number, sigma: number): PriceDynamics => ({ trend, rawTrend: trend, sigma, days: 30, fromHistory: true });

const t8 = (over: Partial<MarketItem> = {}): MarketItem => ({
  id: 'T8_MAIN_SWORD',
  prices: {
    Martlock: { sell: 260_000, sellAt: ago(1), buy: 200_000, buyAt: ago(1) },
    // Ordre d'achat plus élevé mais ville quasi morte (0,3 vente/jour).
    Thetford: { sell: null, sellAt: null, buy: 240_000, buyAt: ago(1) },
  },
  volume7d: { Martlock: 2, Thetford: 0.3 },
  avgPrice7d: {},
  historyDays: {},
  ...over,
});

describe('liquidité de la revente rapide', () => {
  it('quickSellableQty : 3 jours de ventes au plus, au moins 1 unité, sans plafond si volume inconnu', () => {
    expect(QUICK_SALE_DAYS).toBe(3);
    expect(quickSellableQty(50, 2)).toBe(6);
    expect(quickSellableQty(50, 0)).toBe(1);
    expect(quickSellableQty(4, 10)).toBe(4);
    expect(quickSellableQty(50, null)).toBe(50);
  });

  it('50 armes T8 : seules 6 comptent (2 ventes/jour à Martlock), la ville morte au meilleur prix n’est pas retenue', () => {
    const v = valueCollateral(t8(), 50, { premium: true, maxPriceAgeH: 6, now: NOW });
    expect(v.quick?.loc).toBe('Martlock');
    expect(v.quick?.countedQty).toBe(6);
    expect(v.quick?.dailyVolume).toBe(2);
    expect(v.quick?.total).toBeCloseTo(200_000 * 0.96 * 6, 6);
    // La mise en vente compte toujours toutes les unités (on attend les acheteurs).
    expect(v.listing?.countedQty).toBe(50);
  });

  it('une seule arme : la meilleure offre l’emporte, même dans une ville peu active', () => {
    const v = valueCollateral(t8(), 1, { premium: true, maxPriceAgeH: 6, now: NOW });
    expect(v.quick?.loc).toBe('Thetford');
    expect(v.quick?.total).toBeCloseTo(240_000 * 0.96, 6);
  });

  it('summarizeLoans avec totalOf : la valeur des gages tient compte de la liquidité', () => {
    const totalOf = (id: string, qty: number) => valueCollateral(t8(), qty, { premium: true, maxPriceAgeH: 6, now: NOW }).quick?.total ?? null;
    const loans = [{ itemId: 'T8_MAIN_SWORD', qty: 50, amount: 2_000_000, rate: 0.1, dueDate: '2026-10-29', status: 'open' as const }];
    const s = summarizeLoans(loans, () => 192_000, NOW, { safetyMargin: 0.1, totalOf });
    expect(s.collateralValue).toBeCloseTo(1_152_000, 6);
    expect(s.atRisk).toBe(1); // 1,15 M × 0,9 < 2,2 M dus (l'ancien calcul unitaire × 50 donnait 9,6 M « couverts »)
  });
});

describe('prix piège', () => {
  it('ordre d’achat à 2,5 × la moyenne récente (sous le seuil suspect de 3 ×) : plafonné à 125 % de la moyenne', () => {
    const v = valueCollateral(t8({ prices: { Martlock: { sell: null, sellAt: null, buy: 500_000, buyAt: ago(1) } } }), 1, {
      premium: true,
      maxPriceAgeH: 6,
      now: NOW,
    });
    const c = capQuickToAverage(v, 200_000);
    expect(c.cappedToAverage).toBe(true);
    expect(c.quick?.unitPrice).toBe(250_000);
    expect(c.quick?.total).toBeCloseTo(240_000, 6);
    // Ordre dans la tolérance (≤ 125 %) ou moyenne inconnue : inchangé.
    expect(capQuickToAverage(v, 400_000).cappedToAverage).toBe(false);
    expect(capQuickToAverage(v, null).quick?.unitPrice).toBe(500_000);
  });

  it('prix moyen récent : 7 derniers jours pondérés par les ventes, sinon 30 jours', () => {
    const today = startOfUtcDay(NOW.getTime());
    const pts = [
      { day: today - 20 * DAY_MS, price: 1000, volume: 5 },
      { day: today - 2 * DAY_MS, price: 100, volume: 1 },
      { day: today - 1 * DAY_MS, price: 200, volume: 3 },
    ];
    expect(recentAveragePrice(pts, NOW.getTime())).toBeCloseTo(175, 9);
    expect(recentAveragePrice(pts.slice(0, 1), NOW.getTime())).toBe(1000);
    expect(recentAveragePrice([], NOW.getTime())).toBeNull();
  });

  it('flambée provoquée (+5 %/jour) : la hausse n’est pas comptée', () => {
    const day0 = startOfUtcDay(NOW.getTime()) - 9 * DAY_MS;
    const d = priceDynamics(Array.from({ length: 10 }, (_, i) => ({ day: day0 + i * DAY_MS, price: 1000 * 1.05 ** i, volume: 3 })), NOW.getTime());
    expect(d.trend).toBe(0);
    const ev = evaluateLoan({ amount: 600_000, rate: 0.1, startDate: '2026-10-15' }, 1_000_000, d, RULES, NOW);
    expect(ev.projection[30]).toBeLessThan(ev.projection[0]);
  });
});

describe('prêt max conseillé', () => {
  it('gage peu volatil : la LTV fixe le plafond', () => {
    const ev = evaluateLoan({ amount: 1, rate: 0.1, startDate: '2026-10-15' }, 1_000_000, dyn(0, 0.03), RULES, NOW);
    expect(ev.maxLoanBy).toBe('ltv');
    expect(ev.maxLoan).toBeCloseTo(600_000, 6);
  });

  it('gage volatil (8 %/jour) : plafond = valeur prudente à 14 j × 0,9 ÷ 1,1, et le dû reste couvert jusqu’au terme', () => {
    const ev = evaluateLoan({ amount: 1, rate: 0.1, startDate: '2026-10-15' }, 1_000_000, dyn(0, 0.08), RULES, NOW);
    const expected = (1_000_000 * Math.exp(-1.28 * 0.08 * Math.sqrt(14)) * 0.9) / 1.1;
    expect(ev.maxLoanBy).toBe('term');
    expect(ev.maxLoan).toBeCloseTo(expected, 3);
    const atMax = evaluateLoan({ amount: Math.floor(expected), rate: 0.1, startDate: '2026-10-15' }, 1_000_000, dyn(0, 0.08), RULES, NOW);
    expect(atMax.limitDay == null || atMax.limitDay > 14).toBe(true);
  });

  it('intérêt 200 % et LTV 100 % : le prêt max ne rend jamais le gage insuffisant dès le départ', () => {
    const rules = { maxLtv: 1, safetyMargin: 0.1, maxTermDays: 14 };
    const probe = evaluateLoan({ amount: 1, rate: 2, startDate: '2026-10-15' }, 1_000_000, dyn(0, 0.03), rules, NOW);
    const ev = evaluateLoan({ amount: Math.floor(probe.maxLoan ?? 0), rate: 2, startDate: '2026-10-15' }, 1_000_000, dyn(0, 0.03), rules, NOW);
    expect(ev.insufficientNow).toBe(false);
  });
});

describe('jour local (fuseau de l’officier)', () => {
  it('à 0 h 30 heure de Paris le 16 octobre, le jour est le 16 (UTC : encore le 15)', () => {
    const prev = process.env.TZ;
    process.env.TZ = 'Europe/Paris';
    try {
      const d = new Date('2026-10-15T22:30:00.000Z');
      expect(d.toISOString().slice(0, 10)).toBe('2026-10-15');
      expect(localDay(d)).toBe('2026-10-16');
      // Échéance le 15 : en retard dès minuit à Paris, pas à 2 h.
      const ev = evaluateLoan({ amount: 100, rate: 0, startDate: '2026-10-01', dueDate: '2026-10-15' }, 1000, dyn(0, 0), RULES, d);
      expect(ev.overdue).toBe(true);
      // Passage à l'heure d'hiver (25 octobre 2026, 3 h → 2 h) : le jour reste juste de part et d'autre.
      expect(localDay(new Date('2026-10-24T22:30:00.000Z'))).toBe('2026-10-25');
      expect(localDay(new Date('2026-10-25T22:30:00.000Z'))).toBe('2026-10-25');
      expect(localDay(new Date('2026-10-25T23:30:00.000Z'))).toBe('2026-10-26');
    } finally {
      if (prev === undefined) delete process.env.TZ;
      else process.env.TZ = prev;
    }
  });
});

describe('mode', () => {
  it('les réglages du site gardent le mode courant (lien depuis la page des prêts)', () => {
    expect(modeForRoute('reglages')).toBeNull();
    expect(modeForRoute('item')).toBeNull();
    expect(modeForRoute('guilde-prets')).toBe('guild');
    expect(modeForRoute('raffinage')).toBe('player');
  });
});
