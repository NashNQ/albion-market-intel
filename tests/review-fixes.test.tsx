// @vitest-environment jsdom
// Relecture adversariale : anomalies M1–M9, version du générateur, prix de vente manuel, recettes alternatives.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { buildPriceIndex, compareRanked, hasEnoughVolume, rankAll } from '../src/engine';
import { computeChain, buildPreset, findRecipe, recipeLookup, syncInputs, type ChainContext } from '../src/engine/chain-index';
import { GENERATOR_VERSION, buildRecipesReport, unsellableReason } from '../collector/recipes';
import { DEFAULT_SETTINGS, type MarketItem, type MarketSnapshot, type Recipe, type RecipesFile, type RouteResult } from '../src/types';
import { normalizeItems } from '../src/ui/data/useMarket';
import { anchorLagH, anchoredNow } from '../src/ui/data/useRankings';
import { applyFilters, catKey, EMPTY_FILTERS } from '../src/ui/components/Filters';
import { RouteTable } from '../src/ui/components/RouteTable';
import { ageClass } from '../src/ui/components/route-builder/ui';
import { decodeShare, encodeShare, validateRoute } from '../src/ui/data/routesStore';
import { NOW, RECIPES, SETTINGS, SNAPSHOT, ago } from './chain-fixture';

afterEach(() => cleanup());

const now = new Date('2026-10-08T12:00:00Z');
const fresh = new Date(now.getTime() - 10 * 60_000).toISOString();
const recipe = (o: Partial<Recipe> = {}): Recipe => ({
  outputId: 'OUT',
  outputQty: 1,
  inputs: [{ id: 'IN', qty: 1, returnable: true }],
  itemValue: 8,
  kind: 'crafting',
  bonusKey: 'bag',
  category: 'bags',
  subcategory: 'bags',
  tier: 4,
  enchant: 0,
  ...o,
});
const item = (id: string, prices: MarketItem['prices'], vol: number | null = 500): MarketItem => ({
  id,
  prices,
  volume7d: { Lymhurst: vol },
  avgPrice7d: { Lymhurst: 1000 },
  historyDays: { Lymhurst: 7 },
});
const sellAtLym = (buy: number) => ({ Lymhurst: { sell: null, sellAt: null, buy, buyAt: fresh } });
const buyAtMart = (sell: number) => ({ Martlock: { sell, sellAt: fresh, buy: null, buyAt: null } });

describe('M1 : item sans `prices`', () => {
  it('le moteur ne plante pas et useMarket complète les champs', () => {
    const broken = { id: 'IN', volume7d: {}, avgPrice7d: {}, historyDays: {} } as unknown as MarketItem;
    const snap: MarketSnapshot = { updatedAt: fresh, volumesUpdatedAt: fresh, items: [broken, item('OUT', sellAtLym(1000))] };
    expect(() => rankAll(snap, { generatedAt: fresh, recipes: [recipe()], meta: [], bonuses: {} }, DEFAULT_SETTINGS, now)).not.toThrow();
    const norm = normalizeItems([broken, null, { prices: {} }, 'x']);
    expect(norm).toHaveLength(1);
    expect(norm[0].prices).toEqual({});
  });
});

describe('M2 : valeurs nulles triées en fin', () => {
  it('volume null en dernier, quel que soit le sens', () => {
    const base = { buyFrom: {}, craftAt: 'Lymhurst' as const, sellAt: 'Lymhurst' as const, rrr: 0.2, unitCost: 1, unitRevenue: 2, unitProfit: 1, confidence: 1, oldestPriceAgeH: 0, flags: [] as RouteResult['flags'] };
    const rows: RouteResult[] = [
      { ...base, recipe: recipe({ outputId: 'NUL' }), volume: null, q: null, score: 5 },
      { ...base, recipe: recipe({ outputId: 'HI' }), volume: 900, q: 90, score: 9 },
      { ...base, recipe: recipe({ outputId: 'LO' }), volume: 10, q: 1, score: 1 },
    ];
    const meta = new Map(rows.map((r) => [r.recipe.outputId, { id: r.recipe.outputId, nameFr: r.recipe.outputId, nameEn: '', tier: 4, enchant: 0, category: '', subcategory: '' }]));
    render(<RouteTable rows={rows} metaById={meta} variant="ranked" caption="t" />);
    const header = screen.getByRole('columnheader', { name: /Ventes\/jour \(marché\)/ });
    const order = () => [...document.querySelectorAll('tbody .item-name')].map((n) => n.textContent);
    fireEvent.click(header.querySelector('button') ?? header);
    expect(order().at(-1)).toBe('NUL');
    fireEvent.click(header.querySelector('button') ?? header);
    expect(order().at(-1)).toBe('NUL');
  });
});

