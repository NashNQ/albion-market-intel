// @vitest-environment jsdom
// Itération 6 : mode Guilde — interrupteur, persistance, onglets selon le mode, bascule automatique par route,
// tableau de bord, et sauvegarde JSON des données de guilde (fichier hostile refusé).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { rankAll } from '../src/engine';
import { NOW, RECIPES, SETTINGS, SNAPSHOT } from './invest-fixture';

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
  useRankings: () => ({ ...rankAll(SNAPSHOT, RECIPES, SETTINGS, NOW), ms: 0 }),
}));

const { App } = await import('../src/ui/App');
const { GuildSettingsPage } = await import('../src/ui/pages/guild/GuildSettings');
const { MODE_KEY } = await import('../src/ui/data/mode');
const { INVEST_KEY, decodeInvestment, encodeInvestment, investCodeFromHash, loadInvestments } = await import('../src/ui/data/investStore');
const { LOANS_KEY, loadLoans, reloadLoans } = await import('../src/ui/data/loansStore');
const { GUILD_KEY, loadGuildSettings, reloadGuildSettings } = await import('../src/ui/data/guildSettings');
const { BACKUP_KIND, parseBackup } = await import('../src/ui/data/guildBackup');

function go(hash: string) {
  window.location.hash = hash;
  return render(<App />);
}
async function navigate(hash: string) {
  await act(async () => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}
const tabNames = () =>
  within(screen.getByRole('navigation', { name: /^Sections/ }))
    .getAllByRole('link')
    .map((a) => a.textContent);
const modeSwitch = () => screen.getByRole('switch', { name: 'Mode Guilde' });

const INV_T6 = {
  v: 1 as const,
  id: 'inv-aldric',
  member: 'Aldric',
  outputId: 'T6_PLANKS',
  capital: 200000,
  levelingCost: 0,
  investorShare: 0.5,
  unitsPerDay: null,
  rotationDays: 2,
  startDate: '2026-10-01',
  startUnitProfit: 72,
  startUnitCost: 600,
  createdAt: '2026-10-01T10:00:00.000Z',
};
// T5 : non rentable aux prix de la fixture (voir invest-ui.test.tsx).
const INV_T5 = { ...INV_T6, id: 'inv-bran', member: 'Bran', outputId: 'T5_PLANKS', capital: 100000 };
const LOAN_OVERDUE = {
  id: 'loan-kael',
  borrower: 'Kael',
  itemId: 'T6_PLANKS',
  qty: 10,
  amount: 5000,
  rate: 0.1,
  startDate: '2026-10-01',
  dueDate: '2026-10-10',
  status: 'open',
};
const LOAN_SOON = { ...LOAN_OVERDUE, id: 'loan-mira', borrower: 'Mira', qty: 2, amount: 1000, rate: 0, dueDate: '2026-10-16' };

function seed() {
  window.localStorage.setItem(INVEST_KEY, JSON.stringify({ v: 1, items: [INV_T6, INV_T5] }));
  window.localStorage.setItem(LOANS_KEY, JSON.stringify({ v: 1, items: [LOAN_OVERDUE, LOAN_SOON] }));
  reloadLoans();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  window.localStorage.clear();
  reloadLoans();
  reloadGuildSettings();
  window.location.hash = '';
  delete document.documentElement.dataset.mode;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.location.hash = '';
});

