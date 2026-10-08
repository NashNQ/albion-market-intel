import type { ChainResult, ChainWarning } from '../../../engine/chain-index';
import { fmt1, fmtAgeH, fmtPct } from '../../format';
import { Loc, Money } from './ui';

const TONE: Partial<Record<ChainWarning['kind'], 'danger' | 'warn' | 'info'>> = {
  'missing-price': 'danger',
  'stale-price': 'danger',
  'missing-sell': 'danger',
  'stale-sell': 'danger',
  'unknown-recipe': 'danger',
  'invalid-link': 'warn',
  'red-zone': 'danger',
  'manual-price': 'info',
  'estimated-price': 'warn',
  mists: 'info',
};

export function Warnings({ warnings }: { warnings: ChainWarning[] }) {
  if (warnings.length === 0) return <p className="muted rb-small">Aucun avertissement.</p>;
  return (
    <ul className="rb-warnings">
      {warnings.map((w, i) => (
        <li key={i} className={`rb-warn rb-warn-${TONE[w.kind] ?? 'warn'}`}>
          {w.message}
        </li>
      ))}
    </ul>
  );
}

export function Summary({ result }: { result: ChainResult }) {
  return (
    <section className="rb-summary" aria-labelledby="rb-summary-title">
      <h2 id="rb-summary-title">Résumé</h2>
      {!result.complete && result.steps.length > 0 && (
        <p className="rb-incomplete" role="status">
          Route incomplète : certains prix manquent, le total est calculé sans eux.
        </p>
      )}
      <dl className="rb-totals">
        <div>
          <dt>Quantité vendue</dt>
          <dd>
            {fmt1(result.finalQty)}
            <span className="rb-small muted"> · {fmt1(result.startCrafts)} crafts au départ</span>
          </dd>
        </div>
        <div>
          <dt>Lieu de vente</dt>
          <dd>
            <Loc loc={result.sellAt} />
          </dd>
        </div>
        <div>
          <dt>Revenu net</dt>
          <dd>
            <Money v={result.revenue} />
          </dd>
        </div>
        <div>
          <dt>Achats</dt>
          <dd>
            <Money v={result.buyTotal} />
          </dd>
        </div>
        <div>
          <dt>Frais de station</dt>
          <dd>
            <Money v={result.feeTotal} />
          </dd>
        </div>
        <div className="rb-total-main">
          <dt>Profit total</dt>
          <dd data-testid="rb-profit-total">
            <Money v={result.profit} signed />
          </dd>
        </div>
        <div>
          <dt>Profit par unité finale</dt>
          <dd>
            <Money v={result.profitPerUnit} signed />
          </dd>
        </div>
        <div>
          <dt>Marge</dt>
          <dd>{fmtPct(result.margin)}</dd>
        </div>
        <div>
          <dt>Prix le plus ancien</dt>
          <dd>{fmtAgeH(result.maxPriceAgeH)}</dd>
        </div>
      </dl>
      <h3>Avertissements</h3>
      <Warnings warnings={result.warnings} />
    </section>
  );
}
