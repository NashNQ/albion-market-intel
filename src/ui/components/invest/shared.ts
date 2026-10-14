// Aides partagées de la page « Investir » : libellés, verdict, résumé Discord, copie dans le presse-papiers.
import type { ItemMeta, Recipe } from '../../../types';
import { paybackKind, type ScenarioKey, type ScenarioResult } from '../../../engine/invest';
import type { RouteFailure } from '../../../engine/route';
import { fmt1, fmtInt, fmtPct, fmtSilver } from '../../format';

export const recipeKeyOf = (r: Pick<Recipe, 'outputId' | 'variant'>) => r.outputId + (r.variant ? `|${r.variant}` : '');

export function tierTag(r: Pick<Recipe, 'tier' | 'enchant'>): string {
  return `T${r.tier}${r.enchant ? '.' + r.enchant : ''}`;
}

export function recipeLabel(r: Pick<Recipe, 'outputId' | 'variant' | 'tier' | 'enchant'>, metaById: Map<string, ItemMeta>): string {
  const name = metaById.get(r.outputId)?.nameFr ?? r.outputId;
  const alt = r.variant ? `, recette ${metaById.get(r.variant)?.nameFr ?? r.variant}` : '';
  return `${name} (${tierTag(r)}${alt})`;
}

/** Unités par jour : entier si la valeur l'est (à 0,1 près), sinon une décimale (« 83,3 »), pour que « unités × profit » se vérifie. */
export function fmtUnits(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return Math.abs(n - Math.round(n)) < 0.05 ? fmtInt(n) : fmt1(n);
}

/** Texte libre placé dans un message Discord : neutralise les mentions (@everyone, @here, <@id>) et la mise en forme. */
export function discordSafe(s: string): string {
  return s
    .replace(/[\\*_~`|>]/g, (c) => '\\' + c)
    .replace(/@/g, '@\u200b')
    .replace(/</g, '‹')
    .replace(/[\r\n]+/g, ' ');
}

/** « ≈ 23 jours », « plus d'un an », « jamais ». */
export function fmtPayback(days: number | null): string {
  const k = paybackKind(days);
  if (k === 'never') return 'jamais';
  if (k === 'overYear') return 'plus d’un an';
  const d = Math.max(0, Math.ceil(days as number));
  return d <= 1 ? `≈ ${d} jour` : `≈ ${fmtInt(d)} jours`;
}

/** Pourcentage signé : « +12 % », « −40 % ». */
export function fmtSignedPct(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const s = fmtPct(Math.abs(n), 0);
  return (n > 0.0005 ? '+' : n < -0.0005 ? '−' : '') + s;
}

const paybackPhrase = (days: number | null): string => {
  const k = paybackKind(days);
  if (k === 'never') return 'jamais';
  if (k === 'overYear') return 'en plus d’un an';
  return `en ${fmtPayback(days)}`;
};

/** Verdict en une phrase à partir des scénarios central et prudent. */
export function verdict(s: Record<ScenarioKey, ScenarioResult>): string {
  const c = s.central.paybackTotal;
  const p = s.prudent.paybackTotal;
  if (paybackKind(c) === 'never') return 'Dans le scénario central, la part de l’investisseur ne rembourse jamais le capital.';
  const prudent =
    paybackKind(p) === 'never'
      ? 'jamais en prudent'
      : paybackKind(p) === 'overYear'
        ? 'plus d’un an en prudent'
        : `${fmtPayback(p).replace('≈ ', '')} en prudent`;
  return `Votre capital revient ${paybackPhrase(c)} dans le scénario central, ${prudent}.`;
}

export const FAILURE_TEXT: Record<RouteFailure, string> = {
  missing: 'Prix manquants pour cet objet ou ses matières : impossible de chiffrer cet investissement.',
  stale: 'Les prix de cet objet ou de ses matières sont plus vieux que l’âge maximal réglé : aucun chiffre présenté.',
  suspect: 'Le prix de vente est jugé suspect (écart anormal à la moyenne sur 7 jours) : aucun chiffre présenté.',
  lowVolume: 'Ventes trop faibles au lieu de vente (sous le volume minimal réglé) : pas de débouché fiable à financer.',
  unprofitable: 'Cette activité n’est pas rentable aux prix du moment et aux réglages courants : il n’y a pas de profit à partager.',
};

export interface DiscordInput {
  member: string;
  activity: string;
  capital: number;
  investorShare: number;
  payback: number | null;
  roi30: number | null;
  url: string;
}

/** Résumé court en Markdown Discord (le lien entre chevrons n'affiche pas d'aperçu). */
export function discordSummary(d: DiscordInput): string {
  return [
    `**Investissement de guilde — ${discordSafe(d.member)}**`,
    `• Activité : ${discordSafe(d.activity)}`,
    `• Capital : ${fmtSilver(d.capital)} · part investisseur ${fmtPct(d.investorShare, 0)}`,
    `• Point mort : ${fmtPayback(d.payback)} (central) · ROI 30 j : ${d.roi30 == null ? '—' : fmtSignedPct(d.roi30)}`,
    `<${d.url}>`,
  ].join('\n');
}

/** Copie un texte ; false si le presse-papiers est indisponible ou refusé (repli : zone de texte sélectionnée). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* repli */
  }
  return false;
}
