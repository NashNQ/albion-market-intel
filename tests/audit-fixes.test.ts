// Corrections issues de l'audit des items : collecteur (exclusions, @4, recettes alternatives)
// et moteur (repli « prix estimé », recettes multiples par outputId).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildRecipesReport, unsellableReason } from '../collector/recipes';
import { ESTIMATED_MAX_CONFIDENCE, rankAll, recipeKey } from '../src/engine';
import { DEFAULT_SETTINGS, type MarketSnapshot, type Recipe, type RecipesFile } from '../src/types';
import { sanitizeSettings } from '../src/ui/data/useSettings';

// ---------------------------------------------------------------------------
// 1. Collecteur sur les vrais fichiers du jeu
// ---------------------------------------------------------------------------
const RAW = '/home/claude/raw';
const AUDIT = '/tmp/claude-0/items-audit/invalid-ids.json';
const hasRaw = ['items.json', 'items-formatted.json', 'craftingmodifiers.json'].every((f) => existsSync(join(RAW, f)));

describe.skipIf(!hasRaw)('collecteur : corrections de l’audit (fichiers réels)', () => {
  let file: RecipesFile;
  let excludedIds: string[];
  let byKey: Map<string, Recipe>;

  beforeAll(() => {
    const read = (f: string) => JSON.parse(readFileSync(join(RAW, f), 'utf8'));
    const rep = buildRecipesReport(read('items.json'), read('items-formatted.json'), read('craftingmodifiers.json'), '2026-01-01T00:00:00Z');
    file = rep.file;
    excludedIds = rep.excludedIds;
    byKey = new Map(file.recipes.map((r) => [recipeKey(r), r]));
  }, 60_000);

  it('1a : aucun item non vendable en sortie ni en ingrédient', () => {
    const ids = new Set<string>();
    for (const r of file.recipes) {
      ids.add(r.outputId);
      for (const i of r.inputs) ids.add(i.id);
    }
    for (const bad of ['T4_2H_IRONGAUNTLETS_HELL', 'T6_CAPE_CLOTH_KEEPER', 'T6_CAPE_PLATE_MORGANA', 'T6_CAPE_LEATHER_UNDEAD', 'T4_ARTEFACT_2H_IRONGAUNTLETS_HELL']) {
      expect(ids.has(bad)).toBe(false);
    }
    expect([...ids].some((id) => id.includes('_PROTOTYPE') || id.startsWith('UNIQUE_'))).toBe(false);
    expect(excludedIds).toContain('T4_2H_IRONGAUNTLETS_HELL');
    expect(excludedIds.length).toBeGreaterThanOrEqual(67);
  });

  it.skipIf(!existsSync(AUDIT))('1a : les 72 ID non exploitables de l’audit ont disparu', () => {
    const invalid: string[] = JSON.parse(readFileSync(AUDIT, 'utf8')).items.map((x: { id: string }) => x.id);
    expect(invalid).toHaveLength(72);
    const ids = new Set(file.recipes.flatMap((r) => [r.outputId, ...r.inputs.map((i) => i.id)]));
    expect(invalid.filter((id) => ids.has(id))).toEqual([]);
    expect(file.meta.some((m) => invalid.includes(m.id))).toBe(false);
  });

  it('1a : critères d’exclusion', () => {
    expect(unsellableReason('T8_ARMOR_PLATE_PROTOTYPE', undefined)).toBe('prototype');
    expect(unsellableReason('X', { '@showinmarketplace': 'false' })).toBe('showinmarketplace=false');
    expect(unsellableReason('X', { '@tradable': 'false' })).toBe('tradable=false');
    expect(unsellableReason('X', { '@requiredaccesslevel': '3' })).toBe('requiredaccesslevel');
    expect(unsellableReason('T4_BAG', { '@showinmarketplace': 'true' })).toBeNull();
  });

  it('1b : équipement enchanté jusqu’à @4', () => {
    const r = byKey.get('T4_ARMOR_PLATE_SET1@4')!;
    expect(r).toBeTruthy();
    expect(r.enchant).toBe(4);
    expect(r.inputs).toEqual([{ id: 'T4_METALBAR_LEVEL4@4', qty: 16, returnable: true }]);
    expect(byKey.has('T4_BAG@4')).toBe(true);
    const at4 = file.recipes.filter((x) => x.kind === 'crafting' && x.enchant === 4).length;
    expect(at4).toBeGreaterThan(1200);
    expect(file.recipes.some((x) => x.enchant > 4)).toBe(false);
  });

  it('1c : STONEBLOCK depuis ROCK_LEVEL1/2/3 en recettes distinctes (×2/×4/×8)', () => {
    const main = byKey.get('T4_STONEBLOCK')!;
    expect(main.variant).toBeUndefined();
    expect(main.outputQty).toBe(1);
    const alts = file.recipes.filter((r) => r.outputId === 'T4_STONEBLOCK' && r.variant);
    expect(alts.map((a) => [a.variant, a.outputQty])).toEqual([
      ['T4_ROCK_LEVEL1@1', 2],
      ['T4_ROCK_LEVEL2@2', 4],
      ['T4_ROCK_LEVEL3@3', 8],
    ]);
    expect(byKey.get('T4_STONEBLOCK|T4_ROCK_LEVEL3@3')!.inputs).toEqual([
      { id: 'T4_ROCK_LEVEL3@3', qty: 2, returnable: true },
      { id: 'T3_STONEBLOCK', qty: 8, returnable: true },
    ]);
    const variants = file.recipes.filter((r) => r.variant);
    expect(variants).toHaveLength(15);
    expect(variants.every((r) => /^T[4-8]_STONEBLOCK$/.test(r.outputId))).toBe(true);
    // Clés uniques : aucune collision outputId + variant.
    expect(byKey.size).toBe(file.recipes.length);
  });
});

