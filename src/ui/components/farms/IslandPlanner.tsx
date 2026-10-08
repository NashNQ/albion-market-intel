// Onglet « Planificateur d'îles » : îles, parcelles, focus disponible, spécialisations → plan optimisé.
import { useMemo } from 'react';
import { PRODUCTION_LOCATIONS, type FarmingData, type ItemMeta, type Location } from '../../../types';
import { PLOT_LABEL, activitiesFor, type PlanResult, type PlannerIsland, type PlotType, type ShoppingLine } from '../../../engine/farming';
import { MAX_FOCUS, MAX_ISLANDS, MAX_PLOTS, farmId, makePlots, type FarmsState } from '../../data/farmsStore';
import { fmt1, fmtInt, fmtSilver } from '../../format';
import { LocChip } from '../Route';
import { ItemIcon } from '../ItemIcon';
import { FarmFlags, activityName, nameOf } from './shared';

interface Props {
  state: FarmsState;
  update: (fn: (s: FarmsState) => FarmsState) => void;
  reset: () => void;
  plan: PlanResult;
  farming: FarmingData;
  metaById: Map<string, ItemMeta>;
}

function Place({ loc }: { loc: ShoppingLine['loc'] }) {
  if (loc === 'npc') return <span className="farm-npc">PNJ</span>;
  if (loc === 'island') return <span className="farm-npc">Île</span>;
  return <LocChip loc={loc as Location} />;
}

