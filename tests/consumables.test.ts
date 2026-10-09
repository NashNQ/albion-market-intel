import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { GENERATOR_VERSION, buildRecipesFile, buildRecipesReport, unsellableReason } from '../collector/recipes';
import { collectIds } from '../collector/ids-perimeter';
import { bestCraftLocation } from '../src/engine/route';
import { recipeRrr } from '../src/engine/rrr';
import { DEFAULT_SETTINGS, type Recipe, type RecipesFile } from '../src/types';

// Mini items.json : une recette de cuisine (ragoût, 10 par craft, enchantée à la sauce de poisson),
// une potion (5 par craft, enchantée à l'extrait), un poisson cru, un consommable événementiel.
const items = {
  items: {
    simpleitem: [
      { '@uniquename': 'T4_TURNIP', '@tier': '4', '@itemvalue': '16', '@weight': '0.6', '@shopcategory': 'farming', '@shopsubcategory1': 'farm' },
      { '@uniquename': 'T4_MEAT', '@tier': '4', '@itemvalue': '40', '@weight': '0.65', '@shopcategory': 'farming', '@shopsubcategory1': 'farmingproducts' },
      { '@uniquename': 'T4_BURDOCK', '@tier': '4', '@itemvalue': '40', '@weight': '0.6', '@shopcategory': 'farming', '@shopsubcategory1': 'herbgarden' },
      { '@uniquename': 'T3_EGG', '@tier': '3', '@itemvalue': '40', '@weight': '0.5', '@shopcategory': 'farming', '@shopsubcategory1': 'animalproducts' },
      // Définis sans @enchantmentlevel (ou à 0) : ID API sans « @ » malgré le suffixe _LEVELn.
      { '@uniquename': 'T1_FISHSAUCE_LEVEL1', '@tier': '1', '@enchantmentlevel': '0', '@itemvalue': '0', '@weight': '1', '@shopcategory': 'crafting', '@shopsubcategory1': 'fish' },
      { '@uniquename': 'T1_ALCHEMY_EXTRACT_LEVEL1', '@tier': '1', '@weight': '1', '@shopcategory': 'crafting', '@shopsubcategory1': 'alchemy' },
    ],
    consumableitem: [
      {
        '@uniquename': 'T4_MEAL_STEW',
        '@tier': '4',
        '@weight': '1.37',
        '@shopcategory': 'consumables',
        '@shopsubcategory1': 'food',
        '@craftingcategory': 'food',
        '@slottype': 'food',
        '@unlockedtoequip': 'true',
        craftingrequirements: {
          '@amountcrafted': '10',
          craftresource: [
            { '@uniquename': 'T4_TURNIP', '@count': '4' },
            { '@uniquename': 'T4_MEAT', '@count': '8' },
          ],
        },
        enchantments: {
          enchantment: [
            {
              '@enchantmentlevel': '1',
              craftingrequirements: {
                '@amountcrafted': '10',
                craftresource: [
                  { '@uniquename': 'T4_TURNIP', '@count': '4' },
                  { '@uniquename': 'T4_MEAT', '@count': '8' },
                  { '@uniquename': 'T1_FISHSAUCE_LEVEL1', '@count': '10' },
                ],
              },
            },
          ],
        },
      },
      {
        '@uniquename': 'T4_POTION_HEAL',
        '@tier': '4',
        '@weight': '0.3',
        '@shopcategory': 'consumables',
        '@shopsubcategory1': 'potions',
        '@craftingcategory': 'potion',
        '@slottype': 'potion',
        '@unlockedtoequip': 'true',
        craftingrequirements: {
          '@amountcrafted': '5',
          craftresource: [
            { '@uniquename': 'T4_BURDOCK', '@count': '24' },
            { '@uniquename': 'T3_EGG', '@count': '6' },
          ],
        },
        enchantments: {
          enchantment: {
            '@enchantmentlevel': '1',
            craftingrequirements: {
              '@amountcrafted': '5',
              craftresource: [
                { '@uniquename': 'T4_BURDOCK', '@count': '24' },
                { '@uniquename': 'T3_EGG', '@count': '6' },
                { '@uniquename': 'T1_ALCHEMY_EXTRACT_LEVEL1', '@count': '15' },
              ],
            },
          },
        },
      },
      // Poisson cru : pas de recette, jamais une sortie.
      { '@uniquename': 'T3_FISH_FRESHWATER_FOREST_RARE', '@tier': '3', '@itemvalue': '30', '@weight': '0.52', '@shopcategory': 'crafting', '@shopsubcategory1': 'fish', '@slottype': 'food', '@unlockedtoequip': 'true' },
      // Événementiel : exclu.
      {
        '@uniquename': 'UNIQUE_CONSUMABLE_EVENT_EASTER_2020_CHOCOLATE',
        '@tier': '4',
        '@shopcategory': 'consumables',
        '@shopsubcategory1': 'food',
        craftingrequirements: { craftresource: { '@uniquename': 'T3_EGG', '@count': '1' } },
      },
    ],
  },
};
const formatted = [
  { UniqueName: 'T4_MEAL_STEW', LocalizedNames: { 'EN-US': 'Goat Stew', 'FR-FR': 'Ragoût de chèvre' } },
  { UniqueName: 'T4_MEAL_STEW@1', LocalizedNames: { 'EN-US': 'Goat Stew', 'FR-FR': 'Ragoût de chèvre' } },
  { UniqueName: 'T4_POTION_HEAL', LocalizedNames: { 'EN-US': 'Healing Potion', 'FR-FR': 'Potion de soin' } },
];
const modifiers = {
  craftingmodifiers: {
    craftinglocation: [
      { '@clusterid': '3003', craftingbonus: { '@value': '0.18' }, refiningbonus: { '@value': '0.18' }, craftingmodifier: { '@name': 'food', '@value': '0.15' } },
      { '@clusterid': '5000', craftingbonus: { '@value': '0.18' }, refiningbonus: { '@value': '0.18' }, craftingmodifier: { '@name': 'potion', '@value': '0.15' } },
      { '@clusterid': '0000', craftingbonus: { '@value': '0.18' }, refiningbonus: { '@value': '0.18' } },
    ],
  },
};

