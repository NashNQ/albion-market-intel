// @vitest-environment jsdom
// Corrections d'interface issues de l'audit : traductions, confiance 0,86, pluriels, tri.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ItemMeta, Recipe, RouteResult } from '../src/types';
import { CATEGORY_FR, SUBCATEGORY_FR, categoryLabel, subcategoryLabel } from '../src/ui/i18n';
import { plural } from '../src/ui/format';
import { ConfidenceBar } from '../src/ui/components/Route';
import { EMPTY_FILTERS, Filters } from '../src/ui/components/Filters';
import { RouteTable } from '../src/ui/components/RouteTable';

afterEach(() => cleanup());

const mk = (id: string, name: string, subcategory: string, category: string, profit: number, score: number): { r: RouteResult; m: ItemMeta } => {
  const recipe: Recipe = { outputId: id, outputQty: 1, inputs: [{ id: 'IN', qty: 1, returnable: true }], itemValue: 1, kind: 'crafting', bonusKey: 'x', category, subcategory, tier: 4, enchant: 0 };
  return {
    r: { recipe, buyFrom: { IN: 'Martlock' }, craftAt: 'Lymhurst', sellAt: 'Caerleon', rrr: 0.2, unitCost: 1, unitRevenue: 1 + profit, unitProfit: profit, volume: 100, q: 10, confidence: 0.86, score, oldestPriceAgeH: 0.5, flags: ['estimated'] },
    m: { id, nameFr: name, nameEn: name, tier: 4, enchant: 0, category, subcategory },
  };
};
const rows = [
  mk('B', 'Bâton', 'arcanestaff', 'weapons', 50, 300),
  mk('A', 'Sac', 'bags', 'bags', 300, 100),
  mk('C', 'Épée', 'sword', 'weapons', 100, 200),
];
const metaById = new Map(rows.map((x) => [x.m.id, x.m]));
const data = rows.map((x) => x.r);

describe('3a : traductions des catégories', () => {
  it('module i18n complet avec repli sur l’ID brut', () => {
    expect(Object.keys(CATEGORY_FR)).toHaveLength(13);
    expect(Object.keys(SUBCATEGORY_FR)).toHaveLength(53);
    expect(subcategoryLabel('food')).toBe('Cuisine');
    expect(subcategoryLabel('potions')).toBe('Alchimie');
    expect(categoryLabel('bags')).toBe('Sacs');
    expect(subcategoryLabel('bags')).toBe('Sacs');
    expect(subcategoryLabel('refinedresources')).toBe('Ressources raffinées');
    expect(subcategoryLabel('inconnu_xyz')).toBe('inconnu_xyz');
  });

  it('filtre Catégorie : aucune valeur anglaise visible', () => {
    render(<Filters rows={data} value={EMPTY_FILTERS} onChange={() => {}} />);
    const select = screen.getByLabelText('Catégorie') as HTMLSelectElement;
    const labels = [...select.querySelectorAll('option, optgroup')].map((o) => (o as HTMLOptionElement).label || o.textContent);
    expect(labels).toEqual(expect.arrayContaining(['Sacs', 'Armes', 'Bâtons arcaniques', 'Épées']));
    for (const l of labels) expect(l).not.toMatch(/\b(bags|weapons|arcanestaff|sword)\b/);
  });

  it('table : sous-catégorie traduite sous le nom', () => {
    render(<RouteTable rows={data} metaById={metaById} variant="ranked" caption="t" />);
    expect(screen.getAllByText('Bâtons arcaniques').length).toBeGreaterThan(0);
    expect(screen.queryByText('arcanestaff')).toBeNull();
  });
});

describe('3b : confiance affichée sur 1', () => {
  it('0.86 → « 0,86 » et barre à 86 %', () => {
    const { container } = render(<ConfidenceBar c={0.86} />);
    expect(screen.getByText('0,86')).toBeTruthy();
    expect((container.querySelector('.cbar-fill') as HTMLElement).style.width).toBe('86%');
    expect(container.textContent).not.toMatch(/^86$/);
  });
});

describe('3c : pluriels', () => {
  it('singulier pour 0 et 1, pluriel au-delà', () => {
    expect(plural(1, 'suspect')).toBe('1 suspect');
    expect(plural(2, 'suspect')).toBe('2 suspects');
    expect(plural(1, 'route rentable')).toBe('1 route rentable');
    expect(plural(3, 'route rentable')).toBe('3 routes rentables');
    expect(plural(0, 'route rentable')).toBe('0 route rentable');
    expect(plural(1, 'prix périmé', 'prix périmés')).toBe('1 prix périmé');
    expect(plural(1234, 'recette évaluée')).toBe('1\u202f234 recettes évaluées');
  });
});

describe('3d : tri des colonnes', () => {
  const names = () => within(screen.getByRole('table')).getAllByRole('link').map((a) => a.textContent);
  it('Objet : premier clic = croissant', () => {
    render(<RouteTable rows={data} metaById={metaById} variant="ranked" caption="t" />);
    fireEvent.click(within(screen.getByRole('columnheader', { name: /Objet/ })).getByRole('button'));
    expect(screen.getByRole('columnheader', { name: /Objet/ }).getAttribute('aria-sort')).toBe('ascending');
    expect(names()).toEqual(['Bâton', 'Épée', 'Sac']);
  });
  it('Profit/unité : premier clic = décroissant', () => {
    render(<RouteTable rows={data} metaById={metaById} variant="ranked" caption="t" />);
    fireEvent.click(within(screen.getByRole('columnheader', { name: /Profit\/unité/ })).getByRole('button'));
    expect(screen.getByRole('columnheader', { name: /Profit\/unité/ }).getAttribute('aria-sort')).toBe('descending');
    expect(names()).toEqual(['Sac', 'Épée', 'Bâton']);
  });
  it('badge « Estimé » dans la table', () => {
    render(<RouteTable rows={data} metaById={metaById} variant="ranked" caption="t" />);
    expect(within(screen.getByRole('table')).getAllByText('Estimé').length).toBe(3);
  });
});
