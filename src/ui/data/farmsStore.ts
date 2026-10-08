// État de la page « Fermes » (îles, focus, spécialisations, hypothèses) sauvegardé en localStorage.
import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_FARM_ASSUMPTIONS, type FarmAssumptions, type PlannerIsland, type PlannerPlot, type PlotType } from '../../engine/farming';
import { LOCATIONS, PRODUCTION_LOCATIONS, type Location } from '../../types';
import type { KeyValueStorage } from './routesStore';

export const FARMS_KEY = 'ami.farms.v1';
export const MAX_ISLANDS = 20;
export const MAX_PLOTS = 30;

export interface FarmsState {
  v: 1;
  islands: PlannerIsland[];
  focusPerDay: number;
  specs: Record<string, number>;
  assumptions: FarmAssumptions;
  sellAt: Location | 'auto';
  foodSource: 'market' | 'island';
}

let seq = 0;
export function farmId(prefix: string): string {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function makePlots(counts: Partial<Record<PlotType, number>>): PlannerPlot[] {
  const out: PlannerPlot[] = [];
  for (const type of ['ferme', 'jardin', 'pâturage'] as PlotType[]) {
    for (let i = 0; i < (counts[type] ?? 0); i++) out.push({ id: farmId('p'), type, activity: 'auto' });
  }
  return out;
}

/** Préréglage : 1 île à Lymhurst, 4 parcelles (2 fermes, 1 jardin, 1 pâturage), 10 000 focus. */
export function presetState(): FarmsState {
  return {
    v: 1,
    islands: [{ id: farmId('i'), name: 'Île de Lymhurst', city: 'Lymhurst', plots: makePlots({ ferme: 2, jardin: 1, pâturage: 1 }) }],
    focusPerDay: 10000,
    specs: {},
    assumptions: { ...DEFAULT_FARM_ASSUMPTIONS },
    sellAt: 'auto',
    foodSource: 'market',
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const PLOT_TYPES = new Set<string>(['ferme', 'jardin', 'pâturage']);
const CITY_SET = new Set<string>(PRODUCTION_LOCATIONS);
const SELL_SET = new Set<string>(LOCATIONS.filter((l) => l !== 'Black Market'));
const clampNum = (v: unknown, lo: number, hi: number, def: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;

/** Valide et complète un état lu (valeurs invalides → défauts). */
export function sanitizeFarms(raw: unknown): FarmsState {
  const def = presetState();
  if (!isObj(raw) || raw.v !== 1) return def;
  const islands: PlannerIsland[] = [];
  if (Array.isArray(raw.islands)) {
    for (const i of raw.islands.slice(0, MAX_ISLANDS)) {
      if (!isObj(i)) continue;
      const plots: PlannerPlot[] = [];
      if (Array.isArray(i.plots)) {
        for (const p of i.plots.slice(0, MAX_PLOTS)) {
          if (!isObj(p) || typeof p.type !== 'string' || !PLOT_TYPES.has(p.type)) continue;
          plots.push({
            id: typeof p.id === 'string' && p.id ? p.id : farmId('p'),
            type: p.type as PlotType,
            activity: typeof p.activity === 'string' && p.activity ? p.activity : 'auto',
          });
        }
      }
      islands.push({
        id: typeof i.id === 'string' && i.id ? i.id : farmId('i'),
        name: typeof i.name === 'string' ? i.name.slice(0, 60) : 'Île',
        city: typeof i.city === 'string' && CITY_SET.has(i.city) ? (i.city as PlannerIsland['city']) : 'Lymhurst',
        plots,
      });
    }
  }
  const specs: Record<string, number> = {};
  if (isObj(raw.specs)) {
    for (const [k, v] of Object.entries(raw.specs)) if (typeof v === 'number' && Number.isFinite(v)) specs[k] = clampNum(v, 0, 100, 0);
  }
  const a = isObj(raw.assumptions) ? raw.assumptions : {};
  const D = DEFAULT_FARM_ASSUMPTIONS;
  return {
    v: 1,
    islands: Array.isArray(raw.islands) ? islands : def.islands,
    focusPerDay: clampNum(raw.focusPerDay, 0, 1e7, def.focusPerDay),
    specs,
    assumptions: {
      slotsPerPlot: clampNum(a.slotsPerPlot, 1, 100, D.slotsPerPlot),
      premiumYieldMultiplier: clampNum(a.premiumYieldMultiplier, 0, 10, D.premiumYieldMultiplier),
      premiumGrowthMultiplier: clampNum(a.premiumGrowthMultiplier, 0.05, 10, D.premiumGrowthMultiplier),
      premiumProductMultiplier: clampNum(a.premiumProductMultiplier, 0, 10, D.premiumProductMultiplier),
      focusHalvingsAtMaxSpec: clampNum(a.focusHalvingsAtMaxSpec, 0, 10, D.focusHalvingsAtMaxSpec),
      cropCyclesPerDay: clampNum(a.cropCyclesPerDay, 0.01, 24, D.cropCyclesPerDay),
      maxVolumeShare: clampNum(a.maxVolumeShare, 0, 1, D.maxVolumeShare),
    },
    sellAt: typeof raw.sellAt === 'string' && SELL_SET.has(raw.sellAt) ? (raw.sellAt as Location) : 'auto',
    foodSource: raw.foodSource === 'island' ? 'island' : 'market',
  };
}

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadFarms(storage: KeyValueStorage | null = defaultStorage()): FarmsState {
  if (!storage) return presetState();
  try {
    const txt = storage.getItem(FARMS_KEY);
    return txt ? sanitizeFarms(JSON.parse(txt)) : presetState();
  } catch {
    return presetState();
  }
}

export function saveFarms(state: FarmsState, storage: KeyValueStorage | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(FARMS_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export interface UseFarms {
  state: FarmsState;
  update: (fn: (s: FarmsState) => FarmsState) => void;
  reset: () => void;
  /** false si le stockage du navigateur a refusé la dernière écriture. */
  saved: boolean;
}

/** État persistant (sauvegarde automatique à chaque modification). */
export function useFarms(): UseFarms {
  const [state, setState] = useState<FarmsState>(() => loadFarms());
  const [saved, setSaved] = useState(true);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSaved(saveFarms(state));
  }, [state]);
  const update = useCallback((fn: (s: FarmsState) => FarmsState) => setState((s) => fn(s)), []);
  const reset = useCallback(() => setState(presetState()), []);
  return { state, update, reset, saved };
}
