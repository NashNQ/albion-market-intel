// Graphique SVG fait main : part cumulée de l'investisseur par jour (3 scénarios), ligne du capital, points morts.
// L'identité des courbes ne repose jamais sur la couleur seule : tracé (plein, tirets, pointillés) et étiquettes directes.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { SCENARIOS, cumulativeSeries, type ScenarioKey, type ScenarioResult } from '../../../engine/invest';
import { fmtCompact, niceTicks } from '../charts/HistoryChart';
import { fmtInt, fmtSilver } from '../../format';
import { fmtPayback } from './shared';

const M = { left: 60, right: 76, top: 24, bottom: 30 };
const PLOT_H = 200;
const H = M.top + PLOT_H + M.bottom;

export interface PaybackChartProps {
  scenarios: Record<ScenarioKey, ScenarioResult>;
  capital: number;
  rotationDays: number;
  horizon: number;
}

export function PaybackChart({ scenarios, capital, rotationDays, horizon }: PaybackChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  const titleId = useId();
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

  const series = useMemo(
    () => SCENARIOS.map((d) => ({ def: d, s: scenarios[d.key], values: cumulativeSeries(scenarios[d.key], rotationDays, horizon) })),
    [scenarios, rotationDays, horizon],
  );
  const hi = Math.max(capital * 1.1, ...series.map((x) => x.values[x.values.length - 1] ?? 0), 1);
  const ticks = niceTicks(0, hi, 4);
  const top = ticks[ticks.length - 1] ?? hi;
  const plotW = W - M.left - M.right;
  const x = (d: number) => M.left + (d / Math.max(1, horizon)) * plotW;
  const y = (v: number) => M.top + PLOT_H - (v / (top || 1)) * PLOT_H;
  // Pas des graduations : au moins ~42 px entre deux étiquettes « j 30 » (sinon chevauchement à 360 px).
  const xEvery = [5, 10, 15, 30, 60, 90, 120].find((st) => (st / Math.max(1, horizon)) * plotW >= 42) ?? 180;
  const xTicks: number[] = [];
  for (let d = 0; d <= horizon; d += xEvery) xTicks.push(d);

  // Étiquettes de fin de ligne écartées d'au moins 13 px.
  const labels = series
    .map((sr) => ({ key: sr.def.key, label: sr.def.label, y: y(sr.values[sr.values.length - 1] ?? 0) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 13);
  const overflow = labels.length ? labels[labels.length - 1].y - (M.top + PLOT_H) : 0;
  if (overflow > 0) for (const l of labels) l.y -= overflow;

  const tableStep = horizon <= 60 ? 5 : 15;
  const tableDays: number[] = [];
  for (let d = 0; d <= horizon; d += tableStep) tableDays.push(d);
  if (tableDays[tableDays.length - 1] !== horizon) tableDays.push(horizon);

  const central = scenarios.central.paybackTotal;
  const summary =
    `Part cumulée de l’investisseur sur ${fmtInt(horizon)} jours, comparée au capital de ${fmtSilver(capital)}. ` +
    SCENARIOS.map((d) => `${d.label} : point mort ${fmtPayback(scenarios[d.key].paybackTotal)}`).join(' ; ') +
    '.';

  return (
    <figure className="inv-chart" ref={wrapRef}>
      <svg
        className="inv-chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-labelledby={titleId}
        aria-describedby={descId}
        style={{ aspectRatio: `${W} / ${H}` }}
      >
        <title id={titleId}>Remboursement du capital par jour, trois scénarios</title>
        <desc id={descId}>{summary}</desc>
        <text className="inv-unit" x={M.left - 8} y={M.top - 10} textAnchor="end">
          ag
        </text>
        {ticks.map((t) => (
          <g key={`t${t}`}>
            <line className={t === 0 ? 'inv-base' : 'inv-grid'} x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} />
            <text className="inv-tick" x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
              {fmtCompact(t)}
            </text>
          </g>
        ))}
        {xTicks.map((d) => (
          <text key={`x${d}`} className="inv-tick" x={x(d)} y={M.top + PLOT_H + 18} textAnchor="middle">
            {d === 0 ? 'j 0' : `j ${d}`}
          </text>
        ))}
        {capital > 0 && (
          <g className="inv-capital">
            <line x1={M.left} x2={W - M.right} y1={y(capital)} y2={y(capital)} />
            <text x={M.left + 4} y={y(capital) - 5}>
              Capital {fmtCompact(capital)}
            </text>
          </g>
        )}
        {series.map((sr) => (
          <path
            key={sr.def.key}
            className={`inv-line inv-line--${sr.def.key}`}
            d={sr.values.map((v, d) => `${d === 0 ? 'M' : 'L'}${x(d).toFixed(1)},${y(v).toFixed(1)}`).join('')}
          />
        ))}
        {series.map((sr) => {
          const p = sr.s.paybackTotal;
          if (p == null || p > horizon || capital <= 0) return null;
          return <circle key={`pm${sr.def.key}`} className={`inv-dot inv-dot--${sr.def.key}`} cx={x(p)} cy={y(capital)} r={sr.def.key === 'central' ? 5 : 3.5} />;
        })}
        {central != null && central <= horizon && capital > 0 && (
          <g className="inv-breakeven">
            <line x1={x(central)} x2={x(central)} y1={y(capital)} y2={M.top + PLOT_H} />
            <text x={x(central)} y={M.top + PLOT_H - 6} textAnchor={x(central) > W - M.right - 60 ? 'end' : 'middle'}>
              Point mort {fmtPayback(central)}
            </text>
          </g>
        )}
        {labels.map((l) => (
          <text key={`l${l.key}`} className={`inv-endlabel inv-endlabel--${l.key}`} x={W - M.right + 6} y={l.y} dy="0.32em">
            {l.label}
          </text>
        ))}
      </svg>
      <figcaption className="inv-legend">
        {SCENARIOS.map((d) => (
          <span key={d.key} className="inv-legend-item">
            <svg width="22" height="8" aria-hidden="true">
              <line className={`inv-line inv-line--${d.key}`} x1="1" x2="21" y1="4" y2="4" />
            </svg>
            {d.label}
          </span>
        ))}
        <span className="inv-legend-item">
          <svg width="22" height="8" aria-hidden="true">
            <line className="inv-capital-key" x1="1" x2="21" y1="4" y2="4" />
          </svg>
          Capital investi
        </span>
      </figcaption>
      <details className="inv-data">
        <summary>Données du graphique</summary>
        <div className="inv-table-wrap">
          <table className="inv-table">
            <caption className="sr-only">Part cumulée de l’investisseur par jour et par scénario</caption>
            <thead>
              <tr>
                <th scope="col">Jour</th>
                {SCENARIOS.map((d) => (
                  <th scope="col" key={d.key}>
                    {d.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableDays.map((d) => (
                <tr key={d}>
                  <th scope="row">{fmtInt(d)}</th>
                  {series.map((sr) => (
                    <td key={sr.def.key}>{fmtSilver(sr.values[d])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
