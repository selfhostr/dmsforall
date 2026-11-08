import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import type { ClientResume, ReponseOrdreReparation, VehiculeResume } from '@dfa/shared';

import { clesQuery } from '@/api/cles';
import { ErreurApi } from '@/api/erreurs';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { useAnnulerOr, useReceptionnerOr } from './useTransitionsOrdreReparation';

/**
 * « Une transition = un hook = un endpoint » (en-tête du module) : chaque hook doit appeler SON
 * segment d'action exact, jamais un autre, et reposer le DOCUMENT COMPLET renvoyé par le serveur
 * dans le cache — jamais une fusion locale ni un recalcul. C'est ce qui permet à
 * `PanneauActionsOr` de proposer des actions qui viennent du serveur (`actionsDisponibles`) sans
 * jamais les déduire : si un hook posait autre chose que la réponse serveur telle quelle, l'écran
 * afficherait un état halluciné après une transition.
 *
 * Complément essentiel : un refus (409) ne doit RIEN altérer du cache existant. Une action
 * affichée puis refusée à l'appel doit laisser l'OR dans son dernier état connu-bon, pas dans un
 * état halluciné par un succès optimiste qu'il n'y a jamais eu.
 */

function enveloppe(queryClient: ReturnType<typeof creerQueryClientTest>) {
  return function Enveloppe({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

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
    statut: 'planifie',
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
    ouvertLe: null,
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
    etatAffiche: 'planifie',
    actionsDisponibles: ['receptionner'],
    version: 1,
    creeLe: '2026-07-01T08:00:00.000Z',
    modifieLe: '2026-07-01T08:00:00.000Z',
    modifiePar: null,
    ...overrides,
  };
}

describe('useTransitionsOrdreReparation', () => {
  it('useReceptionnerOr appelle EXACTEMENT POST /ordres-reparation/{id}/receptionner et repose le document complet renvoyé, sans relecture', async () => {
    const OR_INITIAL = construireOr();
    const OR_APRES = construireOr({
      statut: 'ouvert',
      etatAffiche: 'ouvert',
      kilometrageEntree: 91234,
      actionsDisponibles: ['demarrer'],
    });

    let cheminAppele: string | null = null;
    server.use(
      http.post('/api/v1/ordres-reparation/or-1/receptionner', ({ request }) => {
        cheminAppele = new URL(request.url).pathname;
        return HttpResponse.json({ donnees: OR_APRES, avertissements: [] });
      }),
    );

    const queryClient = creerQueryClientTest();
    queryClient.setQueryData(clesQuery.or.detail('or-1'), OR_INITIAL);

    const { result } = renderHook(() => useReceptionnerOr('or-1'), {
      wrapper: enveloppe(queryClient),
    });

    act(() => {
      result.current.mutate({ kilometrageEntree: 91234, unite: 'km', signatureDifferee: false });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(cheminAppele).toBe('/api/v1/ordres-reparation/or-1/receptionner');
    // Le document posé en cache est EXACTEMENT celui renvoyé par le serveur — aucune fusion avec
    // l'ancien état, aucun recalcul local des champs dérivés (`etatAffiche`, `actionsDisponibles`).
    expect(queryClient.getQueryData(clesQuery.or.detail('or-1'))).toEqual(OR_APRES);
  });

  it('un refus de transition (409) ne modifie PAS le cache existant — l’OR reste dans son dernier état connu-bon', async () => {
    const OR_INITIAL = construireOr({ actionsDisponibles: ['annuler'] });

    server.use(
      http.post('/api/v1/ordres-reparation/or-1/annuler', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/OR_ANNULATION_IMPOSSIBLE',
            title: 'Annulation impossible',
            status: 409,
            code: 'OR_ANNULATION_IMPOSSIBLE',
            instance: 'req-1',
            blocages: [{ type: 'pointage', id: 'p1', libelle: 'Pointage en cours' }],
            actionsProposees: [],
          },
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    const queryClient = creerQueryClientTest();
    queryClient.setQueryData(clesQuery.or.detail('or-1'), OR_INITIAL);

    const { result } = renderHook(() => useAnnulerOr('or-1'), { wrapper: enveloppe(queryClient) });

    act(() => {
      result.current.mutate({ motif: 'Erreur de saisie' });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBeInstanceOf(ErreurApi);
    expect((result.current.error as ErreurApi).probleme.code).toBe('OR_ANNULATION_IMPOSSIBLE');
    expect((result.current.error as ErreurApi).blocages).toEqual([
      { type: 'pointage', id: 'p1', libelle: 'Pointage en cours' },
    ]);
    // Le cache n'a PAS bougé : un refus n'est jamais un succès optimiste déguisé.
    expect(queryClient.getQueryData(clesQuery.or.detail('or-1'))).toEqual(OR_INITIAL);
  });
});
