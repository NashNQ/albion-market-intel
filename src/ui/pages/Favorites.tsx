import { useMemo } from 'react';
import { LOCATIONS, PRODUCTION_LOCATIONS, type Location, type MarketItem, type RouteResult, type Settings } from '../../types';
import { buyQuote, sellQuote } from '../../engine/cost';
import { STALE_MAX_AGE_H } from '../../engine/route';
import { isSuspect, isSuspectLow } from '../../engine/filters';
import { useAppData } from '../context';
import { useFavorites } from '../data/favorites';
import { fmtSilver, itemHref, plural } from '../format';
import { ItemIcon } from '../components/ItemIcon';
import { AgeBadge, LocChip } from '../components/Route';
import '../favorites.css';

export interface FavQuote {
  loc: Location;
  price: number;
  ageH: number;
}

/**
 * Meilleur prix actuel d'un objet. Vente : prix le plus haut obtenu (mode réglé ; Black Market = vente instantanée).
 * Achat : prix le plus bas payé (hors Black Market). Les prix plus jeunes que l'âge maximal priment ;
 * à défaut, le meilleur prix de moins de 7 jours est retourné (affiché « périmé »).
 */
export function bestQuote(item: MarketItem | undefined, side: 'sell' | 'buy', s: Settings, now: Date): FavQuote | null {
  if (!item) return null;
  let fresh: FavQuote | null = null;
  let old: FavQuote | null = null;
  const locs: readonly Location[] = side === 'sell' ? LOCATIONS : PRODUCTION_LOCATIONS;
  for (const loc of locs) {
    const p = item.prices?.[loc];
    const q = side === 'sell' ? sellQuote(p, s.mode, now, STALE_MAX_AGE_H, loc === 'Black Market') : buyQuote(p, s.mode, now, STALE_MAX_AGE_H);
    if (!q) continue;
    // Ordre piège (> 3 × ou < 1/3 de la moyenne 7 j) : jamais présenté comme « meilleur prix ».
    if (side === 'sell' ? isSuspect(q.price, item, loc) : isSuspectLow(q.price, item, loc)) continue;
    const cand = { loc, price: q.price, ageH: q.ageH };
    const better = (cur: FavQuote | null) => !cur || (side === 'sell' ? cand.price > cur.price : cand.price < cur.price);
    if (q.ageH < s.maxPriceAgeH) {
      if (better(fresh)) fresh = cand;
    } else if (better(old)) old = cand;
  }
  return fresh ?? old;
}

function QuoteCell({ q, maxH }: { q: FavQuote | null; maxH: number }) {
  if (!q) return <span className="muted">Aucun prix</span>;
  return (
    <span className="fav-quote">
      <strong>{fmtSilver(q.price)}</strong>
      <LocChip loc={q.loc} />
      <AgeBadge h={q.ageH} maxH={maxH} />
    </span>
  );
}

export function FavoritesPage() {
  const { metaById, itemById, rankings, settings, now } = useAppData();
  const { ids, remove } = useFavorites();

  const bestRouteById = useMemo(() => {
    const m = new Map<string, RouteResult>();
    // Les classements sont triés par score décroissant : la première route rencontrée est la meilleure.
    for (const r of [...(rankings?.refining ?? []), ...(rankings?.crafting ?? [])]) {
      const cur = m.get(r.recipe.outputId);
      if (!cur || (r.score ?? 0) > (cur.score ?? 0)) m.set(r.recipe.outputId, r);
    }
    return m;
  }, [rankings]);

  return (
    <section className="page fav-page" aria-labelledby="page-title">
      <header className="page-head">
        <h1 id="page-title">Favoris</h1>
        <p className="page-intro">
          Les objets que vous suivez, avec leurs meilleurs prix du moment et, s’ils sont classés, leur meilleure route de
          production. Les favoris sont enregistrés dans ce navigateur.
        </p>
      </header>
      {ids.length === 0 ? (
        <div className="fav-empty">
          <p>
            <strong>Aucun favori pour l’instant.</strong> Touchez l’étoile à côté d’un objet dans les classements ou sur sa
            fiche pour le suivre ici : vous retrouverez ses prix et sa rentabilité d’un coup d’œil.
          </p>
          <p className="fav-empty-links">
            <a className="btn" href="#/raffinage">
              Voir le top raffinage
            </a>
            <a className="btn" href="#/craft">
              Voir le top craft
            </a>
          </p>
        </div>
      ) : (
        <>
          <p className="row-count" aria-live="polite">
            {plural(ids.length, 'objet suivi')}
          </p>
          <ul className="fav-list">
            {ids.map((id) => {
              const meta = metaById.get(id);
              const name = meta?.nameFr ?? id;
              const item = itemById.get(id);
              const sell = bestQuote(item, 'sell', settings, now);
              const buy = bestQuote(item, 'buy', settings, now);
              const route = bestRouteById.get(id);
              return (
                <li key={id} className="fav-card">
                  <div className="fav-head">
                    <a className="item-link" href={itemHref(id)}>
                      <ItemIcon id={id} name={name} size={40} />
                      <span className="item-name">{name}</span>
                    </a>
                    {meta && (
                      <span className={`tier tier-${meta.tier}`}>
                        {meta.tier}.{meta.enchant}
                      </span>
                    )}
                    <button type="button" className="btn-ghost fav-remove" aria-label={`Retirer ${name} des favoris`} onClick={() => remove(id)}>
                      Retirer
                    </button>
                  </div>
                  <dl className="fav-facts">
                    <div>
                      <dt>Meilleure vente</dt>
                      <dd>
                        <QuoteCell q={sell} maxH={settings.maxPriceAgeH} />
                      </dd>
                    </div>
                    <div>
                      <dt>Meilleur achat</dt>
                      <dd>
                        <QuoteCell q={buy} maxH={settings.maxPriceAgeH} />
                      </dd>
                    </div>
                    <div>
                      <dt>Meilleure production</dt>
                      <dd>
                        {route ? (
                          <span className="fav-route">
                            <span className="profit">{fmtSilver(route.unitProfit)}/unité</span>
                            {route.q != null && <span>≈ {fmtSilver(route.unitProfit * route.q)}/jour</span>}
                            <span className="muted">
                              {route.craftAt} › {route.sellAt}
                            </span>
                          </span>
                        ) : (
                          <span className="muted">Pas de route rentable avec vos réglages</span>
                        )}
                      </dd>
                    </div>
                  </dl>
                  <a className="fav-more" href={itemHref(id)} aria-label={`Voir la fiche : ${name}`}>
                    Voir la fiche
                  </a>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
