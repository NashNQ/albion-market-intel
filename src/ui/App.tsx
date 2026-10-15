import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useMarket } from './data/useMarket';
import { useSettings } from './data/useSettings';
import { useRankings } from './data/useRankings';
import { AppDataContext, buildIndexes, toRankingsView, type AppData } from './context';
import { EmptyScreen, ErrorScreen, Footer, Header, LateBanner, Layout, Skeleton, type RouteName, type Theme } from './components/Shell';
import { TopRefining } from './pages/TopRefining';
import { TopCrafting } from './pages/TopCrafting';
import { BlackMarket } from './pages/BlackMarket';
import { SettingsPage } from './pages/Settings';
import { HomePage } from './pages/Home';
import { shareCodeFromHash } from './data/routesStore';
import { MODE_HOME, modeForRoute, readStoredMode, storeMode, type Mode } from './data/mode';
import { useGuildSettings } from './data/guildSettings';

// Pages lourdes chargées à la demande (graphiques, fermes, transport…).
const RouteBuilder = lazy(() => import('./pages/RouteBuilder').then((m) => ({ default: m.RouteBuilder })));
const AboutPage = lazy(() => import('./pages/About').then((m) => ({ default: m.AboutPage })));
const FarmsPage = lazy(() => import('./pages/Farms').then((m) => ({ default: m.FarmsPage })));
const TransportPage = lazy(() => import('./pages/Transport').then((m) => ({ default: m.TransportPage })));
const InvestPage = lazy(() => import('./pages/Invest').then((m) => ({ default: m.InvestPage })));
const FavoritesPage = lazy(() => import('./pages/Favorites').then((m) => ({ default: m.FavoritesPage })));
const ItemDetail = lazy(() => import('./pages/ItemDetail').then((m) => ({ default: m.ItemDetail })));
// Mode Guilde
const GuildDashboard = lazy(() => import('./pages/guild/Dashboard').then((m) => ({ default: m.GuildDashboard })));
const LoansPage = lazy(() => import('./pages/guild/Loans').then((m) => ({ default: m.LoansPage })));
const GuildSettingsPage = lazy(() => import('./pages/guild/GuildSettings').then((m) => ({ default: m.GuildSettingsPage })));

export interface ParsedRoute {
  name: RouteName;
  itemId?: string;
  /** Code de route partagée (#/routes?r=…). */
  share?: string;
  /** Hash canonique vers lequel réécrire l'URL (alias historique). */
  redirect?: string;
}

