// Page « Prêts sur gage » (mode guilde, #/guilde/prets) : un officier évalue un gage, fixe le prêt maximal,
// la date de retour idéale et la date au-delà de laquelle il vaut mieux garder le gage ; suivi des prêts en cours.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { MarketItem } from '../../../types';
import {
  FALLBACK_DYNAMICS,
  HEALTH_LABEL,
  QUICK_SALE_DAYS,
  Z_PRUDENT,
  addDays,
  capQuickToAverage,
  recentAveragePrice,
  compareUrgency,
  daysBetween,
  evaluateLoan,
  localDay,
  loanHealth,
  priceDynamics,
  seizedResult,
  valuationCity,
  valueCollateral,
  type CollateralQuote,
  type CollateralValuation,
  type LoanEvaluation,
  type LoanHealth,
  type PriceDynamics,
} from '../../../engine/pawn';
import { useAppData } from '../../context';
import { fmtAgeH, fmtInt, fmtPct, fmtSilver, plural } from '../../format';
import { useGuildSettings, type GuildSettings } from '../../data/guildSettings';
import {
  LOAN_SHARE_PREFIX,
  MAX_BORROWER,
  MAX_NOTE,
  decodeLoan,
  isIsoDay,
  loanCodeFromHash,
  loanShareUrl,
  useLoans,
  type Loan,
  type SharedLoan,
} from '../../data/loansStore';
import { useHistories, type HistState } from '../../data/loanHistory';
import { shareBase } from '../../data/investStore';
import { copyText } from '../../components/invest/shared';
import { LoanChart } from '../../components/loans/LoanChart';
import {
  fmtDay,
  fmtDayLong,
  fmtPerDay,
  fmtSilverShort,
  itemLabel,
  loanDiscordSummary,
  loanValueOf,
  loanVerdict,
  roundDownNice,
} from '../../components/loans/shared';
import '../../guild-loans.css';

export { loanValueOf, loanDiscordSummary, loanVerdict };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'");

/** Nombre saisi (espaces, espaces fines et virgule décimale tolérés ; suffixes k et M acceptés) ; NaN si invalide. */
export function parseAmount(s: string): number {
  const t = s.replace(/[\s  ]/g, '').replace(',', '.').replace(/ag$/i, '');
  const m = /^(-?\d+(?:\.\d+)?)([kKmM]?)$/.exec(t);
  if (!m) return NaN;
  const n = Number(m[1]) * (m[2] === 'k' || m[2] === 'K' ? 1e3 : m[2] === 'm' || m[2] === 'M' ? 1e6 : 1);
  return Number.isFinite(n) ? n : NaN;
}

// ---------------------------------------------------------------------------
// Évaluation (valeur + historique + règles)
// ---------------------------------------------------------------------------

interface Assessed {
  valuation: CollateralValuation;
  /** Revente rapide ramenée au prix moyen payé sur 30 jours (ordre d'achat au-dessus de la moyenne). */
  cappedToAverage: boolean;
  dynamics: PriceDynamics;
  /** 'history' : historique utilisé ; 'loading' : en attente (estimation provisoire) ; 'fallback' : sans historique. */
  source: 'history' | 'loading' | 'fallback';
  sourceNote: string | null;
  ev: LoanEvaluation;
}

function assess(
  item: MarketItem | undefined,
  itemId: string,
  qty: number,
  terms: { amount: number; rate: number; startDate: string; dueDate?: string | null },
  hist: HistState | undefined,
  rules: GuildSettings,
  settings: { premium: boolean; maxPriceAgeH: number },
  now: Date,
): Assessed {
  let valuation = valueCollateral(item, qty, { premium: settings.premium, maxPriceAgeH: settings.maxPriceAgeH, now });
  let cappedToAverage = false;
  const city = valuationCity(valuation);
  let dynamics: PriceDynamics = { ...FALLBACK_DYNAMICS };
  let source: Assessed['source'] = 'fallback';
  let sourceNote: string | null = null;
  if (!itemId || !city) {
    source = 'fallback';
  } else if (!hist || hist.state === 'loading') {
    source = 'loading';
    sourceNote = 'Historique en cours de chargement : estimation provisoire.';
  } else if (hist.state === 'error') {
    sourceNote = `Estimation sans historique (${hist.message})`;
  } else {
    const daily = hist.data[city];
    const d = priceDynamics(daily, now.getTime());
    // Ordre d'achat très au-dessus du prix moyen réellement payé récemment : plafonné (ordre piège).
    if (daily && valuation.quick && valuation.quick.loc === city) {
      const capped = capQuickToAverage(valuation, recentAveragePrice(daily, now.getTime()));
      cappedToAverage = capped.cappedToAverage;
      valuation = capped;
    }
    if (d.fromHistory) {
      dynamics = d;
      source = 'history';
    } else sourceNote = `Estimation sans historique : moins de 5 jours de ventes connus à ${city} sur 30 jours.`;
  }
  const ev = evaluateLoan(terms, valuation.quick?.total ?? null, dynamics, rules, now);
  return { valuation, cappedToAverage, dynamics, source, sourceNote, ev };
}

// ---------------------------------------------------------------------------
// Formulaire
// ---------------------------------------------------------------------------

interface Form {
  borrower: string;
  itemId: string;
  qty: string;
  amount: string;
  rate: string;
  startDate: string;
  /** Vide : échéance = retour idéal. */
  dueDate: string;
  note: string;
}

const pctStr = (x: number) => String(Math.round(x * 10000) / 100).replace('.', ',');

const emptyForm = (today: string, g: GuildSettings): Form => ({
  borrower: '',
  itemId: '',
  qty: '1',
  amount: '',
  rate: pctStr(g.defaultRate),
  startDate: today,
  dueDate: '',
  note: '',
});

