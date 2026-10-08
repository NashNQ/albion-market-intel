// Onglet « Classement » : toutes les activités agricoles triées par profit/parcelle/jour.
import { useMemo, useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import type { ItemMeta } from '../../../types';
import { STRATEGY_LABEL, type AnimalStrategy, type FarmEval } from '../../../engine/farming';
import { fmt2, fmtAgeH, fmtInt, fmtSilver } from '../../format';
import { ItemIcon } from '../ItemIcon';
import { LocChip } from '../Route';
import { FarmDetail } from './FarmDetail';
import { FarmFlags, activityLabel, subjectName } from './shared';

type KindFilter = 'all' | 'crop' | 'herb' | 'animal';
type FocusFilter = 'both' | 'with' | 'without';

export function FarmRanking({ rows, metaById }: { rows: FarmEval[]; metaById: Map<string, ItemMeta> }) {
  const [kind, setKind] = useState<KindFilter>('all');
  const [focus, setFocus] = useState<FocusFilter>('both');
  const [strategy, setStrategy] = useState<'all' | AnimalStrategy>('all');
  const [sorting, setSorting] = useState<SortingState>([{ id: 'profit', desc: true }]);
  const [selected, setSelected] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (kind !== 'all' && r.kind !== kind) return false;
        // « Garder et produire » : le focus n'agit pas, la ligne apparaît dans les deux filtres.
        if (focus === 'with' && !r.focused && r.strategy !== 'produce') return false;
        if (focus === 'without' && r.focused) return false;
        if (strategy !== 'all' && r.kind === 'animal' && r.strategy !== strategy) return false;
        if (strategy !== 'all' && r.kind !== 'animal' && kind === 'animal') return false;
        return true;
      }),
    [rows, kind, focus, strategy],
  );

  const columns = useMemo<ColumnDef<FarmEval>[]>(
    () => [
      {
        id: 'name',
        header: 'Activité',
        accessorFn: (r) => subjectName(r, metaById),
        sortDescFirst: false,
        sortingFn: (a, b) => String(a.getValue('name')).localeCompare(String(b.getValue('name')), 'fr'),
        cell: ({ row }) => {
          const r = row.original;
          const name = subjectName(r, metaById);
          return (
            <span className="item-cell">
              <span className="item-link">
                <ItemIcon id={r.kind === 'animal' ? r.sourceId.replace(/_BABY$/, '_GROWN') : r.mainId} name={name} size={28} />
                <span className="item-name">{name}</span>
              </span>
              <span className="item-line">{activityLabel(r)}</span>
            </span>
          );
        },
        meta: { cls: 'c-name' },
      },
      {
        id: 'tier',
        header: 'Tier',
        accessorFn: (r) => r.tier,
        cell: ({ row }) => <span className={`tier tier-${row.original.tier}`}>{row.original.tier}</span>,
        meta: { cls: 'c-tier num' },
      },
      {
        id: 'profit',
        header: 'Profit/parcelle/jour',
        accessorFn: (r) => r.profitPerPlotDay ?? undefined,
        sortUndefined: 'last',
        cell: ({ row }) =>
          row.original.ok ? (
            <strong className={row.original.profitPerPlotDay! >= 0 ? 'profit' : 'farm-loss'}>{fmtSilver(row.original.profitPerPlotDay)}</strong>
          ) : (
            <span className="farm-missing-cell">Données manquantes</span>
          ),
        meta: { cls: 'num', title: 'Profit net par parcelle (9 emplacements) et par jour' },
      },
      {
        id: 'focus',
        header: 'Focus/jour',
        accessorFn: (r) => r.focusPerPlotDay,
        cell: ({ getValue }) => fmtInt(getValue<number>()),
        meta: { cls: 'num secondary', title: 'Focus dépensé par parcelle et par jour' },
      },
      {
        id: 'spf',
        header: 'Silver/focus',
        accessorFn: (r) => r.silverPerFocus ?? undefined,
        sortUndefined: 'last',
        cell: ({ row }) => fmt2(row.original.silverPerFocus),
        meta: { cls: 'num', title: 'Gain marginal par point de focus : (profit arrosé − profit sans) / focus' },
      },
      {
        id: 'sell',
        header: 'Vente',
        accessorFn: (r) => r.sellAt ?? '',
        enableSorting: false,
        cell: ({ row }) => (row.original.sellAt ? <LocChip loc={row.original.sellAt} /> : '—'),
        meta: { cls: 'c-sell' },
      },
      {
        id: 'age',
        header: 'Âge',
        accessorFn: (r) => (r.ok ? r.oldestPriceAgeH : undefined),
        sortUndefined: 'last',
        cell: ({ row }) => (row.original.ok ? fmtAgeH(row.original.oldestPriceAgeH) : '—'),
        meta: { cls: 'num secondary', title: 'Âge du prix le plus vieux utilisé' },
      },
      {
        id: 'volume',
        header: 'Volume 7 j',
        accessorFn: (r) => r.volume7d ?? undefined,
        sortUndefined: 'last',
        cell: ({ row }) => fmtInt(row.original.volume7d),
        meta: { cls: 'num secondary', title: 'Volume médian par jour (7 jours) de la sortie principale au lieu de vente' },
      },
      {
        id: 'flags',
        header: 'Drapeaux',
        enableSorting: false,
        cell: ({ row }) => <FarmFlags flags={row.original.flags} />,
        meta: { cls: 'c-flags' },
      },
    ],
    [metaById],
  );

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    sortDescFirst: true,
    getRowId: (r) => r.rowId,
  });
  // Le détail suit les filtres : une ligne masquée par un filtre ferme son panneau.
  const sel = selected ? filtered.find((r) => r.rowId === selected) ?? null : null;

  return (
    <div className="farm-ranking">
      <div className="filters" role="group" aria-label="Filtres du classement">
        <label>
          <span className="f-label">Type</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as KindFilter)}>
            <option value="all">Tous</option>
            <option value="crop">Cultures</option>
            <option value="herb">Herbes</option>
            <option value="animal">Animaux</option>
          </select>
        </label>
        <label>
          <span className="f-label">Arrosage / soin</span>
          <select value={focus} onChange={(e) => setFocus(e.target.value as FocusFilter)}>
            <option value="both">Avec et sans</option>
            <option value="with">Avec focus</option>
            <option value="without">Sans focus</option>
          </select>
        </label>
        <label>
          <span className="f-label">Stratégie animale</span>
          <select
            value={strategy}
            disabled={kind === 'crop' || kind === 'herb'}
            title={kind === 'crop' || kind === 'herb' ? 'Sans effet sur les cultures et les herbes' : undefined}
            onChange={(e) => setStrategy(e.target.value as 'all' | AnimalStrategy)}
          >
            <option value="all">Toutes</option>
            {(Object.keys(STRATEGY_LABEL) as AnimalStrategy[]).map((s) => (
              <option key={s} value={s}>
                {STRATEGY_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="row-count">
        {fmtInt(filtered.length)} activité{filtered.length > 1 ? 's' : ''} · cliquez une ligne pour le calcul détaillé
      </p>
      <div className={sel ? 'farm-split has-detail' : 'farm-split'}>
        <div className="table-scroll" tabIndex={0} aria-label="Classement des fermes">
          <table className="routes farm-table">
            <caption className="sr-only">Classement des activités agricoles par profit par parcelle et par jour</caption>
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => {
                    const meta = (h.column.columnDef.meta ?? {}) as { cls?: string; title?: string };
                    const sorted = h.column.getIsSorted();
                    const canSort = h.column.getCanSort();
                    return (
                      <th
                        key={h.id}
                        scope="col"
                        className={meta.cls}
                        aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : canSort ? 'none' : undefined}
                      >
                        {canSort ? (
                          <button type="button" className="sort-btn" onClick={h.column.getToggleSortingHandler()} title={meta.title}>
                            {flexRender(h.column.columnDef.header, h.getContext())}
                            <span className="sort-ind" aria-hidden="true">
                              {sorted === 'asc' ? '▲' : sorted === 'desc' ? '▼' : '↕'}
                            </span>
                          </button>
                        ) : (
                          flexRender(h.column.columnDef.header, h.getContext())
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => {
                const isSel = row.original.rowId === selected;
                return (
                  <tr
                    key={row.id}
                    className={isSel ? 'farm-row is-selected' : 'farm-row'}
                    tabIndex={0}
                    aria-selected={isSel}
                    onClick={() => setSelected(isSel ? null : row.original.rowId)}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault();
                        setSelected(isSel ? null : row.original.rowId);
                      }
                    }}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const meta = (cell.column.columnDef.meta ?? {}) as { cls?: string };
                      return (
                        <td key={cell.id} className={meta.cls}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {sel && <FarmDetail e={sel} metaById={metaById} onClose={() => setSelected(null)} />}
      </div>
    </div>
  );
}
