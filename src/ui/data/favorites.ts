// Favoris : objets suivis par l'utilisateur, stockés dans localStorage.
// Un seul magasin partagé (useSyncExternalStore) : toutes les étoiles et la page Favoris se mettent à jour ensemble.
import { useCallback, useSyncExternalStore } from 'react';

export const FAVORITES_KEY = 'ami.favorites.v1';
export const MAX_FAVORITES = 200;
const MAX_ID_LEN = 120;
const ID_RE = /^[A-Za-z0-9_@\-.]+$/;

/** Liste propre : chaînes valides, sans doublon, 200 au plus (les plus récentes d'abord). */
export function sanitizeFavorites(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const id = v.trim();
    if (!id || id.length > MAX_ID_LEN || !ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_FAVORITES) break;
  }
  return out;
}

function read(): string[] {
  try {
    const txt = window.localStorage.getItem(FAVORITES_KEY);
    return sanitizeFavorites(txt ? JSON.parse(txt) : []);
  } catch {
    return [];
  }
}

function write(ids: string[]): void {
  try {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids));
  } catch {
    /* stockage indisponible : favoris en mémoire seulement */
  }
}

let current: string[] | null = null;
const listeners = new Set<() => void>();

function snapshot(): string[] {
  if (current === null) current = typeof window === 'undefined' ? [] : read();
  return current;
}

function commit(next: string[]): void {
  current = next;
  write(next);
  for (const l of listeners) l();
}

function onStorage(e: StorageEvent): void {
  if (e.key !== null && e.key !== FAVORITES_KEY) return;
  current = read();
  for (const l of listeners) l();
}

export function subscribeFavorites(cb: () => void): () => void {
  listeners.add(cb);
  if (listeners.size === 1 && typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}

export const getFavorites = (): string[] => snapshot();
export const isFavorite = (id: string): boolean => snapshot().includes(id);

/** Ajoute en tête. Retourne false si l'identifiant est invalide ou si la limite est atteinte. */
export function addFavorite(id: string): boolean {
  const list = snapshot();
  if (list.includes(id)) return true;
  if (list.length >= MAX_FAVORITES) return false;
  const next = sanitizeFavorites([id, ...list]);
  if (!next.includes(id)) return false;
  commit(next);
  return true;
}

export function removeFavorite(id: string): void {
  const list = snapshot();
  if (!list.includes(id)) return;
  commit(list.filter((x) => x !== id));
}

/** Bascule ; retourne le nouvel état (true = favori). */
export function toggleFavorite(id: string): boolean {
  if (isFavorite(id)) {
    removeFavorite(id);
    return false;
  }
  return addFavorite(id);
}

/** Relit le stockage (tests, changement externe). */
export function reloadFavorites(): void {
  current = typeof window === 'undefined' ? [] : read();
  for (const l of listeners) l();
}

const EMPTY: string[] = [];

export interface UseFavorites {
  ids: string[];
  has: (id: string) => boolean;
  toggle: (id: string) => boolean;
  add: (id: string) => boolean;
  remove: (id: string) => void;
  full: boolean;
}

export function useFavorites(): UseFavorites {
  const ids = useSyncExternalStore(subscribeFavorites, snapshot, () => EMPTY);
  const has = useCallback((id: string) => ids.includes(id), [ids]);
  return { ids, has, toggle: toggleFavorite, add: addFavorite, remove: removeFavorite, full: ids.length >= MAX_FAVORITES };
}
