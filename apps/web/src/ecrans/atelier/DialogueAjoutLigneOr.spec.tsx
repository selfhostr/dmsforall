import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { server } from '@/test/msw/server';
import { renduAvecQueryClient } from '@/test/utils';

import { DialogueAjoutLigneOr } from './DialogueAjoutLigneOr';

/**
 * Défaut réel reproduit en navigateur (fiche OR, dialogue « Ajouter une ligne ») : pour un client
 * sans taux négocié (RM-07) et un référentiel garage sans taux standard, le serveur répond
 * `VALIDATION_ECHOUEE` avec, dans `erreurs[0]`, un message précis rédigé à la main (« Aucun taux
 * horaire standard : ... Renseigner les taux horaires dans le paramétrage. »). Avant le correctif,
 * le dialogue affichait « Certaines informations sont incorrectes. » — perdant l'action à mener —
 * parce qu'il appelait `messageErreur(erreurActive, t)`, qui ne lit QUE `probleme.code`, jamais
 * `probleme.erreurs[]`.
 */
beforeAll(() => {
  // Même stub que la mesure d'accessibilité de ce dialogue (`mesures.dialogue-ajout-ligne-or.spec.tsx`) :
  // Radix Select appelle `hasPointerCapture`/`scrollIntoView`, absents de jsdom.
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const OR_ID = '44444444-4444-4444-8444-444444444444';

const MESSAGE_TAUX_HORAIRE =
  'Aucun taux horaire standard : ce client n’a pas de taux négocié (RM-07) et le référentiel ' +
  'du garage ne porte ni le code « ATELIER » ni un taux unique en vigueur au 2026-08-10. ' +
  'Renseigner les taux horaires dans le paramétrage.';

async function ouvrirDialogueEtSaisirDesignation(utilisateur: ReturnType<typeof userEvent.setup>) {
  renduAvecQueryClient(<DialogueAjoutLigneOr orId={OR_ID} />);
  await utilisateur.click(screen.getByRole('button', { name: 'Ajouter une ligne' }));
  await screen.findByRole('dialog');
  await utilisateur.type(screen.getByLabelText(/Désignation/), 'Remplacement plaquettes avant');
}

describe('DialogueAjoutLigneOr — défaut : message métier du serveur perdu derrière le bandeau générique', () => {
  it('affiche le message serveur précis (taux_horaire_introuvable) au lieu de « Certaines informations sont incorrectes. »', async () => {
    server.use(
      http.post(`/api/v1/ordres-reparation/${OR_ID}/lignes`, () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/VALIDATION_ECHOUEE',
            title: 'Validation échouée',
            status: 400,
            code: 'VALIDATION_ECHOUEE',
            instance: 'req-taux-1',
            erreurs: [
              { champ: 'type', code: 'taux_horaire_introuvable', message: MESSAGE_TAUX_HORAIRE },
            ],
          },
          { status: 400, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const utilisateur = userEvent.setup();
    await ouvrirDialogueEtSaisirDesignation(utilisateur);

    await utilisateur.click(screen.getByRole('button', { name: 'Confirmer' }));

    expect(await screen.findByText(MESSAGE_TAUX_HORAIRE)).toBeInTheDocument();
    expect(screen.queryByText('Certaines informations sont incorrectes.')).not.toBeInTheDocument();
  });

  it('reste général : un DEUXIÈME code métier, jamais codé en dur ici, atteint aussi l’écran avec son propre message', async () => {
    server.use(
      http.post(`/api/v1/ordres-reparation/${OR_ID}/lignes`, () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/VALIDATION_ECHOUEE',
            title: 'Validation échouée',
            status: 400,
            code: 'VALIDATION_ECHOUEE',
            instance: 'req-futur-1',
            erreurs: [
              {
                champ: 'articleId',
                code: 'un_code_metier_qui_nexiste_pas_encore',
                message: 'Message métier inventé pour ce test, jamais encore écrit dans ce dépôt.',
              },
            ],
          },
          { status: 400, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const utilisateur = userEvent.setup();
    await ouvrirDialogueEtSaisirDesignation(utilisateur);

    await utilisateur.click(screen.getByRole('button', { name: 'Confirmer' }));

    expect(
      await screen.findByText(
        'Message métier inventé pour ce test, jamais encore écrit dans ce dépôt.',
      ),
    ).toBeInTheDocument();
  });

  it('chemin heureux inchangé : une ligne valide se crée sans régression du correctif', async () => {
    server.use(
      http.post(`/api/v1/ordres-reparation/${OR_ID}/lignes`, () =>
        HttpResponse.json({
          donnees: {
            id: 'ligne-1',
            ordreReparationId: OR_ID,
            numeroOrdre: 1,
            type: 'main_oeuvre_bareme',
            origine: 'commandee',
            statut: 'proposee',
            payeur: 'client',
            payeurClientId: null,
            blocage: 'aucun',
            designation: 'Remplacement plaquettes avant',
            referenceTexte: null,
            articleId: null,
            quantiteMillieme: 1000,
            tempsBaremeCentiemes: null,
            tempsBaremeConstructeurCentiemes: null,
            tempsReelCentiemes: null,
            rabaisPourmille: 0,
            tauxTvaPourmille: 81,
            figeLe: null,
            technicienId: null,
            codeOperation: null,
            codeDefaut: null,
            numeroSinistre: null,
            numeroAccord: null,
            urgence: null,
            securite: false,
            fournieParClient: false,
            aRestituer: false,
            restituee: false,
            motifAnnulation: null,
            factureId: null,
            creeLe: '2026-08-10T08:00:00.000Z',
            modifieLe: '2026-08-10T08:00:00.000Z',
          },
          avertissements: [],
        }),
      ),
    );
    const utilisateur = userEvent.setup();
    await ouvrirDialogueEtSaisirDesignation(utilisateur);

    await utilisateur.click(screen.getByRole('button', { name: 'Confirmer' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
