import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ListeDefinitions } from './ListeDefinitions';

describe('ListeDefinitions', () => {
  it('enveloppe chaque paire libellé/valeur dans sa propre div', () => {
    const { container } = render(
      <ListeDefinitions
        elements={[
          { cle: 'a', libelle: 'Km entrée', valeur: "63'500 km" },
          { cle: 'b', libelle: 'Km sortie', valeur: null },
        ]}
      />,
    );
    const paires = container.querySelectorAll('dl > div');
    expect(paires).toHaveLength(2);
    expect(within(paires[0] as HTMLElement).getByText('Km entrée').tagName).toBe('DT');
    expect(within(paires[0] as HTMLElement).getByText("63'500 km").tagName).toBe('DD');
  });

  it('rend un tiret pour une valeur absente et coupe les identifiants en mono', () => {
    render(
      <ListeDefinitions
        elements={[
          { cle: 'a', libelle: 'Km sortie', valeur: null },
          { cle: 'b', libelle: 'IBAN', valeur: 'CH9300762011623852957', mono: true },
        ]}
      />,
    );
    expect(screen.getByText('—').tagName).toBe('DD');
    expect(screen.getByText('CH9300762011623852957').className).toMatch(/break-all/);
    expect(screen.getByText('CH9300762011623852957').className).toMatch(/font-mono/);
  });
});
