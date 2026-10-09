import { useEffect, useRef, type ReactNode } from 'react';
import { fmtClock, fmtInt } from '../format';

export type RouteName = 'accueil' | 'raffinage' | 'craft' | 'transport' | 'fermes' | 'favoris' | 'black-market' | 'routes' | 'item' | 'reglages' | 'a-propos';

const TABS: { route: RouteName; href: string; label: string }[] = [
  { route: 'accueil', href: '#/', label: 'Accueil' },
  { route: 'raffinage', href: '#/raffinage', label: 'Raffinage' },
  { route: 'craft', href: '#/craft', label: 'Craft' },
  { route: 'transport', href: '#/transport', label: 'Transport' },
  { route: 'fermes', href: '#/fermes', label: 'Fermes' },
  { route: 'routes', href: '#/routes', label: 'Mes routes' },
  { route: 'favoris', href: '#/favoris', label: 'Favoris' },
  { route: 'black-market', href: '#/black-market', label: 'Black Market' },
  { route: 'reglages', href: '#/reglages', label: 'Réglages' },
  { route: 'a-propos', href: '#/a-propos', label: 'À propos' },
];

export type Theme = 'dark' | 'light';

function freshnessLabel(ageMinutes: number | null): string {
  if (ageMinutes == null) return 'Pas encore de données';
  const m = Math.floor(ageMinutes);
  if (m < 1) return 'Mis à jour à l’instant';
  if (m < 120) return `Mis à jour il y a ${fmtInt(m)} min`;
  return `Mis à jour il y a ${fmtInt(Math.floor(m / 60))} h`;
}

export function FreshnessPill({ ageMinutes }: { ageMinutes: number | null }) {
  const tone = ageMinutes == null ? 'grey' : ageMinutes < 60 ? 'green' : ageMinutes < 360 ? 'orange' : 'grey';
  return (
    <span className={`fresh fresh-${tone}`} role="status">
      <span className="fresh-dot" aria-hidden="true" />
      {freshnessLabel(ageMinutes)}
    </span>
  );
}

export function Header({
  current,
  ageMinutes,
  theme,
  onTheme,
}: {
  current: RouteName;
  ageMinutes: number | null;
  theme: Theme;
  onTheme: () => void;
}) {
  // En mobile, la barre d'onglets défile horizontalement : on garde l'onglet actif visible (ex. « À propos »).
  const tabsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = tabsRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return;
    const left = active.getBoundingClientRect().left - nav.getBoundingClientRect().left + nav.scrollLeft;
    const right = left + active.offsetWidth;
    if (left < nav.scrollLeft || right > nav.scrollLeft + nav.clientWidth) {
      nav.scrollLeft = Math.max(0, left - (nav.clientWidth - active.offsetWidth) / 2);
    }
  }, [current]);
  return (
    <header className="site-head">
      <div className="head-row">
        <a className="brand" href="#/">
          <img className="brand-mark" src="/favicon-32.png" srcSet="/favicon-32.png 1x, /apple-touch-icon.png 4x" width="26" height="26" alt="" />
          <span className="brand-name">
            Albion Market Intel <span className="brand-srv">Europe</span>
          </span>
        </a>
        <div className="head-tools">
          <FreshnessPill ageMinutes={ageMinutes} />
          <button
            type="button"
            className="theme-btn"
            onClick={onTheme}
            aria-label={theme === 'dark' ? 'Passer au thème clair' : 'Passer au thème sombre'}
            title={theme === 'dark' ? 'Thème clair' : 'Thème sombre'}
          >
            {theme === 'dark' ? (
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </div>
      </div>
      <nav className="tabs" aria-label="Sections" ref={tabsRef}>
        {TABS.map((t) => (
          <a key={t.route} href={t.href} className="tab" aria-current={current === t.route ? 'page' : undefined}>
            {t.label}
          </a>
        ))}
      </nav>
    </header>
  );
}

export function LateBanner({ updatedAt, onRetry }: { updatedAt: Date | null; onRetry: () => void }) {
  return (
    <div className="late-banner" role="alert">
      <span>
        {updatedAt ? `Données de ${fmtClock(updatedAt)}, la collecte semble en retard.` : 'Impossible de charger les données, la collecte semble en retard.'}
      </span>
      <button type="button" className="btn-ghost on-alert" onClick={onRetry}>
        Recharger
      </button>
    </div>
  );
}

export function EmptyScreen() {
  return (
    <section className="state-screen" aria-labelledby="empty-title">
      <img className="state-art" src="/img/waiting-900.webp" width="900" height="675" alt="" decoding="async" />
      <h1 id="empty-title">Première collecte en cours, revenez dans 15 minutes</h1>
      <p>
        Les prix des villes d’Europe sont en cours de récupération auprès de l’Albion Online Data Project. Cette page se
        mettra à jour toute seule dès qu’ils seront disponibles.
      </p>
    </section>
  );
}

export function ErrorScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <section className="state-screen" aria-labelledby="err-title">
      <h1 id="err-title">Les données du marché n’ont pas pu être chargées</h1>
      <p>Vérifiez votre connexion puis relancez le chargement. Les données se rechargent aussi toutes les 5 minutes.</p>
      <button type="button" className="btn" onClick={onRetry}>
        Recharger les données
      </button>
    </section>
  );
}

export function Skeleton() {
  return (
    <section className="page" aria-busy="true" aria-label="Chargement des données">
      <div className="sk sk-title" />
      <div className="sk sk-line" />
      <div className="sk-table">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="sk sk-row" />
        ))}
      </div>
      <p className="sr-only">Chargement des données du marché…</p>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="site-foot">
      <p>
        Prix et volumes : <a href="https://www.albion-online-data.com/">Albion Online Data Project</a>. Recettes et noms :{' '}
        <a href="https://github.com/ao-data/ao-bin-dumps">ao-bin-dumps</a>.
      </p>
      <p>
        Non affilié à Sandbox Interactive. Code source sur{' '}
        <a href="https://github.com/NashNQ/albion-market-intel">GitHub (NashNQ/albion-market-intel)</a>.
      </p>
    </footer>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  return <main id="contenu" className="main">{children}</main>;
}
