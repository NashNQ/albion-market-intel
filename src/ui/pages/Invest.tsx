// Page « Investir » : simulateur de retour sur investissement d'un membre financé par la guilde,
// coût de montée en compétence et portefeuille des investissements.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Recipe, RouteResult } from '../../types';
import { buildPriceIndex, compareRanked } from '../../engine';
import {
  activityFor,
  chartHorizon,
  focusLimitedUnits,
  investorCumulative,
  journalPrices,
  simulateInvestment,
  unitEconomics,
  SCENARIOS,
  type InvestInput,
} from '../../engine/invest';
import { useAppData } from '../context';
import { LOC_ABBR, confidenceLevel, fmt2, fmtAgeH, fmtInt, fmtPct, fmtSilver, plural } from '../format';
import {
  INVEST_SHARE_PREFIX,
  decodeInvestment,
  investCodeFromHash,
  investShareUrl,
  newInvestId,
  shareBase,
  todayIso,
  useInvestments,
  type SavedInvestment,
  type SharedInvestment,
} from '../data/investStore';
import { PaybackChart } from '../components/invest/PaybackChart';
import { AssumptionsPanel, LevelingPanel } from '../components/invest/LevelingPanel';
import { Portfolio, type CopyKind, type PortfolioRow } from '../components/invest/Portfolio';
import { FAILURE_TEXT, copyText, discordSummary, fmtPayback, fmtSignedPct, fmtUnits, recipeKeyOf, recipeLabel, tierTag, verdict } from '../components/invest/shared';
import '../invest.css';

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'");

/** Nombre saisi (espaces et virgule décimale tolérés) ; NaN si invalide. */
export function parseNum(s: string): number {
  const t = s.replace(/[\s  ]/g, '').replace(',', '.');
  if (t === '') return NaN;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

type CapMode = 'auto' | 'manual' | 'focus';

interface Form {
  member: string;
  capital: string;
  leveling: string;
  share: string;
  capMode: CapMode;
  units: string;
  focus: string;
  rotation: string;
  startDate: string;
}

const defaultForm = (now: Date): Form => ({
  member: '',
  capital: '1000000',
  leveling: '0',
  share: '50',
  capMode: 'auto',
  units: '',
  focus: '10000',
  rotation: '2',
  startDate: todayIso(now),
});

const focusCostOf = (r: Recipe | null): number | null => {
  const v = (r as (Recipe & { craftingFocus?: unknown }) | null)?.craftingFocus;
  return typeof v === 'number' && v > 0 ? v : null;
};

function NumField({
  id,
  label,
  value,
  onChange,
  suffix,
  help,
  invalid,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix: string;
  help?: string;
  invalid?: boolean;
}) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <span className="num-input">
        <input
          id={id}
          inputMode="decimal"
          value={value}
          aria-invalid={invalid || undefined}
          aria-describedby={help ? `${id}-help` : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="suffix">{suffix}</span>
      </span>
      {help && (
        <p className="field-help" id={`${id}-help`}>
          {help}
        </p>
      )}
    </div>
  );
}