// ---------------------------------------------------------------------------
// 1c bis : le moteur classe plusieurs recettes de même outputId sans collision
// ---------------------------------------------------------------------------
const now = new Date('2026-10-08T12:00:00Z');
const fresh = '2026-10-08T11:30:00.000Z';
const old = '2026-10-07T12:00:00.000Z'; // 24 h : périmé avec maxPriceAgeH = 6

describe('moteur : recettes alternatives', () => {
  it('deux recettes de même outputId produisent deux lignes distinctes', () => {
    const base: Recipe = { outputId: 'OUT', outputQty: 1, inputs: [{ id: 'A', qty: 2, returnable: true }], itemValue: 8, kind: 'refining', bonusKey: 'rock', category: 'crafting', subcategory: 'refinedresources', tier: 4, enchant: 0 };
    const alt: Recipe = { ...base, outputQty: 4, inputs: [{ id: 'B', qty: 2, returnable: true }], itemValue: 32, variant: 'B' };
    const snap: MarketSnapshot = {
      updatedAt: fresh,
      volumesUpdatedAt: fresh,
      items: [
        { id: 'A', prices: { Martlock: { sell: 10, sellAt: fresh, buy: null, buyAt: null } }, volume7d: {}, avgPrice7d: {}, historyDays: {} },
        { id: 'B', prices: { Martlock: { sell: 30, sellAt: fresh, buy: null, buyAt: null } }, volume7d: {}, avgPrice7d: {}, historyDays: {} },
        { id: 'OUT', prices: { Lymhurst: { sell: null, sellAt: null, buy: 100, buyAt: fresh } }, volume7d: { Lymhurst: 500 }, avgPrice7d: { Lymhurst: 100 }, historyDays: { Lymhurst: 7 } },
      ],
    };
    const r = rankAll(snap, { generatedAt: fresh, recipes: [base, alt], meta: [], bonuses: {} }, DEFAULT_SETTINGS, now);
    expect(r.refining).toHaveLength(2);
    expect(new Set(r.refining.map((x) => recipeKey(x.recipe)))).toEqual(new Set(['OUT', 'OUT|B']));
    expect(recipeKey(alt)).toBe('OUT|B');
  });
});

