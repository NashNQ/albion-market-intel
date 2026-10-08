// Cycle prix : collecte des prix actuels (qualité 1) pour tout le périmètre → out/prices-latest.json
// Usage : pnpm collect:prices [--prev <dossier>] [--out out] [--recipes chemin]
import { join } from 'node:path';
import {
  AodpClient,
  MAX_URL_LENGTH,
  parsePrices,
  priceBatches,
  pricesUrl,
  runBatches,
  successRatioOk,
  type ItemPrices,
  type RawPriceRow,
} from './aodp';
import { isMain, loadIds, parseArgs, readJson, writeJson } from './cli';

export const PRICES_FILE = 'prices-latest.json';

export interface PricesFile {
  startedAt: string;
  updatedAt: string; // fin du cycle prix
  okBatches: number;
  totalBatches: number;
  failedIds: string[];
  items: Record<string, ItemPrices>;
}

export interface PricesRunResult {
  ok: boolean; // false si < 90 % des lots ont réussi
  file: PricesFile;
  durationMs: number;
}

export async function collectPrices(
  ids: string[],
  client: AodpClient,
  prev: PricesFile | null = null,
  maxUrlLength = MAX_URL_LENGTH,
): Promise<PricesRunResult> {
  const t0 = client.now();
  const batches = priceBatches(ids, client.baseUrl, maxUrlLength);
  client.log(`Prix : ${ids.length} ID en ${batches.length} lots`);
  const run = await runBatches<RawPriceRow>(client, batches, (b) => pricesUrl(b, client.baseUrl));
  const parsed = parsePrices(run.results);

  const items: Record<string, ItemPrices> = {};
  const failed = new Set(run.failedIds);
  for (const id of ids) {
    const fresh = parsed.get(id);
    if (fresh) items[id] = fresh;
    else if (failed.has(id) && prev?.items[id]) items[id] = prev.items[id]; // lot en échec : on garde l'ancien
    else items[id] = {};
  }
  const t1 = client.now();
  const file: PricesFile = {
    startedAt: new Date(t0).toISOString(),
    updatedAt: new Date(t1).toISOString(),
    okBatches: run.okBatches,
    totalBatches: run.totalBatches,
    failedIds: run.failedIds,
    items,
  };
  return { ok: successRatioOk(run.okBatches, run.totalBatches), file, durationMs: t1 - t0 };
}

export async function main(argv = process.argv.slice(2), client = new AodpClient()): Promise<number> {
  const args = parseArgs(argv);
  const ids = loadIds(args);
  const prev = args.prev ? readJson<PricesFile>(join(args.prev, PRICES_FILE)) : null;
  const res = await collectPrices(ids, client, prev);
  const s = client.stats();
  console.log(
    `Prix : ${s.requests} requêtes (${s.retries} retries), max ${s.maxPerMinute} req/min, ` +
      `lots OK ${res.file.okBatches}/${res.file.totalBatches}, ${res.file.failedIds.length} ID en échec, ` +
      `durée ${(res.durationMs / 1000).toFixed(1)} s`,
  );
  if (!res.ok) {
    console.error('Moins de 90 % des lots ont réussi : prix NON écrits (les précédents sont conservés).');
    return 1;
  }
  writeJson(join(args.out, PRICES_FILE), res.file);
  console.log(`Écrit ${join(args.out, PRICES_FILE)}`);
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
