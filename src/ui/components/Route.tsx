import type { Location, RouteResult } from '../../types';
import { FLAG_LABEL, LOC_ABBR, LOC_KEY } from '../format';

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

export function Flags({ flags }: { flags: RouteResult['flags'] }) {
  if (flags.length === 0) return null;
  return (
    <span className="flags">
      {flags.map((f) => (
        <span key={f} className={`flag flag-${f}`} title={FLAG_LABEL[f].long}>
          {FLAG_LABEL[f].short}
        </span>
      ))}
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
      <Flags flags={r.flags} />
    </span>
  );
}

export function ConfidenceBar({ c }: { c: number }) {
  const pct = Math.round(c * 100);
  const tone = c >= 0.85 ? 'hi' : c >= 0.65 ? 'mid' : 'lo';
  return (
    <span className={`cbar cbar-${tone}`} title={`Confiance ${pct} %`}>
      <span className="cbar-track" aria-hidden="true">
        <span className="cbar-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="cbar-num">{pct}</span>
    </span>
  );
}
