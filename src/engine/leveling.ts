// Coût de montée en compétence (raffinage / craft) — données de jeu embarquées et fonctions pures.
//
// Sources (extraction du 14/10/2026) :
// - ao-data/ao-bin-dumps, achievements.json : templates REFINE_T4..T8 et CRAFT_BASE (colonne Fame des
//   baselevels, renommée par niveau INCRÉMENTALE), templateachievement@famemultiplier (épées 2, plastrons 1),
//   achievements CRAFT_TRAINEE / CRAFT_REFINE / CRAFT_WARRIOR (déblocage du T3).
// - ao-data/ao-bin-dumps, items.json : journaux T?_JOURNAL_WARRIOR (@maxfame, prix de fabrication).
// - wiki.albiononline.com/wiki/Fame (communautaire) : renommée par unité raffinée, formule de renommée de craft.
import type { Recipe } from '../types';

export type SourceStatus = 'jeu' | 'communautaire' | 'hypothèse';

export const STATUS_LABEL: Record<SourceStatus, string> = {
  jeu: 'vérifié jeu',
  communautaire: 'communautaire',
  hypothèse: 'hypothèse',
};

export const REFINING_RESOURCES = ['wood', 'ore', 'hide', 'fiber', 'rock'] as const;
export type RefiningResource = (typeof REFINING_RESOURCES)[number];

export const MIN_TIER = 2;
export const MAX_TIER = 8;

/**
 * Raffinage — renommée CUMULÉE minimale depuis zéro pour débloquer chaque tier (identique pour les 5 ressources).
 * T3 : CRAFT_TRAINEE 10 + CRAFT_REFINE 240 ; T4..T8 : + renommée du niveau 1 du nœud REFINE_Tn
 * (3 713 ; 45 000 ; 210 000 ; 860 000 ; 2 795 000). Statut : vérifié dans les fichiers du jeu.
 */
export const REFINING_UNLOCK_FAME: Record<number, number> = {
  2: 0,
  3: 250,
  4: 3963,
  5: 48963,
  6: 258963,
  7: 1118963,
  8: 3913963,
};

/**
 * Raffinage — renommée par unité raffinée, par tier et enchantement (0..3).
 * Source : wiki.albiononline.com/wiki/Fame (table « Refining fame per refined item »). Statut : communautaire.
 */
export const REFINING_FAME_PER_UNIT: Record<number, number[]> = {
  2: [2],
  3: [11],
  4: [33, 56, 78, 101],
  5: [135, 258, 382, 506],
  6: [405, 798, 1200, 1600],
  7: [967, 1900, 2900, 3800],
  8: [2100, 4200, 6300, 8300],
};

export type CraftFamily = 'CRAFT_SWORDS' | 'CRAFT_PLATE_ARMORS';

export interface CraftFamilyData {
  label: string;
  /** Clé de bonus des recettes (@craftingcategory). */
  bonusKey: string;
  famemultiplier: number;
  /** Renommée totale depuis zéro pour débloquer chaque tier (T3 = CRAFT_TRAINEE 10 + CRAFT_WARRIOR 480). */
  unlockFame: Record<number, number>;
}

/**
 * Craft — familles extraites. Nœud CRAFT_BASE × famemultiplier ; T4 au niveau 1, T5 au niveau 10, T6 au 30,
 * T7 au 60, T8 au 100. Statut : vérifié dans les fichiers du jeu ; l'application du multiplicateur est une
 * interprétation (albiondatabase.com affiche le nœud sans multiplicateur).
 */
export const CRAFT_FAMILIES: Record<CraftFamily, CraftFamilyData> = {
  CRAFT_SWORDS: {
    label: 'épées',
    bonusKey: 'sword',
    famemultiplier: 2,
    unlockFame: { 2: 0, 3: 490, 4: 14914, 5: 170072, 6: 751016, 7: 2887404, 8: 12879962 },
  },
  CRAFT_PLATE_ARMORS: {
    label: 'plastrons en plaque',
    bonusKey: 'plate_armor',
    famemultiplier: 1,
    unlockFame: { 2: 0, 3: 490, 4: 7702, 5: 85281, 6: 375753, 7: 1443947, 8: 6440226 },
  },
};

