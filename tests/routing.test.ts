import { describe, expect, it } from 'vitest';
import { parseHash } from '../src/ui/App';

describe('parseHash (itération 3)', () => {
  it('ouvre l’accueil par défaut et sur un hash inconnu', () => {
    expect(parseHash('')).toEqual({ name: 'accueil' });
    expect(parseHash('#/')).toEqual({ name: 'accueil' });
    expect(parseHash('#/nimporte')).toEqual({ name: 'accueil' });
  });
  it('garde le raffinage accessible et route les nouvelles pages', () => {
    expect(parseHash('#/raffinage')).toEqual({ name: 'raffinage' });
    expect(parseHash('#/fermes')).toEqual({ name: 'fermes' });
    expect(parseHash('#/a-propos')).toEqual({ name: 'a-propos' });
    expect(parseHash('#/item/T4_PLANKS')).toEqual({ name: 'item', itemId: 'T4_PLANKS' });
    expect(parseHash('#/routes')).toEqual({ name: 'routes' });
    expect(parseHash('#/transport')).toEqual({ name: 'transport' });
    expect(parseHash('#/favoris')).toEqual({ name: 'favoris' });
  });
});