describe('consommables (fixture)', () => {
  const { file, excludedIds } = buildRecipesReport(items, formatted, modifiers, '2026-01-01T00:00:00Z');
  const byId = new Map(file.recipes.map((r) => [r.outputId, r]));

  it('générateur v4', () => {
    expect(GENERATOR_VERSION).toBe(4);
    expect(file.generatorVersion).toBe(4);
  });

  it('ragoût : cuisine, 10 par craft, bonus food, valeur = Σ ingrédients', () => {
    const r = byId.get('T4_MEAL_STEW')!;
    expect(r).toMatchObject({ kind: 'crafting', category: 'consumables', subcategory: 'food', bonusKey: 'food', tier: 4, enchant: 0, outputQty: 10 });
    expect(r.inputs).toEqual([
      { id: 'T4_TURNIP', qty: 4, returnable: true },
      { id: 'T4_MEAT', qty: 8, returnable: true },
    ]);
    expect(r.itemValue).toBe(4 * 16 + 8 * 40);
  });

  it('ragoût @1 : ID API @1, sauce de poisson sans « @ »', () => {
    const r = byId.get('T4_MEAL_STEW@1')!;
    expect(r.enchant).toBe(1);
    expect(r.outputQty).toBe(10);
    expect(r.inputs.map((i) => i.id)).toEqual(['T4_TURNIP', 'T4_MEAT', 'T1_FISHSAUCE_LEVEL1']);
  });

  it('potion de soin : alchimie, 5 par craft, bonus potion, enchant @1 avec extrait', () => {
    const r = byId.get('T4_POTION_HEAL')!;
    expect(r).toMatchObject({ subcategory: 'potions', bonusKey: 'potion', outputQty: 5, enchant: 0 });
    const e = byId.get('T4_POTION_HEAL@1')!;
    expect(e.enchant).toBe(1);
    expect(e.inputs.find((i) => i.id.startsWith('T1_ALCHEMY_EXTRACT'))!.id).toBe('T1_ALCHEMY_EXTRACT_LEVEL1');
  });

  it('@unlockedtoequip ne rend pas invendables nourriture et potions ; événementiel et poisson cru absents', () => {
    expect(unsellableReason('T4_MEAL_STEW', items.items.consumableitem[0])).toBeNull();
    expect(unsellableReason('T4_BAG', { '@unlockedtoequip': 'true', '@slottype': 'bag' })).toBe('unlockedtoequip');
    expect(excludedIds).toEqual([]);
    expect(byId.has('UNIQUE_CONSUMABLE_EVENT_EASTER_2020_CHOCOLATE')).toBe(false);
    expect(byId.has('T3_FISH_FRESHWATER_FOREST_RARE')).toBe(false);
    expect(file.recipes).toHaveLength(4);
  });

  it('nouveaux ID collectés (sorties enchantées et ingrédients)', () => {
    const ids = collectIds(file);
    for (const id of ['T4_MEAL_STEW', 'T4_MEAL_STEW@1', 'T4_POTION_HEAL@1', 'T1_FISHSAUCE_LEVEL1', 'T1_ALCHEMY_EXTRACT_LEVEL1', 'T4_BURDOCK']) {
      expect(ids).toContain(id);
    }
  });

  it('poids dans meta (@weight de l’item de base, aussi pour les enchantés)', () => {
    const meta = new Map(file.meta.map((m) => [m.id, m]));
    expect(meta.get('T4_MEAL_STEW')!.weight).toBe(1.37);
    expect(meta.get('T4_MEAL_STEW@1')!.weight).toBe(1.37);
    expect(meta.get('T4_POTION_HEAL')!.weight).toBe(0.3);
    expect(meta.get('T1_FISHSAUCE_LEVEL1')!.weight).toBe(1);
    expect(meta.get('T4_MEAL_STEW')!.nameFr).toBe('Ragoût de chèvre');
    expect(file.meta.every((m) => typeof m.weight === 'number')).toBe(true);
  });

  it('moteur : cuisine à Caerleon, alchimie à Brecilien (+0,15), focus pris en compte', () => {
    const stew = byId.get('T4_MEAL_STEW')!;
    const potion = byId.get('T4_POTION_HEAL')!;
    expect(bestCraftLocation(stew, file.bonuses, DEFAULT_SETTINGS).loc).toBe('Caerleon');
    expect(bestCraftLocation(potion, file.bonuses, DEFAULT_SETTINGS).loc).toBe('Brecilien');
    expect(recipeRrr(stew, 'Caerleon', file.bonuses, DEFAULT_SETTINGS)).toBeCloseTo(0.33 / 1.33, 6);
    expect(recipeRrr(potion, 'Brecilien', file.bonuses, { focus: true, dailyBonus: 0 })).toBeCloseTo(0.92 / 1.92, 6);
  });
});

