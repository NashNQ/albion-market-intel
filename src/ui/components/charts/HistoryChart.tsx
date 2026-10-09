// Graphique historique fait main (SVG) : prix moyen journalier (ligne) au-dessus, ventes/jour
// (barres) en dessous. Deux panneaux à axe X partagé, chacun avec sa propre échelle Y (jamais de
// double axe sur un même panneau). Info-bulle au survol, au toucher et au clavier.
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import type { Location } from '../../../types';
import { DAY_MS, type DailyPoint } from '../../../engine/history-metrics';
import { LOC_ABBR, LOC_KEY, fmtInt, fmtSilver } from '../../format';

export interface ChartSeries {
  loc: Location;
  days: readonly DailyPoint[];
}

export interface HistoryChartProps {
  /** Série mise en avant (ligne pleine + barres de volume). */
  primary: ChartSeries;
  /** Autres villes en contexte (lignes fines), mode « toutes les villes ». */
  others?: readonly ChartSeries[];
  /** Premier et dernier jour (minuit UTC, ms) de l'axe X. */
  startDay: number;
  endDay: number;
}

const fmtDay = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtDayLong = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' });
const thin = (s: string) => s.replace(/[  ]/g, ' ');
const nfCompact = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 2 });
/** Graduation lisible : entier complet sous 100 000 (« 12 500 »), « 125 k » puis « 1,25 M ». */
export const fmtCompact = (n: number): string =>
  Math.abs(n) >= 1e6 ? thin(nfCompact.format(n)) : Math.abs(n) >= 1e5 ? `${fmtInt(n / 1000)}\u202fk` : fmtInt(n);
export const fmtDate = (day: number): string => thin(fmtDay.format(new Date(day)));
export const fmtDateLong = (day: number): string => thin(fmtDayLong.format(new Date(day)));

/** Graduations « rondes » (1, 2, 2,5, 5 × 10^k) couvrant [lo, hi]. */
export function niceTicks(lo: number, hi: number, count = 4): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  if (hi === lo) {
    const pad = Math.abs(hi) * 0.1 || 1;
    lo -= pad;
    hi += pad;
  }
  const raw = (hi - lo) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const start = Math.floor(lo / step) * step;
  const out: number[] = [];
  for (let v = start; v <= hi + step * 0.5 && out.length < 12; v += step) out.push(Math.round(v * 1e6) / 1e6);
  if (out[out.length - 1] < hi) out.push(out[out.length - 1] + step);
  return out;
}

// Géométrie (unités = pixels CSS : la viewBox suit la largeur réelle du conteneur).
const M_BASE = { left: 56, right: 14, top: 22 };
/** Marge droite élargie en mode comparaison : étiquettes directes en bout de ligne. */
const RIGHT_LABELS = 40;
const PRICE_H = 168;
const GAP = 44; // labels X du panneau prix + titre « ventes »
const VOL_H = 64;
const BOTTOM = 24;
const H = M_BASE.top + PRICE_H + GAP + VOL_H + BOTTOM;
const VOL_TOP = M_BASE.top + PRICE_H + GAP;

const locVar = (loc: Location): CSSProperties => ({ ['--c' as string]: `var(--${LOC_KEY[loc]})` });

/** Chemin de ligne avec coupures sur les jours manquants. */
function linePath(days: readonly DailyPoint[], x: (d: number) => number, y: (v: number) => number): string {
  let d = '';
  let prev: number | null = null;
  for (const p of days) {
    const cmd = prev != null && p.day - prev === DAY_MS ? 'L' : 'M';
    d += `${cmd}${x(p.day).toFixed(1)},${y(p.price).toFixed(1)}`;
    prev = p.day;
  }
  return d;
}

