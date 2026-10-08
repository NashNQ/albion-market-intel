// Collecteur de recettes : ao-bin-dumps (items.json, formatted/items.json, craftingmodifiers.json)
// → out/recipes.json (type RecipesFile), JSON compact.
//
// Usage : pnpm tsx collector/recipes.ts [--local <dossier>] [--out <fichier>]
import { mkdir, readFile, writeFile, stat, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BonusTable, ItemMeta, Location, Recipe, RecipeInput, RecipesFile } from '../src/types';
import { parseApiId, refiningFamily, toApiId } from '../src/engine/ids';

const BASE_URL = 'https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master';

const CLUSTER_TO_LOCATION: Record<string, Location> = {
  '0000': 'Thetford',
  '1000': 'Lymhurst',
  '2000': 'Bridgewatch',
  '3004': 'Martlock',
  '4000': 'Fort Sterling',
  '3003': 'Caerleon',
  '5000': 'Brecilien',
};

type Raw = Record<string, any>;

function arr<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function num(v: unknown, def = 0): number {
  const n = Number(v);
  return v === undefined || v === null || v === '' || !Number.isFinite(n) ? def : n;
}

/** Niveau d'enchantement d'un uniquename : suffixe _LEVELn, sinon 0. */
function levelFromName(uniquename: string): number {
  const m = /_LEVEL(\d+)$/.exec(uniquename);
  return m ? Number(m[1]) : 0;
}

/** ID API d'une craftresource : @enchantmentlevel prioritaire, sinon suffixe _LEVELn. */
function resourceApiId(res: Raw): string {
  const name = String(res['@uniquename']);
  const lvlAttr = res['@enchantmentlevel'];
  const level = lvlAttr !== undefined ? num(lvlAttr) : levelFromName(name);
  return toApiId(name, level);
}

/** Première recette sans ingrédient FACTION (et avec au moins un ingrédient). */
function pickRequirement(reqs: unknown): Raw | null {
  for (const r of arr(reqs as Raw | Raw[])) {
    const res = arr(r?.craftresource as Raw | Raw[]);
    if (res.length === 0) continue;
    if (res.some((c) => String(c['@uniquename']).includes('FACTION'))) continue;
    return r;
  }
  return null;
}

export function buildRecipesFile(
  itemsJson: any,
  formattedJson: any,
  modifiersJson: any,
  generatedAt: string,
): RecipesFile {
  // --- Index de tous les items par uniquename ---
  const items = new Map<string, Raw>();
  const root: Raw = itemsJson?.items ?? {};
  for (const [key, val] of Object.entries(root)) {
    if (key.startsWith('@') || key === 'shopcategories') continue;
    for (const it of arr(val as Raw | Raw[])) {
      if (it && typeof it === 'object' && it['@uniquename']) items.set(it['@uniquename'], it);
    }
  }

  // --- Valeur d'item (@itemvalue, sinon somme des ingrédients, récursif) ---
  const valueMemo = new Map<string, number>();
  const baseValue = (uniquename: string, seen = new Set<string>()): number => {
    if (valueMemo.has(uniquename)) return valueMemo.get(uniquename)!;
    const it = items.get(uniquename);
    let v = 0;
    if (it) {
      if (it['@itemvalue'] !== undefined) v = num(it['@itemvalue']);
      else if (!seen.has(uniquename)) {
        seen.add(uniquename);
        const req = pickRequirement(it.craftingrequirements);
        if (req) v = requirementValue(req, seen);
      }
    }
    valueMemo.set(uniquename, v);
    return v;
  };
  const requirementValue = (req: Raw, seen = new Set<string>()): number => {
    let sum = 0;
    for (const c of arr(req.craftresource as Raw | Raw[])) {
      sum += baseValue(String(c['@uniquename']), seen) * num(c['@count'], 1);
    }
    return sum / Math.max(1, num(req['@amountcrafted'], 1));
  };

  const recipes = new Map<string, Recipe>();
  const toInputs = (req: Raw): RecipeInput[] =>
    arr(req.craftresource as Raw | Raw[]).map((c) => ({
      id: resourceApiId(c),
      qty: num(c['@count'], 1),
      returnable: String(c['@maxreturnamount'] ?? '') !== '0',
    }));

  // --- Raffinage : simpleitem raffinés T2–T8, @0–@4 ---
  for (const it of arr(root.simpleitem as Raw | Raw[])) {
    const name = String(it['@uniquename']);
    const family = refiningFamily(name);
    if (!family) continue;
    const tier = num(it['@tier']);
    const level = it['@enchantmentlevel'] !== undefined ? num(it['@enchantmentlevel']) : levelFromName(name);
    if (tier < 2 || tier > 8 || level < 0 || level > 4) continue;
    const req = pickRequirement(it.craftingrequirements);
    if (!req) continue;
    const outputId = toApiId(name, level);
    recipes.set(outputId, {
      outputId,
      outputQty: num(req['@amountcrafted'], 1),
      inputs: toInputs(req),
      itemValue: num(it['@itemvalue']) || requirementValue(req),
      kind: 'refining',
      bonusKey: family,
      category: String(it['@shopcategory'] ?? ''),
      subcategory: String(it['@shopsubcategory1'] ?? ''),
      tier,
      enchant: level,
    });
  }

  // --- Équipement : equipmentitem + weapon, T4–T8, @0–@3 ---
  for (const it of [...arr(root.equipmentitem as Raw | Raw[]), ...arr(root.weapon as Raw | Raw[])]) {
    const name = String(it['@uniquename']);
    const tier = num(it['@tier']);
    if (tier < 4 || tier > 8) continue;
    const common = {
      kind: 'crafting' as const,
      bonusKey: String(it['@craftingcategory'] ?? ''),
      category: String(it['@shopcategory'] ?? ''),
      subcategory: String(it['@shopsubcategory1'] ?? ''),
      tier,
    };
    const baseReq = pickRequirement(it.craftingrequirements);
    if (!baseReq) continue;
    const base = baseValue(name);
    recipes.set(name, {
      outputId: name,
      outputQty: num(baseReq['@amountcrafted'], 1),
      inputs: toInputs(baseReq),
      itemValue: base,
      ...common,
      enchant: 0,
    });
    for (const ench of arr(it.enchantments?.enchantment as Raw | Raw[])) {
      const level = num(ench['@enchantmentlevel']);
      if (level < 1 || level > 3) continue;
      const req = pickRequirement(ench.craftingrequirements);
      if (!req) continue;
      const outputId = toApiId(name, level);
      recipes.set(outputId, {
        outputId,
        outputQty: num(req['@amountcrafted'], 1),
        inputs: toInputs(req),
        // Hypothèse : sans @itemvalue sur l'enchantement, valeur de base × 2^niveau.
        itemValue: ench['@itemvalue'] !== undefined ? num(ench['@itemvalue']) : base * 2 ** level,
        ...common,
        enchant: level,
      });
    }
  }

  // --- Noms localisés ---
  const names = new Map<string, Raw | null>();
  for (const f of arr(formattedJson as Raw | Raw[])) {
    if (f && f.UniqueName) names.set(String(f.UniqueName), f.LocalizedNames ?? null);
  }

  // --- Méta : sorties + tous les ingrédients ---
  const metaIds = new Set<string>();
  for (const r of recipes.values()) {
    metaIds.add(r.outputId);
    for (const i of r.inputs) metaIds.add(i.id);
  }
  const meta: ItemMeta[] = [];
  for (const id of [...metaIds].sort()) {
    const { base, level } = parseApiId(id);
    const it = items.get(base);
    const loc = names.get(id) ?? null;
    const en = loc?.['EN-US'];
    const fr = loc?.['FR-FR'];
    const tierMatch = /^T(\d+)_/.exec(base);
    meta.push({
      id,
      nameFr: fr || en || id,
      nameEn: en || id,
      tier: it?.['@tier'] !== undefined ? num(it['@tier']) : tierMatch ? Number(tierMatch[1]) : 0,
      enchant: level,
      category: String(it?.['@shopcategory'] ?? ''),
      subcategory: String(it?.['@shopsubcategory1'] ?? ''),
    });
  }

  // --- Bonus de ville ---
  const bonuses: BonusTable = {};
  for (const loc of arr(modifiersJson?.craftingmodifiers?.craftinglocation as Raw | Raw[])) {
    const cid = loc?.['@clusterid'];
    if (cid === undefined) continue;
    const place = CLUSTER_TO_LOCATION[String(cid)];
    if (!place) continue;
    const modifiers: Record<string, number> = {};
    for (const m of arr(loc.craftingmodifier as Raw | Raw[])) {
      if (m?.['@name'] !== undefined) modifiers[String(m['@name'])] = num(m['@value']);
    }
    bonuses[place] = {
      refiningBase: num(loc.refiningbonus?.['@value']),
      craftingBase: num(loc.craftingbonus?.['@value']),
      modifiers,
    };
  }

  const recipeList = [...recipes.values()].sort((a, b) => (a.outputId < b.outputId ? -1 : a.outputId > b.outputId ? 1 : 0));
  return { generatedAt, recipes: recipeList, meta, bonuses };
}

