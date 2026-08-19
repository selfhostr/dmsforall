import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { ReponseApercuForcageMouvement, SiteResume } from '@dfa/shared';

import '@/i18n';
import i18n from '@/i18n';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { DialogueMouvementStock } from './DialogueMouvementStock';

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const SITES: readonly SiteResume[] = [
  { id: 'site-1', code: 'PRINCIPAL', nom: 'Site principal', actif: true },
];

const CHEMIN_APERCU = '/api/v1/articles/article-1/mouvements/apercu-forcage';

function rendre() {
  const queryClient = creerQueryClientTest();
  return render(
    <QueryClientProvider client={queryClient}>
      <DialogueMouvementStock
        ouvert
        onOuvertChange={() => {}}
        articleId="article-1"
        sites={SITES}
        siteParDefaut="site-1"
      />
    </QueryClientProvider>,
  );
}

function reponseApercu(
  reservations: ReponseApercuForcageMouvement['reservations'],
): ReponseApercuForcageMouvement {
  return { reservations };
}

/**
 * DÉFAUT CORRIGÉ (test manuel du 14.08.2026, défaut n°2) : « le dialogue de forçage n'avertit à
 * aucun moment » que des réservations actives seraient libérées — la libération n'était
 * journalisée qu'APRÈS coup (`motif = liberation_forcage_stock`), jamais montrée AVANT que
 * l'utilisateur ne coche « Forcer ». Ce bloc prouve le CÂBLAGE bout en bout de l'aperçu
 * (`GET .../mouvements/apercu-forcage`, interrogé UNIQUEMENT quand « Forcer » est coché) — le
 * calcul lui-même (quelles réservations, dans quel ordre) est prouvé côté serveur par
 * `service-mouvement.spec.ts` (describe `ServiceMouvement.apercuForcage`).
 */
describe('DialogueMouvementStock — avertissement de libération AVANT le forçage', () => {
  it('« Forcer » décoché : aucun appel à l’aperçu, aucun avertissement affiché', async () => {
    let appele = false;
    server.use(
      http.get(CHEMIN_APERCU, () => {
        appele = true;
        return HttpResponse.json(reponseApercu([]));
      }),
    );

    rendre();

    const utilisateur = userEvent.setup();
    await utilisateur.type(await screen.findByLabelText('Quantité*'), '5');

    expect(appele).toBe(false);
    expect(
      screen.queryByText(
        i18n.t('pieces:stock.mouvements.nouveauMouvement.apercuForcage.listeOrs', {
          numeros: '',
        }),
        { exact: false },
      ),
    ).not.toBeInTheDocument();
  });

  it('« Forcer » coché, l’aperçu rend des réservations menacées : l’avertissement est SPÉCIFIQUE ET CHIFFRÉ (nombre + numéros d’OR), jamais une phrase générale', async () => {
    server.use(
      http.get(CHEMIN_APERCU, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('siteId')).toBe('site-1');
        expect(url.searchParams.get('quantiteMillieme')).toBe('5000');
        return HttpResponse.json(
          reponseApercu([
            {
              id: 'resa-1',
              ligneOrId: 'ligne-1',
              ordreReparationId: 'or-1',
              ordreReparationNumero: 'OR-2026-0042',
              quantiteMillieme: 3000,
            },
            {
              id: 'resa-2',
              ligneOrId: 'ligne-2',
              ordreReparationId: 'or-2',
              ordreReparationNumero: 'OR-2026-0051',
              quantiteMillieme: 2000,
            },
          ]),
        );
      }),
    );

    rendre();

    const utilisateur = userEvent.setup();
    await utilisateur.type(await screen.findByLabelText('Quantité*'), '5');
    await utilisateur.click(
      screen.getByLabelText(i18n.t('pieces:stock.mouvements.nouveauMouvement.champForcer')),
    );

    expect(
      await screen.findByText(
        i18n.t('pieces:stock.mouvements.nouveauMouvement.apercuForcage.titre', { count: 2 }),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        i18n.t('pieces:stock.mouvements.nouveauMouvement.apercuForcage.listeOrs', {
          numeros: 'OR-2026-0042, OR-2026-0051',
        }),
      ),
    ).toBeInTheDocument();
  });

  it('« Forcer » coché, l’aperçu rend `reservations: []` (stock déjà suffisant) : AUCUN avertissement affiché', async () => {
    server.use(http.get(CHEMIN_APERCU, () => HttpResponse.json(reponseApercu([]))));

    rendre();

    const utilisateur = userEvent.setup();
    await utilisateur.type(await screen.findByLabelText('Quantité*'), '5');
    await utilisateur.click(
      screen.getByLabelText(i18n.t('pieces:stock.mouvements.nouveauMouvement.champForcer')),
    );

    await waitFor(() =>
      expect(
        screen.queryByText(
          i18n.t('pieces:stock.mouvements.nouveauMouvement.apercuForcage.chargement'),
        ),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByText(
        i18n.t('pieces:stock.mouvements.nouveauMouvement.apercuForcage.titre', { count: 1 }),
      ),
    ).not.toBeInTheDocument();
  });
});