export function parseHash(hash: string): ParsedRoute {
  const h = hash.replace(/^#\/?/, '');
  if (h === 'routes' || h.startsWith('routes?') || h.startsWith('routes/')) {
    const share = shareCodeFromHash('#/' + h);
    return share ? { name: 'routes', share } : { name: 'routes' };
  }
  // Alias historique : #/investir(?i=…) → #/guilde/investir(?i=…), paramètres conservés.
  if (h === 'investir' || h.startsWith('investir?')) return { name: 'guilde-investir', redirect: '#/guilde/' + h };
  if (h === 'guilde' || h === 'guilde/' || h.startsWith('guilde?') || h.startsWith('guilde/')) {
    const sub = h.slice('guilde'.length).replace(/^\//, '').split(/[?/]/)[0];
    switch (sub) {
      case 'investir':
        return { name: 'guilde-investir' };
      case 'prets':
        return { name: 'guilde-prets' };
      case 'reglages':
        return { name: 'guilde-reglages' };
      default:
        return { name: 'guilde' };
    }
  }
  const [head, ...rest] = h.split('/');
  switch (head) {
    case '':
    case 'accueil':
      return { name: 'accueil' };
    case 'raffinage':
      return { name: 'raffinage' };
    case 'fermes':
      return { name: 'fermes' };
    case 'transport':
      return { name: 'transport' };
    case 'favoris':
      return { name: 'favoris' };
    case 'a-propos':
      return { name: 'a-propos' };
    case 'craft':
      return { name: 'craft' };
    case 'black-market':
      return { name: 'black-market' };
    case 'reglages':
      return { name: 'reglages' };
    case 'item':
      if (rest.length) {
        let id = rest.join('/');
        try {
          id = decodeURIComponent(id);
        } catch {
          /* identifiant brut */
        }
        return { name: 'item', itemId: id };
      }
      return { name: 'raffinage' };
    default:
      return { name: 'accueil' };
  }
}

/** Réécrit l'URL sans ajouter d'entrée d'historique ni déclencher hashchange. */
function replaceHash(hash: string) {
  try {
    window.history.replaceState(window.history.state, '', hash);
  } catch {
    /* URL inchangée : la page s'affiche quand même */
  }
}

/** Route initiale : alias réécrit ; accueil nu + mode Guilde mémorisé → tableau de bord de la guilde. */
function initialRoute(): ParsedRoute {
  if (typeof window === 'undefined') return parseHash('');
  const hash = window.location.hash;
  if ((hash === '' || hash === '#' || hash === '#/') && readStoredMode() === 'guild') {
    replaceHash(MODE_HOME.guild);
    return parseHash(MODE_HOME.guild);
  }
  const r = parseHash(hash);
  if (r.redirect) replaceHash(r.redirect);
  return r;
}

function useHashRoute(): ParsedRoute {
  const [route, setRoute] = useState(initialRoute);
  useEffect(() => {
    const on = () => {
      const r = parseHash(window.location.hash);
      if (r.redirect) replaceHash(r.redirect);
      setRoute(r);
      window.scrollTo?.(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

const THEME_KEY = 'ami.theme';
function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return window.localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const toggle = useCallback(() => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      try {
        window.localStorage.setItem(THEME_KEY, next);
      } catch {
        /* préférence en mémoire seulement */
      }
      return next;
    });
  }, []);
  return [theme, toggle];
}

/**
 * Mode Joueur / Guilde : suit la route (une page /guilde/* passe en Guilde, une page joueur repasse en Joueur,
 * la fiche objet garde le mode courant) ; l'interrupteur change de mode et ouvre la page d'arrivée.
 */
function useMode(route: ParsedRoute): [Mode, () => void] {
  const [mode, setMode] = useState<Mode>(() => modeForRoute(route.name) ?? readStoredMode());
  useEffect(() => {
    const forced = modeForRoute(route.name);
    if (forced) setMode(forced);
  }, [route.name]);
  useEffect(() => {
    document.documentElement.dataset.mode = mode;
    storeMode(mode);
  }, [mode]);
  const toggle = useCallback(() => {
    const next: Mode = mode === 'guild' ? 'player' : 'guild';
    setMode(next);
    try {
      window.location.hash = MODE_HOME[next];
    } catch {
      /* navigation impossible : le mode change quand même */
    }
  }, [mode]);
  return [mode, toggle];
}

export function App() {
  const market = useMarket();
  const [settings, updateSettings, resetSettings] = useSettings();
  // `now` suit l'âge des données (rafraîchi chaque minute par useMarket).
  const nowKey = Math.floor(market.ageMinutes ?? 0);
  const now = useMemo(() => new Date(), [nowKey, market.snapshot]); // eslint-disable-line react-hooks/exhaustive-deps
  const rawRankings = useRankings(market.snapshot, market.recipes, settings, now.getTime());
  const rankings = useMemo(() => toRankingsView(rawRankings), [rawRankings]);
  const route = useHashRoute();
  const [theme, toggleTheme] = useTheme();
  const [mode, toggleMode] = useMode(route);
  const [guild] = useGuildSettings();

  const indexes = useMemo(() => buildIndexes(market.snapshot, market.recipes), [market.snapshot, market.recipes]);

  const data: AppData = {
    snapshot: market.snapshot,
    recipes: market.recipes,
    rankings,
    settings,
    updateSettings,
    resetSettings,
    now,
    ...indexes,
  };

  const { status } = market;
  // Accueil et étude de cas restent lisibles sans données (chiffres en chargement).
  const needsData =
    route.name !== 'reglages' && route.name !== 'accueil' && route.name !== 'a-propos' && route.name !== 'guilde-reglages';
  let body;
  if (needsData && status === 'empty') body = <EmptyScreen />;
  else if (needsData && (!market.snapshot || !market.recipes))
    body = status === 'error' ? <ErrorScreen onRetry={market.reload} /> : <Skeleton />;
  else if (route.name === 'accueil') body = <HomePage />;
  else if (route.name === 'a-propos') body = <AboutPage />;
  else if (route.name === 'fermes') body = <FarmsPage />;
  else if (route.name === 'transport') body = <TransportPage />;
  else if (route.name === 'favoris') body = <FavoritesPage />;
  else if (route.name === 'investir' || route.name === 'guilde-investir') body = <InvestPage />;
  else if (route.name === 'guilde') body = <GuildDashboard />;
  else if (route.name === 'guilde-prets') body = <LoansPage />;
  else if (route.name === 'guilde-reglages') body = <GuildSettingsPage />;
  else if (route.name === 'craft') body = <TopCrafting />;
  else if (route.name === 'black-market') body = <BlackMarket />;
  else if (route.name === 'reglages') body = <SettingsPage />;
  else if (route.name === 'routes') body = <RouteBuilder shareCode={route.share ?? null} />;
  else if (route.name === 'item' && route.itemId) body = <ItemDetail id={route.itemId} />;
  else body = <TopRefining />;

  return (
    <AppDataContext.Provider value={data}>
      <a className="skip" href="#contenu">
        Aller au contenu
      </a>
      <Header
        current={route.name}
        ageMinutes={market.ageMinutes}
        theme={theme}
        onTheme={toggleTheme}
        mode={mode}
        onMode={toggleMode}
        guildName={guild.guildName}
      />
      {(status === 'stale' || status === 'error') && <LateBanner updatedAt={market.updatedAt} onRetry={market.reload} />}
      <Layout>
        <Suspense fallback={<Skeleton />}>{body}</Suspense>
      </Layout>
      <Footer />
    </AppDataContext.Provider>
  );
}
