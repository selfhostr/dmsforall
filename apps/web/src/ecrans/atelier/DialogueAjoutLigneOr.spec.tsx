import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { server } from '@/test/msw/server';
import { renduAvecQueryClient } from '@/test/utils';

import { DialogueAjoutLigneOr } from './DialogueAjoutLigneOr';

/**
 * Défaut réel reproduit en navigateur (fiche OR, dialogue « Ajouter un travail ou une pièce ») :
 * pour un client
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
  // (`ResizeObserver`, requis par `SelectTrigger` via `useSize`, est stubé globalement dans
  // `test/setup.ts` — plus besoin de copie locale ici.)
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
  renduAvecQueryClient(<DialogueAjoutLigneOr orId={OR_ID} siteId="site-1" />);
  await utilisateur.click(screen.getByRole('button', { name: i18n.t('or:lignes.ajouter') }));
  await screen.findByRole('dialog');
  await utilisateur.type(screen.getByLabelText(/Désignation/), 'Remplacement plaquettes avant');
}

describe("DialogueAjoutLigneOr — correctifs test d'utilisabilité novice (11.08.2026)", () => {
  it('affiche une unité « h » à côté du Temps barémé — « est-ce 1 heure 20, ou 1,2 heure ? »', async () => {
    const utilisateur = userEvent.setup();
    renduAvecQueryClient(<DialogueAjoutLigneOr orId={OR_ID} siteId="site-1" />);
    await utilisateur.click(screen.getByRole('button', { name: i18n.t('or:lignes.ajouter') }));
    await screen.findByRole('dialog');

    // Type par défaut = « Main-d'œuvre (temps barémé) » : le champ Temps barémé est visible d'emblée.
    const champTemps = screen.getByLabelText('Temps barémé');
    expect(champTemps.parentElement).toHaveTextContent('h');
  });

  it("relie la case « Sécurité » à une explication accessible (`aria-describedby`) — avant, aucune indication sur ce qu'elle fait", async () => {
    const utilisateur = userEvent.setup();
    renduAvecQueryClient(<DialogueAjoutLigneOr orId={OR_ID} siteId="site-1" />);
    await utilisateur.click(screen.getByRole('button', { name: i18n.t('or:lignes.ajouter') }));
    await screen.findByRole('dialog');

    const caseSecurite = screen.getByRole('checkbox', { name: 'Sécurité' });
    const idAide = caseSecurite.getAttribute('aria-describedby');
    expect(idAide).toBe('or-ligne-securite-aide');
    expect(document.getElementById('or-ligne-securite-aide')).not.toBeNull();
  });
});

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

describe('DialogueAjoutLigneOr — défaut : panne réseau/générique sur la création de ligne, bandeau resté silencieux', () => {
  /**
   * Défaut réel (test terrain, rapport de panne serveur pendant la saisie) : `erreurActive` ne
   * retenait QUE `mutation.error instanceof ErreurApi` — toute autre panne (`ErreurReseau` :
   * connexion coupée, timeout, serveur de dev qui redémarre en cours de requête ; ou une erreur
   * générique non reconnue) laissait `erreurActive` à `null`, donc RIEN ne s'affichait, alors que
   * `mutation.isError` était pourtant vrai. `messagesErreurMutation` (déjà utilisé par ce même
   * fichier ci-dessus) sait pourtant déjà traiter `unknown` — c'est le garde-fou `instanceof
   * ErreurApi` qui était trop étroit, pas la fonction de messages.
   */
  it('une panne réseau (pas une ErreurApi) affiche quand même un message actionnable, sans perte de saisie', async () => {
    server.use(http.post(`/api/v1/ordres-reparation/${OR_ID}/lignes`, () => HttpResponse.error()));
    const utilisateur = userEvent.setup();
    await ouvrirDialogueEtSaisirDesignation(utilisateur);
    await utilisateur.type(screen.getByLabelText('Référence'), 'REF-PANNE-1');

    const boutonConfirmer = screen.getByRole('button', { name: 'Confirmer' });
    await utilisateur.click(boutonConfirmer);

    // Message actionnable, à l'endroit où le garagiste a agi — `erreurs:reseau.description`
    // (`messageErreur`, cas `ErreurReseau`), jamais un bandeau vide.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      i18n.t('erreurs:reseau.description'),
    );
    // Le dialogue reste ouvert — jamais fermé sur un échec.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // Aucune perte de saisie (règle maison) : les champs déjà tapés restent intacts.
    expect(screen.getByLabelText(/Désignation/)).toHaveValue('Remplacement plaquettes avant');
    expect(screen.getByLabelText('Référence')).toHaveValue('REF-PANNE-1');
    // Le bouton redevient cliquable : plus en chargement après l'échec.
    await waitFor(() => expect(boutonConfirmer).not.toBeDisabled());
  });
});