const RAW = '/home/claude/raw';
const hasRaw = ['items.json', 'items-formatted.json', 'craftingmodifiers.json'].every((f) => existsSync(join(RAW, f)));

describe.skipIf(!hasRaw)('consommables (fichiers réels)', () => {
  let file: RecipesFile;
  let byId: Map<string, Recipe>;
  beforeAll(() => {
    const read = (f: string) => JSON.parse(readFileSync(join(RAW, f), 'utf8'));
    file = buildRecipesFile(read('items.json'), read('items-formatted.json'), read('craftingmodifiers.json'), '2026-01-01T00:00:00Z');
    byId = new Map(file.recipes.map((r) => [r.outputId, r]));
  }, 60_000);

  it('T4_POTION_HEAL = 24 T4_BURDOCK + 6 T3_EGG → 5 ; @1 ajoute 15 T1_ALCHEMY_EXTRACT_LEVEL1', () => {
    const r = byId.get('T4_POTION_HEAL')!;
    expect(r.inputs.map((i) => [i.id, i.qty])).toEqual([['T4_BURDOCK', 24], ['T3_EGG', 6]]);
    expect(r.outputQty).toBe(5);
    expect(r.bonusKey).toBe('potion');
    expect(byId.get('T4_POTION_HEAL@1')!.inputs.at(-1)).toEqual({ id: 'T1_ALCHEMY_EXTRACT_LEVEL1', qty: 15, returnable: true });
  });

  it('T4_MEAL_STEW = 4 navets + 4 pains + 8 viandes → 10 ; omelette T3 → 10', () => {
    expect(byId.get('T4_MEAL_STEW')!.inputs.map((i) => [i.id, i.qty])).toEqual([['T4_TURNIP', 4], ['T4_BREAD', 4], ['T4_MEAT', 8]]);
    expect(byId.get('T4_MEAL_STEW')!.outputQty).toBe(10);
    expect(byId.get('T3_MEAL_OMELETTE')!.outputQty).toBe(10);
    expect(byId.get('T4_MEAL_STEW@3')!.inputs.at(-1)!.id).toBe('T1_FISHSAUCE_LEVEL3');
  });

  it('volumes cuisine / alchimie, noms FR et poids', () => {
    const c = file.recipes.filter((r) => r.category === 'consumables');
    expect(c.filter((r) => r.subcategory === 'food').length).toBeGreaterThan(200);
    expect(c.filter((r) => r.subcategory === 'potions').length).toBeGreaterThan(150);
    expect(c.some((r) => r.outputId.startsWith('UNIQUE_'))).toBe(false);
    const meta = new Map(file.meta.map((m) => [m.id, m]));
    expect(meta.get('T4_POTION_HEAL')!.nameFr).toBe('Potion de soin');
    expect(meta.get('T4_POTION_HEAL@1')!.weight).toBe(0.3);
    expect(meta.get('T4_BAG')!.weight).toBeGreaterThan(0);
  });
});
