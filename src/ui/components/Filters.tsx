import { useId } from 'react';
import type { ItemMeta, RouteResult } from '../../types';
import { subcatLabel } from '../format';

export interface FilterState {
  q: string;
  subcat: string;
  tier: string;
  enchant: string;
  noRedZone: boolean;
}

export const EMPTY_FILTERS: FilterState = { q: '', subcat: '', tier: '', enchant: '', noRedZone: false };

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export function applyFilters(rows: RouteResult[], f: FilterState, meta: Map<string, ItemMeta>): RouteResult[] {
  const q = norm(f.q.trim());
  return rows.filter((r) => {
    if (f.noRedZone && r.flags.includes('red-zone')) return false;
    if (f.subcat && r.recipe.subcategory !== f.subcat) return false;
    if (f.tier && String(r.recipe.tier) !== f.tier) return false;
    if (f.enchant && String(r.recipe.enchant) !== f.enchant) return false;
    if (q) {
      const m = meta.get(r.recipe.outputId);
      const hay = norm(`${m?.nameFr ?? ''} ${m?.nameEn ?? ''} ${r.recipe.outputId}`);
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function Filters({
  rows,
  value,
  onChange,
}: {
  rows: RouteResult[];
  value: FilterState;
  onChange: (f: FilterState) => void;
}) {
  const id = useId();
  const subcats = [...new Set(rows.map((r) => r.recipe.subcategory))].sort((a, b) =>
    subcatLabel(a).localeCompare(subcatLabel(b), 'fr'),
  );
  const tiers = [...new Set(rows.map((r) => r.recipe.tier))].sort((a, b) => a - b);
  const enchants = [...new Set(rows.map((r) => r.recipe.enchant))].sort((a, b) => a - b);
  const set = (p: Partial<FilterState>) => onChange({ ...value, ...p });
  const active = value.q || value.subcat || value.tier || value.enchant || value.noRedZone;

  return (
    <form className="filters" role="search" onSubmit={(e) => e.preventDefault()}>
      <label className="f-search" htmlFor={`${id}-q`}>
        <span className="f-label">Rechercher</span>
        <input
          id={`${id}-q`}
          type="search"
          placeholder="Nom de l’objet…"
          value={value.q}
          onChange={(e) => set({ q: e.target.value })}
        />
      </label>
      <label htmlFor={`${id}-cat`}>
        <span className="f-label">Catégorie</span>
        <select id={`${id}-cat`} value={value.subcat} onChange={(e) => set({ subcat: e.target.value })}>
          <option value="">Toutes</option>
          {subcats.map((s) => (
            <option key={s} value={s}>
              {subcatLabel(s)}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={`${id}-tier`}>
        <span className="f-label">Tier</span>
        <select id={`${id}-tier`} value={value.tier} onChange={(e) => set({ tier: e.target.value })}>
          <option value="">Tous</option>
          {tiers.map((t) => (
            <option key={t} value={t}>
              T{t}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={`${id}-ench`}>
        <span className="f-label">Enchantement</span>
        <select id={`${id}-ench`} value={value.enchant} onChange={(e) => set({ enchant: e.target.value })}>
          <option value="">Tous</option>
          {enchants.map((t) => (
            <option key={t} value={t}>
              .{t}
            </option>
          ))}
        </select>
      </label>
      <label className="f-check" htmlFor={`${id}-red`}>
        <input
          id={`${id}-red`}
          type="checkbox"
          checked={value.noRedZone}
          onChange={(e) => set({ noRedZone: e.target.checked })}
        />
        <span>Exclure la zone rouge</span>
      </label>
      {active && (
        <button type="button" className="btn-ghost" onClick={() => onChange(EMPTY_FILTERS)}>
          Effacer les filtres
        </button>
      )}
    </form>
  );
}
