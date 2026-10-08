// Page « Mes routes » : constructeur de routes personnalisées en chaîne.
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildPriceIndex } from '../../engine';
import {
  SELL_CHOICES,
  computeChain,
  recipeLookup,
  stepFromRecipe,
  type ChainContext,
  type ChainResult,
  type FinalSpec,
  type SavedRoute,
  type Step,
} from '../../engine/chain-index';
import type { Location } from '../../types';
import { useAppData } from '../context';
import {
  decodeShare,
  downloadJson,
  exportJson,
  fileSlug,
  importJson,
  makeRoute,
  shareUrl,
  useRoutes,
  type SharedRoute,
} from '../data/routesStore';
import { AddStep } from '../components/route-builder/AddStep';
import { PresetBar, presetName } from '../components/route-builder/PresetBar';
import { RouteList } from '../components/route-builder/RouteList';
import { StepCard } from '../components/route-builder/StepCard';
import { Summary } from '../components/route-builder/Summary';
import '../route-builder.css';

interface Draft {
  id: string | null;
  name: string;
  steps: Step[];
  final: FinalSpec;
  createdAt?: string;
}

const EMPTY_DRAFT: Draft = { id: null, name: 'Nouvelle route', steps: [], final: { sellAt: 'auto', qty: 100, qtyMode: 'final' } };

type Notice = { tone: 'ok' | 'error'; text: string } | null;

