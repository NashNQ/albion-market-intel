// Exemple utilisateur : « T2 raffiné → (T2 + T3 brut) → T3 raffiné → (T3 + T4 brut) → T4 raffiné, vendu ».
// Calcul de référence à la main : N = 100 T4_PLANKS, RRR 36,7 % à chaque étape, tarif de station 500,
// bruts achetés T2 = 10, T3 = 30, T4 = 80 ; vente T4_PLANKS 400 en ordre de vente, premium.
import { describe, expect, it } from 'vitest';
import { buildPriceIndex } from '../src/engine';
import { buildPreset, computeChain, type ChainContext, type Step } from '../src/engine/chain-index';
import { DEFAULT_SETTINGS, type MarketSnapshot, type RecipesFile, type Settings } from '../src/types';
import { NOW, RECIPES, ago } from './chain-fixture';

const RRR = 0.367;
// rrr = bonus / (1 + bonus) → bonus = RRR / (1 − RRR) ; tout le bonus est mis sur la ville spécialisée bois.
const BONUS = RRR / (1 - RRR);

const recipesWith = (bonus: number): RecipesFile => ({
  ...RECIPES,
  bonuses: { 'Fort Sterling': { refiningBase: bonus - 0.4, craftingBase: 0.18, modifiers: { wood: 0.4 } } },
});

// Ordre de vente : prix « sell » observé 401 → on se place 1 en dessous = 400.
const SNAP: MarketSnapshot = {
  updatedAt: ago(5),
  volumesUpdatedAt: ago(60),
  items: [
    {
      id: 'T4_PLANKS',
      prices: { Lymhurst: { sell: 401, sellAt: ago(30), buy: 350, buyAt: ago(30) } },
      volume7d: { Lymhurst: 100000 },
      avgPrice7d: {},
      historyDays: {},
    },
  ],
};

const SETTINGS: Settings = { ...DEFAULT_SETTINGS, premium: true, focus: false, dailyBonus: 0, stationFee: 500, mode: 'orders' };

function steps(recipes: RecipesFile): Step[] {
  const r = buildPreset(recipes, 'wood', 2, 4, 0);
  if (!r.ok) throw new Error(r.error);
  // Bruts achetés au prix fixé (prix manuel : indépendant du mode achat/ordre).
  const manual: Record<string, number> = { T2_WOOD: 10, T3_WOOD: 30, T4_WOOD: 80 };
  return r.steps.map((s) => ({
    ...s,
    craftAt: 'Fort Sterling',
    inputs: s.inputs.map((i) => (i.source.type === 'buy' ? { id: i.id, source: { type: 'buy', at: 'auto', manualPrice: manual[i.id] } } : i)),
  }));
}

function run(bonus: number) {
  const recipes = recipesWith(bonus);
  const ctx: ChainContext = { recipes, settings: SETTINGS, now: NOW, index: buildPriceIndex(SNAP, SETTINGS, NOW) };
  return computeChain({ steps: steps(recipes), final: { sellAt: 'Lymhurst', qty: 100, qtyMode: 'final' } }, ctx);
}

describe('exemple utilisateur T2 → T3 → T4 planches (calcul de référence)', () => {
  const res = run(BONUS);

  it('RRR 36,7 % à chaque étape', () => {
    for (const s of res.steps) expect(s.rrr).toBeCloseTo(0.367, 9);
  });

  it('quantités : 100 / 63,3 / 40,07 fabrications ; brut T4 126,6', () => {
    const [s2, s3, s4] = res.steps;
    expect(s4.crafts).toBeCloseTo(100, 9);
    expect(s4.inputs[0].need).toBeCloseTo(126.6, 9); // 2 × 100 × 0,633
    expect(s4.inputs[1].need).toBeCloseTo(63.3, 9); // T3 raffiné : 100 × 0,633
    expect(s3.crafts).toBeCloseTo(63.3, 9);
    expect(s3.inputs[0].need).toBeCloseTo(80.1378, 9); // 2 × 63,3 × 0,633
    expect(s2.crafts).toBeCloseTo(40.0689, 9);
    expect(s2.inputs[0].need).toBeCloseTo(25.3636137, 9);
  });

  it('coût ≈ 14 060,78, revenu 37 400, profit ≈ 23 339,22', () => {
    // Achats : 25,3636 × 10 + 80,1378 × 30 + 126,6 × 80 = 12 785,77
    expect(res.buyTotal).toBeCloseTo(12785.770137, 6);
    // Frais : (40,0689 × 4 + 63,3 × 8 + 100 × 16) × 0,1125 × 5 = 1 275,005
    expect(res.feeTotal).toBeCloseTo(1275.005025, 6);
    expect(res.buyTotal + res.feeTotal).toBeCloseTo(14060.775162, 6);
    // Revenu : 100 × 400 × (1 − 4 % − 2,5 %) = 37 400
    expect(res.revenue).toBeCloseTo(37400, 9);
    expect(res.profit).toBeCloseTo(23339.224838, 6);
    expect(res.complete).toBe(true);
  });

  it('valeurs réelles du jeu (0,18 + 0,40 → RRR = 0,58/1,58 ≈ 36,709 %) : profit ≈ 23 341,49', () => {
    const real = run(0.58);
    expect(real.steps[2].rrr).toBeCloseTo(0.58 / 1.58, 12);
    expect(real.profit).toBeCloseTo(23341.487185, 5);
  });
});
