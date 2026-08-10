import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { ReponseDocumentVente } from '@dfa/shared';

import '@/i18n';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { SheetEncaissement } from './SheetEncaissement';

/** Même fixture, à la même forme RÉELLE (`ReponseDocumentVente` complet, `figees.clientDesignation`)
 *  que `documents-vente.api.spec.ts` / `EcranListeFactures.spec.tsx` — voir l'ÉCART SIGNALÉ en tête
 *  de `hooks/facturation/documents-vente.api.ts` : `GET /documents-vente` ne rend jamais la
 *  projection étroite `DocumentVenteResume` que le contrat annonce. */
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

function rendre() {
  const queryClient = creerQueryClientTest();
  return render(
    <QueryClientProvider client={queryClient}>
      <SheetEncaissement
        ouvert
        onOuvertChange={() => {}}
        siteId="site-1"
        clientId="cl-1"
        destinataireNom="Jean Dupont"
      />
    </QueryClientProvider>,
  );
}

/**
 * Preuve directe du parcours navigateur qui a confirmé le défaut : une facture `annule_par_avoir`
 * (dette éteinte, `RF-32` ne nettoie ni `statutReglement` ni `soldeCentimes` à l'annulation)
 * apparaissait dans CE panneau, cochable, avec un « reste dû » qui n'est plus dû, et pouvait porter
 * le total sélectionné.
 *
 * Le mock ci-dessous applique le filtre `statut` de la même façon que `ServiceDocumentsVente.lister`
 * (`apps/api/src/facturation/documents/service-documents.ts`, lu et vérifié avant d'écrire ce test :
 * `inArray(documentVente.statut, filtres.statut)`) — il REPRODUIT ce comportement, il ne l'EXÉCUTE
 * pas. Ce test prouve donc que LE FRONT (`useFacturesOuvertesClient` → `SheetEncaissement`) exclut
 * bien la facture annulée UNE FOIS que le serveur applique le filtre qu'on lui envoie ; il ne prouve
 * pas que le serveur réel l'applique — cette preuve-là est côté `apps/api`, hors périmètre de cet
 * agent (voir `useFacturesOuvertesClient.spec.tsx` pour le même avertissement, et la description du
 * correctif serveur, hors périmètre, qui doit en plus refuser l'IMPUTATION elle-même sur un document
 * non `emis` — le filtre d'affichage n'est jamais la frontière de sécurité).
 */
describe('SheetEncaissement — facture annulée par avoir', () => {
  it("n'affiche PAS la facture annulée par avoir dans « Factures ouvertes » — ni son numéro, ni son « reste dû », ni de case à cocher pour elle", async () => {
    const factureOuverte = construireDocumentBrut();
    const factureAnnuleeParAvoir = construireDocumentBrut({
      id: 'doc-annule-1',
      numero: '2026-00011',
      statut: 'annule_par_avoir',
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

    rendre();

    // La facture encore ouverte est bien là — le panneau n'est pas vide, la requête a répondu.
    expect(await screen.findByText(/2026-00010/)).toBeInTheDocument();

    // La facture annulée par avoir n'apparaît NULLE PART dans le panneau : ni son numéro...
    expect(screen.queryByText(/2026-00011/)).not.toBeInTheDocument();
    // ...ni son reste dû stale de CHF 60.00 (le scénario exact confirmé en navigateur)...
    expect(screen.queryByText(/60\.00/)).not.toBeInTheDocument();
    // ...ni une case à cocher qui la désignerait par son id (preuve précise, pas une recherche par
    // texte qui pourrait accidentellement passer).
    expect(document.getElementById('encaissement-facture-doc-annule-1')).toBeNull();

    // Une seule ligne dans la liste — celle de la facture réellement ouverte.
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  });

  it(
    'le total sélectionné ne peut porter que le solde de la facture encore ouverte — la facture ' +
      'annulée, absente de la liste, ne peut structurellement plus contribuer à ce total',
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
        http.get('/api/v1/documents-vente', ({ request }) => {
          const statuts = new URL(request.url).searchParams.getAll('statut');
          const toutes = [factureOuverte, factureAnnuleeParAvoir];
          const donnees =
            statuts.length > 0 ? toutes.filter((d) => statuts.includes(d.statut)) : toutes;
          return HttpResponse.json({ donnees, curseurSuivant: null, limite: 100 });
        }),
      );

      rendre();
      await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(1));

      // Aucune sélection au départ (pas de facture précochée pour ce point d'entrée) : le total
      // affiché est déjà 0.00 partout (aucune devise résolue tant que rien n'est coché, voir
      // `deviseSelectionCommune`) — et surtout, jamais un montant qui inclurait les CHF 60.00 de la
      // facture éteinte : elle est absente de la liste, donc structurellement exclue de la somme
      // (`totalSelectionneCentimes = factures.filter(f => selection.has(f.id)).reduce(...)`).
      expect(screen.getAllByText('0.00')).toHaveLength(2); // « Total sélectionné » + « Reste à encaisser »
      expect(screen.queryByText(/60\.00/)).not.toBeInTheDocument();
    },
  );
});