describe('M3 / M4 / M8 : classement', () => {
  it('égalité de score départagée par profit unitaire', () => {
    // Deux sorties au même score : volume plafonné identique (Q = dailyCap) mais profits différents → scores différents ;
    // on force donc l'égalité via un comparateur direct sur le résultat.
    const s = { ...DEFAULT_SETTINGS, marketShare: 1, dailyCap: 10 };
    const snap: MarketSnapshot = {
      updatedAt: fresh,
      volumesUpdatedAt: fresh,
      items: [item('IN', buyAtMart(100)), item('A', sellAtLym(1100)), item('B', sellAtLym(1100))],
    };
    const rec = (id: string) => recipe({ outputId: id, kind: 'refining', inputs: [{ id: 'IN', qty: 1, returnable: false }] });
    const r = rankAll(snap, { generatedAt: fresh, recipes: [rec('B'), rec('A')], meta: [], bonuses: {} }, s, now);
    expect(r.refining.map((x) => x.recipe.outputId)).toEqual(['A', 'B']); // égalité totale → ordre déterministe
    const row = (id: string, score: number, unitProfit: number) => ({ recipe: recipe({ outputId: id }), score, unitProfit }) as RouteResult;
    const sorted = [row('Z', 1000, 100), row('Y', 1000, 400), row('X', 2000, 1)].sort(compareRanked);
    expect(sorted.map((x) => x.recipe.outputId)).toEqual(['X', 'Y', 'Z']);
  });

  it('volume 0 jamais retenu, même avec minVolume = 0', () => {
    expect(hasEnoughVolume(0, { minVolume: 0 })).toBe(false);
    expect(hasEnoughVolume(1, { minVolume: 0 })).toBe(true);
  });

  it('recette sans ingrédient non classée', () => {
    const snap: MarketSnapshot = { updatedAt: fresh, volumesUpdatedAt: fresh, items: [item('OUT', sellAtLym(1000))] };
    const r = rankAll(snap, { generatedAt: fresh, recipes: [recipe({ inputs: [] })], meta: [], bonuses: {} }, DEFAULT_SETTINGS, now);
    expect(r.crafting).toHaveLength(0);
  });
});

describe('M6 / M7 : filtres', () => {
  const mk = (id: string, category: string, subcategory: string) =>
    ({ recipe: recipe({ outputId: id, category, subcategory }), flags: [] }) as unknown as RouteResult;
  const rows = [mk('X', 'weapons', 'shared'), mk('Y', 'armor', 'shared')];
  const meta = new Map([
    ['X', { id: 'X', nameFr: 'Cape d’Avalon', nameEn: '', tier: 4, enchant: 0, category: '', subcategory: '' }],
    ['Y', { id: 'Y', nameFr: 'Autre', nameEn: '', tier: 4, enchant: 0, category: '', subcategory: '' }],
  ]);
  it('apostrophe droite trouve l’apostrophe typographique', () => {
    expect(applyFilters(rows, { ...EMPTY_FILTERS, q: "cape d'avalon" }, meta).map((r) => r.recipe.outputId)).toEqual(['X']);
  });
  it('catégorie comparée avec la sous-catégorie', () => {
    expect(applyFilters(rows, { ...EMPTY_FILTERS, subcat: catKey('armor', 'shared') }, meta).map((r) => r.recipe.outputId)).toEqual(['Y']);
  });
});

