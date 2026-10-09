// Panneau « Pourquoi ce classement ? » : explique en phrases le calcul d'une ligne.
import type { RouteResult, Settings } from '../../types';
import { saleDeduction, stationFee } from '../../engine/cost';
import { confidenceLevel, fmt2, fmtAgeH, fmtInt, fmtPct, fmtSilver } from '../format';
import { buyLocations } from './Route';

export interface RouteBreakdown {
  /** Prix de vente brut par unité. */
  gross: number;
  /** Taxe + frais d'ordre à la vente, par unité. */
  taxes: number;
  /** Achats d'ingrédients par unité (après retour de ressources). */
  purchases: number;
  /** Frais de station par unité. */
  fee: number;
  /** Profit par jour sans pondération (profit/unité × Q), null au Black Market. */
  dailyProfit: number | null;
  /** Capital pour une journée de production (coût/unité × Q), null au Black Market. */
  dailyCapital: number | null;
  /** Vrai si Q est limité par le plafond quotidien. */
  capped: boolean;
}

export function routeBreakdown(r: RouteResult, s: Settings): RouteBreakdown {
  const bm = r.sellAt === 'Black Market';
  const ded = saleDeduction(s, bm);
  const gross = ded < 1 ? r.unitRevenue / (1 - ded) : r.unitRevenue;
  const fee = stationFee(r.recipe.itemValue, s.stationFee) / (r.recipe.outputQty > 0 ? r.recipe.outputQty : 1);
  const q = r.q;
  return {
    gross,
    taxes: gross - r.unitRevenue,
    purchases: Math.max(0, r.unitCost - fee),
    fee,
    dailyProfit: q == null ? null : r.unitProfit * q,
    dailyCapital: q == null ? null : r.unitCost * q,
    capped: q != null && r.volume != null && r.volume * s.marketShare > s.dailyCap,
  };
}

/** Raisons lisibles du niveau de confiance. */
export function confidenceReasons(r: RouteResult, s: Settings): string[] {
  const out: string[] = [];
  const age = r.oldestPriceAgeH;
  if (r.flags.includes('stale'))
    out.push(
      `certains prix sont périmés (${fmtAgeH(age)}, au-delà de votre limite de ${fmtAgeH(s.maxPriceAgeH)}) : confiance divisée par deux`,
    );
  else if (age <= 1) out.push('les prix utilisés ont moins d’une heure');
  else out.push(`le prix le plus vieux utilisé a ${fmtAgeH(age)}`);
  if (r.flags.includes('estimated')) out.push('au moins un prix est estimé à partir de la moyenne sur 7 jours');
  if (r.flags.includes('thin-history')) out.push(`l’historique de ventes à ${r.sellAt} est mince (moins de 5 jours sur 7)`);
  if (r.flags.includes('suspect')) out.push('le profit est invraisemblable (plus de 500 % du coût) : un prix est probablement un piège ou une erreur de collecte');
  return out;
}

const joinFr = (parts: string[]): string =>
  parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} et ${parts[parts.length - 1]}`;

export function RouteDetail({ r, settings: s, id }: { r: RouteResult; settings: Settings; id?: string }) {
  const b = routeBreakdown(r, s);
  const bm = r.sellAt === 'Black Market';
  const buys = buyLocations(r);
  const level = confidenceLevel(r.confidence);
  return (
    <div className="route-detail" id={id}>
      <p>
        <strong>Vous gagnez {fmtSilver(r.unitProfit)} par unité</strong> (vente {fmtSilver(b.gross)} − taxes{' '}
        {fmtSilver(b.taxes)} − achats {fmtSilver(b.purchases)} − frais de station {fmtSilver(b.fee)}).
      </p>
      <p className="rd-path">
        Achat à {buys.join(', ') || '—'}, production à {r.craftAt} (retour de ressources {fmtPct(r.rrr)}), vente à{' '}
        {r.sellAt}.
      </p>
      {bm ? (
        <p>
          Le Black Market a acheté ≈ {fmtInt(r.volume)} unités/jour ces 7 derniers jours, sans aucune garantie : il ne
          publie pas de volume fiable. Capital nécessaire pour 10 unités : {fmtSilver(r.unitCost * 10)}.
        </p>
      ) : (
        <>
          <p>
            Le marché de {r.sellAt} écoule ≈ {fmtInt(r.volume)} unités/jour ; avec votre part de {fmtPct(s.marketShare)}, vous
            en vendez ≈ {fmtInt(r.q)}/jour
            {b.capped ? ` (plafonné à ${fmtInt(s.dailyCap)}/jour)` : ''} → ≈ {fmtSilver(b.dailyProfit)}/jour.
          </p>
          <p>
            Capital nécessaire pour une journée : <strong>{fmtSilver(b.dailyCapital)}</strong>.
          </p>
          <p className="rd-score">
            Classement : {fmtSilver(b.dailyProfit)}/jour × confiance {fmt2(r.confidence)} ≈ {fmtSilver(r.score)}/jour
            estimés.
          </p>
        </>
      )}
      <p>
        Confiance : <strong className={`rd-level rd-level-${level === 'élevée' ? 'hi' : level === 'moyenne' ? 'mid' : 'lo'}`}>{level}</strong>{' '}
        ({fmt2(r.confidence)}) parce que {joinFr(confidenceReasons(r, s))}.
      </p>
    </div>
  );
}
