import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';

import type {
  ReponseCommandeFournisseur,
  ReponseFactureFournisseur,
  ReponseFournisseur,
} from '@dfa/shared';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranDepotFactureFournisseur } from './EcranDepotFactureFournisseur';

/**
 * `<input type="file">` ne peut pas recevoir un fichier par un vrai clic utilisateur sous jsdom :
 * on cible directement l'`<input>` caché (`sr-only`) via son `aria-label` et on déclenche
 * `userEvent.upload` — même patron que `ecrans/scan/EcranScan.spec.tsx`.
 */
function fichierPdf(nom = 'facture.pdf', octets = 100): File {
  return new File([new Uint8Array(octets)], nom, { type: 'application/pdf' });
}

const SESSION_MAGASINIER = {
  ...SESSION_TEST,
  utilisateur: { ...SESSION_TEST.utilisateur, role: 'magasinier' as const },
};

const FACTURE_AVEC_ECART: ReponseFactureFournisseur = {
  id: 'facture-1',
  statut: 'rapprochee',
  document: {
    typeMime: 'application/pdf',
    tailleOctets: 100,
    empreinteSha256: 'abc',
    deposeParId: 'utilisateur-1',
    deposeLe: '2026-08-16T09:00:00.000Z',
  },
  fournisseurId: 'fourn-1',
  commandeFournisseurId: 'cmd-1',
  ibanCreancier: null,
  // Nom BRUT lu sur la facture — délibérément différent du nom CATALOGUE résolu (`ReponseFournisseur.nom`
  // ci-dessous), pour vérifier que les deux ne sont jamais confondus dans le rendu.
  nomCreancier: 'BOSCH AG',
  numeroFacture: 'F-2026-001',
  dateFacture: '2026-08-15',
  montantTotalCentimes: 11500,
  devise: 'CHF',
  referencePaiement: null,
  champsOrigine: {
    nomCreancier: 'qr',
    numeroFacture: 'qr',
    dateFacture: 'qr',
    montantTotalCentimes: 'qr',
  },
  lignes: [
    {
      id: 'ligne-1',
      numeroOrdre: 1,
      referenceArticle: 'REF-1',
      designation: 'Plaquette de frein',
      quantiteMillieme: 3000,
      prixUnitaireCentimes: 3500,
      totalLigneCentimes: 10500,
      origine: 'texte_pdf',
      articleId: 'article-1',
      commandeFournisseurLigneId: 'cmd-ligne-1',
      ecart: { prixUnitaireCentimes: 0, quantiteMillieme: 1000, totalCentimes: 3500 },
    },
  ],
  valideParId: null,
  valideLe: null,
  motifRejet: null,
  creeLe: '2026-08-16T09:00:00.000Z',
  modifieLe: '2026-08-16T09:00:00.000Z',
};

const COMMANDE_RAPPROCHEE: ReponseCommandeFournisseur = {
  id: 'cmd-1',
  fournisseurId: 'fourn-1',
  siteId: 'site-1',
  statut: 'envoyee',
  origine: 'manuelle',
  dateCommande: '2026-08-10',
  envoyeeLe: '2026-08-10T09:00:00.000Z',
  reference: 'BOSCH-4521',
  motifAnnulation: null,
  lignes: [
    {
      id: 'cmd-ligne-1',
      commandeFournisseurId: 'cmd-1',
      numeroOrdre: 1,
      articleId: 'article-1',
      quantiteCommandeeMillieme: 2000,
      quantiteRecueCumuleeMillieme: 0,
      quantiteReliquatMillieme: 2000,
      reliquatAnnuleLe: null,
      reliquatMotifAnnulation: null,
      prixAchatAttenduCentimes: 3500,
      ligneOrOrigineId: null,
    },
  ],
  lignesTronquees: false,
  creeLe: '2026-08-10T08:00:00.000Z',
  modifieLe: '2026-08-10T09:00:00.000Z',
};

const FOURNISSEUR: ReponseFournisseur = {
  id: 'fourn-1',
  nom: 'Bosch',
  email: null,
  telephone: null,
  delaiHabituelJours: null,
  statut: 'actif',
  creeLe: '2026-01-01T00:00:00.000Z',
  modifieLe: '2026-01-01T00:00:00.000Z',
};

