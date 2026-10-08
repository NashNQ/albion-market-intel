import { useState } from 'react';
import { PRODUCTION_LOCATIONS, type Location } from '../../../types';
import {
  CRAFT_CHOICES,
  findRecipe,
  itemName,
  recipeVariantOf,
  removeSteps,
  syncInputs,
  replaceWithBuy,
  type ChainInputResult,
  type ChainStepResult,
  type InputSource,
  type RecipeLookup,
  type Step,
} from '../../../engine/chain-index';
import { fmt1, fmtPct, fmtSilver } from '../../format';
import { ItemIcon } from '../ItemIcon';
import { Age, Badge, CraftsQty, Loc, Money, fmtBuyQty, locLabel } from './ui';

interface Props {
  index: number;
  steps: Step[];
  result: ChainStepResult | undefined;
  lookup: RecipeLookup;
  maxPriceAgeH: number;
  onStepsChange: (steps: Step[]) => void;
}

const BUY_CHOICES: (Location | 'auto')[] = ['auto', ...PRODUCTION_LOCATIONS];

export function StepCard({ index, steps, result, lookup, maxPriceAgeH, onStepsChange }: Props) {
  const variants = lookup.byOutput.get(steps[index].outputId) ?? [];
  const step = steps[index];
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [pendingReplace, setPendingReplace] = useState<{ inputId: string; orphaned: number[] } | null>(null);
  const name = itemName(lookup, step.outputId);
  const r = result;
  const isFinal = index === steps.length - 1;

  const patchStep = (patch: Partial<Step>) => onStepsChange(steps.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const setSource = (inputId: string, source: InputSource) =>
    patchStep({ inputs: step.inputs.map((inp) => (inp.id === inputId ? { id: inp.id, source } : inp)) });

  const askReplace = (inputId: string) => {
    const res = replaceWithBuy(steps, index, inputId);
    if (res.orphaned.length === 0) onStepsChange(res.steps);
    else setPendingReplace({ inputId, orphaned: res.orphaned });
  };
  const confirmReplace = (prune: boolean) => {
    if (!pendingReplace) return;
    const res = replaceWithBuy(steps, index, pendingReplace.inputId);
    onStepsChange(prune ? removeSteps(res.steps, res.orphaned) : res.steps);
    setPendingReplace(null);
  };

  return (
    <article className={`rb-step${isFinal ? ' rb-step-final' : ''}`} aria-label={`Étape ${index + 1} : ${name}`}>
      <header className="rb-step-head">
        <span className="rb-step-num" aria-hidden="true">
          {index + 1}
        </span>
        <ItemIcon id={step.outputId} name="" size={40} />
        <div className="rb-step-title">
          <h3>{name}</h3>
          <span className="muted rb-small">
            {isFinal ? 'Produit vendu' : `Intermédiaire${r && r.consumers.length ? ` → étape ${r.consumers.map((c) => c + 1).join(', ')}` : ''}`}
            {r?.recipe && r.recipe.outputQty > 1 ? ` · ${r.recipe.outputQty} par craft` : ''}
          </span>
        </div>
        <div className="rb-step-craft">
          <label className="rb-field">
            <span className="rb-field-label">Production</span>
            <select value={step.craftAt} onChange={(e) => patchStep({ craftAt: e.target.value as Location | 'auto' })}>
              {CRAFT_CHOICES.map((l) => (
                <option key={l} value={l}>
                  {l === 'auto' ? `Auto (meilleur RRR${r?.craftAt && step.craftAt === 'auto' ? ` : ${r.craftAt}` : ''})` : l}
                </option>
              ))}
            </select>
          </label>
          {variants.length > 1 && (
            <label className="rb-field">
              <span className="rb-field-label">Recette</span>
              <select
                aria-label={`Recette de ${name}`}
                value={step.recipeVariant ?? ''}
                onChange={(e) => {
                  const v = e.target.value || undefined;
                  const rec = findRecipe(lookup, step.outputId, v);
                  if (!rec) return;
                  const next = syncInputs({ ...step, recipeVariant: v }, rec);
                  if (v === undefined) delete next.recipeVariant;
                  onStepsChange(steps.map((s, i) => (i === index ? next : s)));
                }}
              >
                {variants.map((rv) => {
                  const v = recipeVariantOf(rv);
                  return (
                    <option key={v ?? ''} value={v ?? ''}>
                      {v ? `${itemName(lookup, v)} (×${rv.outputQty})` : 'Recette standard'}
                    </option>
                  );
                })}
              </select>
            </label>
          )}
          <span className="rb-rrr" title="Taux de retour de ressources">
            RRR {r ? fmtPct(r.rrr, 1) : '—'}
          </span>
        </div>
        <div className="rb-step-actions">
          {confirmRemove ? (
            <span className="rb-confirm" role="alert">
              Supprimer cette étape ?
              <button
                type="button"
                className="btn rb-danger"
                onClick={() => {
                  onStepsChange(removeSteps(steps, [index]));
                  setConfirmRemove(false);
                }}
              >
                Supprimer
              </button>
              <button type="button" className="btn-ghost" onClick={() => setConfirmRemove(false)}>
                Annuler
              </button>
            </span>
          ) : (
            <button type="button" className="btn-ghost" onClick={() => setConfirmRemove(true)} aria-label={`Supprimer l’étape ${index + 1}`}>
              Supprimer
            </button>
          )}
        </div>
      </header>

      {!r?.recipe && <p className="rb-error">Aucune recette connue pour cet objet.</p>}

      {r?.recipe && (
        <>
          <ul className="rb-inputs">
            {r.inputs.map((inp) => (
              <InputRow
                key={inp.id}
                inp={inp}
                index={index}
                steps={steps}
                lookup={lookup}
                maxPriceAgeH={maxPriceAgeH}
                source={step.inputs.find((x) => x.id === inp.id)?.source ?? { type: 'buy', at: 'auto' }}
                setSource={(s) => setSource(inp.id, s)}
                onReplace={() => askReplace(inp.id)}
              />
            ))}
          </ul>

          {pendingReplace && (
            <div className="rb-confirm-box" role="alert">
              <p>
                Acheter {itemName(lookup, pendingReplace.inputId)} rend inutile
                {pendingReplace.orphaned.length > 1 ? ' les étapes ' : ' l’étape '}
                {pendingReplace.orphaned.map((o) => `${o + 1} (${itemName(lookup, steps[o].outputId)})`).join(', ')}.
              </p>
              <div className="rb-row">
                <button type="button" className="btn rb-danger" onClick={() => confirmReplace(true)}>
                  Remplacer et supprimer
                </button>
                <button type="button" className="btn" onClick={() => confirmReplace(false)}>
                  Remplacer sans supprimer
                </button>
                <button type="button" className="btn-ghost" onClick={() => setPendingReplace(null)}>
                  Annuler
                </button>
              </div>
            </div>
          )}

          <dl className="rb-step-stats">
            <div>
              <dt>Crafts</dt>
              <dd>
                <CraftsQty n={r.crafts} />
              </dd>
            </div>
            <div>
              <dt>Produit</dt>
              <dd>{fmt1(r.produced)}</dd>
            </div>
            <div>
              <dt>Frais de station</dt>
              <dd>
                <Money v={r.fee} />
              </dd>
            </div>
            <div>
              <dt>Coût de l’étape</dt>
              <dd>
                <Money v={r.totalCost} />
              </dd>
            </div>
            <div>
              <dt>Valeur au marché</dt>
              <dd>
                <Money v={r.marketValue} />
                {r.valueAt && (
                  <span className="rb-small muted">
                    {' '}
                    {r.valueAt} · <Age h={r.valueAgeH} maxH={maxPriceAgeH} />
                  </span>
                )}
                {r.valuedAtCost && (
                  <Badge tone="warn" title="Pas de prix de marché valide : l’étape est comptée au coût.">
                    non valorisable
                  </Badge>
                )}
              </dd>
            </div>
            <div className="rb-stat-profit">
              <dt>Profit d’étape</dt>
              <dd>
                <Money v={r.profit} signed />
              </dd>
            </div>
          </dl>
        </>
      )}
    </article>
  );
}

function InputRow({
  inp,
  index,
  steps,
  lookup,
  maxPriceAgeH,
  source,
  setSource,
  onReplace,
}: {
  inp: ChainInputResult;
  index: number;
  steps: Step[];
  lookup: RecipeLookup;
  maxPriceAgeH: number;
  source: InputSource;
  setSource: (s: InputSource) => void;
  onReplace: () => void;
}) {
  const name = itemName(lookup, inp.id);
  const producers = steps.map((s, k) => ({ s, k })).filter(({ s, k }) => k < index && s.outputId === inp.id);
  const srcValue = inp.sourceType === 'step' && inp.fromStep != null ? `step:${inp.fromStep}` : 'buy';
  const buySrc = source.type === 'buy' ? source : null;
  const c = inp.comparison;
  return (
    <li className="rb-input">
      <div className="rb-input-name">
        <ItemIcon id={inp.id} name="" size={28} />
        <span>
          {name}
          <span className="muted rb-small">
            {' '}
            × {inp.qty}/craft{inp.returnable ? '' : ' · sans retour'}
          </span>
        </span>
      </div>
      <div className="rb-input-src">
        <select
          aria-label={`Source de ${name}`}
          value={srcValue}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'buy') setSource({ type: 'buy', at: 'auto' });
            else setSource({ type: 'step', index: Number(v.slice(5)) });
          }}
        >
          <option value="buy">Acheter</option>
          {producers.map(({ k }) => (
            <option key={k} value={`step:${k}`}>
              Étape {k + 1}
            </option>
          ))}
        </select>
        {inp.sourceType === 'buy' && (
          <select
            aria-label={`Lieu d’achat de ${name}`}
            value={buySrc?.at ?? 'auto'}
            onChange={(e) => setSource({ type: 'buy', at: e.target.value as Location | 'auto', manualPrice: buySrc?.manualPrice })}
          >
            {BUY_CHOICES.map((l) => (
              <option key={l} value={l}>
                {l === 'auto' ? 'Le moins cher' : locLabel(l)}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="rb-input-qty">
        <span className="rb-small muted">Besoin net</span> <strong>{inp.sourceType === 'buy' ? fmtBuyQty(inp.need) : fmt1(inp.need)}</strong>
        {inp.returnable && inp.gross > inp.need && <span className="rb-small muted"> (brut {fmt1(inp.gross)})</span>}
      </div>
      {inp.sourceType === 'buy' ? (
        <div className="rb-input-price">
          <Loc loc={inp.buyAt} />
          <span>{inp.unitPrice != null ? fmtSilver(inp.unitPrice) : '—'}</span>
          <Age h={inp.ageH} maxH={maxPriceAgeH} />
          {inp.manual && <Badge tone="info">manuel</Badge>}
          {inp.estimated && (
            <Badge tone="warn" title="Moyenne sur 7 jours, faute de prix récent.">
              estimé
            </Badge>
          )}
          {inp.missing && <Badge tone="danger">{inp.stale ? 'prix périmé' : 'prix manquant'}</Badge>}
          <label className="rb-manual">
            <span className="sr-only">Prix manuel de {name}</span>
            <input
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              placeholder="Prix manuel"
              value={buySrc?.manualPrice ?? ''}
              onChange={(e) => {
                const v = e.target.value === '' ? undefined : Number(e.target.value);
                setSource({ type: 'buy', at: buySrc?.at ?? 'auto', ...(v != null && v > 0 && Number.isFinite(v) ? { manualPrice: v } : {}) });
              }}
            />
          </label>
          <span className="rb-input-cost">
            <Money v={inp.cost} />
          </span>
        </div>
      ) : (
        <div className="rb-input-price">
          <span className="rb-small muted">Valeur</span> <span>{inp.unitValue != null ? fmtSilver(inp.unitValue) : '—'}/u</span>
          <span className="rb-input-cost">
            <Money v={inp.cost} />
          </span>
        </div>
      )}
      {inp.sourceType === 'step' && (
        <div className="rb-compare">
          {c ? (
            <span>
              Acheter au lieu de produire :{' '}
              <strong className={c.delta > 0 ? 'profit' : 'rb-loss'}>
                Δ {c.delta > 0 ? '+' : ''}
                {fmtSilver(c.delta)}
              </strong>{' '}
              <span className="muted rb-small">
                (production {fmtSilver(c.produceCost)} contre achat {fmtSilver(c.buyCost)} à {c.buyAt})
              </span>
              {c.delta > 0 && <span className="profit rb-small"> — acheter est moins cher</span>}
            </span>
          ) : (
            <span className="muted">Pas de prix d’achat au marché pour comparer.</span>
          )}
          <button type="button" className="btn-ghost" onClick={onReplace}>
            Remplacer par un achat
          </button>
        </div>
      )}
    </li>
  );
}
