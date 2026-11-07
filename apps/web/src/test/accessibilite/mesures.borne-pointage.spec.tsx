import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, it } from 'vitest';

import type {
  PageCurseur,
  ReponseIdentificationPin,
  ReponseOrdreReparation,
  ReponsePointage,
  SessionCourante,
} from '@dfa/shared';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranBornePointage } from '@/ecrans/pointage/EcranBornePointage';

import { auditerAccessibiliteEcran, exigerAucuneViolation } from './harnais';
import { CAPACITES_TEST } from '@/test/capacites';

/**
 * Mesure 1/4 — famille « borne tactile », le cas le plus contraint du produit : utilisée debout,
 * avec des gants, cibles tactiles larges, aucune saisie clavier. Fixtures reprises telles quelles
 * de `EcranBornePointage.spec.tsx` (session `poste_atelier`, seul rôle qui atteint cet écran).
 */
const SESSION_BORNE: SessionCourante = {
  utilisateur: {
    id: 'borne-atelier-1',
    email: 'borne-atelier-1@garage.ch',
    prenom: 'Borne',
    nom: 'Atelier',
    role: 'poste_atelier',
    langue: 'fr',
  },
  tenant: {
    id: 'tenant-1',
    slug: 'garage-test',
    raisonSociale: 'Garage Test SA',
    langueDefaut: 'fr',
  },
  sites: [{ id: 'site-1', code: 'PRINCIPAL', nom: 'Site principal', actif: true }],
  siteRattachementId: 'site-1',
  actions: [],
  capacites: CAPACITES_TEST,
  expireLe: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
};

const IDENTIFICATION_MARCO: ReponseIdentificationPin = {
  technicienId: 'technicien-marco',
  prenom: 'Marco',
  nom: 'Rossi',
  siteId: 'site-1',
};

function pagePointages(donnees: readonly ReponsePointage[]): PageCurseur<ReponsePointage> {
  return { donnees, curseurSuivant: null, limite: 50 };
}

function pageOrdres(
  donnees: readonly ReponseOrdreReparation[],
): PageCurseur<ReponseOrdreReparation> {
  return { donnees, curseurSuivant: null, limite: 50 };
}

function poserHandlersSession() {
  server.use(
    http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_BORNE)),
    http.get('/api/v1/pointages', () => HttpResponse.json(pagePointages([]))),
    http.get('/api/v1/ordres-reparation', () => HttpResponse.json(pageOrdres([]))),
  );
}

function rendre() {
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/pointage/borne']}>
        <Routes>
          <Route path="/pointage/borne" element={<EcranBornePointage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function taperCode(utilisateur: ReturnType<typeof userEvent.setup>, code: string) {
  for (const chiffre of code) {
    // Saisie séquentielle intentionnelle, un chiffre à la fois (comme au doigt) — `no-await-in-loop`
    // n'est pas activé dans ce dépôt, aucune règle ESLint à désactiver ici.
    await utilisateur.click(await screen.findByRole('button', { name: `Chiffre ${chiffre}` }));
  }
}

describe('Accessibilité WCAG 2.1 AA — borne de pointage', () => {
  it('pavé de saisie du PIN (état neutre, avant identification)', async () => {
    poserHandlersSession();
    rendre();
    await screen.findByRole('button', { name: 'Chiffre 1' });

    // `document.body`, pas le `container` de `render()` : convention uniforme avec les autres
    // `mesures.*.spec.tsx`, indépendante de l'état ouvert/fermé d'un composant portalé (ici,
    // `DialogueChoixCiblePointage` reste fermé dans les deux états testés). Voir `harnais.ts`.
    const audit = await auditerAccessibiliteEcran('Borne de pointage — pavé PIN', document.body);

    exigerAucuneViolation(audit);
  });

  it('panneau du technicien identifié (accueil nominatif, liste d’OR)', async () => {
    poserHandlersSession();
    server.use(
      http.post('/api/v1/pointages/identification', () => HttpResponse.json(IDENTIFICATION_MARCO)),
    );
    const utilisateur = userEvent.setup();
    rendre();
    await taperCode(utilisateur, '4071');
    await screen.findByText('Bonjour Marco');

    const audit = await auditerAccessibiliteEcran(
      'Borne de pointage — technicien identifié',
      document.body,
    );

    exigerAucuneViolation(audit);
  });
});
