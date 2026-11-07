import { actionsDuRole } from '@/test/session';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { PageCurseur, ReponsePointage } from '@dfa/shared';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { VueEquipePointage } from './VueEquipePointage';

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

function pagePointages(donnees: readonly ReponsePointage[]): PageCurseur<ReponsePointage> {
  return { donnees, curseurSuivant: null, limite: 50 };
}

const POINTAGE: ReponsePointage = {
  id: 'pointage-1',
  siteId: 'site-1',
  technicienId: 'technicien-abcdef01',
  technicienNomAffiche: 'Isabelle Bonvin',
  statut: 'termine',
  nature: 'indirect',
  ordreReparationId: null,
  ordreReparationNumero: null,
  ligneOrId: null,
  ligneOrDesignation: null,
  activiteIndirecte: 'nettoyage',
  source: 'ecran_atelier',
  appareilId: null,
  debutLe: '2026-08-03T07:00:00.000Z',
  finLe: '2026-08-03T07:30:00.000Z',
  dureeBruteSecondes: 1800,
  dureeArrondieCentiemes: 50,
  clotureAutomatique: false,
  anomalie: null,
  derniereCorrection: null,
  creeLe: '2026-08-03T07:00:00.000Z',
  modifieLe: '2026-08-03T07:30:00.000Z',
};

/**
 * Anciennement `EcranEquipePointage.spec.tsx` — adapté à la fusion (Lot D, voir l'en-tête
 * d'`EcranPointage.tsx`) : `siteId`/`role` sont désormais des props directs (résolus par
 * l'appelant), donc plus de test de gate de site ici (couvert UNE SEULE fois par
 * `EcranPointage.spec.tsx`). Toutes les assertions de contenu sont conservées telles quelles, plus
 * un test nouveau pour le geste de clôture de période (Lot E, ex-écran séparé
 * `EcranCloturePeriodePointage`, désormais une action de cette vue — voir `DialogueCloturePeriode`).
 */
function rendre() {
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <VueEquipePointage siteId="site-1" actions={actionsDuRole('chef_atelier')} />
    </QueryClientProvider>,
  );
}

