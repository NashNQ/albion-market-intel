import { useMemo, useState, type ReactNode } from 'react';
import type { RouteResult } from '../../types';
import { useAppData } from '../context';
import { fmtInt, plural } from '../format';
import type { RankStatsView } from '../context';
import { applyFilters, EMPTY_FILTERS, Filters, type FilterState } from './Filters';
import { RouteTable, columnHelp } from './RouteTable';
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

/** Légende dépliable des colonnes (aide accessible au toucher et au clavier, contrairement aux infobulles). */
function MetricsHelp({ variant }: { variant: 'ranked' | 'black-market' }) {
  const { settings } = useAppData();
  const h = columnHelp(settings);
  return (
    <details className="metrics-help">
      <summary>Comment lire ce classement ?</summary>
      <dl>
        <dt>Profit/unité</dt>
        <dd>{h.profit}</dd>
        {variant === 'ranked' && (
          <>
            <dt>Ventes/jour (marché)</dt>
            <dd>{h.volume}</dd>
            <dt>Vous vendez/jour</dt>
            <dd>{h.q}</dd>
          </>
        )}
        <dt>Confiance</dt>
        <dd>{h.c}</dd>
        {variant === 'ranked' && (
          <>
            <dt>Profit/jour estimé</dt>
            <dd>{h.score}</dd>
          </>
        )}
        <dt>Âge des prix</dt>
        <dd>{h.age}</dd>
        <dt>Détail ›</dt>
        <dd>Le bouton en fin de ligne explique le calcul en phrases : marge, quantité à produire, capital et raisons de la confiance.</dd>
      </dl>
    </details>
  );
}

export function RankingView({ title, intro, rows, variant, notice }: Props) {
  const { metaById, settings, updateSettings, resetSettings, rankings } = useAppData();
  const stats = variant === 'black-market' ? rankings?.bmStats ?? rankings?.stats : rankings?.stats;
  // Données participatives : la nuit, peu de joueurs scannent le marché et la plupart des prix vieillissent.
  const mostlyStale = !!stats && stats.evaluated > 0 && stats.stale / stats.evaluated > 0.5;
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
      {mostlyStale && !settings.showStale && (
        <div className="stale-notice" role="status">
          <p>
            <strong>{fmtInt(stats!.stale)} recettes sur {fmtInt(stats!.evaluated)}</strong> n’ont que des prix de plus de{' '}
            {settings.maxPriceAgeH} h. Les prix viennent des joueurs qui utilisent le client de l’Albion Online Data Project : aux
            heures creuses, peu de marchés sont relevés.
          </p>
          <button type="button" className="btn-ghost" onClick={() => updateSettings({ showStale: true })}>
            Afficher aussi ces opportunités (marquées périmées)
          </button>
        </div>
      )}
      <details className="quick-settings">
        <summary>
          Réglages rapides
          <span className="qs-summary">
            {settings.premium ? 'Premium' : 'Sans premium'} · {settings.focus ? 'avec focus' : 'sans focus'} ·{' '}
            {settings.mode === 'instant' ? 'instantané' : 'ordres'} · {`prix de moins de ${settings.maxPriceAgeH} h`}
            {settings.showStale ? ' · prix périmés affichés' : ''}
          </span>
        </summary>
        <SettingsForm settings={settings} update={updateSettings} reset={resetSettings} compact />
      </details>
      <Filters
        rows={rows}
        value={filters}
        onChange={setFilters}
        showStale={settings.showStale}
        onShowStale={(b) => updateSettings({ showStale: b })}
      />
      <p className="row-count" aria-live="polite">
        {filtered.length === rows.length
          ? plural(rows.length, 'route rentable')
          : `${plural(filtered.length, 'route affichée')} sur ${fmtInt(rows.length)}`}
      </p>
      <MetricsHelp variant={variant} />
      <RouteTable
        rows={filtered}
        metaById={metaById}
        variant={variant}
        caption={title}
        settings={settings}
        onShowStale={() => updateSettings({ showStale: true })}
      />
    </section>
  );
}
