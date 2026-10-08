// Sauvegarde des routes personnalisées : localStorage, export/import JSON, partage par URL.
import { useCallback, useState } from 'react';
import { LOCATIONS, PRODUCTION_LOCATIONS, type Location } from '../../types';
import type { FinalSpec, InputSource, SavedRoute, Step } from '../../engine/chain-index';

export const ROUTES_KEY = 'ami.routes.v1';
export const MAX_ROUTES = 20;
export const MAX_STEPS = 30;
export const MAX_NAME = 80;
export const MAX_SHARE_URL = 2000;
export const EXPORT_FORMAT = 'ami.routes';

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** Accès au stockage, injectable pour les tests. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Validation stricte du schéma
// ---------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const LOC_SET = new Set<string>(LOCATIONS);
const PROD_SET = new Set<string>(PRODUCTION_LOCATIONS);
const ID_RE = /^T\d_[A-Z0-9_]+(@\d)?$/;

class SchemaError extends Error {}
const fail = (msg: string): never => {
  throw new SchemaError(msg);
};

function parseSource(raw: unknown, where: string, stepIndex: number): InputSource {
  if (!isObj(raw)) fail(`${where} : source manquante.`);
  const r = raw as Record<string, unknown>;
  if (r.type === 'buy') {
    const at = r.at;
    if (at !== 'auto' && !(typeof at === 'string' && PROD_SET.has(at))) fail(`${where} : lieu d’achat invalide.`);
    const src: InputSource = { type: 'buy', at: at as Location | 'auto' };
    if (r.manualPrice !== undefined) {
      const mp = r.manualPrice;
      if (typeof mp !== 'number' || !Number.isFinite(mp) || mp <= 0 || mp > 1e9) fail(`${where} : prix manuel invalide.`);
      src.manualPrice = mp as number;
    }
    return src;
  }
  if (r.type === 'step') {
    const idx = r.index;
    if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= stepIndex)
      fail(`${where} : une source « étape » doit désigner une étape précédente.`);
    return { type: 'step', index: idx as number };
  }
  return fail(`${where} : type de source inconnu (attendu « buy » ou « step »).`);
}

function parseSteps(raw: unknown): Step[] {
  if (!Array.isArray(raw) || raw.length === 0) fail('La route doit contenir au moins une étape.');
  const arr = raw as unknown[];
  if (arr.length > MAX_STEPS) fail(`Une route ne peut pas dépasser ${MAX_STEPS} étapes.`);
  const steps: Step[] = [];
  arr.forEach((s, i) => {
    const where = `Étape ${i + 1}`;
    if (!isObj(s)) fail(`${where} : format invalide.`);
    const r = s as Record<string, unknown>;
    if (typeof r.outputId !== 'string' || !ID_RE.test(r.outputId)) fail(`${where} : identifiant d’objet invalide.`);
    if (r.craftAt !== 'auto' && !(typeof r.craftAt === 'string' && PROD_SET.has(r.craftAt))) fail(`${where} : lieu de production invalide.`);
    if (r.recipeVariant !== undefined && typeof r.recipeVariant !== 'string') fail(`${where} : variante de recette invalide.`);
    if (!Array.isArray(r.inputs)) fail(`${where} : liste d’ingrédients manquante.`);
    const inputs = (r.inputs as unknown[]).map((inp, k) => {
      const w = `${where}, ingrédient ${k + 1}`;
      if (!isObj(inp)) fail(`${w} : format invalide.`);
      const ir = inp as Record<string, unknown>;
      if (typeof ir.id !== 'string' || !ID_RE.test(ir.id)) fail(`${w} : identifiant d’objet invalide.`);
      const source = parseSource(ir.source, w, i);
      if (source.type === 'step' && steps[source.index].outputId !== ir.id)
        fail(`${w} : l’étape ${source.index + 1} ne produit pas ${ir.id}.`);
      return { id: ir.id as string, source };
    });
    const step: Step = { outputId: r.outputId as string, craftAt: r.craftAt as Location | 'auto', inputs };
    if (typeof r.recipeVariant === 'string') step.recipeVariant = r.recipeVariant;
    steps.push(step);
  });
  return steps;
}

