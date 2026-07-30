import type { ReponseRecherche } from '@dfa/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { server } from '@/test/msw/server';
import { renduAvecRoutes } from '@/test/utils';

import { EcranRecherche } from './EcranRecherche';

// cmdk (navigation clavier de CommandList, via PanneauResultatsRecherche) appelle
// `Element.scrollIntoView` — absent de jsdom — et `CommandList` observe sa hauteur via
// `ResizeObserver` — également absent. Même stub que `PanneauResultatsRecherche.spec.tsx`.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

const REPONSE_VEHICULE: ReponseRecherche = {
  plaqueInterchangeable: false,
  resultats: [
    {
      type: 'vehicule',
      id: 'v1',
      score: 0.9,
      correspondance: { champ: 'plaque', valeur: 'VD 123456', historique: false },
      resume: { plaque: 'VD 123456', designation: 'VW Touran 2.0 TDI' },
    },
  ],
};

const REPONSE_CLIENT: ReponseRecherche = {
  plaqueInterchangeable: false,
  resultats: [
    {
      type: 'client',
      id: 'c1',
      score: 0.9,
      correspondance: { champ: 'nom', valeur: 'Meier', historique: false },
      resume: { nom: 'Meier Hans', numeroClient: 'CL-042' },
    },
  ],
};

// Contrat de `chercherDocuments` (apps/api/src/recherche/service-recherche.ts, branche en cours
// d'écriture par l'agent propriétaire de ce module) : `resume` = numero/typeDocument/statut/
// clientNom/dateDocument, JAMAIS de clé monétaire (RF-116). On conçoit contre ce contrat, pas
// contre une implémentation figée.
const REPONSE_DOCUMENT_VENTE: ReponseRecherche = {
  plaqueInterchangeable: false,
  resultats: [
    {
      type: 'document_vente',
      id: 'd1',
      score: 1,
      correspondance: { champ: 'numero', valeur: 'FA-2026-000123', historique: false },
      resume: {
        numero: 'FA-2026-000123',
        typeDocument: 'facture',
        statut: 'emis',
        clientNom: 'Meier Hans',
        dateDocument: '15.03.2026',
      },
    },
  ],
};

function rendre(routeInitiale = '/recherche') {
  return renduAvecRoutes(
    [
      { path: '/recherche', element: <EcranRecherche /> },
      { path: '/clients/:id', element: <div>PAGE_CLIENT</div> },
      { path: '/vehicules/:id', element: <div>PAGE_VEHICULE</div> },
      { path: '/factures/:id', element: <div>PAGE_FACTURE</div> },
    ],
    { routeInitiale },
  );
}

