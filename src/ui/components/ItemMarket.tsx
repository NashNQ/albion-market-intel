// Fiche objet — marché : verdicts joueur (prix normal ? ventes/jour ? tendance ?), graphique 30 j,
// calculateur d'écoulement et tableau des prix par lieu actualisable en direct (API AODP).
import { useId, useMemo, useState, type ReactNode } from 'react';
import { LOCATIONS, type Location, type MarketItem } from '../../types';
import {
  DAY_MS,
  ageClass,
  average30d,
  daysToSell,
  deviationPct,
  lastDays,
  medianDailySales,
  startOfUtcDay,
  trend7d,
  type AgeClass,
  type DailyPoint,
} from '../../engine/history-metrics';
import { useAppData } from '../context';
import { LOC_ABBR, LOC_KEY, ageHFromIso, fmtAgeH, fmtClock, fmtInt, fmtPct, fmtSilver, plural } from '../format';
import { useItemHistory, useLivePrices, type HistoryByLoc, type LivePrices, type Loadable } from '../data/history';
import { HistoryChart, fmtDate } from './charts/HistoryChart';
import { LocChip } from './Route';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Seuil (valeur absolue) sous lequel le prix est « dans la normale ». */
const NORMAL_BAND = 0.05;
/** Au-delà : « anormalement » haut ou bas. */
const ABNORMAL_BAND = 0.25;

const AGE_LABEL: Record<AgeClass, string> = {
  fresh: 'moins d’une heure',
  ok: 'moins de 6 h',
  old: 'plus de 6 h',
  stale: 'périmé (plus de 24 h)',
  none: 'absent',
};

interface CurrentPrice {
  price: number;
  ageH: number | null;
  source: 'live' | 'snapshot';
}

function signedPct(p: number): string {
  const s = fmtPct(Math.abs(p), 0);
  return p > 0 ? `+${s}` : p < 0 ? `−${s}` : s;
}

/** Ville par défaut : la plus active (ventes/jour), hors Black Market s'il y a mieux. */
function pickDefaultCity(sales: Partial<Record<Location, number | null>>): Location {
  let best: Location = 'Martlock';
  let bestV = -1;
  for (const loc of LOCATIONS) {
    const v = sales[loc] ?? -1;
    const score = loc === 'Black Market' ? v * 0.5 : v;
    if (score > bestV) {
      bestV = score;
      best = loc;
    }
  }
  return best;
}

