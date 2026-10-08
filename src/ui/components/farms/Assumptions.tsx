// Panneau repliable « Hypothèses » : constantes FarmAssumptions modifiables, avec source.
import { DEFAULT_FARM_ASSUMPTIONS, type FarmAssumptions } from '../../../engine/farming';

interface Def {
  key: keyof FarmAssumptions;
  label: string;
  help: string;
  step: number;
  min: number;
  max: number;
  pct?: boolean;
}

const WIKI = 'https://wiki.albiononline.com/wiki/Farming';
const DUMPS = 'https://github.com/ao-data/ao-bin-dumps';

const DEFS: Def[] = [
  { key: 'slotsPerPlot', label: 'Emplacements par parcelle', help: 'Une ferme, un jardin d’herbes ou un pâturage compte 9 emplacements (wiki Farming).', step: 1, min: 1, max: 100 },
  { key: 'premiumYieldMultiplier', label: 'Récolte avec premium (×)', help: 'Le premium double la récolte des cultures et des herbes (wiki Farming).', step: 0.1, min: 0, max: 10 },
  { key: 'premiumGrowthMultiplier', label: 'Croissance animale avec premium (×)', help: 'Le premium divise par 2 le temps de croissance des animaux (158 400 s → 22 h).', step: 0.05, min: 0.05, max: 10 },
  { key: 'premiumProductMultiplier', label: 'Œufs et lait avec premium (×)', help: 'Hypothèse : pas de doublement de la production des adultes (×1).', step: 0.1, min: 0, max: 10 },
  { key: 'focusHalvingsAtMaxSpec', label: 'Divisions du focus à spécialisation 100', help: 'Coût = focus × 0,5^(n·spec/100) ; n = 3 → 1 000 devient 125 à spécialisation 100.', step: 0.5, min: 0, max: 10 },
  { key: 'cropCyclesPerDay', label: 'Récoltes par jour', help: 'Croissance de 22 h (items.xml @growtime 79 200 s) : une récolte par jour en pratique.', step: 0.1, min: 0.01, max: 24 },
  { key: 'maxVolumeShare', label: 'Part maximale du volume 7 j', help: 'Avertissement du planificateur si la vente quotidienne dépasse cette part du volume médian.', step: 1, min: 0, max: 100, pct: true },
];

export function AssumptionsPanel({ value, onChange }: { value: FarmAssumptions; onChange: (a: FarmAssumptions) => void }) {
  return (
    <details className="quick-settings farm-assumptions">
      <summary>Hypothèses</summary>
      <div className="farm-assumptions-body">
        <p className="field-help">
          Constantes du calcul. Sources : <a href={WIKI} target="_blank" rel="noreferrer">wiki.albiononline.com/wiki/Farming</a>,{' '}
          <a href={DUMPS} target="_blank" rel="noreferrer">ao-bin-dumps</a> (items.xml : croissance, graines, focus ; loot.xml : récoltes 3-6, ver 10 %,
          œufs/lait 7-11 ; farmingmodifiers.xml : bonus de ville +10 %).
        </p>
        <div className="farm-assumptions-grid">
          {DEFS.map((d) => {
            const id = `fa-${d.key}`;
            const v = value[d.key];
            return (
              <div className="field" key={d.key}>
                <label className="field-label" htmlFor={id}>
                  {d.label}
                </label>
                <span className="num-input">
                  <input
                    id={id}
                    type="number"
                    step={d.step}
                    min={d.min}
                    max={d.max}
                    value={d.pct ? Math.round(v * 1000) / 10 : v}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (!Number.isFinite(n) || e.target.value === '') return;
                      const clamped = Math.min(d.max, Math.max(d.min, n));
                      onChange({ ...value, [d.key]: d.pct ? clamped / 100 : clamped });
                    }}
                  />
                  {d.pct && <span className="suffix">%</span>}
                </span>
                <p className="field-help">{d.help}</p>
              </div>
            );
          })}
        </div>
        <p className="field-help">
          Non modélisés en V1 : focus d’abattage (38 par animal), coût de la parcelle et des bâtiments, temps de trajet. Le petit initial
          de la stratégie « Garder et produire » est considéré comme amorti.
        </p>
        <button type="button" className="btn" onClick={() => onChange({ ...DEFAULT_FARM_ASSUMPTIONS })}>
          Valeurs par défaut
        </button>
      </div>
    </details>
  );
}