export function RouteBuilder({ shareCode }: { shareCode?: string | null }) {
  const { snapshot, recipes, settings, now } = useAppData();
  const store = useRoutes();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [notice, setNotice] = useState<Notice>(null);
  const [shared, setShared] = useState<{ route: SharedRoute } | { error: string } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Route partagée par URL.
  useEffect(() => {
    if (!shareCode) {
      setShared(null);
      return;
    }
    const d = decodeShare(shareCode);
    if (d.ok) {
      setShared({ route: d.value });
      setDraft({ id: null, name: d.value.name, steps: d.value.steps, final: d.value.final });
    } else setShared({ error: d.error });
  }, [shareCode]);

  // Contexte de calcul : prix ancrés sur la dernière collecte (+30 min), comme les classements.
  const ctx: ChainContext | null = useMemo(() => {
    if (!snapshot || !recipes) return null;
    const anchor = Date.parse(snapshot.updatedAt);
    const evalNow = new Date(Number.isFinite(anchor) ? Math.min(now.getTime(), anchor + 30 * 60_000) : now.getTime());
    return { recipes, settings, now: evalNow, index: buildPriceIndex(snapshot, settings, evalNow) };
  }, [snapshot, recipes, settings, now]);

  const result = useMemo(() => (ctx ? computeChain({ steps: draft.steps, final: draft.final }, ctx) : null), [ctx, draft.steps, draft.final]);

  const listResults = useMemo(() => {
    const m = new Map<string, ChainResult>();
    if (ctx) for (const r of store.routes) m.set(r.id, computeChain(r, ctx));
    return m;
  }, [ctx, store.routes]);

  if (!recipes || !ctx || !result) return null;
  const lookup = recipeLookup(recipes);

  const setSteps = (steps: Step[]) => setDraft((d) => ({ ...d, steps }));
  const setFinal = (patch: Partial<FinalSpec>) => setDraft((d) => ({ ...d, final: { ...d.final, ...patch } }));
  const flash = (n: Notice) => {
    setNotice(n);
    setLink(null);
  };

  const save = () => {
    if (draft.steps.length === 0) return flash({ tone: 'error', text: 'Ajoutez au moins une étape avant d’enregistrer.' });
    const nowIso = new Date().toISOString();
    const base: SavedRoute = draft.id
      ? { v: 1, id: draft.id, name: draft.name.trim() || 'Route sans nom', createdAt: draft.createdAt ?? nowIso, updatedAt: nowIso, steps: draft.steps, final: draft.final }
      : makeRoute(draft.name.trim() || 'Route sans nom', draft.steps, draft.final);
    const res = store.save(base);
    if (!res.ok) return flash({ tone: 'error', text: res.error });
    setDraft({ id: base.id, name: base.name, steps: base.steps, final: base.final, createdAt: base.createdAt });
    setShared(null);
    flash({ tone: 'ok', text: `Route « ${base.name} » enregistrée.` });
  };

  const share = () => {
    if (draft.steps.length === 0) return flash({ tone: 'error', text: 'Rien à partager : la route est vide.' });
    const base = `${window.location.origin}${window.location.pathname}`;
    const u = shareUrl({ name: draft.name || 'Route', steps: draft.steps, final: draft.final }, base);
    if (!u.ok) return flash({ tone: 'error', text: u.error });
    setNotice({ tone: 'ok', text: 'Lien de partage prêt (sans vos prix manuels).' });
    setLink(u.value);
    try {
      void navigator.clipboard?.writeText(u.value).catch(() => {});
    } catch {
      /* copie manuelle */
    }
  };

  const exportOne = () => {
    if (draft.steps.length === 0) return flash({ tone: 'error', text: 'Rien à exporter : la route est vide.' });
    const nowIso = new Date().toISOString();
    const r: SavedRoute = {
      v: 1,
      id: draft.id ?? makeRoute('x', [], draft.final).id,
      name: draft.name.trim() || 'Route sans nom',
      createdAt: draft.createdAt ?? nowIso,
      updatedAt: nowIso,
      steps: draft.steps,
      final: draft.final,
    };
    downloadJson(`route-${fileSlug(r.name)}.json`, exportJson([r]));
  };

  const exportAll = () => {
    if (store.routes.length === 0) return flash({ tone: 'error', text: 'Aucune route enregistrée à exporter.' });
    downloadJson('mes-routes-albion.json', exportJson(store.routes));
  };

  const onImportFile = async (f: File | undefined) => {
    if (!f) return;
    const text = await f.text();
    const res = importJson(text);
    if (!res.ok) return flash({ tone: 'error', text: `Import refusé : ${res.error}` });
    const m = store.importMany(res.value);
    if (!m.ok) return flash({ tone: 'error', text: m.error });
    flash({ tone: 'ok', text: `${res.value.length} route${res.value.length > 1 ? 's importées' : ' importée'}.` });
  };

  const open = (r: SavedRoute) => {
    setDraft({ id: r.id, name: r.name, steps: r.steps, final: r.final, createdAt: r.createdAt });
    setShared(null);
    flash(null);
  };

  const wrap = (res: { ok: true } | { ok: false; error: string }) => (res.ok ? null : res.error);

  return (
    <section className="page rb-page" aria-labelledby="page-title">
      <header className="page-head page-head--art">
        <img
          className="page-art"
          src="/img/chain-600.webp"
          srcSet="/img/chain-600.webp 600w, /img/chain-1200.webp 1200w"
          sizes="(max-width: 700px) 100vw, 320px"
          width="600"
          height="338"
          alt=""
          decoding="async"
        />
        <h1 id="page-title">Mes routes</h1>
        <p className="page-intro">
          Composez une chaîne de production (achat, raffinages successifs, vente) et suivez son profit avec les prix du jour.
          Les quantités sont des moyennes espérées avec le taux de retour de chaque ville.
        </p>
      </header>

      {shared && 'error' in shared && (
        <p className="rb-error" role="alert">
          Lien de partage invalide : {shared.error}
        </p>
      )}
      {shared && 'route' in shared && (
        <div className="rb-shared" role="status">
          <span>
            Route partagée : <strong>{shared.route.name}</strong>
          </span>
          <button type="button" className="btn rb-primary" onClick={save}>
            Enregistrer cette route partagée
          </button>
        </div>
      )}

      <div className="rb-layout">
        <aside className="rb-side">
          <section className="rb-panel" aria-labelledby="rb-list-title">
            <h2 id="rb-list-title">
              Routes enregistrées <span className="muted rb-small">({store.routes.length}/20)</span>
            </h2>
            <RouteList
              routes={store.routes}
              results={listResults}
              activeId={draft.id}
              onOpen={open}
              onRename={(id, name) => {
                const e = wrap(store.rename(id, name));
                if (!e && draft.id === id) setDraft((d) => ({ ...d, name: name.trim() }));
                return e;
              }}
              onDuplicate={(id) => wrap(store.duplicate(id))}
              onDelete={(id) => {
                const e = wrap(store.remove(id));
                if (!e && draft.id === id) setDraft((d) => ({ ...d, id: null }));
                return e;
              }}
            />
            <div className="rb-row rb-io">
              <button type="button" className="btn-ghost" onClick={() => setDraft(EMPTY_DRAFT)}>
                Nouvelle route
              </button>
              <button type="button" className="btn-ghost" onClick={exportAll}>
                Tout exporter
              </button>
              <button type="button" className="btn-ghost" onClick={() => fileRef.current?.click()}>
                Importer (JSON)
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => {
                  void onImportFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </div>
          </section>
          <section className="rb-panel" aria-labelledby="rb-preset-title">
            <h2 id="rb-preset-title">Préréglage en un clic</h2>
            <PresetBar
              recipes={recipes}
              onApply={(steps, c) => {
                setDraft((d) => ({ ...d, id: null, createdAt: undefined, name: presetName(c), steps }));
                flash(null);
              }}
            />
          </section>
        </aside>

        <div className="rb-editor">
          <div className="rb-panel rb-head" role="group" aria-label="Paramètres de la route">
            <label className="rb-field rb-grow">
              <span className="rb-field-label">Nom</span>
              <input value={draft.name} maxLength={80} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
            </label>
            <label className="rb-field">
              <span className="rb-field-label">{draft.final.qtyMode === 'final' ? 'Quantité finale' : 'Crafts de départ'}</span>
              <input
                type="number"
                min={1}
                step="any"
                inputMode="decimal"
                className="rb-qty"
                value={draft.final.qty}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v > 0) setFinal({ qty: v });
                }}
              />
            </label>
            <div className="rb-field">
              <span className="rb-field-label">Mode</span>
              <div className="segmented" role="group" aria-label="Mode de quantité">
                <button type="button" className={`seg${draft.final.qtyMode === 'final' ? ' on' : ''}`} aria-pressed={draft.final.qtyMode === 'final'} onClick={() => setFinal({ qtyMode: 'final' })}>
                  Quantité finale
                </button>
                <button type="button" className={`seg${draft.final.qtyMode === 'start' ? ' on' : ''}`} aria-pressed={draft.final.qtyMode === 'start'} onClick={() => setFinal({ qtyMode: 'start' })}>
                  Quantité de départ
                </button>
              </div>
            </div>
            <label className="rb-field">
              <span className="rb-field-label">Vente</span>
              <select value={draft.final.sellAt} onChange={(e) => setFinal({ sellAt: e.target.value as Location | 'auto' })}>
                {SELL_CHOICES.map((l) => (
                  <option key={l} value={l}>
                    {l === 'auto' ? `Auto (meilleur prix${result.sellAt && draft.final.sellAt === 'auto' ? ` : ${result.sellAt}` : ''})` : l}
                  </option>
                ))}
              </select>
            </label>
            <label className="rb-field">
              <span className="rb-field-label">Prix de vente manuel</span>
              <input
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                className="rb-qty"
                placeholder={result.sellPrice != null && draft.final.manualSellPrice == null ? String(Math.round(result.sellPrice)) : 'Prix du marché'}
                value={draft.final.manualSellPrice ?? ''}
                onChange={(e) => {
                  const v = e.target.value === '' ? undefined : Number(e.target.value);
                  setDraft((d) => {
                    const { manualSellPrice: _drop, ...rest } = d.final;
                    void _drop;
                    return { ...d, final: v != null && Number.isFinite(v) && v > 0 ? { ...rest, manualSellPrice: v } : rest };
                  });
                }}
              />
            </label>
            <div className="rb-row rb-head-actions">
              <button type="button" className="btn rb-primary" onClick={save}>
                Enregistrer
              </button>
              <button type="button" className="btn" onClick={share}>
                Partager
              </button>
              <button type="button" className="btn" onClick={exportOne}>
                Exporter
              </button>
            </div>
          </div>

          {notice && (
            <p className={notice.tone === 'error' ? 'rb-error' : 'rb-ok'} role={notice.tone === 'error' ? 'alert' : 'status'}>
              {notice.text}
            </p>
          )}
          {link && (
            <label className="rb-field rb-link">
              <span className="rb-field-label">Lien à copier</span>
              <input readOnly value={link} onFocus={(e) => e.target.select()} />
            </label>
          )}

          {draft.steps.length === 0 ? (
            <p className="rb-empty muted">
              La route est vide. Choisissez un préréglage (ex. Bois → Planches, T2 → T4) ou ajoutez une étape.
            </p>
          ) : (
            <div className="rb-steps">
              {draft.steps.map((s, i) => (
                <StepCard
                  key={`${i}-${s.outputId}`}
                  index={i}
                  steps={draft.steps}
                  result={result.steps[i]}
                  lookup={lookup}
                  maxPriceAgeH={settings.maxPriceAgeH}
                  onStepsChange={setSteps}
                />
              ))}
            </div>
          )}

          <AddStep recipes={recipes} onAdd={(r) => setSteps([...draft.steps, stepFromRecipe(r, draft.steps)])} />

          {draft.steps.length > 0 && <Summary result={result} />}
        </div>
      </div>
    </section>
  );
}
