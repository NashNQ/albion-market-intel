// Formatage et libellés français partagés par l'interface.
import type { Location, RouteResult } from '../types';
import { categoryLabel, subcategoryLabel } from './i18n';

const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

/** Remplace l'espace insécable fr-FR par une espace fine insécable (U+202F). */
const thin = (s: string) => s.replace(/[   ]/g, ' ');

export const fmtInt = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? '—' : thin(nf0.format(n));
export const fmt1 = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? '—' : thin(nf1.format(n));
export const fmt2 = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? '—' : thin(nf2.format(n));
export const fmtSilver = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? '—' : `${fmtInt(n)} ag`;
export const fmtPct = (n: number | null | undefined, digits = 1): string =>
  n == null || !Number.isFinite(n)
    ? '—'
    : thin(new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits }).format(n * 100)) + ' %';

/** Âge en heures → « 35 min », « 2 h 05 », « 3 j ». */
export function fmtAgeH(h: number | null | undefined): string {
  if (h == null || !Number.isFinite(h)) return '—';
  if (h < 1) return `${Math.max(0, Math.round(h * 60))} min`;
  if (h < 48) {
    const H = Math.floor(h);
    const M = Math.round((h - H) * 60);
    return M === 0 || M === 60 ? `${M === 60 ? H + 1 : H} h` : `${H} h ${String(M).padStart(2, '0')}`;
  }
  return `${Math.round(h / 24)} j`;
}

export function ageHFromIso(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.max(0, (now.getTime() - t) / 3_600_000);
}

export const fmtClock = (d: Date): string =>
  d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

export const LOC_ABBR: Record<Location, string> = {
  Bridgewatch: 'BW',
  'Fort Sterling': 'FS',
  Lymhurst: 'LYM',
  Martlock: 'MAR',
  Thetford: 'TH',
  Brecilien: 'BRE',
  Caerleon: 'CAE',
  'Black Market': 'BM',
};

/** Classe CSS (couleur héraldique) par lieu. */
export const LOC_KEY: Record<Location, string> = {
  Bridgewatch: 'bw',
  'Fort Sterling': 'fs',
  Lymhurst: 'lym',
  Martlock: 'mar',
  Thetford: 'th',
  Brecilien: 'bre',
  Caerleon: 'cae',
  'Black Market': 'bm',
};

export const FLAG_LABEL: Record<RouteResult['flags'][number], { short: string; long: string }> = {
  'red-zone': { short: 'Zone rouge', long: 'La route passe par Caerleon ou le Black Market : trajet en zone rouge (risque de perte totale).' },
  mists: { short: 'Brumes', long: 'La route passe par Brecilien, accessible uniquement par les Brumes.' },
  'thin-history': { short: 'Historique mince', long: 'Moins de 5 jours de ventes sur 7 au lieu de vente : volume peu fiable.' },
  suspect: { short: 'Suspect', long: 'Prix de vente anormalement élevé par rapport à la moyenne sur 7 jours.' },
  estimated: {
    short: 'Estimé',
    long: 'Au moins un prix récent manquait : la moyenne sur 7 jours du même lieu a été utilisée (prix estimé). Confiance plafonnée à 0,60.',
  },
  stale: {
    short: 'Périmé',
    long: 'Cette route n’existe que grâce à des prix plus vieux que l’âge maximal réglé : le marché a pu changer depuis. Confiance divisée par deux.',
  },
};

/**
 * Code couleur unique de l'âge d'un prix :
 * - 'fresh' : moins d'une heure ;
 * - 'ok'    : moins que l'âge maximal réglé ;
 * - 'stale' : au moins l'âge maximal (ambre, « périmé ») ;
 * - 'old'   : 24 h ou plus (grisé).
 */
export type AgeTone = 'fresh' | 'ok' | 'stale' | 'old';
export function ageTone(ageH: number, maxAgeH: number): AgeTone {
  if (!Number.isFinite(ageH) || ageH >= 24) return 'old';
  if (ageH >= maxAgeH) return 'stale';
  if (ageH < 1) return 'fresh';
  return 'ok';
}
export const AGE_TONE_TITLE: Record<AgeTone, string> = {
  fresh: 'Prix récent (moins d’une heure)',
  ok: 'Prix utilisable (plus jeune que l’âge maximal réglé)',
  stale: 'Prix périmé (plus vieux que l’âge maximal réglé)',
  old: 'Prix très ancien (24 h ou plus)',
};

/** Niveau de confiance lisible (mêmes seuils que la barre de confiance). */
export type ConfidenceLevel = 'élevée' | 'moyenne' | 'faible';
export const confidenceLevel = (c: number): ConfidenceLevel => (c >= 0.85 ? 'élevée' : c >= 0.65 ? 'moyenne' : 'faible');

/** Libellé français d'une sous-catégorie (délègue à i18n.ts, repli sur l'ID brut). */
export const subcatLabel = (s: string): string => subcategoryLabel(s);
export { categoryLabel, subcategoryLabel };

/**
 * Accord en nombre : plural(1, 'route rentable') → « 1 route rentable »,
 * plural(3, 'route rentable') → « 3 routes rentables ». Chaque mot reçoit un « s »
 * (sauf s'il finit déjà par s, x ou z) ; `pluralForm` force la forme plurielle.
 * Règle française : 0 et 1 au singulier.
 */
export function plural(n: number, singular: string, pluralForm?: string): string {
  const many = Math.abs(n) >= 2;
  const word = many ? (pluralForm ?? singular.split(' ').map((w) => (/[sxz]$/i.test(w) || w === '' ? w : w + 's')).join(' ')) : singular;
  return `${fmtInt(n)} ${word}`;
}

export const iconUrl = (id: string, size = 64): string =>
  `https://render.albiononline.com/v1/item/${id.replace(/@/g, '%40')}.png?size=${size}`;

export const itemHref = (id: string): string => `#/item/${encodeURIComponent(id)}`;
