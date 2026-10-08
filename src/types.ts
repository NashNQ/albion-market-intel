// Types partagés — FIGÉS au jalon 0. Ne pas modifier sans décision consignée.

export const LOCATIONS = [
  'Bridgewatch',
  'Fort Sterling',
  'Lymhurst',
  'Martlock',
  'Thetford',
  'Brecilien',
  'Caerleon',
  'Black Market',
] as const;
export type Location = (typeof LOCATIONS)[number];

/** Lieux où l'on peut produire (raffiner / crafter). Le Black Market n'en fait pas partie. */
export const PRODUCTION_LOCATIONS: Exclude<Location, 'Black Market'>[] = [
  'Bridgewatch',
  'Fort Sterling',
  'Lymhurst',
  'Martlock',
  'Thetford',
  'Brecilien',
  'Caerleon',
];

export interface PricePoint {
  sell: number | null; // sell_price_min (null si 0 ou date 0001-01-01)
  sellAt: string | null; // ISO UTC
  buy: number | null; // buy_price_max
  buyAt: string | null;
}

export interface MarketItem {
  id: string; // ID API, ex. T5_PLANKS_LEVEL1@1
  prices: Partial<Record<Location, PricePoint>>; // qualité 1
  volume7d: Partial<Record<Location, number | null>>; // médiane item_count, 7 derniers jours complets
  avgPrice7d: Partial<Record<Location, number | null>>;
  historyDays: Partial<Record<Location, number>>; // jours avec données sur 7
}

export interface MarketSnapshot {
  updatedAt: string; // ISO UTC, fin du dernier cycle prix réussi
  volumesUpdatedAt: string | null;
  items: MarketItem[];
}

export interface RecipeInput {
  id: string; // ID API
  qty: number;
  returnable: boolean; // false si @maxreturnamount="0"
}

export interface Recipe {
  outputId: string; // ID API
  outputQty: number; // @amountcrafted, 1 par défaut
  inputs: RecipeInput[];
  itemValue: number; // @itemvalue de l'item produit (frais de station)
  kind: 'refining' | 'crafting';
  /** Clé de bonus de ville : famille de ressource pour le raffinage (wood, ore, hide, fiber, rock),
   *  @craftingcategory pour le craft (bag, sword, plate_armor…). */
  bonusKey: string;
  category: string; // @shopcategory
  subcategory: string; // @shopsubcategory1
  tier: number;
  enchant: number;
}

export interface ItemMeta {
  id: string;
  nameFr: string;
  nameEn: string;
  tier: number;
  enchant: number;
  category: string;
  subcategory: string;
}

/** Bonus de production par lieu, tirés de craftingmodifiers.json. */
export interface LocationBonus {
  refiningBase: number; // 0.18
  craftingBase: number; // 0.18
  modifiers: Record<string, number>; // ex. { wood: 0.40, bag: 0.15 }
}
export type BonusTable = Partial<Record<Location, LocationBonus>>;

/** Contenu de recipes.json servi au navigateur. */
export interface RecipesFile {
  generatedAt: string;
  recipes: Recipe[];
  meta: ItemMeta[];
  bonuses: BonusTable;
}

export interface Settings {
  premium: boolean;
  focus: boolean;
  dailyBonus: 0 | 0.1 | 0.2;
  stationFee: number; // tarif pour 100 de nutrition
  mode: 'instant' | 'orders';
  marketShare: number; // 0..1
  dailyCap: number;
  maxPriceAgeH: number;
  minVolume: number;
}

export const DEFAULT_SETTINGS: Settings = {
  premium: true,
  focus: false,
  dailyBonus: 0,
  stationFee: 400,
  mode: 'instant',
  marketShare: 0.1,
  dailyCap: 1000,
  maxPriceAgeH: 6,
  minVolume: 20,
};

export type DataStatus = 'fresh' | 'stale' | 'error'; // stale = updatedAt > 30 min

export interface RouteResult {
  recipe: Recipe;
  buyFrom: Partial<Record<string, Location>>; // ingrédient -> lieu d'achat
  craftAt: Location;
  sellAt: Location;
  rrr: number;
  unitCost: number; // coût par unité produite
  unitRevenue: number;
  unitProfit: number;
  volume: number | null; // V7j du lieu de vente
  q: number | null;
  confidence: number; // C
  score: number | null; // null pour le Black Market
  oldestPriceAgeH: number;
  flags: ('red-zone' | 'mists' | 'suspect' | 'thin-history')[];
}

export interface RankingRow extends RouteResult {}
