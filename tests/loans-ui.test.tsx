// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AppDataContext, buildIndexes, type AppData } from '../src/ui/context';
import { LoansPage } from '../src/ui/pages/guild/Loans';
import { LOANS_KEY, decodeLoan, encodeLoan, loadLoans, reloadLoans, type Loan } from '../src/ui/data/loansStore';
import { GUILD_KEY, reloadGuildSettings } from '../src/ui/data/guildSettings';
import { loanDiscordSummary } from '../src/ui/components/loans/shared';
import { NOW, RECIPES, SETTINGS, SNAPSHOT } from './invest-fixture';

// NOW = 2026-10-14 12:00 UTC ; T6_PLANKS : ordre d'achat 700 à Martlock (vente rapide 700 × 0,96 = 672 ag/unité).
const TODAY = '2026-10-14';

const res = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

/** Historique AODP : 10 jours à Martlock, prix × 0,98 chaque jour (tendance ln 0,98 ≈ −2 %/jour, volatilité nulle). */
function historyBody() {
  const data = Array.from({ length: 10 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 9, 5 + i, 6));
    return { avg_price: 700 * 0.98 ** i, item_count: 20, timestamp: d.toISOString().slice(0, 19) };
  });
  return [{ location: 'Martlock', quality: 1, data }];
}

function renderPage(fetchImpl?: (u: string, i?: RequestInit) => Promise<Response>) {
  const data: AppData = {
    snapshot: SNAPSHOT,
    recipes: RECIPES,
    rankings: null,
    settings: SETTINGS,
    updateSettings: () => {},
    resetSettings: () => {},
    ...buildIndexes(SNAPSHOT, RECIPES),
    now: NOW,
  };
  return render(
    <AppDataContext.Provider value={data}>
      <LoansPage fetchImpl={fetchImpl} />
    </AppDataContext.Provider>,
  );
}

const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s/gu, ' ');
const input = (label: string | RegExp) => screen.getByLabelText(label) as HTMLInputElement;
const flush = () => act(async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
});

function pickPlanks() {
  fireEvent.change(input('Objet mis en gage'), { target: { value: 'chêne sanguin' } });
  fireEvent.click(screen.getByRole('button', { name: /Planches de chêne sanguin \(T6\)/ }));
}

function setClipboard(writeText: ((t: string) => Promise<void>) | undefined) {
  Object.defineProperty(navigator, 'clipboard', { value: writeText ? { writeText } : undefined, configurable: true });
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.location.hash = '';
  reloadLoans();
  reloadGuildSettings();
});
afterEach(() => {
  cleanup();
  setClipboard(undefined);
});

