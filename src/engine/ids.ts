// Utilitaires d'identifiants Albion (ID API = uniquename[@niveau]).

export type RefiningFamily = 'wood' | 'ore' | 'hide' | 'fiber' | 'rock';

const REFINED_TO_FAMILY: Record<string, RefiningFamily> = {
  PLANKS: 'wood',
  METALBAR: 'ore',
  LEATHER: 'hide',
  CLOTH: 'fiber',
  STONEBLOCK: 'rock',
};

/** level 0 → uniquename tel quel ; sinon uniquename@level. */
export function toApiId(uniquename: string, level: number): string {
  return level > 0 ? `${uniquename}@${level}` : uniquename;
}

/** Sépare un ID API en {base, level}. "T4_BAG@1" → {base:"T4_BAG", level:1}. */
export function parseApiId(id: string): { base: string; level: number } {
  const at = id.lastIndexOf('@');
  if (at < 0) return { base: id, level: 0 };
  const level = Number(id.slice(at + 1));
  if (!Number.isInteger(level) || level < 0) return { base: id, level: 0 };
  return { base: id.slice(0, at), level };
}

/** Famille de raffinage d'un ID de ressource raffinée (T5_PLANKS_LEVEL1@1 → 'wood'), sinon null. */
export function refiningFamily(id: string): RefiningFamily | null {
  const { base } = parseApiId(id);
  const m = /^T\d+_(PLANKS|METALBAR|LEATHER|CLOTH|STONEBLOCK)(?:_LEVEL\d+)?$/.exec(base);
  return m ? REFINED_TO_FAMILY[m[1]] : null;
}
