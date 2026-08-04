import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';

import type {
  PageCurseur,
  ReponseIdentificationPin,
  ReponseOrdreReparation,
  ReponsePointage,
  SessionCourante,
} from '@dfa/shared';

import '@/i18n';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranBornePointage } from './EcranBornePointage';

/**
 * `SESSION_TEST` (`@/test/msw/handlers`) porte le rôle `chef_atelier` — inadapté ici : la borne
 * n'est atteignable qu'en session `poste_atelier` (compte de service, exactement UN site via
 * `sites[0]`, voir l'en-tête d'`EcranBornePointage.tsx`). Fixture dédiée, propre à ce fichier.
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
  expireLe: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
};

const IDENTIFICATION_MARCO: ReponseIdentificationPin = {
  technicienId: 'technicien-marco',
  prenom: 'Marco',
  nom: 'Rossi',
};

function pagePointages(donnees: readonly ReponsePointage[]): PageCurseur<ReponsePointage> {
  return { donnees, curseurSuivant: null, limite: 50 };
}

function pageOrdres(
  donnees: readonly ReponseOrdreReparation[],
): PageCurseur<ReponseOrdreReparation> {
  return { donnees, curseurSuivant: null, limite: 50 };
}

/** Handlers de base, communs à tous les scénarios : session borne + « rien en cours, aucun OR »
 *  pour le technicien identifié, une fois l'identification réussie. */
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

/** Tape un code à 4 chiffres via le pavé tactile — même parcours qu'un technicien ganté : uniquement
 *  des clics sur les boutons `Chiffre N`, jamais de saisie clavier ici (couverte séparément si besoin). */
async function taperCode(utilisateur: ReturnType<typeof userEvent.setup>, code: string) {
  for (const chiffre of code) {
    // eslint-disable-next-line no-await-in-loop -- saisie séquentielle, un chiffre à la fois, comme au doigt.
    await utilisateur.click(await screen.findByRole('button', { name: `Chiffre ${chiffre}` }));
  }
}

describe('EcranBornePointage', () => {
  it('affiche le pavé numérique neutre, sans aucun code en clair, tant que personne ne s’est identifié', async () => {
    poserHandlersSession();
    rendre();

    // La session résout de façon asynchrone (skeleton `EtatChargement` d'abord — qui porte lui
    // aussi un `<h1 class="sr-only">` « Qui êtes-vous ? », voir l'en-tête du composant) : on
    // attend le pavé lui-même (`findByRole`, qui réinterroge le DOM jusqu'à son apparition)
    // plutôt que le titre, dont une occurrence existe déjà pendant le chargement.
    expect(await screen.findByRole('button', { name: 'Chiffre 1' })).toBeInTheDocument();
    expect(screen.getByText('Qui êtes-vous ?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Effacer' })).toBeInTheDocument();
    // Le bouton Valider reste désactivé tant que les 4 chiffres n'ont pas été saisis.
    expect(screen.getByRole('button', { name: 'Valider' })).toBeDisabled();
  });

  it('identifie le technicien après 4 chiffres et affiche son accueil nominatif', async () => {
    poserHandlersSession();
    server.use(
      http.post('/api/v1/pointages/identification', () => HttpResponse.json(IDENTIFICATION_MARCO)),
    );

    const utilisateur = userEvent.setup();
    rendre();

    await taperCode(utilisateur, '4071');

    expect(await screen.findByText('Bonjour Marco')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Terminé' })).toBeInTheDocument();
    // Panneau du technicien identifié : aucun pointage en cours, aucun OR assigné -> repli honnête.
    expect(
      await screen.findByText("Aucun OR à pointer pour vous aujourd'hui.", { exact: false }),
    ).toBeInTheDocument();
  });

  it('refuse un PIN inconnu sans ouvrir de session ni afficher le code, et laisse le pavé actif', async () => {
    poserHandlersSession();
    server.use(
      http.post('/api/v1/pointages/identification', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/POINTAGE_PIN_INVALIDE',
            title: 'Code PIN non reconnu',
            status: 401,
            code: 'POINTAGE_PIN_INVALIDE',
            instance: 'req-1',
          },
          { status: 401, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    const utilisateur = userEvent.setup();
    rendre();

    await taperCode(utilisateur, '9999');

    expect(
      await screen.findByText('Code PIN non reconnu. Vérifiez le code et réessayez.'),
    ).toBeInTheDocument();
    // Jamais d'accueil nominatif après un refus : l'écran reste sur le pavé de saisie.
    expect(screen.queryByText(/^Bonjour /)).not.toBeInTheDocument();
    // Le pavé reste utilisable — un PIN refusé n'est pas un verrouillage (RM-129 : seul le
    // 423 verrouille, jamais la tentative fautive elle-même).
    expect(screen.getByRole('button', { name: 'Chiffre 1' })).toBeEnabled();
  });

  it('traite explicitement le 423 (verrouillage anti-balayage) : message clair et pavé désactivé', async () => {
    poserHandlersSession();
    server.use(
      http.post('/api/v1/pointages/identification', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/POINTAGE_PIN_VERROUILLE',
            title: 'Sélecteur de code PIN temporairement verrouillé',
            status: 423,
            code: 'POINTAGE_PIN_VERROUILLE',
            instance: 'req-1',
          },
          {
            status: 423,
            headers: { 'content-type': 'application/problem+json', 'Retry-After': '30' },
          },
        ),
      ),
    );

    const utilisateur = userEvent.setup();
    rendre();

    await taperCode(utilisateur, '0000');

    expect(
      await screen.findByText(
        "Code PIN temporairement verrouillé. Adressez-vous au chef d'atelier pour continuer.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Nouvel essai possible dans 30 s.', { exact: false }),
    ).toBeInTheDocument();
    // Verrouillage RÉEL : contrairement au PIN simplement refusé, le pavé est désactivé — un
    // balayage ne peut pas continuer à essayer pendant le palier annoncé par `Retry-After`.
    expect(screen.getByRole('button', { name: 'Chiffre 1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Effacer' })).toBeDisabled();
  });

  it('« Terminé » referme le panneau du technicien et revient au pavé neutre — borne PARTAGÉE', async () => {
    poserHandlersSession();
    server.use(
      http.post('/api/v1/pointages/identification', () => HttpResponse.json(IDENTIFICATION_MARCO)),
    );

    const utilisateur = userEvent.setup();
    rendre();

    await taperCode(utilisateur, '4071');
    expect(await screen.findByText('Bonjour Marco')).toBeInTheDocument();

    await utilisateur.click(screen.getByRole('button', { name: 'Terminé' }));

    expect(await screen.findByText('Qui êtes-vous ?')).toBeInTheDocument();
    expect(screen.queryByText('Bonjour Marco')).not.toBeInTheDocument();
  });
});
