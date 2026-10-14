// @vitest-environment jsdom
// Audit de la page « Investir » : cas limites du calcul, stockage hostile, résumé Discord.
import { describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { simulateInvestment, type InvestActivity, type InvestInput } from '../src/engine/invest';
import {
  INVEST_KEY,
  MAX_INVESTMENTS,
  decodeInvestment,
  encodeInvestment,
  isIsoDate,
  loadInvestments,
  sanitizeShared,
  useInvestments,
  type SavedInvestment,
} from '../src/ui/data/investStore';
import { discordSafe, discordSummary, fmtUnits } from '../src/ui/components/invest/shared';

const ACT: InvestActivity = { unitCost: 100, unitRevenue: 150, unitProfit: 50, q: 100 };
const IN: InvestInput = { capital: 100_000, levelingCost: 0, investorShare: 0.5, unitsPerDay: null, rotationDays: 2 };
const run = (a: InvestActivity, i: InvestInput) => {
  const o = simulateInvestment(a, i);
  if (!o.ok) throw new Error(o.reason);
  return o.scenarios;
};

describe('simulateInvestment — cas limites', () => {
  it('capital 0 → invalide (et non « point mort ≈ 0 jour »)', () => {
    expect(simulateInvestment(ACT, { ...IN, capital: 0 })).toEqual({ ok: false, reason: 'invalid' });
    expect(simulateInvestment(ACT, { ...IN, capital: Infinity })).toEqual({ ok: false, reason: 'invalid' });
    expect(simulateInvestment(ACT, { ...IN, rotationDays: NaN })).toEqual({ ok: false, reason: 'invalid' });
    expect(simulateInvestment(ACT, { ...IN, unitsPerDay: -1 })).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rotation 0 : une journée de fonds de roulement, aucun délai avant la première vente', () => {
    const c = run(ACT, { ...IN, investorShare: 1, rotationDays: 0 }).central;
    // FdR 100 × 100 × 1 = 10 000 ; part 100 × 50 = 5 000/jour ; point mort 100 000 / 5 000 = 20 j ; ROI 30 j = 150 000/100 000 − 1.
    expect(c.workingCapitalNeeded).toBe(10_000);
    expect(c.investorPerDay).toBe(5_000);
    expect(c.paybackTotal).toBe(20);
    expect(c.roi30).toBeCloseTo(0.5, 10);
  });

  it('part 0 % : jamais remboursé, ROI −100 % ; part 100 % : tout le profit', () => {
    const z = run(ACT, { ...IN, investorShare: 0, levelingCost: 10_000 }).central;
    expect(z.paybackTotal).toBeNull();
    expect(z.paybackLeveling).toBeNull();
    expect(z.roi30).toBe(-1);
    const f = run(ACT, { ...IN, investorShare: 1 }).central;
    expect(f.investorPerDay).toBe(f.profitPerDay);
  });

  it('capacité automatique : le marché limite, et le volume favorable ×1,2 s’applique', () => {
    const s = run(ACT, IN);
    expect(s.central.limitedBy).toBe('market');
    expect(s.prudent.unitsPerDay).toBe(50);
    expect(s.favorable.unitsPerDay).toBe(120);
  });

  it('capacité saisie : « capacité » seulement si elle est sous les ventes possibles', () => {
    const s = run(ACT, { ...IN, unitsPerDay: 80 });
    expect(s.central.limitedBy).toBe('capacity');
    expect(s.central.unitsPerDay).toBe(80);
    // Prudent : 50 vendables < 80 → marché.
    expect(s.prudent.limitedBy).toBe('market');
    expect(s.prudent.unitsPerDay).toBe(50);
    expect(s.favorable.unitsPerDay).toBe(80);
  });

  it('prix −10 % appliqué au revenu net (taxe proportionnelle au prix)', () => {
    // Prix 156,25, taxe 4 % → net 150 ; prix −10 % → 140,625 × 0,96 = 135 = 150 × 0,9.
    const p = run(ACT, IN).prudent;
    expect(p.unitRevenue).toBeCloseTo(140.625 * 0.96, 10);
  });

  it('aucun NaN/Infinity dans un scénario limité par le capital', () => {
    const s = run({ ...ACT, unitCost: 33 }, { ...IN, capital: 1_000, rotationDays: 3 });
    for (const v of Object.values(s)) {
      for (const k of ['unitsPerDay', 'investorPerDay', 'roi30', 'roi90', 'roi30Recovered', 'workingCapitalUsed'] as const)
        expect(Number.isFinite(v[k])).toBe(true);
      expect(v.limitedBy).toBe('capital');
    }
  });
});

describe('affichage', () => {
  it('unités : entier si entier, sinon une décimale', () => {
    expect(fmtUnits(100)).toBe('100');
    expect(fmtUnits(83.333)).toBe('83,3');
    expect(fmtUnits(NaN)).toBe('—');
  });

  it('résumé Discord : un nom hostile ne mentionne personne et ne casse pas la mise en forme', () => {
    expect(discordSafe('@everyone **x**')).toBe('@​everyone \\*\\*x\\*\\*');
    const t = discordSummary({ member: '@here\n<@123>', activity: 'Planches (T6)', capital: 1, investorShare: 0.5, payback: 10, roi30: 0, url: 'https://x/#/investir?i=a' });
    expect(t).not.toMatch(/@here|<@123>|@everyone/);
    expect(t.split('\n')).toHaveLength(5);
    expect(t).toContain('Planches (T6)');
  });
});

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
const BASE = { v: 1, member: 'A', outputId: 'T6_PLANKS', capital: 1000, levelingCost: 0, investorShare: 0.5, unitsPerDay: null, rotationDays: 2, startDate: '2026-10-01', startUnitProfit: 10, startUnitCost: 5 };

describe('stockage et partage hostiles', () => {
  it('dates impossibles refusées (Date.parse accepte 2026-02-31)', () => {
    expect(isIsoDate('2026-02-31')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(sanitizeShared({ ...BASE, startDate: '2026-02-31' })!.startDate).not.toBe('2026-02-31');
  });

  it('JSON hostile, valeurs négatives ou énormes, base64 invalide', () => {
    const s = mem();
    s.setItem(INVEST_KEY, JSON.stringify({ items: [null, 1, 'x', { ...BASE, capital: -1 }, { ...BASE, capital: 1e300 }, { ...BASE, outputId: '<img>' }, { ...BASE, id: 'ok' }, { ...BASE, __proto__: { v: 1 } }] }));
    const list = loadInvestments(s);
    expect(list.map((x) => x.id)).toContain('ok');
    expect(list.every((x) => x.capital >= 0 && x.capital <= 1e12)).toBe(true);
    s.setItem(INVEST_KEY, '{not json');
    expect(loadInvestments(s)).toEqual([]);
    expect(decodeInvestment('%%%')).toBeNull();
    expect(decodeInvestment('a')).toBeNull();
    expect(decodeInvestment('')).toBeNull();
    expect(decodeInvestment(encodeInvestment({ ...BASE, investorShare: 7 } as never))!.investorShare).toBe(0.5);
  });

  it('50 entrées au plus à la lecture', () => {
    const s = mem();
    s.setItem(INVEST_KEY, JSON.stringify(Array.from({ length: 80 }, (_, i) => ({ ...BASE, id: 'i' + i }))));
    expect(loadInvestments(s)).toHaveLength(MAX_INVESTMENTS);
  });

  it('une entrée hors limites est refusée à l’enregistrement au lieu de disparaître au rechargement', () => {
    window.localStorage.clear();
    const { result } = renderHook(() => useInvestments());
    const big: SavedInvestment = { ...(BASE as Omit<SavedInvestment, 'id' | 'createdAt'>), v: 1, id: 'big', capital: 1e13, createdAt: new Date().toISOString() };
    let err: string | null = null;
    act(() => {
      err = result.current.upsert(big);
    });
    expect(err).toMatch(/hors limites/);
    expect(result.current.items).toHaveLength(0);
    act(() => {
      err = result.current.upsert({ ...big, capital: 1e6 });
    });
    expect(err).toBeNull();
    expect(loadInvestments()).toHaveLength(1);
  });
});