function Lines({ title, lines, metaById, empty }: { title: string; lines: ShoppingLine[]; metaById: Map<string, ItemMeta>; empty: string }) {
  return (
    <section className="farm-card" aria-label={title}>
      <h3>{title}</h3>
      {lines.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <table className="plain farm-lines">
          <thead>
            <tr>
              <th scope="col">Objet</th>
              <th scope="col">Lieu</th>
              <th scope="col" className="num">Qté/jour</th>
              <th scope="col" className="num">Total/jour</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={`${l.id}-${l.loc}`}>
                <th scope="row">
                  <span className="farm-obj">
                    <ItemIcon id={l.id} name={nameOf(metaById, l.id)} size={22} /> {nameOf(metaById, l.id)}
                  </span>
                </th>
                <td>
                  <Place loc={l.loc} />
                </td>
                <td className="num">{fmt1(l.qtyPerDay)}</td>
                <td className="num">{fmtSilver(l.totalPerDay)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function IslandPlanner({ state, update, reset, plan, farming, metaById }: Props) {
  const cropOf = useMemo(() => {
    const m = new Map(farming.crops.map((c) => [c.seedId, c.cropId]));
    return (seedId: string) => m.get(seedId);
  }, [farming]);
  const planByPlot = useMemo(() => new Map(plan.plots.map((p) => [p.plotId, p])), [plan]);
  const choices = useMemo(
    () =>
      Object.fromEntries(
        (['ferme', 'jardin', 'pâturage'] as PlotType[]).map((t) => [t, activitiesFor(t, farming)]),
      ) as Record<PlotType, ReturnType<typeof activitiesFor>>,
    [farming],
  );
  const setIsland = (id: string, fn: (i: PlannerIsland) => PlannerIsland) =>
    update((s) => ({ ...s, islands: s.islands.map((i) => (i.id === id ? fn(i) : i)) }));
  const specSources = [
    ...farming.crops.map((c) => ({ id: c.seedId, name: nameOf(metaById, c.cropId) })),
    ...farming.animals.map((a) => ({ id: a.babyId, name: nameOf(metaById, a.grownId) })),
  ];

  return (
    <div className="farm-planner">
      <div className="farm-toolbar">
        <div className="field">
          <label className="field-label" htmlFor="farm-focus">
            Focus disponible par jour
          </label>
          <span className="num-input">
            <input
              id="farm-focus"
              type="number"
              min={0}
              max={MAX_FOCUS}
              step={500}
              value={state.focusPerDay}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) update((s) => ({ ...s, focusPerDay: Math.min(MAX_FOCUS, Math.max(0, n)) }));
              }}
            />
            <span className="suffix">points</span>
          </span>
        </div>
        <div className="farm-toolbar-actions">
          <button
            type="button"
            className="btn"
            disabled={state.islands.length >= MAX_ISLANDS}
            onClick={() =>
              update((s) => ({
                ...s,
                islands: [
                  ...s.islands,
                  { id: farmId('i'), name: `Île ${s.islands.length + 1}`, city: 'Lymhurst', plots: makePlots({ ferme: 1 }) },
                ],
              }))
            }
          >
            Ajouter une île
          </button>
          <button type="button" className="btn-ghost" onClick={reset}>
            Réinitialiser
          </button>
        </div>
      </div>

      {state.islands.length === 0 && <p className="muted">Aucune île. Ajoutez-en une pour lancer le calcul.</p>}

      {state.islands.map((isl) => {
        const islPlots = plan.plots.filter((p) => p.islandId === isl.id);
        const islProfit = islPlots.reduce((s, p) => s + (p.profitPerDay ?? 0), 0);
        const islMissing = islPlots.filter((p) => p.profitPerDay == null).length;
        return (
          <section className="farm-island" key={isl.id} aria-label={`Île ${isl.name}`}>
            <header className="farm-island-head">
              <label className="farm-island-name">
                <span className="sr-only">Nom de l’île</span>
                <input
                  value={isl.name}
                  maxLength={60}
                  aria-label="Nom de l’île"
                  onChange={(e) => setIsland(isl.id, (i) => ({ ...i, name: e.target.value }))}
                />
              </label>
              <label>
                <span className="f-label">Ville</span>{' '}
                <select
                  aria-label={`Ville de ${isl.name}`}
                  value={isl.city}
                  onChange={(e) => setIsland(isl.id, (i) => ({ ...i, city: e.target.value as PlannerIsland['city'] }))}
                >
                  {PRODUCTION_LOCATIONS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <span className="farm-island-total">
                <span className="f-label">Profit/jour</span>{' '}
                <strong className={islProfit >= 0 ? 'profit' : 'farm-loss'}>{fmtSilver(islProfit)}</strong>
                {islMissing > 0 && (
                  <span className="farm-missing-cell">
                    hors {islMissing} parcelle{islMissing > 1 ? 's' : ''} sans données
                  </span>
                )}
              </span>
              <button
                type="button"
                className="btn-ghost"
                aria-label={`Supprimer ${isl.name}`}
                onClick={() => update((s) => ({ ...s, islands: s.islands.filter((i) => i.id !== isl.id) }))}
              >
                Supprimer
              </button>
            </header>
            <ul className="farm-plots">
              {isl.plots.map((p, idx) => {
                const pp = planByPlot.get(p.id);
                return (
                  <li key={p.id} className={pp?.focused ? 'farm-plot is-focused' : 'farm-plot'}>
                    <span className="farm-plot-n">{idx + 1}</span>
                    <label>
                      <span className="sr-only">Type de la parcelle {idx + 1}</span>
                      <select
                        value={p.type}
                        onChange={(e) =>
                          setIsland(isl.id, (i) => ({
                            ...i,
                            plots: i.plots.map((x) => (x.id === p.id ? { ...x, type: e.target.value as PlotType, activity: 'auto' } : x)),
                          }))
                        }
                      >
                        {(Object.keys(PLOT_LABEL) as PlotType[]).map((t) => (
                          <option key={t} value={t}>
                            {PLOT_LABEL[t]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="farm-plot-act">
                      <span className="sr-only">Activité de la parcelle {idx + 1}</span>
                      <select
                        value={p.activity}
                        onChange={(e) =>
                          setIsland(isl.id, (i) => ({ ...i, plots: i.plots.map((x) => (x.id === p.id ? { ...x, activity: e.target.value } : x)) }))
                        }
                      >
                        <option value="auto">
                          Auto{pp?.auto && pp.activityId ? ` (${activityName(pp.activityId, metaById, cropOf)})` : ''}
                        </option>
                        {p.activity !== 'auto' && !choices[p.type].some((c) => c.id === p.activity) && (
                          <option value={p.activity}>Activité inconnue ou incompatible</option>
                        )}
                        {choices[p.type].map((c) => (
                          <option key={c.id} value={c.id}>
                            {activityName(c.id, metaById, cropOf)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className="farm-plot-res">
                      {pp?.focused && <span className="farm-badge">{p.type === 'pâturage' ? 'Soigné' : 'Arrosé'}</span>}
                      {pp?.profitPerDay != null ? (
                        <strong className={pp.profitPerDay >= 0 ? 'profit' : 'farm-loss'}>{fmtSilver(pp.profitPerDay)}</strong>
                      ) : (
                        <span className="farm-missing-cell">{pp?.note ?? 'Données manquantes'}</span>
                      )}
                      {pp && pp.focusPerDay > 0 && <span className="muted">{fmtInt(pp.focusPerDay)} focus</span>}
                      {pp?.eval && <FarmFlags flags={pp.eval.flags.filter((f) => f !== 'missing')} />}
                    </span>
                    <button
                      type="button"
                      className="btn-ghost"
                      aria-label={`Retirer la parcelle ${idx + 1}`}
                      onClick={() => setIsland(isl.id, (i) => ({ ...i, plots: i.plots.filter((x) => x.id !== p.id) }))}
                    >
                      ✕
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="farm-add-plot" role="group" aria-label={`Ajouter une parcelle à ${isl.name}`}>
              {(Object.keys(PLOT_LABEL) as PlotType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  className="btn"
                  disabled={isl.plots.length >= MAX_PLOTS}
                  onClick={() => setIsland(isl.id, (i) => ({ ...i, plots: [...i.plots, ...makePlots({ [t]: 1 })] }))}
                >
                  + {PLOT_LABEL[t]}
                </button>
              ))}
            </div>
          </section>
        );
      })}

      <section className="farm-totals" aria-label="Totaux">
        <div>
          <span className="f-label">Profit total par jour</span>
          <strong className={`${plan.totalProfitPerDay >= 0 ? 'profit' : 'farm-loss'} farm-big`} data-testid="farm-total">
            {fmtSilver(plan.totalProfitPerDay)}
          </strong>
          {plan.plotsWithoutProfit > 0 && (
            <span className="farm-missing-cell" data-testid="farm-total-missing">
              Hors {plan.plotsWithoutProfit} parcelle{plan.plotsWithoutProfit > 1 ? 's' : ''} sans données (non comptée
              {plan.plotsWithoutProfit > 1 ? 's' : ''})
            </span>
          )}
        </div>
        <div>
          <span className="f-label">Focus utilisé</span>
          <strong className="farm-big">{fmtInt(plan.focusUsed)}</strong>
        </div>
        <div>
          <span className="f-label">Focus restant</span>
          <strong className="farm-big" data-testid="farm-focus-left">
            {fmtInt(plan.focusLeft)}
          </strong>
        </div>
      </section>

      {plan.warnings.length > 0 && (
        <ul className="farm-warnings" aria-label="Avertissements">
          {plan.warnings.map((w) => (
            <li key={`${w.id}-${w.loc}`}>
              {w.volume == null
                ? `${nameOf(metaById, w.id)} à ${w.loc} : volume 7 j inconnu, la vente de ${fmtInt(w.qtyPerDay)} unités/jour n’est pas garantie.`
                : `${nameOf(metaById, w.id)} à ${w.loc} : ${fmtInt(w.qtyPerDay)} unités/jour dépassent ${Math.round(state.assumptions.maxVolumeShare * 100)} % du volume médian (${fmtInt(w.volume)}/jour).`}
            </li>
          ))}
        </ul>
      )}

      <div className="farm-lists">
        <Lines title="Liste de courses (par jour)" lines={plan.buys} metaById={metaById} empty="Rien à acheter." />
        <Lines title="Production à vendre (par jour)" lines={plan.sells} metaById={metaById} empty="Aucune vente." />
      </div>

      <details className="quick-settings farm-specs">
        <summary>Spécialisations (0–100)</summary>
        <div className="farm-specs-grid">
          {specSources.map((s) => (
            <label key={s.id} className="farm-spec">
              <span>{s.name}</span>
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={state.specs[s.id] ?? 0}
                aria-label={`Spécialisation ${s.name}`}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isFinite(n)) return;
                  update((st) => ({ ...st, specs: { ...st.specs, [s.id]: Math.min(100, Math.max(0, n)) } }));
                }}
              />
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}
