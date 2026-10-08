// Routes personnalisées en chaîne (achat → raffinage → raffinage … → vente) — fonctions pures.
//
// Toutes les quantités sont des quantités ESPÉRÉES CONTINUES (le RRR est appliqué en moyenne) ;
// les arrondis ne servent qu'à l'affichage.
import {
  LOCATIONS,
  PRODUCTION_LOCATIONS,
  type ItemMeta,
  type Location,
  type Recipe,
  type RecipesFile,
  type Settings,
} from '../types';
import { recipeRrr } from './rrr';
import { buyQuote, sellQuote, stationFee, unitRevenue } from './cost';
import { isSuspect } from './filters';
import { bestCraftLocation, type PriceIndex, type SellCandidate } from './route';

// ---------------------------------------------------------------------------
// Modèle sérialisable (versionné)
// ---------------------------------------------------------------------------

export type BuySource = { type: 'buy'; at: Location | 'auto'; manualPrice?: number };
export type StepSource = { type: 'step'; index: number };
export type InputSource = BuySource | StepSource;

export interface StepInput {
  id: string;
  source: InputSource;
}

export interface Step {
  outputId: string;
  recipeVariant?: string;
  craftAt: Location | 'auto';
  inputs: StepInput[];
}

export interface FinalSpec {
  sellAt: Location | 'auto';
  qty: number;
  qtyMode: 'final' | 'start';
  /** Prix de vente brut saisi à la main (utilisé quand le prix de marché manque ou pour forcer un prix). */
  manualSellPrice?: number;
}

export interface SavedRoute {
  v: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  steps: Step[];
  final: FinalSpec;
}

export type ChainRoute = Pick<SavedRoute, 'steps' | 'final'>;

// ---------------------------------------------------------------------------
// Index des recettes (mis en cache par fichier)
// ---------------------------------------------------------------------------

export interface RecipeLookup {
  byOutput: Map<string, Recipe[]>;
  meta: Map<string, ItemMeta>;
}

const lookupCache = new WeakMap<RecipesFile, RecipeLookup>();

export function recipeLookup(recipes: RecipesFile): RecipeLookup {
  let l = lookupCache.get(recipes);
  if (!l) {
    const byOutput = new Map<string, Recipe[]>();
    for (const r of recipes.recipes) {
      const arr = byOutput.get(r.outputId);
      if (arr) arr.push(r);
      else byOutput.set(r.outputId, [r]);
    }
    const meta = new Map<string, ItemMeta>();
    for (const m of recipes.meta ?? []) meta.set(m.id, m);
    l = { byOutput, meta };
    lookupCache.set(recipes, l);
  }
  return l;
}

/** Variante éventuelle d'une recette (champ optionnel ajouté au type Recipe). */
export const recipeVariantOf = (r: Recipe): string | undefined => (r as Recipe & { variant?: string }).variant;

/** Recette d'une étape : variante demandée si elle existe, sinon la première (raffinage en priorité). */
export function findRecipe(lookup: RecipeLookup, outputId: string, variant?: string): Recipe | null {
  const list = lookup.byOutput.get(outputId);
  if (!list || list.length === 0) return null;
  if (variant !== undefined) {
    const v = list.find((r) => recipeVariantOf(r) === variant);
    if (v) return v;
  }
  // Recette principale (sans variante) en priorité, raffinage d'abord.
  const main = list.filter((r) => recipeVariantOf(r) === undefined);
  const pool = main.length ? main : list;
  return pool.find((r) => r.kind === 'refining') ?? pool[0];
}

export const itemName = (lookup: RecipeLookup, id: string): string => lookup.meta.get(id)?.nameFr ?? id;

// ---------------------------------------------------------------------------
// Résultats
// ---------------------------------------------------------------------------

export type ChainWarningKind =
  | 'empty'
  | 'unknown-recipe'
  | 'invalid-link'
  | 'unused-step'
  | 'missing-price'
  | 'stale-price'
  | 'manual-price'
  | 'estimated-price'
  | 'missing-sell'
  | 'stale-sell'
  | 'sell-volume'
  | 'sell-volume-unknown'
  | 'buy-volume'
  | 'red-zone'
  | 'mists'
  | 'not-valued';

