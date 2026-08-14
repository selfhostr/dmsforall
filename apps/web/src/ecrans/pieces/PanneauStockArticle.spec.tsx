import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
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

const STOCKS: StockResumeArticle[] = [
  { siteId: 'site-1', quantitePhysiqueMillieme: 10000, quantiteDisponibleMillieme: 10000 },
];

function rendre(peutModifierStock: boolean) {
  const queryClient = creerQueryClientTest();
  return render(
    <QueryClientProvider client={queryClient}>
      <PanneauStockArticle
        articleId="art-1"
        stocksResume={STOCKS}
        sites={SITES}
        peutModifierStock={peutModifierStock}
      />
    </QueryClientProvider>,
  );
}

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
