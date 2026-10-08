// Périmètre des ID à collecter : toutes les sorties et tous les ingrédients des recettes.
import type { RecipesFile } from '../src/types';

export function collectIds(recipesFile: RecipesFile): string[] {
  const ids = new Set<string>();
  for (const r of recipesFile.recipes ?? []) {
    if (r.outputId) ids.add(r.outputId);
    for (const i of r.inputs ?? []) if (i.id) ids.add(i.id);
  }
  return [...ids].sort();
}
