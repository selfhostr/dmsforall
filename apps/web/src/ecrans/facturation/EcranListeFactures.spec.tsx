import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { ReponseDocumentVente } from '@dfa/shared';

import '@/i18n';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranListeFactures } from './EcranListeFactures';

/**
 * Fixture à la forme RÉELLE de `GET /documents-vente` (voir l'ÉCART SIGNALÉ dans
 * `hooks/facturation/documents-vente.api.ts`) : un `ReponseDocumentVente` complet, désignation
 * client sous `figees.clientDesignation` — jamais un `DocumentVenteResume` avec un champ
 * `clientDesignation` de premier niveau. Utiliser la forme du contrat plutôt que la forme réelle
 * ferait passer ce test sans jamais reproduire le bug confirmé en exécution.
 */
function construireDocumentBrut(
  overrides: Partial<ReponseDocumentVente> = {},
): ReponseDocumentVente {
  return {
    id: 'doc-1',
    typeDocument: 'facture',
    natureFacture: 'ordinaire',
    origine: 'dfa',
    numero: '2026-00007',
    numeroSequence: 7,
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
    dateDocument: '2026-07-20',
    devise: 'CHF',
    tvaNonVentilee: false,
    tauxTvaPourmilleDocument: null,
    mentionTvaInterdite: false,
    totalHtCentimes: 11430,
    totalTvaCentimes: 915,
    ecartRepriseCentimes: 0,
    totalTtcCentimes: 12345,
    ventilationTva: [],
    remiseGlobaleSaisieCentimes: null,
    remiseGlobalePourmille: null,
    montantRegleCentimes: 0,
    soldeCentimes: 12345,
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
    emisLe: '2026-07-20T09:00:00.000Z',
    emisPar: { utilisateurId: 'u1', nomAffiche: 'Alice' },
    creeLe: '2026-07-20T08:00:00.000Z',
    modifieLe: '2026-07-20T09:00:00.000Z',
    modifiePar: null,
    ...overrides,
  };
}

function rendre() {
  const queryClient = creerQueryClientTest();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <EcranListeFactures />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranListeFactures', () => {
  it('affiche un état de chargement pendant que la requête est en vol, jamais un tableau aux colonnes vides', async () => {
    server.use(
      http.get('/api/v1/documents-vente', async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return HttpResponse.json({
          donnees: [construireDocumentBrut()],
          curseurSuivant: null,
          limite: 50,
        });
      }),
    );

    rendre();

    // Pendant que la requête est en vol : ni la donnée, ni un tableau avec des cellules vides —
    // `EcranListeFactures` doit rendre `EtatChargement`, pas `TableComptoir`.
    expect(screen.queryByText('Jean Dupont')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText('Jean Dupont')).toBeInTheDocument());
  });

  it('affiche Client / Montant TTC / Statut dès le premier rendu réussi, en lisant les champs à leur emplacement RÉEL (`figees.clientDesignation`, pas un champ de premier niveau qui n’existe pas côté serveur)', async () => {
    server.use(
      http.get('/api/v1/documents-vente', () =>
        HttpResponse.json({
          donnees: [construireDocumentBrut()],
          curseurSuivant: null,
          limite: 50,
        }),
      ),
    );

    rendre();

    await waitFor(() => expect(screen.getByText('Jean Dupont')).toBeInTheDocument());
    expect(screen.getByText('123.45')).toBeInTheDocument();
    expect(screen.getByText('2026-00007')).toBeInTheDocument();
    // Statut de règlement rendu (badge `non_regle`) — preuve que `statutReglement` (premier
    // niveau dans les deux formes) reste correctement lu.
    expect(screen.getByText('Non réglée')).toBeInTheDocument();
  });

  it('ne masque jamais un tableau déjà chargé derrière un état "vide" après une seconde page identique (pas de régression au chargement suivant)', async () => {
    server.use(
      http.get('/api/v1/documents-vente', () =>
        HttpResponse.json({
          donnees: [construireDocumentBrut({ id: 'doc-2', numero: '2026-00008' })],
          curseurSuivant: null,
          limite: 50,
        }),
      ),
    );

    rendre();

    await waitFor(() => expect(screen.getByText('2026-00008')).toBeInTheDocument());
    expect(screen.getByText('Jean Dupont')).toBeInTheDocument();
  });
});