describe('EcranRecherche', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it('au chargement, sans saisie : invite à taper, jamais "aucun résultat"', () => {
    rendre();
    expect(screen.getByText('Saisissez une plaque (VD 123456), un VIN, le nom du client ou un numéro de téléphone')).toBeInTheDocument();
    expect(screen.queryByText('Aucun résultat')).not.toBeInTheDocument();
  });

  it('recherche au fil de la frappe : affiche les résultats groupés une fois la saisie stabilisée', async () => {
    server.use(http.get('/api/v1/recherche', () => HttpResponse.json(REPONSE_VEHICULE)));
    rendre();

    const champ = screen.getByRole('combobox');
    await userEvent.setup().type(champ, 'VD 123456');

    expect(await screen.findByText(/VW Touran 2\.0 TDI/)).toBeInTheDocument();
    // L'invite a disparu dès qu'il y a une saisie, résultats ou pas.
    expect(
      screen.queryByText('Saisissez une plaque (VD 123456), un VIN, le nom du client ou un numéro de téléphone'),
    ).not.toBeInTheDocument();
  });

  it('aucun résultat pour la saisie : le message dédié du panneau, distinct de l’invite', async () => {
    server.use(
      http.get('/api/v1/recherche', () => HttpResponse.json({ plaqueInterchangeable: false, resultats: [] })),
    );
    rendre();

    await userEvent.setup().type(screen.getByRole('combobox'), 'introuvable');

    expect(await screen.findByText('Aucun résultat')).toBeInTheDocument();
  });

  it('sélectionner un résultat navigue vers sa fiche', async () => {
    server.use(http.get('/api/v1/recherche', () => HttpResponse.json(REPONSE_CLIENT)));
    rendre();

    await userEvent.setup().type(screen.getByRole('combobox'), 'Meier');
    await screen.findByText('Meier Hans');

    await userEvent.setup().click(screen.getByText('Meier Hans'));

    expect(await screen.findByText('PAGE_CLIENT')).toBeInTheDocument();
  });

  // ATTENDU ROUGE tant que `PanneauResultatsRecherche` (composants/recherche/, hors périmètre de
  // cet agent) ne rend pas de groupe pour `document_vente` — voir le rapport de fin de tâche.
  // Une fois le panneau câblé (composant `ResultatDocumentVente` + groupe dans le panneau, clé
  // i18n `recherche:resultatsGroupes.documents` posée), ce test doit passer sans modification.
  it('affiche un résultat document_vente avec sa nature et navigue vers la fiche facture', async () => {
    server.use(http.get('/api/v1/recherche', () => HttpResponse.json(REPONSE_DOCUMENT_VENTE)));
    rendre();

    await userEvent.setup().type(screen.getByRole('combobox'), 'FA-2026-000123');

    expect(await screen.findByText('FA-2026-000123')).toBeInTheDocument();
    // Nature du document — même badge que la fiche facture (BadgeTypeDocument), aucun montant.
    expect(screen.getByText('Facture')).toBeInTheDocument();

    await userEvent.setup().click(screen.getByText('FA-2026-000123'));

    expect(await screen.findByText('PAGE_FACTURE')).toBeInTheDocument();
  });

  it('erreur serveur : message actionnable avec retry, jamais un écran blanc', async () => {
    server.use(
      http.get('/api/v1/recherche', () =>
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

    await userEvent.setup().type(screen.getByRole('combobox'), 'VD 123456');

    expect(await screen.findByText("Une erreur interne s'est produite. Réessayez.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });

  it('traduit le titre de la page en allemand', async () => {
    await i18n.changeLanguage('de');
    rendre();
    expect(screen.getByRole('heading', { name: 'Suchen' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveAttribute('placeholder', 'Kennzeichen, VIN, Kunde, Tel… (Ctrl+K)'));
  });

  describe('propagation du site (?site=) au résultat sélectionné', () => {
    it('conserve `?site=` en ouvrant un résultat client', async () => {
      server.use(http.get('/api/v1/recherche', () => HttpResponse.json(REPONSE_CLIENT)));
      const { routeur } = rendre('/recherche?site=site-1');

      await userEvent.setup().type(screen.getByRole('combobox'), 'Meier');
      await userEvent.setup().click(await screen.findByText('Meier Hans'));

      expect(await screen.findByText('PAGE_CLIENT')).toBeInTheDocument();
      expect(routeur.state.location.pathname).toBe('/clients/c1');
      expect(routeur.state.location.search).toBe('?site=site-1');
    });

    it('conserve `?site=` en ouvrant un résultat véhicule', async () => {
      server.use(http.get('/api/v1/recherche', () => HttpResponse.json(REPONSE_VEHICULE)));
      const { routeur } = rendre('/recherche?site=site-1');

      await userEvent.setup().type(screen.getByRole('combobox'), 'VD 123456');
      await userEvent.setup().click(await screen.findByText(/VW Touran 2\.0 TDI/));

      expect(await screen.findByText('PAGE_VEHICULE')).toBeInTheDocument();
      expect(routeur.state.location.pathname).toBe('/vehicules/v1');
      expect(routeur.state.location.search).toBe('?site=site-1');
    });

    it('ne réinvente pas de `site` en ouvrant un résultat quand il est absent de l’URL', async () => {
      server.use(http.get('/api/v1/recherche', () => HttpResponse.json(REPONSE_CLIENT)));
      const { routeur } = rendre('/recherche');

      await userEvent.setup().type(screen.getByRole('combobox'), 'Meier');
      await userEvent.setup().click(await screen.findByText('Meier Hans'));

      expect(await screen.findByText('PAGE_CLIENT')).toBeInTheDocument();
      expect(routeur.state.location.search).toBe('');
    });
  });
});
