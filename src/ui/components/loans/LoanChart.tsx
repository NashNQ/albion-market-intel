// Graphique SVG : valeur prudente projetée du gage (marge déduite) contre le montant dû, ligne de date limite.
// Les séries se distinguent par le tracé (plein / tirets) et des étiquettes directes, pas seulement par la couleur.
import { useEffect, useId, useRef, useState } from 'react';
import { fmtCompact, niceTicks } from '../charts/HistoryChart';
import { fmtSilver } from '../../format';
import { fmtDay } from './shared';
import { addDays } from '../../../engine/pawn';

const M = { left: 56, right: 16, top: 22, bottom: 30 };
const PLOT_H = 170;
const H = M.top + PLOT_H + M.bottom;

export interface LoanChartProps {
  /** Valeur prudente marge déduite, jour 0 (aujourd'hui) → jour n. */
  projection: number[];
  due: number;
  limitDay: number | null;
  /** Jours entre aujourd'hui et le retour idéal. */
  idealDay: number | null;
  today: string;
  maxTermDays: number;
}

/** Horizon affiché : assez pour voir la date limite (ou la durée maximale), 14 à 90 jours. */
export function chartDays(limitDay: number | null, maxTermDays: number, idealDay: number | null): number {
  const want = limitDay != null ? Math.ceil(limitDay * 1.5) + 3 : Math.max(30, maxTermDays * 2);
  return Math.min(90, Math.max(14, want, (idealDay ?? 0) + 3));
}

export function LoanChart({ projection, due, limitDay, idealDay, today, maxTermDays }: LoanChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(560);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.round(el.getBoundingClientRect().width);
      if (w > 0) setW(Math.max(260, w));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (projection.length === 0) return null;
  const days = Math.min(projection.length - 1, chartDays(limitDay, maxTermDays, idealDay));
  const vals = projection.slice(0, days + 1);
  const hi = Math.max(due * 1.15, ...vals, 1);
  const ticks = niceTicks(0, hi, 4);
  const top = ticks[ticks.length - 1] ?? hi;
  const plotW = W - M.left - M.right;
  const x = (d: number) => M.left + (d / Math.max(1, days)) * plotW;
  const y = (v: number) => M.top + PLOT_H - (Math.max(0, v) / (top || 1)) * PLOT_H;
  const xEvery = [1, 2, 5, 7, 10, 15, 30].find((st) => (st / Math.max(1, days)) * plotW >= 44) ?? 30;
  const xTicks: number[] = [];
  for (let d = 0; d <= days; d += xEvery) xTicks.push(d);

  const path = vals.map((v, d) => `${d === 0 ? 'M' : 'L'}${x(d).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const lim = limitDay != null && limitDay <= days ? limitDay : null;
  const idl = idealDay != null && idealDay > 0 && idealDay <= days && idealDay !== limitDay ? idealDay : null;
  const summary =
    `Valeur prudente du gage, marge déduite, sur ${days} jours : ${fmtSilver(vals[0])} aujourd’hui, ${fmtSilver(vals[vals.length - 1])} au jour ${days}. ` +
    `Montant dû : ${fmtSilver(due)}. ` +
    (limitDay != null ? `La valeur prudente passe sous le dû le ${fmtDay(addDays(today, limitDay))}.` : 'La valeur prudente reste au-dessus du dû sur 90 jours.');

  return (
    <figure className="gl-chart" ref={wrapRef}>
      <svg className="gl-chart-svg" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-labelledby={titleId} aria-describedby={descId} style={{ aspectRatio: `${W} / ${H}` }}>
        <title id={titleId}>Valeur prudente du gage contre le montant dû</title>
        <desc id={descId}>{summary}</desc>
        <text className="gl-tick" x={M.left - 8} y={M.top - 9} textAnchor="end">
          ag
        </text>
        {ticks.map((t) => (
          <g key={`t${t}`}>
            <line className={t === 0 ? 'gl-base' : 'gl-grid'} x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} />
            <text className="gl-tick" x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
              {fmtCompact(t)}
            </text>
          </g>
        ))}
        {xTicks.map((d) => (
          <text key={`x${d}`} className="gl-tick" x={x(d)} y={M.top + PLOT_H + 18} textAnchor={d === 0 ? 'start' : 'middle'}>
            {d === 0 ? 'auj.' : `j ${d}`}
          </text>
        ))}
        {lim != null && (
          <rect className="gl-danger-zone" x={x(lim)} y={M.top} width={Math.max(0, W - M.right - x(lim))} height={PLOT_H} />
        )}
        <g className="gl-due">
          <line x1={M.left} x2={W - M.right} y1={y(due)} y2={y(due)} />
          <text x={W - M.right - 4} y={y(due) - 6} textAnchor="end">
            Dû {fmtCompact(due)}
          </text>
        </g>
        <path className="gl-line" d={path} />
        {idl != null && (
          <g className="gl-ideal">
            <line x1={x(idl)} x2={x(idl)} y1={M.top} y2={M.top + PLOT_H} />
            <text x={x(idl) - 4} y={M.top + 10} textAnchor="end">
              Retour idéal
            </text>
          </g>
        )}
        {lim != null && (
          <g className="gl-limit">
            <line x1={x(lim)} x2={x(lim)} y1={M.top} y2={M.top + PLOT_H} />
            <text x={x(lim) + 4} y={M.top + PLOT_H - 8} textAnchor={x(lim) > W - M.right - 90 ? 'end' : 'start'} dx={x(lim) > W - M.right - 90 ? -8 : 0}>
              Limite {fmtDay(addDays(today, lim))}
            </text>
          </g>
        )}
      </svg>
      <figcaption className="gl-legend">
        <span className="gl-legend-item">
          <svg width="22" height="8" aria-hidden="true">
            <line className="gl-line" x1="1" x2="21" y1="4" y2="4" />
          </svg>
          Valeur prudente du gage (marge déduite)
        </span>
        <span className="gl-legend-item">
          <svg width="22" height="8" aria-hidden="true">
            <line className="gl-due-key" x1="1" x2="21" y1="4" y2="4" />
          </svg>
          Montant dû
        </span>
      </figcaption>
    </figure>
  );
}
