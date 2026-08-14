import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { StockResumeArticle } from '@dfa/shared';

import '@/i18n';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { PanneauStockArticle } from './PanneauStockArticle';

const SITES = [{ id: 'site-1', code: 'PRINCIPAL', nom: 'Site principal', actif: true }];

function stock(champs: Partial<StockResumeArticle> = {}): StockResumeArticle {
  return {
    siteId: 'site-1',
    quantitePhysiqueMillieme: 5000,
    quantiteDisponibleMillieme: 4000,
    emplacement: null,
    rayon: null,
    tiroir: null,
    ...champs,
  };
}

function rendre(
  stocksResume: readonly StockResumeArticle[],
  role: 'magasinier' | 'vendeur' = 'magasinier',
) {
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <PanneauStockArticle
        articleId="article-1"
        stocksResume={stocksResume}
        sites={SITES}
        role={role}
      />
    </QueryClientProvider>,
  );
}

describe('PanneauStockArticle — emplacement complet (0056), trois rendus distincts', () => {
  it('aucun rayon, aucun tiroir, aucun texte libre : mention explicite « aucun casier », jamais un tiret muet', () => {
    rendre([stock()]);
    expect(screen.getByText('Aucun casier renseigné')).toBeInTheDocument();
  });

  it('texte libre seul : affiché tel quel', () => {
    rendre([stock({ emplacement: 'étagère du fond' })]);
    expect(screen.getByText('étagère du fond')).toBeInTheDocument();
    expect(screen.queryByText('Aucun casier renseigné')).not.toBeInTheDocument();
  });

  it('casier structuré (rayon + tiroir), avec texte libre en plus : les deux coexistent', () => {
    rendre([stock({ emplacement: 'accès par le fond', rayon: 'B3', tiroir: '2' })]);
    expect(screen.getByText('Rayon B3, tiroir 2 — accès par le fond')).toBeInTheDocument();
  });
});

describe('PanneauStockArticle — droit d’écriture (pieces.stock.modifier, magasinier/chef_atelier/direction)', () => {
  it('un rôle sans droit d’écriture ne voit AUCUN bouton « Modifier le casier »', () => {
    rendre([stock({ rayon: 'B3' })], 'vendeur');
    expect(screen.queryByRole('button', { name: 'Modifier le casier' })).not.toBeInTheDocument();
  });

  it('un magasinier voit le bouton et peut ouvrir le dialogue de modification', async () => {
    rendre([stock({ rayon: 'B3', tiroir: '2' })], 'magasinier');
    await userEvent.click(screen.getByRole('button', { name: 'Modifier le casier' }));

    expect(await screen.findByRole('heading', { name: /Casier de rangement/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Rayon')).toHaveValue('B3');
    expect(screen.getByLabelText('Tiroir')).toHaveValue('2');
  });
});

describe('PanneauStockArticle — modification du casier (PATCH .../stock/{siteId})', () => {
  it('la saisie est envoyée telle quelle, le dialogue se ferme et l’affichage se met à jour après succès', async () => {
    let corpsRecu: unknown;
    server.use(
      http.patch('/api/v1/articles/:articleId/stock/:siteId', async ({ request }) => {
        corpsRecu = await request.json();
        return HttpResponse.json({
          articleId: 'article-1',
          siteId: 'site-1',
          quantitePhysiqueMillieme: 5000,
          quantiteReserveeMillieme: 1000,
          quantiteDisponibleMillieme: 4000,
          emplacement: null,
          rayon: 'B3',
          tiroir: '2',
          stockMinimumMillieme: null,
          quantiteCommandeStandardMillieme: null,
          modifieLe: '2026-08-14T09:00:00.000Z',
        });
      }),
    );

    rendre([stock()], 'magasinier');
    await userEvent.click(screen.getByRole('button', { name: 'Modifier le casier' }));
    await screen.findByRole('heading', { name: /Casier de rangement/ });

    await userEvent.type(screen.getByLabelText('Rayon'), 'b3');
    await userEvent.type(screen.getByLabelText('Tiroir'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: /Casier de rangement/ }),
      ).not.toBeInTheDocument(),
    );
    expect(corpsRecu).toEqual({ rayon: 'b3', tiroir: '2' });
  });
});
