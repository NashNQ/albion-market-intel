// Étude de cas « Comment c'est construit » (#/a-propos).
import { useContext } from 'react';
import { AppDataContext } from '../context';
import { fmtInt } from '../format';
import '../marketing.css';

const REPO_URL = 'https://github.com/NashNQ/albion-market-intel';

/** Schéma d'architecture : couleurs tirées des variables CSS, donc thémable. */
function ArchitectureDiagram() {
  return (
    <figure className="mk-diagram">
      <svg
        viewBox="0 0 880 330"
        role="img"
        aria-labelledby="arch-title arch-desc"
        className="mk-diagram-svg"
        preserveAspectRatio="xMidYMid meet"
      >
        <title id="arch-title">Architecture d’Albion Market Intel</title>
        <desc id="arch-desc">
          Les sources (Albion Online Data Project, ao-bin-dumps) sont lues par trois tâches GitHub Actions planifiées, qui
          publient des fichiers JSON sur la branche data. Netlify sert le site statique et relaie ces fichiers. Le
          navigateur calcule les classements avec les réglages enregistrés localement.
        </desc>
        <defs>
          <marker id="arch-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" className="d-arrowhead" />
          </marker>
        </defs>

        {/* Colonnes */}
        <text x="20" y="24" className="d-col">Sources</text>
        <text x="236" y="24" className="d-col">Collecte (GitHub)</text>
        <text x="470" y="24" className="d-col">Diffusion</text>
        <text x="676" y="24" className="d-col">Votre navigateur</text>

        {/* Sources */}
        <g>
          <rect x="20" y="44" width="180" height="78" rx="8" className="d-box" />
          <text x="34" y="72" className="d-title">Albion Online</text>
          <text x="34" y="90" className="d-title">Data Project</text>
          <text x="34" y="110" className="d-sub">prix et volumes, participatif</text>
        </g>
        <g>
          <rect x="20" y="196" width="180" height="78" rx="8" className="d-box" />
          <text x="34" y="224" className="d-title">ao-bin-dumps</text>
          <text x="34" y="244" className="d-sub">recettes, noms, bonus</text>
          <text x="34" y="262" className="d-sub">des villes</text>
        </g>

        {/* Collecte */}
        <g>
          <rect x="236" y="44" width="196" height="230" rx="8" className="d-box d-box-strong" />
          <text x="252" y="74" className="d-title">GitHub Actions</text>
          <text x="252" y="104" className="d-sub">prices.yml : toutes les 15 min</text>
          <text x="252" y="126" className="d-sub">volumes.yml : toutes les 6 h</text>
          <text x="252" y="148" className="d-sub">recipes.yml : chaque semaine</text>
          <line x1="252" y1="170" x2="416" y2="170" className="d-rule" />
          <text x="252" y="196" className="d-title">Branche data</text>
          <text x="252" y="218" className="d-sub">market.json</text>
          <text x="252" y="238" className="d-sub">recipes.json</text>
          <text x="252" y="260" className="d-sub">aucun secret, un seul commit</text>
        </g>

        {/* Diffusion */}
        <g>
          <rect x="470" y="104" width="170" height="110" rx="8" className="d-box" />
          <text x="486" y="134" className="d-title">Netlify</text>
          <text x="486" y="156" className="d-sub">site statique</text>
          <text x="486" y="176" className="d-sub">relais /data/*</text>
          <text x="486" y="196" className="d-sub">plan gratuit</text>
        </g>

        {/* Navigateur */}
        <g>
          <rect x="676" y="44" width="184" height="230" rx="8" className="d-box d-box-accent" />
          <text x="692" y="74" className="d-title">Moteur de calcul</text>
          <text x="692" y="98" className="d-sub">6 675 recettes évaluées</text>
          <text x="692" y="118" className="d-sub">dans chaque ville</text>
          <line x1="692" y1="138" x2="844" y2="138" className="d-rule" />
          <text x="692" y="164" className="d-title">Score</text>
          <text x="692" y="186" className="d-sub">profit × quantité</text>
          <text x="692" y="206" className="d-sub">vendable × confiance</text>
          <line x1="692" y1="226" x2="844" y2="226" className="d-rule" />
          <text x="692" y="252" className="d-sub">réglages en local</text>
        </g>

        {/* Flux */}
        <path d="M200 83 H230" className="d-flow" markerEnd="url(#arch-arrow)" />
        <path d="M200 235 H230" className="d-flow" markerEnd="url(#arch-arrow)" />
        <path d="M432 159 H464" className="d-flow" markerEnd="url(#arch-arrow)" />
        <path d="M640 159 H670" className="d-flow" markerEnd="url(#arch-arrow)" />

        <text x="20" y="314" className="d-note">Aucune base de données, aucune fonction serveur payante : tout le calcul se fait dans le navigateur.</text>
      </svg>
      <figcaption className="mk-caption">
        Le chemin d’un prix, de la saisie participative jusqu’au classement affiché.
      </figcaption>
    </figure>
  );
}

