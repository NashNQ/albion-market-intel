import { describe, expect, it } from 'vitest';
import {
  CRAFT_FAMILIES,
  craftFamePerUnit,
  estimateLeveling,
  fameRequired,
  levelingTrackFor,
  refiningFamePerUnit,
  unlockFame,
  type LevelingTrack,
} from '../src/engine/leveling';
import { buildPriceIndex } from '../src/engine';
import { journalPrices, unitEconomics } from '../src/engine/invest';
import type { Recipe } from '../src/types';
import { NOW, RECIPES, RECIPE_LIST, SETTINGS, SNAPSHOT } from './invest-fixture';

const WOOD: LevelingTrack = { kind: 'refining', resource: 'wood', label: 'raffinage du bois' };
const SWORDS: LevelingTrack = { kind: 'crafting', family: 'CRAFT_SWORDS', label: 'craft des épées' };

const sword = (tier: number, enchant = 0): Recipe => ({
  outputId: `T${tier}_MAIN_SWORD${enchant ? '@' + enchant : ''}`,
  outputQty: 1,
  inputs: [
    { id: `T${tier}_METALBAR`, qty: 16, returnable: true },
    { id: `T${tier}_LEATHER`, qty: 8, returnable: true },
  ],
  itemValue: 0,
  kind: 'crafting',
  bonusKey: 'sword',
  category: 'weapons',
  subcategory: 'sword',
  tier,
  enchant,
});

describe('renommée requise', () => {
  it('T6 raffinage = 258 963 de renommée cumulée depuis zéro (5 ressources)', () => {
    expect(unlockFame(WOOD, 6)).toBe(258_963);
    expect(fameRequired(WOOD, 6)).toBe(258_963);
    expect(fameRequired({ kind: 'refining', resource: 'ore', label: '' }, 6)).toBe(258_963);
    // 250 + 3 713 + 45 000 + 210 000
    expect(250 + 3713 + 45000 + 210000).toBe(258_963);
  });

  it('depuis un tier déjà débloqué', () => {
    expect(fameRequired(WOOD, 6, 4)).toBe(258_963 - 3_963);
    expect(fameRequired(WOOD, 8, 7)).toBe(3_913_963 - 1_118_963);
    expect(fameRequired(WOOD, 4, 6)).toBe(0);
  });

  it('craft : épées (multiplicateur 2) et plastrons (1)', () => {
    expect(fameRequired(SWORDS, 6)).toBe(751_016);
    expect(fameRequired({ kind: 'crafting', family: 'CRAFT_PLATE_ARMORS', label: '' }, 6)).toBe(375_753);
    expect(CRAFT_FAMILIES.CRAFT_SWORDS.unlockFame[8]).toBe(12_879_962);
  });

  it('pistes disponibles', () => {
    expect(levelingTrackFor({ kind: 'refining', bonusKey: 'hide' })?.kind).toBe('refining');
    expect(levelingTrackFor({ kind: 'crafting', bonusKey: 'sword' })).toMatchObject({ family: 'CRAFT_SWORDS' });
    expect(levelingTrackFor({ kind: 'crafting', bonusKey: 'plate_armor' })).toMatchObject({ family: 'CRAFT_PLATE_ARMORS' });
    expect(levelingTrackFor({ kind: 'crafting', bonusKey: 'bag' })).toBeNull();
  });

  it('renommée par unité', () => {
    expect(refiningFamePerUnit(5)).toBe(135);
    expect(refiningFamePerUnit(6, 3)).toBe(1600);
    // Épée T6 : A = 24, M = 270 → 6 480 ; .1 → 6 480 + (6 480 − 180) = 12 780 (exemples du wiki).
    expect(craftFamePerUnit(sword(6))).toBe(6_480);
    expect(craftFamePerUnit(sword(6, 1))).toBe(12_780);
    expect(craftFamePerUnit(sword(6, 2))).toBe(19_080);
    expect(craftFamePerUnit(sword(3))).toBeNull();
  });
});

