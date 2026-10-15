// Mode du site : « Joueur » (classements pour tous) ou « Guilde » (outils des officiers de Varwyn).
// Préférence locale (localStorage), reflétée sur <html data-mode="…"> pour les jetons CSS.
import type { RouteName } from '../components/Shell';

export type Mode = 'player' | 'guild';
export const MODE_KEY = 'ami.mode';

export const GUILD_ROUTES: readonly RouteName[] = ['guilde', 'guilde-investir', 'guilde-prets', 'guilde-reglages'];

export function isGuildRoute(name: RouteName): boolean {
  return (GUILD_ROUTES as readonly string[]).includes(name) || name === 'investir';
}

/** Routes qui n'imposent aucun mode (fiche objet ouverte depuis l'un ou l'autre). */
export function isNeutralRoute(name: RouteName): boolean {
  return name === 'item';
}

/** Mode imposé par une route (null = garder le mode courant). */
export function modeForRoute(name: RouteName): Mode | null {
  if (isNeutralRoute(name)) return null;
  return isGuildRoute(name) ? 'guild' : 'player';
}

export function readStoredMode(): Mode {
  try {
    return window.localStorage.getItem(MODE_KEY) === 'guild' ? 'guild' : 'player';
  } catch {
    return 'player';
  }
}

export function storeMode(mode: Mode): void {
  try {
    window.localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* préférence en mémoire seulement */
  }
}

/** Page d'arrivée de chaque mode. */
export const MODE_HOME: Record<Mode, string> = { player: '#/', guild: '#/guilde' };
