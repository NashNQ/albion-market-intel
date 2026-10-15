// Tableau de bord du mode Guilde : chiffres clés (investissements + prêts sur gage), tâches du jour,
// raccourcis et opportunités à financer (top 5 raffinage + craft, lien qui pré-remplit « Investir »).
import { useMemo } from 'react';
import type { Recipe, RouteResult } from '../../../types';
import { buildPriceIndex, compareRanked } from '../../../engine';
import { activityFor, simulateInvestment } from '../../../engine/invest';
import { WATCH_DAYS, daysBetween, isoDay, summarizeLoans, valueCollateral } from '../../../engine/pawn';
import { useAppData } from '../../context';
import { useInvestments, encodeInvestment, todayIso } from '../../data/investStore';
import { useLoans } from '../../data/loansStore';
import { useGuildSettings } from '../../data/guildSettings';
import { fmtInt, fmtSilver, itemHref, plural } from '../../format';
import { ItemIcon } from '../../components/ItemIcon';
import { recipeLabel } from '../../components/invest/shared';

interface Todo {
  key: string;
  tone: 'danger' | 'warn';
  text: string;
  href: string;
  action: string;
}

/** Lien « Investir » pré-rempli pour une route du classement (membre à préciser, capital indicatif). */
export function fundHref(r: RouteResult, now: Date): string {
  const code = encodeInvestment({
    v: 1,
    member: 'Membre à financer',
    outputId: r.recipe.outputId,
    ...(r.recipe.variant ? { variant: r.recipe.variant } : {}),
    capital: 1_000_000,
    levelingCost: 0,
    investorShare: 0.5,
    unitsPerDay: null,
    rotationDays: 2,
    startDate: todayIso(now),
    startUnitProfit: r.unitProfit,
    startUnitCost: r.unitCost,
  });
  return '#/guilde/investir?i=' + code;
}

function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'danger' | 'ok' }) {
  return (
    <div className={tone ? `g-stat g-stat-${tone}` : 'g-stat'}>
      <dt>{label}</dt>
      <dd className="g-stat-value">{value}</dd>
      {note && <dd className="g-stat-note">{note}</dd>}
    </div>
  );
}

