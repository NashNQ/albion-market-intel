// Fixture des tests « Fermes » : valeurs réelles de recipes.json (générateur v3) pour quelques activités,
// et des prix choisis pour un calcul à la main simple (tous à Martlock, sans bonus de ville pour la cardère).
import { DEFAULT_SETTINGS, type FarmingData, type MarketItem, type MarketSnapshot, type RecipesFile, type Settings } from '../src/types';

export const NOW = new Date('2026-10-08T12:00:00.000Z');
export const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

export const FARMING: FarmingData = {
  crops: [
    { kind: 'crop', seedId: 'T1_FARM_CARROT_SEED', cropId: 'T1_CARROT', tier: 1, growSeconds: 79200, harvestAvg: 4.5, wormChance: 0.1, wormId: 'T1_WORM', seedChance: 0, focusBonus: 2, focusCost: 1000, npcSeedPrice: 2000, nutrition: 48 },
    { kind: 'crop', seedId: 'T3_FARM_WHEAT_SEED', cropId: 'T3_WHEAT', tier: 3, growSeconds: 79200, harvestAvg: 4.5, wormChance: 0.1, wormId: 'T1_WORM', seedChance: 0.6, focusBonus: 0.8, focusCost: 1000, npcSeedPrice: 5000, nutrition: 48 },
    { kind: 'herb', seedId: 'T5_FARM_TEASEL_SEED', cropId: 'T5_TEASEL', tier: 5, growSeconds: 79200, harvestAvg: 4.5, wormChance: 0.1, wormId: 'T1_WORM', seedChance: 0.8, focusBonus: 0.4, focusCost: 1000, npcSeedPrice: 10000, nutrition: 48 },
  ],
  animals: [
    { babyId: 'T3_FARM_CHICKEN_BABY', grownId: 'T3_FARM_CHICKEN_GROWN', tier: 3, growSeconds: 158400, offspringChance: 0.6, focusBonus: 0.8, focusCost: 1000, npcBabyPrice: 5000, nutritionMax: 864, favoriteFood: 'T3_WHEAT', favoriteBonus: 1, productId: 'T3_EGG', productAvg: 9, productionSeconds: 79200, adultConsumptionPerDay: (864 * 24) / 22, meatId: 'T3_MEAT', meatPerAdult: 18 },
    { babyId: 'T7_FARM_PIG_BABY', grownId: 'T7_FARM_PIG_GROWN', tier: 7, growSeconds: 158400, offspringChance: 0.9111, focusBonus: 0.1778, focusCost: 1000, npcBabyPrice: 22500, nutritionMax: 864, favoriteFood: 'T7_CORN', favoriteBonus: 1, productId: null, productAvg: null, productionSeconds: null, adultConsumptionPerDay: (864 * 24) / 22, meatId: 'T7_MEAT', meatPerAdult: 18 },
  ],
  otherAnimals: [],
  cityBonuses: {
    Lymhurst: { T1_FARM_CARROT_SEED: 0.1 },
    Bridgewatch: { T5_FARM_TEASEL_SEED: 0.1 },
    Caerleon: { T5_FARM_TEASEL_SEED: 0.1 },
    'Fort Sterling': { T3_FARM_CHICKEN_GROWN: 0.1 },
  },
  foodNutrition: { T1_CARROT: 48, T3_WHEAT: 48, T5_TEASEL: 48, T7_CORN: 48 },
};

const meta = (id: string, nameFr: string, tier: number) => ({ id, nameFr, nameEn: id, tier, enchant: 0, category: 'farming', subcategory: 'farm' });

export const RECIPES: RecipesFile = {
  generatedAt: ago(600),
  generatorVersion: 3,
  recipes: [],
  meta: [
    meta('T1_FARM_CARROT_SEED', 'Graines de carotte', 1),
    meta('T1_CARROT', 'Carottes', 1),
    meta('T1_WORM', 'Lombric', 1),
    meta('T3_FARM_WHEAT_SEED', 'Graines de blé', 3),
    meta('T3_WHEAT', 'Gerbe de blé', 3),
    meta('T5_FARM_TEASEL_SEED', 'Graines de cardère incendiaire', 5),
    meta('T5_TEASEL', 'Cardère incendiaire', 5),
    meta('T3_FARM_CHICKEN_BABY', 'Poussins', 3),
    meta('T3_FARM_CHICKEN_GROWN', 'Poulet', 3),
    meta('T3_EGG', 'Œufs de poule', 3),
    meta('T3_MEAT', 'Poulet cru', 3),
    meta('T7_FARM_PIG_BABY', 'Porcelet', 7),
    meta('T7_FARM_PIG_GROWN', 'Cochon', 7),
    meta('T7_MEAT', 'Porc cru', 7),
    meta('T7_CORN', 'Gerbe de maïs', 7),
  ],
  bonuses: {},
  farming: FARMING,
};

/** Prix à Martlock : sell = sell_price_min (achat instantané), buy = buy_price_max (vente instantanée). */
const item = (id: string, sell: number | null, buy: number | null, volume = 1000): MarketItem => ({
  id,
  prices: { Martlock: { sell, sellAt: sell ? ago(30) : null, buy, buyAt: buy ? ago(30) : null } },
  volume7d: { Martlock: volume },
  avgPrice7d: {},
  historyDays: { Martlock: 7 },
});

export const SNAPSHOT: MarketSnapshot = {
  updatedAt: ago(10),
  volumesUpdatedAt: ago(60),
  items: [
    item('T5_TEASEL', 320, 300, 100),
    item('T5_FARM_TEASEL_SEED', 9000, 9000),
    item('T1_WORM', 520, 500),
    item('T1_CARROT', 60, 50),
    item('T1_FARM_CARROT_SEED', 2500, 1500),
    item('T3_WHEAT', 120, 100),
    item('T3_FARM_WHEAT_SEED', 4800, 4000),
    item('T3_FARM_CHICKEN_BABY', 4000, 3500),
    item('T3_FARM_CHICKEN_GROWN', 12000, 10000),
    item('T3_EGG', 90, 80),
    item('T3_MEAT', 700, 600),
    item('T7_FARM_PIG_BABY', 20000, 18000),
    item('T7_FARM_PIG_GROWN', 60000, 50000),
    item('T7_MEAT', 3000, 2800),
    item('T7_CORN', 600, 500),
  ],
};

export const SETTINGS: Settings = { ...DEFAULT_SETTINGS, premium: true, mode: 'instant', maxPriceAgeH: 6, minVolume: 20, historyFallback: false };