describe('M9 : âge réel affiché quand la collecte est en retard', () => {
  it('retard d’ancrage = maintenant − (collecte + 30 min)', () => {
    const snap = { updatedAt: new Date(now.getTime() - 3 * 3_600_000).toISOString() };
    expect(anchoredNow(snap, now.getTime())).toBe(now.getTime() - 2.5 * 3_600_000);
    expect(anchorLagH(snap, now.getTime())).toBeCloseTo(2.5, 9);
    expect(anchorLagH({ updatedAt: fresh }, now.getTime())).toBe(0);
  });
});

describe('collecteur : version du générateur et exclusions', () => {
  it('generatorVersion écrit dans recipes.json', () => {
    const rep = buildRecipesReport({ items: {} }, [], { craftingmodifiers: {} }, fresh);
    expect(rep.file.generatorVersion).toBe(GENERATOR_VERSION);
    expect(GENERATOR_VERSION).toBeGreaterThanOrEqual(2);
  });
  it('@unlockedtoequip="true" exclu', () => {
    expect(unsellableReason('T4_X', { '@unlockedtoequip': 'true' })).toBe('unlockedtoequip');
    expect(unsellableReason('T4_X', { '@unlockedtoequip': 'false' })).toBeNull();
  });
});

describe('constructeur : prix de vente manuel et âge des cellules', () => {
  const ctx: ChainContext = { recipes: RECIPES, settings: SETTINGS, now: NOW, index: buildPriceIndex(SNAPSHOT, SETTINGS, NOW) };
  const steps = (() => {
    const r = buildPreset(RECIPES, 'wood', 2, 4, 0);
    if (!r.ok) throw new Error(r.error);
    return r.steps;
  })();

  it('prix de vente manuel : revenu = N × prix × (1 − taxe), route complète même sans prix de marché', () => {
    const res = computeChain({ steps, final: { sellAt: 'Caerleon', qty: 10, qtyMode: 'final', manualSellPrice: 500 } }, ctx);
    expect(res.complete).toBe(true);
    expect(res.revenue).toBeCloseTo(10 * 500 * 0.96, 9);
    expect(res.warnings.some((w) => w.kind === 'manual-price' && !w.step)).toBe(true);
    const missing = computeChain({ steps, final: { sellAt: 'Caerleon', qty: 10, qtyMode: 'final' } }, ctx);
    expect(missing.complete).toBe(false);
  });

  it('prix de vente manuel conservé par la sauvegarde, absent du lien de partage', () => {
    const route = { v: 1, id: 'r1', name: 'x', createdAt: ago(1), updatedAt: ago(1), steps, final: { sellAt: 'auto', qty: 5, qtyMode: 'final', manualSellPrice: 300 } };
    const v = validateRoute(route);
    expect(v.ok && v.value.final.manualSellPrice).toBe(300);
    expect(validateRoute({ ...route, final: { ...route.final, manualSellPrice: -1 } }).ok).toBe(false);
    const d = decodeShare(encodeShare(route as never));
    expect(d.ok && d.value.final.manualSellPrice).toBeUndefined();
  });

  it('âge : orange > 6 h, rouge > 24 h', () => {
    expect(ageClass(1)).toBeUndefined();
    expect(ageClass(7)).toBe('age-old');
    expect(ageClass(25)).toBe('age-very-old');
  });

  it('changement de recette alternative : ingrédients alignés sur la variante', () => {
    const base = recipe({ outputId: 'T4_STONEBLOCK', kind: 'refining', inputs: [{ id: 'T4_ROCK', qty: 2, returnable: true }] });
    const alt = { ...base, outputQty: 2, inputs: [{ id: 'T4_ROCK_LEVEL1@1', qty: 2, returnable: true }], variant: 'T4_ROCK_LEVEL1@1' };
    const rf: RecipesFile = { generatedAt: fresh, recipes: [base, alt], meta: [], bonuses: {} };
    const lk = recipeLookup(rf);
    const r = findRecipe(lk, 'T4_STONEBLOCK', 'T4_ROCK_LEVEL1@1')!;
    const s = syncInputs({ outputId: 'T4_STONEBLOCK', craftAt: 'auto', inputs: [{ id: 'T4_ROCK', source: { type: 'buy', at: 'auto' } }] }, r);
    expect(s.inputs.map((i) => i.id)).toEqual(['T4_ROCK_LEVEL1@1']);
  });
});
