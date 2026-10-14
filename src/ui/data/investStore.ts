// Portefeuille d'investissements de la guilde : localStorage sanitisé, lien de partage base64url.
import { useCallback, useState } from 'react';
import type { KeyValueStorage } from './routesStore';

export const INVEST_KEY = 'ami.invest.v1';
export const MAX_INVESTMENTS = 50;
export const MAX_TEXT = 60;
export const MAX_SILVER = 1e12;
export const INVEST_SHARE_PREFIX = '#/investir?i=';

export interface SavedInvestment {
  v: 1;
  id: string;
  member: string;
  /** Recette financée : outputId (+ variant éventuel). */
  outputId: string;
  variant?: string;
  capital: number;
  levelingCost: number;
  investorShare: number;
  /** null = capacité = ventes vendables/jour (Q). */
  unitsPerDay: number | null;
  rotationDays: number;
  /** Date de début (AAAA-MM-JJ). */
  startDate: string;
  /** Profit et coût par unité au démarrage (pour comparer avec les prix du moment). */
  startUnitProfit: number | null;
  startUnitCost: number | null;
  createdAt: string;
}

/** Forme partagée par lien : sans identifiant interne. */
export type SharedInvestment = Omit<SavedInvestment, 'id' | 'createdAt'>;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const ID_RE = /^T\d_[A-Z0-9_]+(@\d)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
/** Date AAAA-MM-JJ réelle (refuse 2026-02-31, que Date.parse accepte en la décalant). */
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const t = Date.parse(v + 'T00:00:00Z');
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
}
const text = (v: unknown, def: string): string => (typeof v === 'string' ? v.trim().slice(0, MAX_TEXT) : def);

export function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function newInvestId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    /* repli */
  }
  return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/** Valide une forme partagée / stockée (sans id). null si inutilisable. */
export function sanitizeShared(raw: unknown): SharedInvestment | null {
  if (!isObj(raw) || raw.v !== 1) return null;
  if (typeof raw.outputId !== 'string' || !ID_RE.test(raw.outputId)) return null;
  const capital = num(raw.capital, 0, MAX_SILVER);
  if (capital == null) return null;
  const levelingCost = Math.min(capital, num(raw.levelingCost, 0, MAX_SILVER) ?? 0);
  const share = num(raw.investorShare, 0, 1) ?? 0.5;
  const out: SharedInvestment = {
    v: 1,
    member: text(raw.member, '') || 'Membre',
    outputId: raw.outputId,
    capital,
    levelingCost,
    investorShare: share,
    unitsPerDay: raw.unitsPerDay == null ? null : num(raw.unitsPerDay, 0, 1e7),
    rotationDays: num(raw.rotationDays, 0, 365) ?? 2,
    startDate: isIsoDate(raw.startDate) ? raw.startDate : todayIso(),
    startUnitProfit: raw.startUnitProfit == null ? null : num(raw.startUnitProfit, -MAX_SILVER, MAX_SILVER),
    startUnitCost: raw.startUnitCost == null ? null : num(raw.startUnitCost, 0, MAX_SILVER),
  };
  if (typeof raw.variant === 'string' && ID_RE.test(raw.variant)) out.variant = raw.variant;
  return out;
}

