import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Table, TableBody, TableCell, TableRow } from './table';

function exemple(densite?: 'dense' | 'aeree' | 'tres-aeree') {
  return render(
    <Table densite={densite} aria-label="exemple">
      <TableBody>
        <TableRow>
          <TableCell>x</TableCell>
        </TableRow>
      </TableBody>
    </Table>,
  );
}

describe('Table — densité', () => {
  it('sans densite explicite : hérite de la racine (aucune classe densite-* locale)', () => {
    const { container } = exemple();
    expect(container.firstElementChild?.className).not.toMatch(/densite-/);
  });

  it('avec densite explicite : la pose localement (la borne reste très aérée)', () => {
    const { container } = exemple('tres-aeree');
    expect(container.firstElementChild).toHaveClass('densite-tres-aeree');
  });

  it('la hauteur de ligne lit le jeton de densité, jamais 40/48 px en dur', () => {
    exemple();
    const classes = screen.getByRole('row').className;
    expect(classes).toContain('h-[var(--densite-hauteur-ligne,40px)]');
    expect(classes).not.toMatch(/\bh-(10|12)\b/);
  });
});
