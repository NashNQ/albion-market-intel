// Page d'accueil produit (vitrine portfolio).
// Les chiffres « en direct » sont lus depuis AppDataContext ; la page reste lisible pendant le chargement.
import { useContext } from 'react';
import type { RouteResult } from '../../types';
import { AppDataContext, type AppData } from '../context';
import { ageHFromIso, fmtAgeH, fmtClock, fmtInt, fmtSilver, itemHref, plural } from '../format';
import { ItemIcon } from '../components/ItemIcon';
import { LocChip, buyLocations } from '../components/Route';
import '../marketing.css';

const REPO_URL = 'https://github.com/NashNQ/albion-market-intel';

interface Live {
  loading: boolean;
  items: number | null;
  recipes: number | null;
  updatedLabel: string | null;
  updatedTitle: string | null;
  profitable: number | null;
  best: RouteResult | null;
  top: RouteResult[];
  rankingsReady: boolean;
}

function readLive(data: AppData | null): Live {
  const snapshot = data?.snapshot ?? null;
  const recipes = data?.recipes ?? null;
  const rankings = data?.rankings ?? null;
  const now = data?.now ?? new Date();
  const ageH = snapshot ? ageHFromIso(snapshot.updatedAt, now) : null;
  const updated = snapshot ? new Date(snapshot.updatedAt) : null;
  return {
    loading: !snapshot || !recipes,
    items: snapshot ? snapshot.items.length : null,
    recipes: recipes ? recipes.recipes.length : null,
    updatedLabel: ageH == null ? null : `il y a ${fmtAgeH(ageH)}`,
    updatedTitle: updated && !Number.isNaN(updated.getTime()) ? `Dernière collecte des prix à ${fmtClock(updated)}` : null,
    profitable: rankings ? rankings.refining.length + rankings.crafting.length : null,
    best: rankings?.refining[0] ?? null,
    top: rankings ? rankings.refining.slice(0, 5) : [],
    rankingsReady: rankings != null,
  };
}

const nameOf = (data: AppData | null, r: RouteResult) => data?.metaById.get(r.recipe.outputId)?.nameFr ?? r.recipe.outputId;

function RouteChips({ r }: { r: RouteResult }) {
  const buys = buyLocations(r);
  return (
    <span className="mk-route" aria-label={`Achat ${buys.join(', ') || '—'}, production ${r.craftAt}, vente ${r.sellAt}`}>
      <span className="mk-route-leg">
        {buys.map((l) => (
          <LocChip key={l} loc={l} />
        ))}
      </span>
      <span className="route-sep" aria-hidden="true">›</span>
      <LocChip loc={r.craftAt} />
      <span className="route-sep" aria-hidden="true">›</span>
      <LocChip loc={r.sellAt} />
    </span>
  );
}

/** Valeur d'une ligne du registre : un trait pulsé pendant le chargement. */
function LedgerValue({ value, loading }: { value: string | null; loading: boolean }) {
  if (value != null) return <span className="mk-ledger-val">{value}</span>;
  return loading ? (
    <span className="mk-ledger-val mk-pending">
      <span className="sk mk-sk-val" aria-hidden="true" />
      <span className="sr-only">chargement</span>
    </span>
  ) : (
    <span className="mk-ledger-val">—</span>
  );
}

function Ledger({ live, data }: { live: Live; data: AppData | null }) {
  const best = live.best;
  return (
    <section className="mk-ledger" aria-labelledby="ledger-title" aria-busy={live.loading || undefined}>
      <h2 id="ledger-title" className="mk-ledger-title">
        Le marché d’Europe, à l’instant
      </h2>
      <dl className="mk-ledger-rows">
        <div className="mk-ledger-row">
          <dt>Objets suivis</dt>
          <dd>
            <LedgerValue value={live.items == null ? null : fmtInt(live.items)} loading={live.loading} />
          </dd>
        </div>
        <div className="mk-ledger-row">
          <dt>Recettes évaluées</dt>
          <dd>
            <LedgerValue value={live.recipes == null ? null : fmtInt(live.recipes)} loading={live.loading} />
          </dd>
        </div>
        <div className="mk-ledger-row">
          <dt>Routes rentables (raffinage et craft)</dt>
          <dd>
            <LedgerValue
              value={live.profitable == null ? null : fmtInt(live.profitable)}
              loading={live.loading || !live.rankingsReady}
            />
          </dd>
        </div>
        <div className="mk-ledger-row">
          <dt>Derniers prix collectés</dt>
          <dd title={live.updatedTitle ?? undefined}>
            <LedgerValue value={live.updatedLabel} loading={live.loading} />
          </dd>
        </div>
      </dl>
      <div className="mk-best">
        <p className="mk-best-label">Meilleur raffinage du moment</p>
        {best ? (
          <a className="mk-best-link" href={itemHref(best.recipe.outputId)}>
            <ItemIcon id={best.recipe.outputId} name="" size={40} />
            <span className="mk-best-body">
              <span className="mk-best-name">{nameOf(data, best)}</span>
              <RouteChips r={best} />
              <span className="mk-best-num">
                <strong className="profit">{fmtSilver(best.unitProfit)}</strong> par unité ·{' '}
                <strong>{fmtSilver(best.score)}</strong> espérés par jour
              </span>
            </span>
          </a>
        ) : live.loading || !live.rankingsReady ? (
          <div className="mk-best-link mk-best-wait" aria-hidden="true">
            <span className="sk mk-sk-icon" />
            <span className="mk-best-body">
              <span className="sk mk-sk-line" />
              <span className="sk mk-sk-line short" />
            </span>
          </div>
        ) : (
          <p className="mk-best-none">
            Aucun raffinage rentable avec vos réglages actuels. <a href="#/reglages">Ajuster les réglages</a>
          </p>
        )}
      </div>
    </section>
  );
}

