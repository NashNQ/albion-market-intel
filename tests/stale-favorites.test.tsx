// @vitest-environment jsdom
// Prix périmés visibles (P2), métriques compréhensibles (P10-P12) et favoris (P9).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { DEFAULT_SETTINGS, type ItemMeta, type MarketItem, type MarketSnapshot, type Recipe, type RecipesFile, type RouteResult, type Settings } from '../src/types';
import { rankAll, STALE_CONFIDENCE_FACTOR, STALE_MAX_AGE_H } from '../src/engine';
import { sanitizeSettings } from '../src/ui/data/useSettings';
import { ageTone } from '../src/ui/format';
import {
  FAVORITES_KEY,
  MAX_FAVORITES,
  addFavorite,
  getFavorites,
  reloadFavorites,
  sanitizeFavorites,
  toggleFavorite,
  useFavorites,
} from '../src/ui/data/favorites';
import { FavoriteButton } from '../src/ui/components/FavoriteButton';
import { RouteTable } from '../src/ui/components/RouteTable';
import { confidenceReasons, routeBreakdown } from '../src/ui/components/RouteDetail';
import { AgeBadge } from '../src/ui/components/Route';
import { AppDataContext, buildIndexes, type AppData } from '../src/ui/context';
import { FavoritesPage, bestQuote } from '../src/ui/pages/Favorites';

const now = new Date('2026-10-09T12:00:00Z');
const ago = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
const S = (o: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...o });

const recipe: Recipe = {
  outputId: 'T4_OUT',
  outputQty: 1,
  inputs: [{ id: 'T4_IN', qty: 2, returnable: true }],
  itemValue: 16,
  kind: 'crafting',
  bonusKey: 'x',
  category: 'accessories',
  subcategory: 'bag',
  tier: 4,
  enchant: 0,
};
const recipes: RecipesFile = {
  generatedAt: ago(1),
  recipes: [recipe],
  meta: [
    { id: 'T4_OUT', nameFr: 'Sac d’adepte', nameEn: 'Adept Bag', tier: 4, enchant: 0, category: 'accessories', subcategory: 'bag' },
    { id: 'T4_IN', nameFr: 'Tissu', nameEn: 'Cloth', tier: 4, enchant: 0, category: 'resources', subcategory: 'cloth' },
  ],
  bonuses: {},
};
const input = (ageH: number): MarketItem => ({
  id: 'T4_IN',
  prices: { Martlock: { sell: 100, sellAt: ago(ageH), buy: 90, buyAt: ago(ageH) } },
  volume7d: {},
  avgPrice7d: {},
  historyDays: {},
});
const output = (prices: MarketItem['prices']): MarketItem => ({
  id: 'T4_OUT',
  prices,
  volume7d: { Lymhurst: 200, Martlock: 200, 'Black Market': 50 },
  avgPrice7d: { Lymhurst: 1000, Martlock: 1000, 'Black Market': 1000 },
  historyDays: { Lymhurst: 7, Martlock: 7, 'Black Market': 7 },
});
const snap = (items: MarketItem[]): MarketSnapshot => ({ updatedAt: now.toISOString(), volumesUpdatedAt: null, items });
const staleSnap = (outAgeH = 9) =>
  snap([input(0.5), output({ Lymhurst: { sell: 1100, sellAt: ago(outAgeH), buy: 1000, buyAt: ago(outAgeH) } })]);