export function ItemMarket({ id, item, fetchImpl }: { id: string; item: MarketItem | undefined; fetchImpl?: FetchLike }) {
  const { settings, now } = useAppData();
  const [hist, retryHist] = useItemHistory(id, fetchImpl);
  const [live, refreshLive] = useLivePrices(id, fetchImpl);
  const [chosen, setChosen] = useState<Location | null>(null);
  const [compare, setCompare] = useState(false);
  const [qty, setQty] = useState(100);
  const selectId = useId();
  const qtyId = useId();

  const nowMs = now.getTime();
  const histData: HistoryByLoc | null = hist.state === 'ok' ? hist.data : null;
  const liveData: LivePrices | null =
    live.state === 'ok' ? live.data : live.state === 'loading' || live.state === 'error' ? live.prev ?? null : null;
  const liveAt = live.state === 'ok' ? live.at : null;
  // Âges calculés à l'instant le plus récent connu (horloge de l'app ou heure de la requête en direct).
  const refNow = Math.max(nowMs, liveAt ?? 0);

  const salesByLoc = useMemo(() => {
    const out: Partial<Record<Location, number | null>> = {};
    for (const loc of LOCATIONS) {
      const d = histData?.[loc];
      out[loc] = d ? medianDailySales(d, nowMs) : item?.volume7d[loc] ?? null;
    }
    return out;
  }, [histData, item, nowMs]);

  const city = chosen ?? pickDefaultCity(salesByLoc);
  const daily: DailyPoint[] = histData?.[city] ?? [];
  const avg30 = useMemo(() => average30d(daily, nowMs), [daily, nowMs]);
  const trend = useMemo(() => trend7d(daily, nowMs), [daily, nowMs]);
  const sales = salesByLoc[city] ?? null;

  const current: CurrentPrice | null = useMemo(() => {
    const lp = liveData?.[city];
    if (lp?.sell != null) return { price: lp.sell, ageH: lp.sellAt != null ? Math.max(0, (refNow - lp.sellAt) / 3.6e6) : null, source: 'live' };
    const sp = item?.prices[city];
    if (sp?.sell != null) return { price: sp.sell, ageH: ageHFromIso(sp.sellAt, now), source: 'snapshot' };
    return null;
  }, [liveData, item, city, now, refNow]);
  const dev = deviationPct(current?.price, avg30);

  const endDay = startOfUtcDay(nowMs);
  const startDay = endDay - 29 * DAY_MS;
  const others = compare
    ? LOCATIONS.filter((l) => l !== city && histData?.[l]?.length).map((l) => ({ loc: l, days: histData![l]! }))
    : [];
  const windowDays = lastDays(daily, 30, nowMs);

  const share = settings.marketShare;
  const perDay = sales != null ? Math.min(sales * share, settings.dailyCap) : null;
  const days = daysToSell(qty, sales, share, settings.dailyCap);

  return (
    <>
      <section aria-labelledby="h-market" className="block im">
        <div className="im-head">
          <h2 id="h-market">Marché sur 30 jours</h2>
          <div className="im-controls">
            <label htmlFor={selectId} className="im-label">Ville</label>
            <select id={selectId} value={city} onChange={(e) => setChosen(e.target.value as Location)}>
              {LOCATIONS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
            <label className="im-check">
              <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
              Comparer toutes les villes
            </label>
          </div>
        </div>

        {hist.state === 'loading' && (
          <p className="im-status" role="status">
            Chargement de l’historique des ventes…
          </p>
        )}
        {hist.state === 'error' && (
          <div className="im-error" role="alert">
            <p>{hist.message}</p>
            <button type="button" className="btn" onClick={retryHist}>
              Réessayer
            </button>
          </div>
        )}

        <div className="im-verdicts" aria-busy={hist.state === 'loading'}>
          <Verdict title="Ce prix est-il normal ?">
            {current && dev != null ? (
              <>
                <p className="im-big">
                  <span className={`im-badge ${Math.abs(dev) < NORMAL_BAND ? 'is-normal' : dev > 0 ? 'is-high' : 'is-low'}`}>
                    {signedPct(dev)} vs moyenne 30 j
                  </span>
                </p>
                <p className="im-line">
                  {Math.abs(dev) < NORMAL_BAND
                    ? 'Prix dans la normale'
                    : `${Math.abs(dev) >= ABNORMAL_BAND ? 'Anormalement ' : 'Plutôt '}${dev > 0 ? 'haut' : 'bas'}`}
                  {' '}: {fmtSilver(current.price)} (vente min.{current.ageH != null ? `, il y a ${fmtAgeH(current.ageH)}` : ''}
                  {current.source === 'live' ? ', en direct' : ''}) contre {fmtSilver(avg30)} en moyenne.
                </p>
              </>
            ) : (
              <p className="im-line muted">
                {hist.state === 'loading'
                  ? '…'
                  : !current
                    ? `Aucun prix de vente actuel à ${city} : essayez « Actualiser les prix » ci-dessous.`
                    : `Pas d’historique de ventes à ${city} sur 30 jours.`}
              </p>
            )}
          </Verdict>

          <Verdict title="Combien puis-je vendre par jour ?">
            {sales != null ? (
              <>
                <p className="im-big">≈ {plural(Math.round(sales), 'vente')}/jour</p>
                <p className="im-line">
                  à <LocChip loc={city} /> {city}, médiane des 7 derniers jours complets
                  {histData ? '' : ' (données de la dernière collecte)'}.
                </p>
              </>
            ) : (
              <p className="im-line muted">{hist.state === 'loading' ? '…' : `Aucune vente enregistrée à ${city}.`}</p>
            )}
          </Verdict>

          <Verdict title="Le prix monte ou descend ?">
            {trend ? (
              <>
                <p className={`im-big im-trend is-${trend.dir}`}>
                  <span className="im-arrow" aria-hidden="true">
                    {trend.dir === 'up' ? '↗' : trend.dir === 'down' ? '↘' : '→'}
                  </span>
                  {trend.dir === 'up' ? 'En hausse' : trend.dir === 'down' ? 'En baisse' : 'Stable'}
                </p>
                <p className="im-line">
                  {signedPct(trend.pct)} sur 7 jours (tendance linéaire sur {trend.days} jours de ventes).
                </p>
              </>
            ) : (
              <p className="im-line muted">
                {hist.state === 'loading' ? '…' : 'Pas assez de jours de ventes récents pour dégager une tendance.'}
              </p>
            )}
          </Verdict>
        </div>

        {histData && (windowDays.length > 0 || others.length > 0) ? (
          <figure className="im-chart">
            <figcaption className="im-caption">
              Prix moyen de vente par jour (ligne, en argent) et nombre de ventes par jour (barres) à {city}.
            </figcaption>
            {compare && others.length > 0 && (
              <ul className="im-legend" aria-label="Légende">
                <li className="is-primary">
                  <span className="im-key" style={{ ['--c' as string]: `var(--${LOC_KEY[city]})` }} />
                  {city}
                </li>
                <li>
                  <span className="im-key is-ctx" />
                  Autres villes ({others.map((o) => LOC_ABBR[o.loc]).join(', ')}), nommées en bout de ligne
                </li>
              </ul>
            )}
            <HistoryChart primary={{ loc: city, days: daily }} others={others} startDay={startDay} endDay={endDay} />
            <details className="im-data">
              <summary>Voir les données</summary>
              <DataTable city={city} daily={windowDays} others={others.map((o) => ({ loc: o.loc, days: lastDays(o.days, 30, nowMs) }))} />
            </details>
          </figure>
        ) : histData ? (
          <p className="muted">Aucune vente enregistrée à {city} ces 30 derniers jours.</p>
        ) : null}

        <div className="im-calc">
          <h3>Combien de temps pour écouler mon stock ?</h3>
          <div className="im-calc-row">
            <label htmlFor={qtyId}>Quantité à vendre</label>
            <input
              id={qtyId}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={Number.isFinite(qty) ? qty : ''}
              onChange={(e) => setQty(Math.max(0, Math.floor(Number(e.target.value))))}
            />
            <output htmlFor={qtyId} className="im-calc-out" aria-live="polite">
              {days == null ? (
                sales == null ? `Pas de volume de ventes connu à ${city}.` : 'Saisissez une quantité.'
              ) : (
                <>
                  ≈ <strong>{days < 1 ? 'moins d’un jour' : plural(Math.ceil(days), 'jour')}</strong> à {city}
                </>
              )}
            </output>
          </div>
          {perDay != null && (
            <p className="im-line muted">
              Hypothèse : vous captez {fmtPct(share, 0)} des ≈ {fmtInt(sales)} ventes/jour, soit ≈ {fmtInt(perDay)} unités/jour
              {sales != null && sales * share > settings.dailyCap ? ` (plafonné à ${fmtInt(settings.dailyCap)})` : ''}.{' '}
              <a href="#/reglages">Modifier la part de marché</a>
            </p>
          )}
        </div>
      </section>

      <PriceTable item={item} live={live} liveData={liveData} refNow={refNow} onRefresh={refreshLive} />
    </>
  );
}

function Verdict({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="im-verdict">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function DataTable({ city, daily, others }: { city: Location; daily: DailyPoint[]; others: { loc: Location; days: DailyPoint[] }[] }) {
  const days = [...new Set([...daily.map((d) => d.day), ...others.flatMap((o) => o.days.map((d) => d.day))])].sort((a, b) => b - a);
  const main = new Map(daily.map((d) => [d.day, d]));
  const ctx = others.map((o) => new Map(o.days.map((d) => [d.day, d])));
  return (
    <div className="table-scroll">
      <table className="plain">
        <caption className="sr-only">Historique journalier à {city}, du plus récent au plus ancien</caption>
        <thead>
          <tr>
            <th scope="col">Jour</th>
            <th scope="col" className="num">Prix moyen {city}</th>
            <th scope="col" className="num">Ventes {city}</th>
            {others.map((o) => (
              <th key={o.loc} scope="col" className="num secondary">
                Prix {o.loc}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d}>
              <th scope="row">{fmtDate(d)}</th>
              <td className="num">{fmtSilver(main.get(d)?.price)}</td>
              <td className="num">{fmtInt(main.get(d)?.volume)}</td>
              {ctx.map((m, i) => (
                <td key={others[i].loc} className="num secondary">
                  {fmtSilver(m.get(d)?.price)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AgeCell({ ageH }: { ageH: number | null }) {
  const c = ageClass(ageH);
  return (
    <td className={`num age age-${c}`} title={`Âge du prix : ${AGE_LABEL[c]}`}>
      {c === 'none' ? '—' : fmtAgeH(ageH)}
      {c === 'stale' && <span className="age-tag">périmé</span>}
    </td>
  );
}

function PriceTable({
  item,
  live,
  liveData,
  refNow,
  onRefresh,
}: {
  item: MarketItem | undefined;
  live: Loadable<LivePrices>;
  liveData: LivePrices | null;
  refNow: number;
  onRefresh: () => void;
}) {
  const { now } = useAppData();
  const ageOf = (t: number | null) => (t == null ? null : Math.max(0, (refNow - t) / 3.6e6));
  const loading = live.state === 'loading';
  const rows = LOCATIONS.map((loc) => {
    const sp = item?.prices[loc];
    const lp = liveData?.[loc];
    // Un prix n'est jamais masqué : si l'API en direct n'en renvoie pas, on garde celui de la collecte.
    const sellLive = lp?.sell != null;
    const buyLive = lp?.buy != null;
    return {
      loc,
      sell: sellLive ? lp!.sell : sp?.sell ?? null,
      sellAge: sellLive ? ageOf(lp!.sellAt) : ageHFromIso(sp?.sellAt, now),
      buy: buyLive ? lp!.buy : sp?.buy ?? null,
      buyAge: buyLive ? ageOf(lp!.buyAt) : ageHFromIso(sp?.buyAt, now),
    };
  });
  const hasAny = liveData != null || item != null;

  return (
    <section aria-labelledby="h-prices" className="block">
      <div className="im-head">
        <h2 id="h-prices">Prix par lieu</h2>
        <button type="button" className="btn im-refresh" onClick={onRefresh} disabled={loading} aria-busy={loading}>
          {loading ? 'Actualisation…' : 'Actualiser les prix'}
        </button>
      </div>
      <p className="im-source muted" role="status">
        {live.state === 'ok'
          ? `Prix en direct de l’API Albion Online Data, interrogée à ${fmtClock(new Date(live.at))}.`
          : liveData
            ? 'Derniers prix en direct affichés.'
            : 'Prix de la dernière collecte du site. « Actualiser les prix » interroge l’API en direct.'}{' '}
        Un prix vieux reste affiché, grisé, avec son âge.
      </p>
      {live.state === 'error' && (
        <div className="im-error" role="alert">
          <p>{live.message}</p>
          <button type="button" className="btn" onClick={onRefresh}>
            Réessayer
          </button>
        </div>
      )}
      {hasAny ? (
        <div className={`table-scroll${loading ? ' is-refreshing' : ''}`}>
          <table className="plain">
            <thead>
              <tr>
                <th scope="col">Lieu</th>
                <th scope="col" className="num">Vente min.</th>
                <th scope="col" className="num secondary">Âge</th>
                <th scope="col" className="num">Achat max.</th>
                <th scope="col" className="num secondary">Âge</th>
                <th scope="col" className="num">Volume médian 7 j</th>
                <th scope="col" className="num secondary">Historique</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const hist = item?.historyDays[r.loc];
                return (
                  <tr key={r.loc}>
                    <th scope="row">
                      <LocChip loc={r.loc} /> <span className="loc-full">{r.loc}</span>
                    </th>
                    <td className={`num price-${ageClass(r.sellAge)}`}>{fmtSilver(r.sell)}</td>
                    <AgeCell ageH={r.sellAge} />
                    <td className={`num price-${ageClass(r.buyAge)}`}>{fmtSilver(r.buy)}</td>
                    <AgeCell ageH={r.buyAge} />
                    <td className="num">{fmtInt(item?.volume7d[r.loc])}</td>
                    <td className="num secondary">{hist == null ? '—' : `${hist}/7 j`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p>Aucun prix collecté pour cet objet.</p>
      )}
      <p className="im-age-legend muted">
        Âge : <span className="age age-fresh">moins d’1 h</span> · <span className="age age-ok">moins de 6 h</span> ·{' '}
        <span className="age age-old">plus de 6 h</span> · <span className="age age-stale">plus de 24 h (périmé)</span>
      </p>
    </section>
  );
}
