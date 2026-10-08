import { useMemo, useRef, useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ItemMeta, RouteResult } from '../../types';
import { fmtAgeH, fmtInt, fmtSilver, itemHref } from '../format';
import { ItemIcon } from './ItemIcon';
import { ConfidenceBar, RouteCell } from './Route';

export const VIRTUAL_THRESHOLD = 200;
const ROW_H = 44;

interface Props {
  rows: RouteResult[];
  metaById: Map<string, ItemMeta>;
  variant: 'ranked' | 'black-market';
  caption: string;
}

const nameOf = (r: RouteResult, meta: Map<string, ItemMeta>) => meta.get(r.recipe.outputId)?.nameFr ?? r.recipe.outputId;

export function RouteTable({ rows, metaById, variant, caption }: Props) {
  const [sorting, setSorting] = useState<SortingState>(
    variant === 'ranked' ? [{ id: 'score', desc: true }] : [{ id: 'profit', desc: true }],
  );

  const columns = useMemo<ColumnDef<RouteResult>[]>(() => {
    const cols: ColumnDef<RouteResult>[] = [
      {
        id: 'name',
        header: 'Objet',
        accessorFn: (r) => nameOf(r, metaById),
        sortingFn: (a, b) => String(a.getValue('name')).localeCompare(String(b.getValue('name')), 'fr'),
        cell: ({ row }) => {
          const r = row.original;
          const name = nameOf(r, metaById);
          return (
            <a className="item-link" href={itemHref(r.recipe.outputId)}>
              <ItemIcon id={r.recipe.outputId} name={name} size={28} />
              <span className="item-name">{name}</span>
            </a>
          );
        },
        meta: { cls: 'c-name' },
      },
      {
        id: 'tier',
        header: 'Tier',
        accessorFn: (r) => r.recipe.tier * 10 + r.recipe.enchant,
        cell: ({ row }) => (
          <span className={`tier tier-${row.original.recipe.tier}`}>
            {row.original.recipe.tier}.{row.original.recipe.enchant}
          </span>
        ),
        meta: { cls: 'c-tier num' },
      },
      {
        id: 'route',
        header: 'Achat › Production › Vente',
        enableSorting: false,
        cell: ({ row }) => <RouteCell r={row.original} />,
        meta: { cls: 'c-route' },
      },
      {
        id: 'profit',
        header: 'Profit/unité',
        accessorFn: (r) => r.unitProfit,
        cell: ({ getValue }) => <span className="profit">{fmtSilver(getValue<number>())}</span>,
        meta: { cls: 'c-profit num' },
      },
    ];
    if (variant === 'ranked') {
      cols.push(
        {
          id: 'volume',
          header: 'Volume/jour',
          accessorFn: (r) => r.volume ?? -1,
          cell: ({ row }) => fmtInt(row.original.volume),
          meta: { cls: 'c-vol num secondary', title: 'Volume médian vendu par jour sur 7 jours au lieu de vente' },
        },
        {
          id: 'q',
          header: 'Q',
          accessorFn: (r) => r.q ?? -1,
          cell: ({ row }) => fmtInt(row.original.q),
          meta: { cls: 'c-q num secondary', title: 'Quantité écoulable par jour' },
        },
      );
    }
    cols.push({
      id: 'c',
      header: 'C',
      accessorFn: (r) => r.confidence,
      cell: ({ row }) => <ConfidenceBar c={row.original.confidence} />,
      meta: { cls: 'c-conf', title: 'Confiance selon l’âge des prix' },
    });
    if (variant === 'ranked') {
      cols.push({
        id: 'score',
        header: 'Score',
        accessorFn: (r) => r.score ?? -Infinity,
        cell: ({ row }) => <strong className="score">{fmtInt(row.original.score)}</strong>,
        meta: { cls: 'c-score num', title: 'Profit × Q × C : argent espéré par jour' },
      });
    }
    cols.push({
      id: 'age',
      header: 'Âge',
      accessorFn: (r) => r.oldestPriceAgeH,
      cell: ({ row }) => {
        const h = row.original.oldestPriceAgeH;
        return <span className={h > 3 ? 'age age-old' : 'age'}>{fmtAgeH(h)}</span>;
      },
      meta: { cls: 'c-age num secondary', title: 'Âge du prix le plus vieux utilisé' },
    });
    return cols;
  }, [metaById, variant]);

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    sortDescFirst: true,
    getRowId: (r, i) => `${r.recipe.outputId}-${r.sellAt}-${i}`,
  });

  const tableRows = table.getRowModel().rows;
  const virtual = tableRows.length > VIRTUAL_THRESHOLD;
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: virtual ? tableRows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  });
  const vItems = virtual ? virtualizer.getVirtualItems() : [];
  const padTop = virtual && vItems.length ? vItems[0].start : 0;
  const padBottom = virtual && vItems.length ? virtualizer.getTotalSize() - vItems[vItems.length - 1].end : 0;
  const visible = virtual ? vItems.map((v) => tableRows[v.index]) : tableRows;
  const colCount = columns.length;

  if (rows.length === 0) {
    return (
      <p className="empty-table">
        Aucune route rentable ne passe les filtres. Élargissez l’âge maximal des prix, baissez le volume minimum ou
        retirez un filtre.
      </p>
    );
  }

  return (
    <div className={virtual ? 'table-scroll is-virtual' : 'table-scroll'} ref={scrollRef} tabIndex={0} aria-label={caption}>
      <table className="routes">
        <caption className="sr-only">{caption}</caption>
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
                      <button
                        type="button"
                        className="sort-btn"
                        onClick={h.column.getToggleSortingHandler()}
                        title={meta.title ? `${meta.title} — cliquer pour trier` : 'Cliquer pour trier'}
                      >
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
          {padTop > 0 && (
            <tr aria-hidden="true" className="spacer">
              <td colSpan={colCount} style={{ height: padTop }} />
            </tr>
          )}
          {visible.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => {
                const meta = (cell.column.columnDef.meta ?? {}) as { cls?: string };
                return (
                  <td key={cell.id} className={meta.cls}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                );
              })}
            </tr>
          ))}
          {padBottom > 0 && (
            <tr aria-hidden="true" className="spacer">
              <td colSpan={colCount} style={{ height: padBottom }} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