const formFrom = (l: SharedLoan): Form => ({
  borrower: l.borrower,
  itemId: l.itemId,
  qty: String(l.qty),
  amount: String(l.amount),
  rate: pctStr(l.rate),
  startDate: l.startDate,
  dueDate: l.dueDate,
  note: l.note ?? '',
});

function Field({ id, label, children, help }: { id: string; label: string; children: React.ReactNode; help?: React.ReactNode }) {
  return (
    <div className="field gl-field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {children}
      {help && (
        <p className="field-help" id={`${id}-help`}>
          {help}
        </p>
      )}
    </div>
  );
}

function QuoteLine({ q, maxAgeH }: { q: CollateralQuote; maxAgeH: number }) {
  return (
    <span className="gl-quote">
      {fmtSilver(q.unitPrice)}/unité à {q.loc}, prix vieux de {fmtAgeH(q.ageH)}
      {q.stale && (
        <span className="gl-tag gl-tag--warn" title={`Plus vieux que l’âge maximal réglé (${fmtInt(maxAgeH)} h)`}>
          périmé
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface Row {
  loan: Loan;
  label: string;
  a: Assessed;
  health: LoanHealth;
}

export function LoansPage({ fetchImpl }: { fetchImpl?: FetchLike } = {}) {
  const { snapshot, recipes, settings, now, metaById, itemById } = useAppData();
  const [guild, updateGuild, resetGuild] = useGuildSettings();
  const store = useLoans();
  const today = localDay(now);
  const [form, setForm] = useState<Form>(() => emptyForm(today, guild));
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formMsg, setFormMsg] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const [listMsg, setListMsg] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; kind: 'delete' | 'seize' } | null>(null);
  const [copied, setCopied] = useState<{ id: string; kind: 'link' | 'discord' } | null>(null);
  const [fallback, setFallback] = useState<{ id: string; text: string } | null>(null);
  const [showClosed, setShowClosed] = useState(true);
  const formRef = useRef<HTMLHeadingElement>(null);
  const listId = useId();
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  // --- Lien de partage « #/guilde/prets?l=… » : pré-remplit le formulaire (rien n'est enregistré sans clic).
  useEffect(() => {
    const read = () => {
      let hash = '';
      try {
        hash = window.location.hash;
      } catch {
        return;
      }
      const code = loanCodeFromHash(hash);
      if (code == null) return;
      const s = decodeLoan(code);
      if (s) {
        setForm(formFrom(s));
        setEditingId(null);
        setQuery('');
        setNotice(`Prêt partagé chargé (${s.borrower}) : vérifiez l’évaluation puis enregistrez-le si la guilde le suit.`);
      } else setNotice('Lien de partage illisible : il a peut-être été tronqué.');
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);

  // --- Recherche d'objet (noms français)
  const matches = useMemo(() => {
    const words = norm(query).split(/\s+/).filter(Boolean);
    if (!words.length || !recipes) return [];
    const out: string[] = [];
    for (const m of recipes.meta) {
      const hay = norm(`${m.nameFr} ${m.id} t${m.tier}${m.enchant ? '.' + m.enchant : ''}`);
      if (words.every((w) => hay.includes(w))) {
        out.push(m.id);
        if (out.length >= 8) break;
      }
    }
    return out;
  }, [query, recipes]);

  // --- Historiques : objet du formulaire d'abord, puis gages des prêts en cours.
  const histIds = useMemo(() => {
    const ids: string[] = [];
    if (form.itemId) ids.push(form.itemId);
    for (const l of store.loans) if (l.status === 'open') ids.push(l.itemId);
    return ids;
  }, [form.itemId, store.loans]);
  const [hists, retryHists] = useHistories(histIds, fetchImpl);

  const appSettings = { premium: settings.premium, maxPriceAgeH: settings.maxPriceAgeH };

  // --- Évaluation du formulaire
  const qtyNum = Math.round(parseAmount(form.qty));
  const amountNum = parseAmount(form.amount);
  const rateNum = parseAmount(form.rate) / 100;
  const qtyOk = qtyNum >= 1 && qtyNum <= 1_000_000;
  const amountOk = amountNum >= 1 && amountNum <= 1e12;
  const rateOk = rateNum >= 0 && rateNum <= 2;
  const startOk = isIsoDay(form.startDate);
  const dueOk = form.dueDate === '' || (isIsoDay(form.dueDate) && (!startOk || form.dueDate >= form.startDate));

  const formA = useMemo(() => {
    if (!form.itemId || !qtyOk) return null;
    return assess(
      itemById.get(form.itemId),
      form.itemId,
      qtyNum,
      { amount: amountOk ? amountNum : 0, rate: rateOk ? rateNum : 0, startDate: startOk ? form.startDate : today, dueDate: null },
      hists[form.itemId],
      guild,
      appSettings,
      now,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.itemId, qtyOk, qtyNum, amountOk, amountNum, rateOk, rateNum, startOk, form.startDate, hists, guild, settings.premium, settings.maxPriceAgeH, now, itemById, today]);

  // --- Lignes de la liste
  const rows: Row[] = useMemo(() => {
    const out = store.loans.map((loan) => {
      const a = assess(itemById.get(loan.itemId), loan.itemId, loan.qty, loan, loan.status === 'open' ? hists[loan.itemId] : undefined, guild, appSettings, now);
      return { loan, label: itemLabel(loan.itemId, metaById), a, health: loanHealth(loan.status, a.ev) };
    });
    return out.sort((x, y) => compareUrgency({ health: x.health, ev: x.a.ev, dueDate: x.loan.dueDate }, { health: y.health, ev: y.a.ev, dueDate: y.loan.dueDate }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.loans, itemById, hists, guild, settings.premium, settings.maxPriceAgeH, now, metaById]);

  const openRows = rows.filter((r) => r.loan.status === 'open');
  const closedCount = rows.length - openRows.length;
  const visible = showClosed ? rows : openRows;
  const totals = useMemo(() => {
    let lent = 0;
    let due = 0;
    let coll = 0;
    let urgent = 0;
    for (const r of openRows) {
      lent += r.loan.amount;
      due += r.a.ev.due;
      coll += r.a.ev.v0 ?? 0;
      if (r.health === 'overdue' || r.health === 'insufficient' || r.health === 'watch') urgent++;
    }
    return { lent, due, coll, urgent };
  }, [openRows]);
  const rateLimited = Object.values(hists).some((h) => h.state === 'error' && h.rateLimited);

  // --- Actions
  const choose = (id: string) => {
    set({ itemId: id });
    setQuery('');
    setFormMsg(null);
  };

  const resetForm = () => {
    setForm(emptyForm(today, guild));
    setEditingId(null);
    setQuery('');
  };

  const save = () => {
    if (!form.itemId) return setFormMsg({ tone: 'warn', text: 'Choisissez l’objet mis en gage.' });
    const borrower = form.borrower.trim();
    if (!borrower) return setFormMsg({ tone: 'warn', text: 'Indiquez le pseudo de l’emprunteur.' });
    if (!qtyOk) return setFormMsg({ tone: 'warn', text: 'Quantité invalide : un nombre entier de 1 à 1 000 000.' });
    if (!amountOk) return setFormMsg({ tone: 'warn', text: 'Montant prêté invalide : de 1 ag à 1 000 milliards d’ag.' });
    if (!rateOk) return setFormMsg({ tone: 'warn', text: 'Intérêt invalide : de 0 à 200 %.' });
    if (!startOk) return setFormMsg({ tone: 'warn', text: 'Date de début invalide.' });
    if (!dueOk) return setFormMsg({ tone: 'warn', text: 'Échéance invalide : elle doit tomber le jour du prêt ou après.' });
    const dueDate = form.dueDate || formA?.ev.idealDate || addDays(form.startDate, guild.maxTermDays);
    const data = {
      borrower: borrower.slice(0, MAX_BORROWER),
      itemId: form.itemId,
      qty: qtyNum,
      amount: Math.round(amountNum),
      rate: rateNum,
      startDate: form.startDate,
      dueDate: dueDate < form.startDate ? form.startDate : dueDate,
      note: form.note.trim().slice(0, MAX_NOTE) || undefined,
    };
    if (editingId) {
      const err = store.update(editingId, data);
      if (err) return setFormMsg({ tone: 'warn', text: err });
      setFormMsg({ tone: 'ok', text: `Prêt de ${data.borrower} mis à jour.` });
    } else {
      const res = store.add(data);
      if (typeof res === 'string') return setFormMsg({ tone: 'warn', text: res });
      setFormMsg({ tone: 'ok', text: `Prêt de ${data.borrower} enregistré, échéance le ${fmtDayLong(data.dueDate)}.` });
    }
    setForm(emptyForm(today, guild));
    setEditingId(null);
  };

  const edit = (id: string) => {
    const l = store.loans.find((x) => x.id === id);
    if (!l) return;
    setForm(formFrom(l));
    setEditingId(id);
    setFormMsg(null);
    setQuery('');
    formRef.current?.focus();
  };

  const copy = useCallback(
    async (row: Row, kind: 'link' | 'discord') => {
      const url = loanShareUrl(row.loan, shareBase());
      const text =
        kind === 'link'
          ? url
          : loanDiscordSummary({
              guildName: guild.guildName,
              borrower: row.loan.borrower,
              item: row.label,
              qty: row.loan.qty,
              amount: row.loan.amount,
              rate: row.loan.rate,
              due: row.a.ev.due,
              quickValue: row.a.ev.v0,
              dueDate: row.loan.dueDate,
              idealDate: row.loan.status === 'open' ? row.a.ev.idealDate : null,
              limitDate: row.loan.status === 'open' ? row.a.ev.limitDate : null,
              health: row.health,
              url,
            });
      if (await copyText(text)) {
        setFallback(null);
        setCopied({ id: row.loan.id, kind });
        window.setTimeout(() => setCopied((c) => (c && c.id === row.loan.id && c.kind === kind ? null : c)), 2000);
      } else setFallback({ id: row.loan.id, text });
    },
    [guild.guildName],
  );

  const ev = formA?.ev ?? null;
  const maxNice = ev?.maxLoan != null ? roundDownNice(ev.maxLoan) : null;
  const overMax = ev && maxNice != null && amountOk && amountNum > (ev.maxLoan ?? Infinity);
  const overMaxText =
    ev?.maxLoanBy === 'term'
      ? `Le montant saisi dépasse le prêt max conseillé (${fmtSilver(maxNice ?? 0)}) : gage trop volatil pour couvrir le dû jusqu’à la fin des ${plural(guild.maxTermDays, 'jour')}.`
      : `Le montant saisi dépasse le prêt max conseillé : LTV ${fmtPct(ev?.ltv ?? null, 0)} pour ${fmtPct(guild.maxLtv, 0)} au maximum.`;

  return (
    <section className="page gl-page" aria-labelledby="page-title">
      <header className="page-head">
        <h1 id="page-title">Prêts sur gage</h1>
        <p className="page-intro">
          Un membre de {guild.guildName} laisse un objet en gage contre de l’argent. Combien lui prêter, quand doit-il rembourser, et à partir
          de quand vaut-il mieux garder le gage ? Valeurs aux prix du moment (taxe {settings.premium ? '4 % premium' : '8 % sans premium'} ;{' '}
          <a href="#/reglages">réglages</a>).
        </p>
      </header>

      {notice && (
        <p className="gl-msg" role="status">
          {notice}{' '}
          <button type="button" className="btn-ghost" onClick={() => setNotice(null)}>
            Fermer
          </button>
        </p>
      )}

      <RulesPanel guild={guild} update={updateGuild} reset={resetGuild} />

      {/* ------------------------------------------------------------------ Formulaire */}
      <section className="gl-section" aria-labelledby="gl-form-title">
        <h2 id="gl-form-title" ref={formRef} tabIndex={-1}>
          {editingId ? 'Modifier le prêt' : 'Nouveau prêt'}
        </h2>
        <div className="gl-form-layout">
          <div className="gl-form">
            <Field id="gl-borrower" label="Emprunteur">
              <input id="gl-borrower" value={form.borrower} maxLength={MAX_BORROWER} autoComplete="off" onChange={(e) => set({ borrower: e.target.value })} />
            </Field>

            <div className="gl-picker">
              <Field id="gl-search" label="Objet mis en gage">
                <input
                  id="gl-search"
                  type="search"
                  placeholder="Ex. planches T6, épée large…"
                  value={query}
                  autoComplete="off"
                  aria-controls={listId}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </Field>
              {query.trim() !== '' && (
                <ul className="gl-results" id={listId} aria-label="Objets trouvés">
                  {!recipes && <li className="muted">Chargement des objets…</li>}
                  {recipes && matches.length === 0 && <li className="muted">Aucun objet ne correspond.</li>}
                  {matches.map((id) => (
                    <li key={id}>
                      <button type="button" className="gl-result" onClick={() => choose(id)}>
                        {itemLabel(id, metaById)}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {form.itemId && (
                <p className="gl-chosen" data-testid="gl-chosen">
                  Gage choisi : <strong>{itemLabel(form.itemId, metaById)}</strong>
                </p>
              )}
            </div>

            <div className="gl-row">
              <Field id="gl-qty" label="Quantité">
                <span className="num-input">
                  <input id="gl-qty" inputMode="numeric" value={form.qty} aria-invalid={!qtyOk || undefined} onChange={(e) => set({ qty: e.target.value })} />
                  <span className="suffix">unités</span>
                </span>
              </Field>
              <Field id="gl-rate" label="Intérêt forfaitaire">
                <span className="num-input">
                  <input id="gl-rate" inputMode="decimal" value={form.rate} aria-invalid={!rateOk || undefined} onChange={(e) => set({ rate: e.target.value })} />
                  <span className="suffix">%</span>
                </span>
              </Field>
            </div>

            <Field
              id="gl-amount"
              label="Montant prêté"
              help={
                maxNice != null
                  ? `Prêt max conseillé : ${fmtSilver(maxNice)} (${ev?.maxLoanBy === 'term' ? `dû couvert jusqu’à la fin des ${guild.maxTermDays} jours` : `${fmtPct(guild.maxLtv, 0)} de la revente rapide`}).`
                  : 'Choisissez un gage pour connaître le prêt max conseillé.'
              }
            >
              <span className="gl-amount">
                <span className="num-input">
                  <input
                    id="gl-amount"
                    inputMode="decimal"
                    placeholder="ex. 1 200 000"
                    value={form.amount}
                    aria-invalid={(form.amount !== '' && !amountOk) || undefined}
                    aria-describedby="gl-amount-help"
                    onChange={(e) => set({ amount: e.target.value })}
                  />
                  <span className="suffix">ag</span>
                </span>
                <button type="button" className="btn" disabled={maxNice == null || maxNice < 1} onClick={() => maxNice != null && set({ amount: String(maxNice) })}>
                  Prêt max conseillé
                </button>
              </span>
            </Field>

            <div className="gl-row">
              <Field id="gl-start" label="Date du prêt">
                <input id="gl-start" type="date" value={form.startDate} aria-invalid={!startOk || undefined} onChange={(e) => set({ startDate: e.target.value })} />
              </Field>
              <Field id="gl-due" label="Échéance" help={form.dueDate === '' ? `Vide : retour idéal${ev ? ` (${fmtDay(ev.idealDate)})` : ''}.` : undefined}>
                <span className="gl-due-input">
                  <input id="gl-due" type="date" value={form.dueDate} aria-invalid={!dueOk || undefined} onChange={(e) => set({ dueDate: e.target.value })} />
                  {ev && form.dueDate !== ev.idealDate && (
                    <button type="button" className="btn-ghost" onClick={() => set({ dueDate: ev.idealDate })}>
                      Retour idéal
                    </button>
                  )}
                </span>
              </Field>
            </div>

            <Field id="gl-note" label="Note (facultatif)">
              <input id="gl-note" value={form.note} maxLength={MAX_NOTE} onChange={(e) => set({ note: e.target.value })} />
            </Field>

            <div className="gl-form-actions">
              <button type="button" className="btn gl-primary" onClick={save}>
                {editingId ? 'Mettre à jour le prêt' : 'Enregistrer le prêt'}
              </button>
              {(editingId || form.itemId || form.borrower) && (
                <button type="button" className="btn-ghost" onClick={resetForm}>
                  {editingId ? 'Annuler la modification' : 'Vider le formulaire'}
                </button>
              )}
            </div>
            {formMsg && (
              <p className={formMsg.tone === 'ok' ? 'gl-msg' : 'gl-warn'} role={formMsg.tone === 'ok' ? 'status' : 'alert'}>
                {formMsg.text}
              </p>
            )}
          </div>

          <div className="gl-eval-col">
            {!form.itemId ? (
              <p className="muted gl-empty">Choisissez l’objet mis en gage : l’évaluation apparaît ici.</p>
            ) : !snapshot ? (
              <p className="muted">Chargement des prix…</p>
            ) : !formA ? (
              <p className="gl-warn">Quantité invalide : un nombre entier de 1 à 1 000 000.</p>
            ) : (
              <EvalCard
                a={formA}
                label={itemLabel(form.itemId, metaById)}
                qty={qtyNum}
                guild={guild}
                today={today}
                maxAgeH={settings.maxPriceAgeH}
                amountSet={amountOk}
                overMax={!!overMax}
                overMaxText={overMaxText}
                onRetry={retryHists}
              />
            )}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ Liste */}
      <section className="gl-section" aria-labelledby="gl-list-title">
        <h2 id="gl-list-title">Prêts de la guilde</h2>
        {listMsg && (
          <p className="gl-msg" role="status">
            {listMsg}
          </p>
        )}
        {rows.length === 0 ? (
          <p className="muted">Aucun prêt enregistré. Évaluez un gage ci-dessus puis cliquez sur « Enregistrer le prêt ».</p>
        ) : (
          <>
            <dl className="gl-totals" aria-label="Totaux des prêts en cours">
              <div>
                <dt>Prêts en cours</dt>
                <dd data-testid="gl-total-open">{fmtInt(openRows.length)}</dd>
              </div>
              <div>
                <dt>Argent prêté</dt>
                <dd>{fmtSilver(totals.lent)}</dd>
              </div>
              <div>
                <dt>Dû, intérêts compris</dt>
                <dd>{fmtSilver(totals.due)}</dd>
              </div>
              <div>
                <dt>Gages (revente rapide)</dt>
                <dd>{fmtSilver(totals.coll)}</dd>
              </div>
              <div>
                <dt>À traiter</dt>
                <dd className={totals.urgent ? 'gl-neg' : undefined}>{fmtInt(totals.urgent)}</dd>
              </div>
            </dl>
            {rateLimited && <p className="gl-warn">API saturée : certains gages sont estimés sans historique. Réessayez dans une minute.</p>}
            {closedCount > 0 && (
              <label className="gl-toggle">
                <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Afficher les prêts clos (
                {fmtInt(closedCount)})
              </label>
            )}
            <ul className="gl-list" aria-label="Prêts, du plus urgent au moins urgent">
              {visible.map((r) => (
                <LoanItem
                  key={r.loan.id}
                  row={r}
                  today={today}
                  editing={editingId === r.loan.id}
                  confirm={confirm?.id === r.loan.id ? confirm.kind : null}
                  copied={copied?.id === r.loan.id ? copied.kind : null}
                  fallback={fallback?.id === r.loan.id ? fallback.text : null}
                  onCloseFallback={() => setFallback(null)}
                  onAsk={(kind) => setConfirm(kind ? { id: r.loan.id, kind } : null)}
                  onRepaid={() => {
                    store.setStatus(r.loan.id, 'repaid');
                    setListMsg(`Prêt de ${r.loan.borrower} marqué remboursé.`);
                  }}
                  onReopen={() => {
                    store.setStatus(r.loan.id, 'open');
                    setListMsg(`Prêt de ${r.loan.borrower} rouvert.`);
                  }}
                  onSeize={() => {
                    setConfirm(null);
                    store.setStatus(r.loan.id, 'seized');
                    setListMsg(`Gage de ${r.loan.borrower} saisi par la guilde.`);
                  }}
                  onEdit={() => edit(r.loan.id)}
                  onDelete={() => {
                    setConfirm(null);
                    store.remove(r.loan.id);
                    if (editingId === r.loan.id) resetForm();
                    setListMsg(`Prêt de ${r.loan.borrower} supprimé.`);
                  }}
                  onCopy={(kind) => copy(r, kind)}
                />
              ))}
            </ul>
          </>
        )}
        {!store.saved && <p className="gl-warn">Le stockage du navigateur est indisponible : les prêts ne seront pas conservés.</p>}
        <p className="field-help gl-foot">
          Les prêts sont enregistrés dans ce navigateur uniquement. Les liens de partage ({LOAN_SHARE_PREFIX}…) contiennent le prêt (pseudo,
          gage, montants, dates) : partagez-les avec les officiers.
        </p>
      </section>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Carte d'évaluation
// ---------------------------------------------------------------------------

function EvalCard({
  a,
  label,
  qty,
  guild,
  today,
  maxAgeH,
  amountSet,
  overMax,
  overMaxText,
  onRetry,
}: {
  a: Assessed;
  label: string;
  qty: number;
  guild: GuildSettings;
  today: string;
  maxAgeH: number;
  amountSet: boolean;
  overMax: boolean;
  overMaxText: string;
  onRetry: () => void;
}) {
  const { valuation: v, ev, dynamics: d } = a;
  const idealDay = daysBetween(today, ev.idealDate);
  return (
    <article className="gl-eval" aria-labelledby="gl-eval-title">
      <h3 id="gl-eval-title">
        Évaluation : {fmtInt(qty)} × {label}
      </h3>
      <p className={`gl-verdict${ev.v0 == null || ev.insufficientNow ? ' is-bad' : ''}`} data-testid="gl-verdict">
        {loanVerdict(ev, today)}
      </p>
      {overMax && (
        <p className="gl-warn" role="alert">
          {overMaxText}
        </p>
      )}
      {v.quick && v.quick.countedQty < qty && (
        <p className="gl-warn" data-testid="gl-liquidity">
          Peu liquide : {(v.quick.dailyVolume ?? 0) < 1 ? `presque aucune vente par jour à ${v.quick.loc}` : `${v.quick.loc} n’en vend qu’environ ${fmtInt(v.quick.dailyVolume)} par jour`}.{' '}
          {v.quick.countedQty === 1 ? 'Seule 1 unité' : `Seules ${fmtInt(v.quick.countedQty)} unités`} sur {fmtInt(qty)} ({QUICK_SALE_DAYS} jours de ventes au plus) comptent dans la
          revente rapide : si la guilde saisit le gage, le reste mettra des jours à s’écouler, sans doute moins cher.
        </p>
      )}
      {v.quick && v.quick.dailyVolume == null && (
        <p className="field-help" data-testid="gl-liquidity-unknown">
          Volume de ventes inconnu à {v.quick.loc} : la revente rapide suppose que les {plural(qty, 'unité')} se vendent au prix de l’ordre d’achat. Vérifiez en jeu
          la quantité demandée par l’ordre.
        </p>
      )}
      {v.quick?.stale && (
        <p className="gl-warn" data-testid="gl-stale">
          Prix de revente rapide périmé (vieux de {fmtAgeH(v.quick.ageH)}) : vérifiez l’ordre d’achat en jeu avant de prêter.
        </p>
      )}
      {a.cappedToAverage && v.quick && (
        <p className="field-help" data-testid="gl-capped">
          L’ordre d’achat dépasse de plus de 25 % le prix moyen payé ces 7 derniers jours à {v.quick.loc} (ordre piège ou flambée passagère) : la
          revente rapide est comptée à {fmtSilver(v.quick.unitPrice)}/unité.
        </p>
      )}
      {v.quick == null && v.listing == null ? (
        <p className="gl-warn" role="alert">
          Aucun prix récent (moins de 7 jours) pour cet objet dans les villes suivies{v.suspectExcluded ? `, ${plural(v.suspectExcluded, 'prix suspect écarté', 'prix suspects écartés')}` : ''}.
          Rien n’est estimé à la place : vérifiez les prix en jeu.
        </p>
      ) : (
        <dl className="gl-facts">
          <div>
            <dt>Revente rapide</dt>
            <dd>
              {v.quick ? (
                <>
                  <strong>{fmtSilver(v.quick.total)}</strong>
                  <QuoteLine q={v.quick} maxAgeH={maxAgeH} />
                </>
              ) : (
                <span className="muted">aucun ordre d’achat</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Mise en vente</dt>
            <dd>
              {v.listing ? (
                <>
                  <strong>{fmtSilver(v.listing.total)}</strong>
                  <QuoteLine q={v.listing} maxAgeH={maxAgeH} />
                </>
              ) : (
                <span className="muted">aucune offre de vente</span>
              )}
            </dd>
          </div>
          {ev.v0 != null && (
            <>
              <div>
                <dt>Prêt max conseillé</dt>
                <dd>
                  <strong>{fmtSilver(roundDownNice(ev.maxLoan ?? 0))}</strong>
                  <span className="gl-quote">
                    {ev.maxLoanBy === 'term'
                      ? `limité par la volatilité : dû couvert jusqu’à la fin des ${plural(guild.maxTermDays, 'jour')} (LTV ${fmtPct(guild.maxLtv, 0)} non atteinte)`
                      : `${fmtPct(guild.maxLtv, 0)} de la revente rapide`}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Montant dû</dt>
                <dd>
                  {amountSet ? (
                    <>
                      <strong>{fmtSilver(ev.due)}</strong>
                      <span className="gl-quote">dont {fmtSilver(ev.interest)} d’intérêts · LTV {fmtPct(ev.ltv, 0)}</span>
                    </>
                  ) : (
                    <span className="muted">saisissez le montant prêté</span>
                  )}
                </dd>
              </div>
              <div>
                <dt>Retour idéal</dt>
                <dd>
                  <strong>{fmtDayLong(ev.idealDate)}</strong>
                  <span className="gl-quote">dans {plural(idealDay, 'jour')}</span>
                </dd>
              </div>
              <div>
                <dt>Date limite conseillée</dt>
                <dd>
                  {ev.limitDate ? (
                    <>
                      <strong>{fmtDayLong(ev.limitDate)}</strong>
                      <span className="gl-quote">{ev.limitDay === 0 ? 'déjà atteinte' : `dans ${plural(ev.limitDay ?? 0, 'jour')}`}</span>
                    </>
                  ) : (
                    <>
                      <strong>aucune sur 90 jours</strong>
                      <span className="gl-quote">le gage couvre largement le dû</span>
                    </>
                  )}
                </dd>
              </div>
              <div>
                <dt>Tendance · volatilité</dt>
                <dd>
                  <strong>
                    {fmtPerDay(d.trend)} · {fmtPct(d.sigma, 1)}/jour
                  </strong>
                  <span className="gl-quote">
                    {a.source === 'history' ? `historique ${plural(d.days, 'jour')} à ${valuationCity(v)}` : 'estimation sans historique'}
                    {d.rawTrend != null && d.rawTrend !== d.trend ? ` (mesurée ${fmtPerDay(d.rawTrend)}, bornée)` : ''}
                  </span>
                </dd>
              </div>
            </>
          )}
        </dl>
      )}
      {v.suspectExcluded > 0 && (v.quick || v.listing) && (
        <p className="field-help">{plural(v.suspectExcluded, 'prix suspect écarté', 'prix suspects écartés')} (plus de 3 × la moyenne sur 7 jours).</p>
      )}
      {a.sourceNote && (
        <p className="field-help gl-source" role="status">
          {a.sourceNote}{' '}
          {a.source === 'fallback' && (
            <button type="button" className="btn-ghost" onClick={onRetry}>
              Réessayer
            </button>
          )}
        </p>
      )}
      {ev.v0 != null && amountSet && (
        <LoanChart projection={ev.projection} due={ev.due} limitDay={ev.limitDay} idealDay={idealDay} today={today} maxTermDays={guild.maxTermDays} />
      )}
      {ev.v0 != null && (
        <details className="gl-detail">
          <summary>Comment c’est calculé</summary>
          <ul>
            <li>
              Revente rapide = meilleur ordre d’achat × (1 − taxe {fmtPct(v.tax, 0)}) × quantité, sans compter plus d’unités que la ville n’en vend
              en {QUICK_SALE_DAYS} jours, et à 125 % au plus du prix moyen payé ces 7 derniers jours ; mise en vente = vente minimale × (1 − taxe − 2,5 %
              de frais d’ordre) × quantité. Les prix suspects (plus de 3 × la moyenne sur 7 jours) sont écartés.
            </li>
            <li>
              Montant dû = montant prêté × (1 + intérêt). LTV = montant prêté ÷ revente rapide ; prêt max = le plus petit de {fmtPct(guild.maxLtv, 0)} ×
              revente rapide et du montant dont le dû reste couvert (valeur prudente moins la marge) jusqu’à la fin de la durée maximale.
            </li>
            <li>
              Valeur prudente au jour t = revente rapide × exp(tendance × t − {String(Z_PRUDENT).replace('.', ',')} × volatilité × √t) : le prix
              n’a qu’environ 1 chance sur 10 de tomber plus bas. Une tendance à la hausse n’est jamais comptée. Sans historique : tendance 0 et
              volatilité 3 %/jour.
            </li>
            <li>
              Date limite = premier jour où la valeur prudente, moins {fmtPct(guild.safetyMargin, 0)} de marge, passe sous le montant dû. Après,
              si l’emprunteur n’a pas remboursé, saisir et revendre le gage est plus sûr que d’attendre.
            </li>
            <li>Retour idéal = la plus proche de la date limite et de la durée maximale ({plural(guild.maxTermDays, 'jour')}), jamais avant demain.</li>
          </ul>
        </details>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Ligne de la liste
// ---------------------------------------------------------------------------

function CopyFallback({ text, onClose }: { text: string; onClose: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, [text]);
  return (
    <div className="gl-fallback">
      <label className="field-label" htmlFor="gl-fallback-text">
        Copie automatique impossible : sélectionnez et copiez ce texte (Ctrl+C)
      </label>
      <textarea id="gl-fallback-text" ref={ref} readOnly rows={Math.min(8, text.split('\n').length + 1)} value={text} />
      <button type="button" className="btn-ghost" onClick={onClose}>
        Fermer
      </button>
    </div>
  );
}

function LoanItem({
  row,
  today,
  editing,
  confirm,
  copied,
  fallback,
  onCloseFallback,
  onAsk,
  onRepaid,
  onReopen,
  onSeize,
  onEdit,
  onDelete,
  onCopy,
}: {
  row: Row;
  today: string;
  editing: boolean;
  confirm: 'delete' | 'seize' | null;
  copied: 'link' | 'discord' | null;
  fallback: string | null;
  onCloseFallback: () => void;
  onAsk: (kind: 'delete' | 'seize' | null) => void;
  onRepaid: () => void;
  onReopen: () => void;
  onSeize: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCopy: (kind: 'link' | 'discord') => void;
}) {
  const { loan, a, health, label } = row;
  const ev = a.ev;
  const open = loan.status === 'open';
  const gain = loan.status === 'seized' ? seizedResult(ev.v0, loan.amount) : null;
  const late = daysBetween(loan.dueDate, today);
  return (
    <li className={`gl-item is-${health}${editing ? ' is-editing' : ''}`} aria-label={`Prêt à ${loan.borrower}`}>
      <div className="gl-item-head">
        <strong className="gl-item-who">{loan.borrower}</strong>
        <span className={`gl-badge gl-badge--${health}`} data-testid="gl-status">
          {HEALTH_LABEL[health]}
        </span>
      </div>
      <p className="gl-item-what">
        {fmtInt(loan.qty)} × {label}
      </p>
      <dl className="gl-item-facts">
        <div>
          <dt>Prêté</dt>
          <dd>{fmtSilver(loan.amount)}</dd>
        </div>
        <div>
          <dt>Dû</dt>
          <dd>
            {fmtSilver(ev.due)} <span className="muted">({fmtPct(loan.rate, 1)})</span>
          </dd>
        </div>
        <div>
          <dt>Gage, revente rapide</dt>
          <dd>{ev.v0 == null ? 'sans prix' : fmtSilver(ev.v0)}</dd>
        </div>
        {open && ev.ltv != null && (
          <div>
            <dt>LTV</dt>
            <dd>{fmtPct(ev.ltv, 0)}</dd>
          </div>
        )}
        <div>
          <dt>Échéance</dt>
          <dd>
            {fmtDay(loan.dueDate)}
            {open && health === 'overdue' && <span className="gl-neg"> · {plural(late, 'jour')} de retard</span>}
          </dd>
        </div>
        {open && ev.v0 != null && (
          <div>
            <dt>Gardez le gage dès le</dt>
            <dd>{ev.limitDate ? fmtDay(ev.limitDate) : '> 90 jours'}</dd>
          </div>
        )}
        {gain != null && (
          <div>
            <dt>{gain >= 0 ? 'Gain de la saisie' : 'Perte de la saisie'} (prix du jour)</dt>
            <dd className={gain >= 0 ? 'gl-pos' : 'gl-neg'} data-testid="gl-gain">
              {gain >= 0 ? '+' : '−'}
              {fmtSilver(Math.abs(gain))}
            </dd>
          </div>
        )}
      </dl>
      {open && a.source !== 'history' && ev.v0 != null && (
        <p className="field-help">
          {a.source === 'loading'
            ? 'Historique en cours de chargement : estimation provisoire (tendance 0, volatilité 3 %/jour).'
            : 'Estimation sans historique (tendance 0, volatilité 3 %/jour).'}
        </p>
      )}
      {open && a.valuation.quick && a.valuation.quick.countedQty < loan.qty && (
        <p className="field-help gl-neg" data-testid="gl-item-liquidity">
          Peu liquide : {a.valuation.quick.countedQty === 1 ? 'seule 1 unité' : `seules ${fmtInt(a.valuation.quick.countedQty)} unités`} sur {fmtInt(loan.qty)} se revendent vite à {a.valuation.quick.loc} ; la revente rapide n’en compte pas plus.
        </p>
      )}
      {open && a.valuation.quick && a.valuation.quick.dailyVolume == null && loan.qty > 1 && (
        <p className="field-help">Volume de ventes inconnu à {a.valuation.quick.loc} : vérifiez en jeu qu’on peut revendre {fmtInt(loan.qty)} unités avant de compter sur ce gage.</p>
      )}
      {loan.note && <p className="gl-note">{loan.note}</p>}
      <div className="gl-actions">
        {open ? (
          <>
            <button type="button" className="btn" onClick={onRepaid}>
              Remboursé
            </button>
            {confirm === 'seize' ? (
              <span className="gl-confirm" role="group" aria-label="Confirmer la saisie">
                <span>Saisir le gage ?</span>
                <button type="button" className="btn gl-danger" onClick={onSeize}>
                  Confirmer la saisie
                </button>
                <button type="button" className="btn-ghost" onClick={() => onAsk(null)}>
                  Annuler
                </button>
              </span>
            ) : (
              <button type="button" className="btn" onClick={() => onAsk('seize')}>
                Saisir le gage
              </button>
            )}
          </>
        ) : (
          <button type="button" className="btn" onClick={onReopen}>
            Rouvrir
          </button>
        )}
        <button type="button" className="btn" onClick={onEdit}>
          Modifier
        </button>
        <button type="button" className="btn" onClick={() => onCopy('link')}>
          {copied === 'link' ? 'Lien copié' : 'Copier le lien'}
        </button>
        <button type="button" className="btn" onClick={() => onCopy('discord')}>
          {copied === 'discord' ? 'Résumé copié' : 'Résumé Discord'}
        </button>
        {confirm === 'delete' ? (
          <span className="gl-confirm" role="group" aria-label="Confirmer la suppression">
            <span>Supprimer définitivement ?</span>
            <button type="button" className="btn gl-danger" onClick={onDelete}>
              Confirmer
            </button>
            <button type="button" className="btn-ghost" onClick={() => onAsk(null)}>
              Annuler
            </button>
          </span>
        ) : (
          <button type="button" className="btn-ghost gl-delete" onClick={() => onAsk('delete')}>
            Supprimer
          </button>
        )}
      </div>
      {fallback && <CopyFallback text={fallback} onClose={onCloseFallback} />}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Règles de la guilde
// ---------------------------------------------------------------------------

function RulesPanel({ guild, update, reset }: { guild: GuildSettings; update: (p: Partial<GuildSettings>) => void; reset: () => void }) {
  // Saisie locale ; la règle n'est appliquée que si la valeur est valide (sinon le champ est marqué invalide).
  const [draft, setDraft] = useState<Record<string, string>>({});
  const val = (k: keyof GuildSettings, shown: string) => draft[k] ?? shown;
  const onNum = (k: 'maxLtv' | 'defaultRate' | 'safetyMargin' | 'maxTermDays', raw: string, lo: number, hi: number, scale: number) => {
    setDraft((d) => ({ ...d, [k]: raw }));
    const n = parseAmount(raw);
    if (Number.isFinite(n) && n >= lo && n <= hi) update({ [k]: k === 'maxTermDays' ? Math.round(n) : n / scale });
  };
  const invalid = (k: string, lo: number, hi: number) => {
    const raw = draft[k];
    if (raw == null) return undefined;
    const n = parseAmount(raw);
    return !(Number.isFinite(n) && n >= lo && n <= hi) || undefined;
  };
  return (
    <details className="quick-settings gl-rules">
      <summary>
        Règles de la guilde : LTV max {fmtPct(guild.maxLtv, 0)}, intérêt {fmtPct(guild.defaultRate, 1)}, marge {fmtPct(guild.safetyMargin, 0)}, durée max{' '}
        {plural(guild.maxTermDays, 'jour')}
      </summary>
      <div className="gl-rules-grid">
        <Field id="gl-guild" label="Nom de la guilde">
          <input
            id="gl-guild"
            value={val('guildName', guild.guildName)}
            maxLength={40}
            onChange={(e) => {
              setDraft((d) => ({ ...d, guildName: e.target.value }));
              if (e.target.value.trim()) update({ guildName: e.target.value });
            }}
          />
        </Field>
        <Field id="gl-ltv" label="Prêt max (LTV)" help="Part de la revente rapide qu’on accepte de prêter.">
          <span className="num-input">
            <input id="gl-ltv" inputMode="decimal" value={val('maxLtv', pctStr(guild.maxLtv))} aria-invalid={invalid('maxLtv', 5, 100)} onChange={(e) => onNum('maxLtv', e.target.value, 5, 100, 100)} />
            <span className="suffix">%</span>
          </span>
        </Field>
        <Field id="gl-defrate" label="Intérêt par défaut">
          <span className="num-input">
            <input id="gl-defrate" inputMode="decimal" value={val('defaultRate', pctStr(guild.defaultRate))} aria-invalid={invalid('defaultRate', 0, 200)} onChange={(e) => onNum('defaultRate', e.target.value, 0, 200, 100)} />
            <span className="suffix">%</span>
          </span>
        </Field>
        <Field id="gl-margin" label="Marge de sécurité" help="Retirée de la valeur prudente du gage.">
          <span className="num-input">
            <input id="gl-margin" inputMode="decimal" value={val('safetyMargin', pctStr(guild.safetyMargin))} aria-invalid={invalid('safetyMargin', 0, 90)} onChange={(e) => onNum('safetyMargin', e.target.value, 0, 90, 100)} />
            <span className="suffix">%</span>
          </span>
        </Field>
        <Field id="gl-term" label="Durée maximale">
          <span className="num-input">
            <input id="gl-term" inputMode="numeric" value={val('maxTermDays', String(guild.maxTermDays))} aria-invalid={invalid('maxTermDays', 1, 90)} onChange={(e) => onNum('maxTermDays', e.target.value, 1, 90, 1)} />
            <span className="suffix">jours</span>
          </span>
        </Field>
        <button
          type="button"
          className="btn-ghost gl-rules-reset"
          onClick={() => {
            setDraft({});
            reset();
          }}
        >
          Valeurs par défaut
        </button>
      </div>
    </details>
  );
}
