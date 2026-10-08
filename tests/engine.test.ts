import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  LOCATIONS,
  PRODUCTION_LOCATIONS,
  type BonusTable,
  type MarketItem,
  type MarketSnapshot,
  type PricePoint,
  type Recipe,
  type RecipesFile,
  type Settings,
} from '../src/types';
import {
  bestRoute,
  buildPriceIndex,
  confidence,
  rankAll,
  recipeRrr,
  rrr,
  unitCost,
  unitRevenue,
} from '../src/engine';
import routeFixture from './fixtures/engine-route.json';

const NOW = new Date('2026-10-08T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const S = (o: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...o });

function pp(sell: number | null, buy: number | null, ageH = 0.5, buyAgeH = ageH): PricePoint {
  return { sell, sellAt: sell == null ? null : hoursAgo(ageH), buy, buyAt: buy == null ? null : hoursAgo(buyAgeH) };
}
function item(id: string, prices: MarketItem['prices'], extra: Partial<MarketItem> = {}): MarketItem {
  return { id, prices, volume7d: {}, avgPrice7d: {}, historyDays: {}, ...extra };
}
const snap = (items: MarketItem[]): MarketSnapshot => ({ updatedAt: NOW.toISOString(), volumesUpdatedAt: null, items });

// ---------------------------------------------------------------------------
// RRR
// ---------------------------------------------------------------------------
describe('rrr', () => {
  it('formule bonus / (1 + bonus)', () => {
    expect(rrr(0.18)).toBeCloseTo(0.1525, 3);
    expect(rrr(0.58)).toBeCloseTo(0.367, 3);
    expect(rrr(1.17)).toBeCloseTo(0.539, 3);
  });

  it('dépend du lieu via la BonusTable', () => {
    const bonuses: BonusTable = {
      'Fort Sterling': { refiningBase: 0.18, craftingBase: 0.18, modifiers: { wood: 0.4 } },
      Brecilien: { refiningBase: 0.18, craftingBase: 0.18, modifiers: { bag: 0.15 } },
    };
    const wood = { kind: 'refining' as const, bonusKey: 'wood' };
    const bag = { kind: 'crafting' as const, bonusKey: 'bag' };
    expect(recipeRrr(wood, 'Fort Sterling', bonuses, S())).toBeCloseTo(0.367, 3);
    expect(recipeRrr(wood, 'Brecilien', bonuses, S())).toBeCloseTo(0.1525, 3);
    expect(recipeRrr(wood, 'Thetford', bonuses, S())).toBeCloseTo(0.1525, 3); // absent → 0.18
    expect(recipeRrr(bag, 'Brecilien', bonuses, S())).toBeCloseTo(0.33 / 1.33, 6);
    // focus 0.59 + bonus quotidien : 0.18 + 0.40 + 0.59 = 1.17 → 0.539
    expect(recipeRrr(wood, 'Fort Sterling', bonuses, S({ focus: true }))).toBeCloseTo(0.539, 3);
    expect(recipeRrr(wood, 'Fort Sterling', bonuses, S({ dailyBonus: 0.1 }))).toBeCloseTo(0.68 / 1.68, 6);
  });
});

// ---------------------------------------------------------------------------
// Exemple chiffré à la main : T5_PLANKS à Fort Sterling
// ---------------------------------------------------------------------------
describe('exemple chiffré T5_PLANKS @ Fort Sterling', () => {
  const recipe: Recipe = {
    outputId: 'T5_PLANKS',
    outputQty: 1,
    inputs: [
      { id: 'T5_WOOD', qty: 3, returnable: true },
      { id: 'T4_PLANKS', qty: 1, returnable: true },
    ],
    itemValue: 32,
    kind: 'refining',
    bonusKey: 'wood',
    category: 'resources',
    subcategory: 'planks',
    tier: 5,
    enchant: 0,
  };
  const recipes: RecipesFile = {
    generatedAt: NOW.toISOString(),
    meta: [],
    recipes: [recipe],
    bonuses: { 'Fort Sterling': { refiningBase: 0.18, craftingBase: 0.18, modifiers: { wood: 0.4 } } },
  };
  const snapshot = snap([
    item('T5_WOOD', { 'Fort Sterling': pp(100, 90, 0.5) }),
    item('T4_PLANKS', { 'Fort Sterling': pp(150, 140, 2) }),
    item(
      'T5_PLANKS',
      { 'Fort Sterling': pp(620, 600, 3.5) },
      { volume7d: { 'Fort Sterling': 500 }, avgPrice7d: { 'Fort Sterling': 580 }, historyDays: { 'Fort Sterling': 7 } },
    ),
  ]);

  it('donne coût, revenu, profit, Q, C et score attendus (réglages par défaut)', () => {
    // Réglages par défaut : premium, pas de focus, dailyBonus 0, stationFee 400, instant,
    // marketShare 0.1, dailyCap 1000, maxPriceAgeH 6, minVolume 20.
    //
    // 1. RRR à Fort Sterling : bonus = 0.18 (base raffinage) + 0.40 (wood) = 0.58
    //    rrr = 0.58 / 1.58 = 0.3670886
    //    (les autres lieux, absents de la table, valent 0.18 → 0.1525 : Fort Sterling gagne.)
    const expRrr = 0.58 / 1.58;
    // 2. Achat (instant = sell_price_min) : T5_WOOD 100, T4_PLANKS 150, tous deux retournables.
    //    matières = (3 × 100 + 1 × 150) × (1 − 0.3670886) = 450 × 0.6329114 = 284.81013
    // 3. Frais de station = itemValue 32 × 0.1125 × 400 / 100 = 14.4
    // 4. Coût unitaire = (284.81013 + 14.4) / 1 = 299.21013
    const expCost = 450 * (1 - expRrr) + 14.4;
    expect(expCost).toBeCloseTo(299.21013, 4);
    // 5. Vente (instant = buy_price_max) : 600 ; taxe premium 4 %, pas de frais d'ordre
    //    revenu = 600 × 0.96 = 576
    const expRevenue = 576;
    // 6. Profit unitaire = 576 − 299.21013 = 276.78987
    const expProfit = expRevenue - expCost;
    // 7. Q = min(500 × 0.1, 1000) = 50
    // 8. Prix le plus vieux utilisé : vente 3.5 h → C = 1 − 0.5 × (3.5 − 1)/(6 − 1) = 0.75
    // 9. Score = 276.78987 × 50 × 0.75 = 10379.62
    const { refining, crafting, stats } = rankAll(snapshot, recipes, S(), NOW);
    expect(crafting).toHaveLength(0);
    expect(refining).toHaveLength(1);
    const r = refining[0];
    expect(r.craftAt).toBe('Fort Sterling');
    expect(r.sellAt).toBe('Fort Sterling');
    expect(r.buyFrom).toEqual({ T5_WOOD: 'Fort Sterling', T4_PLANKS: 'Fort Sterling' });
    expect(r.rrr).toBeCloseTo(0.3670886, 6);
    expect(r.unitCost).toBeCloseTo(299.21013, 4);
    expect(r.unitRevenue).toBeCloseTo(576, 6);
    expect(r.unitProfit).toBeCloseTo(276.78987, 4);
    expect(r.volume).toBe(500);
    expect(r.q).toBe(50);
    expect(r.oldestPriceAgeH).toBeCloseTo(3.5, 6);
    expect(r.confidence).toBeCloseTo(0.75, 6);
    expect(r.score).toBeCloseTo(10379.62, 1);
    expect(r.flags).toEqual([]);
    expect(stats).toEqual({ evaluated: 1, missing: 0, stale: 0, suspect: 0, lowVolume: 0 });
  });

  it('fonctions unitaires cohérentes avec l’exemple', () => {
    expect(unitCost(recipe, [100, 150], 0.58 / 1.58, S())).toBeCloseTo(299.21013, 4);
    expect(unitRevenue(600, S())).toBe(576);
    expect(unitRevenue(600, S({ premium: false }))).toBe(552);
    expect(unitRevenue(600, S({ mode: 'orders' }))).toBeCloseTo(600 * (1 - 0.04 - 0.025), 9);
    // Ingrédient non retournable : pas de réduction RRR
    const nr = { ...recipe, inputs: recipe.inputs.map((i) => ({ ...i, returnable: false })) };
    expect(unitCost(nr, [100, 150], 0.5, S())).toBeCloseTo(464.4, 6);
    // outputQty divise le coût
    expect(unitCost({ ...nr, outputQty: 2 }, [100, 150], 0.5, S())).toBeCloseTo(232.2, 6);
  });
});

// ---------------------------------------------------------------------------
// Confiance
// ---------------------------------------------------------------------------
describe('confidence', () => {
  it('1 jusqu’à 1 h, puis linéaire vers 0.5', () => {
    expect(confidence(0, 6)).toBe(1);
    expect(confidence(1, 6)).toBe(1);
    expect(confidence(3.5, 6)).toBeCloseTo(0.75, 9);
    expect(confidence(6, 6)).toBeCloseTo(0.5, 9);
    expect(confidence(20, 6)).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// Filtres
// ---------------------------------------------------------------------------
describe('filtres', () => {
  const recipe: Recipe = {
    outputId: 'OUT',
    outputQty: 1,
    inputs: [{ id: 'IN', qty: 2, returnable: true }],
    itemValue: 16,
    kind: 'refining',
    bonusKey: 'ore',
    category: 'resources',
    subcategory: 'metalbar',
    tier: 4,
    enchant: 0,
  };
  const recipes: RecipesFile = { generatedAt: '', meta: [], recipes: [recipe], bonuses: {} };
  const outGood = (p: PricePoint, extra: Partial<MarketItem> = {}) =>
    item('OUT', { Martlock: p }, {
      volume7d: { Martlock: 100 },
      avgPrice7d: { Martlock: 500 },
      historyDays: { Martlock: 7 },
      ...extra,
    });
  const inGood = item('IN', { Martlock: pp(100, 90) });

  it('cas témoin : classé', () => {
    const r = rankAll(snap([inGood, outGood(pp(520, 500))]), recipes, S(), NOW);
    expect(r.refining).toHaveLength(1);
  });

  it('prix 0 ou null exclu', () => {
    for (const bad of [pp(0, 0), pp(null, null), pp(520, 0)]) {
      const r = rankAll(snap([inGood, outGood(bad)]), recipes, S(), NOW);
      expect(r.refining).toHaveLength(0);
    }
    const r2 = rankAll(snap([item('IN', { Martlock: pp(0, null) }), outGood(pp(520, 500))]), recipes, S(), NOW);
    expect(r2.refining).toHaveLength(0);
    expect(r2.stats.missing).toBe(1);
  });

  it('prix plus vieux que maxPriceAgeH exclu (compté en stale)', () => {
    const r = rankAll(snap([inGood, outGood(pp(520, 500, 7))]), recipes, S(), NOW);
    expect(r.refining).toHaveLength(0);
    expect(r.stats.stale).toBe(1);
    const r2 = rankAll(snap([item('IN', { Martlock: pp(100, 90, 6.5) }), outGood(pp(520, 500))]), recipes, S(), NOW);
    expect(r2.refining).toHaveLength(0);
    expect(r2.stats.stale).toBe(1);
    // relever maxPriceAgeH le réintègre
    expect(rankAll(snap([inGood, outGood(pp(520, 500, 7))]), recipes, S({ maxPriceAgeH: 12 }), NOW).refining).toHaveLength(1);
  });

  it('prix suspect (> 3 × moyenne 7 j) exclu', () => {
    const r = rankAll(snap([inGood, outGood(pp(2000, 1600))]), recipes, S(), NOW);
    expect(r.refining).toHaveLength(0);
    expect(r.stats.suspect).toBe(1);
  });

  it('volume < minVolume ou null exclu', () => {
    const low = rankAll(snap([inGood, outGood(pp(520, 500), { volume7d: { Martlock: 19 } })]), recipes, S(), NOW);
    expect(low.refining).toHaveLength(0);
    expect(low.stats.lowVolume).toBe(1);
    const nul = rankAll(snap([inGood, outGood(pp(520, 500), { volume7d: { Martlock: null } })]), recipes, S(), NOW);
    expect(nul.refining).toHaveLength(0);
    expect(nul.stats.lowVolume).toBe(1);
    const cap = rankAll(snap([inGood, outGood(pp(520, 500), { volume7d: { Martlock: 50000 } })]), recipes, S(), NOW);
    expect(cap.refining[0].q).toBe(1000); // plafonné par dailyCap
  });

  it('ingrédient manquant compté dans missing', () => {
    const r = rankAll(snap([outGood(pp(520, 500))]), recipes, S(), NOW);
    expect(r.refining).toHaveLength(0);
    expect(r.stats).toEqual({ evaluated: 1, missing: 1, stale: 0, suspect: 0, lowVolume: 0 });
  });

  it('historique mince : C ≤ 0.5 et drapeau thin-history', () => {
    const r = rankAll(snap([inGood, outGood(pp(520, 500), { historyDays: { Martlock: 4 } })]), recipes, S(), NOW);
    expect(r.refining[0].confidence).toBe(0.5);
    expect(r.refining[0].flags).toContain('thin-history');
  });

  it('profit ≤ 0 non classé', () => {
    const r = rankAll(snap([inGood, outGood(pp(120, 100))]), recipes, S(), NOW);
    expect(r.refining).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Route sur fixture 3 lieux
// ---------------------------------------------------------------------------
describe('route (fixture 3 lieux)', () => {
  const snapshot = routeFixture.snapshot as unknown as MarketSnapshot;
  const recipes = routeFixture.recipes as unknown as RecipesFile;
  const now = new Date(routeFixture.now);

  it('mode instant : achat le moins cher, production au plus fort RRR, vente au meilleur net', () => {
    const { crafting, blackMarket } = rankAll(snapshot, recipes, S(), now);
    expect(crafting).toHaveLength(1);
    const r = crafting[0];
    // cuir : sell min Brecilien 90 < Caerleon 110 < Martlock 120 ; tissu : Martlock 50
    expect(r.buyFrom).toEqual({ T4_LEATHER: 'Brecilien', T4_CLOTH: 'Martlock' });
    // sac : Brecilien 0.18 + 0.15 = 0.33 > 0.18 ailleurs
    expect(r.craftAt).toBe('Brecilien');
    expect(r.rrr).toBeCloseTo(0.33 / 1.33, 9);
    // vente instantanée (buy max hors BM) : Caerleon 2400
    expect(r.sellAt).toBe('Caerleon');
    expect(r.unitRevenue).toBeCloseTo(2400 * 0.96, 9);
    const expCost = (8 * 90 + 8 * 50) * (1 - 0.33 / 1.33) + 256 * 0.1125 * 4;
    expect(r.unitCost).toBeCloseTo(expCost, 9);
    expect(r.volume).toBe(200);
    expect(r.q).toBe(20);
    expect(r.flags).toEqual(expect.arrayContaining(['red-zone', 'mists']));
    expect(r.flags).not.toContain('thin-history');

    // Black Market : classement séparé
    expect(blackMarket).toHaveLength(1);
    const bm = blackMarket[0];
    expect(bm.sellAt).toBe('Black Market');
    expect(bm.unitRevenue).toBeCloseTo(3500 * 0.96, 9);
    expect(bm.score).toBeNull();
    expect(bm.volume).toBeNull();
    expect(bm.q).toBeNull();
    expect(bm.flags).toContain('red-zone');
  });

  it('le Black Market n’est jamais lieu d’achat ni de vente dans le classement principal', () => {
    const { crafting } = rankAll(snapshot, recipes, S(), now);
    expect(crafting[0].sellAt).not.toBe('Black Market');
    expect(Object.values(crafting[0].buyFrom)).not.toContain('Black Market');
  });

  it('mode orders vs instant', () => {
    const settings = S({ mode: 'orders' });
    const { crafting, blackMarket } = rankAll(snapshot, recipes, settings, now);
    const r = crafting[0];
    // achat par ordre = (buy + 1) × 1.025 : cuir Caerleon (60), tissu Brecilien (30)
    expect(r.buyFrom).toEqual({ T4_LEATHER: 'Caerleon', T4_CLOTH: 'Brecilien' });
    const expCost = (8 * 61 * 1.025 + 8 * 31 * 1.025) * (1 - 0.33 / 1.33) + 115.2;
    expect(r.unitCost).toBeCloseTo(expCost, 9);
    // vente par ordre = sell − 1 : Caerleon 2999, net × (1 − 0.04 − 0.025)
    expect(r.sellAt).toBe('Caerleon');
    expect(r.unitRevenue).toBeCloseTo(2999 * 0.935, 9);
    // BM : toujours le buy du BM, sans frais d'ordre
    expect(blackMarket[0].unitRevenue).toBeCloseTo(3500 * 0.96, 9);

    const inst = rankAll(snapshot, recipes, S(), now).crafting[0];
    expect(r.unitProfit).toBeGreaterThan(inst.unitProfit);
  });

  it('bestRoute exposé directement', () => {
    const settings = S();
    const idx = buildPriceIndex(snapshot, settings, now);
    const out = bestRoute(recipes.recipes[0], idx, recipes.bonuses, settings);
    expect(out.ok).toBe(true);
  });

  it('vente repliée sur le lieu suivant si le meilleur est suspect', () => {
    const s2 = structuredClone(snapshot);
    const bag = s2.items.find((i) => i.id === 'T4_BAG')!;
    bag.avgPrice7d.Caerleon = 700; // 2400 > 3 × 700 → suspect à Caerleon
    const r = rankAll(s2, recipes, S(), now).crafting[0];
    expect(r.sellAt).toBe('Brecilien'); // 2100 > Martlock 2000
    expect(r.flags).toContain('mists');
    expect(r.flags).not.toContain('red-zone'); // achats Brecilien + Martlock, prod Brecilien
  });
});

// ---------------------------------------------------------------------------
// Bench
// ---------------------------------------------------------------------------
describe('performance', () => {
  it('5 000 recettes × 8 lieux en < 300 ms', () => {
    const N = 5000;
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const ts = hoursAgo(0.5);
    const mkItem = (id: string): MarketItem => {
      const prices: MarketItem['prices'] = {};
      const volume7d: MarketItem['volume7d'] = {};
      const avgPrice7d: MarketItem['avgPrice7d'] = {};
      const historyDays: MarketItem['historyDays'] = {};
      for (const loc of LOCATIONS) {
        const base = 100 + rnd() * 1000;
        prices[loc] = { sell: Math.round(base * 1.1), sellAt: ts, buy: Math.round(base), buyAt: ts };
        volume7d[loc] = Math.round(rnd() * 500);
        avgPrice7d[loc] = Math.round(base);
        historyDays[loc] = 7;
      }
      return { id, prices, volume7d, avgPrice7d, historyDays };
    };
    const items: MarketItem[] = [];
    for (let i = 0; i < 500; i++) items.push(mkItem('RES_' + i));
    const recipesArr: Recipe[] = [];
    const keys = ['wood', 'ore', 'hide', 'fiber', 'rock', 'bag', 'sword', 'plate_armor'];
    for (let i = 0; i < N; i++) {
      items.push(mkItem('OUT_' + i));
      const nIn = 1 + Math.floor(rnd() * 3);
      recipesArr.push({
        outputId: 'OUT_' + i,
        outputQty: 1,
        inputs: Array.from({ length: nIn }, () => ({
          id: 'RES_' + Math.floor(rnd() * 500),
          qty: 1 + Math.floor(rnd() * 16),
          returnable: rnd() > 0.2,
        })),
        itemValue: 64,
        kind: i % 2 ? 'crafting' : 'refining',
        bonusKey: keys[i % keys.length],
        category: 'c',
        subcategory: 's',
        tier: 4,
        enchant: 0,
      });
    }
    const bonuses: BonusTable = {};
    PRODUCTION_LOCATIONS.forEach((loc, k) => {
      bonuses[loc] = { refiningBase: 0.18, craftingBase: 0.18, modifiers: { [keys[k]]: 0.4 } };
    });
    const rf: RecipesFile = { generatedAt: '', meta: [], recipes: recipesArr, bonuses };
    const s = snap(items);
    rankAll(s, rf, S(), NOW); // warm-up JIT
    const t0 = performance.now();
    const res = rankAll(s, rf, S(), NOW);
    const dt = performance.now() - t0;
    expect(res.stats.evaluated).toBe(N);
    expect(res.refining.length + res.crafting.length).toBeGreaterThan(0);
    expect(dt).toBeLessThan(300);
  });
});
