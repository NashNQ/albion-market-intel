import { describe, expect, it } from 'vitest';
import {
  MAX_ROUTES,
  MAX_SHARE_URL,
  ROUTES_KEY,
  decodeShare,
  deleteRoute,
  duplicateRoute,
  encodeShare,
  exportJson,
  importJson,
  loadRoutes,
  makeRoute,
  mergeImported,
  renameRoute,
  shareCodeFromHash,
  shareUrl,
  toShared,
  upsertRoute,
  validateRoute,
  type KeyValueStorage,
} from '../src/ui/data/routesStore';
import type { SavedRoute, Step } from '../src/engine/chain-index';

class MemStorage implements KeyValueStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}
const throwing: KeyValueStorage = {
  getItem() {
    throw new Error('SecurityError');
  },
  setItem() {
    throw new Error('QuotaExceededError');
  },
};

const STEPS: Step[] = [
  { outputId: 'T2_PLANKS', craftAt: 'auto', inputs: [{ id: 'T2_WOOD', source: { type: 'buy', at: 'auto', manualPrice: 12 } }] },
  {
    outputId: 'T3_PLANKS',
    craftAt: 'Fort Sterling',
    inputs: [
      { id: 'T3_WOOD', source: { type: 'buy', at: 'Lymhurst' } },
      { id: 'T2_PLANKS', source: { type: 'step', index: 0 } },
    ],
  },
];
const mk = (name = 'Bois T2→T3'): SavedRoute => makeRoute(name, STEPS, { sellAt: 'auto', qty: 100, qtyMode: 'final' });

describe('stockage local', () => {
  it('sauvegarde puis relit la route à l’identique', () => {
    const st = new MemStorage();
    const r = mk();
    const res = upsertRoute([], r, st);
    expect(res.ok).toBe(true);
    expect(JSON.parse(st.getItem(ROUTES_KEY)!)).toHaveLength(1);
    expect(loadRoutes(st)).toEqual([r]);
  });

  it('mise à jour par id, renommer, dupliquer, supprimer', () => {
    const st = new MemStorage();
    const r = mk();
    let list = (upsertRoute([], r, st) as { ok: true; value: SavedRoute[] }).value;
    list = (upsertRoute(list, { ...r, final: { ...r.final, qty: 5 } }, st) as { ok: true; value: SavedRoute[] }).value;
    expect(list).toHaveLength(1);
    expect(list[0].final.qty).toBe(5);
    const ren = renameRoute(list, r.id, '  Nouveau nom ', st);
    expect(ren.ok && ren.value[0].name).toBe('Nouveau nom');
    const dup = duplicateRoute(ren.ok ? ren.value : [], r.id, st);
    expect(dup.ok && dup.value.map((x) => x.name)).toEqual(['Nouveau nom', 'Nouveau nom (copie)']);
    expect(dup.ok && dup.value[0].id !== dup.value[1].id).toBe(true);
    const del = deleteRoute(dup.ok ? dup.value : [], r.id, st);
    expect(del.ok && del.value.map((x) => x.name)).toEqual(['Nouveau nom (copie)']);
    expect(loadRoutes(st)).toHaveLength(1);
  });

  it('limite de 20 routes : refus clair au-delà', () => {
    const st = new MemStorage();
    let list: SavedRoute[] = [];
    for (let i = 0; i < MAX_ROUTES; i++) {
      const res = upsertRoute(list, mk(`Route ${i}`), st);
      expect(res.ok).toBe(true);
      if (res.ok) list = res.value;
    }
    const over = upsertRoute(list, mk('Une de trop'), st);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error).toMatch(/20 routes au maximum/);
    expect(loadRoutes(st)).toHaveLength(20);
    // une mise à jour reste possible à la limite
    expect(upsertRoute(list, { ...list[0], name: 'Modifiée' }, st).ok).toBe(true);
  });

  it('localStorage qui lève une exception : lecture vide, écriture refusée sans planter', () => {
    expect(loadRoutes(throwing)).toEqual([]);
    const res = upsertRoute([], mk(), throwing);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Impossible d’enregistrer/);
    expect(upsertRoute([], mk(), null).ok).toBe(false);
  });

  it('ignore le contenu corrompu', () => {
    const st = new MemStorage();
    st.setItem(ROUTES_KEY, '{pas du json');
    expect(loadRoutes(st)).toEqual([]);
    st.setItem(ROUTES_KEY, JSON.stringify([mk(), { v: 2 }]));
    expect(loadRoutes(st)).toHaveLength(1);
  });
});

