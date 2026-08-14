import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, describe, expect, it } from 'vitest';

import type { ResultatRechercheComptoirArticle } from '@dfa/shared';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranRechercheComptoirPieces } from './EcranRechercheComptoirPieces';

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

const ARTICLE: ResultatRechercheComptoirArticle = {
  articleId: 'article-1',
  numeroArticle: 'P-000123',
  designation: 'Plaquettes de frein avant',
  referencePrincipale: '1K0698151',
  prixVenteTtcCentimes: 8900,
  quantiteDisponibleMillieme: 3000,
  emplacement: 'B3',
  rayon: null,
  tiroir: null,
  estEchangeStandard: false,
  montantConsigneTtcCentimes: null,
};

function resultats(disponibleMillieme: number): readonly ResultatRechercheComptoirArticle[] {
  return [{ ...ARTICLE, quantiteDisponibleMillieme: disponibleMillieme }];
}

function resultatsAvecCasier(
  champs: Partial<ResultatRechercheComptoirArticle>,
): readonly ResultatRechercheComptoirArticle[] {
  return [{ ...ARTICLE, quantiteDisponibleMillieme: 3000, ...champs }];
}

function rendre(role: (typeof SESSION_TEST)['utilisateur']['role'] = 'magasinier') {
  server.use(
    http.get('/api/v1/auth/moi', () =>
      HttpResponse.json({ ...SESSION_TEST, utilisateur: { ...SESSION_TEST.utilisateur, role } }),
    ),
  );
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/pieces/recherche-comptoir?site=site-1']}>
        <Routes>
          <Route path="/pieces/recherche-comptoir" element={<EcranRechercheComptoirPieces />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function rechercher(terme = '1K0698151') {
  const champ = screen.getByRole('searchbox');
  await userEvent.type(champ, terme);
  // Anti-rebond de `useRechercheComptoirPieces` (300 ms) + résolution de la requête.
  await screen.findByText('Plaquettes de frein avant', {}, { timeout: 2000 });
}

describe('EcranRechercheComptoirPieces — actions de comptoir', () => {
  it('masque entièrement les actions « Vendre » et « Retour client » sans le droit pieces.mouvement.creer', async () => {
    server.use(
      http.get('/api/v1/articles/recherche-comptoir', () => HttpResponse.json(resultats(3000))),
    );
    // chef_atelier n'a PAS pieces.mouvement.creer (magasinier seul, §11).
    rendre('chef_atelier');
    await rechercher();

    expect(screen.queryByRole('button', { name: 'Vendre sans facture' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retour client' })).not.toBeInTheDocument();
  });

  it('un magasinier voit les actions et peut vendre une pièce au comptoir', async () => {
    server.use(
      http.get('/api/v1/articles/recherche-comptoir', () => HttpResponse.json(resultats(3000))),
    );
    rendre('magasinier');
    await rechercher();

    expect(screen.getByRole('button', { name: 'Vendre sans facture' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retour client' })).toBeInTheDocument();
  });

  it('la vente sort la pièce (Idempotency-Key posée), le dialogue se ferme et la disponibilité affichée se rafraîchit', async () => {
    let requetesRecherche = 0;
    server.use(
      http.get('/api/v1/articles/recherche-comptoir', () => {
        requetesRecherche += 1;
        // Premier appel (recherche initiale) : 3 en stock. Tout appel SUIVANT (déclenché par
        // l'invalidation après la vente) : 2 en stock — preuve que l'écran se rafraîchit sans
        // action manuelle du magasinier.
        return HttpResponse.json(resultats(requetesRecherche === 1 ? 3000 : 2000));
      }),
    );
    let cleRecue: string | null = null;
    server.use(
      http.post('/api/v1/articles/:id/mouvements/sortie-comptoir', async ({ request }) => {
        cleRecue = request.headers.get('Idempotency-Key');
        return HttpResponse.json(
          {
            id: 'mvt-1',
            articleId: 'article-1',
            type: 'sortie_comptoir',
            quantiteMillieme: -1000,
            siteId: 'site-1',
            siteSourceId: null,
            siteDestinationId: null,
            prixAchatReelCentimes: null,
            auteurId: 'utilisateur-1',
            motif: null,
            ligneOrId: null,
            documentVenteLigneId: null,
            commandeFournisseurLigneId: null,
            inventaireReferenceId: null,
            reservationId: null,
            creeLe: '2026-08-05T09:00:00.000Z',
          },
          { status: 201 },
        );
      }),
    );

    rendre('magasinier');
    await rechercher();

    await userEvent.click(screen.getByRole('button', { name: 'Vendre sans facture' }));
    expect(await screen.findByText('Sortie comptoir — sans facture')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Sortir la pièce' }));

    await waitFor(() =>
      expect(screen.queryByText('Sortie comptoir — sans facture')).not.toBeInTheDocument(),
    );
    expect(cleRecue).not.toBeNull();
    await waitFor(() => expect(screen.getByText('2 en stock')).toBeInTheDocument());
  });

  /**
   * Défaut corrigé (rapport de test du 06.08.2026, n°3) : le montant affiché dans « Vendre sans
   * facture » restait figé au PRIX UNITAIRE (CHF 89.00 pour `ARTICLE`) quel que soit le nombre de
   * pièces saisi — un magasinier pressé pouvait croire qu'il vendait 2 pièces pour le prix d'une.
   * Le total DOIT suivre la quantité, et le prix unitaire doit rester lisible séparément.
   */
  it('« Vendre sans facture » : le total TTC suit la quantité saisie, le prix unitaire reste affiché à part', async () => {
    server.use(
      http.get('/api/v1/articles/recherche-comptoir', () => HttpResponse.json(resultats(3000))),
    );

    rendre('magasinier');
    await rechercher();

    await userEvent.click(screen.getByRole('button', { name: 'Vendre sans facture' }));
    await screen.findByText('Sortie comptoir — sans facture');

    // Quantité par défaut (1) : prix unitaire et total TTC coïncident.
    expect(screen.getByText('Prix unitaire TTC')).toBeInTheDocument();
    expect(screen.getByText('Total TTC')).toBeInTheDocument();
    const champQuantite = screen.getByLabelText('Quantité');
    expect(champQuantite).toHaveValue('1');
    const zonePrixUnitaire = screen.getByText('Prix unitaire TTC').closest('div')!;
    const zoneTotal = screen.getByText('Total TTC').closest('div')!;
    expect(zonePrixUnitaire).toHaveTextContent('89.00');
    expect(zoneTotal).toHaveTextContent('89.00');

    // Quantité à 2 : le total se recalcule (178.00), le prix unitaire ne bouge pas (89.00).
    await userEvent.clear(champQuantite);
    await userEvent.type(champQuantite, '2');
    await waitFor(() => expect(zoneTotal).toHaveTextContent('178.00'));
    expect(zonePrixUnitaire).toHaveTextContent('89.00');
  });

  it('un refus pour stock insuffisant affiche combien il reste, pas « erreur 409 »', async () => {
    let requetesRecherche = 0;
    server.use(
      http.get('/api/v1/articles/recherche-comptoir', () => {
        requetesRecherche += 1;
        // La recherche initiale annonçait 3 — le refus serveur simule une concurrence entre la
        // recherche et la confirmation ; le refetch après le refus révèle qu'il n'en reste qu'1.
        return HttpResponse.json(resultats(requetesRecherche === 1 ? 3000 : 1000));
      }),
    );
    server.use(
      http.post('/api/v1/articles/:id/mouvements/sortie-comptoir', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/STOCK_INSUFFISANT',
            title: 'Stock insuffisant',
            status: 409,
            code: 'STOCK_INSUFFISANT',
            instance: 'req-1',
          },
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    rendre('magasinier');
    await rechercher();

    await userEvent.click(screen.getByRole('button', { name: 'Vendre sans facture' }));
    await screen.findByText('Sortie comptoir — sans facture');
    await userEvent.click(screen.getByRole('button', { name: 'Sortir la pièce' }));

    // Le message métier dédié apparaît (jamais le texte générique d'erreur), et se corrige tout
    // seul dès que le rafraîchissement automatique révèle la quantité réelle.
    expect(await screen.findByText('Stock insuffisant : il reste 1 en stock.')).toBeInTheDocument();
    expect(screen.queryByText(/erreur/i, { selector: '[role="alert"]' })).not.toBeInTheDocument();
    // Le dialogue reste ouvert (le refus n'est pas traité comme un succès).
    expect(screen.getByText('Sortie comptoir — sans facture')).toBeInTheDocument();
  });

  it('un magasinier peut enregistrer un retour client', async () => {
    server.use(
      http.get('/api/v1/articles/recherche-comptoir', () => HttpResponse.json(resultats(3000))),
    );
    let corpsRecu: unknown;
    server.use(
      http.post('/api/v1/articles/:id/mouvements/retour-client', async ({ request }) => {
        corpsRecu = await request.json();
        return HttpResponse.json(
          {
            id: 'mvt-retour-1',
            articleId: 'article-1',
            type: 'retour_client',
            quantiteMillieme: 1000,
            siteId: 'site-1',
            siteSourceId: null,
            siteDestinationId: null,
            prixAchatReelCentimes: null,
            auteurId: 'utilisateur-1',
            motif: 'Pièce non montée',
            ligneOrId: null,
            documentVenteLigneId: null,
            commandeFournisseurLigneId: null,
            inventaireReferenceId: null,
            reservationId: null,
            creeLe: '2026-08-05T09:00:00.000Z',
          },
          { status: 201 },
        );
      }),
    );

    rendre('magasinier');
    await rechercher();

    await userEvent.click(screen.getByRole('button', { name: 'Retour client' }));
    expect(await screen.findByRole('heading', { name: 'Retour client' })).toBeInTheDocument();

    const champMotif = screen.getByLabelText('Motif du retour *');
    await userEvent.type(champMotif, 'Pièce non montée');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer le retour' }));

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Retour client' })).not.toBeInTheDocument(),
    );
    expect(corpsRecu).toEqual({
      siteId: 'site-1',
      quantiteMillieme: 1000,
      motif: 'Pièce non montée',
    });
  });
});

describe('EcranRechercheComptoirPieces — emplacement complet (0056), trois rendus distincts', () => {
  it('aucun rayon, aucun tiroir, aucun texte libre : rien n’est affiché (jamais un tiret muet)', async () => {
    server.use(
      http.get('/api/v1/articles/recherche-comptoir', () =>
        HttpResponse.json(resultatsAvecCasier({ emplacement: null, rayon: null, tiroir: null })),
      ),
    );
    rendre('magasinier');
    await rechercher();

    expect(screen.queryByText(/rayon/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/tiroir/i)).not.toBeInTheDocument();
  });

  it('texte libre seul (rayon et tiroir absents) : le texte libre est affiché tel quel', async () => {
    server.use(
      http.get('/api/v1/articles/recherche-comptoir', () =>
        HttpResponse.json(
          resultatsAvecCasier({ emplacement: 'étagère du fond', rayon: null, tiroir: null }),
        ),
      ),
    );
    rendre('magasinier');
    await rechercher();

    expect(await screen.findByText('étagère du fond')).toBeInTheDocument();
  });

  it('casier structuré (rayon + tiroir), sans texte libre : « Rayon B3, tiroir 2 »', async () => {
    server.use(
      http.get('/api/v1/articles/recherche-comptoir', () =>
        HttpResponse.json(resultatsAvecCasier({ emplacement: null, rayon: 'B3', tiroir: '2' })),
      ),
    );
    rendre('magasinier');
    await rechercher();

    expect(await screen.findByText('Rayon B3, tiroir 2')).toBeInTheDocument();
  });

  it('casier structuré ET texte libre en plus : les deux coexistent dans le même rendu', async () => {
    server.use(
      http.get('/api/v1/articles/recherche-comptoir', () =>
        HttpResponse.json(
          resultatsAvecCasier({ emplacement: 'accès par le fond', rayon: 'B3', tiroir: '2' }),
        ),
      ),
    );
    rendre('magasinier');
    await rechercher();

    expect(await screen.findByText('Rayon B3, tiroir 2 — accès par le fond')).toBeInTheDocument();
  });
});
