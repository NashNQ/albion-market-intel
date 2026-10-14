import { describe, expect, it } from 'vitest';
import {
  activityFor,
  chartHorizon,
  cumulativeSeries,
  focusLimitedUnits,
  investorCumulative,
  paybackKind,
  simulateInvestment,
  unitEconomics,
  type InvestActivity,
  type InvestInput,
} from '../src/engine/invest';
import { buildPriceIndex } from '../src/engine';
import { NOW, RECIPES, RECIPE_LIST, SETTINGS, SNAPSHOT } from './invest-fixture';

const ACT: InvestActivity = { unitCost: 100, unitRevenue: 150, unitProfit: 50, q: 100 };
const IN: InvestInput = { capital: 100_000, levelingCost: 10_000, investorShare: 0.5, unitsPerDay: null, rotationDays: 2 };

function ok(out: ReturnType<typeof simulateInvestment>) {
  if (!out.ok) throw new Error('simulation en échec : ' + out.reason);
  return out;
}

describe('simulateInvestment', () => {
  it('scénario central calculé à la main', () => {
    const s = ok(simulateInvestment(ACT, IN));
    expect(s.available).toBe(90_000);
    const c = s.scenarios.central;
    // Fonds de roulement = 100 × 100 × 2 = 20 000 ≤ 90 000 → pas de limite de capital.
    expect(c.workingCapitalNeeded).toBe(20_000);
    expect(c.unitsPerDay).toBe(100);
    // Capacité automatique : c'est le marché (Q) qui limite, pas le membre.
    expect(c.limitedBy).toBe('market');
    expect(c.profitPerDay).toBe(5_000);
    expect(c.investorPerDay).toBe(2_500);
    // 2 jours de rotation + 100 000 / 2 500 = 42 jours ; coût de montée seul : 2 + 10 000 / 2 500 = 6.
    expect(c.paybackTotal).toBe(42);
    expect(c.paybackLeveling).toBe(6);
    // ROI 30 j = 2 500 × 28 / 100 000 − 1 = −30 % ; 90 j = 2 500 × 88 / 100 000 − 1 = +120 %.
    expect(c.roi30).toBeCloseTo(-0.3, 10);
    expect(c.roi90).toBeCloseTo(1.2, 10);
    // Avec la récupération du fonds de roulement : (70 000 + 20 000) / 100 000 − 1 = −10 %.
    expect(c.roi30Recovered).toBeCloseTo(-0.1, 10);
  });

  it('scénarios prudent et favorable', () => {
    const s = ok(simulateInvestment(ACT, IN));
    const p = s.scenarios.prudent;
    // Revenu 135, profit 35 ; volume 50 → limité par le marché ; 50 × 35 × 0,5 = 875/jour.
    expect(p.unitProfit).toBeCloseTo(35, 10);
    expect(p.unitsPerDay).toBe(50);
    expect(p.limitedBy).toBe('market');
    expect(p.investorPerDay).toBeCloseTo(875, 10);
    expect(p.paybackTotal).toBeCloseTo(2 + 100_000 / 875, 10);
    const f = s.scenarios.favorable;
    // Revenu 157,5, profit 57,5 ; capacité automatique → suit le volume ×1,2 = 120 unités (le volume favorable compte).
    // Fonds de roulement 100 × 120 × 2 = 24 000 ≤ 90 000 ; part 120 × 57,5 × 0,5 = 3 450/jour.
    expect(f.unitsPerDay).toBe(120);
    expect(f.limitedBy).toBe('market');
    expect(f.investorPerDay).toBeCloseTo(3_450, 10);
    expect(f.paybackTotal).toBeCloseTo(2 + 100_000 / 3_450, 10);
  });

  it('capital disponible < fonds de roulement → production limitée par le capital', () => {
    const s = ok(simulateInvestment(ACT, { ...IN, capital: 15_000, levelingCost: 5_000 }));
    const c = s.scenarios.central;
    // 10 000 disponibles ÷ (100 × 2) = 50 unités/jour.
    expect(c.limitedBy).toBe('capital');
    expect(c.unitsPerDay).toBe(50);
    expect(c.workingCapitalUsed).toBe(10_000);
    expect(c.investorPerDay).toBe(1_250);
    expect(c.paybackTotal).toBe(2 + 15_000 / 1_250);
  });

  it('capacité manuelle', () => {
    const c = ok(simulateInvestment(ACT, { ...IN, unitsPerDay: 20 })).scenarios.central;
    expect(c.unitsPerDay).toBe(20);
    expect(c.investorPerDay).toBe(500);
  });

  it('profit ≤ 0 → non rentable, aucun chiffre', () => {
    expect(simulateInvestment({ ...ACT, unitRevenue: 100, unitProfit: 0 }, IN)).toEqual({ ok: false, reason: 'unprofitable' });
    expect(simulateInvestment({ ...ACT, unitRevenue: 90, unitProfit: -10 }, IN)).toEqual({ ok: false, reason: 'unprofitable' });
  });

  it('scénario prudent déficitaire → point mort « jamais »', () => {
    const s = ok(simulateInvestment({ ...ACT, unitRevenue: 105, unitProfit: 5 }, IN));
    expect(s.scenarios.prudent.unitProfit).toBeLessThan(0);
    expect(s.scenarios.prudent.paybackTotal).toBeNull();
    expect(s.scenarios.prudent.roi30).toBe(-1);
    expect(paybackKind(s.scenarios.prudent.paybackTotal)).toBe('never');
  });

  it('payback infini : tout le capital part en montée', () => {
    const c = ok(simulateInvestment(ACT, { ...IN, capital: 10_000, levelingCost: 10_000 })).scenarios.central;
    expect(c.unitsPerDay).toBe(0);
    expect(c.paybackTotal).toBeNull();
    expect(c.paybackLeveling).toBeNull();
  });

  it('plus d’un an, entrées invalides, montée > capital', () => {
    const slow = ok(simulateInvestment(ACT, { ...IN, investorShare: 0.01 })).scenarios.central;
    expect(slow.paybackTotal).toBe(2 + 100_000 / 50);
    expect(paybackKind(slow.paybackTotal)).toBe('overYear');
    expect(simulateInvestment(ACT, { ...IN, capital: NaN })).toEqual({ ok: false, reason: 'invalid' });
    expect(simulateInvestment(ACT, { ...IN, investorShare: 1.5 })).toEqual({ ok: false, reason: 'invalid' });
    expect(simulateInvestment(ACT, { ...IN, levelingCost: 200_000 })).toEqual({ ok: false, reason: 'levelingExceedsCapital' });
  });

  it('série cumulée, horizon et focus', () => {
    const s = ok(simulateInvestment(ACT, IN));
    const series = cumulativeSeries(s.scenarios.central, 2, 5);
    expect(series).toEqual([0, 0, 0, 2_500, 5_000, 7_500]);
    expect(investorCumulative(s.scenarios.central, 2, 42)).toBe(100_000);
    // Prudent ≈ 116,3 j → horizon ⌈116,3 × 1,15⌉ = 134.
    expect(chartHorizon(s.scenarios)).toBe(134);
    expect(focusLimitedUnits(10_000, 250, 1)).toBe(40);
    expect(focusLimitedUnits(10_000, null)).toBeNull();
  });
});

