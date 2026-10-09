import { useCallback, useMemo, useRef, useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { DEFAULT_SETTINGS, type ItemMeta, type RouteResult, type Settings } from '../../types';
import { fmtInt, fmtPct, fmtSilver, itemHref, subcatLabel } from '../format';
import { FavoriteButton } from './FavoriteButton';
import { ItemIcon } from './ItemIcon';
import { AgeBadge, ConfidenceBar, RouteCell, routeText } from './Route';
import { RouteDetail } from './RouteDetail';

export const VIRTUAL_THRESHOLD = 200;
const ROW_H = 44;

interface Props {
  rows: RouteResult[];
  metaById: Map<string, ItemMeta>;
  variant: 'ranked' | 'black-market';
  caption: string;
  /** Réglages courants (détail des calculs, seuils d'âge). Défaut : DEFAULT_SETTINGS. */
  settings?: Settings;
}

/** Aide des en-têtes (infobulles + légende « Comment lire ce classement ? »). */
export function columnHelp(s: Settings): Record<string, string> {
  return {
    profit: 'Vente moins taxes, achats d’ingrédients (après retour de ressources) et frais de station, pour une unité.',
    volume: 'Nombre médian d’unités vendues par jour sur 7 jours au lieu de vente, tous vendeurs confondus.',
    q: `Ce que vous pouvez vendre par jour : ventes du marché × votre part (${fmtPct(s.marketShare)}), plafonné à ${fmtInt(s.dailyCap)}/jour.`,
    c: 'Fiabilité des prix (0 à 1) : baisse avec l’âge des prix, un historique mince, un prix estimé ou périmé.',
    score: 'Profit/unité × ventes possibles/jour × confiance : l’argent espéré par jour, ajusté selon la fiabilité. C’est le critère de classement.',
    age: `Âge du prix le plus vieux utilisé. Vert : moins d’1 h ; normal : moins de ${fmtInt(s.maxPriceAgeH)} h ; ambre : périmé ; gris : 24 h ou plus.`,
  };
}

const detailId = (rowId: string) => `rd-${rowId.replace(/[^A-Za-z0-9_-]/g, '_')}`;

const nameOf = (r: RouteResult, meta: Map<string, ItemMeta>) => meta.get(r.recipe.outputId)?.nameFr ?? r.recipe.outputId;

export function RouteTable({ rows, metaById, variant, caption, settings = DEFAULT_SETTINGS }: Props) {
  const [sorting, setSorting] = useState<SortingState>(
    variant === 'ranked' ? [{ id: 'score', desc: true }] : [{ id: 'profit', desc: true }],
  );
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggleOpen = useCallback((id: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const help = useMemo(() => columnHelp(settings), [settings]);
  const maxAge = settings.maxPriceAgeH;

  const columns = useMemo<ColumnDef<RouteResult>[]>(() => {
    const cols: ColumnDef<RouteResult>[] = [
      {
        id: 'fav',
        header: () => <span className="sr-only">Favori</span>,
        enableSorting: false,
        cell: ({ row }) => (
          <FavoriteButton id={row.original.recipe.outputId} name={nameOf(row.original, metaById)} />
        ),
        meta: { cls: 'c-fav' },
      },
      {
        id: 'name',
        header: 'Objet',
        accessorFn: (r) => nameOf(r, metaById),
        sortingFn: (a, b) => String(a.getValue('name')).localeCompare(String(b.getValue('name')), 'fr'),
        // Colonne texte : premier clic = ordre alphabétique croissant.
        sortDescFirst: false,
        cell: ({ row }) => {
          const r = row.original;
          const name = nameOf(r, metaById);
          return (
            <span className="item-cell">
              <a className="item-link" href={itemHref(r.recipe.outputId)}>
                <ItemIcon id={r.recipe.outputId} name={name} size={28} />
                <span className="item-name">{name}</span>
              </a>
              <span className="item-line">
                <span className="item-cat">{subcatLabel(r.recipe.subcategory)}</span>
                {r.recipe.variant && (
                  <span className="item-variant" title={`Recette alternative à partir de ${metaById.get(r.recipe.variant)?.nameFr ?? r.recipe.variant}`}>
                    {` · ×${r.recipe.outputQty}`}
                  </span>
                )}
                {/* Mobile : la colonne route est masquée, la route s'affiche ici. */}
                <span className="route-mini">{` · ${routeText(r)}`}</span>
              </span>
            </span>
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
        meta: { cls: 'c-profit num', title: help.profit },
      },
    ];
    if (variant === 'ranked') {
      cols.push(
        {
          id: 'volume',
          header: 'Ventes/jour (marché)',
          accessorFn: (r) => r.volume ?? undefined,
          sortUndefined: 'last',
          cell: ({ row }) => fmtInt(row.original.volume),
          meta: { cls: 'c-vol num secondary', title: help.volume },
        },
        {
          id: 'q',
          header: 'Vous vendez/jour',
          accessorFn: (r) => r.q ?? undefined,
          sortUndefined: 'last',
          cell: ({ row }) =>
            row.original.q == null ? '—' : <span title={`Vous pouvez vendre ≈ ${fmtInt(row.original.q)}/jour`}>≈ {fmtInt(row.original.q)}</span>,
          meta: { cls: 'c-q num secondary', title: help.q },
        },
      );
    }
    cols.push({
      id: 'c',
      header: 'Confiance',
      accessorFn: (r) => r.confidence,
      cell: ({ row }) => <ConfidenceBar c={row.original.confidence} />,
      meta: { cls: 'c-conf', title: help.c },
    });
    if (variant === 'ranked') {
      cols.push({
        id: 'score',
        header: 'Profit/jour estimé',
        accessorFn: (r) => r.score ?? undefined,
        sortUndefined: 'last',
        cell: ({ row }) => <strong className="score">{fmtSilver(row.original.score)}</strong>,
        meta: { cls: 'c-score num', title: help.score },
      });
    }
    cols.push({
      id: 'age',
      header: 'Âge des prix',
      accessorFn: (r) => r.oldestPriceAgeH,
      cell: ({ row }) => <AgeBadge h={row.original.oldestPriceAgeH} maxH={maxAge} />,
      meta: { cls: 'c-age num secondary', title: help.age },
    });
    cols.push({
      id: 'detail',
      header: () => <span className="sr-only">Détail du calcul</span>,
      enableSorting: false,
      // Rendu dans la boucle du corps (dépend de l'état « ouvert », hors des définitions de colonnes).
      cell: () => null,
      meta: { cls: 'c-detail' },
    });
    return cols;
  }, [metaById, variant, help, maxAge]);

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    sortDescFirst: true, // colonnes numériques : premier clic = décroissant
    getRowId: (r, i) => `${r.recipe.outputId}${r.recipe.variant ? '|' + r.recipe.variant : ''}-${r.sellAt}-${i}`,
  });

  const tableRows = table.getRowModel().rows;
  const virtual = tableRows.length > VIRTUAL_THRESHOLD;
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: virtual ? tableRows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    // Hauteur mesurée (panneau ouvert) attachée à la ligne, pas à sa position : un tri ne la décale plus.
    getItemKey: (i) => tableRows[i]?.id ?? i,
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
        {!settings.showStale && ' Vous pouvez aussi afficher les opportunités aux prix périmés.'}
      </p>
    );
  }

  return (
    <div className={virtual ? 'table-scroll is-virtual' : 'table-scroll'} ref={scrollRef} tabIndex={0} aria-label={caption}>
      <table className="routes routes-grouped">
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
                    title={meta.title}
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
        {padTop > 0 && (
          <tbody aria-hidden="true">
            <tr className="spacer">
              <td colSpan={colCount} style={{ height: padTop }} />
            </tr>
          </tbody>
        )}
        {visible.map((row, i) => {
          const isOpen = open.has(row.id);
          return (
            // Une ligne + son détail par <tbody> : le virtualiseur mesure le groupe entier.
            <tbody
              key={row.id}
              className={isOpen ? 'r-group is-open' : 'r-group'}
              data-index={virtual ? vItems[i].index : undefined}
              ref={virtual ? virtualizer.measureElement : undefined}
            >
              <tr className={row.original.flags.includes('stale') ? 'is-stale' : undefined}>
                {row.getVisibleCells().map((cell) => {
                  const meta = (cell.column.columnDef.meta ?? {}) as { cls?: string };
                  return (
                    <td key={cell.id} className={meta.cls}>
                      {cell.column.id === 'detail' ? (
                        <button
                          type="button"
                          className={isOpen ? 'detail-btn is-open' : 'detail-btn'}
                          aria-expanded={isOpen}
                          aria-controls={isOpen ? detailId(row.id) : undefined}
                          title={isOpen ? 'Masquer le détail du calcul' : 'Pourquoi ce classement ? Afficher le détail du calcul'}
                          onClick={() => toggleOpen(row.id)}
                        >
                          <span className="sr-only">{`Détail du calcul : ${nameOf(row.original, metaById)}`}</span>
                          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                            <path d="M5.5 3.5 10 8l-4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                      ) : (
                        flexRender(cell.column.columnDef.cell, cell.getContext())
                      )}
                    </td>
                  );
                })}
              </tr>
              {isOpen && (
                <tr className="detail-row">
                  <td colSpan={colCount}>
                    <RouteDetail r={row.original} settings={settings} id={detailId(row.id)} />
                  </td>
                </tr>
              )}
            </tbody>
          );
        })}
        {padBottom > 0 && (
          <tbody aria-hidden="true">
            <tr className="spacer">
              <td colSpan={colCount} style={{ height: padBottom }} />
            </tr>
          </tbody>
        )}
      </table>
    </div>
  );
}
