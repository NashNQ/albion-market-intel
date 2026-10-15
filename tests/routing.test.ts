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

describe('parseHash (itération 6 : mode Guilde)', () => {
  it('route les pages de la guilde', () => {
    expect(parseHash('#/guilde')).toEqual({ name: 'guilde' });
    expect(parseHash('#/guilde/')).toEqual({ name: 'guilde' });
    expect(parseHash('#/guilde/investir')).toEqual({ name: 'guilde-investir' });
    expect(parseHash('#/guilde/investir?i=abc')).toEqual({ name: 'guilde-investir' });
    expect(parseHash('#/guilde/prets')).toEqual({ name: 'guilde-prets' });
    expect(parseHash('#/guilde/prets?l=xyz')).toEqual({ name: 'guilde-prets' });
    expect(parseHash('#/guilde/reglages')).toEqual({ name: 'guilde-reglages' });
    expect(parseHash('#/guilde/inconnu')).toEqual({ name: 'guilde' });
  });
  it('ancien lien #/investir : alias redirigé vers #/guilde/investir en conservant ?i=', () => {
    expect(parseHash('#/investir')).toEqual({ name: 'guilde-investir', redirect: '#/guilde/investir' });
    expect(parseHash('#/investir?i=x')).toEqual({ name: 'guilde-investir', redirect: '#/guilde/investir?i=x' });
  });
  it('ne confond pas une page joueur avec la guilde', () => {
    expect(parseHash('#/guildes')).toEqual({ name: 'accueil' });
    expect(parseHash('#/reglages')).toEqual({ name: 'reglages' });
  });
});