// ---------------------------------------------------------------------------
// Script

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function loadLocal(dir: string) {
  const readJson = async (p: string) => JSON.parse(await readFile(p, 'utf8'));
  const formattedPath = (await exists(join(dir, 'items-formatted.json')))
    ? join(dir, 'items-formatted.json')
    : join(dir, 'formatted', 'items.json');
  return Promise.all([
    readJson(join(dir, 'items.json')),
    readJson(formattedPath),
    readJson(join(dir, 'craftingmodifiers.json')),
  ]);
}

async function loadRemote() {
  const get = async (path: string) => {
    const url = `${BASE_URL}/${path}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
    return res.json();
  };
  return Promise.all([get('items.json'), get('formatted/items.json'), get('craftingmodifiers.json')]);
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const localDir = opt('--local');
  const outPath = resolve(opt('--out') ?? 'out/recipes.json');

  const [itemsJson, formattedJson, modifiersJson] = localDir ? await loadLocal(localDir) : await loadRemote();
  const file = buildRecipesFile(itemsJson, formattedJson, modifiersJson, new Date().toISOString());

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(file));
  const size = (await stat(outPath)).size;

  const byKind: Record<string, number> = {};
  const byCat: Record<string, number> = {};
  for (const r of file.recipes) {
    byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    byCat[r.category] = (byCat[r.category] ?? 0) + 1;
  }
  const frCount = file.meta.filter((m) => m.nameFr !== m.id && m.nameFr !== m.nameEn).length;
  const frOrSame = file.meta.filter((m) => m.nameFr !== m.id).length;
  console.log(`Recettes : ${file.recipes.length}`);
  console.log('Par kind :', byKind);
  console.log('Par category :', byCat);
  console.log(`Méta : ${file.meta.length} items ; noms FR : ${((100 * frOrSame) / file.meta.length).toFixed(2)} % (dont ${frCount} distincts de l'anglais)`);
  const missing = file.meta.filter((m) => m.nameFr === m.id).map((m) => m.id);
  if (missing.length) console.log(`Sans nom (${missing.length}) :`, missing.slice(0, 20).join(', '));
  console.log('Bonus :', Object.keys(file.bonuses).join(', '));
  console.log(`Fichier : ${outPath} — ${(size / 1024 / 1024).toFixed(2)} Mo (${size} octets)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