export function InvestPage() {
  const { snapshot, recipes, settings, now, metaById, recipesByOutput, rankings } = useAppData();
  const store = useInvestments();
  const [form, setForm] = useState<Form>(() => defaultForm(now));
  const [selKey, setSelKey] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [portfolioMsg, setPortfolioMsg] = useState<string | null>(null);
  const [levelNote, setLevelNote] = useState<string | null>(null);
  const simRef = useRef<HTMLHeadingElement>(null);
  const listId = useId();
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  const index = useMemo(() => (snapshot ? buildPriceIndex(snapshot, settings, now) : null), [snapshot, settings, now]);
  const bonuses = recipes?.bonuses ?? {};

  const recipeOf = useCallback(
    (outputId: string, variant?: string): Recipe | null => {
      const list = recipesByOutput.get(outputId);
      if (!list) return null;
      return list.find((r) => (r.variant ?? undefined) === (variant ?? undefined)) ?? null;
    },
    [recipesByOutput],
  );
  const recipeFromKey = (k: string | null): Recipe | null => {
    if (!k) return null;
    const [o, v] = k.split('|');
    return recipeOf(o, v);
  };
  const recipe = recipeFromKey(selKey);

  // Suggestions : top 5 du classement raffinage + craft.
  const suggestions = useMemo<RouteResult[]>(() => {
    if (!rankings) return [];
    return [...rankings.refining.slice(0, 5), ...rankings.crafting.slice(0, 5)].sort(compareRanked).slice(0, 5);
  }, [rankings]);

  const matches = useMemo(() => {
    const words = norm(query).split(/\s+/).filter(Boolean);
    if (!words.length || !recipes) return [];
    const out: Recipe[] = [];
    for (const r of recipes.recipes) {
      const hay = norm(`${metaById.get(r.outputId)?.nameFr ?? ''} ${r.outputId} t${r.tier}${r.enchant ? '.' + r.enchant : ''}`);
      if (words.every((w) => hay.includes(w))) {
        out.push(r);
        if (out.length >= 8) break;
      }
    }
    return out;
  }, [query, recipes, metaById]);

  const choose = (r: Pick<Recipe, 'outputId' | 'variant'>) => {
    setSelKey(recipeKeyOf(r));
    setQuery('');
    setLevelNote(null);
    set({ units: '' });
  };

  // Lien de partage « #/investir?i=… » : pré-remplit le simulateur.
  const applyShared = useCallback(
    (s: SharedInvestment) => {
      setSelKey(recipeKeyOf(s));
      setEditingId(null);
      setForm({
        member: s.member,
        capital: String(s.capital),
        leveling: String(s.levelingCost),
        share: String(Math.round(s.investorShare * 10000) / 100),
        capMode: s.unitsPerDay == null ? 'auto' : 'manual',
        units: s.unitsPerDay == null ? '' : String(s.unitsPerDay),
        focus: '10000',
        rotation: String(s.rotationDays),
        startDate: s.startDate,
      });
    },
    [],
  );
  useEffect(() => {
    const read = () => {
      let hash = '';
      try {
        hash = window.location.hash;
      } catch {
        return;
      }
      const code = investCodeFromHash(hash);
      if (code == null) return;
      const s = decodeInvestment(code);
      if (s) {
        applyShared(s);
        setNotice(`Investissement partagé chargé (${s.member}) : vérifiez les chiffres puis enregistrez-le si vous le suivez.`);
      } else setNotice('Lien de partage illisible : il a peut-être été tronqué.');
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, [applyShared]);

  const act = useMemo(
    () => (recipe && index ? activityFor(recipe, index, bonuses, settings) : null),
    [recipe, index, bonuses, settings],
  );

  const focusCost = focusCostOf(recipe);
  const capMode: CapMode = form.capMode === 'focus' && focusCost == null ? 'auto' : form.capMode;

  const input: InvestInput | null = useMemo(() => {
    if (!act?.ok) return null;
    let unitsPerDay: number | null = null;
    if (capMode === 'manual') unitsPerDay = parseNum(form.units);
    else if (capMode === 'focus') unitsPerDay = focusLimitedUnits(parseNum(form.focus), focusCost, recipe?.outputQty) ?? NaN;
    return {
      capital: parseNum(form.capital),
      levelingCost: form.leveling.trim() === '' ? 0 : parseNum(form.leveling),
      investorShare: parseNum(form.share) / 100,
      unitsPerDay,
      rotationDays: parseNum(form.rotation),
    };
  }, [act, capMode, form, focusCost, recipe]);

  const sim = useMemo(() => (act?.ok && input ? simulateInvestment(act.activity, input) : null), [act, input]);

  const label = recipe ? recipeLabel(recipe, metaById) : '';

  // ---------------------------------------------------------------------------
  // Portefeuille
  // ---------------------------------------------------------------------------
  const rows: PortfolioRow[] = useMemo(
    () =>
      store.items.map((inv) => {
        const r = recipeOf(inv.outputId, inv.variant);
        const lab = r ? recipeLabel(r, metaById) : (metaById.get(inv.outputId)?.nameFr ?? inv.outputId);
        const start = Date.parse(inv.startDate + 'T00:00:00Z');
        const daysElapsed = Number.isNaN(start) ? 0 : Math.max(0, Math.floor((now.getTime() - start) / 86_400_000));
        if (!r) return { inv, label: lab, unitProfitNow: null, failure: 'unknownRecipe', sim: null, daysElapsed, earnedSoFar: null };
        if (!index) return { inv, label: lab, unitProfitNow: null, failure: 'missing', sim: null, daysElapsed, earnedSoFar: null };
        const a = activityFor(r, index, bonuses, settings);
        if (!a.ok) return { inv, label: lab, unitProfitNow: null, failure: a.reason, sim: null, daysElapsed, earnedSoFar: null };
        const s = simulateInvestment(a.activity, {
          capital: inv.capital,
          levelingCost: inv.levelingCost,
          investorShare: inv.investorShare,
          unitsPerDay: inv.unitsPerDay,
          rotationDays: inv.rotationDays,
        });
        const earned = s.ok ? investorCumulative(s.scenarios.central, inv.rotationDays, daysElapsed) : null;
        return { inv, label: lab, unitProfitNow: a.activity.unitProfit, failure: null, sim: s, daysElapsed, earnedSoFar: earned };
      }),
    [store.items, recipeOf, metaById, index, bonuses, settings, now],
  );

  const buildSaved = (): SavedInvestment | string => {
    if (!recipe) return 'Choisissez d’abord une activité.';
    if (!input || !sim?.ok) return 'Corrigez la simulation avant d’enregistrer (activité rentable et champs valides).';
    const member = form.member.trim().slice(0, 60);
    if (!member) return 'Indiquez le nom du membre financé.';
    const existing = editingId ? store.items.find((x) => x.id === editingId) : undefined;
    const inv: SavedInvestment = {
      v: 1,
      id: existing?.id ?? newInvestId(),
      member,
      outputId: recipe.outputId,
      capital: input.capital,
      levelingCost: input.levelingCost,
      investorShare: input.investorShare,
      unitsPerDay: capMode === 'auto' ? null : (input.unitsPerDay ?? null),
      rotationDays: input.rotationDays,
      startDate: /^\d{4}-\d{2}-\d{2}$/.test(form.startDate) ? form.startDate : todayIso(now),
      // Au démarrage stocké : on garde la référence d'origine lors d'une modification de la même activité.
      startUnitProfit:
        existing && existing.outputId === recipe.outputId && existing.variant === recipe.variant
          ? existing.startUnitProfit
          : act?.ok
            ? act.activity.unitProfit
            : null,
      startUnitCost:
        existing && existing.outputId === recipe.outputId && existing.variant === recipe.variant
          ? existing.startUnitCost
          : act?.ok
            ? act.activity.unitCost
            : null,
      createdAt: existing?.createdAt ?? now.toISOString(),
    };
    if (recipe.variant) inv.variant = recipe.variant;
    return inv;
  };

  const save = () => {
    const inv = buildSaved();
    if (typeof inv === 'string') {
      setPortfolioMsg(inv);
      return;
    }
    const err = store.upsert(inv);
    if (err) setPortfolioMsg(err);
    else {
      setPortfolioMsg(editingId ? `Investissement de ${inv.member} mis à jour.` : `Investissement de ${inv.member} enregistré.`);
      setEditingId(null);
    }
  };

  const edit = (id: string) => {
    const inv = store.items.find((x) => x.id === id);
    if (!inv) return;
    applyShared(inv);
    setEditingId(id);
    setPortfolioMsg(null);
    simRef.current?.focus();
  };

  const onCopy = async (id: string, kind: CopyKind) => {
    const inv = store.items.find((x) => x.id === id);
    if (!inv) return { ok: false, text: '' };
    const url = investShareUrl(inv, shareBase());
    let text = url;
    if (kind === 'discord') {
      const row = rows.find((r) => r.inv.id === id);
      const c = row?.sim?.ok ? row.sim.scenarios.central : null;
      text = discordSummary({
        member: inv.member,
        activity: row?.label ?? inv.outputId,
        capital: inv.capital,
        investorShare: inv.investorShare,
        payback: c ? c.paybackTotal : null,
        roi30: c ? c.roi30 : null,
        url,
      });
    }
    return { ok: await copyText(text), text };
  };

  // ---------------------------------------------------------------------------
  // Rendu
  // ---------------------------------------------------------------------------
  const levelingNum = form.leveling.trim() === '' ? 0 : parseNum(form.leveling);
  const capitalNum = parseNum(form.capital);
  const shareNum = parseNum(form.share);

  return (
    <section className="page invest-page" aria-labelledby="page-title">
      <header className="page-head">
        <h1 id="page-title">Investir</h1>
        <p className="page-intro">
          La guilde finance un membre pour qu’il produise : en combien de temps l’argent revient-il ? Chiffres calculés aux prix du moment
          et à vos réglages (premium {settings.premium ? 'actif' : 'inactif'}, focus {settings.focus ? 'actif' : 'inactif'}, mode{' '}
          {settings.mode === 'instant' ? 'instantané' : 'ordres'}, part de marché {fmtPct(settings.marketShare, 0)} ;{' '}
          <a href="#/reglages">réglages</a>).
        </p>
      </header>

      {notice && (
        <p className="inv-msg" role="status">
          {notice}{' '}
          <button type="button" className="btn-ghost" onClick={() => setNotice(null)}>
            Fermer
          </button>
        </p>
      )}

      <AssumptionsPanel />

      <section className="inv-section" aria-labelledby="inv-sim-title">
        <h2 id="inv-sim-title" ref={simRef} tabIndex={-1}>
          {editingId ? 'Modifier l’investissement' : 'Simulateur'}
        </h2>

        {/* Activité financée */}
        <div className="inv-picker">
          <div className="field">
            <label className="field-label" htmlFor="inv-search">
              Activité financée (objet produit)
            </label>
            <input
              id="inv-search"
              type="search"
              placeholder="Ex. planches T5, épée large…"
              value={query}
              autoComplete="off"
              aria-controls={listId}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {query.trim() !== '' && (
            <ul className="inv-results" id={listId} aria-label="Résultats de recherche">
              {matches.length === 0 && <li className="muted">Aucune recette ne correspond.</li>}
              {matches.map((r) => (
                <li key={recipeKeyOf(r)}>
                  <button type="button" className="inv-result" onClick={() => choose(r)}>
                    {recipeLabel(r, metaById)}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {suggestions.length > 0 && (
            <div className="inv-suggest" role="group" aria-label="Suggestions : top 5 du classement actuel">
              <span className="f-label">Top 5 actuel</span>
              {suggestions.map((r) => (
                <button
                  type="button"
                  key={recipeKeyOf(r.recipe)}
                  className={`inv-chip${selKey === recipeKeyOf(r.recipe) ? ' on' : ''}`}
                  aria-pressed={selKey === recipeKeyOf(r.recipe)}
                  onClick={() => choose(r.recipe)}
                >
                  {metaById.get(r.recipe.outputId)?.nameFr ?? r.recipe.outputId} <span className="muted">{tierTag(r.recipe)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {!recipe ? (
          <p className="muted inv-empty">Choisissez une activité pour lancer la simulation.</p>
        ) : !index ? (
          <p className="muted">Chargement des prix…</p>
        ) : (
          <>
            <div className="inv-activity" aria-labelledby="inv-act-title">
              <h3 id="inv-act-title">{label}</h3>
              {act && !act.ok ? (
                <p className="inv-warn" role="alert">
                  {FAILURE_TEXT[act.reason]}
                </p>
              ) : act?.ok ? (
                <dl className="inv-facts">
                  <div>
                    <dt>Coût / unité</dt>
                    <dd>{fmtSilver(act.route.unitCost)}</dd>
                  </div>
                  <div>
                    <dt>Revenu net / unité</dt>
                    <dd>{fmtSilver(act.route.unitRevenue)}</dd>
                  </div>
                  <div>
                    <dt>Profit / unité</dt>
                    <dd className="pos">{fmtSilver(act.route.unitProfit)}</dd>
                  </div>
                  <div>
                    <dt>Vendables / jour</dt>
                    <dd>{fmtUnits(act.activity.q)} unités</dd>
                  </div>
                  <div>
                    <dt>Production → vente</dt>
                    <dd>
                      <abbr title={act.route.craftAt}>{LOC_ABBR[act.route.craftAt]}</abbr> →{' '}
                      <abbr title={act.route.sellAt}>{LOC_ABBR[act.route.sellAt]}</abbr>
                    </dd>
                  </div>
                  <div>
                    <dt>Confiance</dt>
                    <dd>
                      {fmt2(act.route.confidence)} ({confidenceLevel(act.route.confidence)})
                    </dd>
                  </div>
                  <div>
                    <dt>Âge des prix</dt>
                    <dd>{fmtAgeH(act.route.oldestPriceAgeH)}</dd>
                  </div>
                </dl>
              ) : null}
            </div>

            {act?.ok && (
              <>
                <fieldset className="inv-inputs">
                  <legend>Paramètres de l’investissement</legend>
                  <div className="field">
                    <label className="field-label" htmlFor="inv-member">
                      Membre financé
                    </label>
                    <input id="inv-member" value={form.member} maxLength={60} onChange={(e) => set({ member: e.target.value })} />
                  </div>
                  <NumField
                    id="inv-capital"
                    label="Capital investi"
                    suffix="ag"
                    value={form.capital}
                    onChange={(v) => set({ capital: v })}
                    invalid={!(capitalNum > 0)}
                  />
                  <NumField
                    id="inv-leveling"
                    label="Dont coût de montée en compétence"
                    suffix="ag"
                    value={form.leveling}
                    onChange={(v) => set({ leveling: v })}
                    invalid={!(levelingNum >= 0) || levelingNum > capitalNum}
                    help="Dépensé pour débloquer le tier (non récupérable). Estimez-le ci-dessous ou saisissez-le."
                  />
                  <NumField
                    id="inv-share"
                    label="Part des profits pour l’investisseur"
                    suffix="%"
                    value={form.share}
                    onChange={(v) => set({ share: v })}
                    invalid={!(shareNum >= 0 && shareNum <= 100)}
                  />
                  <div className="field">
                    <label className="field-label" htmlFor="inv-capmode">
                      Capacité de production du membre
                    </label>
                    <select id="inv-capmode" value={capMode} onChange={(e) => set({ capMode: e.target.value as CapMode })}>
                      <option value="auto">Suit le marché ({fmtUnits(act.activity.q)} unités/jour)</option>
                      <option value="manual">Saisie manuelle</option>
                      {focusCost != null && <option value="focus">Limitée par le focus</option>}
                    </select>
                  </div>
                  {capMode === 'manual' && (
                    <NumField
                      id="inv-units"
                      label="Unités produites par jour"
                      suffix="unités/jour"
                      value={form.units === '' ? String(Math.round(act.activity.q)) : form.units}
                      onChange={(v) => set({ units: v })}
                    />
                  )}
                  {capMode === 'focus' && focusCost != null && (
                    <NumField
                      id="inv-focus"
                      label="Focus disponible par jour"
                      suffix="focus"
                      value={form.focus}
                      onChange={(v) => set({ focus: v })}
                      help={`${fmtInt(focusCost)} focus par fabrication.`}
                    />
                  )}
                  <NumField
                    id="inv-rotation"
                    label="Rotation du stock"
                    suffix="jours"
                    value={form.rotation}
                    onChange={(v) => set({ rotation: v })}
                    help="Jours entre l’achat des matières et la vente."
                  />
                </fieldset>

                <details className="quick-settings inv-level-box">
                  <summary>Estimer le coût de montée en compétence</summary>
                  <div className="inv-level-body">
                    <LevelingPanel
                      key={selKey ?? ''}
                      recipe={recipe}
                      recipes={recipes?.recipes ?? []}
                      metaById={metaById}
                      premium={settings.premium}
                      economics={(r) => unitEconomics(r, index, bonuses, settings)}
                      journal={(t) => journalPrices(index, t)}
                      onEstimate={(cost, est) => {
                        set({ leveling: String(cost) });
                        setLevelNote(
                          est.totalCost < 0 && est.complete
                            ? 'Montée rentable : coût de montée fixé à 0 ag (modifiable).'
                            : est.totalCost < 0
                              ? 'Estimation partielle et rentable sur les étapes chiffrées : coût de montée fixé à 0 ag, à vérifier (modifiable).'
                              : `Coût de montée estimé à ${fmtSilver(cost)}${est.complete ? '' : ' (estimation partielle)'} et reporté dans le simulateur (modifiable).`,
                        );
                      }}
                    />
                    {levelNote && (
                      <p className="field-help" role="status">
                        {levelNote}
                      </p>
                    )}
                  </div>
                </details>

                <Results sim={sim} input={input} />

                <div className="inv-save">
                  <div className="field">
                    <label className="field-label" htmlFor="inv-start">
                      Date de début
                    </label>
                    <input id="inv-start" type="date" value={form.startDate} onChange={(e) => set({ startDate: e.target.value })} />
                  </div>
                  <button type="button" className="btn inv-primary" onClick={save}>
                    {editingId ? 'Mettre à jour l’investissement' : 'Enregistrer dans le portefeuille'}
                  </button>
                  {editingId && (
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => {
                        setEditingId(null);
                        setPortfolioMsg(null);
                      }}
                    >
                      Annuler la modification
                    </button>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </section>

      <Portfolio
        rows={rows}
        editingId={editingId}
        onEdit={edit}
        onDuplicate={(id) => setPortfolioMsg(store.duplicate(id) ?? 'Investissement dupliqué.')}
        onDelete={(id) => {
          store.remove(id);
          if (editingId === id) setEditingId(null);
          setPortfolioMsg('Investissement supprimé.');
        }}
        onCopy={onCopy}
        message={portfolioMsg}
      />
      {!store.saved && <p className="inv-warn">Le stockage du navigateur est indisponible : le portefeuille ne sera pas conservé.</p>}
      <p className="field-help inv-foot">
        Les liens de partage ({INVEST_SHARE_PREFIX}…) contiennent les paramètres de l’investissement, sans donnée personnelle autre que le
        nom saisi.
      </p>
    </section>
  );
}

function Results({ sim, input }: { sim: ReturnType<typeof simulateInvestment> | null; input: InvestInput | null }) {
  if (!sim || !input) return null;
  if (!sim.ok) {
    const msg =
      sim.reason === 'levelingExceedsCapital'
        ? 'Le coût de montée dépasse le capital investi : augmentez le capital ou réduisez le coût de montée.'
        : sim.reason === 'unprofitable'
          ? 'Profit par unité nul ou négatif : rien à partager.'
          : 'Vérifiez les champs : capital, coût de montée, part (0 à 100 %), capacité et rotation doivent être des nombres positifs.';
    return (
      <p className="inv-warn" role="alert">
        {msg}
      </p>
    );
  }
  const c = sim.scenarios.central;
  const horizon = chartHorizon(sim.scenarios);
  const limitText =
    c.limitedBy === 'capital'
      ? 'limitée par le capital'
      : c.limitedBy === 'market'
        ? 'limitée par les ventes du marché'
        : 'limitée par la capacité du membre';
  return (
    <div className="inv-results-block" aria-labelledby="inv-res-title">
      <h3 id="inv-res-title" className="sr-only">
        Résultats
      </h3>
      <p className="inv-verdict" data-testid="inv-verdict">
        {verdict(sim.scenarios)}
      </p>
      <dl className="inv-cards">
        <div>
          <dt>Point mort, capital total</dt>
          <dd>{fmtPayback(c.paybackTotal)}</dd>
        </div>
        <div>
          <dt>Point mort, coût de montée seul</dt>
          <dd>{input.levelingCost > 0 ? fmtPayback(c.paybackLeveling) : 'aucun coût'}</dd>
        </div>
        <div>
          <dt>Part investisseur / jour</dt>
          <dd>{fmtSilver(c.investorPerDay)}</dd>
        </div>
        <div>
          <dt>Profit / jour</dt>
          <dd>{fmtSilver(c.profitPerDay)}</dd>
        </div>
        <div>
          <dt>ROI 30 jours</dt>
          <dd>{fmtSignedPct(c.roi30)}</dd>
        </div>
        <div>
          <dt>ROI 90 jours</dt>
          <dd>{fmtSignedPct(c.roi90)}</dd>
        </div>
        <div>
          <dt>Fonds de roulement engagé</dt>
          <dd>{fmtSilver(c.workingCapitalUsed)}</dd>
        </div>
        <div>
          <dt>Production</dt>
          <dd>
            {fmtUnits(c.unitsPerDay)} unités/jour <span className="inv-card-note">{limitText}</span>
          </dd>
        </div>
      </dl>

      <div className="inv-table-wrap">
        <table className="inv-table inv-scen">
          <caption>Trois scénarios</caption>
          <thead>
            <tr>
              <th scope="col">Scénario</th>
              <th scope="col">Profit / unité</th>
              <th scope="col">Unités / jour</th>
              <th scope="col">Part / jour</th>
              <th scope="col">Point mort</th>
              <th scope="col">ROI 30 j</th>
              <th scope="col">ROI 90 j</th>
            </tr>
          </thead>
          <tbody>
            {SCENARIOS.map((d) => {
              const s = sim.scenarios[d.key];
              return (
                <tr key={d.key} className={d.key === 'central' ? 'is-central' : undefined}>
                  <th scope="row">{d.label}</th>
                  <td>{fmtSilver(s.unitProfit)}</td>
                  <td>{fmtUnits(s.unitsPerDay)}</td>
                  <td>{fmtSilver(s.investorPerDay)}</td>
                  <td>{fmtPayback(s.paybackTotal)}</td>
                  <td>{fmtSignedPct(s.roi30)}</td>
                  <td>{fmtSignedPct(s.roi90)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <PaybackChart scenarios={sim.scenarios} capital={input.capital} rotationDays={input.rotationDays} horizon={horizon} />

      <details className="inv-detail" open>
        <summary>Détail du calcul (scénario central)</summary>
        <ul>
          <li>
            Capital disponible pour produire : {fmtSilver(input.capital)} − {fmtSilver(input.levelingCost)} de montée ={' '}
            {fmtSilver(sim.available)}.
          </li>
          <li>
            Fonds de roulement nécessaire : {fmtSilver(c.unitCost)} × {fmtUnits(c.targetUnits)}{' '}
            unités/jour × {plural(Math.max(1, input.rotationDays), 'jour')} de rotation = {fmtSilver(c.workingCapitalNeeded)}
            {c.limitedBy === 'capital'
              ? ` ; seuls ${fmtSilver(c.workingCapitalUsed)} sont disponibles (il manque ${fmtSilver(c.workingCapitalNeeded - c.workingCapitalUsed)} pour produire à plein)`
              : ''}
            . Il est récupérable en fin d’activité.
          </li>
          <li>
            Production retenue : {fmtUnits(c.unitsPerDay)} unités/jour ({limitText}).
          </li>
          <li>
            Profit : {fmtUnits(c.unitsPerDay)} × {fmtSilver(c.unitProfit)} = {fmtSilver(c.profitPerDay)} par jour, dont{' '}
            {fmtPct(input.investorShare, 0)} pour l’investisseur, soit {fmtSilver(c.investorPerDay)} par jour.
          </li>
          <li>
            Point mort : {plural(input.rotationDays, 'jour')} de rotation avant la première vente, puis {fmtSilver(input.capital)} ÷{' '}
            {fmtSilver(c.investorPerDay)} par jour → {fmtPayback(c.paybackTotal)}.
            {input.levelingCost > 0 && ` Le seul coût de montée est remboursé ${fmtPayback(c.paybackLeveling)}.`}
          </li>
          <li>
            ROI = part cumulée ÷ capital − 1 : {fmtSignedPct(c.roi30)} à 30 jours, {fmtSignedPct(c.roi90)} à 90 jours. En comptant la
            récupération du fonds de roulement engagé : {fmtSignedPct(c.roi30Recovered)} et {fmtSignedPct(c.roi90Recovered)}.
          </li>
        </ul>
      </details>
    </div>
  );
}