describe('activité depuis le moteur', () => {
  const index = buildPriceIndex(SNAPSHOT, SETTINGS, NOW);
  const byId = (id: string) => RECIPE_LIST.find((r) => r.outputId === id)!;

  it('T6 planches : coût 600, revenu net 672, Q 100', () => {
    const a = activityFor(byId('T6_PLANKS'), index, RECIPES.bonuses, SETTINGS);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    // RRR nul : 4 × 100 + 200 = 600 ; vente instantanée 700 × (1 − 4 %) = 672.
    expect(a.activity.unitCost).toBeCloseTo(600, 10);
    expect(a.activity.unitRevenue).toBeCloseTo(672, 10);
    expect(a.activity.unitProfit).toBeCloseTo(72, 10);
    expect(a.activity.q).toBe(100);
  });

  it('prix manquants et route non rentable → raison, pas de chiffres', () => {
    expect(activityFor(byId('T7_PLANKS'), index, RECIPES.bonuses, SETTINGS)).toEqual({ ok: false, reason: 'missing' });
    expect(activityFor(byId('T5_PLANKS'), index, RECIPES.bonuses, SETTINGS)).toEqual({ ok: false, reason: 'unprofitable' });
  });

  it('économie unitaire même déficitaire', () => {
    const e = unitEconomics(byId('T5_PLANKS'), index, RECIPES.bonuses, SETTINGS)!;
    expect(e.unitCost).toBeCloseTo(240, 10);
    expect(e.unitRevenue).toBeCloseTo(182.4, 10);
    expect(unitEconomics(byId('T7_PLANKS'), index, RECIPES.bonuses, SETTINGS)).toBeNull();
  });
});