export interface ChainWarning {
  kind: ChainWarningKind;
  step?: number;
  itemId?: string;
  message: string;
}

export interface BuyComparison {
  /** Coût réel (achats + frais, en cascade) de la quantité consommée, produite par l'étape amont. */
  produceCost: number;
  /** Coût d'achat au marché de la même quantité. */
  buyCost: number;
  /** Δ = produceCost − buyCost (> 0 : acheter est moins cher). */
  delta: number;
  buyAt: Location;
  buyUnitPrice: number;
  ageH: number;
}

export interface ChainInputResult {
  id: string;
  qty: number; // quantité par craft (recette)
  returnable: boolean;
  /** Quantité brute = qty × crafts (avant retour). */
  gross: number;
  /** Besoin net espéré = gross × (1 − RRR) si returnable. */
  need: number;
  sourceType: 'buy' | 'step';
  fromStep: number | null;
  buyAt: Location | null;
  unitPrice: number | null;
  ageH: number | null;
  manual: boolean;
  /** Prix estimé (moyenne 7 jours, repli historyFallback). */
  estimated: boolean;
  missing: boolean;
  stale: boolean;
  /** Achat : coût en argent. Étape : valeur des intermédiaires consommés (au marché ou au coût). */
  cost: number;
  /** Étape : valeur unitaire retenue pour l'intermédiaire. */
  unitValue: number | null;
  comparison: BuyComparison | null;
}

export interface ChainStepResult {
  index: number;
  outputId: string;
  name: string;
  recipe: Recipe | null;
  craftAt: Location | null;
  rrr: number;
  /** Fabrications espérées (continues). */
  crafts: number;
  /** Unités produites (= crafts × outputQty). */
  produced: number;
  fee: number;
  buyCost: number;
  intermediateCost: number;
  /** achats + intermédiaires consommés + frais. */
  totalCost: number;
  /** Coût réel en argent (achats + frais en cascade) de la production de cette étape. */
  cashCost: number;
  /** Valeur unitaire de la sortie au marché (null si non valorisable). */
  marketUnit: number | null;
  valueAt: Location | null;
  valueAgeH: number | null;
  /** Valeur totale de la sortie (au marché, ou au coût si non valorisable). */
  marketValue: number;
  valuedAtCost: boolean;
  profit: number;
  consumers: number[];
  unused: boolean;
  isFinal: boolean;
  inputs: ChainInputResult[];
}

export interface ChainResult {
  steps: ChainStepResult[];
  finalId: string | null;
  finalQty: number;
  startCrafts: number;
  sellAt: Location | null;
  sellPrice: number | null;
  sellNet: number | null;
  sellAgeH: number | null;
  revenue: number;
  buyTotal: number;
  feeTotal: number;
  profit: number;
  profitPerUnit: number;
  /** Profit / revenu (null si revenu nul). */
  margin: number | null;
  maxPriceAgeH: number;
  complete: boolean;
  warnings: ChainWarning[];
}

export interface ChainContext {
  recipes: RecipesFile;
  index: PriceIndex;
  settings: Settings;
  now: Date;
}

// ---------------------------------------------------------------------------
// Prix
// ---------------------------------------------------------------------------

interface BuyResolution {
  loc: Location | null;
  price: number | null;
  ageH: number | null;
  manual: boolean;
  estimated: boolean;
  stale: boolean;
}

const isEstimated = (q: unknown): boolean => !!(q as { estimated?: boolean } | null)?.estimated;

function hasRawPrice(p: { sell: number | null; buy: number | null } | undefined): boolean {
  return !!p && ((p.sell ?? 0) > 0 || (p.buy ?? 0) > 0);
}

