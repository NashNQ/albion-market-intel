// Prêts sur gage de la guilde : localStorage sanitisé (100 prêts max), magasin partagé, lien de partage base64url.
import { useCallback, useSyncExternalStore } from 'react';
import type { KeyValueStorage } from './routesStore';

export const LOANS_KEY = 'ami.loans.v1';
export const MAX_LOANS = 100;
export const MAX_BORROWER = 40;
export const MAX_NOTE = 200;
export const MAX_LOAN_SILVER = 1e12;
export const MAX_QTY = 1_000_000;
export const MAX_RATE = 2;
export const LOAN_SHARE_PREFIX = '#/guilde/prets?l=';

export type LoanStatus = 'open' | 'repaid' | 'seized';
export const LOAN_STATUSES: readonly LoanStatus[] = ['open', 'repaid', 'seized'];

export interface Loan {
  id: string;
  /** Pseudo de l'emprunteur. */
  borrower: string;
  /** Objet mis en gage (ID API, ex. T6_PLANKS ou T5_MAIN_SWORD@1). */
  itemId: string;
  qty: number;
  /** Argent prêté (ag). */
  amount: number;
  /** Intérêt forfaitaire sur toute la durée (0,1 = 10 %). */
  rate: number;
  /** AAAA-MM-JJ (jour UTC). */
  startDate: string;
  /** Échéance convenue, AAAA-MM-JJ. */
  dueDate: string;
  status: LoanStatus;
  note?: string;
}

/** Forme partagée par lien : sans identifiant interne. */
export type SharedLoan = Omit<Loan, 'id'>;
export type NewLoan = Omit<Loan, 'id' | 'status'> & { status?: LoanStatus };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const ITEM_ID_RE = /^T\d_[A-Z0-9_]+(@\d)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
const clean = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max) : '';

export function isIsoDay(v: unknown): v is string {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const t = Date.parse(v + 'T00:00:00Z');
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
}

export function newLoanId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    /* repli */
  }
  return 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/** Valide une forme partagée ou stockée (sans id). null si inutilisable. */
export function sanitizeSharedLoan(raw: unknown): SharedLoan | null {
  if (!isObj(raw)) return null;
  if (typeof raw.itemId !== 'string' || !ITEM_ID_RE.test(raw.itemId)) return null;
  const qty = num(raw.qty, 1, MAX_QTY);
  const amount = num(raw.amount, 1, MAX_LOAN_SILVER);
  const rate = num(raw.rate, 0, MAX_RATE);
  if (qty == null || amount == null || rate == null) return null;
  if (!isIsoDay(raw.startDate) || !isIsoDay(raw.dueDate)) return null;
  const status = LOAN_STATUSES.includes(raw.status as LoanStatus) ? (raw.status as LoanStatus) : 'open';
  const out: SharedLoan = {
    borrower: clean(raw.borrower, MAX_BORROWER) || 'Emprunteur',
    itemId: raw.itemId,
    qty: Math.round(qty),
    amount: Math.round(amount),
    rate,
    startDate: raw.startDate,
    // Échéance avant le début : ramenée au jour du prêt.
    dueDate: raw.dueDate < raw.startDate ? raw.startDate : raw.dueDate,
    status,
  };
  const note = clean(raw.note, MAX_NOTE);
  if (note) out.note = note;
  return out;
}

