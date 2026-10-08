import { describe, expect, it } from 'vitest';
import { isSuspectLow } from '../src/engine/filters';
import { rankAll } from '../src/engine';
import { DEFAULT_SETTINGS, type MarketSnapshot, type RecipesFile } from '../src/types';

const now = new Date('2026-10-08T12:00:00Z');
const fresh = '2026-10-08T11:30:00.000Z';

function snapshot(bmVolume: number | null): MarketSnapshot {
  return {
    updatedAt: fresh,
    volumesUpdatedAt: fresh,
    items: [
      { id: 'IN', prices: { Martlock: { sell: 100, sellAt: fresh, buy: null, buyAt: null } }, volume7d: {}, avgPrice7d: {}, historyDays: {} },
      {
        id: 'OUT',
        prices: { 'Black Market': { sell: null, sellAt: null, buy: 1000, buyAt: fresh } },
        volume7d: { 'Black Market': bmVolume },
        avgPrice7d: { 'Black Market': 1000 },
        historyDays: { 'Black Market': 7 },
      },
    ],
  };
}
const recipes: RecipesFile = {
  generatedAt: fresh,
  recipes: [{ outputId: 'OUT', outputQty: 1, inputs: [{ id: 'IN', qty: 2, returnable: true }], itemValue: 8, kind: 'crafting', bonusKey: 'bag', category: 'x', subcategory: 'bag', tier: 4, enchant: 0 }],
  meta: [],
  bonuses: {},
};

describe('corrections de la vérification', () => {
  it('Black Market : une sortie sans aucune vente sur 7 j n\'est pas classée', () => {
    expect(rankAll(snapshot(0), recipes, DEFAULT_SETTINGS, now).blackMarket).toHaveLength(0);
    expect(rankAll(snapshot(null), recipes, DEFAULT_SETTINGS, now).blackMarket).toHaveLength(0);
    expect(rankAll(snapshot(12), recipes, DEFAULT_SETTINGS, now).blackMarket).toHaveLength(1);
  });

  it('prix d\'achat < 1/3 de la moyenne 7 j = suspect', () => {
    const item = snapshot(1).items[1];
    expect(isSuspectLow(300, item, 'Black Market')).toBe(true);
    expect(isSuspectLow(400, item, 'Black Market')).toBe(false);
  });
});
