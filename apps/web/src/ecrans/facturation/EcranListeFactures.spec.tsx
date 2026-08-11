import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { ReponseDocumentVente } from '@dfa/shared';

import '@/i18n';

import { server } from '@/test/msw/server';
import { SESSION_TEST } from '@/test/msw/handlers';
import { creerQueryClientTest } from '@/test/utils';

import { EcranListeFactures } from './EcranListeFactures';

/** Même pattern que `EcranTableauBord.spec.tsx` : surcharge `GET /auth/moi` pour un rôle donné.
 *  Le handler global par défaut (`test/msw/handlers.ts`) répond 401 (« non connecté »), PAS
 *  `chef_atelier` — sans appel explicite à cette fonction, `useSession()` rend `data: null` et
 *  `role` reste `undefined`. Les tests d'AVANT l'ajout de la colonne « Retard » n'en avaient pas
 *  besoin (montant/statut ne dépendent pas du rôle dans cet écran) ; tout test qui vérifie la
 *  PRÉSENCE de la colonne « Retard » doit appeler cette fonction avec un rôle qui voit les
 *  montants. */
function connecterSession(role: (typeof SESSION_TEST)['utilisateur']['role']) {
  server.use(
    http.get('/api/v1/auth/moi', () =>
      HttpResponse.json({ ...SESSION_TEST, utilisateur: { ...SESSION_TEST.utilisateur, role } }),
    ),
  );
}

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
    // Montant/statut/retard sont des colonnes financières (voir `droits.ts`) : un rôle qui les
    // voit doit être connecté explicitement, même doctrine que la section « colonne Retard »
    // ci-dessous.
    connecterSession('chef_atelier');
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
    // `CHF` préfixe le montant (devise réelle du document, migration `0015`) — jamais un nombre nu.
    expect(screen.getByText('CHF 123.45')).toBeInTheDocument();
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

describe('EcranListeFactures — facture annulée par avoir', () => {
  it(
    'reste visible sur l’onglet « Toutes » (aucun filtre `statut` n’exclut ce document, voir la ' +
      "construction des filtres en tête de fichier) — l'écran ne doit jamais donner l'impression " +
      "qu'un document annulé n'a pas existé",
    async () => {
      connecterSession('chef_atelier');
      server.use(
        http.get('/api/v1/documents-vente', () =>
          HttpResponse.json({
            donnees: [construireDocumentBrut({ statut: 'annule_par_avoir', numero: '2026-00099' })],
            curseurSuivant: null,
            limite: 50,
          }),
        ),
      );

      rendre();
      await userEvent.setup().click(await screen.findByRole('tab', { name: 'Toutes' }));

      expect(await screen.findByText('2026-00099')).toBeInTheDocument();
    },
  );

  it(
    'affiche le badge « Annulée par avoir » dans la colonne Statut plutôt que le badge de ' +
      'règlement STALE — DÉFAUT CORRIGÉ : `statutReglement` sur un document annulé reste celui ' +
      "d'AVANT l'annulation (`RF-32` ne le nettoie pas côté serveur), l'afficher tel quel aurait " +
      'fait lire une créance déjà éteinte comme une dette active',
    async () => {
      connecterSession('chef_atelier');
      server.use(
        http.get('/api/v1/documents-vente', () =>
          HttpResponse.json({
            donnees: [
              construireDocumentBrut({
                statut: 'annule_par_avoir',
                statutReglement: 'partiel',
                numero: '2026-00099',
              }),
            ],
            curseurSuivant: null,
            limite: 50,
          }),
        ),
      );

      rendre();
      await userEvent.setup().click(await screen.findByRole('tab', { name: 'Toutes' }));
      await screen.findByText('2026-00099');

      expect(screen.getByText('Annulée par avoir')).toBeInTheDocument();
      expect(screen.queryByText('Partiellement réglée')).not.toBeInTheDocument();
      expect(screen.queryByText('Non réglée')).not.toBeInTheDocument();
    },
  );
});

describe('EcranListeFactures — brouillon', () => {
  it(
    'affiche le badge « Brouillon » dans la colonne Statut plutôt que « Non réglée » — DÉFAUT ' +
      "CORRIGÉ (issue #61, testeur novice) : `statutReglement: 'non_regle'` n'est qu'une valeur " +
      "PAR DÉFAUT tant que rien n'est émis, jamais le signal d'une créance due (`RF-68`, `statut` " +
      'et `statutReglement` sont deux colonnes délibérément indépendantes) — un brouillon sans ' +
      'numéro ni échéance ne doit jamais se présenter comme une facture impayée à relancer',
    async () => {
      connecterSession('chef_atelier');
      server.use(
        http.get('/api/v1/documents-vente', () =>
          HttpResponse.json({
            donnees: [
              construireDocumentBrut({
                statut: 'brouillon',
                statutReglement: 'non_regle',
                numero: null,
                numeroSequence: null,
                exercice: null,
                emisLe: null,
                emisPar: null,
              }),
            ],
            curseurSuivant: null,
            limite: 50,
          }),
        ),
      );

      rendre();
      await userEvent.setup().click(await screen.findByRole('tab', { name: 'Toutes' }));
      await screen.findByText('Jean Dupont');

      expect(screen.getByText('Brouillon')).toBeInTheDocument();
      expect(screen.queryByText('Non réglée')).not.toBeInTheDocument();
    },
  );
});

