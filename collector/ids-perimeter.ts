// Périmètre des ID à collecter : toutes les sorties et tous les ingrédients des recettes.
import type { RecipesFile } from '../src/types';
import { farmingIds } from './farming';

export function collectIds(recipesFile: RecipesFile): string[] {
  const ids = new Set<string>();
  for (const r of recipesFile.recipes ?? []) {
    if (r.outputId) ids.add(r.outputId);
    for (const i of r.inputs ?? []) if (i.id) ids.add(i.id);
  }
  // Fermes des îles (générateur ≥ 3) : graines, récoltes, animaux, produits, viandes.
  for (const id of farmingIds(recipesFile.farming)) ids.add(id);
  return [...ids].sort();
}