// ---------------------------------------------------------------------------
describe('moteur : prix périmés (showStale)', () => {
  it('défaut : une route qui ne tient qu’à des prix périmés est exclue et comptée « périmée »', () => {
    expect(DEFAULT_SETTINGS.showStale).toBe(false);
    const r = rankAll(staleSnap(), recipes, S(), now);
    expect(r.crafting).toHaveLength(0);
    expect(r.stats.stale).toBe(1);
  });

  it('activé : la route apparaît avec le drapeau stale et une confiance réduite de moitié', () => {
    const r = rankAll(staleSnap(), recipes, S({ showStale: true }), now);
    expect(r.crafting).toHaveLength(1);
    const row = r.crafting[0];
    expect(row.flags).toContain('stale');
    expect(row.oldestPriceAgeH).toBeCloseTo(9, 5);
    // confiance(âge ≥ max) = 0,5 (plancher), puis × 0,5.
    expect(STALE_CONFIDENCE_FACTOR).toBe(0.5);
    expect(row.confidence).toBeCloseTo(0.25, 5);
    expect(row.score).toBeCloseTo(row.unitProfit * row.q! * 0.25, 5);
  });

  it('les prix récents restent prioritaires sur les prix périmés', () => {
    const s = snap([
      input(0.5),
      output({
        Lymhurst: { sell: 900, sellAt: ago(0.5), buy: 800, buyAt: ago(0.5) },
        Martlock: { sell: 2100, sellAt: ago(9), buy: 2000, buyAt: ago(9) },
      }),
    ]);
    const row = rankAll(s, recipes, S({ showStale: true }), now).crafting[0];
    expect(row.sellAt).toBe('Lymhurst');
    expect(row.flags).not.toContain('stale');
    expect(row.confidence).toBe(1);
  });

  it('ingrédient périmé seul : drapeau stale aussi', () => {
    const s = snap([input(10), output({ Lymhurst: { sell: 1100, sellAt: ago(0.5), buy: 1000, buyAt: ago(0.5) } })]);
    expect(rankAll(s, recipes, S(), now).crafting).toHaveLength(0);
    const row = rankAll(s, recipes, S({ showStale: true }), now).crafting[0];
    expect(row.flags).toContain('stale');
    expect(row.confidence).toBeCloseTo(0.25, 5);
  });

  it('au-delà de 7 jours, un prix reste ignoré', () => {
    expect(STALE_MAX_AGE_H).toBe(168);
    expect(rankAll(staleSnap(200), recipes, S({ showStale: true }), now).crafting).toHaveLength(0);
  });

  it('Black Market : repli périmé également', () => {
    const s = snap([input(0.5), output({ 'Black Market': { sell: null, sellAt: null, buy: 1500, buyAt: ago(8) } })]);
    expect(rankAll(s, recipes, S(), now).blackMarket).toHaveLength(0);
    const bm = rankAll(s, recipes, S({ showStale: true }), now).blackMarket;
    expect(bm).toHaveLength(1);
    expect(bm[0].flags).toContain('stale');
  });

  it('sanitizeSettings : showStale booléen uniquement', () => {
    expect(sanitizeSettings({}).showStale).toBe(false);
    expect(sanitizeSettings({ showStale: true }).showStale).toBe(true);
    expect(sanitizeSettings({ showStale: 'oui' }).showStale).toBe(false);
  });
});

describe('ageTone : code couleur unique', () => {
  it('< 1 h, < max, ≥ max (périmé), ≥ 24 h (grisé)', () => {
    expect(ageTone(0.5, 6)).toBe('fresh');
    expect(ageTone(3, 6)).toBe('ok');
    expect(ageTone(6, 6)).toBe('stale');
    expect(ageTone(9, 6)).toBe('stale');
    expect(ageTone(24, 6)).toBe('old');
    expect(ageTone(30, 48)).toBe('old');
    expect(ageTone(Infinity, 6)).toBe('old');
  });

  it('AgeBadge : classe et mention « périmé »', () => {
    const { container } = render(<AgeBadge h={9} maxH={6} />);
    const el = container.querySelector('.age')!;
    expect(el.className).toContain('age-t-stale');
    expect(el.textContent).toBe('9\u202fhpérimé');
    cleanup();
    const { container: c2 } = render(<AgeBadge h={0.5} maxH={6} />);
    expect(c2.querySelector('.age')!.className).toContain('age-t-fresh');
    expect(c2.textContent).not.toMatch(/périmé/);
  });
});

// ---------------------------------------------------------------------------
const metaById = new Map<string, ItemMeta>(recipes.meta.map((m) => [m.id, m]));
const freshRow = (): RouteResult => rankAll(snap([input(0.5), output({ Lymhurst: { sell: 1100, sellAt: ago(0.5), buy: 1000, buyAt: ago(0.5) } })]), recipes, S(), now).crafting[0];

beforeEach(() => {
  window.localStorage.clear();
  reloadFavorites();
});
afterEach(() => cleanup());