describe('VueEquipePointage', () => {
  it("affiche les pointages de l'équipe avec l'activité et la durée", async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/pointages', () => HttpResponse.json(pagePointages([POINTAGE]))),
      http.get('/api/v1/ordres-reparation', () =>
        HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 50 }),
      ),
    );

    rendre();

    expect(await screen.findByText('Nettoyage')).toBeInTheDocument();
    expect(screen.getByText('30 min')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Corriger' })).toBeInTheDocument();
    // Régression défaut 1 : le nom du technicien vient de `technicienNomAffiche`, jamais d'un
    // repli sur l'UUID tronqué (`technicienId.slice(0, 8)`).
    expect(screen.getByText('Isabelle Bonvin')).toBeInTheDocument();
    expect(screen.queryByText(/^Technicien [0-9a-f]{8}$/)).not.toBeInTheDocument();
  });

  it(
    'régression défaut 3 : affiche le numéro d’OR réel dans la colonne « Cible » — ' +
      "jamais l'UUID brut de ordreReparationId/ligneOrId",
    async () => {
      const pointageOr: ReponsePointage = {
        ...POINTAGE,
        id: 'pointage-2',
        nature: 'productif_or',
        ordreReparationId: 'or-1',
        ordreReparationNumero: 'OR-2026-77',
        ligneOrId: null,
        ligneOrDesignation: null,
        activiteIndirecte: null,
      };
      server.use(
        http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
        http.get('/api/v1/pointages', () => HttpResponse.json(pagePointages([pointageOr]))),
        http.get('/api/v1/ordres-reparation', () =>
          HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 50 }),
        ),
      );

      rendre();

      // `ReponsePointage` porte désormais `ordreReparationNumero` — la colonne « Cible » affiche
      // le numéro d'OR RÉEL, plus seulement le texte générique « OR entier » (voir `libelles.ts`,
      // `libelleCiblePointage`). Aucun aller-retour supplémentaire : le numéro voyage déjà sur
      // `GET /pointages`, d'où `GET /ordres-reparation` mocké vide ci-dessus (non appelé pour
      // cette colonne).
      expect(await screen.findByText('OR-2026-77 — OR entier')).toBeInTheDocument();
      expect(screen.queryByText('or-1')).not.toBeInTheDocument();
      expect(screen.queryByText('OR entier')).not.toBeInTheDocument();
    },
  );

  it(
    'affiche le numéro d’OR et la désignation de ligne réels quand le pointage cible une ligne ' +
      "précise — jamais le texte générique « Ligne d'OR » quand la désignation est connue",
    async () => {
      const pointageLigne: ReponsePointage = {
        ...POINTAGE,
        id: 'pointage-3',
        nature: 'productif_ligne',
        ordreReparationId: 'or-2',
        ordreReparationNumero: 'OR-2026-88',
        ligneOrId: 'ligne-9',
        ligneOrDesignation: 'Vidange moteur',
        activiteIndirecte: null,
      };
      server.use(
        http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
        http.get('/api/v1/pointages', () => HttpResponse.json(pagePointages([pointageLigne]))),
        http.get('/api/v1/ordres-reparation', () =>
          HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 50 }),
        ),
      );

      rendre();

      expect(await screen.findByText('OR-2026-88 — Vidange moteur')).toBeInTheDocument();
      expect(screen.queryByText("Ligne d'OR")).not.toBeInTheDocument();
    },
  );

  it(
    "affiche le numéro d'OR avec un repli générique quand la ligne ciblée n'a pas de désignation " +
      'saisie (`ligneOrDesignation` nullable en base, découplé de `ligneOrId`)',
    async () => {
      const pointageLigneSansDesignation: ReponsePointage = {
        ...POINTAGE,
        id: 'pointage-4',
        nature: 'productif_ligne',
        ordreReparationId: 'or-3',
        ordreReparationNumero: 'OR-2026-99',
        ligneOrId: 'ligne-10',
        ligneOrDesignation: null,
        activiteIndirecte: null,
      };
      server.use(
        http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
        http.get('/api/v1/pointages', () =>
          HttpResponse.json(pagePointages([pointageLigneSansDesignation])),
        ),
        http.get('/api/v1/ordres-reparation', () =>
          HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 50 }),
        ),
      );

      rendre();

      expect(await screen.findByText("OR-2026-99 — Ligne d'OR")).toBeInTheDocument();
    },
  );

  it('état vide : aucun pointage pour ce site sur cette période', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/pointages', () => HttpResponse.json(pagePointages([]))),
      http.get('/api/v1/ordres-reparation', () =>
        HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 50 }),
      ),
    );

    rendre();

    expect(
      await screen.findByText('Aucun pointage pour ce site sur cette période.'),
    ).toBeInTheDocument();
  });

  it('affiche une erreur actionnable si le serveur échoue', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/pointages', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/ERREUR_INTERNE',
            title: 'Erreur interne',
            status: 500,
            code: 'ERREUR_INTERNE',
            instance: '',
          },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
      http.get('/api/v1/ordres-reparation', () =>
        HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 50 }),
      ),
    );

    rendre();

    expect(await screen.findByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });

  it(
    'Lot E : le bouton « Clôturer la période » ouvre le dialogue de clôture, avec ses deux ' +
      'gestes (verrouiller/déverrouiller) intacts — la clôture est une ACTION de cette vue, plus ' +
      'un écran séparé',
    async () => {
      server.use(
        http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
        http.get('/api/v1/pointages', () => HttpResponse.json(pagePointages([]))),
        http.get('/api/v1/ordres-reparation', () =>
          HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 50 }),
        ),
      );

      rendre();

      const utilisateur = userEvent.setup();
      await utilisateur.click(await screen.findByRole('button', { name: 'Clôturer la période' }));

      const dialogue = await screen.findByRole('dialog');
      expect(dialogue).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Verrouiller' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Déverrouiller' })).toBeInTheDocument();
    },
  );

  it(
    'le bouton « Clôturer la période » est ABSENT pour un rôle sans droit de verrouillage ' +
      '(défense en profondeur, même si `EcranPointage` ne monte cette vue que pour l’encadrement)',
    async () => {
      server.use(
        http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
        http.get('/api/v1/pointages', () => HttpResponse.json(pagePointages([]))),
        http.get('/api/v1/ordres-reparation', () =>
          HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 50 }),
        ),
      );

      const queryClient = creerQueryClientTest();
      render(
        <QueryClientProvider client={queryClient}>
          <VueEquipePointage siteId="site-1" actions={actionsDuRole('comptable')} />
        </QueryClientProvider>,
      );

      await screen.findByText('Aucun pointage pour ce site sur cette période.');
      expect(screen.queryByRole('button', { name: 'Clôturer la période' })).not.toBeInTheDocument();
    },
  );
});