export function GuildDashboard() {
  const { snapshot, recipes, settings, now, metaById, itemById, recipesByOutput, rankings } = useAppData();
  const [guild] = useGuildSettings();
  const { items: investments } = useInvestments();
  const { loans } = useLoans();

  const index = useMemo(() => (snapshot ? buildPriceIndex(snapshot, settings, now) : null), [snapshot, settings, now]);
  const bonuses = recipes?.bonuses;

  const recipeOf = (outputId: string, variant?: string): Recipe | null =>
    recipesByOutput.get(outputId)?.find((r) => (r.variant ?? undefined) === (variant ?? undefined)) ?? null;
  const nameOf = (id: string) => metaById.get(id)?.nameFr ?? id;

  // Investissements aux prix du moment (scénario central).
  const inv = useMemo(() => {
    let capital = 0;
    let perDay = 0;
    let priced = 0;
    const negative: { id: string; member: string; label: string }[] = [];
    for (const i of investments) {
      capital += i.capital;
      const r = recipesByOutput.get(i.outputId)?.find((x) => (x.variant ?? undefined) === (i.variant ?? undefined));
      if (!r || !index || !bonuses) continue;
      const a = activityFor(r, index, bonuses, settings);
      if (!a.ok) {
        if (a.reason === 'unprofitable') negative.push({ id: i.id, member: i.member, label: recipeLabel(r, metaById) });
        continue;
      }
      const s = simulateInvestment(a.activity, {
        capital: i.capital,
        levelingCost: i.levelingCost,
        investorShare: i.investorShare,
        unitsPerDay: i.unitsPerDay,
        rotationDays: i.rotationDays,
      });
      if (s.ok) {
        perDay += s.scenarios.central.investorPerDay;
        priced++;
      } else if (s.reason === 'unprofitable') negative.push({ id: i.id, member: i.member, label: recipeLabel(r, metaById) });
    }
    return { capital, perDay, priced, negative };
  }, [investments, recipesByOutput, index, bonuses, settings, metaById]);

  // Valeur nette unitaire de revente rapide (meilleur ordre d'achat, taxe déduite) d'après le snapshot.
  const valueOf = useMemo(() => {
    const cache = new Map<string, number | null>();
    return (id: string): number | null => {
      if (!cache.has(id)) {
        const v = valueCollateral(itemById.get(id), 1, { premium: settings.premium, maxPriceAgeH: settings.maxPriceAgeH, now });
        cache.set(id, v.quick?.unitNet ?? null);
      }
      return cache.get(id) ?? null;
    };
  }, [itemById, settings.premium, settings.maxPriceAgeH, now]);

  const sum = useMemo(
    () => summarizeLoans(loans, valueOf, now, { safetyMargin: guild.safetyMargin }),
    [loans, valueOf, now, guild.safetyMargin],
  );

  const todos = useMemo<Todo[]>(() => {
    const t0 = isoDay(now);
    const out: Todo[] = [];
    const open = loans.filter((l) => l.status === 'open').sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
    for (const l of open) {
      const days = daysBetween(t0, l.dueDate);
      const what = `${l.borrower} (${fmtInt(l.qty)} × ${nameOf(l.itemId)})`;
      const due = fmtSilver(l.amount * (1 + l.rate));
      if (days < 0) {
        out.push({
          key: 'o' + l.id,
          tone: 'danger',
          text: `Prêt de ${what} en retard de ${plural(-days, 'jour')} : ${due} dus. Relancer ou saisir le gage.`,
          href: '#/guilde/prets',
          action: 'Voir les prêts',
        });
        continue;
      }
      const unit = valueOf(l.itemId);
      const atRisk = unit != null && unit * l.qty * (1 - guild.safetyMargin) < l.amount * (1 + l.rate);
      if (atRisk)
        out.push({
          key: 'r' + l.id,
          tone: 'danger',
          text: `Le gage de ${what} ne couvre plus les ${due} dus aux prix du moment.`,
          href: '#/guilde/prets',
          action: 'Voir les prêts',
        });
      else if (days <= WATCH_DAYS)
        out.push({
          key: 'd' + l.id,
          tone: 'warn',
          text:
            days === 0
              ? `Échéance aujourd’hui pour ${what} : ${due} à récupérer.`
              : `Échéance dans ${plural(days, 'jour')} pour ${what} : ${due} à récupérer.`,
          href: '#/guilde/prets',
          action: 'Voir les prêts',
        });
    }
    for (const n of inv.negative)
      out.push({
        key: 'i' + n.id,
        tone: 'warn',
        text: `L’activité financée de ${n.member} (${n.label}) n’est plus rentable aux prix du moment.`,
        href: '#/guilde/investir',
        action: 'Voir le portefeuille',
      });
    return out;
  }, [loans, now, valueOf, guild.safetyMargin, inv.negative]); // eslint-disable-line react-hooks/exhaustive-deps

  const opportunities = useMemo<RouteResult[]>(() => {
    if (!rankings) return [];
    return [...rankings.refining.slice(0, 5), ...rankings.crafting.slice(0, 5)].sort(compareRanked).slice(0, 5);
  }, [rankings]);

  const hasAny = investments.length > 0 || loans.length > 0;

  return (
    <section className="page g-page" aria-labelledby="page-title">
      <header className="page-head">
        <p className="g-kicker">Mode Guilde</p>
        <h1 id="page-title">Tableau de bord de {guild.guildName}</h1>
        <p className="page-intro">
          Où en est l’argent de la guilde : capital confié aux membres, prêts sur gage en cours, et ce qui demande une
          action aujourd’hui. Chiffres recalculés aux prix du dernier relevé.
        </p>
      </header>

      <section aria-labelledby="g-kpi-t">
        <h2 id="g-kpi-t" className="sr-only">
          Chiffres clés
        </h2>
        <dl className="g-stats">
          <Stat
            label="Capital investi chez les membres"
            value={fmtSilver(inv.capital)}
            note={investments.length ? plural(investments.length, 'investissement suivi', 'investissements suivis') : 'aucun investissement suivi'}
          />
          <Stat
            label="Retour attendu par jour"
            value={inv.priced ? fmtSilver(inv.perDay) : '—'}
            note={inv.priced ? 'part de la guilde, scénario central' : 'aucun investissement chiffrable'}
          />
          <Stat label="Prêts en cours" value={fmtInt(sum.open)} note={sum.open ? `${fmtSilver(sum.lentOpen)} prêtés` : 'aucun prêt ouvert'} />
          <Stat label="Montant dû" value={fmtSilver(sum.dueOpen)} note="intérêts compris" />
          <Stat
            label="Valeur des gages"
            value={sum.open ? fmtSilver(sum.collateralValue) : '—'}
            note={sum.unpriced ? `revente rapide ; ${plural(sum.unpriced, 'gage')} sans prix` : 'revente rapide, taxe déduite'}
          />
          <Stat
            label="À risque ou en retard"
            value={fmtInt(sum.atRisk + sum.overdue)}
            note={`${plural(sum.overdue, 'en retard', 'en retard')}, ${plural(sum.atRisk, 'gage insuffisant', 'gages insuffisants')}`}
            tone={sum.atRisk + sum.overdue > 0 ? 'danger' : sum.open ? 'ok' : undefined}
          />
        </dl>
      </section>

      <div className="g-cols">
        <section className="g-card" aria-labelledby="g-todo-t">
          <h2 id="g-todo-t">À faire aujourd’hui</h2>
          {todos.length ? (
            <ul className="g-todo">
              {todos.map((t) => (
                <li key={t.key} className={`g-todo-item g-todo-${t.tone}`}>
                  <span>{t.text}</span>
                  <a href={t.href}>{t.action}</a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="g-empty">
              {hasAny
                ? 'Rien d’urgent : aucun prêt en retard ou proche de son échéance, et tous les investissements restent rentables.'
                : 'Rien à suivre pour l’instant. Enregistrez un premier investissement ou un prêt sur gage : les échéances et les alertes apparaîtront ici.'}
            </p>
          )}
        </section>

        <nav className="g-card" aria-labelledby="g-short-t">
          <h2 id="g-short-t">Raccourcis</h2>
          <ul className="g-shortcuts">
            <li>
              <a className="g-shortcut" href="#/guilde/investir">
                <strong>Investir</strong>
                <span>Simuler le financement d’un membre et suivre le portefeuille.</span>
              </a>
            </li>
            <li>
              <a className="g-shortcut" href="#/guilde/prets">
                <strong>Prêts sur gage</strong>
                <span>Prêter contre un objet, avec une date limite conseillée.</span>
              </a>
            </li>
            <li>
              <a className="g-shortcut" href="#/guilde/reglages">
                <strong>Réglages guilde</strong>
                <span>Politique de prêt, sauvegarde et partage des données.</span>
              </a>
            </li>
          </ul>
        </nav>
      </div>

      <section className="g-card" aria-labelledby="g-opp-t">
        <h2 id="g-opp-t">Opportunités pour financer un membre</h2>
        <p className="g-explain">Les 5 meilleures activités du classement raffinage + craft, aux réglages courants.</p>
        {opportunities.length ? (
          <ol className="g-opps">
            {opportunities.map((r) => {
              const rec = recipeOf(r.recipe.outputId, r.recipe.variant);
              const label = rec ? recipeLabel(rec, metaById) : nameOf(r.recipe.outputId);
              return (
                <li key={r.recipe.outputId + (r.recipe.variant ?? '')} className="g-opp">
                  <ItemIcon id={r.recipe.outputId} name="" size={32} />
                  <span className="g-opp-main">
                    <a href={itemHref(r.recipe.outputId)}>{label}</a>
                    <span className="g-opp-meta">
                      {fmtSilver(r.unitProfit)} / unité · {r.q == null ? '—' : `${fmtInt(r.q)} vendables/jour`}
                    </span>
                  </span>
                  <a className="btn g-opp-cta" href={fundHref(r, now)} aria-label={`Financer un membre : ${label}`}>
                    Financer
                  </a>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="g-empty">
            {rankings ? 'Aucune activité rentable aux réglages courants : élargissez l’âge des prix dans Réglages.' : 'Classements en cours de calcul…'}
          </p>
        )}
      </section>
    </section>
  );
}
