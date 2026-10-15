import { describe, expect, it } from 'vitest';
import type { MarketItem } from '../src/types';
import {
  DEFAULT_SIGMA,
  FALLBACK_DYNAMICS,
  TREND_MAX,
  addDays,
  compareUrgency,
  daysBetween,
  evaluateLoan,
  loanHealth,
  priceDynamics,
  prudentValue,
  seizedResult,
  summarizeLoans,
  valueCollateral,
  type PriceDynamics,
} from '../src/engine/pawn';
import { DAY_MS, startOfUtcDay, type DailyPoint } from '../src/engine/history-metrics';

const NOW = new Date('2026-10-15T12:00:00.000Z');
const TODAY = '2026-10-15';
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const RULES = { maxLtv: 0.6, safetyMargin: 0.1, maxTermDays: 14 };
const dyn = (trend: number, sigma: number): PriceDynamics => ({ trend, rawTrend: trend, sigma, days: 30, fromHistory: true });

describe('valeur du gage', () => {
  const item: MarketItem = {
    id: 'T6_PLANKS',
    prices: {
      Martlock: { sell: 1200, sellAt: ago(0.5), buy: 1000, buyAt: ago(0.5) },
      // Ordre d'achat à 1 100 > 3 × 300 (moyenne 7 j) : suspect, écarté (il gonflerait le gage).
      Lymhurst: { sell: null, sellAt: null, buy: 1100, buyAt: ago(0.5) },
      // Plus cher mais périmé (10 h > 6 h) : un prix frais existe, il est préféré.
      Bridgewatch: { sell: null, sellAt: null, buy: 1050, buyAt: ago(10) },
      // Le Black Market ne sert jamais pour la mise en vente.
      'Black Market': { sell: 5000, sellAt: ago(0.5), buy: null, buyAt: null },
    },
    volume7d: {},
    avgPrice7d: { Lymhurst: 300 },
    historyDays: {},
  };

  it('revente rapide = meilleur ordre d’achat × (1 − taxe) ; mise en vente = vente min × (1 − taxe − 2,5 %)', () => {
    const v = valueCollateral(item, 10, { premium: true, maxPriceAgeH: 6, now: NOW });
    expect(v.tax).toBe(0.04);
    expect(v.quick?.loc).toBe('Martlock');
    expect(v.quick?.unitNet).toBeCloseTo(960, 9); // 1 000 × 0,96
    expect(v.quick?.total).toBeCloseTo(9600, 9);
    expect(v.quick?.stale).toBe(false);
    expect(v.listing?.loc).toBe('Martlock');
    expect(v.listing?.total).toBeCloseTo(11220, 9); // 1 200 × 0,935 × 10
    expect(v.suspectExcluded).toBe(1);
    // Sans premium : taxe 8 %.
    const std = valueCollateral(item, 10, { premium: false, maxPriceAgeH: 6, now: NOW });
    expect(std.quick?.total).toBeCloseTo(9200, 9);
    expect(std.listing?.total).toBeCloseTo(1200 * 0.895 * 10, 9);
  });

  it('seuls des prix périmés : utilisés mais signalés ; aucun prix : null (rien inventé)', () => {
    const stale: MarketItem = { ...item, prices: { Bridgewatch: item.prices.Bridgewatch }, avgPrice7d: {} };
    const v = valueCollateral(stale, 1, { premium: true, maxPriceAgeH: 6, now: NOW });
    expect(v.quick?.stale).toBe(true);
    expect(v.quick?.ageH).toBeCloseTo(10, 9);
    expect(v.listing).toBeNull();
    const none = valueCollateral({ ...item, prices: {} }, 5, { premium: true, maxPriceAgeH: 6, now: NOW });
    expect(none.quick).toBeNull();
    expect(none.listing).toBeNull();
    expect(valueCollateral(undefined, 5, { premium: true, maxPriceAgeH: 6, now: NOW }).quick).toBeNull();
    // Plus d'une semaine : ignoré.
    const ancient: MarketItem = { ...item, prices: { Martlock: { sell: 10, sellAt: ago(200), buy: 9, buyAt: ago(200) } } };
    expect(valueCollateral(ancient, 1, { premium: true, maxPriceAgeH: 6, now: NOW }).quick).toBeNull();
  });
});

describe('dû, LTV, prêt maximal', () => {
  it('600 000 ag prêtés à 10 % sur un gage de 1 000 000 ag', () => {
    const ev = evaluateLoan({ amount: 600_000, rate: 0.1, startDate: TODAY }, 1_000_000, dyn(0, 0), RULES, NOW);
    expect(ev.due).toBeCloseTo(660_000, 6);
    expect(ev.interest).toBeCloseTo(60_000, 6);
    expect(ev.ltv).toBeCloseTo(0.6, 12);
    expect(ev.maxLoan).toBeCloseTo(600_000, 6);
  });
});