/** Prix d'achat d'un ingrédient selon sa source (manuel > lieu choisi > lieu de production le moins cher). */
export function resolveBuy(id: string, src: BuySource, ctx: ChainContext): BuyResolution {
  const fixedLoc = src.at === 'auto' ? null : src.at;
  if (src.manualPrice != null && Number.isFinite(src.manualPrice) && src.manualPrice > 0) {
    return { loc: fixedLoc, price: src.manualPrice, ageH: null, manual: true, estimated: false, stale: false };
  }
  const ip = ctx.index.get(id);
  if (src.at === 'auto') {
    if (ip?.bestBuy) {
      const est = isEstimated(ip.bestBuy);
      return { loc: ip.bestBuy.loc, price: ip.bestBuy.price, ageH: est ? null : ip.bestBuy.ageH, manual: false, estimated: est, stale: false };
    }
    return { loc: null, price: null, ageH: null, manual: false, estimated: false, stale: !!ip?.hasAnyPrice };
  }
  const p = ip?.item.prices?.[src.at];
  const q = buyQuote(p, ctx.settings.mode, ctx.now, ctx.settings.maxPriceAgeH);
  if (q) return { loc: src.at, price: q.price, ageH: q.ageH, manual: false, estimated: false, stale: false };
  return { loc: src.at, price: null, ageH: null, manual: false, estimated: false, stale: hasRawPrice(p) };
}

/** Meilleure vente nette hors Black Market (prix non suspect en priorité). */
export function bestSell(id: string, ctx: ChainContext): SellCandidate | null {
  const ip = ctx.index.get(id);
  if (!ip || ip.sells.length === 0) return null;
  return ip.sells.find((c) => !isSuspect(c.price, ip.item, c.loc)) ?? ip.sells[0];
}

interface SellResolution {
  loc: Location | null;
  price: number | null;
  net: number | null;
  ageH: number | null;
  estimated: boolean;
  stale: boolean;
  manual?: boolean;
}

/** Vente finale : 'auto' = meilleur revenu net hors Black Market ; Black Market seulement si choisi.
 *  Un prix manuel (> 0) remplace le prix de marché ; taxes et frais d'ordre restent appliqués. */
export function resolveSell(id: string, at: Location | 'auto', ctx: ChainContext, manualPrice?: number): SellResolution {
  const ip = ctx.index.get(id);
  if (manualPrice != null && Number.isFinite(manualPrice) && manualPrice > 0) {
    const loc = at === 'auto' ? (bestSell(id, ctx)?.loc ?? null) : at;
    const bm = loc === 'Black Market';
    return { loc, price: manualPrice, net: unitRevenue(manualPrice, ctx.settings, bm), ageH: null, estimated: false, stale: false, manual: true };
  }
  if (at === 'auto') {
    const c = bestSell(id, ctx);
    if (c) {
      const est = isEstimated(c);
      return { loc: c.loc, price: c.price, net: c.net, ageH: est ? null : c.ageH, estimated: est, stale: false };
    }
    return { loc: null, price: null, net: null, ageH: null, estimated: false, stale: !!ip?.hasAnyPrice };
  }
  const p = ip?.item.prices?.[at];
  const bm = at === 'Black Market';
  const q = sellQuote(p, ctx.settings.mode, ctx.now, ctx.settings.maxPriceAgeH, bm);
  if (q) return { loc: at, price: q.price, net: unitRevenue(q.price, ctx.settings, bm), ageH: q.ageH, estimated: false, stale: false };
  return { loc: at, price: null, net: null, ageH: null, estimated: false, stale: hasRawPrice(p) };
}

// ---------------------------------------------------------------------------
// Calcul
// ---------------------------------------------------------------------------

/** Source effective d'un ingrédient : un lien vers une étape n'est valide que s'il pointe vers une étape
 *  PRÉCÉDENTE qui produit exactement cet id. */
export function isValidLink(steps: Step[], stepIndex: number, inputId: string, src: InputSource): boolean {
  return (
    src.type === 'step' &&
    Number.isInteger(src.index) &&
    src.index >= 0 &&
    src.index < stepIndex &&
    steps[src.index]?.outputId === inputId
  );
}

const AUTO_BUY: BuySource = { type: 'buy', at: 'auto' };

function sourceFor(step: Step, inputId: string): InputSource {
  return step.inputs.find((i) => i.id === inputId)?.source ?? AUTO_BUY;
}

interface Plan {
  recipes: (Recipe | null)[];
  craftAt: (Location | null)[];
  rrrs: number[];
  crafts: number[];
}

