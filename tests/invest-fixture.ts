// Fixture des tests « Investir » : chaîne de planches T2→T7 et une épée, tous les prix à Martlock,
// RRR nul (bonus de base 0 partout) et valeur d'objet 0 (pas de frais de station) pour un calcul à la main.
import {
  DEFAULT_SETTINGS,
  PRODUCTION_LOCATIONS,
  type BonusTable,
  type MarketItem,
  type MarketSnapshot,
  type Recipe,
  type RecipesFile,
  type Settings,
} from '../src/types';

export const NOW = new Date('2026-10-14T12:00:00.000Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

const ref = (outputId: string, tier: number, inputs: [string, number][]): Recipe => ({
  outputId,
  outputQty: 1,
  inputs: inputs.map(([id, qty]) => ({ id, qty, returnable: true })),
  itemValue: 0,
  kind: 'refining',
  bonusKey: 'wood',
  category: 'crafting',
  subcategory: 'refinedresources',
  tier,
  enchant: 0,
});

export const RECIPE_LIST: Recipe[] = [
  ref('T2_PLANKS', 2, [['T2_WOOD', 1]]),
  ref('T3_PLANKS', 3, [['T3_WOOD', 2], ['T2_PLANKS', 1]]),
  ref('T4_PLANKS', 4, [['T4_WOOD', 2], ['T3_PLANKS', 1]]),
  ref('T5_PLANKS', 5, [['T5_WOOD', 3], ['T4_PLANKS', 1]]),
  ref('T6_PLANKS', 6, [['T6_WOOD', 4], ['T5_PLANKS', 1]]),
  ref('T7_PLANKS', 7, [['T7_WOOD', 5], ['T6_PLANKS', 1]]),
  {
    outputId: 'T4_BAG',
    outputQty: 1,
    inputs: [{ id: 'T4_CLOTH', qty: 8, returnable: true }],
    itemValue: 0,
    kind: 'crafting',
    bonusKey: 'bag',
    category: 'accessories',
    subcategory: 'bag',
    tier: 4,
    enchant: 0,
  },
];

const BONUSES: BonusTable = Object.fromEntries(
  PRODUCTION_LOCATIONS.map((l) => [l, { refiningBase: 0, craftingBase: 0, modifiers: {} }]),
);

const meta = (id: string, nameFr: string, tier: number) => ({ id, nameFr, nameEn: id, tier, enchant: 0, category: 'crafting', subcategory: 'refinedresources' });

export const RECIPES: RecipesFile = {
  generatedAt: ago(600),
  generatorVersion: 4,
  recipes: RECIPE_LIST,
  meta: [
    meta('T2_PLANKS', 'Planches de bouleau', 2),
    meta('T3_PLANKS', 'Planches de châtaignier', 3),
    meta('T4_PLANKS', 'Planches de pin', 4),
    meta('T5_PLANKS', 'Planches de cèdre', 5),
    meta('T6_PLANKS', 'Planches de chêne sanguin', 6),
    meta('T7_PLANKS', 'Planches de frêne', 7),
    meta('T4_BAG', 'Sac de l’adepte', 4),
  ],
  bonuses: BONUSES,
};

/** sell = sell_price_min (achat instantané), buy = buy_price_max (vente instantanée). */
const item = (id: string, sell: number | null, buy: number | null, volume = 1000): MarketItem => ({
  id,
  prices: { Martlock: { sell, sellAt: sell ? ago(30) : null, buy, buyAt: buy ? ago(30) : null } },
  volume7d: { Martlock: volume },
  avgPrice7d: {},
  historyDays: { Martlock: 7 },
});

export const SNAPSHOT: MarketSnapshot = {
  updatedAt: ago(5),
  volumesUpdatedAt: ago(60),
  items: [
    item('T2_WOOD', 5, 4),
    item('T3_WOOD', 10, 9),
    item('T4_WOOD', 30, 28),
    item('T5_WOOD', 50, 45),
    item('T6_WOOD', 100, 95),
    item('T2_PLANKS', 5, 4),
    item('T3_PLANKS', 26, 20),
    item('T4_PLANKS', 90, 80),
    item('T5_PLANKS', 200, 190),
    item('T6_PLANKS', 750, 700),
    item('T4_CLOTH', 100, 90),
    item('T4_BAG', 2000, 1500),
  ],
};

/** Premium (taxe 4 %), mode instantané, part de marché 10 % → Q = 100 pour un volume de 1 000. */
export const SETTINGS: Settings = { ...DEFAULT_SETTINGS, premium: true, focus: false, mode: 'instant', marketShare: 0.1, dailyCap: 1000 };
