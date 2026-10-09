// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

afterEach(cleanup);
import { RouteTable } from '../src/ui/components/RouteTable';
import { DEFAULT_SETTINGS } from '../src/types';

describe('état vide des classements', () => {
  it('propose d’afficher les prix périmés en un clic', () => {
    const on = vi.fn();
    render(<RouteTable rows={[]} metaById={new Map()} variant="ranked" caption="Top" settings={DEFAULT_SETTINGS} onShowStale={on} />);
    fireEvent.click(screen.getByRole('button', { name: 'Afficher les opportunités aux prix périmés' }));
    expect(on).toHaveBeenCalledOnce();
  });
  it('masque le bouton quand les prix périmés sont déjà affichés', () => {
    render(
      <RouteTable rows={[]} metaById={new Map()} variant="ranked" caption="Top" settings={{ ...DEFAULT_SETTINGS, showStale: true }} onShowStale={() => {}} />,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});