/** Passe à rebours : fabrications nécessaires de chaque étape pour `finalQty` unités finales. */
function plan(route: ChainRoute, ctx: ChainContext, lookup: RecipeLookup, finalQty: number): Plan {
  const n = route.steps.length;
  const recipes = route.steps.map((s) => findRecipe(lookup, s.outputId, s.recipeVariant));
  const craftAt: (Location | null)[] = new Array(n).fill(null);
  const rrrs: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const r = recipes[i];
    if (!r) continue;
    const at = route.steps[i].craftAt;
    if (at === 'auto' || at === 'Black Market') {
      const best = bestCraftLocation(r, ctx.recipes.bonuses, ctx.settings);
      craftAt[i] = best.loc;
      rrrs[i] = best.rrr;
    } else {
      craftAt[i] = at;
      rrrs[i] = recipeRrr(r, at, ctx.recipes.bonuses, ctx.settings);
    }
  }
  const demand: number[] = new Array(n).fill(0);
  const crafts: number[] = new Array(n).fill(0);
  if (n > 0) demand[n - 1] = finalQty;
  for (let i = n - 1; i >= 0; i--) {
    const r = recipes[i];
    if (!r) continue;
    const out = r.outputQty > 0 ? r.outputQty : 1;
    crafts[i] = demand[i] / out;
    for (const inp of r.inputs) {
      const src = sourceFor(route.steps[i], inp.id);
      if (src.type !== 'step' || !isValidLink(route.steps, i, inp.id, src)) continue;
      demand[src.index] += inp.qty * crafts[i] * (inp.returnable ? 1 - rrrs[i] : 1);
    }
  }
  return { recipes, craftAt, rrrs, crafts };
}

function liquidityCap(volume: number, settings: Settings): number {
  return Math.min(volume * settings.marketShare, settings.dailyCap);
}

const fmtN = (n: number) => (Math.round(n * 10) / 10).toLocaleString('fr-FR');