export function sanitizeInvestment(raw: unknown): SavedInvestment | null {
  const s = sanitizeShared(raw);
  if (!s || !isObj(raw)) return null;
  const id = typeof raw.id === 'string' && raw.id.length > 0 && raw.id.length <= 64 ? raw.id : newInvestId();
  const createdAt = typeof raw.createdAt === 'string' && !Number.isNaN(Date.parse(raw.createdAt)) ? raw.createdAt : new Date().toISOString();
  return { ...s, id, createdAt };
}

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Lit le portefeuille ; entrées invalides ignorées, doublons d'id écartés. Ne lève jamais. */
export function loadInvestments(storage: KeyValueStorage | null = defaultStorage()): SavedInvestment[] {
  if (!storage) return [];
  try {
    const txt = storage.getItem(INVEST_KEY);
    if (!txt) return [];
    const data = JSON.parse(txt) as unknown;
    const arr = Array.isArray(data) ? data : isObj(data) && Array.isArray(data.items) ? (data.items as unknown[]) : [];
    const out: SavedInvestment[] = [];
    const ids = new Set<string>();
    for (const r of arr) {
      const v = sanitizeInvestment(r);
      if (!v || ids.has(v.id)) continue;
      ids.add(v.id);
      out.push(v);
      if (out.length >= MAX_INVESTMENTS) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function saveInvestments(list: SavedInvestment[], storage: KeyValueStorage | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(INVEST_KEY, JSON.stringify({ v: 1, items: list.slice(0, MAX_INVESTMENTS) }));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Lien de partage
// ---------------------------------------------------------------------------

function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): string {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('invalide');
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export function toSharedInvestment(i: SharedInvestment | SavedInvestment): SharedInvestment {
  const out: SharedInvestment = {
    v: 1,
    member: i.member,
    outputId: i.outputId,
    capital: i.capital,
    levelingCost: i.levelingCost,
    investorShare: i.investorShare,
    unitsPerDay: i.unitsPerDay,
    rotationDays: i.rotationDays,
    startDate: i.startDate,
    startUnitProfit: i.startUnitProfit,
    startUnitCost: i.startUnitCost,
  };
  if (i.variant) out.variant = i.variant;
  return out;
}

export function encodeInvestment(i: SharedInvestment | SavedInvestment): string {
  return b64urlEncode(JSON.stringify(toSharedInvestment(i)));
}

export function investShareUrl(i: SharedInvestment | SavedInvestment, base: string): string {
  return base + INVEST_SHARE_PREFIX + encodeInvestment(i);
}

export function decodeInvestment(code: string): SharedInvestment | null {
  try {
    if (code.length > 4000) return null;
    return sanitizeShared(JSON.parse(b64urlDecode(code)));
  } catch {
    return null;
  }
}

/** Code `i` d'un hash « #/investir?i=… ». */
export function investCodeFromHash(hash: string): string | null {
  const m = /^#?\/?investir\?(.*)$/.exec(hash);
  if (!m) return null;
  return new URLSearchParams(m[1]).get('i');
}

/** Base des liens : origine + chemin, sans hash. */
export function shareBase(): string {
  try {
    return window.location.origin + window.location.pathname;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Hook React
// ---------------------------------------------------------------------------

export interface UseInvestments {
  items: SavedInvestment[];
  /** Ajoute ou remplace (par id). Retourne un message d'erreur ou null. */
  upsert: (i: SavedInvestment) => string | null;
  duplicate: (id: string) => string | null;
  remove: (id: string) => void;
  saved: boolean;
}

export function useInvestments(): UseInvestments {
  const [items, setItems] = useState<SavedInvestment[]>(() => loadInvestments());
  const [saved, setSaved] = useState(true);
  const commit = useCallback((next: SavedInvestment[]) => {
    setItems(next);
    setSaved(saveInvestments(next));
  }, []);
  const upsert = useCallback(
    (i: SavedInvestment) => {
      // Même validation qu'à la relecture : sinon l'entrée disparaîtrait (ou changerait) au prochain chargement.
      const clean = sanitizeInvestment(i);
      if (!clean || JSON.stringify(toSharedInvestment(clean)) !== JSON.stringify(toSharedInvestment(i)))
        return `Valeurs hors limites : capital jusqu’à 1 000 milliards d’ag, part 0 à 100 %, rotation 0 à 365 jours, capacité ≤ 10 millions d’unités/jour.`;
      const exists = items.some((x) => x.id === i.id);
      if (!exists && items.length >= MAX_INVESTMENTS)
        return `Limite atteinte : ${MAX_INVESTMENTS} investissements au maximum. Supprimez-en un avant d’en enregistrer un nouveau.`;
      commit(exists ? items.map((x) => (x.id === i.id ? i : x)) : [...items, i]);
      return null;
    },
    [items, commit],
  );
  const duplicate = useCallback(
    (id: string) => {
      const src = items.find((x) => x.id === id);
      if (!src) return 'Investissement introuvable.';
      if (items.length >= MAX_INVESTMENTS) return `Limite atteinte : ${MAX_INVESTMENTS} investissements au maximum.`;
      const copy: SavedInvestment = { ...src, id: newInvestId(), member: `${src.member} (copie)`.slice(0, MAX_TEXT), createdAt: new Date().toISOString() };
      commit([...items, copy]);
      return null;
    },
    [items, commit],
  );
  const remove = useCallback((id: string) => commit(items.filter((x) => x.id !== id)), [items, commit]);
  return { items, upsert, duplicate, remove, saved };
}
