import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './dialog';

// Régression issue #67 : sur un formulaire long, le bouton « Confirmer » du pied de dialogue
// sortait du viewport (débordement de 1009 px de haut dans une fenêtre de 794 px) sans le
// moindre défilement possible pour l'atteindre — l'utilisateur cliquait dans le vide. jsdom ne
// calcule pas de mise en page réelle, donc ce test ne peut pas mesurer un débordement ; il garde
// en revanche la structure DOM et les classes qui rendent le débordement récupérable (corps
// défilable borné, en-tête/pied toujours visibles, bouton de fermeture jamais emporté par le
// défilement) — la preuve géométrique elle-même a été faite dans un vrai navigateur.
describe('DialogContent', () => {
  it("borne le cadre à la fenêtre et rend le corps défilable, sans que l'en-tête/le pied n'en fassent partie", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Titre</DialogTitle>
          </DialogHeader>
          <div data-testid="corps-formulaire">Contenu du formulaire</div>
          <DialogFooter>
            <button type="button">Confirmer</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    );

    const cadre = screen.getByRole('dialog');
    expect(cadre.className).toMatch(/max-h-\[90vh\]/);
    expect(cadre.className).toContain('overflow-hidden');

    const corps = screen.getByTestId('corps-formulaire').parentElement;
    expect(corps).not.toBeNull();
    expect(corps?.className).toContain('overflow-y-auto');
    expect(corps?.className).toContain('min-h-0');
    expect(corps?.className).toContain('overscroll-contain');

    // Le cadre lui-même ne doit jamais défiler (seul le corps défile) : sinon le bouton de
    // fermeture, positionné en absolu par rapport au cadre, défilerait hors champ avec le reste.
    expect(cadre.className).not.toContain('overflow-y-auto');
  });

  it('garde le bouton de fermeture (X) hors du corps défilable, jamais emporté par le défilement', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Titre</DialogTitle>
          </DialogHeader>
          <div data-testid="corps-formulaire">Contenu</div>
        </DialogContent>
      </Dialog>,
    );

    const boutonFermer = screen.getByRole('button', { name: 'Fermer' });
    const corps = screen.getByTestId('corps-formulaire').parentElement;
    expect(corps).not.toBeNull();
    expect(corps?.contains(boutonFermer)).toBe(false);
  });

  it("rend l'en-tête et le pied du dialogue collants (visibles en permanence pendant le défilement du corps)", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogHeader data-testid="en-tete">
            <DialogTitle>Titre</DialogTitle>
          </DialogHeader>
          <div>Contenu</div>
          <DialogFooter data-testid="pied">
            <button type="button">Confirmer</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByTestId('en-tete').className).toContain('sticky top-0');
    expect(screen.getByTestId('pied').className).toContain('sticky bottom-0');
  });
});
