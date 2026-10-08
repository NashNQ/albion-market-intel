import { useMemo, useState } from 'react';
import type { Recipe, RecipesFile } from '../../../types';
import { recipeLookup, recipeVariantOf } from '../../../engine/chain-index';
import { ItemIcon } from '../ItemIcon';

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u02BC`]/g, "'");

export function AddStep({ recipes, onAdd }: { recipes: RecipesFile; onAdd: (r: Recipe) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [crafting, setCrafting] = useState(false);
  const lookup = recipeLookup(recipes);
  const matches = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const out: Recipe[] = [];
    for (const r of recipes.recipes) {
      if (r.kind === 'crafting' && !crafting) continue;
      if (recipeVariantOf(r) !== undefined) continue;
      const tierTag = `t${r.tier}${r.enchant ? '.' + r.enchant : ''}`;
      const hay = norm(`${lookup.meta.get(r.outputId)?.nameFr ?? ''} ${r.outputId} ${tierTag}`);
      if (words.every((w) => hay.includes(w))) {
        out.push(r);
        if (out.length >= 30) break;
      }
    }
    return out;
  }, [q, crafting, recipes, lookup]);

  if (!open)
    return (
      <button type="button" className="btn rb-add" onClick={() => setOpen(true)}>
        + Ajouter une étape
      </button>
    );
  return (
    <div className="rb-addstep">
      <div className="rb-addstep-bar">
        <label className="rb-field rb-grow">
          <span className="rb-field-label">Objet à produire</span>
          <input
            type="search"
            value={q}
            autoFocus
            placeholder="ex. planches t5, lingots t6.1…"
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <label className="rb-check">
          <input type="checkbox" checked={crafting} onChange={(e) => setCrafting(e.target.checked)} />
          Inclure le craft d’équipement
        </label>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
          Fermer
        </button>
      </div>
      <p className="rb-hint">Les ingrédients déjà produits par une étape de la route y sont reliés automatiquement.</p>
      {q.trim() !== '' && matches.length === 0 && <p className="muted">Aucune recette ne correspond.</p>}
      {matches.length > 0 && (
        <ul className="rb-matches">
          {matches.map((r) => {
            const name = lookup.meta.get(r.outputId)?.nameFr ?? r.outputId;
            return (
              <li key={r.outputId}>
                <button
                  type="button"
                  className="rb-match"
                  onClick={() => {
                    onAdd(r);
                    setQ('');
                    setOpen(false);
                  }}
                >
                  <ItemIcon id={r.outputId} name="" size={28} />
                  <span>{name}</span>
                  <span className="muted">
                    T{r.tier}
                    {r.enchant ? `.${r.enchant}` : ''}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
