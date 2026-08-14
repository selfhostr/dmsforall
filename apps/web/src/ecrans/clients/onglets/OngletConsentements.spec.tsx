import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import '@/i18n';

import { server } from '@/test/msw/server';
import { renduAvecQueryClient } from '@/test/utils';

import { OngletConsentements } from './OngletConsentements';

const CLIENT_ID = 'client-1';

function rendre(props: {
  readonly plusAucunContact: boolean;
  readonly motifContact: string | null;
}) {
  server.use(
    http.get(`/api/v1/clients/${CLIENT_ID}/consentements`, () =>
      HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 50 }),
    ),
  );
  return renduAvecQueryClient(<OngletConsentements clientId={CLIENT_ID} {...props} />);
}

/**
 * Issue #133 — RA-14 (« arrêt de tout contact ») existait déjà côté serveur
 * (`client.plusAucunContact`/`client.motif`, `POST /clients/{id}/arreter-contact`,
 * `.../reprendre-contact`) mais aucun écran ne l'appelait : seul un consentement marketing
 * (opt-in, toujours `accorde: true`) était gérable ici, sans aucun moyen d'enregistrer un refus
 * générique. Ces tests couvrent le bandeau ajouté, PAS une régression sur les trois opt-in
 * marketing existants (déjà couverts ailleurs par construction du composant, inchangés ici).
 */
describe("OngletConsentements — issue #133 (aucun moyen d'enregistrer un refus de contact)", () => {
  it('affiche le statut « peut être contacté » et propose « Arrêter tout contact » quand le drapeau est levé', () => {
    rendre({ plusAucunContact: false, motifContact: null });

    expect(screen.getByText('Le client peut être contacté normalement.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Arrêter tout contact' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reprendre le contact' })).not.toBeInTheDocument();
  });

  it('affiche le motif et propose « Reprendre le contact » quand le drapeau est posé', () => {
    rendre({ plusAucunContact: true, motifContact: 'Client en litige, mandataire désigné.' });

    expect(screen.getByText("Ce client a demandé l'arrêt de tout contact.")).toBeInTheDocument();
    expect(screen.getByText('Client en litige, mandataire désigné.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reprendre le contact' })).toBeInTheDocument();
  });

  it("exige un motif d'au moins 3 caractères avant de pouvoir soumettre « Arrêter tout contact »", async () => {
    rendre({ plusAucunContact: false, motifContact: null });
    const utilisateur = userEvent.setup();

    await utilisateur.click(screen.getByRole('button', { name: 'Arrêter tout contact' }));
    // Radix `Dialog` pose `aria-hidden="true"` sur tout le reste de la page une fois ouvert (le
    // déclencheur, resté dans le DOM, en fait partie) : `getByRole` respecte `aria-hidden`, donc
    // un SEUL bouton « Arrêter tout contact » reste interrogeable ici — celui du dialogue.
    const boutonConfirmer = await screen.findByRole('button', { name: 'Arrêter tout contact' });
    expect(boutonConfirmer).toBeDisabled();

    await utilisateur.type(screen.getByLabelText(/^Motif\s*\*$/), 'ok');
    expect(boutonConfirmer).toBeDisabled();

    await utilisateur.type(screen.getByLabelText(/^Motif\s*\*$/), 'k');
    expect(boutonConfirmer).not.toBeDisabled();
  });

  it('appelle POST /clients/{id}/arreter-contact avec le motif saisi et referme le dialogue au succès', async () => {
    let corpsEnvoye: Record<string, unknown> | undefined;
    server.use(
      http.post(`/api/v1/clients/${CLIENT_ID}/arreter-contact`, async ({ request }) => {
        corpsEnvoye = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            donnees: {
              id: CLIENT_ID,
              numeroClient: 'CL-000001',
              type: 'particulier',
              statut: 'actif',
              civilite: null,
              nom: 'Dupont',
              prenom: 'Jean',
              raisonSociale: null,
              nomAffiche: 'Dupont Jean',
              ide: null,
              langueCorrespondance: 'fr',
              email: null,
              telephone: null,
              telephoneE164: null,
              poObligatoire: false,
              groupeId: null,
              fusionneVersClientId: null,
              referenceExterne: null,
              plusAucunContact: true,
              motif: 'Client en litige, mandataire désigné.',
              dernierPassageLe: null,
              notesAlerte: [],
              creeLe: '2026-01-01T00:00:00.000Z',
              modifieLe: '2026-01-01T00:00:00.000Z',
            },
            avertissements: [],
          },
          { status: 200 },
        );
      }),
    );
    rendre({ plusAucunContact: false, motifContact: null });
    const utilisateur = userEvent.setup();

    await utilisateur.click(screen.getByRole('button', { name: 'Arrêter tout contact' }));
    await utilisateur.type(
      screen.getByLabelText(/^Motif\s*\*$/),
      'Client en litige, mandataire désigné.',
    );
    await utilisateur.click(await screen.findByRole('button', { name: 'Arrêter tout contact' }));

    await waitFor(() => expect(corpsEnvoye?.motif).toBe('Client en litige, mandataire désigné.'));
    await waitFor(() => expect(screen.queryByLabelText(/^Motif\s*\*$/)).not.toBeInTheDocument());
  });
});