describe('validation, export et import', () => {
  it('validation stricte avec messages en français', () => {
    const r = mk();
    expect(validateRoute(r).ok).toBe(true);
    const bad = (patch: object) => {
      const v = validateRoute({ ...r, ...patch });
      return v.ok ? '' : v.error;
    };
    expect(bad({ v: 2 })).toMatch(/Version/);
    expect(bad({ name: '' })).toMatch(/nom/);
    expect(bad({ steps: [] })).toMatch(/au moins une étape/);
    expect(bad({ final: { sellAt: 'Paris', qty: 1, qtyMode: 'final' } })).toMatch(/Lieu de vente/);
    expect(bad({ final: { sellAt: 'auto', qty: -1, qtyMode: 'final' } })).toMatch(/Quantité/);
    const forward = JSON.parse(JSON.stringify(r));
    forward.steps[0].inputs[0].source = { type: 'step', index: 1 };
    expect(validateRoute(forward).ok).toBe(false);
    const wrongItem = JSON.parse(JSON.stringify(r));
    wrongItem.steps[1].inputs[1].id = 'T2_WOOD';
    const v = validateRoute(wrongItem);
    expect(!v.ok && v.error).toMatch(/ne produit pas/);
    const bmCraft = JSON.parse(JSON.stringify(r));
    bmCraft.steps[0].craftAt = 'Black Market';
    expect(validateRoute(bmCraft).ok).toBe(false);
  });

  it('export puis import : aller-retour identique', () => {
    const routes = [mk('A'), mk('B')];
    const res = importJson(exportJson(routes));
    expect(res.ok && res.value).toEqual(routes);
  });

  it('JSON invalide rejeté', () => {
    const a = importJson('pas du json');
    expect(!a.ok && a.error).toMatch(/JSON valide/);
    const b = importJson(JSON.stringify({ routes: [{ ...mk(), steps: 'x' }] }));
    expect(!b.ok && b.error).toMatch(/^Route 1 :/);
    expect(importJson('{}').ok).toBe(false);
    expect(importJson(JSON.stringify({ format: 'autre', routes: [mk()] })).ok).toBe(false);
  });

  it('fusion d’import : nouvel id en cas de doublon, limite respectée', () => {
    const st = new MemStorage();
    const r = mk();
    const m = mergeImported([r], [r], st);
    expect(m.ok && m.value).toHaveLength(2);
    expect(m.ok && m.value[0].id !== m.value[1].id).toBe(true);
    const many = Array.from({ length: 20 }, (_, i) => mk(`R${i}`));
    expect(mergeImported([r], many, st).ok).toBe(false);
  });
});

describe('partage par URL', () => {
  it('encodage / décodage : aller-retour identique (sans prix ni ids)', () => {
    const r = mk('Bois — été « 2026 »');
    const code = encodeShare(r);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    const back = decodeShare(code);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.value).toEqual(toShared(r));
    expect(JSON.stringify(back.value)).not.toMatch(/manualPrice|createdAt|"id":"[0-9a-f-]{20,}"/);
    expect((back.value.steps[0].inputs[0].source as { manualPrice?: number }).manualPrice).toBeUndefined();
    // ré-encodage stable
    expect(encodeShare({ ...back.value })).toBe(code);
  });

  it('lien complet, lecture du hash et limite de 2 000 caractères', () => {
    const r = mk();
    const u = shareUrl(r, 'https://exemple.netlify.app/');
    expect(u.ok).toBe(true);
    if (!u.ok) return;
    const hash = u.value.slice(u.value.indexOf('#'));
    expect(shareCodeFromHash(hash)).toBe(encodeShare(r));
    expect(shareCodeFromHash('#/routes')).toBeNull();
    const long = makeRoute('x', Array.from({ length: 30 }, () => STEPS[0]), r.final);
    const lu = shareUrl(long, 'https://exemple.netlify.app/');
    expect(lu.ok).toBe(false);
    if (!lu.ok) expect(lu.error).toMatch(new RegExp(`${MAX_SHARE_URL}`.replace(/(\d)(\d{3})$/, '$1 ?$2')));
  });

  it('lien corrompu rejeté', () => {
    expect(decodeShare('!!!').ok).toBe(false);
    expect(decodeShare('e30').ok).toBe(false); // "{}"
  });
});