/**
 * Craft — multiplicateur de tier M de la formule F = A × M [+ 500 si artefact] [+ E × (F − 7,5 A)],
 * A = nombre de ressources hors artefact. Source : wiki Fame, testé T4+ seulement. Statut : communautaire.
 */
export const CRAFT_FAME_TIER_MULT: Record<number, number> = { 4: 22.5, 5: 90, 6: 270, 7: 645, 8: 1395 };
export const CRAFT_ARTIFACT_FAME = 500;

/**
 * Journaux de guerrier (épées, plaque) : renommée pour les remplir. Se remplissent uniquement avec des objets du
 * même tier. Source : items.json @maxfame. Statut : vérifié jeu. Aucun journal ne se remplit en raffinage.
 */
export const JOURNAL_MAX_FAME: Record<number, number> = { 4: 3600, 5: 7200, 6: 14400, 7: 28380, 8: 58590 };
export const JOURNAL_PREFIX = 'JOURNAL_WARRIOR';

/** Bonus de renommée du premium : hypothèse +50 %. */
export const DEFAULT_PREMIUM_FAME_BONUS = 0.5;

export interface Assumption {
  label: string;
  value: string;
  status: SourceStatus;
  source: string;
}

/** Hypothèses affichées dans le panneau « Hypothèses » de la page Investir. */
export const LEVELING_ASSUMPTIONS: Assumption[] = [
  {
    label: 'Renommée pour débloquer un tier de raffinage',
    value: 'T3 250 · T4 3 963 · T5 48 963 · T6 258 963 · T7 1 118 963 · T8 3 913 963 (cumulé depuis zéro)',
    status: 'jeu',
    source: 'ao-bin-dumps, achievements.json (REFINE_T4..T8, niveau 1)',
  },
  {
    label: 'Renommée par unité raffinée',
    value: 'T2 2 · T3 11 · T4 33 · T5 135 · T6 405 · T7 967 · T8 2 100 (.0)',
    status: 'communautaire',
    source: 'wiki.albiononline.com/wiki/Fame',
  },
  {
    label: 'Renommée pour débloquer un tier de craft',
    value: 'Épées T6 751 016 · plastrons T6 375 753 (nœud × multiplicateur de famille)',
    status: 'jeu',
    source: 'ao-bin-dumps, achievements.json (CRAFT_BASE) ; multiplicateur appliqué = interprétation',
  },
  {
    label: 'Renommée par objet crafté',
    value: 'A × M (M : T4 22,5 · T5 90 · T6 270 · T7 645 · T8 1 395) ; T2–T3 inconnue',
    status: 'communautaire',
    source: 'wiki.albiononline.com/wiki/Fame (testé T4+)',
  },
  {
    label: 'Stratégie de montée',
    value: 'Produire au tier le plus haut déjà débloqué, en .0, au meilleur lieu de production',
    status: 'hypothèse',
    source: 'Règle des nœuds : le niveau 1 du nœud Tn accepte la renommée de tous les tiers',
  },
  {
    label: 'Bonus de renommée premium',
    value: '+50 %',
    status: 'hypothèse',
    source: 'Réglable par l’interrupteur',
  },
  {
    label: 'Journaux de guerrier',
    value: 'T4 3 600 · T5 7 200 · T6 14 400 · T7 28 380 · T8 58 590 de renommée ; même tier seulement',
    status: 'jeu',
    source: 'ao-bin-dumps, items.json ; gain = prix plein − prix vide si les deux prix sont connus',
  },
];

export type LevelingTrack =
  | { kind: 'refining'; resource: RefiningResource; label: string }
  | { kind: 'crafting'; family: CraftFamily; label: string };

const RES_LABEL: Record<RefiningResource, string> = {
  wood: 'raffinage du bois',
  ore: 'raffinage du minerai',
  hide: 'raffinage des peaux',
  fiber: 'raffinage des fibres',
  rock: 'raffinage de la pierre',
};