describe('date limite conseillée et retour idéal', () => {
  const terms = { amount: 600_000, rate: 0.1, startDate: TODAY };

  it('tendance −1 %/jour, volatilité nulle : 0,9 × e^(−0,01 t) < 0,66 → t > 31,02 → jour 32', () => {
    const ev = evaluateLoan(terms, 1_000_000, dyn(-0.01, 0), RULES, NOW);
    expect(ev.limitDay).toBe(32);
    expect(ev.limitDate).toBe('2026-11-16');
    // Durée max 14 jours avant la date limite : retour idéal = début + 14.
    expect(ev.idealDate).toBe('2026-10-29');
    expect(ev.insufficientNow).toBe(false);
    expect(ev.projection[0]).toBeCloseTo(900_000, 6);
    expect(ev.projection[10]).toBeCloseTo(900_000 * Math.exp(-0.1), 6);
  });

  it('volatilité 5 %/jour, tendance nulle : √t > ln(0,9/0,66)/(1,28 × 0,05) = 4,846 → t > 23,49 → jour 24', () => {
    const ev = evaluateLoan(terms, 1_000_000, dyn(0, 0.05), RULES, NOW);
    expect(ev.limitDay).toBe(24);
    expect(prudentValue(1_000_000, dyn(0, 0.05), 4)).toBeCloseTo(1_000_000 * Math.exp(-1.28 * 0.05 * 2), 6);
  });

  it('tendance −3 %/jour : date limite (jour 11) avant la durée max → retour idéal = date limite', () => {
    const ev = evaluateLoan(terms, 1_000_000, dyn(-0.03, 0), RULES, NOW);
    expect(ev.limitDay).toBe(11); // 0,31015 / 0,03 = 10,34
    expect(ev.limitDate).toBe('2026-10-26');
    expect(ev.idealDate).toBe('2026-10-26');
    expect(loanHealth('open', ev)).toBe('covered');
  });

  it('sans historique : tendance 0, volatilité 3 %/jour → √t > 0,31015/0,0384 = 8,077 → jour 66', () => {
    const d = priceDynamics(undefined, NOW.getTime());
    expect(d).toEqual(FALLBACK_DYNAMICS);
    expect(d.sigma).toBe(DEFAULT_SIGMA);
    const ev = evaluateLoan(terms, 1_000_000, d, RULES, NOW);
    expect(ev.dynamics.fromHistory).toBe(false);
    expect(ev.limitDay).toBe(66);
  });

  it('gage déjà insuffisant : 700 000 × 0,9 = 630 000 < 660 000 dû', () => {
    const ev = evaluateLoan(terms, 700_000, dyn(0, 0), RULES, NOW);
    expect(ev.insufficientNow).toBe(true);
    expect(ev.limitDay).toBe(0);
    expect(ev.limitDate).toBe(TODAY);
    expect(ev.idealDate).toBe('2026-10-16'); // jamais avant demain
    expect(loanHealth('open', ev)).toBe('insufficient');
  });

  it('gage très large : aucune date limite sur 90 jours', () => {
    const ev = evaluateLoan(terms, 10_000_000, dyn(0, 0.02), RULES, NOW);
    expect(ev.limitDay).toBeNull();
    expect(ev.coveredBeyondHorizon).toBe(true);
    expect(ev.idealDate).toBe('2026-10-29');
    expect(ev.projection).toHaveLength(91);
  });

  it('prêt ancien : retour idéal ramené à demain ; échéance dépassée → « En retard »', () => {
    const ev = evaluateLoan({ ...terms, startDate: '2026-09-01', dueDate: '2026-10-14' }, 1_000_000, dyn(0, 0), RULES, NOW);
    expect(ev.idealDate).toBe('2026-10-16');
    expect(ev.overdue).toBe(true);
    expect(loanHealth('open', ev)).toBe('overdue');
    expect(loanHealth('repaid', ev)).toBe('repaid');
    expect(loanHealth('seized', ev)).toBe('seized');
    // Échéance aujourd'hui : pas encore en retard.
    expect(evaluateLoan({ ...terms, dueDate: TODAY }, 1_000_000, dyn(0, 0), RULES, NOW).overdue).toBe(false);
  });

  it('« À surveiller » si la date limite tombe dans 3 jours ou moins ; « non évalué » sans prix', () => {
    // 0,9 × e^(−0,1 t) < 0,66 → t > 3,10 → jour 4 (couvert) ; avec −0,11 : t > 2,82 → jour 3 (à surveiller).
    expect(loanHealth('open', evaluateLoan(terms, 1_000_000, dyn(-0.1, 0), RULES, NOW))).toBe('covered');
    expect(loanHealth('open', evaluateLoan(terms, 1_000_000, { ...dyn(-0.11, 0) }, RULES, NOW))).toBe('watch');
    const none = evaluateLoan(terms, null, dyn(0, 0), RULES, NOW);
    expect(none.v0).toBeNull();
    expect(none.ltv).toBeNull();
    expect(none.projection).toEqual([]);
    expect(loanHealth('open', none)).toBe('unpriced');
  });
});

