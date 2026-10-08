import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildRecipesFile } from '../collector/recipes';
import type { Recipe, RecipesFile } from '../src/types';

const RAW = '/home/claude/raw';
const hasRaw = ['items.json', 'items-formatted.json', 'craftingmodifiers.json'].every((f) => existsSync(join(RAW, f)));

describe.skipIf(!hasRaw)('buildRecipesFile (fichiers réels)', () => {
  let file: RecipesFile;
  let byId: Map<string, Recipe>;
  const ins = (id: string) =>
    byId.get(id)!.inputs.map((i) => [i.id, i.qty]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));

  beforeAll(() => {
    const read = (f: string) => JSON.parse(readFileSync(join(RAW, f), 'utf8'));
    file = buildRecipesFile(read('items.json'), read('items-formatted.json'), read('craftingmodifiers.json'), '2026-01-01T00:00:00Z');
    byId = new Map(file.recipes.map((r) => [r.outputId, r]));
  }, 60_000);

  it('T5_PLANKS = 3 T5_WOOD + 1 T4_PLANKS', () => {
    expect(ins('T5_PLANKS')).toEqual([['T4_PLANKS', 1], ['T5_WOOD', 3]]);
    const r = byId.get('T5_PLANKS')!;
    expect(r.kind).toBe('refining');
    expect(r.bonusKey).toBe('wood');
    expect(r.outputQty).toBe(1);
    expect(r.tier).toBe(5);
  });

  it('T5_PLANKS_LEVEL1@1 = 3 T5_WOOD_LEVEL1@1 + 1 T4_PLANKS_LEVEL1@1', () => {
    expect(ins('T5_PLANKS_LEVEL1@1')).toEqual([['T4_PLANKS_LEVEL1@1', 1], ['T5_WOOD_LEVEL1@1', 3]]);
    expect(byId.get('T5_PLANKS_LEVEL1@1')!.enchant).toBe(1);
  });

  it('T4_BAG = 8 T4_CLOTH + 8 T4_LEATHER', () => {
    expect(ins('T4_BAG')).toEqual([['T4_CLOTH', 8], ['T4_LEATHER', 8]]);
    const r = byId.get('T4_BAG')!;
    expect(r.kind).toBe('crafting');
    expect(r.bonusKey).toBe('bag');
    expect(r.itemValue).toBe(256);
  });

  it('T4_BAG@1 = 8 T4_CLOTH_LEVEL1@1 + 8 T4_LEATHER_LEVEL1@1', () => {
    expect(ins('T4_BAG@1')).toEqual([['T4_CLOTH_LEVEL1@1', 8], ['T4_LEATHER_LEVEL1@1', 8]]);
    expect(byId.get('T4_BAG@1')!.enchant).toBe(1);
  });

  it('T4_MAIN_SWORD = 16 T4_METALBAR + 8 T4_LEATHER', () => {
    expect(ins('T4_MAIN_SWORD')).toEqual([['T4_LEATHER', 8], ['T4_METALBAR', 16]]);
    expect(byId.get('T4_MAIN_SWORD')!.bonusKey).toBe('sword');
  });

  it('artefacts non retournables', () => {
    const r = file.recipes.find((x) => x.inputs.some((i) => i.id.includes('ARTEFACT')))!;
    expect(r.inputs.find((i) => i.id.includes('ARTEFACT'))!.returnable).toBe(false);
    expect(r.inputs.find((i) => !i.id.includes('ARTEFACT'))!.returnable).toBe(true);
  });

  it('aucune recette FACTION', () => {
    expect(file.recipes.some((r) => r.inputs.some((i) => i.id.includes('FACTION')))).toBe(false);
  });

  it('meta couvre sorties et ingrédients', () => {
    const ids = new Set(file.meta.map((m) => m.id));
    for (const r of file.recipes) {
      expect(ids.has(r.outputId)).toBe(true);
      for (const i of r.inputs) expect(ids.has(i.id)).toBe(true);
    }
    const bag = file.meta.find((m) => m.id === 'T4_BAG@1')!;
    expect(bag.nameFr).toBe("Sac de l'adepte");
    expect(bag.enchant).toBe(1);
  });

  it('bonus de ville', () => {
    expect(file.bonuses.Thetford!.modifiers.ore).toBe(0.4);
    expect(file.bonuses['Fort Sterling']!.modifiers.wood).toBe(0.4);
    expect(file.bonuses.Thetford!.refiningBase).toBe(0.18);
    expect(file.bonuses['Black Market']).toBeUndefined();
    expect(Object.keys(file.bonuses)).toHaveLength(7);
  });
});
