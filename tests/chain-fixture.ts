// Fixture partagée des tests de routes en chaîne (prix choisis pour un calcul à la main simple).
import { DEFAULT_SETTINGS, type MarketItem, type MarketSnapshot, type Recipe, type RecipesFile, type Settings } from '../src/types';

export const NOW = new Date('2026-10-08T12:00:00.000Z');
export const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

const refine = (outputId: string, tier: number, enchant: number, itemValue: number, inputs: Recipe['inputs']): Recipe => ({
  outputId,
  outputQty: 1,
  inputs,
  itemValue,
  kind: 'refining',
  bonusKey: 'wood',
  category: 'crafting',
  subcategory: 'refinedresources',
  tier,
  enchant,
});

export const RECIPES: RecipesFile = {
  generatedAt: ago(600),
  recipes: [
    refine('T2_PLANKS', 2, 0, 4, [{ id: 'T2_WOOD', qty: 1, returnable: true }]),
    refine('T3_PLANKS', 3, 0, 8, [
      { id: 'T3_WOOD', qty: 2, returnable: true },
      { id: 'T2_PLANKS', qty: 1, returnable: true },
    ]),
    refine('T4_PLANKS', 4, 0, 16, [
      { id: 'T4_WOOD', qty: 2, returnable: true },
      { id: 'T3_PLANKS', qty: 1, returnable: true },
    ]),
    refine('T4_PLANKS_LEVEL1@1', 4, 1, 32, [
      { id: 'T4_WOOD_LEVEL1@1', qty: 2, returnable: true },
      { id: 'T3_PLANKS', qty: 1, returnable: true },
    ]),
    {
      outputId: 'T4_TOOL_TEST',
      outputQty: 1,
      inputs: [
        { id: 'T4_PLANKS', qty: 2, returnable: true },
        { id: 'T4_RUNE', qty: 1, returnable: false },
      ],
      itemValue: 64,
      kind: 'crafting',
      bonusKey: 'tools',
      category: 'tools',
      subcategory: 'tools',
      tier: 4,
      enchant: 0,
    },
  ],
  meta: [
    { id: 'T2_PLANKS', nameFr: 'Planches de bouleau', nameEn: 'Birch Planks', tier: 2, enchant: 0, category: 'crafting', subcategory: 'refinedresources' },
    { id: 'T3_PLANKS', nameFr: 'Planches de châtaignier', nameEn: 'Chestnut Planks', tier: 3, enchant: 0, category: 'crafting', subcategory: 'refinedresources' },
    { id: 'T4_PLANKS', nameFr: 'Planches de pin', nameEn: 'Pine Planks', tier: 4, enchant: 0, category: 'crafting', subcategory: 'refinedresources' },
    { id: 'T4_PLANKS_LEVEL1@1', nameFr: 'Planches de pin peu communes', nameEn: 'Uncommon Pine Planks', tier: 4, enchant: 1, category: 'crafting', subcategory: 'refinedresources' },
    { id: 'T2_WOOD', nameFr: 'Bûches de bouleau', nameEn: 'Birch Logs', tier: 2, enchant: 0, category: 'crafting', subcategory: 'resources' },
    { id: 'T3_WOOD', nameFr: 'Troncs de châtaignier', nameEn: 'Chestnut Logs', tier: 3, enchant: 0, category: 'crafting', subcategory: 'resources' },
    { id: 'T4_WOOD', nameFr: 'Troncs de pin', nameEn: 'Pine Logs', tier: 4, enchant: 0, category: 'crafting', subcategory: 'resources' },
  ],
  // Fort Sterling : 0,15 + 0,10 (bois) = 0,25 → RRR = 0,25 / 1,25 = 0,2.
  // Autres villes absentes de la table → base 0,18 → RRR ≈ 0,1525.
  bonuses: { 'Fort Sterling': { refiningBase: 0.15, craftingBase: 0.15, modifiers: { wood: 0.1 } } },
};

const item = (id: string, prices: MarketItem['prices'], volume7d: MarketItem['volume7d'] = {}): MarketItem => ({
  id,
  prices,
  volume7d,
  avgPrice7d: {},
  historyDays: {},
});
const p = (sell: number | null, buy: number | null, ageMin = 30) => ({
  sell,
  sellAt: sell == null ? null : ago(ageMin),
  buy,
  buyAt: buy == null ? null : ago(ageMin),
});

export const SNAPSHOT: MarketSnapshot = {
  updatedAt: ago(5),
  volumesUpdatedAt: ago(60),
  items: [
    // Mode instantané : on achète au prix « sell » (ordre de vente le plus bas), on vend au prix « buy ».
    item('T2_WOOD', { Lymhurst: p(10, 8, 60) }, { Lymhurst: 100000 }),
    item('T3_WOOD', { Lymhurst: p(20, 15, 90) }, { Lymhurst: 100000 }),
    item('T4_WOOD', { Martlock: p(40, 35, 120) }, { Martlock: 1000 }),
    item('T4_WOOD_LEVEL1@1', { Martlock: p(80, 70, 30) }, { Martlock: 100000 }),
    item('T2_PLANKS', { 'Fort Sterling': p(35, 30, 30) }),
    item('T3_PLANKS', { 'Fort Sterling': p(110, 100, 45) }),
    item('T4_PLANKS', { Lymhurst: p(260, 250, 180), Bridgewatch: p(210, 200, 20), 'Black Market': p(null, 300, 20) }, { Lymhurst: 500 }),
    item('T4_PLANKS_LEVEL1@1', { Lymhurst: p(600, 550, 30) }, { Lymhurst: 100000 }),
    item('T4_TOOL_TEST', { Lymhurst: p(2000, 1500, 30) }, { Lymhurst: 100000 }),
    item('T4_RUNE', { Lymhurst: p(50, 40, 30) }),
  ],
};

export const SETTINGS: Settings = { ...DEFAULT_SETTINGS, premium: true, focus: false, dailyBonus: 0, stationFee: 400, mode: 'instant', marketShare: 0.1, dailyCap: 1000, maxPriceAgeH: 6 };
