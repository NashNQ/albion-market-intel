// Sauvegarde des données de guilde : un fichier JSON (investissements + prêts + réglages, horodaté).
// Tout est stocké dans le navigateur : ce fichier est le moyen de transmettre les données d'un officier à l'autre.
// L'import est strict : format reconnu, taille et nombre d'éléments bornés, chaque entrée revalidée par les
// fonctions de sanitisation des magasins ; une seule entrée invalide fait refuser tout le fichier.
import { MAX_INVESTMENTS, loadInvestments, sanitizeInvestment, saveInvestments, type SavedInvestment } from './investStore';
import { MAX_LOANS, loadLoans, reloadLoans, sanitizeLoan, saveLoans, type Loan } from './loansStore';
import { loadGuildSettings, reloadGuildSettings, sanitizeGuildSettings, saveGuildSettings, type GuildSettings } from './guildSettings';

export const BACKUP_KIND = 'albion-market-intel/guild-backup';
export const BACKUP_VERSION = 1;
/** Taille maximale acceptée d'un fichier importé (octets). */
export const MAX_BACKUP_BYTES = 1_000_000;

export interface GuildBackup {
  kind: typeof BACKUP_KIND;
  v: typeof BACKUP_VERSION;
  exportedAt: string;
  settings: GuildSettings;
  investments: SavedInvestment[];
  loans: Loan[];
}

export type BackupParse =
  | { ok: true; backup: GuildBackup; duplicates: number }
  | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function buildBackup(now = new Date()): GuildBackup {
  return {
    kind: BACKUP_KIND,
    v: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    settings: loadGuildSettings(),
    investments: loadInvestments(),
    loans: loadLoans(),
  };
}

/** Nom de fichier horodaté, sans caractère interdit : varwyn-donnees-2026-10-15-1432.json. */
export function backupFileName(guildName: string, now = new Date()): string {
  const slug =
    guildName
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'guilde';
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  return `${slug}-donnees-${stamp}.json`;
}

const FORMAT_ERR = 'Ce fichier n’est pas une sauvegarde de guilde Albion Market Intel.';

/** Lit et valide un fichier de sauvegarde. Ne lève jamais. */
export function parseBackup(text: string): BackupParse {
  if (typeof text !== 'string' || text.length === 0) return { ok: false, error: 'Fichier vide.' };
  if (text.length > MAX_BACKUP_BYTES) return { ok: false, error: 'Fichier trop volumineux (1 Mo au maximum).' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Fichier illisible : ce n’est pas du JSON valide.' };
  }
  if (!isObj(raw) || raw.kind !== BACKUP_KIND) return { ok: false, error: FORMAT_ERR };
  if (raw.v !== BACKUP_VERSION) return { ok: false, error: 'Version de sauvegarde inconnue : mettez le site à jour ou réexportez le fichier.' };
  if (!Array.isArray(raw.investments) || !Array.isArray(raw.loans) || !isObj(raw.settings)) return { ok: false, error: FORMAT_ERR };
  if (raw.investments.length > MAX_INVESTMENTS)
    return { ok: false, error: `Trop d’investissements (${raw.investments.length}) : ${MAX_INVESTMENTS} au maximum.` };
  if (raw.loans.length > MAX_LOANS) return { ok: false, error: `Trop de prêts (${raw.loans.length}) : ${MAX_LOANS} au maximum.` };

  let duplicates = 0;
  const investments: SavedInvestment[] = [];
  const invIds = new Set<string>();
  for (let i = 0; i < raw.investments.length; i++) {
    const r = raw.investments[i] as unknown;
    // L'identifiant doit venir du fichier : sinon chaque import créerait des doublons.
    if (!isObj(r) || typeof r.id !== 'string') return { ok: false, error: `Investissement n° ${i + 1} invalide : fichier refusé.` };
    const v = sanitizeInvestment(r);
    if (!v || v.id !== r.id) return { ok: false, error: `Investissement n° ${i + 1} invalide : fichier refusé.` };
    if (invIds.has(v.id)) {
      duplicates++;
      continue;
    }
    invIds.add(v.id);
    investments.push(v);
  }
  const loans: Loan[] = [];
  const loanIds = new Set<string>();
  for (let i = 0; i < raw.loans.length; i++) {
    const r = raw.loans[i] as unknown;
    if (!isObj(r) || typeof r.id !== 'string') return { ok: false, error: `Prêt n° ${i + 1} invalide : fichier refusé.` };
    const l = sanitizeLoan(r);
    if (!l || l.id !== r.id) return { ok: false, error: `Prêt n° ${i + 1} invalide : fichier refusé.` };
    if (loanIds.has(l.id)) {
      duplicates++;
      continue;
    }
    loanIds.add(l.id);
    loans.push(l);
  }
  const exportedAt = typeof raw.exportedAt === 'string' && !Number.isNaN(Date.parse(raw.exportedAt)) ? raw.exportedAt : '';
  return {
    ok: true,
    duplicates,
    backup: { kind: BACKUP_KIND, v: BACKUP_VERSION, exportedAt, settings: sanitizeGuildSettings(raw.settings), investments, loans },
  };
}

/** Remplace les données locales par celles de la sauvegarde. false si le stockage a refusé une écriture. */
export function applyBackup(b: GuildBackup): boolean {
  const okInv = saveInvestments(b.investments);
  const okLoans = saveLoans(b.loans);
  const okSettings = saveGuildSettings(b.settings);
  reloadLoans();
  reloadGuildSettings();
  return okInv && okLoans && okSettings;
}