describe('classements : colonnes et détail par ligne', () => {
  it('en-têtes renommés avec aide', () => {
    render(<RouteTable rows={[freshRow()]} metaById={metaById} variant="ranked" caption="t" />);
    for (const n of [/Profit\/unité/, /Ventes\/jour \(marché\)/, /Vous vendez\/jour/, /Confiance/, /Profit\/jour estimé/, /Âge des prix/]) {
      const th = screen.getByRole('columnheader', { name: n });
      expect(th.getAttribute('title')).toBeTruthy();
    }
    expect(screen.getByRole('columnheader', { name: /Profit\/jour estimé/ }).getAttribute('aria-sort')).toBe('descending');
    expect(screen.getByText('≈ 20')).toBeTruthy(); // 200 × 10 %
  });

  it('pastille ambre « Prix de 9 h » sur une route périmée', () => {
    const row = rankAll(staleSnap(), recipes, S({ showStale: true }), now).crafting[0];
    render(<RouteTable rows={[row]} metaById={metaById} variant="ranked" caption="t" settings={S({ showStale: true })} />);
    const flag = screen.getAllByText('Prix de 9 h').find((n) => n.classList.contains('flag'))!;
    expect(flag.className).toContain('flag-stale');
  });

  it('panneau de détail dépliable, au clavier (bouton + aria-expanded)', () => {
    const r = freshRow();
    render(<RouteTable rows={[r]} metaById={metaById} variant="ranked" caption="t" />);
    const btn = screen.getByRole('button', { name: /Détail du calcul : Sac d’adepte/ });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    const panel = document.getElementById(btn.getAttribute('aria-controls')!)!;
    const txt = panel.textContent!.replace(/\u202f/g, ' ');
    expect(txt).toMatch(/Vous gagnez .* ag par unité \(vente .* ag − taxes .* ag − achats .* ag − frais de station .* ag\)/);
    expect(txt).toMatch(/Le marché de Lymhurst écoule ≈ 200 unités\/jour ; avec votre part de 10 %, vous en vendez ≈ 20\/jour/);
    expect(txt).toMatch(/Capital nécessaire pour une journée/);
    expect(txt).toMatch(/Confiance : élevée/);
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('décomposition cohérente : vente − taxes − achats − frais = profit', () => {
    const r = freshRow();
    const b = routeBreakdown(r, S());
    expect(b.gross - b.taxes - b.purchases - b.fee).toBeCloseTo(r.unitProfit, 6);
    expect(b.dailyProfit).toBeCloseTo(r.unitProfit * r.q!, 6);
    expect(b.dailyCapital).toBeCloseTo(r.unitCost * r.q!, 6);
  });

  it('raisons de confiance : prix périmés mentionnés', () => {
    const row = rankAll(staleSnap(), recipes, S({ showStale: true }), now).crafting[0];
    expect(confidenceReasons(row, S({ showStale: true })).join(' ')).toMatch(/périmés \(9\u202fh, au-delà de votre limite de 6\u202fh\)/);
  });
});

// ---------------------------------------------------------------------------
describe('favoris : stockage', () => {
  it('sanitisation : chaînes valides, sans doublon, 200 au plus', () => {
    expect(sanitizeFavorites(null)).toEqual([]);
    expect(sanitizeFavorites(['A', 'A', 3, '', ' B ', 'x y', '<script>'])).toEqual(['A', 'B']);
    expect(sanitizeFavorites(Array.from({ length: 300 }, (_, i) => `T4_${i}`))).toHaveLength(MAX_FAVORITES);
  });

  it('persistance localStorage et lecture tolérante', () => {
    expect(toggleFavorite('T4_OUT')).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(FAVORITES_KEY)!)).toEqual(['T4_OUT']);
    expect(toggleFavorite('T4_OUT')).toBe(false);
    expect(getFavorites()).toEqual([]);
    window.localStorage.setItem(FAVORITES_KEY, '{pas du json');
    reloadFavorites();
    expect(getFavorites()).toEqual([]);
  });

  it('limite de 200', () => {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from({ length: 200 }, (_, i) => `T4_${i}`)));
    reloadFavorites();
    expect(addFavorite('T8_NEW')).toBe(false);
    expect(getFavorites()).toHaveLength(200);
  });

  it('hook partagé : tous les composants se mettent à jour', () => {
    const a = renderHook(() => useFavorites());
    const b = renderHook(() => useFavorites());
    act(() => {
      a.result.current.toggle('T4_OUT');
    });
    expect(b.result.current.ids).toEqual(['T4_OUT']);
    expect(b.result.current.has('T4_OUT')).toBe(true);
  });
});

