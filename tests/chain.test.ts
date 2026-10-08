import { describe, expect, it } from 'vitest';
import { buildPriceIndex } from '../src/engine';
import {
  buildPreset,
  computeChain,
  removeSteps,
  replaceWithBuy,
  stepFromRecipe,
  type ChainContext,
  type ChainRoute,
  type Step,
} from '../src/engine/chain-index';
import { NOW, RECIPES, SETTINGS, SNAPSHOT } from './chain-fixture';
import type { Settings } from '../src/types';

const ctxWith = (s: Partial<Settings> = {}): ChainContext => {
  const settings = { ...SETTINGS, ...s };
  return { recipes: RECIPES, index: buildPriceIndex(SNAPSHOT, settings, NOW), settings, now: NOW };
};
const CTX = ctxWith();

const preset = (): Step[] => {
  const r = buildPreset(RECIPES, 'wood', 2, 4, 0);
  if (!r.ok) throw new Error(r.error);
  return r.steps;
};
const route = (steps: Step[], o: Partial<ChainRoute['final']> = {}): ChainRoute => ({
  steps,
  final: { sellAt: 'auto', qty: 100, qtyMode: 'final', ...o },
});
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('préréglage', () => {
  it('T2→T4 bois : T2 brut acheté puis brut acheté + raffiné de l’étape précédente', () => {
    const steps = preset();
    expect(steps.map((s) => s.outputId)).toEqual(['T2_PLANKS', 'T3_PLANKS', 'T4_PLANKS']);
    expect(steps[0].inputs).toEqual([{ id: 'T2_WOOD', source: { type: 'buy', at: 'auto' } }]);
    expect(steps[1].inputs).toEqual([
      { id: 'T3_WOOD', source: { type: 'buy', at: 'auto' } },
      { id: 'T2_PLANKS', source: { type: 'step', index: 0 } },
    ]);
    expect(steps[2].inputs[1]).toEqual({ id: 'T3_PLANKS', source: { type: 'step', index: 1 } });
    expect(steps.every((s) => s.craftAt === 'auto')).toBe(true);
  });

  it('refuse les combinaisons invalides', () => {
    expect(buildPreset(RECIPES, 'rock', 2, 4, 1).ok).toBe(false); // pierre non enchantable
    expect(buildPreset(RECIPES, 'wood', 5, 4, 0).ok).toBe(false);
    expect(buildPreset(RECIPES, 'wood', 1, 4, 0).ok).toBe(false);
  });
});

