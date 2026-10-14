// Portefeuille de la guilde : investissements enregistrés, statut recalculé aux prix du moment.
import { useEffect, useRef, useState } from 'react';
import type { InvestOutcome } from '../../../engine/invest';
import type { RouteFailure } from '../../../engine/route';
import type { SavedInvestment } from '../../data/investStore';
import { fmtInt, fmtPct, fmtSilver, plural } from '../../format';
import { fmtPayback, fmtSignedPct } from './shared';

export interface PortfolioRow {
  inv: SavedInvestment;
  label: string;
  /** Profit/unité actuel (null si la route échoue). */
  unitProfitNow: number | null;
  failure: RouteFailure | 'unknownRecipe' | null;
  sim: InvestOutcome | null;
  daysElapsed: number;
  /** Part cumulée estimée depuis le début (scénario central, prix du moment). */
  earnedSoFar: number | null;
}

export type CopyKind = 'link' | 'discord';

export interface PortfolioProps {
  rows: PortfolioRow[];
  editingId: string | null;
  onEdit: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onCopy: (id: string, kind: CopyKind) => Promise<{ ok: boolean; text: string }>;
  message: string | null;
}

function statusOf(r: PortfolioRow): { tone: 'up' | 'flat' | 'down' | 'off'; text: string } {
  if (r.failure === 'unknownRecipe') return { tone: 'off', text: 'Recette absente des données actuelles' };
  if (r.failure === 'unprofitable') return { tone: 'off', text: 'Non rentable aux prix du moment' };
  if (r.failure) return { tone: 'off', text: 'Prix indisponibles en ce moment' };
  const now = r.unitProfitNow;
  const start = r.inv.startUnitProfit;
  if (now == null) return { tone: 'off', text: 'Prix indisponibles en ce moment' };
  if (start == null || !(start > 0)) return { tone: 'flat', text: `Profit actuel ${fmtSilver(now)}/unité` };
  const delta = now / start - 1;
  const txt = `Profit/unité ${fmtSilver(now)} (${fmtSignedPct(delta)} depuis le démarrage)`;
  if (delta >= 0.1) return { tone: 'up', text: txt };
  if (delta <= -0.1) return { tone: 'down', text: txt };
  return { tone: 'flat', text: txt };
}

function CopyFallback({ text, onClose }: { text: string; onClose: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, [text]);
  return (
    <div className="inv-fallback">
      <label className="field-label" htmlFor="inv-fallback-text">
        Copie automatique impossible : sélectionnez et copiez ce texte (Ctrl+C)
      </label>
      <textarea id="inv-fallback-text" ref={ref} readOnly rows={Math.min(7, text.split('\n').length + 1)} value={text} />
      <button type="button" className="btn-ghost" onClick={onClose}>
        Fermer
      </button>
    </div>
  );
}