describe('estimateLeveling', () => {
  it('raffinage T6 depuis zéro, perte constante 10 ag/unité', () => {
    const e = estimateLeveling({
      track: WOOD,
      recipes: RECIPE_LIST,
      targetTier: 6,
      premiumFame: false,
      economics: () => ({ unitCost: 20, unitRevenue: 10 }),
    });
    // 250/2 = 125 ; 3 713/11 → 338 ; 45 000/33 → 1 364 ; 210 000/135 → 1 556.
    expect(e.steps.map((s) => s.units)).toEqual([125, 338, 1364, 1556]);
    expect(e.steps.map((s) => s.produceTier)).toEqual([2, 3, 4, 5]);
    expect(e.fame).toBe(258_963);
    expect(e.totalUnits).toBe(3383);
    expect(e.totalCost).toBe(33_830);
    expect(e.complete).toBe(true);
  });

  it('bonus premium +50 % et activité rentable → coût négatif (gain)', () => {
    const e = estimateLeveling({
      track: WOOD,
      recipes: RECIPE_LIST,
      targetTier: 6,
      fromTier: 5,
      premiumFame: true,
      economics: () => ({ unitCost: 10, unitRevenue: 12 }),
    });
    // 210 000 / (135 × 1,5) = 1 037,04 → 1 038 unités, gain 2 ag chacune.
    expect(e.premiumMultiplier).toBe(1.5);
    expect(e.steps).toHaveLength(1);
    expect(e.steps[0].units).toBe(1038);
    expect(e.totalCost).toBe(-2076);
  });

  it('prix réels de la fixture : coût net calculé à la main', () => {
    const index = buildPriceIndex(SNAPSHOT, SETTINGS, NOW);
    const e = estimateLeveling({
      track: WOOD,
      recipes: RECIPE_LIST,
      targetTier: 6,
      premiumFame: false,
      economics: (r) => unitEconomics(r, index, RECIPES.bonuses, SETTINGS),
    });
    // Pertes/unité : T2 5 − 3,84 = 1,16 ; T3 25 − 19,2 = 5,8 ; T4 86 − 76,8 = 9,2 ; T5 240 − 182,4 = 57,6.
    expect(e.steps.map((s) => s.unitLoss)).toEqual([1.16, 5.8, 9.2, 57.6].map((x) => expect.closeTo(x, 9)));
    expect(e.totalCost).toBeCloseTo(125 * 1.16 + 338 * 5.8 + 1364 * 9.2 + 1556 * 57.6, 6);
    expect(e.totalCost).toBeCloseTo(104_279.8, 6);
  });

  it('prix manquants → estimation partielle', () => {
    const e = estimateLeveling({
      track: WOOD,
      recipes: RECIPE_LIST,
      targetTier: 4,
      premiumFame: false,
      economics: (r) => (r.tier === 2 ? null : { unitCost: 20, unitRevenue: 10 }),
    });
    expect(e.complete).toBe(false);
    expect(e.steps[0].cost).toBeNull();
    expect(e.steps[0].units).toBe(125);
    expect(e.steps[0].note).toMatch(/Prix manquants/);
    expect(e.totalCost).toBe(3_380);
  });

  it('craft : T2–T3 non chiffrables, journaux déduits en T4', () => {
    const e = estimateLeveling({
      track: SWORDS,
      recipes: [sword(3), sword(4)],
      targetTier: 5,
      premiumFame: false,
      economics: () => ({ unitCost: 1000, unitRevenue: 800 }),
      journal: (t) => (t === 4 ? { full: 5000, empty: 2000 } : null),
    });
    expect(e.steps).toHaveLength(3);
    expect(e.steps[0].note).toMatch(/Aucune recette T2/);
    expect(e.steps[1].note).toMatch(/inconnue/);
    const s = e.steps[2];
    // 170 072 − 14 914 = 155 158 ; épée T4 : 24 × 22,5 = 540 → 288 unités.
    expect(s.fame).toBe(155_158);
    expect(s.units).toBe(288);
    // Journal T4 : 540 / 3 600 = 0,15 journal par épée × (5 000 − 2 000) = 450 ag.
    expect(s.journalGainPerUnit).toBeCloseTo(450, 10);
    expect(s.cost).toBeCloseTo(288 * (200 - 450), 10);
    expect(e.complete).toBe(false);
  });

  it('journaux : ignorés si un des deux prix manque', () => {
    const index = buildPriceIndex(SNAPSHOT, SETTINGS, NOW);
    expect(journalPrices(index, 4)).toBeNull();
  });
});
