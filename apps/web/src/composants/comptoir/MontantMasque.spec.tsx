import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { MontantMasque } from './MontantMasque';

/**
 * Issue #157 : la cellule qui remplace un montant masqué par un rôle sans droit doit rendre un
 * texte réellement lisible — pas seulement exister comme clé i18n (`i18n:check` reste vert même
 * sur une clé jamais consommée au rendu, voir CONTRIBUTING.md), et distinct de « aucune valeur ».
 */
describe('MontantMasque', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it('affiche « Non visible », jamais une chaîne vide ni un tiret cadratin', () => {
    render(<MontantMasque />);

    expect(screen.getByText('Non visible')).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
    expect(screen.queryByText('0.00')).not.toBeInTheDocument();
  });

  it("porte l'explication complète dans un `title`, et masque son icône à l'arbre d'accessibilité", () => {
    render(<MontantMasque />);

    const conteneur = screen.getByText('Non visible').closest('span');
    expect(conteneur).toHaveAttribute(
      'title',
      'Ce montant existe, mais votre rôle ne donne pas accès aux montants.',
    );
    // L'icône est décorative : le texte seul porte le sens pour un lecteur d'écran.
    expect(conteneur?.querySelector('svg')).toHaveAttribute('aria-hidden');
  });

  it('traduit le libellé en allemand', async () => {
    await i18n.changeLanguage('de');
    render(<MontantMasque />);

    expect(screen.getByText('Nicht sichtbar')).toBeInTheDocument();
  });

  it('traduit le libellé en italien', async () => {
    await i18n.changeLanguage('it');
    render(<MontantMasque />);

    expect(screen.getByText('Non visibile')).toBeInTheDocument();
  });
});
