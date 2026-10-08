// Moteur « Fermes » : critères d'acceptation chiffrés à la main.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPriceIndex } from '../src/engine';
import {
  DEFAULT_FARM_ASSUMPTIONS,
  DEFAULT_FARM_OPTIONS,
  evaluateActivity,
  evaluateAnimal,
  evaluateCrop,
  focusCostAtSpec,
  foodUnits,
  harvestsPerDay,
  returnChance,
  planIslands,
  rankFarming,
  type FarmContext,
} from '../src/engine/farming';
import { buildFarming, farmingIds } from '../collector/farming';
import { collectIds } from '../collector/ids-perimeter';
import type { RecipesFile, Settings } from '../src/types';
import { FARMING, NOW, SETTINGS, SNAPSHOT } from './farm-fixture';

function ctx(settings: Partial<Settings> = {}, options: Partial<FarmContext['options']> = {}): FarmContext {
  const s = { ...SETTINGS, ...settings };
  return {
    farming: FARMING,
    index: buildPriceIndex(SNAPSHOT, s, NOW),
    settings: s,
    assumptions: { ...DEFAULT_FARM_ASSUMPTIONS },
    options: { ...DEFAULT_FARM_OPTIONS, ...options },
  };
}
const teasel = FARMING.crops.find((c) => c.seedId === 'T5_FARM_TEASEL_SEED')!;
const carrot = FARMING.crops.find((c) => c.seedId === 'T1_FARM_CARROT_SEED')!;
const chicken = FARMING.animals[0];
const pig = FARMING.animals[1];

