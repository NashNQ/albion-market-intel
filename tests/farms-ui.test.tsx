// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AppDataContext, buildIndexes, type AppData } from '../src/ui/context';
import { FarmsPage } from '../src/ui/pages/Farms';
import { FARMS_KEY } from '../src/ui/data/farmsStore';
import { NOW, RECIPES, SETTINGS, SNAPSHOT } from './farm-fixture';
import type { RecipesFile } from '../src/types';

function renderPage(recipes: RecipesFile = RECIPES) {
  const data: AppData = {
    snapshot: SNAPSHOT,
    recipes,
    rankings: null,
    settings: SETTINGS,
    updateSettings: () => {},
    resetSettings: () => {},
    ...buildIndexes(SNAPSHOT, recipes),
    now: NOW,
  };
  return render(
    <AppDataContext.Provider value={data}>
      <FarmsPage />
    </AppDataContext.Provider>,
  );
}
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s/gu, ' ');

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe('page Fermes', () => {
  it('classement : tri par profit, cardère arrosée en tête, détail pas à pas', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Fermes' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Classement' }).getAttribute('aria-selected')).toBe('true');
    const table = screen.getByRole('table');
    const profitTh = within(table).getByRole('columnheader', { name: /Profit\/parcelle\/jour/ });
    expect(profitTh.getAttribute('aria-sort')).toBe('descending');
    const rows = within(table).getAllByRole('row').slice(1);
    // Ligne la plus rentable de la fixture : cochon (abattage) ou cardère ; la cardère arrosée vaut 39 312.
    const teaselRow = rows.find((r) => /Cardère incendiaire/.test(r.textContent ?? '') && /arrosée/.test(r.textContent ?? '') && !/non arrosée/.test(r.textContent ?? ''))!;
    expect(txt(teaselRow)).toContain('39 312 ag');
    expect(txt(teaselRow)).toContain('9 000');
    expect(txt(teaselRow)).toContain('3,53');
    fireEvent.click(teaselRow);
    const detail = screen.getByRole('complementary', { name: 'Cardère incendiaire' });
    expect(within(detail).getByText('Récolte par emplacement')).toBeTruthy();
    expect(txt(detail)).toContain('39 312');
    // Filtre type : animaux seulement
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'animal' } });
    expect(within(screen.getByRole('table')).queryByText('Cardère incendiaire')).toBeNull();
    expect(within(screen.getByRole('table')).getAllByText('Cochon').length).toBeGreaterThan(0);
    // Cochon : pas de « Garder et produire »
    fireEvent.change(screen.getByLabelText('Stratégie animale'), { target: { value: 'produce' } });
    expect(within(screen.getByRole('table')).queryByText('Cochon')).toBeNull();
    expect(within(screen.getByRole('table')).getByText('Poulet')).toBeTruthy();
  });

  it('planificateur : préréglage Lymhurst, ajout d’une île, persistance localStorage', () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Planificateur d’îles' }));
    expect(screen.getByRole('region', { name: 'Île Île de Lymhurst' })).toBeTruthy();
    expect((screen.getByLabelText('Focus disponible par jour') as HTMLInputElement).value).toBe('10000');
    const isl = screen.getByRole('region', { name: 'Île Île de Lymhurst' });
    expect(within(isl).getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByTestId('farm-total').textContent).toMatch(/ag$/);

    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une île' }));
    expect(screen.getByRole('region', { name: 'Île Île 2' })).toBeTruthy();
    const stored = JSON.parse(window.localStorage.getItem(FARMS_KEY)!);
    expect(stored.islands).toHaveLength(2);
    expect(stored.islands[0].city).toBe('Lymhurst');

    // Renommer, changer la ville, rechargement → état conservé
    fireEvent.change(within(screen.getByRole('region', { name: 'Île Île 2' })).getByLabelText('Nom de l’île'), { target: { value: 'Ma ferme' } });
    fireEvent.change(screen.getByLabelText('Ville de Ma ferme'), { target: { value: 'Martlock' } });
    cleanup();
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Planificateur d’îles' }));
    expect(screen.getByRole('region', { name: 'Île Ma ferme' })).toBeTruthy();
    expect((screen.getByLabelText('Ville de Ma ferme') as HTMLSelectElement).value).toBe('Martlock');

    // Supprimer puis réinitialiser
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer Ma ferme' }));
    expect(screen.queryByRole('region', { name: 'Île Ma ferme' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Réinitialiser' }));
    expect(JSON.parse(window.localStorage.getItem(FARMS_KEY)!).islands).toHaveLength(1);
  });

  it('planificateur : 2 jardins de cardère, 10 000 focus → 1 arrosé, 1 000 restant', () => {
    window.localStorage.setItem(
      FARMS_KEY,
      JSON.stringify({
        v: 1,
        islands: [
          {
            id: 'a',
            name: 'Test',
            city: 'Martlock',
            plots: [
              { id: 'p1', type: 'jardin', activity: 'crop:T5_FARM_TEASEL_SEED' },
              { id: 'p2', type: 'jardin', activity: 'crop:T5_FARM_TEASEL_SEED' },
            ],
          },
        ],
        focusPerDay: 10000,
        specs: {},
      }),
    );
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Planificateur d’îles' }));
    expect(txt(screen.getByTestId('farm-focus-left'))).toBe('1 000');
    expect(txt(screen.getByTestId('farm-total'))).toBe('46 872 ag'); // 39 312 + 7 560
    expect(screen.getAllByText('Arrosé')).toHaveLength(1);
    expect(screen.getByRole('list', { name: 'Avertissements' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Liste de courses (par jour)' })).toBeTruthy();
  });

  it('panneau hypothèses : modification et valeurs par défaut', () => {
    renderPage();
    const panel = screen.getByText('Hypothèses').closest('details')!;
    const slots = within(panel).getByLabelText('Emplacements par parcelle') as HTMLInputElement;
    expect(slots.value).toBe('9');
    expect(within(panel).getByRole('link', { name: /wiki.albiononline.com\/wiki\/Farming/ })).toBeTruthy();
    fireEvent.change(slots, { target: { value: '10' } });
    expect(JSON.parse(window.localStorage.getItem(FARMS_KEY)!).assumptions.slotsPerPlot).toBe(10);
    const row = within(screen.getByRole('table')).getAllByRole('row').find((r) => /Cardère incendiaire/.test(r.textContent ?? '') && /· arrosée/.test(r.textContent ?? ''))!;
    expect(txt(row)).toContain('43 680 ag'); // 10 × 4 368
    fireEvent.click(within(panel).getByRole('button', { name: 'Valeurs par défaut' }));
    expect((within(panel).getByLabelText('Emplacements par parcelle') as HTMLInputElement).value).toBe('9');
  });

  it('sans données agricoles : message explicite', () => {
    const { farming: _f, ...rest } = RECIPES;
    renderPage(rest as RecipesFile);
    expect(screen.getByText(/données agricoles ne sont pas encore disponibles/)).toBeTruthy();
  });
});
