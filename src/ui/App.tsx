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

// Pages lourdes chargées à la demande (graphiques, fermes, transport…).
const RouteBuilder = lazy(() => import('./pages/RouteBuilder').then((m) => ({ default: m.RouteBuilder })));
const AboutPage = lazy(() => import('./pages/About').then((m) => ({ default: m.AboutPage })));
const FarmsPage = lazy(() => import('./pages/Farms').then((m) => ({ default: m.FarmsPage })));
const TransportPage = lazy(() => import('./pages/Transport').then((m) => ({ default: m.TransportPage })));
const FavoritesPage = lazy(() => import('./pages/Favorites').then((m) => ({ default: m.FavoritesPage })));
const ItemDetail = lazy(() => import('./pages/ItemDetail').then((m) => ({ default: m.ItemDetail })));

export interface ParsedRoute {
  name: RouteName;
  itemId?: string;
  /** Code de route partagée (#/routes?r=…). */
  share?: string;
}

export function parseHash(hash: string): ParsedRoute {
  const h = hash.replace(/^#\/?/, '');
  if (h === 'routes' || h.startsWith('routes?') || h.startsWith('routes/')) {
    const share = shareCodeFromHash('#/' + h);
    return share ? { name: 'routes', share } : { name: 'routes' };
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

function useHashRoute(): ParsedRoute {
  const [route, setRoute] = useState(() => parseHash(typeof window === 'undefined' ? '' : window.location.hash));
  useEffect(() => {
    const on = () => {
      setRoute(parseHash(window.location.hash));
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
  const needsData = route.name !== 'reglages' && route.name !== 'accueil' && route.name !== 'a-propos';
  let body;
  if (needsData && status === 'empty') body = <EmptyScreen />;
  else if (needsData && (!market.snapshot || !market.recipes))
    body = status === 'error' ? <ErrorScreen onRetry={market.reload} /> : <Skeleton />;
  else if (route.name === 'accueil') body = <HomePage />;
  else if (route.name === 'a-propos') body = <AboutPage />;
  else if (route.name === 'fermes') body = <FarmsPage />;
  else if (route.name === 'transport') body = <TransportPage />;
  else if (route.name === 'favoris') body = <FavoritesPage />;
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
      <Header current={route.name} ageMinutes={market.ageMinutes} theme={theme} onTheme={toggleTheme} />
      {(status === 'stale' || status === 'error') && <LateBanner updatedAt={market.updatedAt} onRetry={market.reload} />}
      <Layout>
        <Suspense fallback={<Skeleton />}>{body}</Suspense>
      </Layout>
      <Footer />
    </AppDataContext.Provider>
  );
}