/** Barre à extrémité haute arrondie (rayon ≤ 2 px), ancrée sur la ligne de base. */
function barPath(x: number, w: number, top: number, base: number): string {
  const h = base - top;
  if (h <= 0 || w <= 0) return '';
  const r = Math.min(2, w / 2, h);
  return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${base}Z`;
}

/** Positions Y des étiquettes de fin de ligne, écartées d'au moins 12 px pour éviter les chevauchements. */
function endLabels(
  items: { loc: Location; last: DailyPoint | undefined }[],
  y: (v: number) => number,
  top: number,
  bottom: number,
): { loc: Location; y: number }[] {
  const GAP_PX = 12;
  const list = items
    .filter((i): i is { loc: Location; last: DailyPoint } => i.last != null)
    .map((i) => ({ loc: i.loc, y: y(i.last.price) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < list.length; i++) list[i].y = Math.max(list[i].y, list[i - 1].y + GAP_PX);
  const overflow = list.length ? list[list.length - 1].y - bottom : 0;
  if (overflow > 0) for (const l of list) l.y -= overflow;
  for (let i = 0; i < list.length; i++) list[i].y = Math.max(list[i].y, top + i * GAP_PX);
  return list;
}

export function HistoryChart({ primary, others = [], startDay, endDay }: HistoryChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [W, setW] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  const descId = useId();

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.round(el.getBoundingClientRect().width);
      if (w > 0) setW(Math.max(280, w));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const M = { ...M_BASE, right: others.length ? RIGHT_LABELS : M_BASE.right };
  const nDays = Math.max(1, Math.round((endDay - startDay) / DAY_MS) + 1);
  const plotW = W - M.left - M.right;
  const slot = plotW / nDays;
  const xOf = (day: number) => M.left + ((day - startDay) / DAY_MS + 0.5) * slot;

  const all = useMemo(() => [primary, ...others], [primary, others]);
  const byDay = useMemo(
    () => all.map((s) => new Map(s.days.map((d) => [d.day, d] as const))),
    [all],
  );

  const priceScale = useMemo(() => {
    const vals = all.flatMap((s) => s.days.filter((d) => d.day >= startDay && d.day <= endDay).map((d) => d.price));
    const lo = vals.length ? Math.min(...vals) : 0;
    const hi = vals.length ? Math.max(...vals) : 1;
    const ticks = niceTicks(lo, hi, 4);
    return { ticks, lo: ticks[0] ?? lo, hi: ticks[ticks.length - 1] ?? hi };
  }, [all, startDay, endDay]);
  const yPrice = (v: number) =>
    M.top + PRICE_H - ((v - priceScale.lo) / (priceScale.hi - priceScale.lo || 1)) * PRICE_H;

  const volScale = useMemo(() => {
    const vals = primary.days.filter((d) => d.day >= startDay && d.day <= endDay).map((d) => d.volume);
    const hi = Math.max(1, ...vals);
    const ticks = niceTicks(0, hi, 2);
    return { ticks, hi: ticks[ticks.length - 1] ?? hi };
  }, [primary, startDay, endDay]);
  const yVol = (v: number) => VOL_TOP + VOL_H - (v / (volScale.hi || 1)) * VOL_H;

  const inRange = (s: ChartSeries) => s.days.filter((d) => d.day >= startDay && d.day <= endDay);

  // Graduations X : environ une par semaine, alignées sur la fin (aujourd'hui).
  const xTicks = useMemo(() => {
    const every = W < 480 ? 10 : 7;
    const out: number[] = [];
    for (let d = endDay; d >= startDay; d -= every * DAY_MS) out.push(d);
    return out.reverse();
  }, [W, startDay, endDay]);

  const idxFromClientX = (clientX: number): number => {
    const svg = svgRef.current;
    if (!svg) return 0;
    const rect = svg.getBoundingClientRect();
    const px = rect.width > 0 ? ((clientX - rect.left) * W) / rect.width : 0;
    return Math.min(nDays - 1, Math.max(0, Math.floor((px - M.left) / slot)));
  };
  const onPointer = (e: PointerEvent<SVGRectElement>) => setHover(idxFromClientX(e.clientX));
  const onKey = (e: KeyboardEvent<SVGRectElement>) => {
    const cur = hover ?? nDays - 1;
    let next: number | null = cur;
    if (e.key === 'ArrowLeft') next = Math.max(0, cur - 1);
    else if (e.key === 'ArrowRight') next = Math.min(nDays - 1, cur + 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = nDays - 1;
    else if (e.key === 'Escape') next = null;
    else return;
    e.preventDefault();
    setHover(next);
  };

  const hoverDay = hover == null ? null : startDay + hover * DAY_MS;
  const hx = hoverDay == null ? 0 : xOf(hoverDay);
  const tipRows =
    hoverDay == null
      ? []
      : all.map((s, i) => ({ loc: s.loc, point: byDay[i].get(hoverDay) ?? null, primary: i === 0 }));
  const primaryPoint = tipRows[0]?.point ?? null;
  const tipText =
    hoverDay == null
      ? ''
      : `${fmtDateLong(hoverDay)} : ` +
        tipRows.map((r) => `${r.loc} ${r.point ? fmtSilver(r.point.price) : 'pas de données'}`).join(', ') +
        (primaryPoint ? `, ${fmtInt(primaryPoint.volume)} ventes à ${primary.loc}` : '');

  const primaryDays = inRange(primary);
  const lastP = primaryDays[primaryDays.length - 1];

  return (
    <div className="hc" ref={wrapRef}>
      <svg
        ref={svgRef}
        className="hc-svg"
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="group"
        aria-labelledby={descId}
        style={{ aspectRatio: `${W} / ${H}` }}
      >
        <title id={descId}>
          {`Prix moyen journalier et ventes par jour à ${primary.loc}, du ${fmtDate(startDay)} au ${fmtDate(endDay)}${others.length ? `, comparé à ${others.length} autres villes` : ''}`}
        </title>

        {/* Panneau prix */}
        <text className="hc-unit" x={M.left - 8} y={M.top - 10} textAnchor="end">ag</text>
        {priceScale.ticks.map((t) => (
          <g key={`p${t}`}>
            <line className="hc-grid" x1={M.left} x2={W - M.right} y1={yPrice(t)} y2={yPrice(t)} />
            <text className="hc-tick" x={M.left - 8} y={yPrice(t)} dy="0.32em" textAnchor="end">
              {fmtCompact(t)}
            </text>
          </g>
        ))}
        {xTicks.map((d) => (
          <text key={`xp${d}`} className="hc-tick" x={xOf(d)} y={M.top + PRICE_H + 16} textAnchor="middle">
            {fmtDate(d)}
          </text>
        ))}
        {others.map((s) => (
          <path key={s.loc} className="hc-line hc-line--ctx" style={locVar(s.loc)} d={linePath(inRange(s), xOf, yPrice)} />
        ))}
        <path className="hc-line" style={locVar(primary.loc)} d={linePath(primaryDays, xOf, yPrice)} />
        {/* Jours isolés (sans voisin) : un point pour qu'ils restent visibles. */}
        {primaryDays
          .filter((p, i, arr) => arr[i - 1]?.day !== p.day - DAY_MS && arr[i + 1]?.day !== p.day + DAY_MS)
          .map((p) => (
            <circle key={`iso${p.day}`} className="hc-dot" style={locVar(primary.loc)} cx={xOf(p.day)} cy={yPrice(p.price)} r={2.5} />
          ))}
        {lastP && hover == null && (
          <circle className="hc-dot hc-dot--end" style={locVar(primary.loc)} cx={xOf(lastP.day)} cy={yPrice(lastP.price)} r={4} />
        )}

        {/* Étiquettes directes (mode comparaison) : l'identité ne repose jamais sur la couleur seule. */}
        {others.length > 0 &&
          endLabels(all.map((s) => ({ loc: s.loc, last: inRange(s).at(-1) })), yPrice, M.top, M.top + PRICE_H).map((l) => (
            <text
              key={`lab${l.loc}`}
              className={`hc-endlabel${l.loc === primary.loc ? ' is-primary' : ''}`}
              x={W - M.right + 6}
              y={l.y}
              dy="0.32em"
            >
              {LOC_ABBR[l.loc]}
            </text>
          ))}

        {/* Panneau volume */}
        <text className="hc-unit" x={M.left - 8} y={VOL_TOP - 10} textAnchor="end">ventes</text>
        {volScale.ticks.map((t) => (
          <g key={`v${t}`}>
            <line className={t === 0 ? 'hc-base' : 'hc-grid'} x1={M.left} x2={W - M.right} y1={yVol(t)} y2={yVol(t)} />
            <text className="hc-tick" x={M.left - 8} y={yVol(t)} dy="0.32em" textAnchor="end">
              {fmtCompact(t)}
            </text>
          </g>
        ))}
        {primaryDays.map((p) => {
          const bw = Math.max(1, slot - 2); // 2 px d'écart entre barres
          return (
            <path
              key={`b${p.day}`}
              className={`hc-bar${hoverDay === p.day ? ' is-hot' : ''}`}
              style={locVar(primary.loc)}
              d={barPath(xOf(p.day) - bw / 2, bw, yVol(p.volume), yVol(0))}
            />
          );
        })}
        {xTicks.map((d) => (
          <text key={`xv${d}`} className="hc-tick" x={xOf(d)} y={VOL_TOP + VOL_H + 16} textAnchor="middle">
            {fmtDate(d)}
          </text>
        ))}

        {/* Réticule */}
        {hoverDay != null && (
          <g className="hc-cross" aria-hidden="true">
            <line x1={hx} x2={hx} y1={M.top} y2={M.top + PRICE_H} />
            <line x1={hx} x2={hx} y1={VOL_TOP} y2={VOL_TOP + VOL_H} />
            {tipRows.map((r) =>
              r.point ? (
                <circle
                  key={r.loc}
                  className={`hc-dot hc-dot--hover${r.primary ? '' : ' is-ctx'}`}
                  style={locVar(r.loc)}
                  cx={hx}
                  cy={yPrice(r.point.price)}
                  r={r.primary ? 4.5 : 3}
                />
              ) : null,
            )}
          </g>
        )}

        {/* Zone de capture (plus grande que les marques) : souris, toucher et clavier. */}
        <rect
          className="hc-hit"
          x={M.left}
          y={M.top}
          width={plotW}
          height={VOL_TOP + VOL_H - M.top}
          tabIndex={0}
          role="slider"
          aria-label="Parcourir les jours du graphique (flèches gauche et droite)"
          aria-valuemin={0}
          aria-valuemax={nDays - 1}
          aria-valuenow={hover ?? nDays - 1}
          aria-valuetext={tipText || 'Aucun jour sélectionné'}
          onPointerMove={onPointer}
          onPointerDown={onPointer}
          onPointerLeave={(e) => {
            if (e.pointerType === 'mouse') setHover(null);
          }}
          onKeyDown={onKey}
          onFocus={() => setHover((h) => h ?? nDays - 1)}
          onBlur={() => setHover(null)}
        />
      </svg>

      {hoverDay != null && (
        <div
          className={`hc-tip${hx > W / 2 ? ' is-left' : ''}`}
          style={{ left: `${(hx / W) * 100}%` }}
          aria-hidden="true"
        >
          <div className="hc-tip-date">{fmtDateLong(hoverDay)}</div>
          {tipRows
            .filter((r) => r.primary || r.point)
            .map((r) => (
              <div key={r.loc} className={`hc-tip-row${r.primary ? '' : ' is-ctx'}`}>
                <span className="hc-key" style={locVar(r.loc)} />
                <strong>{r.point ? fmtSilver(r.point.price) : '—'}</strong>
                <span className="hc-tip-name">{r.loc}</span>
              </div>
            ))}
          <div className="hc-tip-row">
            <span className="hc-key hc-key--bar" style={locVar(primary.loc)} />
            <strong>{primaryPoint ? fmtInt(primaryPoint.volume) : '—'}</strong>
            <span className="hc-tip-name">ventes</span>
          </div>
        </div>
      )}
    </div>
  );
}
