// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import {
  DEFAULT_SETTINGS,
  type MarketSnapshot,
  type Recipe,
  type RecipesFile,
  type RouteResult,
} from '../src/types';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------
const NOW = new Date();
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

const planks: Recipe = {
  outputId: 'T5_PLANKS_LEVEL1@1',
  outputQty: 1,
  inputs: [
    { id: 'T5_WOOD_LEVEL1@1', qty: 3, returnable: true },
    { id: 'T4_PLANKS_LEVEL1@1', qty: 1, returnable: true },
  ],
  itemValue: 80,
  kind: 'refining',
  bonusKey: 'wood',
  category: 'resources',
  subcategory: 'planks',
  tier: 5,
  enchant: 1,
};
const bag: Recipe = {
  outputId: 'T6_BAG',
  outputQty: 1,
  inputs: [
    { id: 'T6_CLOTH', qty: 8, returnable: true },
    { id: 'T6_LEATHER', qty: 8, returnable: true },
  ],
  itemValue: 1024,
  kind: 'crafting',
  bonusKey: 'bag',
  category: 'accessories',
  subcategory: 'bag',
  tier: 6,
  enchant: 0,
};

const recipes: RecipesFile = {
  generatedAt: ago(600),
  recipes: [planks, bag],
  meta: [
    { id: 'T5_PLANKS_LEVEL1@1', nameFr: 'Planches de cèdre peu communes', nameEn: 'Uncommon Cedar Planks', tier: 5, enchant: 1, category: 'resources', subcategory: 'planks' },
    { id: 'T5_WOOD_LEVEL1@1', nameFr: 'Bûches de cèdre peu communes', nameEn: 'Uncommon Cedar Logs', tier: 5, enchant: 1, category: 'resources', subcategory: 'wood' },
    { id: 'T4_PLANKS_LEVEL1@1', nameFr: 'Planches de pin peu communes', nameEn: 'Uncommon Pine Planks', tier: 4, enchant: 1, category: 'resources', subcategory: 'planks' },
    { id: 'T6_BAG', nameFr: 'Sac de maître', nameEn: "Master's Bag", tier: 6, enchant: 0, category: 'accessories', subcategory: 'bag' },
  ],
  bonuses: {
    Lymhurst: { refiningBase: 0.18, craftingBase: 0.18, modifiers: { wood: 0.4 } },
  },
};

const snapshot: MarketSnapshot = {
  updatedAt: ago(12),
  volumesUpdatedAt: ago(120),
  items: [
    {
      id: 'T5_PLANKS_LEVEL1@1',
      prices: {
        Lymhurst: { sell: 1500, sellAt: ago(20), buy: 1400, buyAt: ago(25) },
        Caerleon: { sell: 1700, sellAt: ago(40), buy: 1650, buyAt: ago(45) },
      },
      volume7d: { Lymhurst: 900, Caerleon: 400 },
      avgPrice7d: { Lymhurst: 1450 },
      historyDays: { Lymhurst: 7, Caerleon: 6 },
    },
    {
      id: 'T5_WOOD_LEVEL1@1',
      prices: { 'Fort Sterling': { sell: 300, sellAt: ago(15), buy: 280, buyAt: ago(15) } },
      volume7d: {},
      avgPrice7d: {},
      historyDays: {},
    },
    {
      id: 'T4_PLANKS_LEVEL1@1',
      prices: { Martlock: { sell: 200, sellAt: ago(30), buy: 180, buyAt: ago(30) } },
      volume7d: {},
      avgPrice7d: {},
      historyDays: {},
    },
  ],
};

const route = (r: Recipe, o: Partial<RouteResult> = {}): RouteResult => ({
  recipe: r,
  buyFrom: Object.fromEntries(r.inputs.map((i) => [i.id, 'Fort Sterling'])),
  craftAt: 'Lymhurst',
  sellAt: 'Caerleon',
  rrr: 0.367,
  unitCost: 1012.4,
  unitRevenue: 1584,
  unitProfit: 571.6,
  volume: 400,
  q: 40,
  confidence: 0.92,
  score: 21034.9,
  oldestPriceAgeH: 0.75,
  flags: ['red-zone'],
  ...o,
});