describe('page Prêts sur gage — évaluation', () => {
  it('historique mocké : prêt max, retour idéal, date limite, graphique', async () => {
    const f = vi.fn(async (url: string) => {
      expect(url).toContain('/history/T6_PLANKS.json');
      return res(historyBody());
    });
    renderPage(f);
    expect(screen.getByRole('heading', { level: 1, name: 'Prêts sur gage' })).toBeTruthy();
    fireEvent.change(input('Quantité'), { target: { value: '1000' } });
    pickPlanks();
    await flush();
    expect(f).toHaveBeenCalledTimes(1);
    const card = screen.getByRole('article');
    // 672 × 1 000 = 672 000 ag ; mise en vente 750 × 0,935 × 1 000 = 701 250 ag ; prêt max 60 % = 403 200 → 403 000.
    expect(txt(card)).toContain('672 000 ag');
    expect(txt(card)).toContain('701 250 ag');
    expect(txt(card)).toContain('403 000 ag');
    fireEvent.click(screen.getByRole('button', { name: 'Prêt max conseillé' }));
    expect(input('Montant prêté').value).toBe('403000');
    // Dû = 403 000 × 1,1 = 443 300. 604 800 × e^(ln 0,98 × t) < 443 300 → t > 15,38 → limite jour 16 (30 oct.).
    // Retour idéal = min(30 oct., 14 oct. + 14 j = 28 oct.) ; dernier jour sûr = 29 oct.
    expect(txt(screen.getByTestId('gl-verdict'))).toBe('Prêtez au plus 403 k ag. Retour idéal avant le 28 oct. ; au-delà du 29 oct., gardez plutôt le gage.');
    expect(txt(card)).toContain('443 300 ag');
    expect(txt(card)).toContain('30 octobre 2026');
    expect(txt(card)).toMatch(/historique 10 jours à Martlock/);
    expect(txt(card)).toMatch(/−2 %\/jour/);
    expect(screen.getByRole('img', { name: /Valeur prudente du gage contre le montant dû/ })).toBeTruthy();

    // Montant au-dessus du plafond : avertissement LTV.
    fireEvent.change(input('Montant prêté'), { target: { value: '500 000' } });
    expect(screen.getByRole('alert').textContent).toMatch(/dépasse le prêt max conseillé/);
  });

  it('gage énorme : la revente rapide ne compte que 3 jours de ventes de la ville, avec un avertissement', async () => {
    renderPage(async () => res(null, 429));
    fireEvent.change(input('Quantité'), { target: { value: '5000' } });
    pickPlanks();
    await flush();
    const card = screen.getByRole('article');
    // Volume 1 000/jour à Martlock → 3 000 unités comptées : 3 000 × 672 = 2 016 000 ag (et non 3 360 000).
    expect(txt(card)).toContain('2 016 000 ag');
    expect(txt(screen.getByTestId('gl-liquidity'))).toMatch(/Seules 3 000 unités sur 5 000/);
  });

  it('API saturée (429) : estimation sans historique, signalée', async () => {
    renderPage(async () => res(null, 429));
    fireEvent.change(input('Quantité'), { target: { value: '1000' } });
    pickPlanks();
    fireEvent.change(input('Montant prêté'), { target: { value: '403000' } });
    await flush();
    const card = screen.getByRole('article');
    expect(txt(card)).toMatch(/Estimation sans historique \(API saturée/);
    expect(txt(card)).toContain('estimation sans historique');
    // Tendance 0, σ 3 % : √t > ln(604 800 / 443 300) / 0,0384 = 8,09 → t > 65,4 → jour 66 (19 déc.) ; dernier jour sûr 18 déc.
    expect(txt(screen.getByTestId('gl-verdict'))).toBe('Prêtez au plus 403 k ag. Retour idéal avant le 28 oct. ; au-delà du 18 déc., gardez plutôt le gage.');
  });

  it('objet sans prix : le dire, aucun montant inventé', async () => {
    renderPage();
    fireEvent.change(input('Objet mis en gage'), { target: { value: 'frêne' } });
    fireEvent.click(screen.getByRole('button', { name: /Planches de frêne/ }));
    await flush();
    expect(txt(screen.getByTestId('gl-verdict'))).toMatch(/^Aucun prix exploitable pour ce gage/);
    expect(screen.getByText(/Rien n’est estimé à la place/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Prêt max conseillé' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('page Prêts sur gage — liste et stockage', () => {
  const loan = (p: Partial<Loan>): Loan => ({
    id: 'a1',
    borrower: 'Kael',
    itemId: 'T6_PLANKS',
    qty: 1000,
    amount: 400_000,
    rate: 0.1,
    startDate: '2026-10-01',
    dueDate: '2026-10-20',
    status: 'open',
    ...p,
  });

  it('enregistrer, marquer remboursé, saisir (gain/perte), supprimer avec confirmation', async () => {
    renderPage();
    fireEvent.change(input('Emprunteur'), { target: { value: 'Kael' } });
    fireEvent.change(input('Quantité'), { target: { value: '1000' } });
    pickPlanks();
    fireEvent.change(input('Montant prêté'), { target: { value: '700 000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le prêt' }));
    await flush();
    const saved = loadLoans();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ borrower: 'Kael', itemId: 'T6_PLANKS', qty: 1000, amount: 700_000, rate: 0.1, startDate: TODAY, status: 'open' });
    // 672 000 × 0,9 = 604 800 < 770 000 dû : gage insuffisant, échéance = demain (retour idéal jamais avant demain).
    expect(saved[0].dueDate).toBe('2026-10-15');
    const item = screen.getByRole('listitem', { name: 'Prêt à Kael' });
    expect(within(item).getByTestId('gl-status').textContent).toBe('Gage insuffisant');

    fireEvent.click(within(item).getByRole('button', { name: 'Saisir le gage' }));
    fireEvent.click(within(item).getByRole('button', { name: 'Confirmer la saisie' }));
    expect(loadLoans()[0].status).toBe('seized');
    // Perte = 672 000 − 700 000 = −28 000 ag.
    expect(txt(within(screen.getByRole('listitem', { name: 'Prêt à Kael' })).getByTestId('gl-gain'))).toBe('−28 000 ag');

    fireEvent.click(within(screen.getByRole('listitem', { name: 'Prêt à Kael' })).getByRole('button', { name: 'Supprimer' }));
    expect(loadLoans()).toHaveLength(1);
    fireEvent.click(within(screen.getByRole('group', { name: 'Confirmer la suppression' })).getByRole('button', { name: 'Confirmer' }));
    expect(loadLoans()).toHaveLength(0);
  });

  it('tri par urgence : en retard avant couvert, clos à la fin', () => {
    window.localStorage.setItem(
      LOANS_KEY,
      JSON.stringify({
        v: 1,
        items: [
          loan({ id: 'c', borrower: 'Clos', status: 'repaid' }),
          loan({ id: 'b', borrower: 'Bien', amount: 100_000 }),
          loan({ id: 'r', borrower: 'Retard', amount: 100_000, dueDate: '2026-10-10' }),
        ],
      }),
    );
    reloadLoans();
    renderPage();
    const names = within(screen.getByRole('list', { name: /du plus urgent/ }))
      .getAllByRole('listitem')
      .map((li) => li.getAttribute('aria-label'));
    expect(names).toEqual(['Prêt à Retard', 'Prêt à Bien', 'Prêt à Clos']);
    expect(within(screen.getByRole('listitem', { name: 'Prêt à Retard' })).getByTestId('gl-status').textContent).toBe('En retard');
    expect(txt(screen.getByRole('listitem', { name: 'Prêt à Retard' }))).toContain('4 jours de retard');
    expect(screen.getByTestId('gl-total-open').textContent).toBe('2');
  });

  it('stockage corrompu ou invalide : la page s’affiche, les entrées invalides sont ignorées', () => {
    window.localStorage.setItem(GUILD_KEY, '{pas du json');
    window.localStorage.setItem(
      LOANS_KEY,
      JSON.stringify({
        v: 1,
        items: [
          { id: 'x', borrower: 'Bad', itemId: '<script>', qty: 1, amount: 1, rate: 0, startDate: TODAY, dueDate: TODAY },
          { ...loan({ id: 'neg' }), amount: -5 },
          { ...loan({ id: 'date' }), startDate: '2026-02-31' },
          loan({ id: 'ok', borrower: 'Valide', status: 'bogus' as never, dueDate: '2026-09-01' }),
          loan({ id: 'ok' }),
        ],
      }),
    );
    reloadLoans();
    reloadGuildSettings();
    renderPage();
    const loans = loadLoans();
    expect(loans).toHaveLength(1);
    // Statut inconnu → « open » ; échéance avant le début ramenée au jour du prêt.
    expect(loans[0]).toMatchObject({ id: 'ok', borrower: 'Valide', status: 'open', dueDate: '2026-10-01' });
    expect(screen.getByText(/LTV max 60 %/)).toBeTruthy();

    cleanup();
    window.localStorage.setItem(LOANS_KEY, 'null');
    reloadLoans();
    renderPage();
    expect(screen.getByText(/Aucun prêt enregistré/)).toBeTruthy();
  });

  it('résumé Discord neutralisé (@everyone, <@id>, mise en forme)', async () => {
    window.localStorage.setItem(LOANS_KEY, JSON.stringify([loan({ borrower: '@everyone **pwn** <@123>' })]));
    window.localStorage.setItem(GUILD_KEY, JSON.stringify({ guildName: '@here Varwyn' }));
    reloadLoans();
    reloadGuildSettings();
    const writes: string[] = [];
    setClipboard(async (t) => {
      writes.push(t);
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Résumé Discord' }));
    await flush();
    expect(writes).toHaveLength(1);
    const s = writes[0];
    expect(s).not.toMatch(/@everyone|@here|<@/);
    expect(s).toContain('@​everyone');
    expect(s).toContain('\\*\\*pwn\\*\\*');
    expect(s).toContain('‹@\u200b123\\>');
    expect(s).toContain('**Prêt sur gage — @​here Varwyn**');
    expect(s.replace(/[\u202f\u00a0]/g, ' ')).toMatch(/Prêté : 400 000 ag · intérêt 10 % → dû 440 000 ag/);
    expect(s).toMatch(/<http.*#\/guilde\/prets\?l=[A-Za-z0-9_-]+>$/);
    expect(screen.getByRole('button', { name: 'Résumé copié' })).toBeTruthy();

    // Fonction pure : retours à la ligne neutralisés aussi.
    const pure = loanDiscordSummary({
      guildName: 'G',
      borrower: 'a\n@everyone',
      item: 'x',
      qty: 1,
      amount: 1,
      rate: 0,
      due: 1,
      quickValue: null,
      dueDate: TODAY,
      idealDate: null,
      limitDate: null,
      health: 'unpriced',
      url: 'u',
    });
    expect(pure.split('\n')[1]).toBe('• Emprunteur : a @​everyone');
  });

  it('lien partagé #/guilde/prets?l=… : formulaire pré-rempli, rien d’enregistré sans clic ; lien illisible signalé', async () => {
    const shared = loan({ borrower: 'Lyra', qty: 500, amount: 200_000, rate: 0.15, startDate: TODAY, dueDate: '2026-10-25', note: 'gage de test' });
    const code = encodeLoan(shared);
    const { id: _id, ...noId } = shared;
    expect(decodeLoan(code)).toEqual(noId);
    expect(decodeLoan(code)).toMatchObject({ borrower: 'Lyra', qty: 500, amount: 200_000, rate: 0.15 });
    window.location.hash = `#/guilde/prets?l=${code}`;
    renderPage(async () => res(historyBody()));
    await flush();
    expect(screen.getByRole('status').textContent).toMatch(/Prêt partagé chargé \(Lyra\)/);
    expect(input('Emprunteur').value).toBe('Lyra');
    expect(input('Quantité').value).toBe('500');
    expect(input('Montant prêté').value).toBe('200000');
    expect(input('Intérêt forfaitaire').value).toBe('15');
    expect(input('Échéance').value).toBe('2026-10-25');
    expect(screen.getByTestId('gl-chosen').textContent).toMatch(/Planches de chêne sanguin/);
    expect(loadLoans()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le prêt' }));
    expect(loadLoans()[0]).toMatchObject({ borrower: 'Lyra', dueDate: '2026-10-25', note: 'gage de test' });

    // Lien tronqué / falsifié.
    await act(async () => {
      window.location.hash = '#/guilde/prets?l=%%%';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(screen.getByText(/Lien de partage illisible/)).toBeTruthy();
    expect(decodeLoan(encodeLoan(shared).slice(0, 20))).toBeNull();
  });
});
