import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LogoDfa } from './LogoDfa';

describe('LogoDfa', () => {
  it('rend un svg accessible', () => {
    const { container } = render(<LogoDfa />);
    const svg = container.querySelector('svg');

    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('aria-label', 'dmsforall');
  });

  it('dérive la largeur de la hauteur demandée sans déformer le tracé', () => {
    const { container } = render(<LogoDfa hauteur={44} />);
    const svg = container.querySelector('svg');

    expect(svg).toHaveAttribute('height', '44');
    expect(svg).toHaveAttribute('width', String(Math.round((44 * 250) / 110)));
  });
});
