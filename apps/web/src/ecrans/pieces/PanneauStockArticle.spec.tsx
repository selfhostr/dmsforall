import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { SiteResume, StockResumeArticle } from '@dfa/shared';

import '@/i18n';
import i18n from '@/i18n';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { PanneauStockArticle } from './PanneauStockArticle';

const SITES: SiteResume[] = [
  { id: 'site-1', code: 'SION', nom: 'Garage Martin — Sion', actif: true },
];

function stock(champs: Partial<StockResumeArticle> = {}): StockResumeArticle {
  return {
    siteId: 'site-1',
    quantitePhysiqueMillieme: 10000,
    quantiteDisponibleMillieme: 10000,
    emplacement: null,
    rayon: null,
    tiroir: null,
    ...champs,
  };
}

const STOCKS: readonly StockResumeArticle[] = [stock()];

function rendre(peutModifierStock: boolean, stocksResume: readonly StockResumeArticle[] = STOCKS) {
  const queryClient = creerQueryClientTest();
  return render(
    <QueryClientProvider client={queryClient}>
      <PanneauStockArticle
        articleId="art-1"
        stocksResume={stocksResume}
        sites={SITES}
        peutModifierStock={peutModifierStock}
      />
    </QueryClientProvider>,
  );
}

describe('PanneauStockArticle — emplacement complet (0056), trois rendus distincts', () => {
  it('aucun rayon, aucun tiroir, aucun texte libre : mention explicite « aucun casier », jamais un tiret muet', () => {
    rendre(true, [stock()]);
    expect(screen.getByText('Aucun casier renseigné')).toBeInTheDocument();
  });

  it('texte libre seul : affiché tel quel', () => {
    rendre(true, [stock({ emplacement: 'étagère du fond' })]);
    expect(screen.getByText('étagère du fond')).toBeInTheDocument();
    expect(screen.queryByText('Aucun casier renseigné')).not.toBeInTheDocument();
  });

  it('casier structuré (rayon + tiroir), avec texte libre en plus : les deux coexistent', () => {
    rendre(true, [stock({ emplacement: 'accès par le fond', rayon: 'B3', tiroir: '2' })]);
    expect(screen.getByText('Rayon B3, tiroir 2 — accès par le fond')).toBeInTheDocument();
  });
});

