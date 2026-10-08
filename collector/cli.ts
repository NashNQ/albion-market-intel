// Utilitaires partagés par les points d'entrée CLI du collecteur (aucun secret).
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RecipesFile } from '../src/types';
import { collectIds } from './ids-perimeter';

export interface CliArgs {
  prev: string | null;
  out: string;
  recipes: string | null;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { prev: null, out: 'out', recipes: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--prev') args.prev = next() ?? null;
    else if (a.startsWith('--prev=')) args.prev = a.slice(7);
    else if (a === '--out') args.out = next() ?? 'out';
    else if (a.startsWith('--out=')) args.out = a.slice(6);
    else if (a === '--recipes') args.recipes = next() ?? null;
    else if (a.startsWith('--recipes=')) args.recipes = a.slice(10);
  }
  return args;
}

export function readJson<T>(path: string): T | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch (e) {
    console.warn(`Lecture impossible de ${path} : ${(e as Error).message}`);
    return null;
  }
}

/** Écriture atomique (fichier temporaire puis renommage). */
export function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data));
  renameSync(tmp, path);
}

/** Cherche un fichier dans out/ puis dans prev/. */
export function findFile(name: string, outDir: string, prevDir: string | null): string | null {
  const candidates = [join(outDir, name), ...(prevDir ? [join(prevDir, name)] : [])];
  return candidates.find((p) => existsSync(p)) ?? null;
}

/** Charge la liste d'ID depuis recipes.json (--recipes, sinon out/, sinon prev/). */
export function loadIds(args: CliArgs): string[] {
  const path = args.recipes ?? findFile('recipes.json', args.out, args.prev);
  if (!path) throw new Error('recipes.json introuvable (out/ ou --prev). Lancer d\'abord pnpm collect:recipes.');
  const rf = readJson<RecipesFile>(path);
  if (!rf) throw new Error(`recipes.json illisible : ${path}`);
  const ids = collectIds(rf);
  if (ids.length === 0) throw new Error(`Aucun ID dans ${path}`);
  return ids;
}

export function isMain(metaUrl: string): boolean {
  const entry = process.argv[1];
  return !!entry && metaUrl === pathToFileURL(resolve(entry)).href;
}
