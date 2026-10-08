import { useMemo, useState, type ReactNode } from 'react';
import type { RouteResult } from '../../types';
import { useAppData } from '../context';
import { fmtInt, plural } from '../format';
import type { RankStatsView } from '../context';
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

/** Ligne de statistiques. `scope` = 'global' (raffinage + craft) ou 'black-market' (évaluation vers le BM). */
export function StatsLine({ scope = 'global' }: { scope?: 'global' | 'black-market' }) {
  const { rankings } = useAppData();
  if (!rankings) return null;
  const bm = scope === 'black-market';
  const s: RankStatsView | undefined = bm ? rankings.bmStats : rankings.stats;
  if (!s) {
    // Pas de statistiques BM détaillées : on n'affiche que le nombre de lignes BM (jamais les stats globales).
    return bm ? <p className="stats-line">Black Market : {plural(rankings.blackMarket.length, 'ligne classée')}</p> : null;
  }
  const parts = [
    bm
      ? `Black Market : ${plural(rankings.blackMarket.length, 'ligne classée')} sur ${plural(s.evaluated, 'recette évaluée')}`
      : `Statistiques globales : ${plural(s.evaluated, 'recette évaluée')}`,
    `${fmtInt(s.missing)} sans données`,
    `${plural(s.stale, 'prix périmé', 'prix périmés')}`,
    plural(s.suspect, 'suspect'),
    `${fmtInt(s.lowVolume)} ${s.lowVolume >= 2 ? 'trop peu liquides' : 'trop peu liquide'}`,
    `calcul en ${fmtInt(Math.max(0, Math.round(rankings.ms)))} ms`,
  ];
  return <p className="stats-line">{parts.join(' · ')}</p>;
}

export function RankingView({ title, intro, rows, variant, notice }: Props) {
  const { metaById, settings, updateSettings, resetSettings } = useAppData();
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const filtered = useMemo(() => applyFilters(rows, filters, metaById), [rows, filters, metaById]);

  return (
    <section className="page" aria-labelledby="page-title">
      <header className="page-head page-head--hero">
        <h1 id="page-title">{title}</h1>
        <p className="page-intro">{intro}</p>
        <StatsLine scope={variant === 'black-market' ? 'black-market' : 'global'} />
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
          ? plural(rows.length, 'route rentable')
          : `${plural(filtered.length, 'route affichée')} sur ${fmtInt(rows.length)}`}
      </p>
      <RouteTable rows={filtered} metaById={metaById} variant={variant} caption={title} />
    </section>
  );
}