/** Piste de progression d'une recette, ou null si les données ne couvrent pas sa famille. */
export function levelingTrackFor(recipe: Pick<Recipe, 'kind' | 'bonusKey'>): LevelingTrack | null {
  if (recipe.kind === 'refining') {
    const r = REFINING_RESOURCES.find((x) => x === recipe.bonusKey);
    return r ? { kind: 'refining', resource: r, label: RES_LABEL[r] } : null;
  }
  for (const [family, d] of Object.entries(CRAFT_FAMILIES) as [CraftFamily, CraftFamilyData][]) {
    if (d.bonusKey === recipe.bonusKey) return { kind: 'crafting', family, label: `craft des ${d.label}` };
  }
  return null;
}

const clampTier = (t: number) => Math.min(MAX_TIER, Math.max(MIN_TIER, Math.round(t)));

/** Renommée cumulée depuis zéro pour débloquer `tier`. */
export function unlockFame(track: LevelingTrack, tier: number): number {
  const t = clampTier(tier);
  return track.kind === 'refining' ? REFINING_UNLOCK_FAME[t] : CRAFT_FAMILIES[track.family].unlockFame[t];
}

/** Renommée à gagner pour passer de `fromTier` (déjà débloqué, 2 = depuis zéro) à `targetTier`. */
export function fameRequired(track: LevelingTrack, targetTier: number, fromTier = MIN_TIER): number {
  return Math.max(0, unlockFame(track, targetTier) - unlockFame(track, fromTier));
}

/** Renommée de raffinage par unité (null si tier/enchantement inconnu). */
export function refiningFamePerUnit(tier: number, enchant = 0): number | null {
  return REFINING_FAME_PER_UNIT[tier]?.[enchant] ?? null;
}

/** Renommée de craft d'un objet (formule communautaire, T4+ seulement ; null sinon). */
export function craftFamePerUnit(recipe: Pick<Recipe, 'tier' | 'enchant' | 'inputs'>): number | null {
  const m = CRAFT_FAME_TIER_MULT[recipe.tier];
  if (m == null) return null;
  let a = 0;
  let artifact = false;
  for (const i of recipe.inputs) {
    if (i.returnable) a += i.qty;
    else artifact = true;
  }
  if (a <= 0) return null;
  const f0 = a * m + (artifact ? CRAFT_ARTIFACT_FAME : 0);
  const e = recipe.enchant ?? 0;
  return f0 + e * (f0 - 7.5 * a);
}

/** Économie unitaire d'une recette aux prix du moment : coût et revenu net (la perte peut être négative = gain). */
export interface UnitEconomics {
  unitCost: number;
  unitRevenue: number;
}

export interface JournalPrices {
  /** Revenu net de la vente d'un journal plein. */
  full: number;
  /** Prix d'achat d'un journal vide. */
  empty: number;
}

export interface LevelingStep {
  /** Tier débloqué à la fin de l'étape. */
  toTier: number;
  /** Tier produit pendant l'étape (le plus haut déjà débloqué). */
  produceTier: number;
  fame: number;
  recipe: Recipe | null;
  famePerUnit: number | null;
  units: number | null;
  /** Perte nette par unité (coût − revenu net) ; négative = gain. */
  unitLoss: number | null;
  journalGainPerUnit: number;
  cost: number | null;
  note: string | null;
}

export interface LevelingEstimate {
  track: LevelingTrack;
  fromTier: number;
  targetTier: number;
  fame: number;
  steps: LevelingStep[];
  totalUnits: number;
  /** Somme des étapes chiffrées (négatif = la montée rapporte). */
  totalCost: number;
  /** Faux si au moins une étape n'a pas pu être chiffrée. */
  complete: boolean;
  premiumMultiplier: number;
}

export interface LevelingParams {
  track: LevelingTrack;
  recipes: readonly Recipe[];
  targetTier: number;
  /** Tier le plus haut déjà débloqué (2 = depuis zéro). */
  fromTier?: number;
  premiumFame: boolean;
  premiumBonus?: number;
  economics: (r: Recipe) => UnitEconomics | null;
  journal?: (tier: number) => JournalPrices | null;
  /** ID de l'objet visé : à tier égal, sa version au tier produit est préférée si elle est chiffrable. */
  preferOutputId?: string;
}

