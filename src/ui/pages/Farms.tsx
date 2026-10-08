// Page « Fermes » : classement des activités agricoles des îles et planificateur d'îles.
import { useMemo, useState } from 'react';
import { buildPriceIndex } from '../../engine';
import { DEFAULT_FARM_OPTIONS, planIslands, rankFarming, type FarmContext } from '../../engine/farming';
import { LOCATIONS, PRODUCTION_LOCATIONS, type Location } from '../../types';
import { useAppData } from '../context';
import { useFarms } from '../data/farmsStore';
import { AssumptionsPanel } from '../components/farms/Assumptions';
import { FarmRanking } from '../components/farms/FarmRanking';
import { IslandPlanner } from '../components/farms/IslandPlanner';
import '../farms.css';

type Tab = 'classement' | 'planificateur';
const SELL_LOCS = LOCATIONS.filter((l) => l !== 'Black Market');

export function FarmsPage() {
  const { snapshot, recipes, settings, now, metaById } = useAppData();
  const { state, update, reset, saved } = useFarms();
  const [tab, setTab] = useState<Tab>('classement');
  const [rankCity, setRankCity] = useState<Location | ''>('');
  const farming = recipes?.farming ?? null;

  const index = useMemo(() => (snapshot ? buildPriceIndex(snapshot, settings, now) : null), [snapshot, settings, now]);

  const base = useMemo(
    () =>
      farming && index
        ? { farming, index, settings, assumptions: state.assumptions, options: { sellAt: state.sellAt, foodSource: state.foodSource } }
        : null,
    [farming, index, settings, state.assumptions, state.sellAt, state.foodSource],
  );

  const rows = useMemo(() => {
    if (!base) return [];
    const ctx: FarmContext = {
      ...base,
      options: { ...DEFAULT_FARM_OPTIONS, ...base.options, islandCity: rankCity || null, specs: state.specs },
    };
    return rankFarming(ctx);
  }, [base, rankCity, state.specs]);

  const plan = useMemo(
    () => (base ? planIslands({ islands: state.islands, focusPerDay: state.focusPerDay, specs: state.specs }, base) : null),
    [base, state.islands, state.focusPerDay, state.specs],
  );

  return (
    <section className="page farms-page" aria-labelledby="page-title">
      <header className="page-head">
        <h1 id="page-title">Fermes</h1>
        <p className="page-intro">
          Cultures, herbes et animaux de ferme des îles : profit par parcelle et par jour, valeur du focus d’arrosage et de soin, et
          planificateur d’îles avec répartition optimale du focus.
        </p>
      </header>

      {!farming ? (
        <p className="farm-missing">
          Les données agricoles ne sont pas encore disponibles : le fichier des recettes doit être régénéré (générateur v3).
        </p>
      ) : (
        <>
          <div className="farm-options filters" role="group" aria-label="Options de calcul">
            <label>
              <span className="f-label">Lieu de vente</span>
              <select
                value={state.sellAt}
                onChange={(e) => update((s) => ({ ...s, sellAt: e.target.value as Location | 'auto' }))}
              >
                <option value="auto">Meilleur lieu (hors Black Market)</option>
                {SELL_LOCS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="f-label">Nourriture des animaux</span>
              <select
                value={state.foodSource}
                onChange={(e) => update((s) => ({ ...s, foodSource: e.target.value as 'market' | 'island' }))}
              >
                <option value="market">Achetée au marché</option>
                <option value="island">Produite sur l’île (prix de vente net)</option>
              </select>
            </label>
            <span className="f-label farm-settings-note">
              Premium {settings.premium ? 'actif' : 'inactif'} · mode {settings.mode === 'instant' ? 'instantané' : 'ordres'} · prix de
              moins de {settings.maxPriceAgeH} h{settings.historyFallback ? ' · prix estimés autorisés' : ''} (<a href="#/reglages">réglages</a>)
            </span>
          </div>

          <AssumptionsPanel value={state.assumptions} onChange={(a) => update((s) => ({ ...s, assumptions: a }))} />

          <div className="segmented farm-tabs" role="tablist" aria-label="Vues des fermes">
            <button
              type="button"
              role="tab"
              id="farm-tab-classement"
              aria-selected={tab === 'classement'}
              aria-controls="farm-panel"
              className={tab === 'classement' ? 'seg on' : 'seg'}
              onClick={() => setTab('classement')}
            >
              Classement
            </button>
            <button
              type="button"
              role="tab"
              id="farm-tab-planificateur"
              aria-selected={tab === 'planificateur'}
              aria-controls="farm-panel"
              className={tab === 'planificateur' ? 'seg on' : 'seg'}
              onClick={() => setTab('planificateur')}
            >
              Planificateur d’îles
            </button>
          </div>

          <div id="farm-panel" role="tabpanel" aria-labelledby={`farm-tab-${tab}`}>
            {!index ? (
              <p className="muted">Chargement des prix…</p>
            ) : tab === 'classement' ? (
              <>
                <div className="filters farm-rank-city">
                  <label>
                    <span className="f-label">Ville de l’île (bonus de rendement)</span>
                    <select value={rankCity} onChange={(e) => setRankCity(e.target.value as Location | '')}>
                      <option value="">Aucun bonus</option>
                      {PRODUCTION_LOCATIONS.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <FarmRanking rows={rows} metaById={metaById} />
              </>
            ) : (
              plan && <IslandPlanner state={state} update={update} reset={reset} plan={plan} farming={farming} metaById={metaById} />
            )}
          </div>
          {!saved && <p className="farm-missing">Le stockage du navigateur est indisponible : le plan ne sera pas conservé.</p>}
        </>
      )}
    </section>
  );
}
