// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Summary, isBlocked } from '../src/ui/components/route-builder/Summary';
import type { ChainResult } from '../src/engine/chain-index';

const base = {
  steps: [{}],
  finalQty: 100,
  startCrafts: 40,
  sellAt: 'Lymhurst',
  revenue: 0,
  buyTotal: 1_000_000,
  feeTotal: 500,
  profit: -1_000_500,
  profitPerUnit: -10_005,
  margin: -1,
  maxPriceAgeH: 2,
} as unknown as ChainResult;

describe('résumé d’une route avec prix manquants', () => {
  it('n’affiche pas de profit trompeur quand la vente manque', () => {
    const result = { ...base, complete: false, warnings: [{ kind: 'missing-sell', message: 'Aucun prix de vente' }] } as unknown as ChainResult;
    expect(isBlocked(result)).toBe(true);
    render(<Summary result={result} />);
    expect(screen.getByTestId('rb-profit-total').textContent).toBe('Indisponible');
    expect(screen.queryByText(/1\s000\s500/)).toBeNull();
    expect(screen.getByText(/Calcul incomplet/)).toBeTruthy();
  });

  it('affiche le profit quand tout est complet', () => {
    const result = { ...base, complete: true, revenue: 2_000_000, profit: 999_500, warnings: [] } as unknown as ChainResult;
    render(<Summary result={result} />);
    expect(screen.getAllByTestId('rb-profit-total').at(-1)?.textContent).not.toBe('Indisponible');
  });
});
