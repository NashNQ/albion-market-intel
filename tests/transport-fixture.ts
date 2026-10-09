// Fixture du transport pur (valeurs choisies pour un calcul à la main).
import { DEFAULT_SETTINGS, type ItemMeta, type MarketItem, type MarketSnapshot, type Settings } from '../src/types';

export const NOW = new Date('2026-10-09T12:00:00Z');
export const at = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

export const SETTINGS: Settings = { ...DEFAULT_SETTINGS, premium: true, mode: 'instant', marketShare: 0.1, dailyCap: 1000, maxPriceAgeH: 6 };

const pp = (sell: number | null, buy: number | null, h = 1) => ({ sell, sellAt: sell ? at(h) : null, buy, buyAt: buy ? at(h) : null });

/** Sac T4 : achat Bridgewatch, revente Martlock (meilleur) ou Caerleon. */
export const BAG: MarketItem = {
  id: 'T4_BAG',
  prices: {
    Bridgewatch: pp(1000, 900, 1),
    Martlock: pp(1600, 1500, 2),
    Caerleon: pp(1800, 1700, 1),
  },
  volume7d: { Bridgewatch: 0, Martlock: 200, Caerleon: 100 },
  avgPrice7d: { Bridgewatch: 1000, Martlock: 1500, Caerleon: 1700 },
  historyDays: {},
};

/** Épée : le Black Market rachète, il ne doit jamais servir de lieu d'achat. */
export const SWORD: MarketItem = {
  id: 'T5_MAIN_SWORD',
  prices: {
    Thetford: pp(1000, 800, 1),
    'Black Market': pp(100, 2000, 1),
  },
  volume7d: { Thetford: 300, 'Black Market': 50 },
  avgPrice7d: {},
  historyDays: {},
};

/** Planches : prix d'achat périmé (10 h) à Lymhurst, vente Brecilien. */
export const PLANKS: MarketItem = {
  id: 'T4_PLANKS',
  prices: {
    Lymhurst: pp(100, 90, 10),
    Brecilien: pp(200, 180, 1),
  },
  volume7d: { Brecilien: 1000 },
  avgPrice7d: {},
  historyDays: {},
};

/** Cuir : prix de vente suspect (> 3 × moyenne 7 j). */
export const HIDE: MarketItem = {
  id: 'T4_LEATHER',
  prices: { Martlock: pp(100, 90, 1), 'Fort Sterling': pp(1000, 900, 1) },
  volume7d: { 'Fort Sterling': 100 },
  avgPrice7d: { 'Fort Sterling': 200 },
  historyDays: {},
};

/** Minerai : aucun volume à destination → exclu. */
export const ORE: MarketItem = {
  id: 'T4_ORE',
  prices: { Martlock: pp(10, 9, 1), Thetford: pp(100, 90, 1) },
  volume7d: { Thetford: 0, Martlock: 0 },
  avgPrice7d: {},
  historyDays: {},
};

export const SNAPSHOT: MarketSnapshot = {
  updatedAt: at(0.2),
  volumesUpdatedAt: at(1),
  items: [BAG, SWORD, PLANKS, HIDE, ORE],
};

const meta = (id: string, nameFr: string, tier: number, weight?: number): ItemMeta =>
  ({ id, nameFr, nameEn: nameFr, tier, enchant: 0, category: 'x', subcategory: 'y', ...(weight != null ? { weight } : {}) }) as ItemMeta;

export const META: ItemMeta[] = [
  meta('T4_BAG', 'Sac de l’adepte', 4, 2.5),
  meta('T5_MAIN_SWORD', 'Épée large de l’expert', 5),
  meta('T4_PLANKS', 'Planches de pin', 4, 0.5),
  meta('T4_LEATHER', 'Cuir travaillé', 4),
  meta('T4_ORE', 'Minerai de fer', 4),
];
export const META_BY_ID = new Map(META.map((m) => [m.id, m]));
