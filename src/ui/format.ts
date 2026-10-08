// Formatage et libellés français partagés par l'interface.
import type { Location, RouteResult } from '../types';

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
};

/** Traductions des sous-catégories de boutique les plus courantes ; repli sur l'identifiant brut. */
const SUBCAT_FR: Record<string, string> = {
  planks: 'Planches',
  metalbar: 'Lingots',
  leather: 'Cuir',
  cloth: 'Tissu',
  stoneblock: 'Blocs de pierre',
  wood: 'Bois',
  ore: 'Minerai',
  hide: 'Peaux',
  fiber: 'Fibres',
  rock: 'Pierre',
  bag: 'Sacs',
  cape: 'Capes',
  sword: 'Épées',
  axe: 'Haches',
  mace: 'Masses',
  hammer: 'Marteaux',
  spear: 'Lances',
  dagger: 'Dagues',
  quarterstaff: 'Bâtons de combat',
  bow: 'Arcs',
  crossbow: 'Arbalètes',
  firestaff: 'Bâtons de feu',
  holystaff: 'Bâtons sacrés',
  arcanestaff: 'Bâtons arcaniques',
  froststaff: 'Bâtons de givre',
  cursestaff: 'Bâtons maudits',
  naturestaff: 'Bâtons de nature',
  knuckles: 'Gantelets',
  shapeshifterstaff: 'Bâtons de métamorphe',
  plate_armor: 'Armures de plaques',
  plate_helmet: 'Casques de plaques',
  plate_shoes: 'Bottes de plaques',
  leather_armor: 'Vestes de cuir',
  leather_helmet: 'Capuches de cuir',
  leather_shoes: 'Chaussures de cuir',
  cloth_armor: 'Robes de tissu',
  cloth_helmet: 'Capuchons de tissu',
  cloth_shoes: 'Sandales de tissu',
  shield: 'Boucliers',
  book: 'Grimoires',
  orb: 'Orbes',
  torch: 'Torches',
  totem: 'Totems',
  horn: 'Cors',
  gatherergear: 'Équipement de récolte',
  tools: 'Outils',
  potions: 'Potions',
  food: 'Nourriture',
  mount: 'Montures',
};
export const subcatLabel = (s: string): string => SUBCAT_FR[s] ?? SUBCAT_FR[s.toLowerCase()] ?? s.replace(/_/g, ' ');

export const iconUrl = (id: string, size = 64): string =>
  `https://render.albiononline.com/v1/item/${id.replace(/@/g, '%40')}.png?size=${size}`;

export const itemHref = (id: string): string => `#/item/${encodeURIComponent(id)}`;
