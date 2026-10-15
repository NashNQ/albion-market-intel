// Règles de la guilde (prêts sur gage, mode guilde) : localStorage sanitisé, partagé entre composants.
// Un seul magasin en mémoire (useSyncExternalStore) : modifier une règle dans un composant met à jour tous les autres.
import { useCallback, useSyncExternalStore } from 'react';
import type { KeyValueStorage } from './routesStore';

export const GUILD_KEY = 'ami.guild.v1';

export interface GuildSettings {
  /** Nom de la guilde (résumés Discord, en-têtes). */
  guildName: string;
  /** Rapport prêt / valeur de revente rapide maximal (0,6 = 60 %). */
  maxLtv: number;
  /** Intérêt forfaitaire par défaut d'un prêt (0,1 = 10 %). */
  defaultRate: number;
  /** Marge de sécurité retirée de la valeur prudente du gage (0,1 = 10 %). */
  safetyMargin: number;
  /** Durée maximale d'un prêt, en jours. */
  maxTermDays: number;
}

export const DEFAULT_GUILD_SETTINGS: GuildSettings = {
  guildName: 'Varwyn',
  maxLtv: 0.6,
  defaultRate: 0.1,
  safetyMargin: 0.1,
  maxTermDays: 14,
};

export const MAX_GUILD_NAME = 40;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, lo: number, hi: number, def: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : def;

/** Valide une forme quelconque (stockage corrompu, ancienne version) : chaque champ invalide reprend sa valeur par défaut. */
export function sanitizeGuildSettings(raw: unknown): GuildSettings {
  const d = DEFAULT_GUILD_SETTINGS;
  if (!isObj(raw)) return { ...d };
  const name = typeof raw.guildName === 'string' ? raw.guildName.replace(/[\r\n\t]+/g, ' ').trim().slice(0, MAX_GUILD_NAME) : '';
  return {
    guildName: name || d.guildName,
    maxLtv: num(raw.maxLtv, 0.05, 1, d.maxLtv),
    defaultRate: num(raw.defaultRate, 0, 2, d.defaultRate),
    safetyMargin: num(raw.safetyMargin, 0, 0.9, d.safetyMargin),
    maxTermDays: Math.round(num(raw.maxTermDays, 1, 90, d.maxTermDays)),
  };
}

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Lit les règles ; ne lève jamais. */
export function loadGuildSettings(storage: KeyValueStorage | null = defaultStorage()): GuildSettings {
  if (!storage) return { ...DEFAULT_GUILD_SETTINGS };
  try {
    const txt = storage.getItem(GUILD_KEY);
    return txt ? sanitizeGuildSettings(JSON.parse(txt)) : { ...DEFAULT_GUILD_SETTINGS };
  } catch {
    return { ...DEFAULT_GUILD_SETTINGS };
  }
}

export function saveGuildSettings(s: GuildSettings, storage: KeyValueStorage | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(GUILD_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Magasin partagé
// ---------------------------------------------------------------------------

let current: GuildSettings | null = null;
const listeners = new Set<() => void>();

function snapshot(): GuildSettings {
  if (!current) current = loadGuildSettings();
  return current;
}

function emit(next: GuildSettings) {
  current = next;
  for (const l of listeners) l();
}

function onStorage(e: StorageEvent) {
  if (e.key === null || e.key === GUILD_KEY) emit(loadGuildSettings());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  if (listeners.size === 1 && typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(l);
    if (listeners.size === 0 && typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}

/** Met à jour les règles (champ par champ, revalidé) et les enregistre. */
export function updateGuildSettings(patch: Partial<GuildSettings>): void {
  const next = sanitizeGuildSettings({ ...snapshot(), ...patch });
  saveGuildSettings(next);
  emit(next);
}

export function resetGuildSettings(): void {
  const next = { ...DEFAULT_GUILD_SETTINGS };
  saveGuildSettings(next);
  emit(next);
}

/** Relit le stockage (tests, changement externe). */
export function reloadGuildSettings(): void {
  emit(loadGuildSettings());
}

/** [règles, mettre à jour (patch), rétablir les valeurs par défaut]. */
export function useGuildSettings(): [GuildSettings, (patch: Partial<GuildSettings>) => void, () => void] {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);
  const update = useCallback((patch: Partial<GuildSettings>) => updateGuildSettings(patch), []);
  const reset = useCallback(() => resetGuildSettings(), []);
  return [s, update, reset];
}