function TopFive({ live, data }: { live: Live; data: AppData | null }) {
  return (
    <section className="mk-section" aria-labelledby="top-title">
      <div className="mk-section-head">
        <h2 id="top-title">Les 5 meilleurs raffinages en ce moment</h2>
        <p className="mk-lede">
          Classés par argent espéré par jour : profit par unité × quantité réellement vendable × confiance dans les prix.
          Les réglages par défaut s’appliquent tant que vous n’avez rien changé.
        </p>
      </div>
      {live.top.length > 0 ? (
        <ol className="mk-top" aria-label="Top 5 raffinage">
          {live.top.map((r, i) => {
            const name = nameOf(data, r);
            return (
              <li key={r.recipe.outputId + (r.recipe.variant ?? '')} className="mk-top-row">
                <span className="mk-top-rank" aria-hidden="true">
                  {i + 1}
                </span>
                <a className="mk-top-item" href={itemHref(r.recipe.outputId)}>
                  <ItemIcon id={r.recipe.outputId} name="" size={32} />
                  <span className="mk-top-name">{name}</span>
                  <span className={`tier tier-${r.recipe.tier}`}>
                    {r.recipe.tier}.{r.recipe.enchant}
                  </span>
                </a>
                <RouteChips r={r} />
                <span className="mk-top-num mk-top-profit">
                  <span className="profit">{fmtSilver(r.unitProfit)}</span>
                  <span className="mk-top-unit">par unité</span>
                </span>
                <span className="mk-top-num mk-top-score">
                  <strong>{fmtSilver(r.score)}</strong>
                  <span className="mk-top-unit">par jour</span>
                </span>
              </li>
            );
          })}
        </ol>
      ) : live.loading || !live.rankingsReady ? (
        <div className="mk-top mk-top-wait" aria-busy="true" aria-label="Chargement du classement">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="sk mk-sk-row" />
          ))}
        </div>
      ) : (
        <p className="empty-table">
          Aucun raffinage n’est rentable avec les réglages actuels. Essayez d’élargir l’âge maximum des prix dans les{' '}
          <a href="#/reglages">réglages</a>.
        </p>
      )}
      <p className="mk-more">
        <a className="mk-btn mk-btn-quiet" href="#/raffinage">
          Voir le classement complet
        </a>
      </p>
    </section>
  );
}

interface Feature {
  title: string;
  text: string;
  href: string;
  cta: string;
  badge?: string;
}

function features(best: RouteResult | null): Feature[] {
  return [
    {
      title: 'Classement raffinage',
      text: 'Planches, lingots, tissus, cuirs et blocs : chaque raffinage avec sa route achat, production et vente.',
      href: '#/raffinage',
      cta: 'Ouvrir le classement',
    },
    {
      title: 'Classement craft',
      text: 'Armes, armures, sacs et outils, triés par argent espéré par jour plutôt que par marge brute.',
      href: '#/craft',
      cta: 'Ouvrir le craft',
    },
    {
      title: 'Black Market séparé',
      text: 'Les ventes au Black Market sont classées à part, par profit, avec au moins une vente sur 7 jours.',
      href: '#/black-market',
      cta: 'Voir le Black Market',
    },
    {
      title: 'Fiche objet détaillée',
      text: 'Le calcul pas à pas : ingrédients, taux de retour, taxes, prix de chaque ville et recettes alternatives.',
      href: best ? itemHref(best.recipe.outputId) : '#/raffinage',
      cta: best ? 'Voir un exemple' : 'Choisir un objet',
    },
    {
      title: 'Réglages',
      text: 'Premium, focus, bonus du jour, tarif de station, ventes instantanées ou par ordres, part de marché, plafond, âge maximum des prix, volume minimum, prix estimés.',
      href: '#/reglages',
      cta: 'Régler le calcul',
    },
  ];
}