function handlersSecondaires() {
  return [
    http.get('/api/v1/commandes-fournisseur/cmd-1', () => HttpResponse.json(COMMANDE_RAPPROCHEE)),
    http.get('/api/v1/fournisseurs/fourn-1', () => HttpResponse.json(FOURNISSEUR)),
  ];
}

function rendre() {
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/pieces/factures-fournisseur/deposer']}>
        <Routes>
          <Route
            path="/pieces/factures-fournisseur/deposer"
            element={<EcranDepotFactureFournisseur />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranDepotFactureFournisseur', () => {
  it('dépose une facture, affiche l’écart et le rapprochement résolu, puis valide', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_MAGASINIER)),
      http.post('/api/v1/factures-fournisseur', () =>
        HttpResponse.json(FACTURE_AVEC_ECART, { status: 201 }),
      ),
      http.post('/api/v1/factures-fournisseur/facture-1/valider', () =>
        HttpResponse.json({
          ...FACTURE_AVEC_ECART,
          statut: 'validee',
          valideLe: '2026-08-16T10:00:00.000Z',
        }),
      ),
      ...handlersSecondaires(),
    );

    rendre();

    const input = await screen.findByLabelText('Choisir un fichier');
    await userEvent.upload(input, fichierPdf());

    // Écart affiché de façon EXPLICITE (avertissement, jamais confondu avec une erreur bloquante).
    expect(await screen.findByText('1 ligne présente un écart à vérifier')).toBeInTheDocument();
    expect(screen.getByText('Écart de quantité')).toBeInTheDocument();

    // Rapprochement RÉSOLU (requêtes secondaires) : le nom CATALOGUE et la référence de commande
    // apparaissent, distincts du nom brut lu (`nomCreancier`, affiché séparément en en-tête).
    expect(await screen.findByText('Bosch')).toBeInTheDocument();
    expect(screen.getByText('BOSCH-4521')).toBeInTheDocument();
    expect(screen.getByText('BOSCH AG')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Valider la facture fournisseur' }));

    expect(await screen.findByText('Facture validée')).toBeInTheDocument();
  });

  it('refuse un fichier non-PDF avant tout envoi réseau', async () => {
    // Par le SÉLECTEUR de fichier, `accept="application/pdf,.pdf"` filtre déjà le choix côté
    // navigateur (et `userEvent.upload` respecte ce filtre — aucun `change` ne part pour un
    // fichier hors accept). Le glisser-déposer, lui, N'EST PAS filtré par `accept` : un fichier
    // de n'importe quel type peut atterrir sur la zone — c'est CE chemin que la garde cliente
    // (`validerFichier`) protège réellement, donc celui que ce test exerce (`fireEvent.drop`).
    let appele = false;
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_MAGASINIER)),
      http.post('/api/v1/factures-fournisseur', () => {
        appele = true;
        return HttpResponse.json(FACTURE_AVEC_ECART, { status: 201 });
      }),
    );

    rendre();

    const zone = await screen.findByTestId('zone-depot-facture-fournisseur');
    const fichierTexte = new File(['contenu'], 'facture.txt', { type: 'text/plain' });
    fireEvent.drop(zone, { dataTransfer: { files: [fichierTexte] } });

    expect(await screen.findByText('Seuls les fichiers PDF sont acceptés.')).toBeInTheDocument();
    expect(appele).toBe(false);
  });

  it('rôle sans droit de dépôt : message dédié, aucune zone de dépôt affichée', async () => {
    server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)));

    rendre();

    expect(
      await screen.findByText("Vous n'avez pas le droit de déposer une facture fournisseur."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Choisir un fichier')).not.toBeInTheDocument();
  });

  it('erreur serveur pendant la lecture : réessayable, jamais un faux succès', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_MAGASINIER)),
      http.post('/api/v1/factures-fournisseur', () =>
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

    const input = await screen.findByLabelText('Choisir un fichier');
    await userEvent.upload(input, fichierPdf());

    await waitFor(() => {
      expect(screen.getByText('Le dépôt a échoué')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
    // JAMAIS de faux succès : aucun contenu de rapprochement ne doit avoir fui dans le DOM.
    expect(screen.queryByText('Résultat de la lecture')).not.toBeInTheDocument();
  });
});