const RANKINGS = {
  refining: [route(planks)],
  crafting: [route(bag, { unitProfit: 12345, score: 300000, flags: ['mists', 'thin-history'], sellAt: 'Brecilien', craftAt: 'Martlock' })],
  blackMarket: [route(bag, { sellAt: 'Black Market', q: null, score: null, volume: null, unitProfit: 9876 })],
  stats: { evaluated: 1234, missing: 56, stale: 7, suspect: 2, lowVolume: 90 },
  ms: 42,
};

// ---------------------------------------------------------------------------
// Mocks des hooks de données
// ---------------------------------------------------------------------------
type Status = 'fresh' | 'stale' | 'error' | 'loading' | 'empty';
const state: { status: Status; withData: boolean } = { status: 'fresh', withData: true };

vi.mock('../src/ui/data/useMarket', () => ({
  useMarket: () => ({
    snapshot: state.withData ? snapshot : null,
    recipes: state.withData ? recipes : null,
    status: state.status,
    updatedAt: state.withData ? new Date(snapshot.updatedAt) : null,
    ageMinutes: state.withData ? 12 : null,
    reload: () => {},
  }),
}));
vi.mock('../src/ui/data/useSettings', () => ({
  useSettings: () => [{ ...DEFAULT_SETTINGS }, () => {}, () => {}],
}));
vi.mock('../src/ui/data/useRankings', () => ({
  useRankings: (s: unknown, r: unknown) => (s && r ? RANKINGS : null),
}));

const { App } = await import('../src/ui/App');

function go(hash: string) {
  window.location.hash = hash;
  return render(<App />);
}

beforeEach(() => {
  state.status = 'fresh';
  state.withData = true;
});
afterEach(() => {
  cleanup();
  window.location.hash = '';
});

// Mots anglais d'interface qui ne doivent pas apparaître.
const ENGLISH = /\b(Loading|Settings|Search|Profit per|Updated|Refining|Crafting|Reset|Volume per|Filter|No data|Item not found)\b/;

function expectFrench(container: HTMLElement) {
  const text = container.textContent ?? '';
  expect(text).not.toMatch(ENGLISH);
  expect(text).toContain('Non affilié à Sandbox Interactive');
}

