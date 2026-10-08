// Cycle volumes : historique journalier (J-8 → aujourd'hui) → médiane 7 jours complets.
// Usage : pnpm collect:volumes [--prev <dossier>] [--out out] [--recipes chemin]
import { join } from 'node:path';
import {
  AodpClient,
  computeVolumes,
  historyBatches,
  historyUrl,
  runBatches,
  successRatioOk,
  utcDay,
  type ItemVolumes,
  type RawHistoryRow,
} from './aodp';
import { isMain, loadIds, parseArgs, readJson, writeJson } from './cli';

export const VOLUMES_FILE = 'volumes-latest.json';

export interface VolumesFile {
  startedAt: string;
  updatedAt: string;
  fromDate: string; // paramètre date= envoyé (J-8)
  okBatches: number;
  totalBatches: number;
  failedIds: string[];
  items: Record<string, ItemVolumes>;
}

export interface VolumesRunResult {
  ok: boolean;
  file: VolumesFile;
  durationMs: number;
}

const EMPTY: ItemVolumes = { volume7d: {}, avgPrice7d: {}, historyDays: {} };

export async function collectVolumes(
  ids: string[],
  client: AodpClient,
  prev: VolumesFile | null = null,
): Promise<VolumesRunResult> {
  const t0 = client.now();
  const fromDate = utcDay(t0, -8);
  const batches = historyBatches(ids, fromDate, client.baseUrl);
  client.log(`Volumes : ${ids.length} ID en ${batches.length} lots (date=${fromDate})`);
  const run = await runBatches<RawHistoryRow>(client, batches, (b) => historyUrl(b, fromDate, client.baseUrl));
  const vols = computeVolumes(run.results, t0);

  const items: Record<string, ItemVolumes> = {};
  const failed = new Set(run.failedIds);
  for (const id of ids) {
    const v = vols.get(id);
    if (v) items[id] = v;
    else if (failed.has(id) && prev?.items[id]) items[id] = prev.items[id];
    else items[id] = { ...EMPTY };
  }
  const t1 = client.now();
  return {
    ok: successRatioOk(run.okBatches, run.totalBatches),
    durationMs: t1 - t0,
    file: {
      startedAt: new Date(t0).toISOString(),
      updatedAt: new Date(t1).toISOString(),
      fromDate,
      okBatches: run.okBatches,
      totalBatches: run.totalBatches,
      failedIds: run.failedIds,
      items,
    },
  };
}

export async function main(argv = process.argv.slice(2), client = new AodpClient()): Promise<number> {
  const args = parseArgs(argv);
  const ids = loadIds(args);
  const prev = args.prev ? readJson<VolumesFile>(join(args.prev, VOLUMES_FILE)) : null;
  const res = await collectVolumes(ids, client, prev);
  const s = client.stats();
  console.log(
    `Volumes : ${s.requests} requêtes (${s.retries} retries), max ${s.maxPerMinute} req/min, ` +
      `lots OK ${res.file.okBatches}/${res.file.totalBatches}, ${res.file.failedIds.length} ID en échec, ` +
      `durée ${(res.durationMs / 1000).toFixed(1)} s`,
  );
  if (!res.ok) {
    console.error('Moins de 90 % des lots ont réussi : volumes NON écrits (les précédents sont conservés).');
    return 1;
  }
  writeJson(join(args.out, VOLUMES_FILE), res.file);
  console.log(`Écrit ${join(args.out, VOLUMES_FILE)}`);
  return 0;
}

if (isMain(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