describe('cultures et herbes', () => {
  it('Cardère T5 premium, vente instantanée, taxe 4 %, arrosée', () => {
    // R = 4,5 × 2 = 9 ; S = min(1 ; 0,8 + 0,4) = 1 → ΔS = 0 (graine toujours rendue, jamais d'excédent)
    // V = 9 × 300 × 0,96 + 0,1 × 500 × 0,96 = 2 592 + 48 = 2 640
    // Par parcelle/jour = 9 × 2 640 = 23 760 ; F = 9 × 1 000 = 9 000
    const e = evaluateCrop(teasel, true, ctx());
    expect(e.ok).toBe(true);
    expect(e.profitPerPlotDay).toBeCloseTo(23760, 6);
    expect(e.sells.some((x) => x.id === 'T5_FARM_TEASEL_SEED')).toBe(false);
    expect(e.buys).toEqual([]);
    expect(e.focusPerPlotDay).toBe(9000);
    expect(e.sellAt).toBe('Martlock');
  });

  it('Cardère non arrosée : graine rachetée au marché (9 000 < PNJ 10 000)', () => {
    // V = 2 592 + 48 − 0,2 × 9 000 = 840 → 9 × 840 = 7 560
    const e = evaluateCrop(teasel, false, ctx());
    expect(e.profitPerPlotDay).toBeCloseTo(7560, 6);
    expect(e.focusPerPlotDay).toBe(0);
    expect(e.buys).toEqual([{ id: 'T5_FARM_TEASEL_SEED', qty: expect.closeTo(1.8, 9), loc: 'Martlock', unitPrice: 9000 }]);
  });

  it('silver par focus = (23 760 − 7 560) / 9 000 = 1,8 dans le classement', () => {
    const rows = rankFarming(ctx());
    const f = rows.find((r) => r.rowId === 'crop:T5_FARM_TEASEL_SEED:f')!;
    expect(f.silverPerFocus).toBeCloseTo(1.8, 9);
    expect(rows.find((r) => r.rowId === 'crop:T5_FARM_TEASEL_SEED:n')!.silverPerFocus).toBeNull();
  });

  it('spécialisation 100 → F = 9 × 125 = 1 125', () => {
    expect(focusCostAtSpec(1000, 100)).toBe(125);
    expect(focusCostAtSpec(1000, 0)).toBe(1000);
    expect(focusCostAtSpec(1000, 50)).toBe(354); // 1000 × 0,5^1,5 = 353,6
    const e = evaluateCrop(teasel, true, ctx({}, { specs: { T5_FARM_TEASEL_SEED: 100 } }));
    expect(e.focusPerPlotDay).toBe(1125);
  });

  it('carotte arrosée : S = min(1 ; 0 + 2) = 1 → aucune graine fantôme vendue (bug S > 1)', () => {
    // R = 9 ; V = 9 × 50 × 0,96 + 0,1 × 500 × 0,96 = 432 + 48 = 480 (avant : +1 440 de graines « excédentaires »)
    const e = evaluateCrop(carrot, true, ctx());
    expect(e.sells.find((s) => s.id === 'T1_FARM_CARROT_SEED')).toBeUndefined();
    expect(e.buys).toEqual([]);
    expect(e.profitPerPlotDay).toBeCloseTo(9 * 480, 6);
  });

  it('retour de graine/petit plafonné à 1 et jamais négatif', () => {
    expect(returnChance(0, 2, true)).toBe(1);
    expect(returnChance(0.9333, 0.1333, true)).toBe(1);
    expect(returnChance(0.6, 0.8, false)).toBe(0.6);
    expect(returnChance(-1, 0, false)).toBe(0);
    expect(returnChance(NaN, NaN, true)).toBe(0);
  });

  it('cycles par jour : récolte au premier passage après la fin du cycle', () => {
    expect(harvestsPerDay(79200, 1)).toBe(1); // culture 22 h, 1 passage/jour
    expect(harvestsPerDay(158400, 1)).toBe(0.5); // animal 44 h → tous les 2 jours
    expect(harvestsPerDay(79200, 24 / 22)).toBeCloseTo(24 / 22, 12); // continu : pas d'arrondi flottant vers 2 intervalles
    expect(harvestsPerDay(158400, 24 / 22)).toBeCloseTo(12 / 22, 12);
    expect(harvestsPerDay(79200, 0.5)).toBe(0.5);
    expect(harvestsPerDay(0, 1)).toBe(0);
    expect(harvestsPerDay(79200, NaN)).toBe(0);
  });

  it('non premium : R = 4,5 et taxe 8 %', () => {
    // Arrosée : V = 4,5 × 300 × 0,92 + 0,1 × 500 × 0,92 = 1 242 + 46 = 1 288
    const e = evaluateCrop(teasel, true, ctx({ premium: false }));
    expect(e.steps[0].value).toBe('4,5');
    expect(e.profitPerPlotDay).toBeCloseTo(9 * 1288, 6);
  });

  it('bonus de ville : cardère sur une île de Bridgewatch → R = 9 × 1,1', () => {
    const e = evaluateCrop(teasel, true, ctx({}, { islandCity: 'Bridgewatch' }));
    // V = 9,9 × 288 + 48 = 2 899,2
    expect(e.cityBonus).toBe(0.1);
    expect(e.profitPerPlotDay).toBeCloseTo(9 * 2899.2, 6);
  });

  it('mode ordres : sell_price_min − 1 et frais d’ordre 2,5 %', () => {
    // Cardère arrosée : 9 × 319 × 0,935 + 0,1 × 519 × 0,935 (ΔS = 0)
    const e = evaluateCrop(teasel, true, ctx({ mode: 'orders' }));
    const V = 9 * 319 * 0.935 + 0.1 * 519 * 0.935;
    expect(e.profitPerPlotDay).toBeCloseTo(9 * V, 6);
  });

  it('prix de récolte manquant → données manquantes, jamais 0', () => {
    const c = ctx();
    c.index.delete('T5_TEASEL');
    const e = evaluateCrop(teasel, true, c);
    expect(e.ok).toBe(false);
    expect(e.profitPerPlotDay).toBeNull();
    expect(e.flags).toContain('missing');
    expect(e.missing).toEqual(['T5_TEASEL']);
    const rows = rankFarming(c);
    expect(rows.at(-1)!.profitPerPlotDay).toBeNull(); // en fin de classement
  });

  it('prix d’achat de graine absent → repli sur le PNJ', () => {
    const c = ctx();
    c.index.delete('T5_FARM_TEASEL_SEED');
    const e = evaluateCrop(teasel, false, c);
    // V = 2 592 + 48 − 0,2 × 10 000 = 640
    expect(e.profitPerPlotDay).toBeCloseTo(9 * 640, 6);
    expect(e.buys[0].loc).toBe('npc');
  });

  it('graine sans prix mais arrosée (ΔS = 0) : profit calculé, pas de drapeau', () => {
    const c = ctx();
    c.index.delete('T5_FARM_TEASEL_SEED');
    const e = evaluateCrop(teasel, true, c);
    expect(e.flags).not.toContain('surplus-unpriced');
    expect(e.profitPerPlotDay).toBeCloseTo(9 * (2592 + 48), 6);
  });

  it('ver sans prix → compté 0 avec drapeau « sous-produit non valorisé »', () => {
    const c = ctx();
    c.index.delete('T1_WORM');
    const e = evaluateCrop(teasel, true, c);
    expect(e.ok).toBe(true);
    expect(e.flags).toContain('surplus-unpriced');
    expect(e.profitPerPlotDay).toBeCloseTo(9 * 2592, 6);
  });

  it('prix nuls, absents ou périmés partout : jamais de NaN, Infinity ni profit fictif', () => {
    const empty = { ...SNAPSHOT, items: SNAPSHOT.items.map((i) => ({ ...i, prices: { Martlock: { sell: 0, sellAt: null, buy: null, buyAt: null } } })) };
    const s = { ...SETTINGS };
    const c: FarmContext = { ...ctx(), index: buildPriceIndex(empty, s, NOW) };
    for (const r of rankFarming(c)) {
      // Seules les cultures à graine rachetable au PNJ peuvent manquer de prix de vente : toutes doivent être « missing ».
      expect(r.ok).toBe(false);
      expect(r.profitPerPlotDay).toBeNull();
      expect(r.flags).toContain('missing');
    }
    const p = planIslands({ islands: [{ id: 'i', name: 'A', city: 'Martlock', plots: [{ id: 'x', type: 'jardin', activity: 'auto' }] }], focusPerDay: 1e6, specs: {} }, c);
    expect(p.totalProfitPerDay).toBe(0);
    expect(p.plotsWithoutProfit).toBe(1);
    expect(p.focusUsed).toBe(0);
  });

  it('volume faible et âge du prix', () => {
    const e = evaluateCrop(teasel, false, ctx({ minVolume: 500 }));
    expect(e.flags).toContain('low-volume');
    expect(e.volume7d).toBe(100);
    expect(e.oldestPriceAgeH).toBeCloseTo(0.5, 9);
  });
});