const STACK: { name: string; role: string }[] = [
  { name: 'Vite + React 19 + TypeScript', role: 'interface et moteur de calcul, typés de bout en bout' },
  { name: 'TanStack Table', role: 'tableaux triables et virtualisés, des milliers de lignes sans ralentir' },
  { name: 'GitHub Actions', role: 'collecte planifiée des prix, des volumes et des recettes' },
  { name: 'Netlify', role: 'hébergement statique et relais des fichiers de données' },
  { name: 'Vitest', role: 'plus de 160 tests : moteur, collecte, interface' },
  { name: 'CSS maison', role: 'variables pour les thèmes clair et sombre, aucune bibliothèque de composants' },
];

const TIMELINE: { when: string; title: string; text: string }[] = [
  {
    when: 'V1, en une journée',
    title: 'Plan, vagues d’agents, audit',
    text: 'Un plan de travail découpé en jalons, puis des agents Claude en parallèle sur la collecte, le moteur et l’interface. Chaque vague se termine par un audit contradictoire avant la suivante.',
  },
  {
    when: 'Itération 2',
    title: 'Routes personnalisées',
    text: '« Mes routes » : des chaînes complètes T2 → T4 et au-delà, où chaque intermédiaire peut être acheté ou fabriqué, sauvegardées en local et partageables par lien. Suivie de son propre audit.',
  },
  {
    when: 'Itération 3',
    title: 'Fermes et refonte',
    text: 'Le domaine agriculture et élevage des îles, avec l’allocation du focus d’arrosage, puis une refonte de la vitrine et des micro-interactions.',
  },
];

const FINDINGS: { title: string; text: string }[] = [
  {
    title: 'Un profit de −25 M quand un prix manque',
    text: 'Trouvée en test réel, sur le site en ligne : quand un prix manquait, une ligne affichait une perte absurde au lieu d’être écartée. Corrigée, puis verrouillée par un test.',
  },
  {
    title: 'Trois lignes recalculées à la main',
    text: 'L’audit refait à la main le calcul de trois lignes du classement, taxes et taux de retour compris, et exige le même résultat à 0,1 près.',
  },
  {
    title: '24 combinaisons de réglages',
    text: 'Les réglages se combinent entre eux : 24 combinaisons sont rejouées pour vérifier que le classement reste cohérent dans chaque cas.',
  },
  {
    title: 'Les 7 523 icônes vérifiées',
    text: 'Chaque identifiant d’objet est confronté au service d’images du jeu, pour qu’aucune ligne n’affiche une icône cassée.',
  },
];

const TRADEOFFS: { choice: string; why: string }[] = [
  {
    choice: 'La collecte tourne sur GitHub Actions, pas sur des fonctions Netlify.',
    why: 'Le plan gratuit de Netlify plafonne à 300 crédits par mois ; une collecte toutes les 15 minutes l’aurait épuisé. GitHub Actions publie sur une branche dédiée, et Netlify ne fait que servir les fichiers.',
  },
  {
    choice: 'Les prix sont participatifs : leur âge est affiché et pèse sur la confiance.',
    why: 'Un prix n’existe que si un joueur a ouvert le marché avec le client de données. Plutôt que de cacher ce trou, chaque route montre l’âge de son prix le plus ancien et sa confiance baisse avec lui.',
  },
  {
    choice: 'Les hypothèses agricoles sont modifiables.',
    why: 'Rendements, temps de pousse et part de focus dépendent du joueur. Elles sont exposées comme des réglages plutôt que figées dans le code.',
  },
  {
    choice: 'Le calcul se fait dans le navigateur.',
    why: 'Chaque joueur a ses propres réglages (premium, focus, bonus du jour). Calculer côté client évite tout serveur payant et toute donnée personnelle stockée ailleurs que sur l’appareil.',
  },
];

