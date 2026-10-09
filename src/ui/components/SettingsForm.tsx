import { useId, type ReactNode } from 'react';
import type { Settings } from '../../types';

interface Props {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
  compact?: boolean;
}

function Field({ id, label, help, children }: { id: string; label: string; help: string; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <div className="field-control">{children}</div>
      <p className="field-help" id={`${id}-help`}>
        {help}
      </p>
    </div>
  );
}

function NumberInput({
  id,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
}: {
  id: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <span className="num-input">
      <input
        id={id}
        type="number"
        inputMode="decimal"
        value={Number.isFinite(value) ? value : ''}
        min={min}
        max={max}
        step={step}
        aria-describedby={`${id}-help`}
        onChange={(e) => {
          const n = e.target.valueAsNumber;
          if (Number.isFinite(n)) onChange(n);
        }}
      />
      {suffix && <span className="suffix">{suffix}</span>}
    </span>
  );
}

function Segmented<T extends string | number>({
  id,
  value,
  options,
  onChange,
  label,
}: {
  id: string;
  value: T;
  options: { v: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label} id={id} aria-describedby={`${id}-help`}>
      {options.map((o) => (
        <button
          key={String(o.v)}
          type="button"
          role="radio"
          aria-checked={o.v === value}
          className={o.v === value ? 'seg on' : 'seg'}
          onClick={() => onChange(o.v)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ id, checked, onChange }: { id: string; checked: boolean; onChange: (b: boolean) => void }) {
  return (
    <span className="toggle">
      <input id={id} type="checkbox" role="switch" checked={checked} aria-describedby={`${id}-help`} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-txt" aria-hidden="true">{checked ? 'Oui' : 'Non'}</span>
    </span>
  );
}

export function SettingsForm({ settings: s, update, reset, compact }: Props) {
  const id = useId();
  return (
    <div className={compact ? 'settings-grid compact' : 'settings-grid'}>
      <Field id={`${id}-premium`} label="Premium" help="Le premium réduit la taxe de vente de 8 % à 4 %.">
        <Toggle id={`${id}-premium`} checked={s.premium} onChange={(b) => update({ premium: b })} />
      </Field>
      <Field id={`${id}-focus`} label="Focus" help="Utiliser le focus augmente fortement le taux de retour des ressources.">
        <Toggle id={`${id}-focus`} checked={s.focus} onChange={(b) => update({ focus: b })} />
      </Field>
      <Field id={`${id}-bonus`} label="Bonus du jour" help="Bonus de production quotidien annoncé en jeu pour la catégorie.">
        <Segmented
          id={`${id}-bonus`}
          label="Bonus du jour"
          value={s.dailyBonus}
          onChange={(v) => update({ dailyBonus: v })}
          options={[
            { v: 0, label: '0 %' },
            { v: 0.1, label: '+10 %' },
            { v: 0.2, label: '+20 %' },
          ]}
        />
      </Field>
      <Field id={`${id}-fee`} label="Tarif station" help="Prix affiché par la station pour 100 de nutrition.">
        <NumberInput id={`${id}-fee`} value={s.stationFee} min={0} max={5000} step={10} suffix="ag" onChange={(n) => update({ stationFee: n })} />
      </Field>
      <Field
        id={`${id}-mode`}
        label="Mode d’échange"
        help="Instantané : acheter et vendre tout de suite. Ordres : poser des ordres d’achat et de vente (frais de 2,5 %)."
      >
        <Segmented
          id={`${id}-mode`}
          label="Mode d’échange"
          value={s.mode}
          onChange={(v) => update({ mode: v })}
          options={[
            { v: 'instant', label: 'Instantané' },
            { v: 'orders', label: 'Ordres' },
          ]}
        />
      </Field>
      <Field id={`${id}-share`} label="Part de marché" help="Part du volume quotidien que vous pensez pouvoir vendre.">
        <NumberInput
          id={`${id}-share`}
          value={Math.round(s.marketShare * 1000) / 10}
          min={0}
          max={100}
          step={1}
          suffix="%"
          onChange={(n) => update({ marketShare: Math.min(100, Math.max(0, n)) / 100 })}
        />
      </Field>
      <Field id={`${id}-cap`} label="Plafond par jour" help="Nombre maximum d’unités que vous produirez par jour et par objet.">
        <NumberInput id={`${id}-cap`} value={s.dailyCap} min={1} step={10} suffix="u." onChange={(n) => update({ dailyCap: n })} />
      </Field>
      <Field id={`${id}-age`} label="Âge maximal des prix" help="Les prix plus vieux sont ignorés dans les calculs.">
        <NumberInput id={`${id}-age`} value={s.maxPriceAgeH} min={1} max={48} step={1} suffix="h" onChange={(n) => update({ maxPriceAgeH: n })} />
      </Field>
      <Field id={`${id}-vol`} label="Volume minimum" help="Ventes quotidiennes minimales au lieu de vente pour retenir une route.">
        <NumberInput id={`${id}-vol`} value={s.minVolume} min={0} step={5} suffix="/j" onChange={(n) => update({ minVolume: n })} />
      </Field>
      <Field
        id={`${id}-fallback`}
        label="Utiliser la moyenne 7 jours quand le prix récent manque (prix estimé)"
        help="Si aucun prix récent n’est disponible, la moyenne sur 7 jours du même lieu est utilisée (au moins 3 jours d’historique). Les routes concernées portent le badge « Estimé » et leur confiance est plafonnée à 0,60."
      >
        <Toggle id={`${id}-fallback`} checked={s.historyFallback} onChange={(b) => update({ historyFallback: b })} />
      </Field>
      <Field
        id={`${id}-stale`}
        label="Afficher les prix périmés (plus vieux que l’âge maximal)"
        help="Les routes qui n’existent que grâce à des prix trop vieux apparaissent avec une pastille ambre « Prix de 9 h » et une confiance divisée par deux. Les prix de plus de 7 jours restent ignorés."
      >
        <Toggle id={`${id}-stale`} checked={s.showStale} onChange={(b) => update({ showStale: b })} />
      </Field>
      <div className="settings-actions">
        <button type="button" className="btn" onClick={reset}>
          Réinitialiser les réglages
        </button>
      </div>
    </div>
  );
}