describe('chaîne T2 → T4 planches, calcul à la main', () => {
  // Réglages : premium (taxe 4 %), vente instantanée, frais de station 400 pour 100 de nutrition.
  // craftAt 'auto' → Fort Sterling (0,15 + 0,10 bois = 0,25 → RRR = 0,25/1,25 = 0,2).
  // On veut vendre 100 T4_PLANKS.
  const res = computeChain(route(preset()), CTX);

  it('étape 3 (T4) : 100 crafts, 160 T4_WOOD, 80 T3_PLANKS, frais 720', () => {
    const s = res.steps[2];
    expect(s.craftAt).toBe('Fort Sterling');
    close(s.rrr, 0.2);
    close(s.crafts, 100); // 100 / outputQty 1
    // T4_WOOD : 2 × 100 × (1 − 0,2) = 160, achat auto au moins cher : Martlock 40 → 6 400
    close(s.inputs[0].need, 160);
    expect(s.inputs[0].buyAt).toBe('Martlock');
    close(s.inputs[0].cost, 6400);
    // T3_PLANKS venant de l'étape 2 : 1 × 100 × 0,8 = 80
    close(s.inputs[1].need, 80);
    // frais : itemValue 16 × 0,1125 × 400/100 = 7,2 par craft → 720
    close(s.fee, 720);
  });

  it('étape 2 (T3) : 80 crafts, 128 T3_WOOD (2 560), 64 T2_PLANKS, frais 288', () => {
    const s = res.steps[1];
    close(s.crafts, 80);
    close(s.inputs[0].need, 128); // 2 × 80 × 0,8
    close(s.inputs[0].cost, 2560); // × 20 (Lymhurst)
    close(s.inputs[1].need, 64); // 80 × 0,8
    close(s.fee, 288); // 8 × 0,45 = 3,6 × 80
  });

  it('étape 1 (T2) : 64 crafts, 51,2 T2_WOOD (512), frais 115,2', () => {
    const s = res.steps[0];
    close(s.crafts, 64);
    close(s.inputs[0].need, 51.2); // 64 × 0,8
    close(s.inputs[0].cost, 512); // × 10
    close(s.fee, 115.2); // 4 × 0,45 = 1,8 × 64
  });

  it('totaux : achats 9 472, frais 1 123,2, revenu 24 000, profit 13 404,8', () => {
    close(res.buyTotal, 9472); // 6 400 + 2 560 + 512
    close(res.feeTotal, 1123.2); // 720 + 288 + 115,2
    // vente auto : Lymhurst ordre d'achat 250 (Bridgewatch 200) → net 250 × 0,96 = 240 → × 100
    expect(res.sellAt).toBe('Lymhurst');
    close(res.revenue, 24000);
    close(res.profit, 13404.8);
    close(res.profitPerUnit, 134.048);
    close(res.margin!, 13404.8 / 24000);
    expect(res.complete).toBe(true);
    close(res.maxPriceAgeH, 3); // prix de vente de Lymhurst, vieux de 3 h
  });

  it('profit par étape au marché : 1 216 + 2 988,8 + 9 200 = profit total', () => {
    // T2_PLANKS valorisé à 30 × 0,96 = 28,8 ; T3_PLANKS à 100 × 0,96 = 96.
    close(res.steps[0].profit, 64 * 28.8 - (512 + 115.2)); // 1 216
    close(res.steps[1].profit, 80 * 96 - (2560 + 64 * 28.8 + 288)); // 2 988,8
    close(res.steps[2].profit, 24000 - (6400 + 80 * 96 + 720)); // 9 200
    close(res.steps.reduce((a, s) => a + s.profit, 0), res.profit);
  });

  it('comparateur : produire 80 T3_PLANKS coûte 3 475,2 contre 8 800 à l’achat', () => {
    const c = res.steps[2].inputs[1].comparison!;
    // coût réel unitaire T2 = (512 + 115,2) / 64 = 9,8 ; T3 = (2 560 + 64 × 9,8 + 288) / 80 = 43,44
    close(c.produceCost, 80 * 43.44);
    expect(c.buyAt).toBe('Fort Sterling');
    close(c.buyCost, 80 * 110);
    close(c.delta, 3475.2 - 8800);
  });

  it('avertissements de volume (vente et achat)', () => {
    const kinds = res.warnings.map((w) => w.kind);
    // vente : 100 > min(500 × 10 %, 1 000) = 50
    expect(kinds).toContain('sell-volume');
    // achat : 160 T4_WOOD > 1 000 × 10 % à Martlock
    const bv = res.warnings.filter((w) => w.kind === 'buy-volume');
    expect(bv.map((w) => w.itemId)).toEqual(['T4_WOOD']);
    // à 40 unités finales : 64 T4_WOOD < 100 et 40 < 50 → plus d'avertissement de volume
    const small = computeChain(route(preset(), { qty: 40 }), CTX).warnings.map((w) => w.kind);
    expect(small).not.toContain('sell-volume');
    expect(small).not.toContain('buy-volume');
  });
});

