// Panneau de détail : calcul pas à pas d'une activité.
import type { ItemMeta, Location } from '../../../types';
import type { FarmEval, FarmFlow } from '../../../engine/farming';
import { fmtAgeH, fmtInt, fmtSilver } from '../../format';
import { LocChip } from '../Route';
import { ItemIcon } from '../ItemIcon';
import { FarmFlags, activityLabel, nameOf, subjectName } from './shared';

function Place({ loc }: { loc: FarmFlow['loc'] }) {
  if (loc === 'npc') return <span className="farm-npc">PNJ</span>;
  if (loc === 'island') return <span className="farm-npc">Île</span>;
  return <LocChip loc={loc as Location} />;
}

function Flows({ title, flows, metaById }: { title: string; flows: FarmFlow[]; metaById: Map<string, ItemMeta> }) {
  if (!flows.length) return null;
  return (
    <div className="farm-flows">
      <h4>{title}</h4>
      <ul>
        {flows.map((f) => (
          <li key={`${f.id}-${f.loc}`}>
            <span className="qty">{fmtInt(Math.round(f.qty * 10) / 10)}</span> {nameOf(metaById, f.id)} <Place loc={f.loc} />{' '}
            <span className="muted">à {fmtSilver(f.unitPrice)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FarmDetail({ e, metaById, onClose }: { e: FarmEval; metaById: Map<string, ItemMeta>; onClose: () => void }) {
  const name = subjectName(e, metaById);
  return (
    <aside className="farm-detail" aria-labelledby="farm-detail-title">
      <header className="farm-detail-head">
        <ItemIcon id={e.mainId} name={name} size={40} />
        <div>
          <h3 id="farm-detail-title">{name}</h3>
          <p className="muted">
            {activityLabel(e)} · T{e.tier}
            {e.cityBonus > 0 && ` · bonus de ville +${Math.round(e.cityBonus * 100)} %`}
          </p>
        </div>
        <button type="button" className="btn-ghost farm-close" onClick={onClose} aria-label="Fermer le détail">
          ✕
        </button>
      </header>
      {!e.ok ? (
        <p className="farm-missing">
          Données manquantes : pas de prix valide pour {e.missing.map((id) => nameOf(metaById, id)).join(', ')}. Le profit n’est pas
          calculé (jamais compté à 0).
        </p>
      ) : (
        <>
          <ol className="steps">
            {e.steps.map((s, i) => (
              <li key={i}>
                <h3>{s.label}</h3>
                <p>
                  {s.formula} = <strong>{s.value}</strong>
                </p>
              </li>
            ))}
          </ol>
          <div className="farm-flows-grid">
            <Flows title="Achats par parcelle et par jour" flows={e.buys} metaById={metaById} />
            <Flows title="Ventes par parcelle et par jour" flows={e.sells} metaById={metaById} />
          </div>
          <p className="muted">
            Âge du prix le plus vieux : {fmtAgeH(e.oldestPriceAgeH)} · volume 7 j au lieu de vente : {fmtInt(e.volume7d)}
          </p>
        </>
      )}
      <FarmFlags flags={e.flags} />
    </aside>
  );
}
