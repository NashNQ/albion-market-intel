// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AppDataContext, buildIndexes, type AppData } from '../src/ui/context';
import { InvestPage } from '../src/ui/pages/Invest';
import { INVEST_KEY, decodeInvestment, encodeInvestment, loadInvestments } from '../src/ui/data/investStore';
import { rankAll } from '../src/engine';
import { NOW, RECIPES, SETTINGS, SNAPSHOT } from './invest-fixture';

function renderPage() {
  const r = rankAll(SNAPSHOT, RECIPES, SETTINGS, NOW);
  const data: AppData = {
    snapshot: SNAPSHOT,
    recipes: RECIPES,
    rankings: { ...r, ms: 0 },
    settings: SETTINGS,
    updateSettings: () => {},
    resetSettings: () => {},
    ...buildIndexes(SNAPSHOT, RECIPES),
    now: NOW,
  };
  return render(
    <AppDataContext.Provider value={data}>
      <InvestPage />
    </AppDataContext.Provider>,
  );
}
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s/gu, ' ');
const input = (label: string | RegExp) => screen.getByLabelText(label) as HTMLInputElement;

function pickT6() {
  fireEvent.click(within(screen.getByRole('group', { name: /Suggestions/ })).getByRole('button', { name: /Planches de chêne sanguin/ }));
}

function setClipboard(writeText: ((t: string) => Promise<void>) | undefined) {
  Object.defineProperty(navigator, 'clipboard', { value: writeText ? { writeText } : undefined, configurable: true });
}

beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = '';
});
afterEach(() => {
  cleanup();
  setClipboard(undefined);
});

