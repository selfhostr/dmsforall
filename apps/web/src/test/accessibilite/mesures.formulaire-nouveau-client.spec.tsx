import { screen } from '@testing-library/react';
import { vi } from 'vitest';
import { describe, it } from 'vitest';

import { renduAvecRoutes } from '@/test/utils';

import { FormulaireNouveauClient } from '@/ecrans/clients/FormulaireNouveauClient';

import { auditerAccessibiliteEcran, exigerAucuneViolation } from './harnais';

/**
 * Mesure 3/4 — famille « formulaire », le patron le plus chargé en étiquettes/erreurs de
 * validation du produit : identité, adresse, plusieurs champs obligatoires. Rendu repris tel quel
 * de `FormulaireNouveauClient.spec.tsx` (`ouvert` à `true`, tiroir déjà ouvert).
 *
 * `useDoublonsClients` (aperçu live de doublons) reste désactivé tant qu'aucun nom n'est saisi —
 * aucun appel réseau à mocker pour un simple audit de l'état initial.
 *
 * Audit sur `document.body`, PAS sur le `container` de `render()` : ce formulaire est monté dans
 * un `<Sheet>` (`components/ui/sheet.tsx`), qui porte son contenu via
 * `<DialogPrimitive.Portal>` — hors du `container`. Voir l'avertissement détaillé dans
 * `harnais.ts`.
 */
function rendreFormulaire() {
  return renduAvecRoutes([
    { path: '/', element: <FormulaireNouveauClient ouvert onCree={vi.fn()} /> },
    { path: '/clients/:id', element: <div>PAGE_FICHE_CLIENT</div> },
  ]);
}

describe('Accessibilité WCAG 2.1 AA — formulaire nouveau client', () => {
  it('formulaire vide, à l’ouverture du tiroir', async () => {
    rendreFormulaire();
    await screen.findByRole('button', { name: 'Créer le client' });

    const audit = await auditerAccessibiliteEcran(
      'Formulaire nouveau client — état initial',
      document.body,
    );

    exigerAucuneViolation(audit);
  });
});
