import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, it, vi } from 'vitest';

import { renduAvecQueryClient } from '@/test/utils';

import { DialogueAjoutLigneOr } from '@/ecrans/atelier/DialogueAjoutLigneOr';

import { auditerAccessibiliteEcran, exigerAucuneViolation } from './harnais';

/**
 * Mesure 4/4 — famille « dialogue modal » : `DialogueAjoutLigneOr`, un vrai `Dialog` Radix
 * (`components/ui/dialog.tsx`), auto-porteur de son propre déclencheur — aucune orchestration
 * externe nécessaire, juste un clic sur son bouton `DialogTrigger`. Aucune requête réseau tant
 * que rien n'est soumis (`useCreerLigneOr` est une mutation, pas une query) : aucun handler MSW à
 * poser pour auditer l'état ouvert.
 *
 * `orId` est un UUID de fixture arbitraire : jamais utilisé avant soumission, donc peu importe
 * qu'il corresponde à un OR réel dans ce test.
 *
 * Audit sur `document.body`, PAS sur le `container` de `render()` : `DialogContent` est porté par
 * un `<DialogPrimitive.Portal>` Radix (`components/ui/dialog.tsx`), qui l'ajoute comme enfant
 * direct de `document.body` — hors du `container`. Voir l'avertissement détaillé dans `harnais.ts`.
 */
beforeAll(() => {
  // Même stub que `EcranNouvelOrdreReparation.spec.tsx` : Radix Select appelle
  // `hasPointerCapture`/`scrollIntoView`, absents de jsdom.
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const OR_ID = '44444444-4444-4444-8444-444444444444';

describe('Accessibilité WCAG 2.1 AA — dialogue « Ajouter une ligne »', () => {
  it('dialogue ouvert, formulaire de ligne au repos', async () => {
    const utilisateur = userEvent.setup();
    renduAvecQueryClient(<DialogueAjoutLigneOr orId={OR_ID} />);

    await utilisateur.click(screen.getByRole('button', { name: 'Ajouter une ligne' }));
    await screen.findByRole('dialog');

    const audit = await auditerAccessibiliteEcran(
      'Dialogue « Ajouter une ligne » — ouvert, état initial',
      document.body,
    );

    exigerAucuneViolation(audit);
  });
});