function parseFinal(raw: unknown): FinalSpec {
  if (!isObj(raw)) fail('Paramètres de vente finale manquants.');
  const r = raw as Record<string, unknown>;
  if (r.sellAt !== 'auto' && !(typeof r.sellAt === 'string' && LOC_SET.has(r.sellAt))) fail('Lieu de vente invalide.');
  if (typeof r.qty !== 'number' || !Number.isFinite(r.qty) || r.qty <= 0 || r.qty > 1e7) fail('Quantité invalide (nombre positif attendu).');
  if (r.qtyMode !== 'final' && r.qtyMode !== 'start') fail('Mode de quantité invalide (« final » ou « start »).');
  const final: FinalSpec = { sellAt: r.sellAt as Location | 'auto', qty: r.qty as number, qtyMode: r.qtyMode as 'final' | 'start' };
  if (r.manualSellPrice !== undefined) {
    const mp = r.manualSellPrice;
    if (typeof mp !== 'number' || !Number.isFinite(mp) || mp <= 0 || mp > 1e9) fail('Prix de vente manuel invalide.');
    final.manualSellPrice = mp as number;
  }
  return final;
}

function parseName(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '') fail('Le nom de la route est obligatoire.');
  const name = (raw as string).trim();
  if (name.length > MAX_NAME) fail(`Le nom de la route ne peut pas dépasser ${MAX_NAME} caractères.`);
  return name;
}

const isIsoDate = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));

/** Valide une route complète (sauvegarde ou import). */
export function validateRoute(raw: unknown): Result<SavedRoute> {
  try {
    if (!isObj(raw)) fail('Route invalide : objet attendu.');
    const r = raw as Record<string, unknown>;
    if (r.v !== 1) fail('Version de route non prise en charge (v: 1 attendu).');
    if (typeof r.id !== 'string' || r.id === '' || r.id.length > 64) fail('Identifiant de route invalide.');
    const name = parseName(r.name);
    if (!isIsoDate(r.createdAt) || !isIsoDate(r.updatedAt)) fail('Dates de création ou de modification invalides.');
    const steps = parseSteps(r.steps);
    const final = parseFinal(r.final);
    return {
      ok: true,
      value: { v: 1, id: r.id as string, name, createdAt: r.createdAt as string, updatedAt: r.updatedAt as string, steps, final },
    };
  } catch (e) {
    return { ok: false, error: e instanceof SchemaError ? e.message : 'Route invalide.' };
  }
}

// ---------------------------------------------------------------------------
// Création / identifiants
// ---------------------------------------------------------------------------

export function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    /* repli ci-dessous */
  }
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function makeRoute(name: string, steps: Step[], final: FinalSpec, now = new Date()): SavedRoute {
  const iso = now.toISOString();
  return { v: 1, id: newId(), name, createdAt: iso, updatedAt: iso, steps, final };
}

// ---------------------------------------------------------------------------
// localStorage
// ---------------------------------------------------------------------------

/** Lit les routes enregistrées ; les entrées invalides sont ignorées. Ne lève jamais. */
export function loadRoutes(storage: KeyValueStorage | null = defaultStorage()): SavedRoute[] {
  if (!storage) return [];
  try {
    const txt = storage.getItem(ROUTES_KEY);
    if (!txt) return [];
    const data = JSON.parse(txt) as unknown;
    const arr = Array.isArray(data) ? data : isObj(data) && Array.isArray(data.routes) ? (data.routes as unknown[]) : [];
    const out: SavedRoute[] = [];
    for (const r of arr) {
      const v = validateRoute(r);
      if (v.ok && !out.some((x) => x.id === v.value.id)) out.push(v.value);
    }
    return out.slice(0, MAX_ROUTES);
  } catch {
    return [];
  }
}

/** Écrit la liste complète. */
export function writeRoutes(routes: SavedRoute[], storage: KeyValueStorage | null = defaultStorage()): Result<SavedRoute[]> {
  if (routes.length > MAX_ROUTES)
    return { ok: false, error: `Limite atteinte : ${MAX_ROUTES} routes au maximum. Supprimez une route avant d’en enregistrer une nouvelle.` };
  if (!storage) return { ok: false, error: 'Le stockage du navigateur est indisponible : la route n’a pas été enregistrée.' };
  try {
    storage.setItem(ROUTES_KEY, JSON.stringify(routes));
    return { ok: true, value: routes };
  } catch {
    return { ok: false, error: 'Impossible d’enregistrer dans ce navigateur (stockage plein ou désactivé).' };
  }
}