describe('interrupteur Joueur / Guilde', () => {
  it('mode Joueur par défaut : interrupteur accessible, onglets joueur sans « Investir »', () => {
    go('#/raffinage');
    const sw = modeSwitch();
    expect(sw.tagName).toBe('BUTTON');
    expect(sw.getAttribute('type')).toBe('button');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(sw.textContent).toContain('Joueur');
    expect(sw.textContent).toContain('Guilde');
    expect(tabNames()).toContain('Raffinage');
    expect(tabNames()).not.toContain('Investir');
    expect(document.documentElement.dataset.mode).toBe('player');
    expect(screen.queryByText('Varwyn', { selector: '.guild-badge' })).toBeNull();
  });

  it('bascule en Guilde : tableau de bord, onglets de la guilde, nom dans l’en-tête, préférence enregistrée', async () => {
    go('#/raffinage');
    await act(async () => {
      fireEvent.click(modeSwitch());
    });
    expect(window.location.hash).toBe('#/guilde');
    await navigate('#/guilde');
    expect(modeSwitch().getAttribute('aria-checked')).toBe('true');
    expect(window.localStorage.getItem(MODE_KEY)).toBe('guild');
    expect(document.documentElement.dataset.mode).toBe('guild');
    expect(tabNames()).toEqual(['Tableau de bord', 'Investir', 'Prêts sur gage', 'Réglages guilde']);
    expect(screen.getByRole('link', { name: 'Tableau de bord' }).getAttribute('aria-current')).toBe('page');
    expect(document.querySelector('.guild-badge')?.textContent).toContain('Varwyn');
    expect(await screen.findByRole('heading', { level: 1, name: 'Tableau de bord de Varwyn' })).toBeTruthy();
    // Retour en Joueur par l'interrupteur.
    await act(async () => {
      fireEvent.click(modeSwitch());
    });
    expect(window.location.hash).toBe('#/');
    await navigate('#/');
    expect(modeSwitch().getAttribute('aria-checked')).toBe('false');
    expect(window.localStorage.getItem(MODE_KEY)).toBe('player');
  });

  it('persistance : accueil nu + mode Guilde mémorisé → tableau de bord de la guilde', async () => {
    window.localStorage.setItem(MODE_KEY, 'guild');
    go('');
    expect(window.location.hash).toBe('#/guilde');
    expect(modeSwitch().getAttribute('aria-checked')).toBe('true');
    expect(await screen.findByRole('heading', { level: 1, name: /Tableau de bord/ })).toBeTruthy();
  });

  it('bascule automatique selon la route', async () => {
    window.localStorage.setItem(MODE_KEY, 'guild');
    go('#/craft');
    // Une page joueur ouverte en mode Guilde repasse en Joueur.
    expect(modeSwitch().getAttribute('aria-checked')).toBe('false');
    expect(window.localStorage.getItem(MODE_KEY)).toBe('player');
    // Une page /guilde/* bascule en Guilde.
    await navigate('#/guilde/reglages');
    expect(modeSwitch().getAttribute('aria-checked')).toBe('true');
    expect(await screen.findByRole('heading', { level: 1, name: 'Réglages guilde' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Réglages guilde' }).getAttribute('aria-current')).toBe('page');
    // La fiche objet garde le mode courant.
    await navigate('#/item/T6_PLANKS');
    expect(modeSwitch().getAttribute('aria-checked')).toBe('true');
    await navigate('#/raffinage');
    expect(modeSwitch().getAttribute('aria-checked')).toBe('false');
    expect(tabNames()).not.toContain('Prêts sur gage');
  });

  it('stockage inaccessible : aucune erreur, mode Joueur', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqué');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqué');
    });
    go('');
    expect(modeSwitch().getAttribute('aria-checked')).toBe('false');
    fireEvent.click(modeSwitch());
    expect(modeSwitch().getAttribute('aria-checked')).toBe('true');
  });

  it('ancien lien #/investir?i=… : réécrit en #/guilde/investir?i=… et pré-remplit le simulateur', async () => {
    const code = encodeInvestment({ ...INV_T6, member: 'Kael' });
    go('#/investir?i=' + code);
    expect(window.location.hash).toBe('#/guilde/investir?i=' + code);
    expect(modeSwitch().getAttribute('aria-checked')).toBe('true');
    expect(await screen.findByText(/Investissement partagé chargé \(Kael\)/)).toBeTruthy();
    expect(investCodeFromHash('#/investir?i=abc')).toBe('abc');
    expect(investCodeFromHash('#/guilde/investir?i=abc')).toBe('abc');
  });
});

