import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { ClientResume, ReponseOrdreReparation, VehiculeResume } from '@dfa/shared';

import { server } from '@/test/msw/server';
import { renduAvecQueryClient } from '@/test/utils';

import { PanneauActionsOr } from './PanneauActionsOr';

/**
 * Issues #64/#66 (même défaut que `FormulaireNouvelOrdreReparation`, corrigé ici selon EXACTEMENT
 * le même mécanisme, voir l'en-tête de `PanneauActionsOr.tsx`) : un réceptionniste qui clique
 * « Confirmer » sur une transition doit voir la confirmation serveur s'ouvrir D'ELLE-MÊME, jamais
 * derrière un encart discret qu'il faut d'abord repérer puis cliquer une seconde fois.
 */

// Radix Dialog appelle `hasPointerCapture`/`scrollIntoView`, absents de jsdom — même stub que
// `FormulaireNouvelOrdreReparation.spec.tsx`.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const VEHICULE: VehiculeResume = {
  id: 'v1',
  plaque: '123456',
  canton: 'VD',
  designation: 'VW Touran 2.0 TDI',
  vin: 'WVGZZZ1TZ8W123456',
  premiereMiseEnCirculationLe: '2018-03-14',
  identificationIncomplete: false,
  emplacementLibre: null,
};

const CLIENT: ClientResume = {
  id: 'cl-1',
  numeroClient: 'CL-000123',
  nomAffiche: 'Jean Dupont',
  type: 'particulier',
  statut: 'actif',
  langueCorrespondance: 'fr',
  poObligatoire: false,
  telephone: null,
  localite: 'Lausanne',
  nombreVehicules: 1,
  dernierPassageLe: null,
};

function construireOr(overrides: Partial<ReponseOrdreReparation> = {}): ReponseOrdreReparation {
  return {
    id: 'or-1',
    numero: 'OR-000123',
    siteId: 'site-1',
    type: 'reparation',
    statut: 'ouvert',
    client: CLIENT,
    vehicule: VEHICULE,
    figees: {
      clientDesignation: 'Jean Dupont',
      adresseFacturation: null,
      plaque: '123456',
      detenteurClientId: 'cl-1',
    },
    conducteurPresentNom: null,
    kilometrageEntree: null,
    kilometrageSortie: null,
    restitutionPromiseLe: null,
    restitutionInitialeLe: null,
    localisation: 'parc',
    sousTraitantNom: null,
    ordreReparationParentId: null,
    motifLien: null,
    rendezVousId: null,
    numeroCommandeInterne: null,
    receptionnaireId: null,
    retentionInvoqueeLe: null,
    litigeOuvertLe: null,
    ouvertLe: '2026-08-01T08:00:00.000Z',
    termineLe: null,
    factureLe: null,
    restitueLe: null,
    clotureLe: null,
    annuleLe: null,
    motifAnnulation: null,
    demandes: [],
    lignes: [],
    nombreLignes: 0,
    lignesTronquees: false,
    devisComplementaires: [],
    controleQualite: null,
    signatures: [],
    pret: null,
    cumulsPointage: { totalCentiemes: 0, parTechnicien: [], pointagesOuverts: 0 },
    attentes: { accord: false, pieces: false, externe: false },
    etatAffiche: 'ouvert',
    // `demarrer` : seule action listée -> aucune ambiguïté sur la primaire, formulaire de
    // confirmation le plus simple (`or:actions.confirmerAction`, aucun champ), sans jamais rendre
    // le bouton `facturer` (donc pas de `<Link>` react-router à envelopper dans ce test).
    actionsDisponibles: ['demarrer'],
    version: 1,
    creeLe: '2026-08-01T08:00:00.000Z',
    modifieLe: '2026-08-01T08:00:00.000Z',
    modifiePar: null,
    ...overrides,
  };
}

function rendre(or: ReponseOrdreReparation = construireOr()) {
  return renduAvecQueryClient(<PanneauActionsOr or={or} />);
}

describe('PanneauActionsOr — CONFIRMATION_REQUISE (§4.4)', () => {
  it("la modale de confirmation s'ouvre D'ELLE-MÊME (issues #64/#66 : plus besoin d'un premier clic sur un encart qu'on peut manquer), et confirmer rejoue la transition", async () => {
    let appel = 0;
    const corps: Record<string, unknown>[] = [];
    server.use(
      http.post('/api/v1/ordres-reparation/or-1/demarrer', async ({ request }) => {
        appel += 1;
        corps.push((await request.json()) as Record<string, unknown>);
        if (appel === 1) {
          return HttpResponse.json(
            {
              type: 'https://docs.dmsforall.example/erreurs/CONFIRMATION_REQUISE',
              title: 'Confirmation requise',
              status: 409,
              code: 'CONFIRMATION_REQUISE',
              instance: 'req-1',
              confirmationsRequises: ['CLIENT_BLOQUE'],
            },
            { status: 409, headers: { 'content-type': 'application/problem+json' } },
          );
        }
        return HttpResponse.json(
          {
            donnees: construireOr({ statut: 'en_cours', actionsDisponibles: [] }),
            avertissements: [],
          },
          { status: 200 },
        );
      }),
    );

    const utilisateur = userEvent.setup({ pointerEventsCheck: 0 });
    rendre();

    await utilisateur.click(await screen.findByRole('button', { name: 'Démarrer les travaux' }));
    const dialogueAction = await screen.findByRole('dialog');
    await utilisateur.click(within(dialogueAction).getByRole('button', { name: 'Confirmer' }));

    // Doit apparaître SANS aucun clic intermédiaire sur un quelconque encart — le seul geste
    // depuis le clic « Confirmer » ci-dessus est l'attente de la réponse serveur.
    const boutonConfirmer = await screen.findByRole('button', { name: 'Continuer quand même' });
    expect(boutonConfirmer).toBeInTheDocument();

    await utilisateur.click(boutonConfirmer);

    await waitFor(() => expect(appel).toBe(2));
    expect(corps[1]).toMatchObject({ confirmations: ['CLIENT_BLOQUE'] });
    // Succès : `fermer()` referme tout, y compris le dialogue de l'action.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('un « Annuler » sur la confirmation la referme durablement — elle ne se rouvre pas toute seule', async () => {
    server.use(
      http.post('/api/v1/ordres-reparation/or-1/demarrer', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/CONFIRMATION_REQUISE',
            title: 'Confirmation requise',
            status: 409,
            code: 'CONFIRMATION_REQUISE',
            instance: 'req-2',
            confirmationsRequises: ['CLIENT_BLOQUE'],
          },
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    const utilisateur = userEvent.setup({ pointerEventsCheck: 0 });
    rendre();

    await utilisateur.click(await screen.findByRole('button', { name: 'Démarrer les travaux' }));
    const dialogueAction = await screen.findByRole('dialog');
    await utilisateur.click(within(dialogueAction).getByRole('button', { name: 'Confirmer' }));

    const boutonConfirmer = await screen.findByRole('button', { name: 'Continuer quand même' });
    const dialogueConfirmation = boutonConfirmer.closest('[role="dialog"]') as HTMLElement;
    await utilisateur.click(within(dialogueConfirmation).getByRole('button', { name: 'Annuler' }));

    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Continuer quand même' }),
      ).not.toBeInTheDocument(),
    );
    // Laissé quelques instants : si le drapeau de rejet n'existait pas, `confirmationsRequises`
    // resterait posé côté mutation et la modale se rouvrirait TOUTE SEULE au rendu suivant.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('button', { name: 'Continuer quand même' })).not.toBeInTheDocument();
  });
});
