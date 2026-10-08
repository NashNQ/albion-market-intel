// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AppDataContext, buildIndexes, type AppData } from '../src/ui/context';
import { FarmsPage } from '../src/ui/pages/Farms';
import { FARMS_KEY, loadFarms, sanitizeFarms } from '../src/ui/data/farmsStore';
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
    // Cardère arrosée : 9 × (2 592 + 48) = 23 760 (graine toujours rendue, sans excédent).
    const teaselRow = rows.find((r) => /Cardère incendiaire/.test(r.textContent ?? '') && /arrosée/.test(r.textContent ?? '') && !/non arrosée/.test(r.textContent ?? ''))!;
    expect(txt(teaselRow)).toContain('23 760 ag');
    expect(txt(teaselRow)).toContain('9 000');
    expect(txt(teaselRow)).toContain('1,80');
    fireEvent.click(teaselRow);
    const detail = screen.getByRole('complementary', { name: 'Cardère incendiaire' });
    expect(within(detail).getByText('Récolte par emplacement')).toBeTruthy();
    expect(txt(detail)).toContain('23 760');
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
    expect(txt(screen.getByTestId('farm-total'))).toBe('31 320 ag'); // 23 760 + 7 560
    expect(screen.queryByTestId('farm-total-missing')).toBeNull();
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
    expect(txt(row)).toContain('26 400 ag'); // 10 × 2 640
    fireEvent.click(within(panel).getByRole('button', { name: 'Valeurs par défaut' }));
    expect((within(panel).getByLabelText('Emplacements par parcelle') as HTMLInputElement).value).toBe('9');
  });

  it('stockage hostile : doublons d’ID, nombres énormes/négatifs, types faux, __proto__', () => {
    const plot = { id: 'dup', type: 'ferme', activity: 'auto' };
    const st = sanitizeFarms({
      v: 1,
      islands: [
        { id: 'i', name: 'x'.repeat(500), city: 'Black Market', plots: [plot, plot, { id: 'q', type: 'volcan' }, null, { id: 5, type: 'jardin', activity: 'z'.repeat(5000) }] },
        { id: 'i', name: 42, city: 'Martlock', plots: [plot] },
        'nope',
      ],
      focusPerDay: 1e300,
      specs: JSON.parse('{"__proto__": 50, "A": -5, "B": 1e9, "C": "80", "D": NaN}'.replace('NaN', 'null')),
      assumptions: { slotsPerPlot: -3, premiumYieldMultiplier: Infinity, cropCyclesPerDay: 0, maxVolumeShare: '0.5' },
      sellAt: 'Black Market',
      foodSource: 'poison',
    });
    expect(st.islands).toHaveLength(2);
    const ids = st.islands.flatMap((i) => [i.id, ...i.plots.map((p) => p.id)]);
    expect(new Set(ids).size).toBe(ids.length); // tous uniques
    expect(st.islands[0].plots).toHaveLength(3);
    expect(st.islands[0].plots[2].activity).toBe('auto'); // activité absurde → auto
    expect(st.islands[0].name).toHaveLength(60);
    expect(st.islands[0].city).toBe('Lymhurst');
    expect(st.islands[1].name).toBe('Île');
    expect(st.focusPerDay).toBe(1e7);
    expect(st.specs).toEqual({ A: 0, B: 100 });
    expect(Object.getPrototypeOf(st.specs)).toBe(Object.prototype);
    expect(st.assumptions.slotsPerPlot).toBe(1);
    expect(st.assumptions.premiumYieldMultiplier).toBe(2);
    expect(st.assumptions.cropCyclesPerDay).toBe(0.01);
    expect(st.assumptions.maxVolumeShare).toBe(0.1);
    expect(st.sellAt).toBe('auto');
    expect(st.foodSource).toBe('market');
    // JSON illisible → préréglage
    window.localStorage.setItem(FARMS_KEY, '{"v":1,');
    expect(loadFarms().islands[0].city).toBe('Lymhurst');
  });

  it('planificateur : parcelle sans données signalée, activité inconnue visible, quantités décimales', () => {
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
              { id: 'p2', type: 'ferme', activity: 'crop:INCONNU' },
            ],
          },
        ],
        focusPerDay: 0,
        specs: {},
      }),
    );
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Planificateur d’îles' }));
    expect(txt(screen.getByTestId('farm-total'))).toBe('7 560 ag');
    expect(txt(screen.getByTestId('farm-total-missing'))).toMatch(/Hors 1 parcelle sans données/);
    const isl = screen.getByRole('region', { name: 'Île Test' });
    const act = within(isl).getByLabelText('Activité de la parcelle 2') as HTMLSelectElement;
    expect(act.value).toBe('crop:INCONNU');
    expect(act.selectedOptions[0].textContent).toMatch(/inconnue/);
    // 0,2 graine × 9 emplacements = 1,8 (et non « 2 »)
    const buys = screen.getByRole('region', { name: 'Liste de courses (par jour)' });
    expect(txt(buys)).toContain('1,8');
  });

  it('classement : filtre « Stratégie animale » désactivé pour les cultures et herbes', () => {
    renderPage();
    const strat = screen.getByLabelText('Stratégie animale') as HTMLSelectElement;
    expect(strat.disabled).toBe(false);
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'herb' } });
    expect(strat.disabled).toBe(true);
  });

  it('sans données agricoles : message explicite', () => {
    const { farming: _f, ...rest } = RECIPES;
    renderPage(rest as RecipesFile);
    expect(screen.getByText(/données agricoles ne sont pas encore disponibles/)).toBeTruthy();
  });
});