describe('tableau de bord de la guilde', () => {
  it('état vide utile', async () => {
    go('#/guilde');
    expect(await screen.findByText(/Rien à suivre pour l’instant/)).toBeTruthy();
  });

  it('chiffres clés, à faire aujourd’hui et opportunités qui pré-remplissent Investir', async () => {
    seed();
    go('#/guilde');
    await screen.findByRole('heading', { level: 1, name: /Tableau de bord/ });
    const stat = (label: string) => screen.getByText(label).closest('.g-stat')!.textContent!.replace(/\s/gu, ' ');
    expect(stat('Capital investi chez les membres')).toContain('300 000 ag');
    // Aldric : 100 unités × 72 ag × 50 % = 3 600 ag/jour ; Bran non rentable.
    expect(stat('Retour attendu par jour')).toContain('3 600 ag');
    expect(stat('Prêts en cours')).toContain('2');
    expect(stat('Montant dû')).toContain('6 500 ag');
    // Revente rapide : 700 × 0,96 = 672 ag/unité × 12 unités = 8 064 ag.
    expect(stat('Valeur des gages')).toContain('8 064 ag');
    expect(stat('À risque ou en retard')).toMatch(/^À risque ou en retard1/);

    const todo = within(screen.getByRole('region', { name: 'À faire aujourd’hui' }));
    expect(todo.getByText(/Prêt de Kael .* en retard de 4 jours/)).toBeTruthy();
    expect(todo.getByText(/Échéance dans 2 jours pour Mira/)).toBeTruthy();
    expect(todo.getByText(/Bran .* n’est plus rentable/)).toBeTruthy();

    const opp = within(screen.getByRole('region', { name: 'Opportunités pour financer un membre' }));
    const links = opp.getAllByRole('link', { name: /^Financer un membre/ });
    expect(links.length).toBeGreaterThan(0);
    expect(links.length).toBeLessThanOrEqual(5);
    const href = links[0].getAttribute('href')!;
    expect(href.startsWith('#/guilde/investir?i=')).toBe(true);
    expect(decodeInvestment(investCodeFromHash(href)!)).toMatchObject({ member: 'Membre à financer' });
    await navigate(href);
    expect(await screen.findByText(/Investissement partagé chargé \(Membre à financer\)/)).toBeTruthy();
  });
});