/** Ajoute ou met à jour une route (par id). */
export function upsertRoute(list: SavedRoute[], route: SavedRoute, storage?: KeyValueStorage | null): Result<SavedRoute[]> {
  const v = validateRoute(route);
  if (!v.ok) return v;
  const exists = list.some((r) => r.id === route.id);
  if (!exists && list.length >= MAX_ROUTES)
    return { ok: false, error: `Limite atteinte : ${MAX_ROUTES} routes au maximum. Supprimez une route avant d’en enregistrer une nouvelle.` };
  const next = exists ? list.map((r) => (r.id === route.id ? v.value : r)) : [...list, v.value];
  return writeRoutes(next, storage === undefined ? defaultStorage() : storage);
}

export function renameRoute(list: SavedRoute[], id: string, name: string, storage?: KeyValueStorage | null, now = new Date()): Result<SavedRoute[]> {
  const r = list.find((x) => x.id === id);
  if (!r) return { ok: false, error: 'Route introuvable.' };
  return upsertRoute(list, { ...r, name: name.trim(), updatedAt: now.toISOString() }, storage);
}

export function duplicateRoute(list: SavedRoute[], id: string, storage?: KeyValueStorage | null, now = new Date()): Result<SavedRoute[]> {
  const r = list.find((x) => x.id === id);
  if (!r) return { ok: false, error: 'Route introuvable.' };
  const copyName = `${r.name} (copie)`.slice(0, MAX_NAME);
  const copy = makeRoute(copyName, structuredCloneSafe(r.steps), { ...r.final }, now);
  return upsertRoute(list, copy, storage);
}

export function deleteRoute(list: SavedRoute[], id: string, storage?: KeyValueStorage | null): Result<SavedRoute[]> {
  return writeRoutes(
    list.filter((r) => r.id !== id),
    storage === undefined ? defaultStorage() : storage,
  );
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ---------------------------------------------------------------------------
// Export / import JSON
// ---------------------------------------------------------------------------

export function exportJson(routes: SavedRoute[]): string {
  return JSON.stringify({ format: EXPORT_FORMAT, v: 1, exportedAt: new Date().toISOString(), routes }, null, 2);
}

/** Importe un fichier JSON (export complet, liste ou route seule). Rejette tout le fichier si une route est invalide. */
export function importJson(text: string): Result<SavedRoute[]> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Fichier illisible : ce n’est pas du JSON valide.' };
  }
  let arr: unknown[];
  if (Array.isArray(data)) arr = data;
  else if (isObj(data) && Array.isArray(data.routes)) {
    if (data.format !== undefined && data.format !== EXPORT_FORMAT) return { ok: false, error: 'Format de fichier inconnu.' };
    arr = data.routes as unknown[];
  } else if (isObj(data) && 'steps' in data) arr = [data];
  else return { ok: false, error: 'Aucune route trouvée dans ce fichier.' };
  if (arr.length === 0) return { ok: false, error: 'Aucune route trouvée dans ce fichier.' };
  if (arr.length > MAX_ROUTES) return { ok: false, error: `Le fichier contient plus de ${MAX_ROUTES} routes.` };
  const out: SavedRoute[] = [];
  for (let i = 0; i < arr.length; i++) {
    const v = validateRoute(arr[i]);
    if (!v.ok) return { ok: false, error: `Route ${i + 1} : ${v.error}` };
    out.push(v.value);
  }
  return { ok: true, value: out };
}

/** Fusionne des routes importées : nouvel id si l'id existe déjà ; refus si la limite serait dépassée. */
export function mergeImported(list: SavedRoute[], imported: SavedRoute[], storage?: KeyValueStorage | null): Result<SavedRoute[]> {
  if (list.length + imported.length > MAX_ROUTES)
    return {
      ok: false,
      error: `Import impossible : ${list.length} + ${imported.length} routes dépasseraient la limite de ${MAX_ROUTES}.`,
    };
  const ids = new Set(list.map((r) => r.id));
  const next = [...list];
  for (const r of imported) {
    const route = ids.has(r.id) ? { ...r, id: newId() } : r;
    ids.add(route.id);
    next.push(route);
  }
  return writeRoutes(next, storage === undefined ? defaultStorage() : storage);
}

