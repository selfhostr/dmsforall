import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type {
  ClientResume,
  EntreeCreationOrdreReparation,
  ReponseOrdreReparation,
  VehiculeResume,
} from '@dfa/shared';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { useCreationOrdreReparation } from './useCreationOrdreReparation';

/**
 * Ce hook est la pièce la plus subtile du lot (voir son en-tête) : la clé d'idempotence vit dans
 * un `useRef`, jamais dans un état React lu juste après régénération, précisément pour qu'un
 * double-clic comptoir et un rejeu confirmé produisent le comportement CONTRACTUEL attendu
 * (RM-49) :
 *  - un double-clic (deux appels avant toute résolution) doit porter la MÊME clé — c'est ce qui
 *    permet au serveur de reconnaître un rejeu et de ne JAMAIS créer un second OR ;
 *  - un rejeu volontaire après confirmation (`confirmerEtResoumettre`, §4.4) doit au contraire
 *    porter une clé NEUVE, puisque `confirmations[]` change l'empreinte de la requête.
 *
 * Un bug qui « simplifierait » `cleIdempotenceRef` en `useState` referait échouer silencieusement
 * le premier cas (la clé lue au second appel du même tick resterait l'ANCIENNE valeur, avant
 * `setState`, donc identique — ce test ne le détecterait pas) OU casserait le second cas (une clé
 * lue trop tôt après regénération). Les trois tests ci-dessous couvrent les deux directions.
 */

function enveloppe(queryClient = creerQueryClientTest()) {
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

const ENTREE: EntreeCreationOrdreReparation = {
  siteId: 'site-1',
  vehiculeId: 'v1',
  clientId: 'cl-1',
  type: 'reparation',
  kilometrageEntree: null,
  uniteKilometrage: 'km',
  demandes: [],
  statutInitial: 'ouvert',
};

const OR_CREE: ReponseOrdreReparation = {
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
  localisation: 'atelier',
  sousTraitantNom: null,
  ordreReparationParentId: null,
  motifLien: null,
  rendezVousId: null,
  numeroCommandeInterne: null,
  receptionnaireId: null,
  retentionInvoqueeLe: null,
  litigeOuvertLe: null,
  ouvertLe: '2026-07-01T08:00:00.000Z',
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
  actionsDisponibles: [],
  version: 1,
  creeLe: '2026-07-01T08:00:00.000Z',
  modifieLe: '2026-07-01T08:00:00.000Z',
  modifiePar: null,
};

describe('useCreationOrdreReparation', () => {
  it("un double envoi (double-clic avant résolution) ne crée qu'un seul OR : les deux requêtes portent la MÊME clé d'idempotence", async () => {
    const clesRecues: (string | null)[] = [];
    server.use(
      http.post('/api/v1/ordres-reparation', async ({ request }) => {
        clesRecues.push(request.headers.get('Idempotency-Key'));
        // Délai explicite pour garantir que les deux requêtes du double-clic sont bien EN VOL
        // simultanément (sans lui, la première pourrait déjà résoudre avant que le second appel
        // synchrone soit émis, sous charge CI variable) — voir la mise en garde de ce lot sur les
        // délais implicites.
        await delay(20);
        return HttpResponse.json({ donnees: OR_CREE, avertissements: [] }, { status: 201 });
      }),
    );

    const onSuccess = vi.fn();
    const { result } = renderHook(() => useCreationOrdreReparation(), { wrapper: enveloppe() });

    // Deux appels synchrones dans le même tick == un double-clic comptoir : le composant appelant
    // (`FormulaireNouvelOrdreReparation`) n'a reçu aucun re-rendu entre les deux, donc `soumettre`
    // referme sur le MÊME `cleIdempotenceRef.current`.
    act(() => {
      result.current.soumettre(ENTREE, { onSuccess });
      result.current.soumettre(ENTREE, { onSuccess });
    });

    await waitFor(() => expect(clesRecues).toHaveLength(2));

    expect(clesRecues[0]).not.toBeNull();
    expect(clesRecues[0]).toBe(clesRecues[1]);
  });

  it('un rejeu après confirmation (confirmerEtResoumettre) régénère la clé et porte les confirmations acceptées', async () => {
    const requetes: {
      readonly cle: string | null;
      readonly corps: { readonly confirmations?: readonly string[] };
    }[] = [];
    let appel = 0;
    server.use(
      http.post('/api/v1/ordres-reparation', async ({ request }) => {
        appel += 1;
        const corps = (await request.json()) as { readonly confirmations?: readonly string[] };
        requetes.push({ cle: request.headers.get('Idempotency-Key'), corps });
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
        return HttpResponse.json({ donnees: OR_CREE, avertissements: [] }, { status: 201 });
      }),
    );

    const onSuccess = vi.fn();
    const { result } = renderHook(() => useCreationOrdreReparation(), { wrapper: enveloppe() });

    act(() => result.current.soumettre(ENTREE, { onSuccess }));
    await waitFor(() => expect(result.current.confirmationsRequises).toEqual(['CLIENT_BLOQUE']));
    // `erreur` (générique) reste `null` tant qu'une confirmation est à traiter — pas de double
    // affichage (alerte générique + dialogue de confirmation) côté écran.
    expect(result.current.erreur).toBeNull();

    act(() => result.current.confirmerEtResoumettre({ onSuccess }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));

    expect(requetes).toHaveLength(2);
    expect(requetes[1]!.cle).not.toBeNull();
    expect(requetes[1]!.cle).not.toBe(requetes[0]!.cle);
    expect(requetes[1]!.corps.confirmations).toEqual(['CLIENT_BLOQUE']);
    expect(onSuccess).toHaveBeenCalledWith(OR_CREE);
  });

  it('après un succès, la soumission suivante porte une clé différente de la précédente (jamais réutilisée)', async () => {
    const cles: (string | null)[] = [];
    server.use(
      http.post('/api/v1/ordres-reparation', async ({ request }) => {
        cles.push(request.headers.get('Idempotency-Key'));
        return HttpResponse.json({ donnees: OR_CREE, avertissements: [] }, { status: 201 });
      }),
    );

    const onSuccess = vi.fn();
    const { result } = renderHook(() => useCreationOrdreReparation(), { wrapper: enveloppe() });

    act(() => result.current.soumettre(ENTREE, { onSuccess }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));

    act(() => result.current.soumettre(ENTREE, { onSuccess }));
    await waitFor(() => expect(cles).toHaveLength(2));

    expect(cles[1]).not.toBeNull();
    expect(cles[1]).not.toBe(cles[0]);
  });
});