describe('animaux', () => {
  it('poulet : nourriture favorite blé → 864 / (48 × 2) = 9 unités par croissance', () => {
    expect(foodUnits(chicken, chicken.nutritionMax, 'T3_WHEAT', FARMING)).toBe(9);
    expect(foodUnits(chicken, chicken.nutritionMax, 'T1_CARROT', FARMING)).toBe(18);
  });

  it('poulet « Élever et vendre l’adulte », premium (croissance 22 h)', () => {
    // T = 158 400 × 0,5 = 79 200 s → 86 400 / 79 200 = 1,0909 cycle/jour
    // Nourriture : 9 blés × 120 (achat instantané) = 1 080 ; adulte : 10 000 × 0,96 = 9 600
    // ΔB = 0,6 − 1 = −0,4 → rachat poussin 4 000 (marché < PNJ 5 000) : −1 600
    // V = 9 600 − 1 600 − 1 080 = 6 920 ; 1 passage/jour → 1 cycle de 22 h récolté par jour : P = 9 × 6 920
    const e = evaluateAnimal(chicken, 'sell', false, ctx());
    expect(e.profitPerPlotDay).toBeCloseTo(9 * 6920, 6);
  });

  it('poulet sans premium : croissance 44 h → 0,5 cycle/jour (pas 0,545)', () => {
    // adulte 10 000 × 0,92 = 9 200 ; poussins −0,4 × 4 000 = −1 600 ; blé 9 × 120 = 1 080 → V = 6 520
    const e = evaluateAnimal(chicken, 'sell', false, ctx({ premium: false }));
    expect(e.profitPerPlotDay).toBeCloseTo(9 * 6520 * 0.5, 6);
  });

  it('passages continus (24/22) : animaux et cultures normalisés de la même façon', () => {
    const c = ctx();
    c.assumptions.cropCyclesPerDay = 24 / 22;
    expect(evaluateAnimal(chicken, 'sell', false, c).profitPerPlotDay).toBeCloseTo(9 * 6920 * (24 / 22), 6);
    expect(evaluateCrop(teasel, false, c).profitPerPlotDay).toBeCloseTo(7560 * (24 / 22), 6);
  });

  it('temps de croissance nul (données corrompues) → données manquantes, pas d’Infinity', () => {
    const bad = { ...chicken, growSeconds: 0 };
    const e = evaluateAnimal(bad, 'meat', true, ctx());
    expect(e.ok).toBe(false);
    expect(e.profitPerPlotDay).toBeNull();
    expect(Number.isFinite(e.focusPerPlotDay)).toBe(true);
  });

  it('poulet soigné « Élever et abattre » : 18 viandes, excédent de poussins vendu', () => {
    // B = min(1 ; 1,4) = 1 → ΔB = 0 (ni rachat ni excédent) ; viande : 18 × 600 × 0,96 = 10 368
    // V = 10 368 − 1 080 = 9 288 ; F = 9 × 1 000 × 1 cycle/jour
    const e = evaluateAnimal(chicken, 'meat', true, ctx());
    expect(e.profitPerPlotDay).toBeCloseTo(9 * 9288, 6);
    expect(e.focusPerPlotDay).toBeCloseTo(9000, 6);
    expect(e.sells.some((x) => x.id === 'T3_FARM_CHICKEN_BABY')).toBe(false);
  });

  it('poulet « Garder et produire » : œufs − nourriture par jour', () => {
    // 1 cycle de production (22 h) par jour : 9 œufs × 80 × 0,96 = 691,2
    // Nourriture : 864 nutrition par cycle / 96 = 9 blés × 120 = 1 080
    const e = evaluateAnimal(chicken, 'produce', false, ctx());
    expect(e.profitPerPlotDay).toBeCloseTo(9 * (9 * 80 * 0.96 - 9 * 120), 6);
    expect(e.buys[0].qty).toBeCloseTo(81, 9);
  });

  it('nourriture produite sur l’île : coût d’opportunité au prix de vente net', () => {
    const e = evaluateAnimal(chicken, 'sell', false, ctx({}, { foodSource: 'island' }));
    // nourriture : 9 × 100 × 0,96 = 864 → V = 9 600 − 1 600 − 864 = 7 136
    expect(e.profitPerPlotDay).toBeCloseTo(9 * 7136, 6);
  });

  it('cochon : pas de stratégie « Garder et produire »', () => {
    const ids = rankFarming(ctx()).filter((r) => r.sourceId === 'T7_FARM_PIG_BABY').map((r) => r.rowId);
    expect(ids.some((i) => i.includes(':produce'))).toBe(false);
    expect(ids).toContain('animal:T7_FARM_PIG_BABY:meat:f');
    expect(evaluateActivity('animal:T7_FARM_PIG_BABY:produce', false, ctx())).toBeNull();
    expect(pig.productId).toBeNull();
  });

  it('nourriture sans prix → données manquantes', () => {
    const c = ctx();
    c.index.delete('T3_WHEAT');
    const e = evaluateAnimal(chicken, 'sell', false, c);
    expect(e.ok).toBe(false);
    expect(e.missing).toContain('T3_WHEAT');
  });
});