/** Télécharge un texte JSON comme fichier (navigateur seulement). */
export function downloadJson(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const fileSlug = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'route';

// ---------------------------------------------------------------------------
// Partage par URL
// ---------------------------------------------------------------------------

/** Forme partagée : sans prix (manuels) ni identifiants/dates internes. */
export interface SharedRoute {
  v: 1;
  name: string;
  steps: Step[];
  final: FinalSpec;
}

export function toShared(route: Pick<SavedRoute, 'name' | 'steps' | 'final'>): SharedRoute {
  return {
    v: 1,
    name: route.name,
    steps: route.steps.map((s) => {
      const out: Step = {
        outputId: s.outputId,
        craftAt: s.craftAt,
        inputs: s.inputs.map((i) => ({
          id: i.id,
          source: i.source.type === 'buy' ? { type: 'buy', at: i.source.at } : { type: 'step', index: i.source.index },
        })),
      };
      if (s.recipeVariant !== undefined) out.recipeVariant = s.recipeVariant;
      return out;
    }),
    final: { sellAt: route.final.sellAt, qty: route.final.qty, qtyMode: route.final.qtyMode },
  };
}

function b64urlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): string {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new SchemaError('Lien de partage invalide.');
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export const SHARE_PREFIX = '#/routes?r=';

/** Code base64url de la forme partagée. */
export function encodeShare(route: Pick<SavedRoute, 'name' | 'steps' | 'final'>): string {
  return b64urlEncode(JSON.stringify(toShared(route)));
}

/** Lien complet (origine + chemin + hash) ou erreur si l'URL dépasse 2 000 caractères. */
export function shareUrl(route: Pick<SavedRoute, 'name' | 'steps' | 'final'>, base: string): Result<string> {
  const url = base + SHARE_PREFIX + encodeShare(route);
  if (url.length > MAX_SHARE_URL)
    return { ok: false, error: `Route trop longue pour un lien de partage (${url.length} caractères, ${MAX_SHARE_URL} au maximum). Utilisez l’export JSON.` };
  return { ok: true, value: url };
}

export function decodeShare(code: string): Result<SharedRoute> {
  try {
    if (code.length > MAX_SHARE_URL) fail('Lien de partage trop long.');
    const data = JSON.parse(b64urlDecode(code)) as unknown;
    if (!isObj(data)) fail('Lien de partage invalide.');
    const d = data as Record<string, unknown>;
    if (d.v !== 1) fail('Version de route non prise en charge.');
    const name = parseName(d.name);
    const steps = parseSteps(d.steps);
    const final = parseFinal(d.final);
    return { ok: true, value: toShared({ name, steps, final }) };
  } catch (e) {
    return { ok: false, error: e instanceof SchemaError ? e.message : 'Lien de partage illisible.' };
  }
}

/** Extrait le code `r` d'un hash « #/routes?r=… ». */
export function shareCodeFromHash(hash: string): string | null {
  const m = /^#?\/?routes\?(.*)$/.exec(hash);
  if (!m) return null;
  const params = new URLSearchParams(m[1]);
  return params.get('r');
}

// ---------------------------------------------------------------------------
// Hook React
// ---------------------------------------------------------------------------

export interface UseRoutes {
  routes: SavedRoute[];
  save: (r: SavedRoute) => Result<SavedRoute[]>;
  rename: (id: string, name: string) => Result<SavedRoute[]>;
  duplicate: (id: string) => Result<SavedRoute[]>;
  remove: (id: string) => Result<SavedRoute[]>;
  importMany: (rs: SavedRoute[]) => Result<SavedRoute[]>;
}

export function useRoutes(): UseRoutes {
  const [routes, setRoutes] = useState<SavedRoute[]>(() => loadRoutes());
  const apply = useCallback((res: Result<SavedRoute[]>) => {
    if (res.ok) setRoutes(res.value);
    return res;
  }, []);
  return {
    routes,
    save: (r) => apply(upsertRoute(routes, r)),
    rename: (id, name) => apply(renameRoute(routes, id, name)),
    duplicate: (id) => apply(duplicateRoute(routes, id)),
    remove: (id) => apply(deleteRoute(routes, id)),
    importMany: (rs) => apply(mergeImported(routes, rs)),
  };
}