describe('variantes', () => {
  it('qtyMode start (64 crafts T2) ≡ qtyMode final (100 T4)', () => {
    const a = computeChain(route(preset(), { qty: 100, qtyMode: 'final' }), CTX);
    const b = computeChain(route(preset(), { qty: 64, qtyMode: 'start' }), CTX);
    close(b.finalQty, 100);
    close(b.startCrafts, 64);
    close(b.profit, a.profit);
    close(b.buyTotal, a.buyTotal);
  });

  it('prix manuel prioritaire', () => {
    const steps = preset();
    steps[2].inputs[0].source = { type: 'buy', at: 'auto', manualPrice: 50 };
    const r = computeChain(route(steps), CTX);
    expect(r.steps[2].inputs[0].manual).toBe(true);
    close(r.steps[2].inputs[0].cost, 160 * 50);
    close(r.profit, 13404.8 - 160 * 10);
    expect(r.warnings.some((w) => w.kind === 'manual-price')).toBe(true);
    expect(r.complete).toBe(true);
  });

  it('prix manquant : total sans l’ingrédient, route incomplète', () => {
    const steps = preset();
    steps[2].inputs[0].source = { type: 'buy', at: 'Thetford' }; // aucun prix à Thetford
    const r = computeChain(route(steps), CTX);
    expect(r.steps[2].inputs[0].missing).toBe(true);
    expect(r.complete).toBe(false);
    close(r.buyTotal, 9472 - 6400);
    expect(r.warnings.some((w) => w.kind === 'missing-price' && w.itemId === 'T4_WOOD')).toBe(true);
  });

  it('prix périmé signalé comme tel', () => {
    const r = computeChain(route(preset()), ctxWith({ maxPriceAgeH: 1.2 })); // T3_WOOD a 1,5 h
    expect(r.warnings.some((w) => w.kind === 'stale-price' && w.itemId === 'T3_WOOD')).toBe(true);
    expect(r.complete).toBe(false);
  });

  it('ingrédient non returnable : pas de RRR appliqué', () => {
    const tool = RECIPES.recipes.find((x) => x.outputId === 'T4_TOOL_TEST')!;
    const steps = [...preset()];
    steps.push(stepFromRecipe(tool, steps));
    expect(steps[3].inputs[0].source).toEqual({ type: 'step', index: 2 });
    const r = computeChain(route(steps, { qty: 10 }), CTX);
    const s = r.steps[3];
    // auto → aucun bonus 'tools' en table : base 0,18 → RRR = 0,18/1,18
    const rrr = 0.18 / 1.18;
    close(s.rrr, rrr);
    close(s.inputs[1].need, 10); // rune : 1 × 10, sans retour
    close(s.inputs[0].need, 2 * 10 * (1 - rrr));
    close(r.steps[2].crafts, 2 * 10 * (1 - rrr));
    close(r.steps.reduce((a, x) => a + x.profit, 0), r.profit);
  });

  it('T4.1 utilise le T3 non enchanté', () => {
    const r = buildPreset(RECIPES, 'wood', 3, 4, 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.steps.map((s) => s.outputId)).toEqual(['T3_PLANKS', 'T4_PLANKS_LEVEL1@1']);
    expect(r.steps[1].inputs).toEqual([
      { id: 'T4_WOOD_LEVEL1@1', source: { type: 'buy', at: 'auto' } },
      { id: 'T3_PLANKS', source: { type: 'step', index: 0 } },
    ]);
  });

  it('Black Market seulement si choisi explicitement', () => {
    expect(computeChain(route(preset()), CTX).sellAt).toBe('Lymhurst');
    const bm = computeChain(route(preset(), { sellAt: 'Black Market' }), CTX);
    expect(bm.sellAt).toBe('Black Market');
    close(bm.revenue, 100 * 300 * 0.96);
    expect(bm.warnings.some((w) => w.kind === 'red-zone')).toBe(true);
  });

  it('lien invalide → achat auto + avertissement', () => {
    const steps = preset();
    steps[1].inputs[1].source = { type: 'step', index: 2 }; // étape suivante : interdit
    const r = computeChain(route(steps), CTX);
    expect(r.warnings.some((w) => w.kind === 'invalid-link')).toBe(true);
    expect(r.steps[1].inputs[1].sourceType).toBe('buy');
  });

  it('remplacer un intermédiaire par un achat rend l’étape amont inutile', () => {
    const { steps, orphaned } = replaceWithBuy(preset(), 2, 'T3_PLANKS');
    expect(orphaned).toEqual([0, 1]);
    const pruned = removeSteps(steps, orphaned);
    expect(pruned.map((s) => s.outputId)).toEqual(['T4_PLANKS']);
    const r = computeChain(route(pruned), CTX);
    close(r.buyTotal, 6400 + 80 * 110);
    close(r.profit, 24000 - 6400 - 8800 - 720);
  });

  it('intermédiaire non valorisable : étape comptée au coût, somme toujours égale', () => {
    const snap = { ...SNAPSHOT, items: SNAPSHOT.items.filter((i) => i.id !== 'T2_PLANKS') };
    const ctx = { ...CTX, index: buildPriceIndex(snap, SETTINGS, NOW) };
    const r = computeChain(route(preset()), ctx);
    expect(r.steps[0].valuedAtCost).toBe(true);
    close(r.steps[0].profit, 0);
    expect(r.warnings.some((w) => w.kind === 'not-valued')).toBe(true);
    close(r.steps.reduce((a, x) => a + x.profit, 0), r.profit);
    close(r.profit, 13404.8);
  });
});
