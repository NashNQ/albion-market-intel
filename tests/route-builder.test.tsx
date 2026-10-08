// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NOW, RECIPES, SETTINGS, SNAPSHOT } from './chain-fixture';

vi.mock('../src/ui/data/useMarket', () => ({
  useMarket: () => ({
    snapshot: SNAPSHOT,
    recipes: RECIPES,
    status: 'fresh',
    updatedAt: new Date(SNAPSHOT.updatedAt),
    ageMinutes: 5,
    reload: () => {},
  }),
}));
vi.mock('../src/ui/data/useSettings', () => ({
  useSettings: () => [{ ...SETTINGS }, () => {}, () => {}],
}));
vi.mock('../src/ui/data/useRankings', () => ({
  useRankings: () => ({ rankings: null, computeMs: 0 }),
}));

const { App } = await import('../src/ui/App');
const { ROUTES_KEY, encodeShare } = await import('../src/ui/data/routesStore');

function go(hash: string) {
  window.location.hash = hash;
  return render(<App />);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.location.hash = '';
});

describe('page Mes routes', () => {
  it('onglet, préréglage T2→T4 bois, profit total et sauvegarde dans la liste', () => {
    const { container } = go('#/routes');
    expect(screen.getByRole('heading', { level: 1, name: 'Mes routes' })).toBeTruthy();
    const tab = screen.getByRole('link', { name: 'Mes routes' });
    expect(tab.getAttribute('aria-current')).toBe('page');
    expect(screen.getByText(/Aucune route enregistrée/)).toBeTruthy();

    // Préréglage par défaut : Bois → Planches, T2 → T4, sans enchantement.
    fireEvent.click(screen.getByRole('button', { name: 'Générer la chaîne' }));
    expect(screen.getByRole('article', { name: /Étape 1 : Planches de bouleau/ })).toBeTruthy();
    expect(screen.getByRole('article', { name: /Étape 2 : Planches de châtaignier/ })).toBeTruthy();
    const last = screen.getByRole('article', { name: /Étape 3 : Planches de pin/ });
    expect(within(last).getByText('Produit vendu')).toBeTruthy();
    // Comparateur présent sur les intermédiaires
    expect(within(last).getByRole('button', { name: 'Remplacer par un achat' })).toBeTruthy();

    // Profit total (calcul à la main de chain.test.ts : 13 404,8 → « 13 405 ag »)
    expect(screen.getByTestId('rb-profit-total').textContent?.replace(/\s/gu, ' ')).toBe('13 405 ag');
    expect(screen.getByText('Profit total')).toBeTruthy();

    // Sauvegarde
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(screen.getByText(/Route « Planches T2 → T4 » enregistrée/)).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Routes enregistrées' });
    expect(within(list).getByRole('button', { name: 'Planches T2 → T4' })).toBeTruthy();
    expect(within(list).getByText('13 405 ag')).toBeTruthy();
    const stored = JSON.parse(window.localStorage.getItem(ROUTES_KEY)!);
    expect(stored).toHaveLength(1);
    expect(stored[0].steps).toHaveLength(3);

    // Bascule quantité de départ : 64 crafts T2 ≡ 100 T4 → même profit
    fireEvent.click(screen.getByRole('button', { name: 'Quantité de départ' }));
    fireEvent.change(screen.getByLabelText('Crafts de départ'), { target: { value: '64' } });
    expect(screen.getByTestId('rb-profit-total').textContent?.replace(/\s/gu, ' ')).toBe('13 405 ag');

    expect(container.textContent).not.toMatch(/\b(Save|Share|Export|Loading)\b/);
  });

  it('remplacer un intermédiaire par un achat avec confirmation inline', () => {
    go('#/routes');
    fireEvent.click(screen.getByRole('button', { name: 'Générer la chaîne' }));
    const last = screen.getByRole('article', { name: /Étape 3/ });
    fireEvent.click(within(last).getByRole('button', { name: 'Remplacer par un achat' }));
    expect(screen.getByText(/rend inutile les étapes 1/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remplacer et supprimer' }));
    expect(screen.queryByRole('article', { name: /Étape 2/ })).toBeNull();
    // 24 000 − 6 400 − 80 × 110 − 720 = 8 080
    expect(screen.getByTestId('rb-profit-total').textContent?.replace(/\s/gu, ' ')).toBe('8 080 ag');
  });

  it('route partagée par URL : proposition d’enregistrement', () => {
    const code = encodeShare({
      name: 'Partagée',
      steps: [{ outputId: 'T2_PLANKS', craftAt: 'auto', inputs: [{ id: 'T2_WOOD', source: { type: 'buy', at: 'auto' } }] }],
      final: { sellAt: 'auto', qty: 10, qtyMode: 'final' },
    });
    go(`#/routes?r=${code}`);
    expect(screen.getByText('Partagée', { selector: 'strong' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer cette route partagée' }));
    const list = screen.getByRole('list', { name: 'Routes enregistrées' });
    expect(within(list).getByRole('button', { name: 'Partagée' })).toBeTruthy();
  });
});