const baseId = (id: string) => id.replace(/^T\d_/, '').replace(/@\d+$/, '').replace(/_LEVEL\d+$/, '');

/** Estime le coût de montée de `fromTier` à `targetTier` en produisant toujours au tier le plus haut débloqué. */
export function estimateLeveling(p: LevelingParams): LevelingEstimate {
  const from = clampTier(p.fromTier ?? MIN_TIER);
  const target = clampTier(p.targetTier);
  const mult = p.premiumFame ? 1 + (p.premiumBonus ?? DEFAULT_PREMIUM_FAME_BONUS) : 1;
  const steps: LevelingStep[] = [];
  const track = p.track;
  const bonusKey = track.kind === 'refining' ? track.resource : CRAFT_FAMILIES[track.family].bonusKey;
  const kind = track.kind;
  const preferBase = p.preferOutputId ? baseId(p.preferOutputId) : null;

  for (let t = from; t < target; t++) {
    const fame = unlockFame(track, t + 1) - unlockFame(track, t);
    const candidates = p.recipes.filter(
      (r) => r.kind === kind && r.bonusKey === bonusKey && r.tier === t && (r.enchant ?? 0) === 0 && !r.variant,
    );
    let best: { r: Recipe; fpu: number; loss: number; jg: number; perFame: number } | null = null;
    let fameKnown = false;
    for (const r of candidates) {
      const fpu0 = kind === 'refining' ? refiningFamePerUnit(t, 0) : craftFamePerUnit(r);
      if (fpu0 == null) continue;
      fameKnown = true;
      const eco = p.economics(r);
      if (!eco) continue;
      let jg = 0;
      if (kind === 'crafting' && JOURNAL_MAX_FAME[t] && p.journal) {
        const j = p.journal(t);
        if (j && j.full > j.empty) jg = (fpu0 / JOURNAL_MAX_FAME[t]) * (j.full - j.empty);
      }
      const loss = eco.unitCost - eco.unitRevenue;
      const fpu = fpu0 * mult;
      const perFame = (loss - jg) / fpu;
      const preferred = preferBase != null && baseId(r.outputId) === preferBase;
      if (!best || perFame < best.perFame - 1e-9 || (preferred && Math.abs(perFame - best.perFame) <= 1e-9)) {
        best = { r, fpu, loss, jg, perFame };
      }
    }
    if (best) {
      const units = Math.ceil(fame / best.fpu);
      steps.push({
        toTier: t + 1,
        produceTier: t,
        fame,
        recipe: best.r,
        famePerUnit: best.fpu,
        units,
        unitLoss: best.loss,
        journalGainPerUnit: best.jg,
        cost: units * (best.loss - best.jg),
        note: null,
      });
    } else {
      const fpu = kind === 'refining' ? refiningFamePerUnit(t, 0) : null;
      steps.push({
        toTier: t + 1,
        produceTier: t,
        fame,
        recipe: candidates[0] ?? null,
        famePerUnit: fpu != null ? fpu * mult : null,
        units: fpu != null ? Math.ceil(fame / (fpu * mult)) : null,
        unitLoss: null,
        journalGainPerUnit: 0,
        cost: null,
        note:
          candidates.length === 0
            ? `Aucune recette T${t} de cette famille dans les données.`
            : !fameKnown
              ? `Renommée par objet T${t} inconnue (formule testée T4+ seulement).`
              : `Prix manquants pour produire en T${t}.`,
      });
    }
  }
  const totalUnits = steps.reduce((s, x) => s + (x.units ?? 0), 0);
  const totalCost = steps.reduce((s, x) => s + (x.cost ?? 0), 0);
  return {
    track,
    fromTier: from,
    targetTier: target,
    fame: fameRequired(track, target, from),
    steps,
    totalUnits,
    totalCost,
    complete: steps.every((s) => s.cost != null),
    premiumMultiplier: mult,
  };
}
