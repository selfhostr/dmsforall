import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { DocumentVenteResume, ReponseDocumentVente, ReponseDossierVente } from '@dfa/shared';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranFicheDossierVente } from './EcranFicheDossierVente';

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const CLIENT_ACHETEUR = {
  id: 'client-1',
  numeroClient: 'CL-0001',
  nomAffiche: 'Jean Dupont',
  type: 'particulier' as const,
  statut: 'actif' as const,
  langueCorrespondance: 'fr' as const,
  poObligatoire: false,
  telephone: null,
  localite: null,
  nombreVehicules: 0,
  dernierPassageLe: null,
};

const DOSSIER: ReponseDossierVente = {
  id: 'dossier-1',
  siteId: 'site-1',
  statut: 'prospection',
  typeVehicule: null,
  vehicule: null,
  clientAcheteur: CLIENT_ACHETEUR,
  clientFacture: CLIENT_ACHETEUR,
  clientConducteur: null,
  reprise: null,
  financement: null,
  financements: [],
  financementsTronques: false,
  documents: [],
  documentsTronques: false,
  documentsRequis: [],
  identitePieceType: null,
  identiteVerifieeLe: null,
  dateLivraisonEstimee: null,
  dateLivraisonEffective: null,
  kilometrageDepart: null,
  prospectionLe: '2026-08-01T08:00:00.000Z',
  engageLe: null,
  enPreparationLe: null,
  pretALivrerLe: null,
  livreLe: null,
  closLe: null,
  annuleLe: null,
  abandonneLe: null,
  motifCloture: null,
  actionsDisponibles: ['modifier', 'engager', 'annuler', 'abandonner'],
  version: 1,
  creeLe: '2026-08-01T08:00:00.000Z',
  modifieLe: '2026-08-01T08:00:00.000Z',
  modifiePar: null,
};

/** Fixture minimale mais complète (tous les champs non-optionnels de `ReponseDocumentVente`) — le
 *  document renvoyé par `POST /documents-vente` lors du rattachement d'un bon de commande (RV-37,
 *  voir `useCreerBonCommandeDossier`). Champs financiers volontairement absents (comme un
 *  brouillon fraîchement créé, `MD-19`) plutôt qu'à `0`. */
function construireBonCommande(): ReponseDocumentVente {
  return {
    id: 'doc-bc-1',
    typeDocument: 'bon_commande',
    natureFacture: null,
    origine: 'dfa',
    numero: null,
    numeroSequence: null,
    numeroOrigine: null,
    exercice: null,
    statut: 'brouillon',
    siteId: 'site-1',
    clientId: 'client-1',
    vehiculeId: null,
    ordreReparationId: null,
    dossierVenteId: 'dossier-1',
    documentSourceId: null,
    factureAnnuleeId: null,
    annuleParAvoirId: null,
    remplaceId: null,
    figees: {
      clientDesignation: 'Jean Dupont',
      clientIde: null,
      clientLangue: 'fr',
      adresseFacturation: null,
      plaque: null,
    },
    dateDocument: '2026-08-04',
    devise: 'CHF',
    tvaNonVentilee: false,
    tauxTvaPourmilleDocument: null,
    mentionTvaInterdite: false,
    remiseGlobaleSaisieCentimes: null,
    remiseGlobalePourmille: null,
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
    emisLe: null,
    emisPar: null,
    creeLe: '2026-08-04T09:00:00.000Z',
    modifieLe: '2026-08-04T09:00:00.000Z',
    modifiePar: null,
  };
}

function projeterResumeDocument(document: ReponseDocumentVente): DocumentVenteResume {
  return {
    id: document.id,
    typeDocument: document.typeDocument,
    natureFacture: document.natureFacture,
    numero: document.numero,
    statut: document.statut,
    clientId: document.clientId,
    clientDesignation: document.figees.clientDesignation,
    dateDocument: document.dateDocument,
    devise: document.devise,
  };
}