describe('favoris : étoile', () => {
  it('aria-pressed et libellés, synchronisés entre deux étoiles', () => {
    render(
      <>
        <FavoriteButton id="T4_OUT" />
        <FavoriteButton id="T4_OUT" />
      </>,
    );
    const [s1, s2] = screen.getAllByRole('button', { name: 'Ajouter aux favoris' });
    expect(s1.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(s1);
    expect(s1.getAttribute('aria-pressed')).toBe('true');
    expect(s2.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getAllByRole('button', { name: 'Retirer des favoris' })).toHaveLength(2);
  });

  it('étoile dans chaque ligne de classement', () => {
    render(<RouteTable rows={[freshRow()]} metaById={metaById} variant="ranked" caption="t" />);
    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: 'Ajouter aux favoris' }));
    expect(getFavorites()).toEqual(['T4_OUT']);
  });
});

// ---------------------------------------------------------------------------
function appData(o: Partial<AppData> = {}): AppData {
  const snapshot = snap([input(0.5), output({ Lymhurst: { sell: 1100, sellAt: ago(0.5), buy: 1000, buyAt: ago(0.5) }, Martlock: { sell: 1300, sellAt: ago(10), buy: 1200, buyAt: ago(10) } })]);
  const r = rankAll(snapshot, recipes, S(), now);
  return {
    snapshot,
    recipes,
    rankings: { ...r, ms: 1 },
    settings: S(),
    updateSettings: () => {},
    resetSettings: () => {},
    ...buildIndexes(snapshot, recipes),
    now,
    ...o,
  };
}
const renderFav = (o?: Partial<AppData>) =>
  render(
    <AppDataContext.Provider value={appData(o)}>
      <FavoritesPage />
    </AppDataContext.Provider>,
  );

describe('page Favoris', () => {
  it('état vide explicatif avec liens vers les classements', () => {
    renderFav();
    expect(screen.getByRole('heading', { level: 1, name: 'Favoris' })).toBeTruthy();
    expect(screen.getByText(/Aucun favori pour l’instant/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Voir le top raffinage' }).getAttribute('href')).toBe('#/raffinage');
    expect(screen.getByRole('link', { name: 'Voir le top craft' }).getAttribute('href')).toBe('#/craft');
  });

  it('liste : nom, tier, meilleurs prix avec âge coloré, meilleure route, retrait', () => {
    addFavorite('T4_IN');
    addFavorite('T4_OUT');
    const { container } = renderFav();
    const cards = container.querySelectorAll('.fav-card');
    expect(cards).toHaveLength(2);
    const out = cards[0] as HTMLElement; // le plus récent d'abord
    expect(within(out).getAllByRole('link', { name: /Sac d’adepte/ })[0].getAttribute('href')).toBe('#/item/T4_OUT');
    expect(within(out).getByText('4.0')).toBeTruthy();
    // Vente instantanée : prix récent de Lymhurst (1 000) préféré au prix périmé de Martlock (1 200).
    expect(within(out).getByText('1 000 ag')).toBeTruthy();
    expect(out.querySelector('.age-t-fresh')).toBeTruthy();
    expect(within(out).getByText(/\/unité/)).toBeTruthy();
    expect(within(out).getByText(/\/jour/)).toBeTruthy();
    // Ingrédient non classé.
    expect(within(cards[1] as HTMLElement).getByText('Pas de route rentable avec vos réglages')).toBeTruthy();
    fireEvent.click(within(out).getByRole('button', { name: 'Retirer Sac d’adepte des favoris' }));
    expect(container.querySelectorAll('.fav-card')).toHaveLength(1);
    expect(getFavorites()).toEqual(['T4_IN']);
  });

  it('bestQuote : prix périmé retourné à défaut de prix récent', () => {
    const it = output({ Martlock: { sell: 1300, sellAt: ago(10), buy: 1200, buyAt: ago(10) } });
    const q = bestQuote(it, 'sell', S(), now)!;
    expect(q.loc).toBe('Martlock');
    expect(q.ageH).toBeCloseTo(10, 5);
    expect(bestQuote(undefined, 'sell', S(), now)).toBeNull();
  });
});
