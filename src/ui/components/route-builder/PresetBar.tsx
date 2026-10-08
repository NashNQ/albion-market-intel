import { useState } from 'react';
import type { RecipesFile } from '../../../types';
import { FAMILIES, buildPreset, type RefiningFamilyKey, type Step } from '../../../engine/chain-index';

export interface PresetChoice {
  family: RefiningFamilyKey;
  from: number;
  to: number;
  enchant: number;
}

export const presetName = (c: PresetChoice): string => {
  const label = FAMILIES[c.family].label.split(' → ')[1];
  const e = c.enchant > 0 ? `.${c.enchant}` : '';
  return `${label} T${c.from}${c.from >= 4 ? e : ''} → T${c.to}${e}`;
};

export function PresetBar({ recipes, onApply }: { recipes: RecipesFile; onApply: (steps: Step[], c: PresetChoice) => void }) {
  const [c, setC] = useState<PresetChoice>({ family: 'wood', from: 2, to: 4, enchant: 0 });
  const [error, setError] = useState<string | null>(null);
  const maxE = FAMILIES[c.family].maxEnchant;
  const set = (patch: Partial<PresetChoice>) => {
    setError(null);
    setC((prev) => {
      const next = { ...prev, ...patch };
      if (next.enchant > FAMILIES[next.family].maxEnchant) next.enchant = FAMILIES[next.family].maxEnchant;
      if (next.to < next.from) next.to = Math.max(3, next.from);
      return next;
    });
  };
  const apply = () => {
    const r = buildPreset(recipes, c.family, c.from, c.to, c.enchant);
    if (!r.ok) setError(r.error);
    else onApply(r.steps, c);
  };
  return (
    <div className="rb-preset" role="group" aria-label="Préréglage de raffinage">
      <label className="rb-field">
        <span className="rb-field-label">Famille</span>
        <select value={c.family} onChange={(e) => set({ family: e.target.value as RefiningFamilyKey })}>
          {(Object.keys(FAMILIES) as RefiningFamilyKey[]).map((k) => (
            <option key={k} value={k}>
              {FAMILIES[k].label}
            </option>
          ))}
        </select>
      </label>
      <label className="rb-field">
        <span className="rb-field-label">Tier de départ</span>
        <select value={c.from} onChange={(e) => set({ from: Number(e.target.value) })}>
          {[2, 3, 4, 5, 6, 7].map((t) => (
            <option key={t} value={t}>
              T{t}
            </option>
          ))}
        </select>
      </label>
      <label className="rb-field">
        <span className="rb-field-label">Tier d’arrivée</span>
        <select value={c.to} onChange={(e) => set({ to: Number(e.target.value) })}>
          {[3, 4, 5, 6, 7, 8]
            .filter((t) => t >= c.from)
            .map((t) => (
              <option key={t} value={t}>
                T{t}
              </option>
            ))}
        </select>
      </label>
      <label className="rb-field">
        <span className="rb-field-label">Enchantement</span>
        <select value={c.enchant} onChange={(e) => set({ enchant: Number(e.target.value) })} disabled={maxE === 0}>
          {Array.from({ length: maxE + 1 }, (_, e) => (
            <option key={e} value={e}>
              {e === 0 ? 'Aucun' : `.${e}`}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="btn rb-primary" onClick={apply}>
        Générer la chaîne
      </button>
      {c.enchant > 0 && c.from < 4 && (
        <p className="rb-hint">Les tiers 2 et 3 n’existent pas en enchanté : le T4 enchanté utilise le T3 normal.</p>
      )}
      {error && (
        <p className="rb-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