describe('dynamique du prix (historique 30 j)', () => {
  const day0 = startOfUtcDay(NOW.getTime()) - 9 * DAY_MS;
  const series = (prices: number[]): DailyPoint[] => prices.map((price, i) => ({ day: day0 + i * DAY_MS, price, volume: 10 }));

  it('baisse régulière de 1 %/jour : tendance ln(0,99), volatilité nulle', () => {
    const d = priceDynamics(series(Array.from({ length: 10 }, (_, i) => 1000 * 0.99 ** i)), NOW.getTime());
    expect(d.fromHistory).toBe(true);
    expect(d.days).toBe(10);
    expect(d.trend).toBeCloseTo(Math.log(0.99), 10);
    expect(d.sigma).toBeCloseTo(0, 10);
  });

  it('prix en dents de scie 100/110 : volatilité = ln(1,1) × √(4/3)', () => {
    const d = priceDynamics(series([100, 110, 100, 110, 100]), NOW.getTime() - 5 * DAY_MS);
    expect(d.sigma).toBeCloseTo(Math.log(1.1) * Math.sqrt(4 / 3), 10);
  });

  it('un trou de 4 jours compte comme 4 jours de variation (rendement ÷ √4)', () => {
    const pts: DailyPoint[] = [0, 1, 2, 6, 7].map((k, i) => ({ day: day0 + k * DAY_MS, price: [100, 100, 100, 100 * Math.exp(0.2), 100 * Math.exp(0.2)][i], volume: 1 }));
    const d = priceDynamics(pts, day0 + 7 * DAY_MS);
    // Rendements : 0, 0, 0,2 / 2 = 0,1, 0 → écart-type (n − 1) de [0, 0, 0,1, 0] = 0,05.
    expect(d.sigma).toBeCloseTo(0.05, 10);
  });

  it('hausse jamais comptée (tendance retenue 0) ; moins de 5 jours → repli', () => {
    const d = priceDynamics(series(Array.from({ length: 10 }, (_, i) => 1000 * 1.05 ** i)), NOW.getTime());
    expect(d.rawTrend).toBeCloseTo(Math.log(1.05), 10);
    expect(d.trend).toBe(TREND_MAX);
    expect(priceDynamics(series([1, 2, 3, 4]), NOW.getTime() - 6 * DAY_MS).fromHistory).toBe(false);
  });
});

describe('synthèse, urgence, saisie', () => {
  const loans = [
    { itemId: 'A', qty: 10, amount: 600, rate: 0.1, dueDate: '2026-10-20', status: 'open' as const },
    { itemId: 'B', qty: 1, amount: 1000, rate: 0.2, dueDate: '2026-10-10', status: 'open' as const },
    { itemId: 'C', qty: 2, amount: 500, rate: 0, dueDate: '2026-10-30', status: 'open' as const },
    { itemId: 'A', qty: 5, amount: 9999, rate: 0, dueDate: '2026-10-01', status: 'repaid' as const },
  ];
  const valueOf = (id: string) => (id === 'A' ? 100 : id === 'B' ? 1100 : null);

  it('summarizeLoans : seuls les prêts en cours comptent', () => {
    const s = summarizeLoans(loans, valueOf, NOW);
    expect(s.open).toBe(3);
    expect(s.lentOpen).toBe(2100);
    expect(s.dueOpen).toBeCloseTo(660 + 1200 + 500, 9);
    expect(s.collateralValue).toBe(1000 + 1100);
    expect(s.atRisk).toBe(1); // B : 1 100 < 1 200 dû ; A : 1 000 ≥ 660
    expect(s.overdue).toBe(1);
    expect(s.unpriced).toBe(1);
    // Avec 50 % de marge : A 500 < 660, B 550 < 1 200.
    expect(summarizeLoans(loans, valueOf, NOW, { safetyMargin: 0.5 }).atRisk).toBe(2);
  });

  it('tri par urgence et gain/perte d’une saisie', () => {
    const base = evaluateLoan({ amount: 1, rate: 0, startDate: TODAY }, 100, dyn(0, 0), RULES, NOW);
    const items = [
      { health: 'covered' as const, ev: { ...base, limitDay: 40 }, dueDate: '2026-10-20' },
      { health: 'repaid' as const, ev: base, dueDate: '2026-10-01' },
      { health: 'overdue' as const, ev: base, dueDate: '2026-10-10' },
      { health: 'covered' as const, ev: { ...base, limitDay: 12 }, dueDate: '2026-10-25' },
      { health: 'watch' as const, ev: { ...base, limitDay: 2 }, dueDate: '2026-10-25' },
    ];
    expect(items.sort(compareUrgency).map((x) => `${x.health}${x.ev.limitDay ?? ''}`)).toEqual(['overdue', 'watch2', 'covered12', 'covered40', 'repaid']);
    expect(seizedResult(1200, 1000)).toBe(200);
    expect(seizedResult(800, 1000)).toBe(-200);
    expect(seizedResult(null, 1000)).toBeNull();
  });

  it('dates en jours UTC', () => {
    expect(addDays('2026-10-25', 14)).toBe('2026-11-08');
    expect(daysBetween('2026-10-15', '2026-11-08')).toBe(24);
  });
});
