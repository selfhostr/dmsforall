import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FiltresDocumentsVente } from '@dfa/shared';

import '@/i18n';

import { creerQueryClientTest } from '@/test/utils';

import { EcranListeFactures } from './EcranListeFactures';

/**
 * Défaut corrigé (BLOQUANT) : les onglets « En retard » et « À relancer » rendaient un état vide
 * STATIQUE construit avant même de regarder le résultat de la requête (`donneeRetardIndisponible`),
 * et la construction des `filtres` ne posait AUCUN paramètre distinctif pour ces deux onglets — la
 * requête partait identique à celle de « Toutes ». Confirmé en navigateur sur le jeu de démo : les
 * factures `2026-00002` (176 jours de retard) et `2026-00001` (5 jours) s'affichaient correctement
 * sur « Toutes » mais ces deux onglets dédiés affichaient « tout est à jour ».
 *
 * Ces tests isolent exactement la responsabilité qui vit dans CE fichier (`EcranListeFactures.tsx`,
 * périmètre de cet agent) : construire le bon `FiltresDocumentsVente` par onglet et le faire
 * parvenir, via le VRAI `useListeDocumentsVente`, jusqu'à l'appel de `listerDocumentsVente`. Seule
 * la couche transport (`hooks/facturation/documents-vente.api.ts`, HORS périmètre de cet agent) est
 * doublée ici — volontairement, pour ne pas faire dépendre ce test de sa sérialisation d'URL.
 *
 * CORRIGÉ DEPUIS (vérifié en relisant `apps/web/src/hooks/facturation/documents-vente.api.ts` lors
 * du correctif « facture annulée par avoir visible dans le panneau d'encaissement ») : ce paragraphe
 * signalait autrefois que `construireParametres` n'ajoutait NI `enRetard` NI `relanceNiveau` à l'URL
 * réelle — ce n'est plus le cas, les deux sont sérialisés (`if (filtres.enRetard !== undefined) ...`,
 * `if (filtres.relanceNiveau !== undefined) ...`). Le doublage de `listerDocumentsVente` dans ce
 * fichier reste néanmoins volontaire : il isole la responsabilité de CET écran (construire le bon
 * `FiltresDocumentsVente` par onglet) de celle de la couche transport, déjà couverte séparément par
 * `hooks/facturation/documents-vente.api.spec.ts`.
 *
 * Un test qui se contenterait de vérifier le texte affiché resterait vert même si
 * `onglet === 'enRetard'` ne posait plus aucun filtre — d'où l'assertion directe sur l'argument
 * reçu par `listerDocumentsVente`, jamais un texte de substitution.
 */
const { listerDocumentsVenteMock } = vi.hoisted(() => ({
  listerDocumentsVenteMock: vi.fn(),
}));

vi.mock('@/hooks/facturation/documents-vente.api', () => ({
  listerDocumentsVente: listerDocumentsVenteMock,
}));

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

function dernierFiltres(): FiltresDocumentsVente {
  const appel = listerDocumentsVenteMock.mock.calls.at(-1) as
    readonly [FiltresDocumentsVente, unknown] | undefined;
  if (!appel) throw new Error('listerDocumentsVente jamais appelé.');
  return appel[0];
}

