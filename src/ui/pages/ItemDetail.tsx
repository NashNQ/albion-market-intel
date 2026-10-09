import { useMemo } from 'react';
import type { Location, RouteResult } from '../../types';
import { bestRoute, bestCraftLocation, buildPriceIndex, saleDeduction, stationFee, type RouteFailure } from '../../engine';
import { useAppData } from '../context';
import { categoryLabel, fmt2, fmtAgeH, fmtInt, fmtPct, fmtSilver, itemHref, subcatLabel } from '../format';
import { ItemIcon } from '../components/ItemIcon';
import { ConfidenceBar, Flags, LocChip } from '../components/Route';
import { ItemMarket } from '../components/ItemMarket';
import { FavoriteButton } from '../components/FavoriteButton';
import '../item-detail.css';

const FAILURE_FR: Record<RouteFailure, string> = {
  missing: 'il manque des prix pour un ingrédient ou pour l’objet',
  stale: 'les prix disponibles sont plus vieux que l’âge maximal réglé',
  suspect: 'le prix de vente semble anormal par rapport à la moyenne sur 7 jours',
  lowVolume: 'le volume de ventes est inférieur au minimum réglé',
  unprofitable: 'la fabrication coûte plus cher que ce qu’elle rapporte',
};

export function ItemDetail({ id }: { id: string }) {
  const { snapshot, recipes, rankings, metaById, itemById, recipeByOutput, recipesByOutput, settings, now } = useAppData();
  const meta = metaById.get(id);
  const item = itemById.get(id);
  const recipe = recipeByOutput.get(id);
  const alternatives = (recipesByOutput?.get(id) ?? []).filter((r) => r.variant);
  const name = meta?.nameFr ?? id;

  const index = useMemo(
    () => (snapshot && recipe ? buildPriceIndex(snapshot, settings, now) : null),
    [snapshot, recipe, settings, now],
  );

  const best = useMemo((): { route: RouteResult | null; failure: RouteFailure | null } => {
    if (!recipe) return { route: null, failure: null };
    const pool = recipe.kind === 'refining' ? rankings?.refining : rankings?.crafting;
    const found = pool?.find((r) => r.recipe.outputId === id);
    if (found) return { route: found, failure: null };
    if (!index || !recipes) return { route: null, failure: null };
    const craft = bestCraftLocation(recipe, recipes.bonuses, settings);
    const out = bestRoute(recipe, index, recipes.bonuses, settings, { craft });
    return out.ok ? { route: out.result, failure: null } : { route: null, failure: out.reason };
  }, [recipe, rankings, index, recipes, settings, id]);

  if (!meta && !item && !recipe) {
    return (
      <section className="page" aria-labelledby="page-title">
        <h1 id="page-title">Objet introuvable</h1>
        <p>
          Aucun objet ne correspond à l’identifiant <code>{id}</code>. <a href="#/raffinage">Revenir au classement</a>.
        </p>
      </section>
    );
  }

  return (
    <article className="page item-page" aria-labelledby="page-title">
      <p className="crumb">
        <a href={recipe?.kind === 'crafting' ? '#/craft' : '#/raffinage'}>
          ‹ {recipe?.kind === 'crafting' ? 'Top craft' : 'Top raffinage'}
        </a>
      </p>
      <header className="item-head">
        <ItemIcon id={id} name={name} size={64} />
        <div>
          <h1 id="page-title">{name}</h1>
          <p className="item-sub">
            {meta && (
              <span className={`tier tier-${meta.tier}`}>
                T{meta.tier}.{meta.enchant}
              </span>
            )}
            {meta && meta.category && <span>{categoryLabel(meta.category)}</span>}
            {meta && meta.subcategory && <span>{subcatLabel(meta.subcategory)}</span>}
            <code className="item-id">{id}</code>
          </p>
        </div>
        <div className="item-head-actions" data-slot="item-actions">
          <FavoriteButton id={id} name={name} size="md" />
        </div>
      </header>

      <ItemMarket key={id} id={id} item={item} />

      {recipe && (
        <section aria-labelledby="h-recipe" className="block">
          <h2 id="h-recipe">Recette</h2>
          <p className="muted">
            Produit {recipe.outputQty > 1 ? `${recipe.outputQty} unités` : '1 unité'} · valeur d’objet{' '}
            {fmtInt(recipe.itemValue)}
          </p>
          <ul className="ingredients">
            {recipe.inputs.map((inp) => {
              const m = metaById.get(inp.id);
              const bb = index?.get(inp.id)?.bestBuy ?? null;
              const nm = m?.nameFr ?? inp.id;
              return (
                <li key={inp.id}>
                  <span className="qty">{inp.qty} ×</span>
                  <a className="item-link" href={itemHref(inp.id)}>
                    <ItemIcon id={inp.id} name={nm} size={28} />
                    <span>{nm}</span>
                  </a>
                  {!inp.returnable && <span className="tag" title="Cet ingrédient n’est jamais rendu par le retour de ressources">non retourné</span>}
                  <span className="ing-buy">
                    {bb ? (
                      <>
                        {fmtSilver(bb.price)} à <LocChip loc={bb.loc} />
                        {bb.estimated && <EstimatedBadge />}
                      </>
                    ) : (
                      'pas de prix récent'
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          {alternatives.length > 0 && (
            <>
              <h3 className="alt-title">Recettes alternatives</h3>
              <ul className="ingredients alt-recipes">
                {alternatives.map((alt) => (
                  <li key={alt.variant}>
                    <span className="qty">×{alt.outputQty}</span>
                    <span>
                      {alt.inputs.map((i) => `${i.qty} ${metaById.get(i.id)?.nameFr ?? i.id}`).join(' + ')}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {recipe && (
        <section aria-labelledby="h-calc" className="block">
          <h2 id="h-calc">Meilleure route, pas à pas</h2>
          {best.route ? (
            <Breakdown r={best.route} />
          ) : (
            <p className="muted">
              Aucune route retenue
              {best.failure ? ` : ${FAILURE_FR[best.failure]}.` : ', les données sont insuffisantes.'}
            </p>
          )}
        </section>
      )}
    </article>
  );
}

/** Badge « Estimé » : prix tiré de la moyenne 7 jours faute de prix récent. */
export function EstimatedBadge() {
  return (
    <span className="flag flag-estimated" title="Prix estimé : moyenne sur 7 jours du même lieu, faute de prix récent.">
      Estimé
    </span>
  );
}

function Breakdown({ r }: { r: RouteResult }) {
  const { metaById, settings } = useAppData();
  const fee = stationFee(r.recipe.itemValue, settings.stationFee);
  const outQty = r.recipe.outputQty > 0 ? r.recipe.outputQty : 1;
  const forceInstant = r.sellAt === 'Black Market';
  const ded = saleDeduction(settings, forceInstant);
  const grossSell = r.unitRevenue / (1 - ded);
  const ingCost = r.unitCost * outQty - fee;
  const buyLocs = [...new Set(Object.values(r.buyFrom).filter(Boolean) as Location[])];

  return (
    <ol className="steps">
      {r.recipe.variant && (
        <li>
          <h3>Recette alternative</h3>
          <p>
            Cette route utilise la recette à partir de {metaById.get(r.recipe.variant)?.nameFr ?? r.recipe.variant}, qui
            produit {r.recipe.outputQty} unités par fabrication.
          </p>
        </li>
      )}
      <li>
        <h3>Achat des ingrédients</h3>
        <p>
          Chez {buyLocs.map((l, i) => (
            <span key={l}>
              {i > 0 && ', '}
              <LocChip loc={l} />
            </span>
          ))}
          {' '}pour {r.recipe.inputs.map((i) => `${i.qty} ${metaById.get(i.id)?.nameFr ?? i.id}`).join(', ')}.
        </p>
      </li>
      <li>
        <h3>Retour de ressources à <LocChip loc={r.craftAt} /></h3>
        <p>
          Taux de retour (RRR) <strong>{fmtPct(r.rrr)}</strong> : une partie des ingrédients retournables vous est
          rendue. Coût net des ingrédients après retour : <strong>{fmtSilver(ingCost)}</strong>.
        </p>
      </li>
      <li>
        <h3>Frais de station</h3>
        <p>
          Valeur d’objet {fmtInt(r.recipe.itemValue)} × 0,1125 × tarif {fmtInt(settings.stationFee)} / 100 ={' '}
          <strong>{fmtSilver(fee)}</strong> par fabrication.
        </p>
      </li>
      <li>
        <h3>Coût par unité</h3>
        <p>
          ({fmtSilver(ingCost)} + {fmtSilver(fee)}) / {outQty} = <strong>{fmtSilver(r.unitCost)}</strong>.
        </p>
      </li>
      <li>
        <h3>Revenu à <LocChip loc={r.sellAt} /></h3>
        <p>
          Prix de vente {fmtSilver(grossSell)} − taxes et frais {fmtPct(ded)} = <strong>{fmtSilver(r.unitRevenue)}</strong>{' '}
          par unité.
        </p>
      </li>
      <li>
        <h3>Profit par unité</h3>
        <p>
          {fmtSilver(r.unitRevenue)} − {fmtSilver(r.unitCost)} = <strong className="profit">{fmtSilver(r.unitProfit)}</strong>.
        </p>
      </li>
      {r.q != null && (
        <li>
          <h3>Quantité écoulable (Q)</h3>
          <p>
            min(volume {fmtInt(r.volume)}/j × part {fmtPct(settings.marketShare, 0)}, plafond {fmtInt(settings.dailyCap)}) ={' '}
            <strong>{fmt2(r.q)}</strong> unités par jour.
          </p>
        </li>
      )}
      <li>
        <h3>Confiance (C)</h3>
        <p>
          Prix récent le plus vieux : {fmtAgeH(r.oldestPriceAgeH)}. Confiance <ConfidenceBar c={r.confidence} />
          {r.flags.includes('estimated') && ' (plafonnée à 0,60 : prix estimé utilisé)'}
        </p>
        <Flags flags={r.flags} />
      </li>
      {r.score != null && (
        <li>
          <h3>Score</h3>
          <p>
            {fmtSilver(r.unitProfit)} × {fmt2(r.q)} × {fmt2(r.confidence)} = <strong className="score">{fmtInt(r.score)}</strong>{' '}
            d’argent espéré par jour.
          </p>
        </li>
      )}
    </ol>
  );
}
