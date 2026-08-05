import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { ReponseActiviteTableauBord, ReponseFinancierTableauBord } from '@dfa/shared';

import '@/i18n';
import i18n from '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranTableauBord } from './EcranTableauBord';

const CHEMIN_ACTIVITE = '/api/v1/tableau-bord/activite';
const CHEMIN_FINANCIER = '/api/v1/tableau-bord/financier';

const PERIODE = { du: '2026-08-01', au: '2026-08-05' };

const ACTIVITE_NOMINALE: ReponseActiviteTableauBord = {
  periode: PERIODE,
  siteId: null,
  ordresReparationParStatut: [
    { statut: 'planifie', nombre: 2 },
    { statut: 'ouvert', nombre: 3 },
    { statut: 'en_cours', nombre: 5 },
    { statut: 'controle', nombre: 1 },
    { statut: 'termine', nombre: 4 },
    { statut: 'facture', nombre: 2 },
  ],
  ordresReparationOuvertsPeriode: 12,
  ordresReparationRestituesPeriode: 9,
  delaiMoyenRestitutionMinutes: 200,
  lignesEnAttenteValidation: 4,
  articlesSousSeuilReapprovisionnement: 7,
};

const ACTIVITE_VIDE: ReponseActiviteTableauBord = {
  periode: PERIODE,
  siteId: null,
  ordresReparationParStatut: [
    { statut: 'planifie', nombre: 0 },
    { statut: 'ouvert', nombre: 0 },
    { statut: 'en_cours', nombre: 0 },
    { statut: 'controle', nombre: 0 },
    { statut: 'termine', nombre: 0 },
    { statut: 'facture', nombre: 0 },
  ],
  ordresReparationOuvertsPeriode: 0,
  ordresReparationRestituesPeriode: 0,
  delaiMoyenRestitutionMinutes: null,
  lignesEnAttenteValidation: 0,
  articlesSousSeuilReapprovisionnement: 0,
};

const FINANCIER_NOMINAL: ReponseFinancierTableauBord = {
  periode: PERIODE,
  siteId: null,
  chiffreAffaires: {
    totalHtCentimes: 114300,
    totalTvaCentimes: 9150,
    totalTtcCentimes: 123450,
    nombreDocuments: 6,
  },
  encaissementsCentimes: 98700,
  encoursClientsCentimes: 45600,
};

const FINANCIER_VIDE: ReponseFinancierTableauBord = {
  periode: PERIODE,
  siteId: null,
  chiffreAffaires: {
    totalHtCentimes: 0,
    totalTvaCentimes: 0,
    totalTtcCentimes: 0,
    nombreDocuments: 0,
  },
  encaissementsCentimes: 0,
  encoursClientsCentimes: 0,
};

function connecterSession(role: (typeof SESSION_TEST)['utilisateur']['role'] = 'direction') {
  server.use(
    http.get('/api/v1/auth/moi', () =>
      HttpResponse.json({ ...SESSION_TEST, utilisateur: { ...SESSION_TEST.utilisateur, role } }),
    ),
  );
}

function rendre(routeInitiale = '/tableau-bord') {
  const queryClient = creerQueryClientTest();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[routeInitiale]}>
        <Routes>
          <Route path="/tableau-bord" element={<EcranTableauBord />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranTableauBord — affichage nominal (direction)', () => {
  it('affiche les deux blocs avec des données réalistes, montants et durée formatés', async () => {
    connecterSession('direction');
    server.use(
      http.get(CHEMIN_ACTIVITE, () => HttpResponse.json(ACTIVITE_NOMINALE)),
      http.get(CHEMIN_FINANCIER, () => HttpResponse.json(FINANCIER_NOMINAL)),
    );

    rendre();

    // Ancre de fin de chargement : ce titre n'existe QUE dans la branche « données chargées »
    // du bloc activité (contrairement à `tableauBord:activite.titre`, présent aussi bien dans le
    // squelette de chargement que dans l'état d'erreur — un `findByText` dessus résoudrait trop
    // tôt, avant que les indicateurs ne soient réellement rendus).
    expect(
      await screen.findByText(i18n.t('tableauBord:activite.repartitionStatuts.titre')),
    ).toBeInTheDocument();
    expect(screen.getByText(i18n.t('tableauBord:financier.titre'))).toBeInTheDocument();

    // Délai moyen de restitution : 200 min -> "3 h 20".
    expect(screen.getByText('3 h 20')).toBeInTheDocument();

    // Montants suisses : "1'234.50" (chiffre d'affaires TTC), "987.00" (encaissements),
    // "456.00" (encours clients) — le bloc financier résout séparément (deuxième requête).
    expect(await screen.findByText("1'234.50")).toBeInTheDocument();
    expect(screen.getByText('987.00')).toBeInTheDocument();
    expect(screen.getByText('456.00')).toBeInTheDocument();
  });
});