export function sanitizeLoan(raw: unknown): Loan | null {
  const s = sanitizeSharedLoan(raw);
  if (!s || !isObj(raw)) return null;
  const id = typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(raw.id) ? raw.id : newLoanId();
  return { id, ...s };
}

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Lit les prêts ; entrées invalides ignorées, doublons d'id écartés, 100 au plus. Ne lève jamais. */
export function loadLoans(storage: KeyValueStorage | null = defaultStorage()): Loan[] {
  if (!storage) return [];
  try {
    const txt = storage.getItem(LOANS_KEY);
    if (!txt) return [];
    const data = JSON.parse(txt) as unknown;
    const arr = Array.isArray(data) ? data : isObj(data) && Array.isArray(data.items) ? (data.items as unknown[]) : [];
    const out: Loan[] = [];
    const ids = new Set<string>();
    for (const r of arr) {
      const l = sanitizeLoan(r);
      if (!l || ids.has(l.id)) continue;
      ids.add(l.id);
      out.push(l);
      if (out.length >= MAX_LOANS) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function saveLoans(list: Loan[], storage: KeyValueStorage | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(LOANS_KEY, JSON.stringify({ v: 1, items: list.slice(0, MAX_LOANS) }));
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

export function toSharedLoan(l: SharedLoan | Loan): SharedLoan {
  const out: SharedLoan = {
    borrower: l.borrower,
    itemId: l.itemId,
    qty: l.qty,
    amount: l.amount,
    rate: l.rate,
    startDate: l.startDate,
    dueDate: l.dueDate,
    status: l.status,
  };
  if (l.note) out.note = l.note;
  return out;
}

export const encodeLoan = (l: SharedLoan | Loan): string => b64urlEncode(JSON.stringify(toSharedLoan(l)));
export const loanShareUrl = (l: SharedLoan | Loan, base: string): string => base + LOAN_SHARE_PREFIX + encodeLoan(l);

export function decodeLoan(code: string): SharedLoan | null {
  try {
    if (code.length > 3000) return null;
    return sanitizeSharedLoan(JSON.parse(b64urlDecode(code)));
  } catch {
    return null;
  }
}

/** Code `l` d'un hash « #/guilde/prets?l=… » ; null si le hash ne pointe pas vers la page des prêts ou n'a pas de code. */
export function loanCodeFromHash(hash: string): string | null {
  const m = /^#?\/?guilde\/prets\?(.*)$/.exec(hash);
  if (!m) return null;
  return new URLSearchParams(m[1]).get('l');
}

// ---------------------------------------------------------------------------
// Magasin partagé + hook
// ---------------------------------------------------------------------------

let current: Loan[] | null = null;
let lastSaved = true;
const listeners = new Set<() => void>();

function snapshot(): Loan[] {
  if (!current) current = loadLoans();
  return current;
}
function savedSnapshot(): boolean {
  return lastSaved;
}

function commit(next: Loan[]) {
  current = next;
  lastSaved = saveLoans(next);
  for (const l of listeners) l();
}

function onStorage(e: StorageEvent) {
  if (e.key === null || e.key === LOANS_KEY) {
    current = loadLoans();
    for (const l of listeners) l();
  }
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  if (listeners.size === 1 && typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(l);
    if (listeners.size === 0 && typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}

/** Relit le stockage (tests, changement externe). */
export function reloadLoans(): void {
  current = loadLoans();
  lastSaved = true;
  for (const l of listeners) l();
}

const LIMITS_MSG =
  'Valeurs invalides : objet inconnu, quantité 1 à 1 000 000, montant 1 ag à 1 000 milliards d’ag, intérêt 0 à 200 %, dates AAAA-MM-JJ (échéance après le début).';

export interface UseLoans {
  loans: Loan[];
  /** Ajoute un prêt ; retourne le prêt enregistré ou un message d'erreur. */
  add: (l: NewLoan) => Loan | string;
  /** Modifie un prêt (champs revalidés) ; message d'erreur ou null. */
  update: (id: string, patch: Partial<Omit<Loan, 'id'>>) => string | null;
  remove: (id: string) => void;
  setStatus: (id: string, status: LoanStatus) => void;
  /** false si le dernier enregistrement a échoué (stockage indisponible ou plein). */
  saved: boolean;
}

export function addLoan(l: NewLoan): Loan | string {
  const list = snapshot();
  if (list.length >= MAX_LOANS) return `Limite atteinte : ${MAX_LOANS} prêts au maximum. Supprimez des prêts clos avant d’en ajouter.`;
  const raw = { ...l, id: newLoanId(), status: l.status ?? 'open' };
  const s = sanitizeLoan(raw);
  if (!s || s.dueDate !== raw.dueDate || s.qty !== raw.qty || s.amount !== Math.round(raw.amount)) return LIMITS_MSG;
  commit([...list, s]);
  return s;
}

export function updateLoan(id: string, patch: Partial<Omit<Loan, 'id'>>): string | null {
  const list = snapshot();
  const prev = list.find((x) => x.id === id);
  if (!prev) return 'Prêt introuvable.';
  const raw = { ...prev, ...patch, id };
  const s = sanitizeLoan(raw);
  if (!s || s.dueDate !== raw.dueDate || s.qty !== raw.qty) return LIMITS_MSG;
  commit(list.map((x) => (x.id === id ? s : x)));
  return null;
}

export function removeLoan(id: string): void {
  commit(snapshot().filter((x) => x.id !== id));
}

export function setLoanStatus(id: string, status: LoanStatus): void {
  if (!LOAN_STATUSES.includes(status)) return;
  commit(snapshot().map((x) => (x.id === id ? { ...x, status } : x)));
}

export function useLoans(): UseLoans {
  const loans = useSyncExternalStore(subscribe, snapshot, snapshot);
  const saved = useSyncExternalStore(subscribe, savedSnapshot, savedSnapshot);
  return {
    loans,
    add: useCallback((l: NewLoan) => addLoan(l), []),
    update: useCallback((id: string, p: Partial<Omit<Loan, 'id'>>) => updateLoan(id, p), []),
    remove: useCallback((id: string) => removeLoan(id), []),
    setStatus: useCallback((id: string, s: LoanStatus) => setLoanStatus(id, s), []),
    saved,
  };
}
