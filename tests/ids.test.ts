import { describe, expect, it } from 'vitest';
import { parseApiId, refiningFamily, toApiId } from '../src/engine/ids';

describe('toApiId', () => {
  it('niveau 0 → uniquename tel quel', () => expect(toApiId('T4_BAG', 0)).toBe('T4_BAG'));
  it('niveau n → uniquename@n', () => {
    expect(toApiId('T4_BAG', 1)).toBe('T4_BAG@1');
    expect(toApiId('T5_PLANKS_LEVEL3', 3)).toBe('T5_PLANKS_LEVEL3@3');
  });
});

describe('parseApiId', () => {
  it('sans @', () => expect(parseApiId('T4_BAG')).toEqual({ base: 'T4_BAG', level: 0 }));
  it('avec @', () => expect(parseApiId('T5_PLANKS_LEVEL1@1')).toEqual({ base: 'T5_PLANKS_LEVEL1', level: 1 }));
  it('aller-retour', () => {
    for (const [b, l] of [['T8_MAIN_SWORD', 3], ['T2_CLOTH', 0]] as const) {
      expect(parseApiId(toApiId(b, l))).toEqual({ base: b, level: l });
    }
  });
});

describe('refiningFamily', () => {
  it('raffinés', () => {
    expect(refiningFamily('T5_PLANKS')).toBe('wood');
    expect(refiningFamily('T6_METALBAR_LEVEL2@2')).toBe('ore');
    expect(refiningFamily('T4_LEATHER_LEVEL1@1')).toBe('hide');
    expect(refiningFamily('T2_CLOTH')).toBe('fiber');
    expect(refiningFamily('T8_STONEBLOCK')).toBe('rock');
  });
  it('non raffinés', () => {
    expect(refiningFamily('T5_WOOD')).toBeNull();
    expect(refiningFamily('T4_BAG@1')).toBeNull();
    expect(refiningFamily('T4_ARMOR_CLOTH_SET1')).toBeNull();
    expect(refiningFamily('T4_LEATHER_ARMOR')).toBeNull();
  });
});