describe('EcranTableauBord — période sans aucune activité', () => {
  it('affiche des zéros dignement, jamais un état vide ni "0 min" pour le délai', async () => {
    connecterSession('direction');
    server.use(
      http.get(CHEMIN_ACTIVITE, () => HttpResponse.json(ACTIVITE_VIDE)),
      http.get(CHEMIN_FINANCIER, () => HttpResponse.json(FINANCIER_VIDE)),
    );

    rendre();

    await screen.findByText(i18n.t('tableauBord:activite.repartitionStatuts.titre'));

    // Le délai sans donnée est un libellé traduit, jamais "0 min".
    expect(
      screen.getByText(i18n.t('tableauBord:activite.delaiRestitution.sansDonnee')),
    ).toBeInTheDocument();
    expect(screen.queryByText('0 min')).not.toBeInTheDocument();

    // Les compteurs à zéro restent affichés (au moins une occurrence de "0").
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
    // Le bloc financier résout séparément (deuxième requête, deuxième `isPending`) : on attend
    // son propre indicateur avant d'affirmer le montant zéro formaté.
    expect((await screen.findAllByText('0.00')).length).toBeGreaterThan(0);
  });
});

describe('EcranTableauBord — erreur serveur sur /tableau-bord/activite', () => {
  it('affiche un état d’erreur actionnable, le réessai redéclenche la requête', async () => {
    connecterSession('direction');
    let compteurAppels = 0;
    server.use(
      http.get(CHEMIN_ACTIVITE, () => {
        compteurAppels += 1;
        return HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/ERREUR_INTERNE',
            title: 'Erreur interne',
            status: 500,
            code: 'ERREUR_INTERNE',
            instance: 'req-1',
          },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        );
      }),
      http.get(CHEMIN_FINANCIER, () => HttpResponse.json(FINANCIER_NOMINAL)),
    );

    rendre();

    expect(
      await screen.findByText(i18n.t('tableauBord:activite.erreur.titre')),
    ).toBeInTheDocument();
    expect(compteurAppels).toBe(1);

    const utilisateur = userEvent.setup();
    await utilisateur.click(
      screen.getByRole('button', { name: i18n.t('commun:actions.reessayer') }),
    );

    await waitFor(() => expect(compteurAppels).toBe(2));
  });
});

describe('EcranTableauBord — rôle sans droit financier', () => {
  it.each(['admin', 'technicien'] as const)(
    'rôle « %s » : le bloc financier est absent du DOM et la requête financière n’est jamais déclenchée',
    async (role) => {
      connecterSession(role);
      let compteurFinancier = 0;
      server.use(
        http.get(CHEMIN_ACTIVITE, () => HttpResponse.json(ACTIVITE_NOMINALE)),
        http.get(CHEMIN_FINANCIER, () => {
          compteurFinancier += 1;
          return HttpResponse.json(FINANCIER_NOMINAL);
        }),
      );

      rendre();

      await screen.findByText(i18n.t('tableauBord:activite.repartitionStatuts.titre'));
      // Laisse le temps à une éventuelle requête financière fautive de partir.
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(screen.queryByText(i18n.t('tableauBord:financier.titre'))).not.toBeInTheDocument();
      expect(compteurFinancier).toBe(0);
    },
  );
});
