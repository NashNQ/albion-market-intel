import { useState } from 'react';
import type { ChainResult, SavedRoute } from '../../../engine/chain-index';
import { fmtAgeH } from '../../format';
import { Badge, Money } from './ui';

interface Props {
  routes: SavedRoute[];
  results: Map<string, ChainResult>;
  activeId: string | null;
  onOpen: (r: SavedRoute) => void;
  onRename: (id: string, name: string) => string | null;
  onDuplicate: (id: string) => string | null;
  onDelete: (id: string) => string | null;
}

export function RouteList({ routes, results, activeId, onOpen, onRename, onDuplicate, onDelete }: Props) {
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => string | null) => setError(fn());

  if (routes.length === 0)
    return <p className="muted rb-empty">Aucune route enregistrée. Générez un préréglage ou ajoutez des étapes, puis « Enregistrer ».</p>;
  return (
    <>
      {error && (
        <p className="rb-error" role="alert">
          {error}
        </p>
      )}
      <ul className="rb-list" aria-label="Routes enregistrées">
        {routes.map((r) => {
          const res = results.get(r.id);
          const serious = res ? res.warnings.filter((w) => w.kind !== 'manual-price' && w.kind !== 'mists').length : 0;
          return (
            <li key={r.id} className={`rb-list-item${r.id === activeId ? ' is-active' : ''}`}>
              <div className="rb-list-main">
                {renaming?.id === r.id ? (
                  <form
                    className="rb-row"
                    onSubmit={(e) => {
                      e.preventDefault();
                      run(() => onRename(r.id, renaming.name));
                      setRenaming(null);
                    }}
                  >
                    <input
                      aria-label="Nouveau nom"
                      value={renaming.name}
                      autoFocus
                      maxLength={80}
                      onChange={(e) => setRenaming({ id: r.id, name: e.target.value })}
                    />
                    <button type="submit" className="btn">
                      OK
                    </button>
                    <button type="button" className="btn-ghost" onClick={() => setRenaming(null)}>
                      Annuler
                    </button>
                  </form>
                ) : (
                  <button type="button" className="rb-list-name" onClick={() => onOpen(r)}>
                    {r.name}
                  </button>
                )}
                <span className="rb-small muted">
                  {r.steps.length} étape{r.steps.length > 1 ? 's' : ''}
                  {res ? ` · prix jusqu’à ${fmtAgeH(res.maxPriceAgeH)}` : ''}
                </span>
              </div>
              <div className="rb-list-profit">
                <Money v={res?.profit} signed />
                {res && !res.complete && <Badge tone="danger">incomplète</Badge>}
                {serious > 0 && (
                  <Badge tone="warn" title={res?.warnings.map((w) => w.message).join('\n')}>
                    {serious} avertissement{serious > 1 ? 's' : ''}
                  </Badge>
                )}
              </div>
              <div className="rb-list-actions">
                {confirmDelete === r.id ? (
                  <span className="rb-confirm" role="alert">
                    Supprimer « {r.name} » ?
                    <button
                      type="button"
                      className="btn rb-danger"
                      onClick={() => {
                        run(() => onDelete(r.id));
                        setConfirmDelete(null);
                      }}
                    >
                      Supprimer
                    </button>
                    <button type="button" className="btn-ghost" onClick={() => setConfirmDelete(null)}>
                      Annuler
                    </button>
                  </span>
                ) : (
                  <>
                    <button type="button" className="btn-ghost" onClick={() => onOpen(r)}>
                      Ouvrir
                    </button>
                    <button type="button" className="btn-ghost" onClick={() => setRenaming({ id: r.id, name: r.name })}>
                      Renommer
                    </button>
                    <button type="button" className="btn-ghost" onClick={() => run(() => onDuplicate(r.id))}>
                      Dupliquer
                    </button>
                    <button type="button" className="btn-ghost" onClick={() => setConfirmDelete(r.id)}>
                      Supprimer
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