describe('réglages guilde : sauvegarde des données', () => {
  const validBackup = () => ({
    kind: BACKUP_KIND,
    v: 1,
    exportedAt: '2026-10-14T10:00:00.000Z',
    settings: { guildName: 'Varwyn Ouest', maxLtv: 0.5, defaultRate: 0.08, safetyMargin: 0.15, maxTermDays: 10 },
    investments: [INV_T6],
    loans: [LOAN_OVERDUE, LOAN_SOON],
  });

  async function importFile(text: string, name = 'sauvegarde.json') {
    const file = new File([text], name, { type: 'application/json' });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Importer un fichier de sauvegarde'), { target: { files: [file] } });
    });
  }

  it('politique de prêt : saisie en %, validation, enregistrement', () => {
    render(<GuildSettingsPage />);
    const ltv = screen.getByLabelText('Prêt maximal (LTV)') as HTMLInputElement;
    expect(ltv.value).toBe('60');
    fireEvent.change(ltv, { target: { value: '150' } });
    expect(ltv.getAttribute('aria-invalid')).toBe('true');
    fireEvent.blur(ltv);
    expect(loadGuildSettings().maxLtv).toBe(0.6);
    fireEvent.change(ltv, { target: { value: '45' } });
    fireEvent.blur(ltv);
    expect(loadGuildSettings().maxLtv).toBe(0.45);
    const name = screen.getByLabelText('Nom de la guilde') as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Varwyn Est' } });
    fireEvent.blur(name);
    expect(loadGuildSettings().guildName).toBe('Varwyn Est');
  });

  it('export : fichier JSON horodaté avec investissements, prêts et réglages', async () => {
    seed();
    let blob: Blob | null = null;
    const create = vi.fn((b: Blob) => {
      blob = b;
      return 'blob:x';
    });
    Object.defineProperty(URL, 'createObjectURL', { value: create, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, configurable: true });
    let fileName = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      fileName = this.download;
    });
    render(<GuildSettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Exporter un fichier JSON' }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(fileName).toMatch(/^varwyn-donnees-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
    const data = JSON.parse(await blob!.text());
    expect(data.kind).toBe(BACKUP_KIND);
    expect(data.exportedAt).toBe(NOW.toISOString());
    expect(data.investments.map((i: { id: string }) => i.id)).toEqual(['inv-aldric', 'inv-bran']);
    expect(data.loans).toHaveLength(2);
    expect(data.settings.guildName).toBe('Varwyn');
    expect(screen.getByRole('status').textContent).toMatch(/2 investissements, 2 prêts/);
    // Le fichier exporté se réimporte tel quel.
    expect(parseBackup(JSON.stringify(data)).ok).toBe(true);
  });

  it('import : aperçu, confirmation, puis remplacement', async () => {
    window.localStorage.setItem(INVEST_KEY, JSON.stringify({ v: 1, items: [INV_T5] }));
    render(<GuildSettingsPage />);
    await importFile(JSON.stringify(validBackup()));
    const box = within(await screen.findByRole('group', { name: 'Remplacer les données de ce navigateur ?' }));
    expect(box.getByText('1 investissement')).toBeTruthy();
    expect(box.getByText(/2 prêts sur gage/)).toBeTruthy();
    expect(box.getByText(/Varwyn Ouest/)).toBeTruthy();
    // Rien n'est remplacé avant confirmation.
    expect(loadInvestments().map((i) => i.id)).toEqual(['inv-bran']);
    fireEvent.click(box.getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('group', { name: /Remplacer/ })).toBeNull();
    expect(loadInvestments().map((i) => i.id)).toEqual(['inv-bran']);

    await importFile(JSON.stringify(validBackup()));
    fireEvent.click(await screen.findByRole('button', { name: 'Remplacer mes données' }));
    expect(loadInvestments().map((i) => i.id)).toEqual(['inv-aldric']);
    expect(loadLoans().map((l) => l.id)).toEqual(['loan-kael', 'loan-mira']);
    expect(loadGuildSettings()).toMatchObject({ guildName: 'Varwyn Ouest', maxLtv: 0.5, maxTermDays: 10 });
    // Le magasin partagé est à jour : le formulaire affiche les nouvelles valeurs.
    expect((screen.getByLabelText('Nom de la guilde') as HTMLInputElement).value).toBe('Varwyn Ouest');
    expect(screen.getByRole('status').textContent).toMatch(/Données importées/);
  });

  it('fichier hostile refusé, données intactes', async () => {
    seed();
    const before = {
      inv: window.localStorage.getItem(INVEST_KEY),
      loans: window.localStorage.getItem(LOANS_KEY),
      guild: window.localStorage.getItem(GUILD_KEY),
    };
    render(<GuildSettingsPage />);
    const hostile: [string, RegExp][] = [
      ['pas du json {', /pas du JSON valide/],
      [JSON.stringify({ kind: 'autre', v: 1 }), /n’est pas une sauvegarde/],
      [JSON.stringify([1, 2, 3]), /n’est pas une sauvegarde/],
      [JSON.stringify({ ...validBackup(), v: 99 }), /Version de sauvegarde inconnue/],
      [JSON.stringify({ ...validBackup(), investments: [{ ...INV_T6, outputId: '<img src=x onerror=alert(1)>' }] }), /Investissement n° 1 invalide/],
      [JSON.stringify({ ...validBackup(), loans: [LOAN_OVERDUE, { ...LOAN_SOON, amount: -5 }] }), /Prêt n° 2 invalide/],
      [JSON.stringify({ ...validBackup(), loans: [{ ...LOAN_OVERDUE, id: '../../etc' }] }), /Prêt n° 1 invalide/],
      [JSON.stringify({ ...validBackup(), loans: Array.from({ length: 101 }, (_, i) => ({ ...LOAN_OVERDUE, id: 'l' + i })) }), /Trop de prêts/],
      ['{"kind":"' + BACKUP_KIND + '","v":1,"pad":"' + 'x'.repeat(1_000_001) + '"}', /trop volumineux/],
    ];
    for (const [text, err] of hostile) {
      await importFile(text);
      await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(err));
      expect(screen.queryByRole('button', { name: 'Remplacer mes données' })).toBeNull();
    }
    expect(window.localStorage.getItem(INVEST_KEY)).toBe(before.inv);
    expect(window.localStorage.getItem(LOANS_KEY)).toBe(before.loans);
    expect(window.localStorage.getItem(GUILD_KEY)).toBe(before.guild);
  });

  it('parseBackup : nom de guilde nettoyé, doublons écartés, prototype non pollué', () => {
    const raw = JSON.stringify({
      ...validBackup(),
      settings: { guildName: 'Varwyn\n@everyone', maxLtv: 7, __proto__: { polluted: true } },
      loans: [LOAN_OVERDUE, LOAN_OVERDUE],
    });
    const res = parseBackup(raw.replace('"settings":{', '"settings":{"__proto__":{"polluted":true},'));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.backup.settings.guildName).toBe('Varwyn @everyone');
    expect(res.backup.settings.maxLtv).toBe(0.6);
    expect(res.backup.loans).toHaveLength(1);
    expect(res.duplicates).toBe(1);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
