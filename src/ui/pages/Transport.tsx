import { useMemo, useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import type { ItemMeta, Location } from '../../types';
import {
  EMPTY_TRANSPORT_FILTERS,
  TRANSPORT_BUY_LOCATIONS,
  TRANSPORT_SELL_LOCATIONS,
  applyTransportFilters,
  computeTransport,
  type TransportFilters,
  type TransportFlag,
  type TransportView,
} from '../../engine/transport';
import { useAppData } from '../context';
import { LOC_ABBR, LOC_KEY, fmtAgeH, fmtInt, fmtPct, fmtSilver, itemHref, plural } from '../format';
import { ItemIcon } from '../components/ItemIcon';
import '../transport.css';

const PAGE_SIZE = 200;

const FLAG_TEXT: Record<TransportFlag, { short: string; long: string }> = {
  'red-zone': { short: 'Zone rouge', long: 'Caerleon ou le Black Market est impliqué : trajet en zone rouge, vous pouvez tout perdre.' },
  mists: { short: 'Brumes', long: 'Brecilien n’est accessible que par les Brumes.' },
  suspect: { short: 'Suspect', long: 'Prix anormal par rapport à la moyenne sur 7 jours : ordre piège ou erreur de collecte possible.' },
  stale: { short: 'Périmé', long: 'Au moins un des deux prix est plus vieux que l’âge maximal réglé.' },
};

function Loc({ loc }: { loc: Location }) {
  return (
    <abbr className={`loc loc-${LOC_KEY[loc]}`} title={loc}>
      {LOC_ABBR[loc]}
    </abbr>
  );
}

function Leg({ loc, price, ageH, staleH }: { loc: Location; price: number; ageH: number; staleH: number }) {
  return (
    <span className="tp-leg">
      <Loc loc={loc} />
      <span className="tp-leg-price">{fmtSilver(price)}</span>
      <span className={ageH >= staleH ? 'tp-leg-age age-old' : 'tp-leg-age'}>{fmtAgeH(ageH)}</span>
    </span>
  );
}

const nameOf = (id: string, meta: Map<string, ItemMeta>) => meta.get(id)?.nameFr ?? id;

/** Champ numérique optionnel : vide → null. */
function NumField({
  label,
  value,
  onChange,
  suffix,
  step = 1,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  suffix?: string;
  step?: number;
}) {
  return (
    <label className="tp-field">
      <span className="f-label">{label}</span>
      <span className="num-input">
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step={step}
          value={value ?? ''}
          placeholder="—"
          aria-label={label}
          onChange={(e) => {
            const v = e.target.value === '' ? null : Number(e.target.value);
            onChange(v != null && Number.isFinite(v) && v >= 0 ? v : null);
          }}
        />
        {suffix && <span className="suffix">{suffix}</span>}
      </span>
    </label>
  );
}

export function TransportPage() {
  const { snapshot, settings, now, metaById } = useAppData();
  const [includeStale, setIncludeStale] = useState(false);
  const [allPairs, setAllPairs] = useState(false);
  const [filters, setFilters] = useState<TransportFilters>(EMPTY_TRANSPORT_FILTERS);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [sorting, setSorting] = useState<SortingState>([{ id: 'day', desc: true }]);
  const set = (patch: Partial<TransportFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setLimit(PAGE_SIZE);
  };

  const result = useMemo(
    () => computeTransport(snapshot, settings, now, metaById, { includeStale, allPairs }),
    [snapshot, settings, now, metaById, includeStale, allPairs],
  );
  const rows = useMemo(() => applyTransportFilters(result.rows, filters, metaById), [result, filters, metaById]);
  const showTrip = filters.maxLoadKg != null && filters.maxLoadKg > 0;
  const staleH = settings.maxPriceAgeH;

  const columns = useMemo<ColumnDef<TransportView>[]>(() => {
    const cols: ColumnDef<TransportView>[] = [
      {
        id: 'name',
        header: 'Objet',
        accessorFn: (r) => nameOf(r.itemId, metaById),
        sortingFn: (a, b) => String(a.getValue('name')).localeCompare(String(b.getValue('name')), 'fr'),
        sortDescFirst: false,
        cell: ({ row }) => {
          const r = row.original;
          const m = metaById.get(r.itemId);
          const name = nameOf(r.itemId, metaById);
          return (
            <a className="item-link tp-item" href={itemHref(r.itemId)} onClick={(e) => e.stopPropagation()}>
              <ItemIcon id={r.itemId} name={name} size={28} />
              <span className="tp-item-text">
                <span className="item-name">{name}</span>
                {m && (
                  <span className={`tier tier-${m.tier}`}>
                    {m.tier}.{m.enchant}
                  </span>
                )}
              </span>
            </a>
          );
        },
        meta: { cls: 'tp-c-name' },
      },
      {
        id: 'buy',
        header: 'Acheter à',
        accessorFn: (r) => r.buyPrice,
        cell: ({ row }) => <Leg loc={row.original.buyAt} price={row.original.buyPrice} ageH={row.original.buyAgeH} staleH={staleH} />,
        meta: { cls: 'tp-c-leg', title: settings.mode === 'instant' ? 'Prix de vente le plus bas (achat immédiat)' : 'Ordre d’achat + 2,5 % de frais' },
      },
      {
        id: 'sell',
        header: 'Vendre à',
        accessorFn: (r) => r.sellPrice,
        cell: ({ row }) => <Leg loc={row.original.sellAt} price={row.original.sellPrice} ageH={row.original.sellAgeH} staleH={staleH} />,
        meta: { cls: 'tp-c-leg', title: 'Prix brut avant taxe' },
      },
      {
        id: 'unit',
        header: 'Profit/unité',
        accessorFn: (r) => r.unitProfit,
        cell: ({ getValue }) => <span className="profit">{fmtSilver(getValue<number>())}</span>,
        meta: { cls: 'num', title: 'Revenu net (taxe et frais déduits) moins prix d’achat' },
      },
      {
        id: 'margin',
        header: 'Marge',
        accessorFn: (r) => r.margin,
        cell: ({ getValue }) => fmtPct(getValue<number>(), 0),
        meta: { cls: 'num', title: 'Profit / prix d’achat' },
      },
      {
        id: 'qty',
        header: 'Ventes/jour',
        accessorFn: (r) => r.dayQty,
        cell: ({ row }) => fmtInt(row.original.dayQty),
        meta: { cls: 'num', title: 'Quantité vendable par jour à destination (volume × part de marché, plafonnée)' },
      },
      {
        id: 'day',
        header: 'Profit/jour',
        accessorFn: (r) => r.dayProfit,
        cell: ({ getValue }) => <strong className="tp-day">{fmtSilver(getValue<number>())}</strong>,
        meta: { cls: 'num', title: 'Profit/unité × ventes/jour' },
      },
    ];
    if (showTrip) {
      cols.push({
        id: 'trip',
        header: 'Profit/trajet',
        accessorFn: (r) => r.tripProfit ?? undefined,
        sortUndefined: 'last',
        cell: ({ row }) =>
          row.original.tripProfit == null ? (
            <span className="muted" title="Poids inconnu">—</span>
          ) : (
            <span title={`${fmtInt(row.original.tripQty)} unités par trajet`}>{fmtSilver(row.original.tripProfit)}</span>
          ),
        meta: { cls: 'num', title: 'min(ventes/jour, charge ÷ poids) × profit/unité' },
      });
    }
    cols.push({
      id: 'risk',
      header: 'Risque',
      enableSorting: false,
      cell: ({ row }) =>
        row.original.flags.length === 0 ? (
          <span className="muted">—</span>
        ) : (
          <span className="flags">
            {row.original.flags.map((f) => (
              <span key={f} className={`flag tp-flag-${f}`} title={FLAG_TEXT[f].long}>
                {FLAG_TEXT[f].short}
              </span>
            ))}
          </span>
        ),
    });
    return cols;
  }, [metaById, showTrip, staleH, settings.mode]);

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    sortDescFirst: true,
    getRowId: (r) => `${r.itemId}|${r.buyAt}|${r.sellAt}`,
  });
  const sorted = table.getRowModel().rows;
  const visible = sorted.slice(0, limit);

  const anyFilter = JSON.stringify(filters) !== JSON.stringify(EMPTY_TRANSPORT_FILTERS);

  return (
    <section className="page tp-page" aria-labelledby="page-title">
      <header className="page-head">
        <h1 id="page-title">Transport</h1>
        <p className="page-intro">
          Achetez un objet là où il est bon marché et revendez-le tel quel dans une autre ville, sans rien fabriquer. Le
          profit tient compte de la taxe de vente{settings.mode === 'orders' ? ' et des frais d’ordre' : ''} et de ce que
          le marché d’arrivée absorbe vraiment chaque jour.
        </p>
        <p className="stats-line">
          {settings.premium ? 'Premium' : 'Sans premium'} · {settings.mode === 'instant' ? 'achat et vente instantanés' : 'ordres d’achat et de vente'} ·{' '}
          {`part de marché ${fmtPct(settings.marketShare, 0)}`} · {plural(result.evaluated, 'objet examiné')} ·{' '}
          <a href="#/reglages">modifier les réglages</a>
        </p>
      </header>

      <div className="tp-filters" role="group" aria-label="Filtres">
        <label className="tp-field tp-search">
          <span className="f-label">Rechercher</span>
          <input type="search" value={filters.search} placeholder="Nom de l’objet" onChange={(e) => set({ search: e.target.value })} />
        </label>
        <label className="tp-field">
          <span className="f-label">Ville de départ</span>
          <select value={filters.from} onChange={(e) => set({ from: e.target.value as Location | '' })}>
            <option value="">Toutes</option>
            {TRANSPORT_BUY_LOCATIONS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="tp-field">
          <span className="f-label">Ville d’arrivée</span>
          <select value={filters.to} onChange={(e) => set({ to: e.target.value as Location | '' })}>
            <option value="">Toutes</option>
            {TRANSPORT_SELL_LOCATIONS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <div className="tp-field">
          <NumField label="Budget max" value={filters.budget} onChange={(budget) => set({ budget })} suffix="ag" />
          <span className="segmented tp-seg" role="group" aria-label="Type de budget">
            <button type="button" className={filters.budgetMode === 'unit' ? 'seg on' : 'seg'} aria-pressed={filters.budgetMode === 'unit'} onClick={() => set({ budgetMode: 'unit' })}>
              par unité
            </button>
            <button type="button" className={filters.budgetMode === 'total' ? 'seg on' : 'seg'} aria-pressed={filters.budgetMode === 'total'} onClick={() => set({ budgetMode: 'total' })}>
              total
            </button>
          </span>
        </div>
        <NumField label="Profit min/unité" value={filters.minUnitProfit} onChange={(minUnitProfit) => set({ minUnitProfit })} suffix="ag" />
        <NumField label="Charge max" value={filters.maxLoadKg} onChange={(maxLoadKg) => set({ maxLoadKg })} suffix="kg" step={10} />
        <div className="tp-checks">
          <label className="f-check">
            <input type="checkbox" checked={filters.excludeRedZone} onChange={(e) => set({ excludeRedZone: e.target.checked })} />
            Exclure la zone rouge
          </label>
          <label className="f-check">
            <input type="checkbox" checked={filters.hideSuspect} onChange={(e) => set({ hideSuspect: e.target.checked })} />
            Masquer les prix suspects
          </label>
          <label className="f-check">
            <input type="checkbox" checked={includeStale} onChange={(e) => setIncludeStale(e.target.checked)} />
            Inclure les prix plus vieux, marqués périmés
          </label>
          <label className="f-check">
            <input type="checkbox" checked={allPairs} onChange={(e) => setAllPairs(e.target.checked)} />
            Toutes les paires de villes
          </label>
        </div>
      </div>

      <p className="row-count" aria-live="polite">
        {rows.length === result.rows.length
          ? plural(rows.length, 'trajet rentable')
          : `${plural(rows.length, 'trajet affiché')} sur ${fmtInt(result.rows.length)}`}
        {!allPairs && rows.length > 0 && ' · meilleur couple de villes par objet'}
      </p>

      {rows.length === 0 ? (
        <div className="empty-table tp-empty">
          {!snapshot ? (
            <p>Les prix ne sont pas encore chargés.</p>
          ) : result.rows.length === 0 ? (
            <>
              <p>
                Aucun trajet rentable avec des prix de moins de {fmtInt(settings.maxPriceAgeH)} h. Les écarts entre villes se
                referment vite : un prix récent manque souvent d’un côté.
              </p>
              {!includeStale && (
                <button type="button" className="btn" onClick={() => setIncludeStale(true)}>
                  Inclure les prix plus vieux
                </button>
              )}
            </>
          ) : (
            <>
              <p>Aucun trajet ne passe ces filtres. Changez de ville, augmentez le budget ou baissez le profit minimum.</p>
              {anyFilter && (
                <button type="button" className="btn" onClick={() => set(EMPTY_TRANSPORT_FILTERS)}>
                  Effacer les filtres
                </button>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          <div className="table-scroll tp-scroll" tabIndex={0} aria-label="Trajets de transport">
            <table className="tp-table">
              <caption className="sr-only">Trajets de transport</caption>
              <thead>
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((h) => {
                      const meta = (h.column.columnDef.meta ?? {}) as { cls?: string; title?: string };
                      const s = h.column.getIsSorted();
                      const canSort = h.column.getCanSort();
                      return (
                        <th
                          key={h.id}
                          scope="col"
                          className={meta.cls}
                          aria-sort={s === 'asc' ? 'ascending' : s === 'desc' ? 'descending' : canSort ? 'none' : undefined}
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
                                {s === 'asc' ? '▲' : s === 'desc' ? '▼' : '↕'}
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
                {visible.map((row) => (
                  <tr
                    key={row.id}
                    className="tp-row"
                    onClick={() => {
                      window.location.hash = itemHref(row.original.itemId);
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
                ))}
              </tbody>
            </table>
          </div>
          {sorted.length > limit && (
            <p className="tp-more">
              <button type="button" className="btn" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
                Afficher {fmtInt(Math.min(PAGE_SIZE, sorted.length - limit))} de plus
              </button>
              <span className="muted">{`${fmtInt(limit)} sur ${fmtInt(sorted.length)}`}</span>
            </p>
          )}
        </>
      )}
    </section>
  );
}
