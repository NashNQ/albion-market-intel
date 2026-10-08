import { useMemo, useState, type ReactNode } from 'react';
import type { RouteResult } from '../../types';
import { useAppData } from '../context';
import { fmtInt } from '../format';
import { applyFilters, EMPTY_FILTERS, Filters, type FilterState } from './Filters';
import { RouteTable } from './RouteTable';
import { SettingsForm } from './SettingsForm';

interface Props {
  title: string;
  intro: string;
  rows: RouteResult[];
  variant: 'ranked' | 'black-market';
  notice?: ReactNode;
}

export function StatsLine() {
  const { rankings } = useAppData();
  if (!rankings) return null;
  const s = rankings.stats;
  const parts = [
    `${fmtInt(s.evaluated)} recettes évaluées`,
    `${fmtInt(s.missing)} sans données`,
    `${fmtInt(s.stale)} prix périmés`,
    `${fmtInt(s.suspect)} suspects`,
    `${fmtInt(s.lowVolume)} trop peu liquides`,
    `calcul en ${fmtInt(Math.max(0, Math.round(rankings.ms)))} ms`,
  ];
  return <p className="stats-line">{parts.join(' · ')}</p>;
}

export function RankingView({ title, intro, rows, variant, notice }: Props) {
  const { metaById, settings, updateSettings, resetSettings } = useAppData();
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const filtered = useMemo(() => applyFilters(rows, filters, metaById), [rows, filters, metaById]);

  return (
    <section className="page" aria-labelledby="page-title">
      <header className="page-head">
        <h1 id="page-title">{title}</h1>
        <p className="page-intro">{intro}</p>
        <StatsLine />
      </header>
      {notice}
      <details className="quick-settings">
        <summary>
          Réglages rapides
          <span className="qs-summary">
            {settings.premium ? 'Premium' : 'Sans premium'} · {settings.focus ? 'avec focus' : 'sans focus'} ·{' '}
            {settings.mode === 'instant' ? 'instantané' : 'ordres'} · {`prix de moins de ${settings.maxPriceAgeH} h`}
          </span>
        </summary>
        <SettingsForm settings={settings} update={updateSettings} reset={resetSettings} compact />
      </details>
      <Filters rows={rows} value={filters} onChange={setFilters} />
      <p className="row-count" aria-live="polite">
        {filtered.length === rows.length
          ? `${fmtInt(rows.length)} routes rentables`
          : `${fmtInt(filtered.length)} routes affichées sur ${fmtInt(rows.length)}`}
      </p>
      <RouteTable rows={filtered} metaById={metaById} variant={variant} caption={title} />
    </section>
  );
}
