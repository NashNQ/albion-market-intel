// Fusion prix + volumes → out/market.json (MarketSnapshot). Aucun secret : simples fichiers.
// Usage : tsx collector/store.ts [--prev <dossier>] [--out out]
// Sources : out/prices-latest.json sinon prev/ ; out/volumes-latest.json sinon prev/ (cycle prix seul).
// Copie aussi recipes.json / prices / volumes de prev/ vers out/ s'ils manquent, pour publier les 4 fichiers.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { MarketItem, MarketSnapshot } from '../src/types';
import { isMain, parseArgs, readJson, writeJson } from './cli';
import { PRICES_FILE, type PricesFile } from './prices';
import { VOLUMES_FILE, type VolumesFile } from './volumes';

export const MARKET_FILE = 'market.json';
export const RECIPES_FILE = 'recipes.json';
export const PUBLISHED_FILES = [MARKET_FILE, RECIPES_FILE, VOLUMES_FILE, PRICES_FILE] as const;

export function buildSnapshot(prices: PricesFile | null, volumes: VolumesFile | null): MarketSnapshot {
  if (!prices) throw new Error('Aucun fichier de prix (courant ou précédent) : impossible de construire market.json');
  const ids = new Set<string>(Object.keys(prices.items));
  const items: MarketItem[] = [...ids].sort().map((id) => {
    const v = volumes?.items[id];
    return {
      id,
      prices: prices.items[id] ?? {},
      volume7d: v?.volume7d ?? {},
      avgPrice7d: v?.avgPrice7d ?? {},
      historyDays: v?.historyDays ?? {},
    };
  });
  return {
    updatedAt: prices.updatedAt,
    volumesUpdatedAt: volumes?.updatedAt ?? null,
    items,
  };
}

function pick<T>(name: string, outDir: string, prevDir: string | null): T | null {
  const cur = readJson<T>(join(outDir, name));
  if (cur) return cur;
  return prevDir ? readJson<T>(join(prevDir, name)) : null;
}

export function mergeStore(outDir: string, prevDir: string | null): MarketSnapshot {
  mkdirSync(outDir, { recursive: true });
  const prices = pick<PricesFile>(PRICES_FILE, outDir, prevDir);
  const volumes = pick<VolumesFile>(VOLUMES_FILE, outDir, prevDir);
  const snap = buildSnapshot(prices, volumes);
  writeJson(join(outDir, MARKET_FILE), snap);
  // Compléter out/ avec les fichiers non régénérés ce cycle (recettes, volumes précédents…)
  if (prevDir) {
    for (const f of [RECIPES_FILE, VOLUMES_FILE, PRICES_FILE]) {
      const dst = join(outDir, f);
      const src = join(prevDir, f);
      if (!existsSync(dst) && existsSync(src)) copyFileSync(src, dst);
    }
  }
  return snap;
}

export function main(argv = process.argv.slice(2)): number {
  const args = parseArgs(argv);
  const snap = mergeStore(args.out, args.prev);
  console.log(
    `market.json : ${snap.items.length} items, updatedAt=${snap.updatedAt}, volumesUpdatedAt=${snap.volumesUpdatedAt}`,
  );
  return 0;
}

if (isMain(import.meta.url)) {
  try {
    process.exit(main());
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
