// @vitest-environment jsdom
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { DEFAULT_SETTINGS, type MarketSnapshot, type Recipe, type RecipesFile, type RouteResult } from '../src/types';
import { AppDataContext, buildIndexes, type AppData, type RankingsView } from '../src/ui/context';
import { HomePage } from '../src/ui/pages/Home';
import { AboutPage } from '../src/ui/pages/About';

const NOW = new Date('2026-10-09T12:00:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

const planks = (tier: number): Recipe => ({
  outputId: `T${tier}_PLANKS`,
  outputQty: 1,
  inputs: [{ id: `T${tier}_WOOD`, qty: 2, returnable: true }],
  itemValue: 16,
  kind: 'refining',
  bonusKey: 'wood',
  category: 'resources',
  subcategory: 'planks',
  tier,
  enchant: 0,
});

const TIERS = [2, 3, 4, 5, 6, 7];
const recipes: RecipesFile = {
  generatedAt: ago(600),
  recipes: TIERS.map(planks),
  meta: TIERS.map((t) => ({
    id: `T${t}_PLANKS`,
    nameFr: `Planches tier ${t}`,
    nameEn: `Planks ${t}`,
    tier: t,
    enchant: 0,
    category: 'resources',
    subcategory: 'planks',
  })),
  bonuses: {},
};

const snapshot: MarketSnapshot = {
  updatedAt: ago(12),
  volumesUpdatedAt: ago(120),
  items: Array.from({ length: 1234 }, (_, i) => ({ id: `ITEM_${i}`, prices: {}, volume7d: {}, avgPrice7d: {}, historyDays: {} })),
};

const route = (r: Recipe, score: number): RouteResult => ({
  recipe: r,
  buyFrom: { [r.inputs[0].id]: 'Fort Sterling' },
  craftAt: 'Lymhurst',
  sellAt: 'Martlock',
  rrr: 0.367,
  unitCost: 100,
  unitRevenue: 150,
  unitProfit: score / 10,
  volume: 500,
  q: 50,
  confidence: 0.9,
  score,
  oldestPriceAgeH: 0.5,
  flags: [],
});

// Classement déjà trié par score décroissant, comme le moteur.
const refining = TIERS.slice().reverse().map((t, i) => route(planks(t), 90_000 - i * 10_000));
const rankings: RankingsView = {
  refining,
  crafting: [route(planks(2), 500), route(planks(3), 400)],
  blackMarket: [],
  stats: { evaluated: 6, missing: 0, stale: 0, suspect: 0, lowVolume: 0 },
  ms: 3,
};

function makeData(over: Partial<AppData> = {}): AppData {
  const s = 'snapshot' in over ? over.snapshot ?? null : snapshot;
  const r = 'recipes' in over ? over.recipes ?? null : recipes;
  return {
    snapshot: s,
    recipes: r,
    rankings,
    settings: { ...DEFAULT_SETTINGS },
    updateSettings: () => {},
    resetSettings: () => {},
    now: NOW,
    ...buildIndexes(s, r),
    ...over,
  };
}

const renderWith = (ui: ReactElement, data: AppData | null) =>
  render(<AppDataContext.Provider value={data}>{ui}</AppDataContext.Provider>);

afterEach(cleanup);

describe('HomePage', () => {
  it('affiche la proposition de valeur et les deux appels à l’action', () => {
    renderWith(<HomePage />, makeData());
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Voir le top raffinage' }).getAttribute('href')).toBe('#/raffinage');
    expect(screen.getAllByRole('link', { name: /Planifier mes fermes/ })[0].getAttribute('href')).toBe('#/fermes');
    const img = document.querySelector('.mk-hero-img') as HTMLImageElement;
    expect(img.getAttribute('alt')).toMatch(/rue marchande/);
  });

  it('lit les chiffres en direct depuis le contexte', () => {
    renderWith(<HomePage />, makeData());
    const ledger = screen.getByRole('region', { name: /Le marché d’Europe/ });
    const q = within(ledger);
    // 1 234 objets (espace fine insécable), 6 recettes, 6 + 2 routes rentables, collecte il y a 12 min.
    expect(q.getByText('Objets suivis').parentElement!.textContent?.replace(/\s/gu, ' ')).toContain('1 234');
    expect(q.getByText('Recettes évaluées').parentElement!.textContent).toContain('6');
    expect(q.getByText(/Routes rentables/).parentElement!.textContent).toContain('8');
    expect(q.getByText('Derniers prix collectés').parentElement!.textContent?.replace(/\s/gu, ' ')).toContain('il y a 12 min');
    // Meilleure opportunité = première ligne du classement raffinage.
    const best = q.getByRole('link', { name: /Planches tier 7/ });
    expect(best.getAttribute('href')).toBe('#/item/T7_PLANKS');
    expect(best.textContent?.replace(/\s/gu, ' ')).toContain('90 000');
  });

  it('montre exactement les 5 meilleurs raffinages, avec lien vers la fiche', () => {
    renderWith(<HomePage />, makeData());
    const list = screen.getByRole('list', { name: 'Top 5 raffinage' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(5);
    expect(within(rows[0]).getByRole('link').getAttribute('href')).toBe('#/item/T7_PLANKS');
    expect(within(rows[4]).getByRole('link').getAttribute('href')).toBe('#/item/T3_PLANKS');
    expect(list.textContent).not.toContain('Planches tier 2');
  });

  it('renvoie vers l’étude de cas et les fonctionnalités', () => {
    renderWith(<HomePage />, makeData());
    expect(screen.getByRole('link', { name: 'Lire l’étude de cas' }).getAttribute('href')).toBe('#/a-propos');
    for (const href of ['#/craft', '#/black-market', '#/reglages', '#/routes']) {
      expect(document.querySelector(`a[href="${href}"]`)).not.toBeNull();
    }
  });

  it('affiche un état de chargement propre sans données', () => {
    renderWith(<HomePage />, makeData({ snapshot: null, recipes: null, rankings: null }));
    const ledger = screen.getByRole('region', { name: /Le marché d’Europe/ });
    expect(ledger.getAttribute('aria-busy')).toBe('true');
    expect(within(ledger).getAllByText('chargement').length).toBeGreaterThanOrEqual(4);
    expect(screen.getByLabelText('Chargement du classement')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Top 5 raffinage' })).toBeNull();
    // Les appels à l'action restent disponibles.
    expect(screen.getByRole('link', { name: 'Voir le top raffinage' })).toBeTruthy();
  });

  it('se rend même sans fournisseur de contexte', () => {
    renderWith(<HomePage />, null);
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
  });

  it('indique quand aucun raffinage n’est rentable', () => {
    renderWith(<HomePage />, makeData({ rankings: { ...rankings, refining: [] } }));
    expect(screen.getByText(/Aucun raffinage n’est rentable/)).toBeTruthy();
  });
});

describe('AboutPage', () => {
  it('affiche les sections de l’étude de cas', () => {
    renderWith(<AboutPage />, makeData());
    expect(screen.getByRole('heading', { level: 1, name: 'Comment c’est construit' })).toBeTruthy();
    for (const t of [
      'Le problème',
      'La réponse produit',
      'L’architecture',
      'La méthode humain + IA',
      'Ce que l’audit a trouvé',
      'Choix et compromis',
      'Limites honnêtes',
      'Sources et crédits',
    ]) {
      expect(screen.getByRole('heading', { level: 2, name: t })).toBeTruthy();
    }
    expect(screen.getByText(/−25 M/)).toBeTruthy();
    expect(screen.getByText(/plan gratuit de Netlify limite/)).toBeTruthy();
  });

  it('contient le schéma d’architecture en SVG accessible', () => {
    renderWith(<AboutPage />, makeData());
    const svg = screen.getByRole('img', { name: /Architecture/ });
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg.textContent).toContain('GitHub Actions');
    expect(svg.textContent).toContain('Netlify');
  });

  it('renvoie vers le dépôt public', () => {
    renderWith(<AboutPage />, makeData());
    expect(screen.getByRole('link', { name: 'Voir le dépôt sur GitHub' }).getAttribute('href')).toBe(
      'https://github.com/NashNQ/albion-market-intel',
    );
  });

  it('le sommaire saute vers la section sans quitter la route #/a-propos', () => {
    window.location.hash = '#/a-propos';
    renderWith(<AboutPage />, makeData());
    const nav = screen.getByRole('navigation', { name: /Sommaire/ });
    const link = within(nav).getByRole('link', { name: 'Ce que l’audit a trouvé' });
    const notPrevented = fireEvent.click(link);
    expect(notPrevented).toBe(false);
    expect(window.location.hash).toBe('#/a-propos');
    expect(document.activeElement?.id).toBe('cs-audit');
  });

  it('mentionne le domaine Fermes et ses hypothèses exposées', () => {
    renderWith(<AboutPage />, makeData());
    expect(screen.getAllByText(/Fermes/).length).toBeGreaterThan(0);
    expect(screen.getByText(/panneau « Hypothèses »/)).toBeTruthy();
  });

  it('se rend pendant le chargement', () => {
    renderWith(<AboutPage />, makeData({ snapshot: null, recipes: null, rankings: null }));
    expect(screen.getByText('chargement en cours')).toBeTruthy();
  });
});