/** Calcule une route en chaîne. */
export function computeChain(route: ChainRoute, ctx: ChainContext): ChainResult {
  const lookup = recipeLookup(ctx.recipes);
  const steps = route.steps;
  const n = steps.length;
  const warnings: ChainWarning[] = [];
  const qty = Number.isFinite(route.final.qty) && route.final.qty > 0 ? route.final.qty : 0;

  // Quantité finale (qtyMode 'start' : qty = crafts de la 1re étape ; tout est linéaire).
  let finalQty = qty;
  if (route.final.qtyMode === 'start' && n > 0) {
    const unit = plan(route, ctx, lookup, 1);
    const c0 = unit.crafts[0];
    finalQty = c0 > 0 ? qty / c0 : 0;
  }
  const p = plan(route, ctx, lookup, finalQty);

  if (n === 0) warnings.push({ kind: 'empty', message: 'La route ne contient aucune étape.' });

  // Consommateurs de chaque étape.
  const consumers: number[][] = steps.map(() => []);
  steps.forEach((s, i) => {
    const r = p.recipes[i];
    if (!r) return;
    for (const inp of r.inputs) {
      const src = sourceFor(s, inp.id);
      if (src.type === 'step') {
        if (isValidLink(steps, i, inp.id, src)) {
          if (!consumers[src.index].includes(i)) consumers[src.index].push(i);
        } else {
          warnings.push({
            kind: 'invalid-link',
            step: i,
            itemId: inp.id,
            message: `Étape ${i + 1} : le lien vers l’étape ${src.index + 1} est invalide pour ${itemName(lookup, inp.id)} ; l’ingrédient est acheté au meilleur prix.`,
          });
        }
      }
    }
  });

  const results: ChainStepResult[] = [];
  let buyTotal = 0;
  let feeTotal = 0;
  let maxAge = 0;
  let complete = n > 0;
  const zoneLocs = new Set<Location>();

  // Valeurs unitaires des sorties (au marché ou au coût) et coût réel unitaire, par étape.
  const unitValue: number[] = new Array(n).fill(0);
  const unitCash: number[] = new Array(n).fill(0);

  // Vente finale (nécessaire pour valoriser la dernière étape).
  const finalId = n > 0 ? steps[n - 1].outputId : null;
  const sell = finalId ? resolveSell(finalId, route.final.sellAt, ctx, route.final.manualSellPrice) : null;

  for (let i = 0; i < n; i++) {
    const step = steps[i];
    const r = p.recipes[i];
    const isFinal = i === n - 1;
    const name = itemName(lookup, step.outputId);
    if (!r) {
      complete = false;
      warnings.push({ kind: 'unknown-recipe', step: i, itemId: step.outputId, message: `Étape ${i + 1} : aucune recette connue pour ${name}.` });
      results.push(emptyStep(i, step.outputId, name, consumers[i], isFinal));
      continue;
    }
    const crafts = p.crafts[i];
    const produced = crafts * (r.outputQty > 0 ? r.outputQty : 1);
    const unused = !isFinal && consumers[i].length === 0;
    if (unused) {
      warnings.push({ kind: 'unused-step', step: i, itemId: step.outputId, message: `Étape ${i + 1} (${name}) n’alimente aucune étape suivante.` });
    }
    const craftAt = p.craftAt[i];
    if (craftAt && produced > 0) zoneLocs.add(craftAt);
    const rrrV = p.rrrs[i];

    const inputs: ChainInputResult[] = [];
    let buyCost = 0;
    let interCost = 0;
    let interCash = 0;
    for (const inp of r.inputs) {
      const gross = inp.qty * crafts;
      const need = gross * (inp.returnable ? 1 - rrrV : 1);
      const src = sourceFor(step, inp.id);
      const base = { id: inp.id, qty: inp.qty, returnable: inp.returnable, gross, need };
      if (src.type === 'step' && isValidLink(steps, i, inp.id, src)) {
        const j = src.index;
        const cost = need * unitValue[j];
        interCost += cost;
        interCash += need * unitCash[j];
        // Comparateur : acheter l'intermédiaire au lieu de le produire.
        let comparison: BuyComparison | null = null;
        const bb = ctx.index.get(inp.id)?.bestBuy;
        if (bb) {
          const produceCost = need * unitCash[j];
          const buyC = need * bb.price;
          comparison = { produceCost, buyCost: buyC, delta: produceCost - buyC, buyAt: bb.loc, buyUnitPrice: bb.price, ageH: bb.ageH };
        }
        inputs.push({
          ...base,
          sourceType: 'step',
          fromStep: j,
          buyAt: null,
          unitPrice: null,
          ageH: null,
          manual: false,
          estimated: false,
          missing: false,
          stale: false,
          cost,
          unitValue: unitValue[j],
          comparison,
        });
        continue;
      }
      const bsrc: BuySource = src.type === 'buy' ? src : AUTO_BUY;
      const b = resolveBuy(inp.id, bsrc, ctx);
      const missing = b.price == null;
      const cost = missing ? 0 : need * (b.price as number);
      buyCost += cost;
      if (need > 0) {
        if (b.loc) zoneLocs.add(b.loc);
        if (missing) {
          complete = false;
          warnings.push(
            b.stale
              ? { kind: 'stale-price', step: i, itemId: inp.id, message: `Étape ${i + 1} : le prix de ${itemName(lookup, inp.id)} est périmé (plus de ${ctx.settings.maxPriceAgeH} h) ; saisissez un prix manuel.` }
              : { kind: 'missing-price', step: i, itemId: inp.id, message: `Étape ${i + 1} : aucun prix d’achat pour ${itemName(lookup, inp.id)} ; saisissez un prix manuel.` },
          );
        } else if (b.manual) {
          warnings.push({ kind: 'manual-price', step: i, itemId: inp.id, message: `Étape ${i + 1} : prix manuel utilisé pour ${itemName(lookup, inp.id)}.` });
        } else if (b.estimated) {
          warnings.push({ kind: 'estimated-price', step: i, itemId: inp.id, message: `Étape ${i + 1} : prix estimé (moyenne 7 jours) pour ${itemName(lookup, inp.id)}.` });
        } else if (b.ageH != null && b.ageH > maxAge) {
          maxAge = b.ageH;
        }
        if (b.loc && !missing) {
          const vol = ctx.index.get(inp.id)?.item.volume7d?.[b.loc];
          if (vol != null && Number.isFinite(vol) && need > vol * ctx.settings.marketShare) {
            warnings.push({
              kind: 'buy-volume',
              step: i,
              itemId: inp.id,
              message: `Étape ${i + 1} : acheter ${fmtN(need)} ${itemName(lookup, inp.id)} à ${b.loc} dépasse ${Math.round(ctx.settings.marketShare * 100)} % du volume sur 7 jours (${fmtN(vol)}).`,
            });
          }
        }
      }
      inputs.push({
        ...base,
        sourceType: 'buy',
        fromStep: null,
        buyAt: b.loc,
        unitPrice: b.price,
        ageH: b.ageH,
        manual: b.manual,
        estimated: b.estimated,
        missing,
        stale: b.stale,
        cost,
        unitValue: null,
        comparison: null,
      });
    }

    const fee = stationFee(r.itemValue, ctx.settings.stationFee) * crafts;
    const totalCost = buyCost + interCost + fee;
    const cashCost = buyCost + interCash + fee;
    buyTotal += buyCost;
    feeTotal += fee;
    unitCash[i] = produced > 0 ? cashCost / produced : 0;

    // Valorisation de la sortie.
    let marketUnit: number | null = null;
    let valueAt: Location | null = null;
    let valueAgeH: number | null = null;
    if (isFinal) {
      if (sell && sell.net != null) {
        marketUnit = sell.net;
        valueAt = sell.loc;
        valueAgeH = sell.ageH;
      }
    } else {
      const c = bestSell(step.outputId, ctx);
      if (c) {
        marketUnit = c.net;
        valueAt = c.loc;
        valueAgeH = c.ageH;
      }
    }
    let valuedAtCost = false;
    let marketValue: number;
    if (marketUnit != null) {
      marketValue = produced * marketUnit;
      unitValue[i] = marketUnit;
    } else if (isFinal) {
      marketValue = 0; // invendable : revenu nul, route incomplète
      unitValue[i] = 0;
    } else {
      valuedAtCost = true;
      marketValue = totalCost;
      unitValue[i] = produced > 0 ? totalCost / produced : 0;
      if (!unused) {
        warnings.push({ kind: 'not-valued', step: i, itemId: step.outputId, message: `Étape ${i + 1} : ${name} n’a pas de prix de marché valide ; l’étape est comptée au coût.` });
      }
    }

    results.push({
      index: i,
      outputId: step.outputId,
      name,
      recipe: r,
      craftAt,
      rrr: rrrV,
      crafts,
      produced,
      fee,
      buyCost,
      intermediateCost: interCost,
      totalCost,
      cashCost,
      marketUnit,
      valueAt,
      valueAgeH,
      marketValue,
      valuedAtCost,
      profit: marketValue - totalCost,
      consumers: consumers[i],
      unused,
      isFinal,
      inputs,
    });
  }

  // Vente finale.
  let revenue = 0;
  if (finalId && sell) {
    if (sell.net == null) {
      complete = false;
      warnings.push(
        sell.stale
          ? { kind: 'stale-sell', itemId: finalId, message: `Le prix de vente de ${itemName(lookup, finalId)} est périmé${sell.loc ? ` à ${sell.loc}` : ''}.` }
          : { kind: 'missing-sell', itemId: finalId, message: `Aucun prix de vente pour ${itemName(lookup, finalId)}${sell.loc ? ` à ${sell.loc}` : ''} ; saisissez un prix de vente manuel.` },
      );
    } else {
      revenue = finalQty * sell.net;
      if (sell.manual)
        warnings.push({ kind: 'manual-price', itemId: finalId, message: `Prix de vente manuel utilisé pour ${itemName(lookup, finalId)}.` });
      if (sell.estimated)
        warnings.push({ kind: 'estimated-price', itemId: finalId, message: `Prix de vente estimé (moyenne 7 jours) pour ${itemName(lookup, finalId)}.` });
      if (sell.ageH != null && sell.ageH > maxAge) maxAge = sell.ageH;
    }
    if (sell.loc) {
      zoneLocs.add(sell.loc);
      const vol = ctx.index.get(finalId)?.item.volume7d?.[sell.loc];
      if (vol == null || !Number.isFinite(vol)) {
        warnings.push({ kind: 'sell-volume-unknown', itemId: finalId, message: `Volume de vente inconnu à ${sell.loc} : la quantité écoulable n’est pas vérifiable.` });
      } else {
        const cap = liquidityCap(vol, ctx.settings);
        if (finalQty > cap) {
          warnings.push({
            kind: 'sell-volume',
            itemId: finalId,
            message: `Vendre ${fmtN(finalQty)} unités à ${sell.loc} dépasse la quantité écoulable par jour (${fmtN(cap)}).`,
          });
        }
      }
    }
  }

  let red = false;
  let mists = false;
  for (const l of zoneLocs) {
    if (l === 'Caerleon' || l === 'Black Market') red = true;
    if (l === 'Brecilien') mists = true;
  }
  if (red) warnings.push({ kind: 'red-zone', message: 'La route passe par Caerleon ou le Black Market : trajet en zone rouge (risque de perte totale).' });
  if (mists) warnings.push({ kind: 'mists', message: 'La route passe par Brecilien, accessible uniquement par les Brumes.' });

  const profit = revenue - buyTotal - feeTotal;
  return {
    steps: results,
    finalId,
    finalQty,
    startCrafts: n > 0 ? p.crafts[0] : 0,
    sellAt: sell?.loc ?? null,
    sellPrice: sell?.price ?? null,
    sellNet: sell?.net ?? null,
    sellAgeH: sell?.ageH ?? null,
    revenue,
    buyTotal,
    feeTotal,
    profit,
    profitPerUnit: finalQty > 0 ? profit / finalQty : 0,
    margin: revenue > 0 ? profit / revenue : null,
    maxPriceAgeH: maxAge,
    complete,
    warnings,
  };
}