export function HomePage() {
  const data = useContext(AppDataContext);
  const live = readLive(data);

  return (
    <div className="mk mk-home">
      <section className="mk-hero" aria-labelledby="home-title">
        <div className="mk-hero-window">
          <img
            className="mk-hero-img"
            src="/img/hero-1600.webp"
            srcSet="/img/hero-800.webp 800w, /img/hero-1600.webp 1600w"
            sizes="(max-width: 1400px) 100vw, 1360px"
            width="1600"
            height="666"
            alt="Une rue marchande d’Albion à la tombée de la nuit : étals éclairés, bois empilé et forge allumée."
            fetchPriority="high"
            decoding="async"
          />
        </div>
        <div className="mk-hero-row">
          <div className="mk-slip">
            <p className="mk-kicker">Albion Online, serveur Europe</p>
            <h1 id="home-title">Sachez quoi raffiner, crafter et revendre avant de quitter la banque.</h1>
            <p className="mk-hero-lede">
              Les prix des villes d’Europe, relevés toutes les 15 minutes, transformés en routes classées par l’argent
              qu’elles rapportent vraiment par jour.
            </p>
            <div className="mk-ctas">
              <a className="mk-btn mk-btn-primary" href="#/raffinage">
                Voir le top raffinage
              </a>
              <a className="mk-btn mk-btn-secondary" href="#/fermes">
                Planifier mes fermes
              </a>
            </div>
          </div>
          <Ledger live={live} data={data} />
        </div>
      </section>

      <TopFive live={live} data={data} />

      <section className="mk-section" aria-labelledby="feat-title">
        <div className="mk-section-head">
          <h2 id="feat-title">Ce que vous pouvez faire</h2>
        </div>
        <div className="mk-feature-lead">
          <a className="mk-lead-card" href="#/routes">
            <img
              className="mk-lead-img"
              src="/img/chain-1200.webp"
              srcSet="/img/chain-600.webp 600w, /img/chain-1200.webp 1200w"
              sizes="(max-width: 900px) 100vw, 560px"
              width="1200"
              height="675"
              alt=""
              loading="lazy"
              decoding="async"
            />
            <span className="mk-lead-body">
              <span className="mk-lead-title">Mes routes</span>
              <span className="mk-lead-text">
                Montez une chaîne complète, du T2 au T4 et au-delà : pour chaque intermédiaire, achetez-le ou fabriquez-le,
                et voyez le coût cumulé. Les routes sont sauvegardées sur votre appareil et se partagent par un lien.
              </span>
              <span className="mk-link">Construire une route</span>
            </span>
          </a>
          <a className="mk-lead-card mk-lead-farm" href="#/fermes">
            <span className="mk-lead-body">
              <span className="mk-lead-title">
                Fermes <span className="mk-badge">Nouveau</span>
              </span>
              <span className="mk-lead-text">
                Agriculture et élevage des îles : quoi planter, quoi élever, et où dépenser le focus d’arrosage pour qu’il
                rapporte le plus. Un domaine que ne couvre pas Albion Profit Forge.
              </span>
              <span className="mk-link">Planifier mes fermes</span>
            </span>
          </a>
        </div>
        <ul className="mk-features">
          {features(live.best).map((f) => (
            <li key={f.title} className="mk-feature">
              <h3>{f.title}</h3>
              <p>{f.text}</p>
              <a className="mk-link" href={f.href}>
                {f.cta}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="mk-section" aria-labelledby="how-title">
        <div className="mk-section-head">
          <h2 id="how-title">Comment ça marche</h2>
        </div>
        <ol className="mk-steps">
          <li>
            <h3>Les données</h3>
            <p>
              Les prix viennent de l’Albion Online Data Project, alimenté par les joueurs ; les recettes, des fichiers du
              jeu publiés par ao-bin-dumps. Prix toutes les 15 minutes, volumes toutes les 6 heures, recettes chaque
              semaine.
            </p>
          </li>
          <li>
            <h3>Le calcul</h3>
            <p>
              Votre navigateur évalue chaque recette dans chaque ville : taux de retour, taxes, tarif de station, prix
              d’achat et de vente. Rien n’est calculé sur un serveur, vos réglages restent chez vous.
            </p>
          </li>
          <li>
            <h3>La décision</h3>
            <p>
              Chaque route reçoit un score : profit × quantité vendable par jour × confiance. Un prix âgé ou une vente rare
              fait baisser la confiance, et l’âge de chaque prix reste affiché.
            </p>
          </li>
        </ol>
      </section>

      <aside className="mk-portfolio" aria-labelledby="pf-title">
        <div>
          <h2 id="pf-title">Un projet portfolio, sans publicité ni abonnement</h2>
          <p>
            Albion Market Intel montre ce qu’un binôme humain + IA (Claude) livre sur un produit réel : un plan, des agents
            qui travaillent en parallèle, puis un audit contradictoire après chaque avancée. Le code est public.
          </p>
        </div>
        <div className="mk-portfolio-actions">
          <a className="mk-btn mk-btn-primary" href="#/a-propos">
            Lire l’étude de cas
          </a>
          <a className="mk-link" href={REPO_URL}>
            Code source sur GitHub
          </a>
        </div>
      </aside>

      <p className="mk-fineprint">
        {live.items != null
          ? `${plural(live.items, 'objet suivi')} sur le serveur Europe. `
          : 'Chargement des données du serveur Europe. '}
        Non affilié à Sandbox Interactive. Visuels générés avec Higgsfield.
      </p>
    </div>
  );
}
