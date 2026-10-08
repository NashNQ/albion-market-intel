// Petits éléments partagés par le constructeur de routes.
import type { ReactNode } from 'react';
import type { Location } from '../../../types';
import { fmt2, fmtAgeH, fmtInt, fmtSilver } from '../../format';
import { LocChip } from '../Route';

export type BadgeTone = 'warn' | 'danger' | 'info' | 'ok';

export function Badge({ tone = 'info', title, children }: { tone?: BadgeTone; title?: string; children: ReactNode }) {
  return (
    <span className={`rb-badge rb-badge-${tone}`} title={title}>
      {children}
    </span>
  );
}

/** Achat arrondi au supérieur (affichage seulement). */
export const fmtBuyQty = (n: number): string => fmtInt(Math.ceil(n - 1e-9));

/** Nombre de crafts entier inférieur + reliquat. */
export function CraftsQty({ n }: { n: number }) {
  const whole = Math.floor(n + 1e-9);
  const rest = n - whole;
  return (
    <span>
      {fmtInt(whole)}
      {rest > 0.005 && <span className="muted rb-rest"> (+{fmt2(rest)})</span>}
    </span>
  );
}

export function Loc({ loc }: { loc: Location | null }) {
  if (!loc) return <span className="muted">—</span>;
  return (
    <span className="rb-loc">
      <LocChip loc={loc} /> <span className="rb-loc-name">{loc}</span>
    </span>
  );
}

export function Money({ v, signed = false }: { v: number | null | undefined; signed?: boolean }) {
  if (v == null || !Number.isFinite(v)) return <span className="muted">—</span>;
  const cls = signed ? (v > 0 ? 'profit' : v < 0 ? 'rb-loss' : undefined) : undefined;
  return <span className={cls}>{fmtSilver(v)}</span>;
}

/** Seuils d'âge par cellule (spécification) : orange au-delà de 6 h, rouge au-delà de 24 h. */
export const AGE_WARN_H = 6;
export const AGE_DANGER_H = 24;
export const ageClass = (h: number): string | undefined => (h > AGE_DANGER_H ? 'age-very-old' : h > AGE_WARN_H ? 'age-old' : undefined);

// `maxH` conservé pour compatibilité d'appel ; les seuils sont fixes (6 h / 24 h).
export function Age({ h }: { h: number | null | undefined; maxH?: number }) {
  if (h == null) return <span className="muted">—</span>;
  return <span className={ageClass(h)}>{fmtAgeH(h)}</span>;
}

export const locLabel = (l: Location | 'auto'): string => (l === 'auto' ? 'Auto' : l);
