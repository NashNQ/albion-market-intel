// Aides de la page « Prêts sur gage » : libellés, dates, verdict, résumé Discord neutralisé.
import type { ItemMeta, MarketItem, Settings } from '../../../types';
import { HEALTH_LABEL, valueCollateral, type LoanEvaluation, type LoanHealth } from '../../../engine/pawn';
import { fmtCompact } from '../charts/HistoryChart';
import { fmtPct, fmtSilver } from '../../format';
import { discordSafe } from '../invest/shared';

export { discordSafe };

const thin = (s: string) => s.replace(/[  ]/g, ' ');
const fmtDayShort = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtDayFull = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** « 22 oct. » (jour UTC). */
export const fmtDay = (iso: string | null | undefined): string =>
  iso ? thin(fmtDayShort.format(new Date(iso + 'T00:00:00Z'))) : '—';
/** « 22 octobre 2026 ». */
export const fmtDayLong = (iso: string | null | undefined): string =>
  iso ? thin(fmtDayFull.format(new Date(iso + 'T00:00:00Z'))) : '—';

/** Argent en notation courte : « 12 500 ag », « 125 k ag », « 1,23 M ag ». */
export const fmtSilverShort = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? '—' : `${fmtCompact(n)} ag`;

/** Arrondi vers le bas à 3 chiffres significatifs (un plafond affiché ne doit jamais dépasser le vrai plafond). */
export function roundDownNice(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n < 1000) return Math.floor(n);
  const mag = 10 ** (Math.floor(Math.log10(n)) - 2);
  return Math.floor(n / mag) * mag;
}

/** « +1,2 %/jour », « −0,8 %/jour ». */
export function fmtPerDay(x: number): string {
  if (!Number.isFinite(x)) return '—';
  const s = fmtPct(Math.abs(x), 1);
  return `${x > 0.00005 ? '+' : x < -0.00005 ? '−' : ''}${s}/jour`;
}

export function itemLabel(id: string, metaById: Map<string, ItemMeta>): string {
  const m = metaById.get(id);
  const tier = /^T(\d)/.exec(id)?.[1];
  const ench = /@(\d)$/.exec(id)?.[1];
  const tag = m ? `T${m.tier}${m.enchant ? '.' + m.enchant : ''}` : tier ? `T${tier}${ench && ench !== '0' ? '.' + ench : ''}` : '';
  return `${m?.nameFr ?? id}${tag ? ` (${tag})` : ''}`;
}

export const HEALTH_TEXT = HEALTH_LABEL;

/** Valeur nette unitaire de revente rapide (pour summarizeLoans du tableau de bord). */
export function loanValueOf(
  itemById: Map<string, MarketItem>,
  settings: Pick<Settings, 'premium' | 'maxPriceAgeH'>,
  now: Date,
): (itemId: string) => number | null {
  return (id) => valueCollateral(itemById.get(id), 1, { premium: settings.premium, maxPriceAgeH: settings.maxPriceAgeH, now }).quick?.unitNet ?? null;
}

/** Verdict en une ou deux phrases (formulaire). */
export function loanVerdict(ev: LoanEvaluation, today: string): string {
  if (ev.v0 == null) return 'Aucun prix exploitable pour ce gage : impossible de conseiller un montant. Vérifiez les prix en jeu avant de prêter.';
  const max = fmtSilverShort(roundDownNice(ev.maxLoan ?? 0));
  if (ev.insufficientNow)
    return `Gage insuffisant : sa valeur prudente (marge déduite) est déjà sous le montant dû de ${fmtSilver(ev.due)}. Prêtez au plus ${max} ou demandez un gage plus important.`;
  const head = `Prêtez au plus ${max}. Retour idéal avant le ${fmtDay(ev.idealDate)}`;
  if (ev.coveredBeyondHorizon || ev.limitDate == null) return `${head} ; le gage couvre largement le dû, même à 90 jours.`;
  const lastSafe = ev.limitDate <= today ? today : new Date(Date.parse(ev.limitDate + 'T00:00:00Z') - 86_400_000).toISOString().slice(0, 10);
  if (lastSafe <= today) return `${head} ; dès demain, gardez plutôt le gage.`;
  return `${head} ; au-delà du ${fmtDay(lastSafe)}, gardez plutôt le gage.`;
}

export interface LoanDiscordInput {
  guildName: string;
  borrower: string;
  item: string;
  qty: number;
  amount: number;
  rate: number;
  due: number;
  quickValue: number | null;
  dueDate: string;
  idealDate: string | null;
  limitDate: string | null;
  health: LoanHealth;
  url: string;
}

/** Résumé court en Markdown Discord : textes libres neutralisés (@everyone, @here, <@id>, mise en forme). */
export function loanDiscordSummary(d: LoanDiscordInput): string {
  const lines = [
    `**Prêt sur gage — ${discordSafe(d.guildName)}**`,
    `• Emprunteur : ${discordSafe(d.borrower)}`,
    `• Gage : ${d.qty.toLocaleString('fr-FR').replace(/[  ]/g, ' ')} × ${discordSafe(d.item)} · revente rapide ${d.quickValue == null ? 'non évaluée' : '≈ ' + fmtSilver(d.quickValue)}`,
    `• Prêté : ${fmtSilver(d.amount)} · intérêt ${fmtPct(d.rate, 1)} → dû ${fmtSilver(d.due)}`,
    `• Échéance : ${fmtDay(d.dueDate)}${d.limitDate ? ` · dès le ${fmtDay(d.limitDate)} sans remboursement, la guilde garde le gage` : ''}`,
    `• Statut : ${HEALTH_LABEL[d.health]}`,
    `<${d.url}>`,
  ];
  return lines.join('\n');
}
