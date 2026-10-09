import type { Location, RouteResult } from '../../types';
import { AGE_TONE_TITLE, FLAG_LABEL, LOC_ABBR, LOC_KEY, ageTone, fmt2, fmtAgeH } from '../format';

export function LocChip({ loc }: { loc: Location }) {
  return (
    <abbr className={`loc loc-${LOC_KEY[loc]}`} title={loc}>
      {LOC_ABBR[loc]}
    </abbr>
  );
}

/** Lieux d'achat distincts, dans l'ordre des ingrédients. */
export function buyLocations(r: RouteResult): Location[] {
  const out: Location[] = [];
  for (const inp of r.recipe.inputs) {
    const l = r.buyFrom[inp.id];
    if (l && !out.includes(l)) out.push(l);
  }
  return out;
}

/** Libellé court d'un drapeau ; 'stale' affiche l'âge réel (« Prix de 9 h ») quand il est connu. */
export function flagShort(f: RouteResult['flags'][number], ageH?: number): string {
  if (f === 'stale' && ageH != null && Number.isFinite(ageH)) return `Prix de ${fmtAgeH(ageH)}`;
  return FLAG_LABEL[f].short;
}

export function Flags({ flags, ageH }: { flags: RouteResult['flags']; ageH?: number }) {
  if (flags.length === 0) return null;
  return (
    <span className="flags">
      {flags.map((f) => (
        <span key={f} className={`flag flag-${f}`} title={FLAG_LABEL[f].long}>
          {flagShort(f, ageH)}
        </span>
      ))}
    </span>
  );
}

/** Âge d'un prix avec le code couleur partagé (voir ageTone). */
export function AgeBadge({ h, maxH }: { h: number | null | undefined; maxH: number }) {
  if (h == null || !Number.isFinite(h)) return <span className="age muted">—</span>;
  const tone = ageTone(h, maxH);
  const stale = h >= maxH;
  return (
    <span className={`age age-t-${tone}`} title={AGE_TONE_TITLE[tone]}>
      {fmtAgeH(h)}
      {stale && <span className="age-tag">périmé</span>}
    </span>
  );
}

export function RouteCell({ r }: { r: RouteResult }) {
  const buys = buyLocations(r);
  const label = `Achat ${buys.join(', ') || '—'}, production ${r.craftAt}, vente ${r.sellAt}`;
  return (
    <span className="route">
      <span className="route-path" aria-label={label}>
        <span className="route-leg">
          {buys.map((l) => (
            <LocChip key={l} loc={l} />
          ))}
        </span>
        <span className="route-sep" aria-hidden="true">›</span>
        <LocChip loc={r.craftAt} />
        <span className="route-sep" aria-hidden="true">›</span>
        <LocChip loc={r.sellAt} />
      </span>
      <Flags flags={r.flags} ageH={r.oldestPriceAgeH} />
    </span>
  );
}

/** Texte compact d'une route pour l'affichage mobile : « FS › LYM › CAE · Zone rouge ». */
export function routeText(r: RouteResult): string {
  const buys = buyLocations(r).map((l) => LOC_ABBR[l]).join(' ') || '—';
  const path = `${buys} › ${LOC_ABBR[r.craftAt]} › ${LOC_ABBR[r.sellAt]}`;
  return [path, ...r.flags.map((f) => flagShort(f, r.oldestPriceAgeH))].join(' · ');
}

/** Barre de confiance : C est un coefficient entre 0 et 1, affiché « 0,86 ». */
export function ConfidenceBar({ c }: { c: number }) {
  const clamped = Math.min(1, Math.max(0, c));
  const pct = Math.round(clamped * 100);
  const tone = c >= 0.85 ? 'hi' : c >= 0.65 ? 'mid' : 'lo';
  const txt = fmt2(clamped);
  return (
    <span className={`cbar cbar-${tone}`} title={`Confiance ${txt} sur 1`}>
      <span className="cbar-track" aria-hidden="true">
        <span className="cbar-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="cbar-num">{txt}</span>
    </span>
  );
}