function emptyStep(index: number, outputId: string, name: string, cons: number[], isFinal: boolean): ChainStepResult {
  return {
    index,
    outputId,
    name,
    recipe: null,
    craftAt: null,
    rrr: 0,
    crafts: 0,
    produced: 0,
    fee: 0,
    buyCost: 0,
    intermediateCost: 0,
    totalCost: 0,
    cashCost: 0,
    marketUnit: null,
    valueAt: null,
    valueAgeH: null,
    marketValue: 0,
    valuedAtCost: false,
    profit: 0,
    consumers: cons,
    unused: false,
    isFinal,
    inputs: [],
  };
}

// ---------------------------------------------------------------------------
// Construction et édition des étapes
// ---------------------------------------------------------------------------

export type RefiningFamilyKey = 'wood' | 'ore' | 'hide' | 'fiber' | 'rock';

export const FAMILIES: Record<RefiningFamilyKey, { raw: string; refined: string; label: string; maxEnchant: number }> = {
  wood: { raw: 'WOOD', refined: 'PLANKS', label: 'Bois → Planches', maxEnchant: 4 },
  ore: { raw: 'ORE', refined: 'METALBAR', label: 'Minerai → Barres', maxEnchant: 4 },
  hide: { raw: 'HIDE', refined: 'LEATHER', label: 'Peau → Cuir', maxEnchant: 4 },
  fiber: { raw: 'FIBER', refined: 'CLOTH', label: 'Fibre → Tissu', maxEnchant: 4 },
  rock: { raw: 'ROCK', refined: 'STONEBLOCK', label: 'Pierre → Blocs', maxEnchant: 0 },
};