const LIMITS: string[] = [
  'Les prix reflètent ce que les joueurs ont relevé : une ville peu visitée peut avoir des prix vieux de plusieurs heures.',
  'Seul le serveur Europe est couvert.',
  'Le classement suppose que vous vendez au prix affiché ; il ne modélise pas la concurrence d’autres vendeurs au-delà de la part de marché réglée.',
  'Les trajets et leurs risques (zone rouge, Brumes) sont signalés, mais ni leur durée ni leur coût ne sont chiffrés.',
  'Le domaine Fermes repose sur des hypothèses de rendement que vous devez vérifier en jeu.',
];

export function AboutPage() {
  const data = useContext(AppDataContext);
  const liveItems = data?.snapshot?.items.length ?? null;

  return (
    <article className="mk mk-about" aria-labelledby="about-title">
      <header className="mk-about-head">
        <p className="mk-kicker">Étude de cas</p>
        <h1 id="about-title">Comment c’est construit</h1>
        <p className="mk-about-lede">
          Albion Market Intel est un produit complet, de la collecte des données à l’interface, conçu par un binôme : un
          humain qui décide et vérifie, et Claude qui planifie, code et audite. Ce n’est pas un produit commercial ; c’est
          une démonstration de ce que ce binôme livre.
        </p>
      </header>

      <div className="mk-about-grid">
        <nav className="mk-toc" aria-label="Sommaire de l’étude de cas">
          <ol>
            <li><a href="#cs-probleme" onClick={jump('cs-probleme')}>Le problème</a></li>
            <li><a href="#cs-reponse" onClick={jump('cs-reponse')}>La réponse</a></li>
            <li><a href="#cs-architecture" onClick={jump('cs-architecture')}>L’architecture</a></li>
            <li><a href="#cs-methode" onClick={jump('cs-methode')}>La méthode</a></li>
            <li><a href="#cs-audit" onClick={jump('cs-audit')}>Ce que l’audit a trouvé</a></li>
            <li><a href="#cs-choix" onClick={jump('cs-choix')}>Choix et compromis</a></li>
            <li><a href="#cs-limites" onClick={jump('cs-limites')}>Limites</a></li>
            <li><a href="#cs-credits" onClick={jump('cs-credits')}>Sources et crédits</a></li>
          </ol>
        </nav>

        <div className="mk-about-body">
          <section id="cs-probleme" className="mk-cs" tabIndex={-1} aria-labelledby="cs-probleme-t">
            <h2 id="cs-probleme-t">Le problème</h2>
            <p>
              Dans Albion Online, presque tout se fabrique et se revend entre sept villes. Un joueur qui veut raffiner ou
              crafter doit comparer des milliers de prix, appliquer les taux de retour de chaque ville, les taxes et le
              tarif des stations, puis deviner si l’objet se vendra vraiment. Classer par marge brute ne suffit
              pas : un objet très rentable qui ne se vend qu’une fois par semaine finirait en tête.
            </p>
          </section>

          <section id="cs-reponse" className="mk-cs" tabIndex={-1} aria-labelledby="cs-reponse-t">
            <h2 id="cs-reponse-t">La réponse produit</h2>
            <p>
              Un classement par <strong>argent espéré par jour</strong> : profit × quantité vendable par jour × confiance
              dans les prix. Autour de ce score :
            </p>
            <ul className="mk-list">
              <li>des classements raffinage et craft, et le Black Market classé à part ;</li>
              <li>une fiche par objet qui déroule le calcul pas à pas ;</li>
              <li>« Mes routes », pour monter une chaîne complète en choisissant d’acheter ou de fabriquer chaque étape ;</li>
              <li>« Fermes », pour l’agriculture et l’élevage des îles et l’allocation du focus d’arrosage ;</li>
              <li>des réglages qui collent à la situation de chaque joueur.</li>
            </ul>
            <dl className="mk-facts">
              <div>
                <dt>Recettes</dt>
                <dd>6 675</dd>
                <dd className="mk-facts-note">115 raffinages et l’équipement</dd>
              </div>
              <div>
                <dt>Objets suivis</dt>
                <dd>7 523</dd>
                <dd className="mk-facts-note">et 84 objets agricoles à venir</dd>
              </div>
              <div>
                <dt>Dans le marché chargé</dt>
                <dd>{liveItems == null ? '—' : fmtInt(liveItems)}</dd>
                <dd className="mk-facts-note">{liveItems == null ? 'chargement en cours' : 'objets dans le dernier relevé'}</dd>
              </div>
            </dl>
          </section>

          <section id="cs-architecture" className="mk-cs" tabIndex={-1} aria-labelledby="cs-architecture-t">
            <h2 id="cs-architecture-t">L’architecture</h2>
            <p>
              Aucun backend payant, aucun secret. Trois tâches planifiées publient des fichiers JSON ; le site statique les
              relaie ; votre navigateur fait le reste.
            </p>
            <ArchitectureDiagram />
            <h3 className="mk-h3">La pile technique</h3>
            <dl className="mk-stack">
              {STACK.map((s) => (
                <div key={s.name}>
                  <dt>{s.name}</dt>
                  <dd>{s.role}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section id="cs-methode" className="mk-cs" tabIndex={-1} aria-labelledby="cs-methode-t">
            <h2 id="cs-methode-t">La méthode humain + IA</h2>
            <p>
              Le principe : <strong>plan de travail, agents en parallèle, audit contradictoire après chaque avancée</strong>.
              L’humain fixe le cap, tranche les choix de produit et teste sur le vrai site. Claude rédige le plan, répartit le
              travail entre agents, écrit le code et les tests, puis un agent auditeur cherche activement ce qui est faux.
            </p>
            <ol className="mk-timeline">
              {TIMELINE.map((t) => (
                <li key={t.when}>
                  <p className="mk-tl-when">{t.when}</p>
                  <h3>{t.title}</h3>
                  <p>{t.text}</p>
                </li>
              ))}
            </ol>
          </section>

          <section id="cs-audit" className="mk-cs" tabIndex={-1} aria-labelledby="cs-audit-t">
            <h2 id="cs-audit-t">Ce que l’audit a trouvé</h2>
            <p>L’audit n’est pas une relecture : il recalcule, rejoue et casse. Quelques exemples réels.</p>
            <div className="mk-findings">
              {FINDINGS.map((f) => (
                <div key={f.title} className="mk-finding">
                  <h3>{f.title}</h3>
                  <p>{f.text}</p>
                </div>
              ))}
            </div>
          </section>

          <section id="cs-choix" className="mk-cs" tabIndex={-1} aria-labelledby="cs-choix-t">
            <h2 id="cs-choix-t">Choix et compromis</h2>
            <dl className="mk-tradeoffs">
              {TRADEOFFS.map((t) => (
                <div key={t.choice}>
                  <dt>{t.choice}</dt>
                  <dd>{t.why}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section id="cs-limites" className="mk-cs" tabIndex={-1} aria-labelledby="cs-limites-t">
            <h2 id="cs-limites-t">Limites honnêtes</h2>
            <ul className="mk-list">
              {LIMITS.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </section>

          <section id="cs-credits" className="mk-cs" tabIndex={-1} aria-labelledby="cs-credits-t">
            <h2 id="cs-credits-t">Sources et crédits</h2>
            <ul className="mk-list">
              <li>
                Prix et volumes : <a href="https://www.albion-online-data.com/">Albion Online Data Project</a>, données
                participatives.
              </li>
              <li>
                Recettes, noms et bonus : <a href="https://github.com/ao-data/ao-bin-dumps">ao-bin-dumps</a>.
              </li>
              <li>Icônes des objets : service d’images officiel d’Albion Online.</li>
              <li>Visuels d’illustration générés avec Higgsfield.</li>
              <li>Conception et code : Nash, avec Claude (Anthropic).</li>
              <li>Non affilié à Sandbox Interactive.</li>
            </ul>
            <div className="mk-repo">
              <p>Le code source est public : collecte, moteur, interface et tests.</p>
              <a className="mk-btn mk-btn-primary" href={REPO_URL}>
                Voir le dépôt sur GitHub
              </a>
            </div>
          </section>
        </div>
      </div>
    </article>
  );
}

/** Le routeur utilise le hash : on fait défiler vers l'ancre sans changer d'URL. */
function jump(id: string) {
  return (e: { preventDefault: () => void }) => {
    const el = typeof document === 'undefined' ? null : document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    el.focus?.({ preventScroll: true });
  };
}