describe('EcranListeFactures — filtres réels par onglet', () => {
  beforeEach(() => {
    listerDocumentsVenteMock.mockReset();
    listerDocumentsVenteMock.mockResolvedValue({ donnees: [], curseurSuivant: null, limite: 50 });
  });

  it('pose enRetard=true et aucun relanceNiveau sur l’onglet « En retard »', async () => {
    const utilisateur = userEvent.setup();
    rendre();
    await waitFor(() => expect(listerDocumentsVenteMock).toHaveBeenCalled());

    await utilisateur.click(await screen.findByRole('tab', { name: 'En retard' }));

    await waitFor(() => {
      const filtres = dernierFiltres();
      expect(filtres.enRetard).toBe(true);
      expect(filtres.relanceNiveau).toBeUndefined();
    });
  });

  it(
    'pose enRetard=true ET relanceNiveau=0 sur l’onglet « À relancer » — choix cité dans ' +
      'EcranListeFactures.tsx : la primitive que `schemaFiltresDocumentsVente.relanceNiveau` ' +
      '(packages/shared/src/contrats/facturation/document.ts) désigne explicitement comme ' +
      'couvrant « déjà le cas usuel » « en retard, jamais relancée »',
    async () => {
      const utilisateur = userEvent.setup();
      rendre();
      await waitFor(() => expect(listerDocumentsVenteMock).toHaveBeenCalled());

      await utilisateur.click(await screen.findByRole('tab', { name: 'À relancer' }));

      await waitFor(() => {
        const filtres = dernierFiltres();
        expect(filtres.enRetard).toBe(true);
        expect(filtres.relanceNiveau).toBe(0);
      });
    },
  );

  it('ne pose ni enRetard ni relanceNiveau sur l’onglet « Toutes »', async () => {
    const utilisateur = userEvent.setup();
    rendre();
    await waitFor(() => expect(listerDocumentsVenteMock).toHaveBeenCalled());

    await utilisateur.click(await screen.findByRole('tab', { name: 'Toutes' }));

    await waitFor(() => {
      const filtres = dernierFiltres();
      expect(filtres.enRetard).toBeUndefined();
      expect(filtres.relanceNiveau).toBeUndefined();
    });
  });

  it(
    "ne pose AUCUN filtre `statut` sur l'onglet « Toutes » — une facture annulée par avoir doit " +
      "y rester visible (§ tête de fichier : l'écran ne doit jamais donner l'impression qu'un " +
      "document annulé n'a pas existé, correctif « facture annulée par avoir visible dans le " +
      'panneau d’encaissement »)',
    async () => {
      const utilisateur = userEvent.setup();
      rendre();
      await waitFor(() => expect(listerDocumentsVenteMock).toHaveBeenCalled());

      // Le défaut au premier rendu est « Non réglées » (§7.1), PAS « Toutes » — navigation
      // explicite, pour ne pas dépendre de l'ordre des tests ni du défaut de l'écran.
      await utilisateur.click(await screen.findByRole('tab', { name: 'Toutes' }));

      await waitFor(() => expect(dernierFiltres().statut).toBeUndefined());
    },
  );

  it(
    "pose statut=['emis'] sur l'onglet « Non réglées » (défaut au premier rendu) — DÉFAUT CORRIGÉ : " +
      '`statutReglement` seul ne suffit pas, une facture `annule_par_avoir` conserve le ' +
      "`statutReglement` d'AVANT son annulation (`RF-32` ne le nettoie pas côté serveur) et passait " +
      'ce filtre alors que sa dette est éteinte — voir `useFacturesOuvertesClient.spec.tsx` pour le ' +
      'même correctif côté panneau d’encaissement',
    async () => {
      rendre();

      await waitFor(() => {
        const filtres = dernierFiltres();
        expect(filtres.statut).toEqual(['emis']);
        expect(filtres.statutReglement).toEqual(['non_regle', 'partiel']);
      });
    },
  );

  it(
    "affiche l'état vide « aucune facture en retard » seulement APRÈS une réponse serveur " +
      'réellement vide — jamais avant, contrairement à l’ancien court-circuit statique ' +
      '(`donneeRetardIndisponible`) qui l’affichait sans avoir regardé le résultat de la requête',
    async () => {
      const utilisateur = userEvent.setup();
      rendre();
      await waitFor(() => expect(listerDocumentsVenteMock).toHaveBeenCalled());

      await utilisateur.click(await screen.findByRole('tab', { name: 'En retard' }));

      expect(
        await screen.findByText('Aucune facture en retard — tout est à jour.'),
      ).toBeInTheDocument();
      // Preuve que ce texte vient bien d'une réponse serveur passée par le filtre attendu, pas
      // d'un court-circuit qui l'aurait affiché quel que soit le filtre.
      expect(dernierFiltres().enRetard).toBe(true);
    },
  );

  it(
    "n'affiche PAS l'état vide sur l'onglet « En retard » quand la requête filtrée renvoie " +
      'des factures — preuve que le filtre change bien le résultat rendu, pas seulement l’objet ' +
      'passé en mémoire',
    async () => {
      listerDocumentsVenteMock.mockImplementation(async (filtres: FiltresDocumentsVente) => {
        if (filtres.enRetard) {
          return {
            donnees: [
              {
                id: 'doc-retard-1',
                typeDocument: 'facture',
                natureFacture: 'ordinaire',
                numero: '2026-00002',
                statut: 'emis',
                statutReglement: 'non_regle',
                clientId: 'cl-1',
                clientDesignation: 'Meier Urs',
                dateDocument: '2026-02-14',
                devise: 'CHF',
                totalTtcCentimes: 45000,
                soldeCentimes: 45000,
                dateEcheance: '2026-02-14',
                enRetard: true,
                joursRetard: 176,
              },
            ],
            curseurSuivant: null,
            limite: 50,
          };
        }
        return { donnees: [], curseurSuivant: null, limite: 50 };
      });
      const utilisateur = userEvent.setup();
      rendre();
      await waitFor(() => expect(listerDocumentsVenteMock).toHaveBeenCalled());

      await utilisateur.click(await screen.findByRole('tab', { name: 'En retard' }));

      expect(await screen.findByText('Meier Urs')).toBeInTheDocument();
      expect(
        screen.queryByText('Aucune facture en retard — tout est à jour.'),
      ).not.toBeInTheDocument();
    },
  );
});