/** ID API d'une ressource : T4_PLANKS, T5_PLANKS_LEVEL2@2 (enchantement seulement à partir du T4). */
export function resourceId(tier: number, base: string, enchant: number): string {
  const e = tier >= 4 ? enchant : 0;
  return e > 0 ? `T${tier}_${base}_LEVEL${e}@${e}` : `T${tier}_${base}`;
}

/** Étape construite à partir d'une recette : chaque ingrédient produit par une étape existante
 *  (la plus récente) y est relié, les autres sont achetés au meilleur prix. */
export function stepFromRecipe(recipe: Recipe, existing: Step[]): Step {
  const step: Step = {
    outputId: recipe.outputId,
    craftAt: 'auto',
    inputs: recipe.inputs.map((inp) => {
      let idx = -1;
      for (let k = existing.length - 1; k >= 0; k--) {
        if (existing[k].outputId === inp.id) {
          idx = k;
          break;
        }
      }
      return { id: inp.id, source: idx >= 0 ? { type: 'step', index: idx } : { type: 'buy', at: 'auto' } };
    }),
  };
  const v = recipeVariantOf(recipe);
  if (v !== undefined) step.recipeVariant = v;
  return step;
}

export type PresetResult = { ok: true; steps: Step[] } | { ok: false; error: string };