export function Portfolio({ rows, editingId, onEdit, onDuplicate, onDelete, onCopy, message }: PortfolioProps) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [copied, setCopied] = useState<{ id: string; kind: CopyKind } | null>(null);
  const [fallback, setFallback] = useState<{ id: string; text: string } | null>(null);

  const totalCapital = rows.reduce((s, r) => s + r.inv.capital, 0);
  let perDay = 0;
  let wSum = 0;
  let wCap = 0;
  let excluded = 0;
  for (const r of rows) {
    if (r.sim?.ok) {
      const c = r.sim.scenarios.central;
      perDay += Math.max(0, c.investorPerDay);
      if (c.paybackTotal != null) {
        wSum += c.paybackTotal * r.inv.capital;
        wCap += r.inv.capital;
      } else excluded++;
    } else excluded++;
  }
  const avgPayback = wCap > 0 ? wSum / wCap : null;

  const copy = async (id: string, kind: CopyKind) => {
    const res = await onCopy(id, kind);
    if (res.ok) {
      setFallback(null);
      setCopied({ id, kind });
      window.setTimeout(() => setCopied((c) => (c && c.id === id && c.kind === kind ? null : c)), 2000);
    } else setFallback({ id, text: res.text });
  };

  return (
    <section className="inv-section" aria-labelledby="inv-portfolio-title">
      <h2 id="inv-portfolio-title">Portefeuille de la guilde</h2>
      {message && (
        <p className="inv-msg" role="status">
          {message}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="muted">
          Aucun investissement enregistré. Simulez une activité ci-dessus puis cliquez sur « Enregistrer dans le portefeuille ».
        </p>
      ) : (
        <>
          <dl className="inv-totals" aria-label="Totaux du portefeuille">
            <div>
              <dt>Capital déployé</dt>
              <dd data-testid="inv-total-capital">{fmtSilver(totalCapital)}</dd>
            </div>
            <div>
              <dt>Retour attendu par jour</dt>
              <dd data-testid="inv-total-perday">{fmtSilver(perDay)}</dd>
            </div>
            <div>
              <dt>Point mort moyen pondéré</dt>
              <dd data-testid="inv-total-payback">{avgPayback == null ? '—' : fmtPayback(avgPayback)}</dd>
            </div>
          </dl>
          {excluded > 0 && (
            <p className="field-help">
              {plural(excluded, 'investissement exclu', 'investissements exclus')} du point mort moyen (non rentable, sans prix ou jamais
              remboursé aux prix du moment).
            </p>
          )}
          <ul className="inv-list">
            {rows.map((r) => {
              const st = statusOf(r);
              const c = r.sim?.ok ? r.sim.scenarios.central : null;
              const progress = r.earnedSoFar != null && r.inv.capital > 0 ? Math.min(1, r.earnedSoFar / r.inv.capital) : null;
              return (
                <li key={r.inv.id} className={`inv-item${editingId === r.inv.id ? ' is-editing' : ''}`} aria-label={`Investissement ${r.inv.member}`}>
                  <div className="inv-item-head">
                    <strong className="inv-item-member">{r.inv.member}</strong>
                    <span className="inv-item-activity">{r.label}</span>
                  </div>
                  <dl className="inv-item-facts">
                    <div>
                      <dt>Capital</dt>
                      <dd>{fmtSilver(r.inv.capital)}</dd>
                    </div>
                    <div>
                      <dt>Part</dt>
                      <dd>{fmtPct(r.inv.investorShare, 0)}</dd>
                    </div>
                    <div>
                      <dt>Début</dt>
                      <dd>
                        {new Date(r.inv.startDate + 'T00:00:00Z').toLocaleDateString('fr-FR', { timeZone: 'UTC' })} (j {fmtInt(r.daysElapsed)})
                      </dd>
                    </div>
                    <div>
                      <dt>Point mort</dt>
                      <dd>{c ? fmtPayback(c.paybackTotal) : '—'}</dd>
                    </div>
                    <div>
                      <dt>Retour/jour</dt>
                      <dd>{c ? fmtSilver(c.investorPerDay) : '—'}</dd>
                    </div>
                  </dl>
                  <p className={`inv-status-line is-${st.tone}`}>{st.text}</p>
                  {progress != null && (
                    <div className="inv-progress">
                      <span className="inv-progress-bar" aria-hidden="true">
                        <span style={{ transform: `scaleX(${progress})` }} />
                      </span>
                      <span className="field-help">Remboursé ≈ {fmtPct(progress, 0)} (estimation aux prix du moment)</span>
                    </div>
                  )}
                  <div className="inv-actions">
                    <button type="button" className="btn" onClick={() => onEdit(r.inv.id)}>
                      Modifier
                    </button>
                    <button type="button" className="btn" onClick={() => onDuplicate(r.inv.id)}>
                      Dupliquer
                    </button>
                    <button type="button" className="btn" onClick={() => copy(r.inv.id, 'link')}>
                      {copied?.id === r.inv.id && copied.kind === 'link' ? 'Lien copié' : 'Copier le lien'}
                    </button>
                    <button type="button" className="btn" onClick={() => copy(r.inv.id, 'discord')}>
                      {copied?.id === r.inv.id && copied.kind === 'discord' ? 'Résumé copié' : 'Copier le résumé pour Discord'}
                    </button>
                    {confirmId === r.inv.id ? (
                      <span className="inv-confirm" role="group" aria-label="Confirmer la suppression">
                        <span>Supprimer définitivement ?</span>
                        <button
                          type="button"
                          className="btn inv-danger"
                          onClick={() => {
                            setConfirmId(null);
                            onDelete(r.inv.id);
                          }}
                        >
                          Confirmer
                        </button>
                        <button type="button" className="btn-ghost" onClick={() => setConfirmId(null)}>
                          Annuler
                        </button>
                      </span>
                    ) : (
                      <button type="button" className="btn-ghost inv-delete" onClick={() => setConfirmId(r.inv.id)}>
                        Supprimer
                      </button>
                    )}
                  </div>
                  {fallback?.id === r.inv.id && <CopyFallback text={fallback.text} onClose={() => setFallback(null)} />}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