describe('page Investir — simulateur', () => {
  it('suggestions, chiffres de l’activité, verdict et graphique', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Investir' })).toBeTruthy();
    expect(screen.getByText('Choisissez une activité pour lancer la simulation.')).toBeTruthy();
    pickT6();
    const act = screen.getByRole('heading', { level: 3, name: /Planches de chêne sanguin \(T6\)/ }).parentElement!;
    expect(txt(act)).toContain('600 ag');
    expect(txt(act)).toContain('672 ag');
    expect(txt(act)).toContain('72 ag');
    expect(txt(act)).toContain('100 unités');
    // Capital 200 000 : fonds de roulement 600 × 100 × 2 = 120 000 couvert ; 100 × 72 × 50 % = 3 600 ag/jour
    // pour l'investisseur → 2 + 200 000 / 3 600 = 57,6 → ≈ 58 jours.
    fireEvent.change(input('Capital investi'), { target: { value: '200 000' } });
    expect(txt(screen.getByTestId('inv-verdict'))).toBe(
      'Votre capital revient en ≈ 58 jours dans le scénario central, plus d’un an en prudent.',
    );
    expect(screen.getByRole('img', { name: /Remboursement du capital/ })).toBeTruthy();
    expect(screen.getByText('Données du graphique')).toBeTruthy();
    expect(txt(screen.getByText(/Fonds de roulement nécessaire/))).toContain('600 ag × 100 unités/jour × 2 jours');
    // Capital 100 000 < 120 000 : 100 000 / (600 × 2) = 83,3 unités/jour → 3 000 ag/jour → 2 + 33,3 → ≈ 36 jours.
    fireEvent.change(input('Capital investi'), { target: { value: '100000' } });
    expect(txt(screen.getByTestId('inv-verdict'))).toMatch(/≈ 36 jours dans le scénario central/);
    expect(screen.getAllByText(/limitée par le capital/).length).toBeGreaterThan(0);
    // Unités non entières affichées avec une décimale : « 83,3 × 72 ag = 6 000 ag ».
    expect(txt(screen.getByText(/^Profit :/))).toMatch(/83,3 × 72 ag = 6 000 ag/);
  });

  it('prix manquants et activité non rentable : message clair, pas de chiffres', () => {
    renderPage();
    fireEvent.change(input('Activité financée (objet produit)'), { target: { value: 'frêne' } });
    fireEvent.click(screen.getByRole('button', { name: /Planches de frêne/ }));
    expect(screen.getByRole('alert').textContent).toMatch(/Prix manquants/);
    expect(screen.queryByTestId('inv-verdict')).toBeNull();
    fireEvent.change(input('Activité financée (objet produit)'), { target: { value: 'cedre t5' } });
    fireEvent.click(screen.getByRole('button', { name: /Planches de cèdre/ }));
    expect(screen.getByRole('alert').textContent).toMatch(/n’est pas rentable/);
    expect(screen.queryByLabelText('Capital investi')).toBeNull();
  });

  it('estimation de la montée T6 : reportée dans le champ, puis capital insuffisant', () => {
    renderPage();
    pickT6();
    fireEvent.click(screen.getByText('Estimer le coût de montée en compétence'));
    fireEvent.click(screen.getByLabelText(/Bonus de renommée premium/));
    fireEvent.click(screen.getByRole('button', { name: 'Estimer' }));
    // 125 × 1,16 + 338 × 5,8 + 1 364 × 9,2 + 1 556 × 57,6 = 104 279,8 → 104 280.
    expect(input('Dont coût de montée en compétence').value).toBe('104280');
    expect(txt(screen.getByText(/de renommée à gagner/))).toContain('258 963');
    fireEvent.change(input('Capital investi'), { target: { value: '100000' } });
    expect(screen.getByRole('alert').textContent).toMatch(/dépasse le capital/);
    fireEvent.change(input('Capital investi'), { target: { value: '1000000' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Point mort, coût de montée seul')).toBeTruthy();
  });

  it('famille sans données de montée : le dire', () => {
    renderPage();
    fireEvent.click(within(screen.getByRole('group', { name: /Suggestions/ })).getByRole('button', { name: /Sac/ }));
    fireEvent.click(screen.getByText('Estimer le coût de montée en compétence'));
    expect(screen.getByText(/Données de montée indisponibles/)).toBeTruthy();
  });
});

describe('page Investir — portefeuille', () => {
  function saveOne(member = 'Aldric') {
    pickT6();
    fireEvent.change(input('Membre financé'), { target: { value: member } });
    fireEvent.change(input('Capital investi'), { target: { value: '200000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer dans le portefeuille' }));
  }

  it('enregistrement, totaux, persistance, modification, duplication, suppression', () => {
    renderPage();
    saveOne();
    expect(screen.getByRole('status').textContent).toMatch(/Aldric enregistré/);
    const stored = loadInvestments(window.localStorage);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ member: 'Aldric', outputId: 'T6_PLANKS', capital: 200000, investorShare: 0.5, unitsPerDay: null });
    expect(stored[0].startUnitProfit).toBeCloseTo(72, 6);
    expect(txt(screen.getByTestId('inv-total-capital'))).toBe('200 000 ag');
    expect(txt(screen.getByTestId('inv-total-perday'))).toBe('3 600 ag');
    expect(txt(screen.getByTestId('inv-total-payback'))).toBe('≈ 58 jours');

    cleanup();
    renderPage();
    const item = screen.getByRole('listitem', { name: 'Investissement Aldric' });
    expect(txt(item)).toContain('Planches de chêne sanguin');
    fireEvent.click(within(item).getByRole('button', { name: 'Modifier' }));
    expect(input('Membre financé').value).toBe('Aldric');
    fireEvent.change(input('Part des profits pour l’investisseur'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mettre à jour l’investissement' }));
    expect(loadInvestments(window.localStorage)[0].investorShare).toBe(0.25);
    expect(loadInvestments(window.localStorage)).toHaveLength(1);

    fireEvent.click(within(screen.getByRole('listitem', { name: 'Investissement Aldric' })).getByRole('button', { name: 'Dupliquer' }));
    expect(screen.getByRole('listitem', { name: 'Investissement Aldric (copie)' })).toBeTruthy();
    expect(txt(screen.getByTestId('inv-total-capital'))).toBe('400 000 ag');

    const copy = screen.getByRole('listitem', { name: 'Investissement Aldric (copie)' });
    fireEvent.click(within(copy).getByRole('button', { name: 'Supprimer' }));
    expect(within(copy).getByText('Supprimer définitivement ?')).toBeTruthy();
    fireEvent.click(within(copy).getByRole('button', { name: 'Annuler' }));
    expect(screen.getByRole('listitem', { name: 'Investissement Aldric (copie)' })).toBeTruthy();
    fireEvent.click(within(copy).getByRole('button', { name: 'Supprimer' }));
    fireEvent.click(within(copy).getByRole('button', { name: 'Confirmer' }));
    expect(screen.queryByRole('listitem', { name: 'Investissement Aldric (copie)' })).toBeNull();
    expect(loadInvestments(window.localStorage)).toHaveLength(1);
  });

  it('stockage corrompu : la page s’affiche, les entrées invalides sont ignorées', () => {
    window.localStorage.setItem(INVEST_KEY, '{pas du json');
    renderPage();
    expect(screen.getByText(/Aucun investissement enregistré/)).toBeTruthy();
    cleanup();
    window.localStorage.setItem(
      INVEST_KEY,
      JSON.stringify({
        v: 1,
        items: [
          null,
          { v: 1, id: 'x', member: 'Sans activité', capital: 10 },
          { v: 1, id: 'y', member: 'Capital négatif', outputId: 'T6_PLANKS', capital: -5 },
          { v: 1, id: 'z', member: '  Brynja  ', outputId: 'T6_PLANKS', capital: 50000, levelingCost: 99999999, investorShare: 7, startDate: 'hier' },
          { v: 1, id: 'z', member: 'Doublon', outputId: 'T6_PLANKS', capital: 1 },
        ],
      }),
    );
    renderPage();
    const items = screen.getAllByRole('listitem', { name: /^Investissement / });
    expect(items).toHaveLength(1);
    const [inv] = loadInvestments(window.localStorage);
    expect(inv.member).toBe('Brynja');
    expect(inv.levelingCost).toBe(50000); // borné au capital
    expect(inv.investorShare).toBe(0.5); // part invalide → défaut
    expect(inv.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('copie du résumé Discord (presse-papiers simulé) puis repli', async () => {
    renderPage();
    saveOne();
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard(writeText);
    const item = screen.getByRole('listitem', { name: 'Investissement Aldric' });
    await act(async () => {
      fireEvent.click(within(item).getByRole('button', { name: 'Copier le résumé pour Discord' }));
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    const raw = (writeText.mock.calls[0] as unknown as [string])[0];
    const text = raw.replace(/\u202f/g, ' ');
    expect(text).toContain('**Investissement de guilde — Aldric**');
    expect(text).toContain('Planches de chêne sanguin (T6)');
    expect(text).toContain('Capital : 200 000 ag · part investisseur 50 %');
    expect(text).toContain('Point mort : ≈ 58 jours (central)');
    expect(text).toMatch(/ROI 30 j : [+−]\d+ %/);
    const code = /#\/guilde\/investir\?i=([A-Za-z0-9_-]+)>$/.exec(text)![1];
    expect(decodeInvestment(code)).toMatchObject({ member: 'Aldric', outputId: 'T6_PLANKS', capital: 200000 });
    expect(within(item).getByRole('button', { name: 'Résumé copié' })).toBeTruthy();

    setClipboard(() => Promise.reject(new Error('refusé')));
    await act(async () => {
      fireEvent.click(within(item).getByRole('button', { name: 'Copier le lien' }));
    });
    const area = screen.getByLabelText(/Copie automatique impossible/) as HTMLTextAreaElement;
    expect(area.value).toContain('#/guilde/investir?i=');
    expect(document.activeElement).toBe(area);
  });

  it('lien de partage : pré-remplit le simulateur', () => {
    const code = encodeInvestment({
      v: 1,
      member: 'Kael',
      outputId: 'T6_PLANKS',
      capital: 250000,
      levelingCost: 0,
      investorShare: 0.4,
      unitsPerDay: 50,
      rotationDays: 3,
      startDate: '2026-10-01',
      startUnitProfit: 70,
      startUnitCost: 600,
    });
    window.location.hash = '#/investir?i=' + code;
    renderPage();
    expect(screen.getByText(/Investissement partagé chargé \(Kael\)/)).toBeTruthy();
    expect(input('Membre financé').value).toBe('Kael');
    expect(input('Capital investi').value).toBe('250000');
    expect(input('Part des profits pour l’investisseur').value).toBe('40');
    expect(input('Unités produites par jour').value).toBe('50');
    expect(input('Rotation du stock').value).toBe('3');
    cleanup();
    window.location.hash = '#/investir?i=@@@';
    renderPage();
    expect(screen.getByText(/Lien de partage illisible/)).toBeTruthy();
  });
});