describe('EcranListeFactures — colonne Retard', () => {
  it('affiche "en retard de 20 jours" (alarme) pour une facture en retard', async () => {
    // Le handler par défaut de `/auth/moi` répond 401 (« non connecté », voir
    // `test/msw/handlers.ts`) — SANS session confirmée, `role` reste `undefined` et la colonne
    // « Retard » resterait absente quel que soit le contenu du document. Un rôle qui voit les
    // montants doit être connecté explicitement pour ces cas « colonne visible ».
    connecterSession('chef_atelier');
    server.use(
      http.get('/api/v1/documents-vente', () =>
        HttpResponse.json({
          donnees: [
            construireDocumentBrut({ dateEcheance: '2026-07-15', enRetard: true, joursRetard: 20 }),
          ],
          curseurSuivant: null,
          limite: 50,
        }),
      ),
    );

    rendre();

    expect(await screen.findByText('en retard de 20 jours')).toBeInTheDocument();
  });

  it("affiche l'échéance SANS alarme pour une facture à venir (enRetard: false)", async () => {
    connecterSession('chef_atelier');
    server.use(
      http.get('/api/v1/documents-vente', () =>
        HttpResponse.json({
          donnees: [
            construireDocumentBrut({
              dateEcheance: '2026-09-01',
              enRetard: false,
              joursRetard: null,
            }),
          ],
          curseurSuivant: null,
          limite: 50,
        }),
      ),
    );

    rendre();

    expect(await screen.findByText('Échéance : 01.09.2026')).toBeInTheDocument();
    // Jamais présenté comme un retard.
    expect(screen.queryByText(/en retard/)).not.toBeInTheDocument();
  });

  it('affiche un état neutre "Échéance inconnue" quand dateEcheance est null — jamais "à jour" ni "en retard"', async () => {
    connecterSession('chef_atelier');
    server.use(
      http.get('/api/v1/documents-vente', () =>
        HttpResponse.json({
          donnees: [
            construireDocumentBrut({ dateEcheance: null, enRetard: false, joursRetard: null }),
          ],
          curseurSuivant: null,
          limite: 50,
        }),
      ),
    );

    rendre();

    expect(await screen.findByText('Échéance inconnue')).toBeInTheDocument();
    expect(screen.queryByText(/en retard/)).not.toBeInTheDocument();
  });

  it('masque montant/statut/retard EN BLOC (en-tête compris) pour un rôle sans droit financier (technicien)', async () => {
    connecterSession('technicien');
    server.use(
      http.get('/api/v1/documents-vente', () =>
        HttpResponse.json({
          donnees: [
            construireDocumentBrut({
              dateEcheance: undefined,
              enRetard: undefined,
              joursRetard: undefined,
              statutReglement: undefined,
              totalTtcCentimes: undefined,
            }),
          ],
          curseurSuivant: null,
          limite: 50,
        }),
      ),
    );

    rendre();

    await screen.findByText('Jean Dupont');
    // Ni en-tête ni cellule pour AUCUNE des trois colonnes financières — le serveur masque déjà
    // les champs sous-jacents (`?:` absents), une colonne construite quand même rendrait un
    // tableau entièrement vide sur toutes les lignes plutôt que de disparaître.
    expect(screen.queryByRole('columnheader', { name: 'Retard' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Montant TTC' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Statut' })).not.toBeInTheDocument();
  });

  it('masque également montant/statut/retard pour poste_atelier', async () => {
    connecterSession('poste_atelier');
    server.use(
      http.get('/api/v1/documents-vente', () =>
        HttpResponse.json({
          donnees: [construireDocumentBrut({ dateEcheance: undefined, enRetard: undefined })],
          curseurSuivant: null,
          limite: 50,
        }),
      ),
    );

    rendre();

    await screen.findByText('Jean Dupont');
    expect(screen.queryByRole('columnheader', { name: 'Retard' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Montant TTC' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Statut' })).not.toBeInTheDocument();
  });

  it('affiche la colonne « Retard » pour un rôle qui voit les montants (chef_atelier)', async () => {
    connecterSession('chef_atelier');
    server.use(
      http.get('/api/v1/documents-vente', () =>
        HttpResponse.json({
          donnees: [
            construireDocumentBrut({ dateEcheance: '2026-07-15', enRetard: true, joursRetard: 3 }),
          ],
          curseurSuivant: null,
          limite: 50,
        }),
      ),
    );

    rendre();

    expect(await screen.findByRole('columnheader', { name: 'Retard' })).toBeInTheDocument();
  });
});
