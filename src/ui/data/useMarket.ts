import { useCallback, useEffect, useRef, useState } from 'react';
import type { MarketSnapshot, RecipesFile } from '../../types';
import { computeStatus, type MarketStatus } from './status';

export const MARKET_URL = '/data/market.json';
export const RECIPES_URL = '/data/recipes.json';
export const REFRESH_MS = 5 * 60_000;
const TICK_MS = 60_000; // rafraîchit âge/statut sans refetch

export interface UseMarket {
  snapshot: MarketSnapshot | null;
  recipes: RecipesFile | null;
  status: MarketStatus;
  updatedAt: Date | null;
  ageMinutes: number | null;
  reload: () => void;
}

class NotFoundError extends Error {}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (res.status === 404) throw new NotFoundError(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
  return (await res.json()) as T;
}

/** Écarte les entrées sans id et complète les champs manquants (prices, volumes…) par des objets vides. */
export function normalizeItems(items: unknown[]): MarketSnapshot['items'] {
  const out: MarketSnapshot['items'] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const it = raw as Partial<MarketSnapshot['items'][number]>;
    if (typeof it.id !== 'string' || it.id === '') continue;
    const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
    out.push({
      id: it.id,
      prices: obj(it.prices),
      volume7d: obj(it.volume7d),
      avgPrice7d: obj(it.avgPrice7d),
      historyDays: obj(it.historyDays),
    });
  }
  return out;
}

const parseDate =(iso: string | undefined | null): Date | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function useMarket(): UseMarket {
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [recipes, setRecipes] = useState<RecipesFile | null>(null);
  const [failed, setFailed] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const snapRef = useRef<MarketSnapshot | null>(null);
  const recipesRef = useRef<RecipesFile | null>(null);
  const recipesLoading = useRef(false);
  const alive = useRef(true);

  const loadRecipes = useCallback(async () => {
    if (recipesRef.current || recipesLoading.current) return;
    recipesLoading.current = true;
    try {
      const r = await getJson<RecipesFile>(RECIPES_URL);
      if (!alive.current) return;
      recipesRef.current = r;
      setRecipes(r);
    } catch {
      /* réessayé au prochain cycle */
    } finally {
      recipesLoading.current = false;
    }
  }, []);

  const loadMarket = useCallback(async () => {
    try {
      const s = await getJson<MarketSnapshot>(MARKET_URL);
      if (!alive.current) return;
      const incoming = parseDate(s?.updatedAt);
      if (!incoming || !Array.isArray(s.items)) throw new Error('market.json invalide');
      s.items = normalizeItems(s.items);
      const current = parseDate(snapRef.current?.updatedAt);
      // On ignore une réponse plus ancienne (ou identique) que la copie en mémoire.
      if (!current || incoming.getTime() > current.getTime()) {
        snapRef.current = s;
        setSnapshot(s);
      }
      setFailed(false);
      setNotFound(false);
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof NotFoundError && !snapRef.current) {
        setNotFound(true);
        setFailed(false);
      } else {
        setFailed(true);
      }
    } finally {
      if (alive.current) setNow(new Date());
    }
  }, []);

  const reload = useCallback(() => {
    void loadRecipes();
    void loadMarket();
  }, [loadRecipes, loadMarket]);

  useEffect(() => {
    alive.current = true;
    reload();
    const poll = setInterval(reload, REFRESH_MS);
    const tick = setInterval(() => setNow(new Date()), TICK_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive.current = false;
      clearInterval(poll);
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reload]);

  const updatedAt = parseDate(snapshot?.updatedAt);
  const ageMinutes = updatedAt ? Math.max(0, (now.getTime() - updatedAt.getTime()) / 60_000) : null;
  const status = computeStatus(updatedAt, now, failed, snapshot !== null, notFound);

  return { snapshot, recipes, status, updatedAt, ageMinutes, reload };
}