// ---------------------------------------------------------------------------
describe('interface', () => {
  it('Top raffinage : titre, stats, ligne de table et fraîcheur', () => {
    const { container } = go('#/raffinage');
    expect(screen.getByRole('heading', { level: 1, name: 'Top raffinage' })).toBeTruthy();
    expect(screen.getByText(/1 234 recettes évaluées · 56 sans données · 7 prix périmés · 2 suspects · 90 trop peu liquides · calcul en 42 ms/)).toBeTruthy();
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows.length).toBe(2); // en-tête + 1 ligne
    const link = within(table).getByRole('link', { name: /Planches de cèdre peu communes/ });
    expect(link.getAttribute('href')).toBe('#/item/T5_PLANKS_LEVEL1%401');
    const img = within(table).getByAltText('Planches de cèdre peu communes') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('https://render.albiononline.com/v1/item/T5_PLANKS_LEVEL1%401.png?size=64');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(within(table).getByText('5.1')).toBeTruthy();
    expect(within(table).getByText('572 ag')).toBeTruthy();
    expect(within(table).getByText('Zone rouge')).toBeTruthy();
    expect(within(table).getByText('CAE')).toBeTruthy();
    const scoreTh = within(table).getByRole('columnheader', { name: /Score/ });
    expect(scoreTh.getAttribute('aria-sort')).toBe('descending');
    expect(screen.getByText('Mis à jour il y a 12 min')).toBeTruthy();
    expect(screen.getByText('Réglages rapides')).toBeTruthy();
    expectFrench(container);
  });

  it('Top craft : ligne avec drapeaux brumes et historique mince', () => {
    const { container } = go('#/craft');
    expect(screen.getByRole('heading', { level: 1, name: 'Top craft' })).toBeTruthy();
    const table = screen.getByRole('table');
    expect(within(table).getByRole('link', { name: /Sac de maître/ })).toBeTruthy();
    expect(within(table).getByText('Brumes')).toBeTruthy();
    expect(within(table).getByText('Historique mince')).toBeTruthy();
    expect(within(table).getByText('12 345 ag')).toBeTruthy();
    expectFrench(container);
  });

  it('Black Market : avertissement, pas de colonne score ni volume', () => {
    const { container } = go('#/black-market');
    expect(screen.getByRole('heading', { level: 1, name: 'Black Market' })).toBeTruthy();
    expect(screen.getByRole('note').textContent).toMatch(/aucun volume fiable/);
    const table = screen.getByRole('table');
    expect(within(table).queryByRole('columnheader', { name: /Score/ })).toBeNull();
    expect(within(table).queryByRole('columnheader', { name: /Volume/ })).toBeNull();
    expect(within(table).getByRole('columnheader', { name: /Profit\/unité/ }).getAttribute('aria-sort')).toBe('descending');
    expect(within(table).getAllByRole('row').length).toBe(2);
    expectFrench(container);
  });

  it('Fiche objet : prix par lieu, recette et calcul pas à pas', () => {
    const { container } = go('#/item/T5_PLANKS_LEVEL1%401');
    expect(screen.getByRole('heading', { level: 1, name: 'Planches de cèdre peu communes' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Prix par lieu' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Recette' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Meilleure route, pas à pas' })).toBeTruthy();
    expect(screen.getByText('1 500 ag')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Bûches de cèdre peu communes/ })).toBeTruthy();
    expect(screen.getByText('Profit par unité')).toBeTruthy();
    expectFrench(container);
  });

  it('Fiche objet sans recette : uniquement les prix', () => {
    go('#/item/T5_WOOD_LEVEL1%401');
    expect(screen.getByRole('heading', { level: 1, name: 'Bûches de cèdre peu communes' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Prix par lieu' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Recette' })).toBeNull();
  });

  it('Réglages : champs avec aide et bouton réinitialiser', () => {
    const { container } = go('#/reglages');
    expect(screen.getByRole('heading', { level: 1, name: 'Réglages' })).toBeTruthy();
    expect(screen.getByLabelText('Tarif station')).toBeTruthy();
    expect(screen.getByLabelText('Âge maximal des prix')).toBeTruthy();
    expect(screen.getByText('Prix affiché par la station pour 100 de nutrition.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Réinitialiser les réglages' })).toBeTruthy();
    expectFrench(container);
  });

  it('écran « empty » : première collecte en cours', () => {
    state.status = 'empty';
    state.withData = false;
    const { container } = go('#/raffinage');
    expect(screen.getByRole('heading', { name: 'Première collecte en cours, revenez dans 15 minutes' })).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expectFrench(container);
  });

  it('squelette pendant le chargement', () => {
    state.status = 'loading';
    state.withData = false;
    go('#/raffinage');
    expect(screen.getByLabelText('Chargement des données')).toBeTruthy();
  });

  it('bandeau rouge si les données sont en retard', () => {
    state.status = 'stale';
    go('#/raffinage');
    expect(screen.getByRole('alert').textContent).toMatch(/^Données de \d\d:\d\d, la collecte semble en retard\./);
  });

  it('navigation par hash', async () => {
    go('#/raffinage');
    expect(screen.getByRole('heading', { level: 1, name: 'Top raffinage' })).toBeTruthy();
    await act(async () => {
      window.location.hash = '#/craft';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Top craft' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Craft' }).getAttribute('aria-current')).toBe('page');
  });
});
