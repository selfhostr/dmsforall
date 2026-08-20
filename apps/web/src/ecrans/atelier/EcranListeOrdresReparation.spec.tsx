import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import type { ClientResume, OrdreReparationResume, VehiculeResume } from '@dfa/shared';

import i18n from '@/i18n';
import { server } from '@/test/msw/server';
import { renduAvecRoutes } from '@/test/utils';

import { EcranListeOrdresReparation } from './EcranListeOrdresReparation';

const VEHICULE: VehiculeResume = {
  id: 'v1',
  plaque: '123456',
  canton: 'VD',
  designation: 'VW Touran 2.0 TDI',
  vin: 'WVGZZZ1TZ8W123456',
  premiereMiseEnCirculationLe: '2018-03-14',
  identificationIncomplete: false,
  emplacementLibre: null,
};

const CLIENT: ClientResume = {
  id: 'cl-1',
  numeroClient: 'CL-000123',
  nomAffiche: 'Jean Dupont',
  type: 'particulier',
  statut: 'actif',
  langueCorrespondance: 'fr',
  poObligatoire: false,
  telephone: null,
  localite: 'Lausanne',
  nombreVehicules: 1,
  dernierPassageLe: null,
};

function construireResume(overrides: Partial<OrdreReparationResume> = {}): OrdreReparationResume {
  return {
    id: 'or-1',
    numero: 'OR-000123',
    statut: 'ouvert',
    etatAffiche: 'ouvert',
    type: 'reparation',
    localisation: 'atelier',
    ouvertLe: '2026-07-01T08:00:00.000Z',
    restitutionPromiseLe: null,
    vehicule: VEHICULE,
    client: CLIENT,
    nombreLignes: 0,
    ...overrides,
  };
}

function rendreEcran(routeInitiale = '/ordres-reparation') {
  return renduAvecRoutes(
    [
      { path: '/ordres-reparation', element: <EcranListeOrdresReparation /> },
      { path: '/ordres-reparation/:id', element: <div>PAGE_FICHE_OR</div> },
    ],
    { routeInitiale },
  );
}

function repondreListe(donnees: readonly OrdreReparationResume[]) {
  server.use(
    http.get('/api/v1/ordres-reparation', () =>
      HttpResponse.json({ donnees, curseurSuivant: null, limite: 50 }),
    ),
  );
}

describe('EcranListeOrdresReparation', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it('affiche les OR renvoyés par le serveur', async () => {
    repondreListe([construireResume()]);
    rendreEcran();

    expect(await screen.findByText('OR-000123')).toBeInTheDocument();
    expect(screen.getByText('Jean Dupont')).toBeInTheDocument();
  });

  it('affiche des lignes squelette pendant le chargement', async () => {
    server.use(
      http.get('/api/v1/ordres-reparation', async () => {
        await delay(30);
        return HttpResponse.json({
          donnees: [construireResume()],
          curseurSuivant: null,
          limite: 50,
        });
      }),
    );
    const { container } = rendreEcran();

    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    expect(await screen.findByText('OR-000123')).toBeInTheDocument();
  });

  it("affiche un état d'erreur actionnable si le serveur répond en erreur", async () => {
    server.use(
      http.get('/api/v1/ordres-reparation', () =>
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
    rendreEcran();

    expect(await screen.findByRole('button', { name: /Réessayer/ })).toBeInTheDocument();
  });

  describe('badge « État » — EtatAfficheOrdreReparation, jamais StatutOrdreReparation brut', () => {
    it("affiche un état d'attente (attente_pieces) — un des 3 drapeaux orthogonaux absents de StatutOrdreReparation — même quand le statut brut est un tout autre statut", async () => {
      // `statut` (contrôle) et `etatAffiche` (attente_pieces) sont délibérément DIFFÉRENTS et
      // n'ont AUCUNE valeur commune : si la colonne « État » lisait `or.statut` au lieu de
      // `or.etatAffiche` (les deux types existent SANS alias exprès, voir `enums.ts`), ce test
      // rougirait — soit en ne trouvant pas « Attente pièces », soit en trouvant « Contrôle » à
      // la place. C'est précisément le badge que le chef d'atelier surveille pour savoir pourquoi
      // une voiture ne bouge pas.
      repondreListe([construireResume({ statut: 'controle', etatAffiche: 'attente_pieces' })]);
      rendreEcran();

      expect(await screen.findByText('Attente pièces')).toBeInTheDocument();
      expect(screen.queryByText('Contrôle')).not.toBeInTheDocument();
    });
  });

  describe('colonne « Total TTC » — jamais « 0.00 », jamais une cellule vide, pour un rôle sans droit aux montants', () => {
    it('affiche « Non visible » (pas un montant nul, pas une cellule vide indiscernable d’une absence de donnée) quand `totalTtcCentimes` est absent du DTO', async () => {
      repondreListe([
        construireResume({ id: 'or-avec-montant', numero: 'OR-000001', totalTtcCentimes: 24000 }),
        construireResume({
          id: 'or-sans-montant',
          numero: 'OR-000002',
          totalTtcCentimes: undefined,
        }),
      ]);
      rendreEcran();

      expect(await screen.findByText('OR-000001')).toBeInTheDocument();
      expect(screen.getByText('240.00')).toBeInTheDocument();
      // Le second OR n'affiche AUCUN montant — ni "0.00", ni "CHF 0.00" — mais porte le texte
      // « Non visible » (issue #157) : une cellule vide se lisait exactement comme une absence de
      // donnée réelle (ex. « aucune restitution promise »), jamais comme un droit manquant.
      expect(screen.queryByText('0.00')).not.toBeInTheDocument();
      expect(screen.queryByText(/CHF\s*0/)).not.toBeInTheDocument();
      expect(screen.getByText('Non visible')).toBeInTheDocument();
    });
  });

  describe('propagation du site (?site=) au clic sur une ligne', () => {
    it('conserve `?site=` en ouvrant la fiche OR', async () => {
      repondreListe([construireResume()]);
      const utilisateur = userEvent.setup();
      const { routeur } = rendreEcran('/ordres-reparation?site=site-1');

      await utilisateur.click(await screen.findByText('OR-000123'));

      expect(await screen.findByText('PAGE_FICHE_OR')).toBeInTheDocument();
      expect(routeur.state.location.pathname).toBe('/ordres-reparation/or-1');
      expect(routeur.state.location.search).toBe('?site=site-1');
    });
  });
});