function rendre(role: (typeof SESSION_TEST)['utilisateur']['role'] = 'vendeur') {
  server.use(
    http.get('/api/v1/auth/moi', () =>
      HttpResponse.json({ ...SESSION_TEST, utilisateur: { ...SESSION_TEST.utilisateur, role } }),
    ),
  );
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/ventes/dossiers/dossier-1']}>
        <Routes>
          <Route path="/ventes/dossiers/:id" element={<EcranFicheDossierVente />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranFicheDossierVente', () => {
  it('affiche la fiche avec le client, le statut et les actions de transition', async () => {
    server.use(http.get('/api/v1/dossiers-vente/dossier-1', () => HttpResponse.json(DOSSIER)));

    rendre();

    expect(await screen.findByText('Jean Dupont')).toBeInTheDocument();
    expect(screen.getAllByText('Prospection').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Engager' })).toBeInTheDocument();
    expect(screen.getByText('Pas de reprise sur ce dossier')).toBeInTheDocument();
    expect(screen.getByText('Aucun financement en cours.')).toBeInTheDocument();
  });

  it('état erreur : message actionnable avec retry', async () => {
    server.use(
      http.get('/api/v1/dossiers-vente/dossier-1', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/ERREUR_INTERNE',
            title: 'Erreur interne',
            status: 500,
            code: 'ERREUR_INTERNE',
            instance: 'req-1',
          },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    rendre();

    expect(await screen.findByText("Impossible d'afficher ce dossier")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });

  // Non-régression RV-37 : jusqu'ici `document_vente.dossier_vente_id` n'était jamais écrit depuis
  // le front, donc `dossier.documents.filter(d => d.typeDocument === 'bon_commande')` restait
  // TOUJOURS vide et `engager` (qui exige `bonCommandeDocumentId`) était inatteignable. Ce test
  // exerce le chemin de bout en bout : dialogue « Engager » ouvert sur un dossier SANS document ->
  // clic « Créer le bon de commande » -> `POST /documents-vente` porte `dossierVenteId` -> le
  // dossier refetché fait apparaître le bon de commande, le sélecteur cesse d'être vide.
  it('un dossier sans document : « Créer le bon de commande » le rattache et fait sortir le sélecteur de son état vide', async () => {
    let documentsDossier: readonly DocumentVenteResume[] = [];
    let corpsRecu: Record<string, unknown> | undefined;

    server.use(
      http.get('/api/v1/dossiers-vente/dossier-1', () =>
        HttpResponse.json({ ...DOSSIER, documents: documentsDossier }),
      ),
      http.post('/api/v1/documents-vente', async ({ request }) => {
        corpsRecu = (await request.json()) as Record<string, unknown>;
        const document = construireBonCommande();
        documentsDossier = [projeterResumeDocument(document)];
        return HttpResponse.json({ donnees: document, avertissements: [] });
      }),
    );

    rendre();
    const utilisateur = userEvent.setup();

    await utilisateur.click(await screen.findByRole('button', { name: 'Engager' }));
    expect(screen.getByText('Aucun bon de commande sur ce dossier')).toBeInTheDocument();

    await utilisateur.click(screen.getByRole('button', { name: 'Créer le bon de commande' }));

    await waitFor(() => expect(corpsRecu).toBeDefined());
    expect(corpsRecu).toMatchObject({
      typeDocument: 'bon_commande',
      dossierVenteId: 'dossier-1',
      siteId: 'site-1',
      clientId: 'client-1',
    });

    // Le dossier refetché (invalidation post-création) porte désormais le bon de commande : le
    // message d'état vide disparaît au profit du sélecteur.
    await waitFor(() =>
      expect(screen.queryByText('Aucun bon de commande sur ce dossier')).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('combobox', { name: 'Bon de commande' })).toBeInTheDocument();
  });

  // Non-régression : le refus serveur documenté (dossier clos/annulé/abandonné, RV-37) s'affiche
  // avec un message actionnable — pas un échec silencieux ni un `ERREUR_INTERNE` générique.
  it('rattachement refusé par le serveur (409) : message explicite, pas un échec silencieux', async () => {
    server.use(
      http.get('/api/v1/dossiers-vente/dossier-1', () => HttpResponse.json(DOSSIER)),
      http.post('/api/v1/documents-vente', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/DOCUMENT_DOSSIER_VENTE_RATTACHEMENT_REFUSE',
            title: 'Rattachement au dossier de vente refusé',
            status: 409,
            code: 'DOCUMENT_DOSSIER_VENTE_RATTACHEMENT_REFUSE',
            instance: 'req-1',
          },
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    rendre();
    const utilisateur = userEvent.setup();

    await utilisateur.click(await screen.findByRole('button', { name: 'Engager' }));
    await utilisateur.click(screen.getByRole('button', { name: 'Créer le bon de commande' }));

    expect(
      await screen.findByText(
        'Ce dossier de vente est clos, annulé ou abandonné. Aucun document ne peut lui être rattaché.',
      ),
    ).toBeInTheDocument();
  });
});