describe('PanneauStockArticle — droit d’écriture (pieces.stock.modifier, magasinier/chef_atelier/direction)', () => {
  it('un rôle sans droit d’écriture ne voit AUCUN bouton « Modifier le casier »', () => {
    rendre(false, [stock({ rayon: 'B3' })]);
    expect(screen.queryByRole('button', { name: 'Modifier le casier' })).not.toBeInTheDocument();
  });

  it('un magasinier voit le bouton et peut ouvrir le dialogue de modification', async () => {
    rendre(true, [stock({ rayon: 'B3', tiroir: '2' })]);
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
          articleId: 'art-1',
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

    rendre(true, [stock()]);
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

/**
 * Ticket #121 — deuxième point de saisie (`ActionSeuilSite`), pour un article qui n'apparaît PAS
 * encore dans le réapprovisionnement (stock encore largement suffisant). Contrairement à
 * `EcranReapprovisionnement.CelluleSeuil`, aucune valeur actuelle n'est connue ici (pas de route
 * `GET` pour la lire) : ce bloc prouve que le champ part TOUJOURS vide, qu'un enregistrement à
 * vide ne part JAMAIS comme un retrait silencieux, et que la confirmation affichée après succès
 * est la vraie valeur renvoyée par le serveur.
 */
describe('PanneauStockArticle — seuil de réapprovisionnement par site (#121)', () => {
  it('sans le droit `pieces.stock.modifier`, aucun déclencheur de saisie du seuil', () => {
    rendre(false);

    expect(
      screen.queryByRole('button', {
        name: i18n.t('pieces:stock.seuilSite.actionAria', { nomSite: 'Garage Martin — Sion' }),
      }),
    ).not.toBeInTheDocument();
  });

  it('le champ part vide (aucune valeur actuelle connue) et enregistrer sans rien saisir affiche une erreur, sans envoyer de requête', async () => {
    rendre(true);
    let appele = false;
    server.use(
      http.patch('/api/v1/articles/art-1/stock/site-1', () => {
        appele = true;
        return HttpResponse.json({});
      }),
    );

    const utilisateur = userEvent.setup();
    await utilisateur.click(
      screen.getByRole('button', {
        name: i18n.t('pieces:stock.seuilSite.actionAria', { nomSite: 'Garage Martin — Sion' }),
      }),
    );

    const champ = await screen.findByLabelText(i18n.t('pieces:stock.seuilSite.champ'));
    expect(champ).toHaveValue('');

    await utilisateur.click(
      screen.getByRole('button', { name: i18n.t('commun:actions.enregistrer') }),
    );

    expect(
      await screen.findByText(i18n.t('pieces:stock.seuilSite.erreurVide')),
    ).toBeInTheDocument();
    expect(appele).toBe(false);
  });

  it('poser un seuil envoie la quantité saisie et affiche la confirmation avec la vraie valeur renvoyée', async () => {
    rendre(true);
    let corpsRecu: unknown;
    server.use(
      http.patch('/api/v1/articles/art-1/stock/site-1', async ({ request }) => {
        corpsRecu = await request.json();
        return HttpResponse.json({
          articleId: 'art-1',
          siteId: 'site-1',
          quantitePhysiqueMillieme: 10000,
          quantiteReserveeMillieme: 0,
          quantiteDisponibleMillieme: 10000,
          emplacement: null,
          rayon: null,
          tiroir: null,
          stockMinimumMillieme: 4000,
          quantiteCommandeStandardMillieme: null,
          modifieLe: '2026-08-13T00:00:00.000Z',
        });
      }),
    );

    const utilisateur = userEvent.setup();
    await utilisateur.click(
      screen.getByRole('button', {
        name: i18n.t('pieces:stock.seuilSite.actionAria', { nomSite: 'Garage Martin — Sion' }),
      }),
    );
    const champ = await screen.findByLabelText(i18n.t('pieces:stock.seuilSite.champ'));
    await utilisateur.type(champ, '4');
    await utilisateur.click(
      screen.getByRole('button', { name: i18n.t('commun:actions.enregistrer') }),
    );

    expect(corpsRecu).toEqual({ stockMinimumMillieme: 4000 });
    expect(
      await screen.findByText(i18n.t('pieces:stock.seuilSite.confirmationPosee', { valeur: '4' })),
    ).toBeInTheDocument();
  });

  it('« Retirer le seuil » envoie `null` sans exiger de saisie', async () => {
    rendre(true);
    let corpsRecu: unknown;
    server.use(
      http.patch('/api/v1/articles/art-1/stock/site-1', async ({ request }) => {
        corpsRecu = await request.json();
        return HttpResponse.json({
          articleId: 'art-1',
          siteId: 'site-1',
          quantitePhysiqueMillieme: 10000,
          quantiteReserveeMillieme: 0,
          quantiteDisponibleMillieme: 10000,
          emplacement: null,
          rayon: null,
          tiroir: null,
          stockMinimumMillieme: null,
          quantiteCommandeStandardMillieme: null,
          modifieLe: '2026-08-13T00:00:00.000Z',
        });
      }),
    );

    const utilisateur = userEvent.setup();
    await utilisateur.click(
      screen.getByRole('button', {
        name: i18n.t('pieces:stock.seuilSite.actionAria', { nomSite: 'Garage Martin — Sion' }),
      }),
    );
    await utilisateur.click(
      screen.getByRole('button', { name: i18n.t('pieces:stock.seuilSite.retirer') }),
    );

    expect(corpsRecu).toEqual({ stockMinimumMillieme: null });
    expect(
      await screen.findByText(i18n.t('pieces:stock.seuilSite.confirmationRetiree')),
    ).toBeInTheDocument();
  });
});
