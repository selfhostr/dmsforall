import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import type { ReponseReprise } from '@dfa/shared';

import '@/i18n';

import { renduAvecQueryClient } from '@/test/utils';

import { DialogueModifierReprise } from './DialogueModifierReprise';

const REPRISE: ReponseReprise = {
  id: 'reprise-1',
  dossierVenteId: 'dossier-1',
  vehiculeRepris: {
    id: 'vehicule-1',
    plaque: '123456',
    canton: 'VD',
    designation: 'VW Touran 2.0 TDI',
    vin: 'WVWZZZ1KZAP123456',
    premiereMiseEnCirculationLe: '2018-03-01',
    identificationIncomplete: false,
    emplacementLibre: null,
  },
  statut: 'estimee',
  valeurEstimeeCentimes: 800_000,
  valeurNegocieeCentimes: null,
  ecartRepriseVehiculeCentimes: null,
  detteFinancementResiduelleCentimes: null,
  detteFinancementOrganismeId: null,
  detteFinancementOrganismeNom: null,
  estimeeLe: '2026-01-01T08:00:00.000Z',
  negocieeLe: null,
  confirmeeLe: null,
  refuseeLe: null,
  motifRefus: null,
  actionsDisponibles: ['modifier', 'negocier', 'refuser'],
  version: 1,
  creeLe: '2026-01-01T08:00:00.000Z',
  modifieLe: '2026-01-01T08:00:00.000Z',
  modifiePar: null,
};

/** Enveloppe de test qui rejoue le scénario du bug réel : un `useQuery` sans `staleTime`
 *  (`refetchOnWindowFocus`, défaut TanStack Query v5) redonne une NOUVELLE référence de `reprise`
 *  avec le MÊME contenu, sans action de l'utilisateur — ce que fait `setRepriseAvecNouvelleRef` en
 *  reconstruisant l'objet par spread. */
function EnveloppeSimulantRefetch() {
  const [reprise, setReprise] = useState<ReponseReprise>(REPRISE);

  return (
    <>
      <button type="button" onClick={() => setReprise({ ...REPRISE })}>
        Simuler un refetch (nouvelle référence, même contenu)
      </button>
      <DialogueModifierReprise
        dossierVenteId="dossier-1"
        reprise={reprise}
        ouvert
        onOuvertChange={() => {}}
      />
    </>
  );
}

describe('DialogueModifierReprise — ne perd pas la saisie en cours', () => {
  it('un refetch de `reprise` pendant l’édition (fenêtre reprend le focus) ne réinitialise pas le champ', async () => {
    renduAvecQueryClient(<EnveloppeSimulantRefetch />);
    const utilisateur = userEvent.setup();

    // Regex plutôt qu'une chaîne exacte : le `*` du libellé est un `<span>` séparé sans espace
    // (`Label.tsx`), donc le texte concaténé est `Valeur estimée*` — même convention que
    // `CarteReprise.spec.tsx`/`EcranFicheDossierVente.spec.tsx` pour ce même champ.
    const champ = await screen.findByLabelText(/Valeur estimée/);
    expect(champ).toHaveValue('8000.00');

    await utilisateur.clear(champ);
    await utilisateur.type(champ, '9250.00');
    expect(champ).toHaveValue('9250.00');

    // Un refetch arrive (ex. retour de focus fenêtre) : `reprise` change de référence mais pas de
    // contenu. Le dialogue reste ouvert (`ouvert` ne change pas) — l'effet ne doit PAS se rejouer.
    // `hidden: true` : Radix pose `aria-hidden` sur tout ce qui est HORS du dialogue tant qu'il
    // est ouvert (protection lecteur d'écran) — ce bouton de test, sibling du dialogue, en fait
    // partie. Et Radix bloque aussi `pointer-events` en dehors du dialogue (modalité réelle) :
    // `fireEvent` (pas `userEvent`, qui refuse un clic sur un élément `pointer-events: none`) —
    // seul le déclenchement React de l'événement compte ici, pas une interaction souris réaliste.
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Simuler un refetch (nouvelle référence, même contenu)',
        hidden: true,
      }),
    );

    expect(champ).toHaveValue('9250.00');
  });

  it("à l'ouverture, le champ est bien initialisé depuis `reprise` (pas de régression)", async () => {
    renduAvecQueryClient(
      <DialogueModifierReprise
        dossierVenteId="dossier-1"
        reprise={REPRISE}
        ouvert
        onOuvertChange={() => {}}
      />,
    );

    expect(await screen.findByLabelText(/Valeur estimée/)).toHaveValue('8000.00');
  });
});
