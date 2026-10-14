// Estimation du coût de montée en compétence (raffinage / craft) pour l'activité financée.
import { useState } from 'react';
import type { ItemMeta, Recipe } from '../../../types';
import {
  DEFAULT_PREMIUM_FAME_BONUS,
  LEVELING_ASSUMPTIONS,
  MAX_TIER,
  STATUS_LABEL,
  estimateLeveling,
  levelingTrackFor,
  type JournalPrices,
  type LevelingEstimate,
  type UnitEconomics,
} from '../../../engine/leveling';
import { fmtInt, fmtSilver, plural } from '../../format';

export interface LevelingPanelProps {
  recipe: Recipe;
  recipes: readonly Recipe[];
  metaById: Map<string, ItemMeta>;
  premium: boolean;
  economics: (r: Recipe) => UnitEconomics | null;
  journal: (tier: number) => JournalPrices | null;
  /** Coût retenu (≥ 0) et estimation complète. */
  onEstimate: (cost: number, est: LevelingEstimate) => void;
}

/** Perte positive « 1 234 ag » ; négative = gain, écrit en toutes lettres pour ne pas lire « −30 ag » comme une perte. */
function LossCell({ v }: { v: number }) {
  return v < 0 ? <span className="pos">gain {fmtSilver(-v)}</span> : <>{fmtSilver(v)}</>;
}

export function LevelingPanel({ recipe, recipes, metaById, premium, economics, journal, onEstimate }: LevelingPanelProps) {
  const track = levelingTrackFor(recipe);
  const defTarget = Math.min(MAX_TIER, Math.max(3, recipe.tier));
  const [target, setTarget] = useState(defTarget);
  const [from, setFrom] = useState(2);
  const [premiumFame, setPremiumFame] = useState(premium);
  const [est, setEst] = useState<LevelingEstimate | null>(null);

  if (!track)
    return (
      <p className="field-help inv-level-na">
        Données de montée indisponibles pour cette famille : seules les 5 ressources de raffinage, les épées et les plastrons en plaque ont
        été extraits des fichiers du jeu. Saisissez le coût à la main si besoin.
      </p>
    );

  const fromSafe = Math.min(from, target - 1);
  const run = () => {
    const e = estimateLeveling({
      track,
      recipes,
      targetTier: target,
      fromTier: fromSafe,
      premiumFame,
      premiumBonus: DEFAULT_PREMIUM_FAME_BONUS,
      economics,
      journal,
      preferOutputId: recipe.outputId,
    });
    setEst(e);
    onEstimate(Math.max(0, Math.round(e.totalCost)), e);
  };

  const tiers = [3, 4, 5, 6, 7, 8];
  return (
    <div className="inv-level">
      <p className="field-help">
        Piste : <strong>{track.label}</strong>. Stratégie : produire au tier le plus haut déjà débloqué, au meilleur lieu de production,
        aux prix du moment.
      </p>
      <div className="inv-level-grid">
        <label className="field">
          <span className="field-label">Tier visé</span>
          <select value={target} onChange={(e) => setTarget(Number(e.target.value))}>
            {tiers.map((t) => (
              <option key={t} value={t}>
                T{t}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Déjà débloqué</span>
          <select value={fromSafe} onChange={(e) => setFrom(Number(e.target.value))}>
            <option value={2}>Rien (depuis zéro)</option>
            {tiers
              .filter((t) => t < target)
              .map((t) => (
                <option key={t} value={t}>
                  T{t}
                </option>
              ))}
          </select>
        </label>
        <label className="toggle inv-level-premium">
          <input type="checkbox" checked={premiumFame} onChange={(e) => setPremiumFame(e.target.checked)} />
          <span>Bonus de renommée premium (+50 %, hypothèse)</span>
        </label>
        <button type="button" className="btn" onClick={run}>
          Estimer
        </button>
      </div>

      {est && (
        <div className="inv-level-result" aria-live="polite">
          <p>
            {fmtInt(est.fame)} de renommée à gagner ({est.fromTier === 2 ? 'depuis zéro' : `T${est.fromTier} déjà débloqué`} → T{est.targetTier}), soit{' '}
            {plural(est.totalUnits, 'unité produite', 'unités produites')}.{' '}
            {est.totalCost < 0 && est.complete ? (
              <strong className="pos">
                La montée rapporte ≈ {fmtSilver(-est.totalCost)} aux prix du moment : c’est un gain, le coût de montée est fixé à 0 ag.
              </strong>
            ) : est.totalCost < 0 ? (
              <strong>Étapes chiffrées : gain ≈ {fmtSilver(-est.totalCost)} ; coût de montée fixé à 0 ag.</strong>
            ) : (
              <strong>Coût net estimé : {fmtSilver(est.totalCost)}.</strong>
            )}
            {!est.complete && ' Estimation partielle : certaines étapes n’ont pas pu être chiffrées (voir ci-dessous).'}
          </p>
          <div className="inv-table-wrap">
            <table className="inv-table">
              <caption className="sr-only">Étapes de la montée en compétence</caption>
              <thead>
                <tr>
                  <th scope="col">Étape</th>
                  <th scope="col" className="inv-l">Objet produit</th>
                  <th scope="col">Renommée</th>
                  <th scope="col">Unités produites</th>
                  <th scope="col">Perte nette / unité</th>
                  <th scope="col">Coût de l’étape</th>
                </tr>
              </thead>
              <tbody>
                {est.steps.map((s) => (
                  <tr key={s.toTier}>
                    <th scope="row">→ T{s.toTier}</th>
                    <td className="inv-l">{s.recipe ? (metaById.get(s.recipe.outputId)?.nameFr ?? s.recipe.outputId) : `T${s.produceTier}`}</td>
                    <td>{fmtInt(s.fame)}</td>
                    <td>{s.units == null ? '—' : fmtInt(s.units)}</td>
                    <td>
                      {s.unitLoss == null ? '—' : <LossCell v={s.unitLoss - s.journalGainPerUnit} />}
                      {s.journalGainPerUnit > 0 && <span className="muted"> (journaux −{fmtSilver(s.journalGainPerUnit)})</span>}
                    </td>
                    <td>{s.cost == null ? <span className="muted">{s.note}</span> : <LossCell v={s.cost} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/** Panneau « Hypothèses » (comme la page Fermes) : chaque constante avec son statut. */
export function AssumptionsPanel() {
  return (
    <details className="quick-settings inv-assumptions">
      <summary>Hypothèses</summary>
      <ul className="inv-assumptions-list">
        <li>
          <span className="inv-status inv-status--hypothèse">hypothèse</span>
          <strong>Scénarios</strong> : prudent = prix de vente −10 % et volume ×0,5 ; central = prix et volume du moment ; favorable = prix
          +5 % et volume ×1,2.
        </li>
        <li>
          <span className="inv-status inv-status--hypothèse">hypothèse</span>
          <strong>Rotation</strong> : rien n’est encaissé avant la fin du premier cycle (jours de rotation) ; ensuite, production et ventes
          régulières chaque jour. Le fonds de roulement couvre au moins une journée de production.
        </li>
        {LEVELING_ASSUMPTIONS.map((a) => (
          <li key={a.label}>
            <span className={`inv-status inv-status--${a.status}`}>{STATUS_LABEL[a.status]}</span>
            <strong>{a.label}</strong> : {a.value}. <span className="muted">Source : {a.source}.</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
