import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import type { ReponseDocumentVente } from '@dfa/shared';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { useFacturesOuvertesClient } from './useFacturesOuvertesClient';

function enveloppe() {
  const queryClient = creerQueryClientTest();
  return function Enveloppe({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

/** Fixture à la forme RÉELLE de `GET /documents-vente` — le serveur rend un `ReponseDocumentVente`
 *  COMPLET (`figees.clientDesignation`, jamais `clientDesignation` au premier niveau), voir l'ÉCART
 *  SIGNALÉ en tête de `documents-vente.api.ts` et la même fixture dans `documents-vente.api.spec.ts`
 *  / `EcranListeFactures.spec.tsx`. Un fixture à la forme du contrat (`DocumentVenteResume`) ferait
 *  planter `projeterResume` (accès à `figees.clientDesignation` sur `undefined`) et masquerait tout
 *  — jamais reproduire le bug qu'on veut prouver. */
function construireDocumentBrut(
  overrides: Partial<ReponseDocumentVente> = {},
): ReponseDocumentVente {
  return {
    id: 'doc-emis-1',
    typeDocument: 'facture',
    natureFacture: 'ordinaire',
    origine: 'dfa',
    numero: '2026-00010',
    numeroSequence: 10,
    numeroOrigine: null,
    exercice: 2026,
    statut: 'emis',
    statutReglement: 'non_regle',
    siteId: 'site-1',
    clientId: 'cl-1',
    vehiculeId: null,
    ordreReparationId: null,
    dossierVenteId: null,
    documentSourceId: null,
    factureAnnuleeId: null,
    annuleParAvoirId: null,
    remplaceId: null,
    figees: {
      clientDesignation: 'Jean Dupont',
      clientIde: null,
      clientLangue: 'fr',
      adresseFacturation: null,
      conditionsPaiement: null,
      plaque: null,
    },
    dateDocument: '2026-07-01',
    devise: 'CHF',
    tvaNonVentilee: false,
    tauxTvaPourmilleDocument: null,
    mentionTvaInterdite: false,
    totalHtCentimes: 4167,
    totalTvaCentimes: 333,
    ecartRepriseCentimes: 0,
    totalTtcCentimes: 4500,
    ventilationTva: [],
    remiseGlobaleSaisieCentimes: null,
    remiseGlobalePourmille: null,
    montantRegleCentimes: 0,
    soldeCentimes: 4500,
    relanceNiveau: 0,
    relanceLe: null,
    motifAvoir: null,
    motifAvoirAutre: null,
    porteeAvoir: null,
    qr: null,
    pdfCle: null,
    pdfSha256: null,
    exporteLe: null,
    exportId: null,
    contentieux: false,
    lignes: [],
    nombreLignes: 0,
    lignesTronquees: false,
    version: 1,
    emisLe: '2026-07-01T09:00:00.000Z',
    emisPar: { utilisateurId: 'u1', nomAffiche: 'Alice' },
    creeLe: '2026-07-01T08:00:00.000Z',
    modifieLe: '2026-07-01T09:00:00.000Z',
    modifiePar: null,
    ...overrides,
  };
}

/**
 * Défaut confirmé par parcours navigateur : une facture `annule_par_avoir` (dette réellement nulle,
 * `RF-32` ne nettoie ni `statutReglement` ni `soldeCentimes` à l'annulation) restait « ouverte » aux
 * yeux du panneau d'encaissement, parce que le filtre client ne portait QUE sur `statutReglement`
 * (`non_regle`/`partiel`) — jamais sur `statut`. Ces tests prouvent le correctif à deux niveaux :
 * 1. la requête envoyée au serveur porte bien `statut=emis` (ce que `hooks/facturation/` contrôle) ;
 * 2. AVEC un mock qui applique ce filtre comme le fait réellement `ServiceDocumentsVente.lister`
 *    (`apps/api/src/facturation/documents/service-documents.ts` : `inArray(documentVente.statut,
 *    filtres.statut)`, lu et vérifié avant d'écrire ce test), la facture annulée disparaît du
 *    résultat exposé par le hook.
 *
 * CE QUE CE TEST NE PROUVE PAS : que le VRAI serveur NestJS/Postgres applique effectivement ce
 * filtre — le mock MSW ci-dessous REPRODUIT le comportement lu dans le code serveur, il ne l'EXÉCUTE
 * pas. Cette preuve-là (le SQL réellement généré) vit côté serveur, dans
 * `apps/api/src/facturation/documents/service-documents.spec.ts` (`describe('statutReglement —
 * câblé'`) — hors périmètre de ce lot (`apps/web/` uniquement). Un `describe('statut — câblé')`
 * symétrique n'existe pas encore pour le filtre `statut` (seul `statutReglement`/`ordreReparationId`
 * en ont un aujourd'hui) : à signaler au propriétaire de `apps/api/src/facturation/documents/`.
 */
describe('useFacturesOuvertesClient', () => {
  it('envoie statut=emis à GET /documents-vente, en plus de statutReglement=non_regle,partiel', async () => {
    let requeteRecue: URLSearchParams | undefined;
    server.use(
      http.get('/api/v1/documents-vente', ({ request }) => {
        requeteRecue = new URL(request.url).searchParams;
        return HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 100 });
      }),
    );

    const { result } = renderHook(() => useFacturesOuvertesClient('cl-1'), {
      wrapper: enveloppe(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(requeteRecue?.getAll('statut')).toEqual(['emis']);
    expect(requeteRecue?.getAll('statutReglement')).toEqual(['non_regle', 'partiel']);
    expect(requeteRecue?.get('clientId')).toBe('cl-1');
  });

  it(
    'exclut une facture `annule_par_avoir` du résultat quand le serveur applique le filtre ' +
      '`statut` (comportement réel lu dans `service-documents.ts`, reproduit ici par le mock) — ' +
      'même si elle porte encore un `statutReglement`/`soldeCentimes` non nul, hérité d’avant son ' +
      'annulation',
    async () => {
      const factureOuverte = construireDocumentBrut();
      const factureAnnuleeParAvoir = construireDocumentBrut({
        id: 'doc-annule-1',
        numero: '2026-00011',
        statut: 'annule_par_avoir',
        // Reste dû STALE — exactement le scénario confirmé en navigateur : `RF-32` n'efface ni le
        // solde ni le statut de règlement à l'annulation par avoir.
        statutReglement: 'partiel',
        soldeCentimes: 6000,
      });

      server.use(
        http.get('/api/v1/documents-vente', ({ request }) => {
          const statuts = new URL(request.url).searchParams.getAll('statut');
          const toutes = [factureOuverte, factureAnnuleeParAvoir];
          const donnees =
            statuts.length > 0 ? toutes.filter((d) => statuts.includes(d.statut)) : toutes;
          return HttpResponse.json({ donnees, curseurSuivant: null, limite: 100 });
        }),
      );

      const { result } = renderHook(() => useFacturesOuvertesClient('cl-1'), {
        wrapper: enveloppe(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0]?.id).toBe('doc-emis-1');
      expect(result.current.data?.some((d) => d.id === 'doc-annule-1')).toBe(false);
    },
  );

  it(
    'preuve NÉGATIVE (documente le bug avant correctif) : SANS filtre `statut` appliqué côté ' +
      'serveur, la même facture annulée par avoir serait renvoyée — ce test échouerait sur le code ' +
      "d'avant ce correctif si le mock n'appliquait pas le filtre `statut`",
    async () => {
      const factureOuverte = construireDocumentBrut();
      const factureAnnuleeParAvoir = construireDocumentBrut({
        id: 'doc-annule-1',
        numero: '2026-00011',
        statut: 'annule_par_avoir',
        statutReglement: 'partiel',
        soldeCentimes: 6000,
      });

      server.use(
        http.get('/api/v1/documents-vente', () =>
          // Mock délibérément NAÏF : ignore tout filtre, renvoie tout — reproduit le comportement
          // observé côté client AVANT ce correctif (le filtre n'était simplement jamais posé).
          HttpResponse.json({
            donnees: [factureOuverte, factureAnnuleeParAvoir],
            curseurSuivant: null,
            limite: 100,
          }),
        ),
      );

      const { result } = renderHook(() => useFacturesOuvertesClient('cl-1'), {
        wrapper: enveloppe(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Le hook ne filtre plus rien lui-même une fois la réponse reçue — c'est bien la REQUÊTE
      // (`statut=emis`) qui doit porter tout le travail, jamais un filtrage client-side après coup.
      // Si un serveur mal configuré ignore le filtre, la facture annulée réapparaît : ce test
      // documente cette dépendance plutôt que de la masquer.
      expect(result.current.data).toHaveLength(2);
    },
  );
});
