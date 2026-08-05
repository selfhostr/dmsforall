import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { ReponseParametresPieces } from '@dfa/shared';

import '@/i18n';
import i18n from '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranParametragePieces } from './EcranParametragePieces';

// Radix Select appelle `hasPointerCapture`/`scrollIntoView` (absents de jsdom) — même stub que
// `EcranParametrageAtelier.spec.tsx`.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
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

const CHEMIN = '/api/v1/parametrage/pieces';

const PARAMETRES: ReponseParametresPieces = {
  conditionnementArticleDistinct: true,
  stockAutresSitesVisible: true,
  stockNegatifForcageAutorise: false,
  methodePrixAchat: null,
  seuilValeurAjustementSignificatifCentimes: null,
  delaiConsigneAcquisitionJours: null,
  tauxTvaConsignePourmille: 81,
};

function connecterSession(role: (typeof SESSION_TEST)['utilisateur']['role'] = 'chef_atelier') {
  server.use(
    http.get('/api/v1/auth/moi', () =>
      HttpResponse.json({ ...SESSION_TEST, utilisateur: { ...SESSION_TEST.utilisateur, role } }),
    ),
  );
}

function rendre() {
  const queryClient = creerQueryClientTest();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <EcranParametragePieces />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranParametragePieces', () => {
  it('affiche un squelette pendant le chargement', async () => {
    connecterSession('chef_atelier');
    server.use(
      http.get(CHEMIN, async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return HttpResponse.json(PARAMETRES);
      }),
    );
    rendre();

    expect(screen.getByText(i18n.t('commun:chargement.enCours'))).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByLabelText(i18n.t('parametrage:pieces.stock.stockAutresSitesVisible')),
      ).toBeInTheDocument(),
    );
  });

  it('affiche les valeurs actuelles, y compris les champs `null` (non arbitrés) et le réglage inerte (rôle habilité)', async () => {
    connecterSession('chef_atelier');
    server.use(http.get(CHEMIN, () => HttpResponse.json(PARAMETRES)));
    rendre();

    expect(
      await screen.findByLabelText(i18n.t('parametrage:pieces.stock.stockAutresSitesVisible')),
    ).toBeChecked();
    expect(
      screen.getByLabelText(i18n.t('parametrage:pieces.consigne.delaiAcquisitionJours')),
    ).toHaveValue(null);
    // `ChampInerte` combine libellé et raison dans un seul nœud texte (« libellé — raison ») —
    // recherche par sous-chaîne plutôt qu'un texte exact.
    expect(
      screen.getByText((contenu) =>
        contenu.includes(i18n.t('parametrage:pieces.conditionnement.articleDistinct')),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(i18n.t('parametrage:atelier.lectureSeule'))).not.toBeInTheDocument();
  });

  it("affiche un bandeau lecture seule et n'affiche pas le bouton enregistrer pour un rôle sans droit d'écriture (magasinier, lecture seule sur ce sous-domaine)", async () => {
    connecterSession('magasinier');
    server.use(http.get(CHEMIN, () => HttpResponse.json(PARAMETRES)));
    rendre();

    expect(await screen.findByText(i18n.t('parametrage:atelier.lectureSeule'))).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: i18n.t('commun:actions.enregistrer') }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByLabelText(i18n.t('parametrage:pieces.stock.stockAutresSitesVisible')),
    ).toBeDisabled();
  });

  it('enregistre une modification, y compris l’effacement explicite d’un champ `null`', async () => {
    connecterSession('direction');
    let corpsRecu: unknown;
    server.use(
      http.get(CHEMIN, () => HttpResponse.json(PARAMETRES)),
      http.patch(CHEMIN, async ({ request }) => {
        corpsRecu = await request.json();
        return HttpResponse.json({ ...PARAMETRES, stockNegatifForcageAutorise: true });
      }),
    );
    rendre();

    const caseForcage = await screen.findByLabelText(
      i18n.t('parametrage:pieces.stock.stockNegatifForcageAutorise'),
    );
    const utilisateur = userEvent.setup();
    await utilisateur.click(caseForcage);
    await utilisateur.click(
      screen.getByRole('button', { name: i18n.t('commun:actions.enregistrer') }),
    );

    expect(
      await screen.findByText(i18n.t('parametrage:pieces.enregistrementReussi')),
    ).toBeInTheDocument();
    expect(corpsRecu).toMatchObject({
      stockNegatifForcageAutorise: true,
      methodePrixAchat: null,
      delaiConsigneAcquisitionJours: null,
      seuilValeurAjustementSignificatifCentimes: null,
    });
  });

  it('affiche un état d’erreur actionnable sur une panne serveur', async () => {
    connecterSession('chef_atelier');
    server.use(
      http.get(CHEMIN, () =>
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

    expect(
      await screen.findByRole('button', { name: i18n.t('commun:actions.reessayer') }),
    ).toBeInTheDocument();
  });
});
