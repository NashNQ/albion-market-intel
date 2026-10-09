// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AppDataContext, buildIndexes, type AppData } from '../src/ui/context';
import { TransportPage } from '../src/ui/pages/Transport';
import type { MarketSnapshot, RecipesFile, Settings } from '../src/types';
import { META, NOW, SETTINGS, SNAPSHOT } from './transport-fixture';

const RECIPES: RecipesFile = { generatedAt: NOW.toISOString(), recipes: [], meta: META, bonuses: {} };

function renderPage(snapshot: MarketSnapshot | null = SNAPSHOT, settings: Settings = SETTINGS) {
  const data: AppData = {
    snapshot,
    recipes: RECIPES,
    rankings: null,
    settings,
    updateSettings: () => {},
    resetSettings: () => {},
    ...buildIndexes(snapshot, RECIPES),
    now: NOW,
  };
  return render(
    <AppDataContext.Provider value={data}>
      <TransportPage />
    </AppDataContext.Provider>,
  );
}
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s/gu, ' ');
const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);

afterEach(cleanup);

describe('page Transport', () => {
  it('explication, tableau trié par profit/jour, lien vers la fiche objet', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Transport' })).toBeTruthy();
    expect(screen.getByText(/sans rien fabriquer/)).toBeTruthy();
    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: /Profit\/jour/ }).getAttribute('aria-sort')).toBe('descending');
    const rows = bodyRows();
    // Sac 8 800 > Épée 4 600 ; le cuir (suspect) est masqué par défaut, les planches (périmées) exclues.
    expect(rows).toHaveLength(2);
    expect(txt(rows[0])).toContain('Sac de l’adepte');
    expect(txt(rows[0])).toContain('8 800 ag');
    expect(txt(rows[0])).toContain('440 ag');
    expect(txt(rows[0])).toContain('44 %');
    expect(txt(rows[1])).toContain('Zone rouge');
    const link = within(rows[0]).getByRole('link', { name: /Sac de l’adepte/ });
    expect(link.getAttribute('href')).toBe('#/item/T4_BAG');
    fireEvent.click(rows[1]);
    expect(window.location.hash).toBe('#/item/T5_MAIN_SWORD');
    // Pas de colonne profit/trajet sans charge renseignée.
    expect(within(table).queryByRole('columnheader', { name: /Profit\/trajet/ })).toBeNull();
  });

  it('charge max → profit par trajet ; filtres zone rouge et recherche', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Charge max'), { target: { value: '30' } });
    expect(within(screen.getByRole('table')).getByRole('columnheader', { name: /Profit\/trajet/ })).toBeTruthy();
    // ⌊30 / 2,5⌋ = 12 × 440 = 5 280.
    expect(txt(bodyRows()[0])).toContain('5 280 ag');
    fireEvent.click(screen.getByLabelText('Exclure la zone rouge'));
    expect(bodyRows()).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Rechercher'), { target: { value: 'epee' } });
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText(/Aucun trajet ne passe ces filtres/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Effacer les filtres' }));
    expect(bodyRows()).toHaveLength(2);
  });

  it('prix périmés inclus sur demande, ville d’arrivée', () => {
    renderPage();
    fireEvent.click(screen.getByLabelText('Inclure les prix plus vieux, marqués périmés'));
    const pl = bodyRows().find((r) => /Planches de pin/.test(r.textContent ?? ''))!;
    expect(txt(pl)).toContain('Périmé');
    expect(txt(pl)).toContain('Brumes');
    fireEvent.change(screen.getByLabelText('Ville d’arrivée'), { target: { value: 'Brecilien' } });
    expect(bodyRows()).toHaveLength(1);
  });

  it('état vide utile quand aucun prix récent', () => {
    renderPage(SNAPSHOT, { ...SETTINGS, maxPriceAgeH: 0.5 });
    expect(screen.getByText(/Aucun trajet rentable avec des prix de moins de/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Inclure les prix plus vieux' }));
    expect(bodyRows().length).toBeGreaterThan(0);
  });
});