describe('planificateur', () => {
  const base = () => {
    const c = ctx();
    return { farming: c.farming, index: c.index, settings: c.settings, assumptions: c.assumptions };
  };

  it('10 000 focus, 2 parcelles de cardère → 1 seule arrosée, 1 000 restant', () => {
    const r = planIslands(
      {
        islands: [
          {
            id: 'i1',
            name: 'Île',
            city: 'Martlock',
            plots: [
              { id: 'p1', type: 'jardin', activity: 'crop:T5_FARM_TEASEL_SEED' },
              { id: 'p2', type: 'jardin', activity: 'crop:T5_FARM_TEASEL_SEED' },
            ],
          },
        ],
        focusPerDay: 10000,
        specs: {},
      },
      base(),
    );
    expect(r.plots.filter((p) => p.focused)).toHaveLength(1);
    expect(r.focusUsed).toBe(9000);
    expect(r.focusLeft).toBe(1000);
    expect(r.totalProfitPerDay).toBeCloseTo(23760 + 7560, 6);
    expect(r.plotsWithoutProfit).toBe(0);
    // Liste de courses : graines rachetées pour la parcelle non arrosée (0,2 × 9)
    expect(r.buys.find((b) => b.id === 'T5_FARM_TEASEL_SEED')!.qtyPerDay).toBeCloseTo(1.8, 9);
    // 2 × 81 cardères/jour = 162 > 10 % de 100 → avertissement
    expect(r.warnings.find((w) => w.id === 'T5_TEASEL')).toMatchObject({ loc: 'Martlock', volume: 100 });
  });

  it('activité auto : meilleure activité non arrosée compatible, bonus de ville pris en compte', () => {
    const r = planIslands(
      {
        islands: [
          { id: 'i1', name: 'A', city: 'Lymhurst', plots: [{ id: 'f', type: 'ferme', activity: 'auto' }, { id: 'g', type: 'jardin', activity: 'auto' }, { id: 'p', type: 'pâturage', activity: 'auto' }] },
        ],
        focusPerDay: 0,
        specs: {},
      },
      base(),
    );
    const [f, g, p] = r.plots;
    expect(f.activityId?.startsWith('crop:')).toBe(true);
    expect(FARMING.crops.find((c) => `crop:${c.seedId}` === f.activityId)!.kind).toBe('crop');
    expect(g.activityId).toBe('crop:T5_FARM_TEASEL_SEED');
    expect(p.activityId?.startsWith('animal:')).toBe(true);
    expect(r.focusUsed).toBe(0);
    // l'activité retenue est la meilleure parmi celles du pâturage
    const c = ctx({}, { islandCity: 'Lymhurst' });
    const best = rankFarming(c).filter((x) => x.kind === 'animal' && !x.focused && x.ok)[0];
    expect(p.profitPerDay).toBeCloseTo(best.profitPerPlotDay!, 6);
  });

  it('activité incompatible → note et aucun profit', () => {
    const r = planIslands(
      { islands: [{ id: 'i', name: 'A', city: 'Martlock', plots: [{ id: 'x', type: 'ferme', activity: 'crop:T5_FARM_TEASEL_SEED' }] }], focusPerDay: 0, specs: {} },
      base(),
    );
    expect(r.plots[0].profitPerDay).toBeNull();
    expect(r.plots[0].note).toMatch(/incompatible/);
    expect(r.totalProfitPerDay).toBe(0);
    expect(r.plotsWithoutProfit).toBe(1);
  });

  it('allocation gloutonne : jamais plus de focus que disponible (cas aléatoires, focus fractionnaire des animaux)', () => {
    const acts = ['auto', 'crop:T5_FARM_TEASEL_SEED', 'crop:T1_FARM_CARROT_SEED', 'crop:T3_FARM_WHEAT_SEED', 'animal:T3_FARM_CHICKEN_BABY:meat', 'animal:T7_FARM_PIG_BABY:sell'];
    const types = ['ferme', 'jardin', 'pâturage'] as const;
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let k = 0; k < 60; k++) {
      const plots = Array.from({ length: 1 + Math.floor(rnd() * 12) }, (_, i) => ({ id: `p${i}`, type: types[Math.floor(rnd() * 3)], activity: acts[Math.floor(rnd() * acts.length)] }));
      const focus = Math.floor(rnd() * 60000);
      const b = base();
      b.assumptions = { ...b.assumptions, cropCyclesPerDay: rnd() < 0.5 ? 1 : 24 / 22 };
      const r = planIslands({ islands: [{ id: 'i', name: 'A', city: 'Martlock', plots }], focusPerDay: focus, specs: { T3_FARM_CHICKEN_BABY: 37 } }, b);
      expect(r.focusUsed).toBeLessThanOrEqual(focus);
      expect(r.focusLeft).toBeGreaterThanOrEqual(0);
      expect(r.focusUsed + r.focusLeft).toBeCloseTo(focus, 6);
      expect(Number.isFinite(r.totalProfitPerDay)).toBe(true);
      for (const p of r.plots) if (p.focused) expect(p.focusGain!).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Données réelles (recipes.json généré, ou fichiers bruts du jeu)
// ---------------------------------------------------------------------------
const OUT = join(__dirname, '..', 'out', 'recipes.json');
const hasOut = existsSync(OUT) && (() => {
  try {
    return !!JSON.parse(readFileSync(OUT, 'utf8')).farming;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasOut)('recipes.json réel (générateur v3)', () => {
  const file = hasOut ? (JSON.parse(readFileSync(OUT, 'utf8')) as RecipesFile) : null;

  it('version 3, 8 cultures, 7 herbes, 6 animaux de ferme', () => {
    expect(file!.generatorVersion).toBe(3);
    expect(file!.farming!.crops.filter((c) => c.kind === 'crop')).toHaveLength(8);
    expect(file!.farming!.crops.filter((c) => c.kind === 'herb')).toHaveLength(7);
    expect(file!.farming!.animals.map((a) => a.babyId.split('_')[2])).toEqual(['CHICKEN', 'GOAT', 'GOOSE', 'SHEEP', 'PIG', 'COW']);
  });

  it('constantes T5_TEASEL et T3_FARM_CHICKEN_BABY', () => {
    const t = file!.farming!.crops.find((c) => c.cropId === 'T5_TEASEL')!;
    expect(t).toMatchObject({ kind: 'herb', seedId: 'T5_FARM_TEASEL_SEED', tier: 5, growSeconds: 79200, harvestAvg: 4.5, wormChance: 0.1, wormId: 'T1_WORM', seedChance: 0.8, focusBonus: 0.4, focusCost: 1000, npcSeedPrice: 10000, nutrition: 48 });
    const c = file!.farming!.animals.find((a) => a.babyId === 'T3_FARM_CHICKEN_BABY')!;
    expect(c).toMatchObject({ grownId: 'T3_FARM_CHICKEN_GROWN', tier: 3, growSeconds: 158400, offspringChance: 0.6, focusBonus: 0.8, focusCost: 1000, npcBabyPrice: 5000, nutritionMax: 864, favoriteFood: 'T3_WHEAT', favoriteBonus: 1, productId: 'T3_EGG', productAvg: 9, productionSeconds: 79200, meatId: 'T3_MEAT', meatPerAdult: 18 });
    expect(c.adultConsumptionPerDay).toBeCloseTo((864 * 24) / 22, 9);
    expect(file!.farming!.animals.find((a) => a.babyId === 'T7_FARM_PIG_BABY')!.productId).toBeNull();
  });

  it('bonus de ville : cardère à Bridgewatch et Caerleon, oie à Lymhurst', () => {
    const b = file!.farming!.cityBonuses;
    expect(b.Bridgewatch!.T5_FARM_TEASEL_SEED).toBe(0.1);
    expect(b.Caerleon!.T5_FARM_TEASEL_SEED).toBe(0.1);
    expect(b.Lymhurst!.T5_FARM_GOOSE_GROWN).toBe(0.1);
    expect(b['Black Market']).toBeUndefined();
  });

  it('collectIds inclut les 84 ID agricoles, tous nommés en français', () => {
    const ids = farmingIds(file!.farming);
    expect(ids).toHaveLength(84);
    const all = new Set(collectIds(file!));
    for (const id of ids) expect(all.has(id)).toBe(true);
    const meta = new Map(file!.meta.map((m) => [m.id, m.nameFr]));
    for (const id of ids) expect(meta.get(id) && meta.get(id) !== id).toBeTruthy();
    expect(meta.get('T5_TEASEL')).toBe('Cardère incendiaire');
  });
});

describe('collecteur farming : fichiers minimaux', () => {
  it('sans farmableitem → null ; loot et modificateurs lus', () => {
    expect(buildFarming({}, {}, {})).toBeNull();
    const f = buildFarming(
      {
        farmableitem: [
          { '@uniquename': 'T2_FARM_X_SEED', '@tier': '2', '@kind': 'plant', '@shopsubcategory1': 'farm', '@activefarmbonus': '1', '@activefarmfocuscost': '1000', craftingrequirements: { '@silver': '3000' }, harvest: { '@growtime': '79200', '@lootlist': 'X_LOOT', seed: { '@chance': '0.5' } } },
        ],
        simpleitem: [{ '@uniquename': 'T2_X', '@nutrition': '48' }],
      },
      { LootDefinition: { Lootlist: { '@name': 'X_LOOT', Item: [{ '@type': 'T2_X', '@chance': '1.0', '@amount': '3-6' }, { '@type': 'T1_WORM', '@chance': '0.1', '@amount': '1' }] } } },
      { farmingmodifiers: { location: { '@clusterid': '1000', farmingyieldmodifier: { '@farmable': 'T2_FARM_X_SEED', '@value': '0.1', '@islandvalue': '0.1' } } } },
    )!;
    expect(f.crops[0]).toMatchObject({ cropId: 'T2_X', harvestAvg: 4.5, wormChance: 0.1, seedChance: 0.5, npcSeedPrice: 3000 });
    expect(f.cityBonuses.Lymhurst).toEqual({ T2_FARM_X_SEED: 0.1 });
    expect(farmingIds(f)).toEqual(['T1_WORM', 'T2_FARM_X_SEED', 'T2_X']);
  });
});