/** Préréglage : chaîne de raffinage d'une famille, du tier `from` au tier `to`. */
export function buildPreset(
  recipes: RecipesFile,
  family: RefiningFamilyKey,
  from: number,
  to: number,
  enchant: number,
): PresetResult {
  const fam = FAMILIES[family];
  if (!fam) return { ok: false, error: 'Famille de ressource inconnue.' };
  if (!(from >= 2 && from <= 7 && to >= 3 && to <= 8 && Number.isInteger(from) && Number.isInteger(to)))
    return { ok: false, error: 'Tiers hors limites (départ 2 à 7, arrivée 3 à 8).' };
  if (to < from) return { ok: false, error: 'Le tier d’arrivée doit être supérieur ou égal au tier de départ.' };
  if (!(Number.isInteger(enchant) && enchant >= 0 && enchant <= fam.maxEnchant))
    return { ok: false, error: fam.maxEnchant === 0 ? 'Les blocs de pierre ne sont pas enchantables.' : `Enchantement possible de 0 à ${fam.maxEnchant}.` };
  const lookup = recipeLookup(recipes);
  const steps: Step[] = [];
  for (let t = from; t <= to; t++) {
    const id = resourceId(t, fam.refined, enchant);
    const r = findRecipe(lookup, id);
    if (!r || r.kind !== 'refining') return { ok: false, error: `Recette de raffinage introuvable pour ${id}.` };
    steps.push(stepFromRecipe(r, steps));
  }
  return { ok: true, steps };
}

/** Étapes (hors dernière) dont la production n'alimente plus, même indirectement, l'étape finale. */
export function unreachableSteps(steps: Step[]): number[] {
  const n = steps.length;
  if (n === 0) return [];
  const reach = new Array(n).fill(false);
  reach[n - 1] = true;
  for (let i = n - 1; i >= 0; i--) {
    if (!reach[i]) continue;
    steps[i].inputs.forEach((inp) => {
      if (inp.source.type === 'step' && isValidLink(steps, i, inp.id, inp.source)) reach[inp.source.index] = true;
    });
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (!reach[i]) out.push(i);
  return out;
}

/** Retire des étapes et renumérote les liens ; un lien vers une étape retirée devient un achat 'auto'. */
export function removeSteps(steps: Step[], indices: number[]): Step[] {
  const drop = new Set(indices);
  const map = new Map<number, number>();
  let k = 0;
  steps.forEach((_, i) => {
    if (!drop.has(i)) map.set(i, k++);
  });
  return steps
    .filter((_, i) => !drop.has(i))
    .map((s) => ({
      ...s,
      inputs: s.inputs.map((inp) => {
        if (inp.source.type !== 'step') return inp;
        const ni = map.get(inp.source.index);
        return ni === undefined ? { id: inp.id, source: { ...AUTO_BUY } } : { id: inp.id, source: { type: 'step', index: ni } };
      }),
    }));
}

/** Bascule la source d'un ingrédient en achat ; renvoie aussi les étapes devenues inutiles. */
export function replaceWithBuy(steps: Step[], stepIndex: number, inputId: string): { steps: Step[]; orphaned: number[] } {
  const next = steps.map((s, i) =>
    i !== stepIndex
      ? s
      : { ...s, inputs: s.inputs.map((inp) => (inp.id === inputId ? { id: inp.id, source: { ...AUTO_BUY } } : inp)) },
  );
  return { steps: next, orphaned: unreachableSteps(next) };
}

/** Aligne les ingrédients d'une étape sur sa recette (conserve les sources existantes). */
export function syncInputs(step: Step, recipe: Recipe): Step {
  return {
    ...step,
    inputs: recipe.inputs.map((inp) => ({ id: inp.id, source: sourceFor(step, inp.id) })),
  };
}

export const SELL_CHOICES: (Location | 'auto')[] = ['auto', ...LOCATIONS];
export const CRAFT_CHOICES: (Location | 'auto')[] = ['auto', ...PRODUCTION_LOCATIONS];