// ---------------------------------------------------------------------------
// 2. Repli « prix estimé »
// ---------------------------------------------------------------------------
const recipe: Recipe = { outputId: 'OUT', outputQty: 1, inputs: [{ id: 'IN', qty: 2, returnable: true }], itemValue: 8, kind: 'crafting', bonusKey: 'bag', category: 'bags', subcategory: 'bags', tier: 4, enchant: 0 };
const recipes: RecipesFile = { generatedAt: fresh, recipes: [recipe], meta: [], bonuses: {} };

function snap(opts: { inAt?: string | null; outAt?: string | null; outHistory?: number; inHistory?: number }): MarketSnapshot {
  const { inAt = fresh, outAt = fresh, outHistory = 7, inHistory = 7 } = opts;
  return {
    updatedAt: fresh,
    volumesUpdatedAt: fresh,
    items: [
      {
        id: 'IN',
        prices: { Martlock: { sell: inAt ? 100 : null, sellAt: inAt, buy: null, buyAt: null } },
        volume7d: { Martlock: 500 },
        avgPrice7d: { Martlock: 110 },
        historyDays: { Martlock: inHistory },
      },
      {
        id: 'OUT',
        prices: { Lymhurst: { sell: null, sellAt: null, buy: outAt ? 1000 : null, buyAt: outAt } },
        volume7d: { Lymhurst: 500 },
        avgPrice7d: { Lymhurst: 950 },
        historyDays: { Lymhurst: outHistory },
      },
    ],
  };
}

describe('moteur : repli « prix estimé » (historyFallback)', () => {
  const on = { ...DEFAULT_SETTINGS, historyFallback: true };

  it('désactivé par défaut', () => {
    expect(DEFAULT_SETTINGS.historyFallback).toBe(false);
    expect(rankAll(snap({ outAt: old }), recipes, DEFAULT_SETTINGS, now).crafting).toHaveLength(0);
  });

  it('prix de vente périmé → moyenne 7 j du même lieu, drapeau estimated, C ≤ 0,6', () => {
    const r = rankAll(snap({ outAt: old }), recipes, on, now).crafting;
    expect(r).toHaveLength(1);
    expect(r[0].flags).toContain('estimated');
    expect(r[0].confidence).toBeLessThanOrEqual(ESTIMATED_MAX_CONFIDENCE);
    expect(r[0].confidence).toBe(0.6);
    expect(r[0].unitRevenue).toBeCloseTo(950 * (1 - 0.04));
    expect(r[0].sellAt).toBe('Lymhurst');
  });

  it('prix d’achat absent → moyenne 7 j de l’ingrédient', () => {
    const r = rankAll(snap({ inAt: null }), recipes, on, now).crafting;
    expect(r).toHaveLength(1);
    expect(r[0].flags).toContain('estimated');
    expect(r[0].confidence).toBe(0.6);
    expect(r[0].buyFrom.IN).toBe('Martlock');
  });

  it('historique < 3 jours → pas de prix estimé', () => {
    expect(rankAll(snap({ outAt: old, outHistory: 2 }), recipes, on, now).crafting).toHaveLength(0);
    expect(rankAll(snap({ inAt: null, inHistory: 2 }), recipes, on, now).crafting).toHaveLength(0);
  });

  it('prix récents disponibles → pas de drapeau estimated même si activé', () => {
    const r = rankAll(snap({}), recipes, on, now).crafting;
    expect(r).toHaveLength(1);
    expect(r[0].flags).not.toContain('estimated');
    expect(r[0].confidence).toBe(1);
  });

  it('validation des réglages', () => {
    expect(sanitizeSettings({}).historyFallback).toBe(false);
    expect(sanitizeSettings({ historyFallback: true }).historyFallback).toBe(true);
    expect(sanitizeSettings({ historyFallback: 'oui' }).historyFallback).toBe(false);
  });
});
