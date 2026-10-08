// Taux de retour de ressources (RRR) — fonctions pures.
import type { BonusTable, Location, Recipe, Settings } from '../types';

export const DEFAULT_BASE_BONUS = 0.18;
export const FOCUS_BONUS = 0.59;

/** RRR à partir du bonus total : bonus / (1 + bonus). */
export function rrr(bonus: number): number {
  if (!(bonus > 0)) return 0;
  return bonus / (1 + bonus);
}

/** Bonus total de production d'une recette dans un lieu (base + modificateur + focus + bonus quotidien). */
export function productionBonus(
  recipe: Pick<Recipe, 'kind' | 'bonusKey'>,
  location: Location,
  bonuses: BonusTable,
  settings: Pick<Settings, 'focus' | 'dailyBonus'>,
): number {
  const lb = bonuses[location];
  const base = lb ? (recipe.kind === 'refining' ? lb.refiningBase : lb.craftingBase) : DEFAULT_BASE_BONUS;
  const modifier = lb?.modifiers?.[recipe.bonusKey] ?? 0;
  const focus = settings.focus ? FOCUS_BONUS : 0;
  return (Number.isFinite(base) ? base : DEFAULT_BASE_BONUS) + modifier + focus + (settings.dailyBonus ?? 0);
}

/** RRR d'une recette dans un lieu donné. */
export function recipeRrr(
  recipe: Pick<Recipe, 'kind' | 'bonusKey'>,
  location: Location,
  bonuses: BonusTable,
  settings: Pick<Settings, 'focus' | 'dailyBonus'>,
): number {
  return rrr(productionBonus(recipe, location, bonuses, settings));
}
