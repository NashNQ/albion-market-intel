// Éléments partagés de la page « Fermes ».
import type { ItemMeta } from '../../../types';
import { FARM_FLAG_LABEL, STRATEGY_LABEL, type FarmEval, type FarmFlag } from '../../../engine/farming';

export const nameOf = (metaById: Map<string, ItemMeta>, id: string): string => metaById.get(id)?.nameFr ?? id;

/** Nom de l'élément cultivé (récolte ou animal adulte). */
export function subjectName(e: Pick<FarmEval, 'kind' | 'sourceId' | 'mainId' | 'strategy'>, metaById: Map<string, ItemMeta>): string {
  if (e.kind !== 'animal') return nameOf(metaById, e.mainId);
  // Petit → adulte : T3_FARM_CHICKEN_BABY → T3_FARM_CHICKEN_GROWN
  return nameOf(metaById, e.sourceId.replace(/_BABY$/, '_GROWN'));
}

/** Libellé de l'activité : « Herbe · arrosée », « Élever et abattre · soigné »… */
export function activityLabel(e: Pick<FarmEval, 'kind' | 'strategy' | 'focused'>): string {
  if (e.kind === 'animal') {
    const s = STRATEGY_LABEL[e.strategy!];
    return e.strategy === 'produce' ? s : `${s} · ${e.focused ? 'soigné' : 'sans soin'}`;
  }
  return `${e.kind === 'crop' ? 'Culture' : 'Herbe'} · ${e.focused ? 'arrosée' : 'non arrosée'}`;
}

/** Nom court d'une activité (ID d'activité sans arrosage). */
export function activityName(activityId: string, metaById: Map<string, ItemMeta>, cropOf: (seedId: string) => string | undefined): string {
  const [type, id, strat] = activityId.split(':');
  if (type === 'crop') return nameOf(metaById, cropOf(id) ?? id);
  return `${nameOf(metaById, id.replace(/_BABY$/, '_GROWN'))} — ${STRATEGY_LABEL[strat as keyof typeof STRATEGY_LABEL] ?? strat}`;
}

const FLAG_CLASS: Record<FarmFlag, string> = {
  missing: 'flag-red-zone',
  estimated: 'flag-estimated',
  'low-volume': 'flag-thin-history',
  'red-zone': 'flag-red-zone',
  mists: 'flag-mists',
  'surplus-unpriced': 'flag-suspect',
};

export function FarmFlags({ flags }: { flags: FarmFlag[] }) {
  if (!flags.length) return null;
  return (
    <span className="flags">
      {flags.map((f) => (
        <span key={f} className={`flag ${FLAG_CLASS[f]}`} title={FARM_FLAG_LABEL[f].long}>
          {FARM_FLAG_LABEL[f].short}
        </span>
      ))}
    </span>
  );
}
