import { render, screen } from '@testing-library/react';
import type { NiveauSanteGarage } from '@dfa/shared';
import { describe, expect, it } from 'vitest';

import '@/i18n';

import { BadgeStatutGarage } from './BadgeStatutGarage';

const MOTS_FR: Readonly<Record<NiveauSanteGarage, string>> = {
  critique: 'Critique',
  attention: 'Attention',
  ok: 'OK',
};

describe('BadgeStatutGarage', () => {
  it('couvre les trois valeurs de NiveauSanteGarage (mapping exhaustif)', () => {
    for (const statut of ['critique', 'attention', 'ok'] as const) {
      const { unmount } = render(<BadgeStatutGarage statut={statut} />);
      expect(screen.getByText(MOTS_FR[statut])).toBeInTheDocument();
      unmount();
    }
  });

  it('porte une icône dédiée par statut — jamais la couleur seule (daltonisme)', () => {
    const { container: conteneurCritique } = render(<BadgeStatutGarage statut="critique" />);
    const { container: conteneurOk } = render(<BadgeStatutGarage statut="ok" />);
    const svgCritique = conteneurCritique.querySelector('svg');
    const svgOk = conteneurOk.querySelector('svg');
    expect(svgCritique).not.toBeNull();
    expect(svgOk).not.toBeNull();
    // Les deux badges emploient des icônes lucide DIFFÉRENTES (classes générées distinctes) —
    // preuve mécanique que la distinction ne repose pas uniquement sur la couleur de fond.
    expect(svgCritique?.getAttribute('class')).not.toBe(svgOk?.getAttribute('class'));
  });
});
