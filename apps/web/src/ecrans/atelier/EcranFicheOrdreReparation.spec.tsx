import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ClientResume, ReponseOrdreReparation, VehiculeResume } from '@dfa/shared';

import '@/i18n';
import i18n from '@/i18n';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranFicheOrdreReparation } from './EcranFicheOrdreReparation';

// Radix Dialog (`PanneauActionsOr`) appelle `hasPointerCapture`/`scrollIntoView`, absents de
// jsdom — même stub que `composants/comptoir/SelecteurTri.spec.tsx` et `EcranFicheVehicule.spec.tsx`.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const VEHICULE: VehiculeResume = {
  id: 'v1',
  plaque: '123456',
  canton: 'VD',
  designation: 'VW Touran 2.0 TDI',
  vin: 'WVGZZZ1TZ8W123456',
  premiereMiseEnCirculationLe: '2018-03-14',
  identificationIncomplete: false,
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

function construireOr(overrides: Partial<ReponseOrdreReparation> = {}): ReponseOrdreReparation {
  return {
    id: 'or-1',
    numero: 'OR-000123',
    siteId: 'site-1',
    type: 'reparation',
    statut: 'en_cours',
    client: CLIENT,
    vehicule: VEHICULE,
    figees: { clientDesignation: 'Jean Dupont', adresseFacturation: null, plaque: '123456', detenteurClientId: 'cl-1' },
    conducteurPresentNom: null,
    kilometrageEntree: 90000,
    kilometrageSortie: null,
    restitutionPromiseLe: null,
    restitutionInitialeLe: null,
    localisation: 'atelier',
    sousTraitantNom: null,
    ordreReparationParentId: null,
    motifLien: null,
    rendezVousId: null,
    numeroCommandeInterne: null,
    receptionnaireId: null,
    retentionInvoqueeLe: null,
    litigeOuvertLe: null,
    ouvertLe: '2026-07-01T08:00:00.000Z',
    termineLe: null,
    factureLe: null,
    restitueLe: null,
    clotureLe: null,
    annuleLe: null,
    motifAnnulation: null,
    demandes: [],
    lignes: [],
    nombreLignes: 0,
    lignesTronquees: false,
    devisComplementaires: [],
    controleQualite: null,
    signatures: [],
    pret: null,
    cumulsPointage: { totalCentiemes: 0, parTechnicien: [], pointagesOuverts: 0 },
    attentes: { accord: false, pieces: false, externe: false },
    etatAffiche: 'en_cours',
    actionsDisponibles: [],
    version: 1,
    creeLe: '2026-07-01T08:00:00.000Z',
    modifieLe: '2026-07-01T08:00:00.000Z',
    modifiePar: null,
    ...overrides,
  };
}

function installerHandler(or: ReponseOrdreReparation) {
  server.use(http.get('/api/v1/ordres-reparation/or-1', () => HttpResponse.json(or)));
}

function rendre() {
  const queryClient = creerQueryClientTest();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/ordres-reparation/or-1']}>
        <Routes>
          <Route path="/ordres-reparation/:orId" element={<EcranFicheOrdreReparation />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranFicheOrdreReparation', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it('affiche le squelette de chargement avant la résolution de la requête', () => {
    installerHandler(construireOr());
    const { container } = rendre();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it("affiche une erreur actionnable si l'OR est introuvable, avec un bouton réessayer", async () => {
    server.use(
      http.get('/api/v1/ordres-reparation/or-1', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/RESSOURCE_INTROUVABLE',
            title: 'Introuvable',
            status: 404,
            code: 'RESSOURCE_INTROUVABLE',
            instance: 'req-1',
          },
          { status: 404, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    rendre();

    expect(await screen.findByText("Impossible de charger l'ordre de réparation")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });

  describe("badge « État » de l'en-tête — EtatAfficheOrdreReparation, jamais StatutOrdreReparation brut", () => {
    it("affiche un état d'attente (attente_accord) alors que le statut brut est « en_cours »", async () => {
      // Même risque que la liste (voir EcranListeOrdresReparation.spec.tsx) : `EnTeteOrdreReparation`
      // rend `<BadgeStatutOr etat={or.etatAffiche} />`. Un statut et un état d'attente qui n'ont
      // AUCUNE valeur commune garantissent qu'un retour accidentel à `or.statut` fait rougir ce test.
      installerHandler(construireOr({ statut: 'en_cours', etatAffiche: 'attente_accord' }));
      rendre();

      expect(await screen.findByText('Attente accord')).toBeInTheDocument();
      expect(screen.queryByText('En cours')).not.toBeInTheDocument();
    });
  });

  describe("montants absents pour un rôle sans droit — jamais « 0.00 »", () => {
    it("n'affiche ni le plafond ni les totaux quand le serveur les a retirés de la charge utile (droit manquant)", async () => {
      const or = construireOr({ plafondCentimes: undefined, totauxParPayeur: undefined, totalValideCentimes: undefined });
      installerHandler(or);
      rendre();

      await screen.findByText('OR-000123');
      // Le libellé « Plafond » lui-même n'apparaît pas : le champ est absent, pas vide.
      expect(screen.queryByText('Plafond')).not.toBeInTheDocument();
      expect(screen.queryByText('Totaux')).not.toBeInTheDocument();
      expect(screen.queryByText('0.00')).not.toBeInTheDocument();
    });

    it('affiche les totaux présents sans jamais inventer le total validé quand celui-ci est absent', async () => {
      const or = construireOr({
        totauxParPayeur: [
          {
            payeur: 'client',
            montantHtCentimes: 20000,
            montantTvaCentimes: 1620,
            montantTtcCentimes: 21620,
            tva: [{ tauxPourmille: 81, baseHtCentimes: 20000, montantCentimes: 1620 }],
          },
        ],
        totalValideCentimes: undefined,
      });
      installerHandler(or);
      rendre();

      expect(await screen.findByText('Totaux')).toBeInTheDocument();
      expect(screen.getByText('216.20')).toBeInTheDocument();
      expect(screen.queryByText('Total validé')).not.toBeInTheDocument();
    });
  });

  describe("actions proposées — viennent du serveur (`actionsDisponibles`), jamais devinées du statut", () => {
    it("n'affiche AUCUN bouton d'action quand `actionsDisponibles` est vide, même pour un statut qui suggérerait normalement une transition", async () => {
      // `statut: 'en_cours'` suggérerait naturellement « Passer en contrôle » / « Terminer » à
      // quiconque déduirait les actions du statut — mais le serveur n'en propose explicitement
      // AUCUNE ici (ex. droits insuffisants pour l'appelant courant). L'écran doit obéir au
      // serveur, jamais à sa propre lecture du statut.
      installerHandler(construireOr({ statut: 'en_cours', actionsDisponibles: [] }));
      rendre();

      expect(await screen.findByText('Aucune action possible pour le moment.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Terminer' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Passer en contrôle' })).not.toBeInTheDocument();
    });

    it("n'affiche QUE les actions listées par le serveur, sans en ajouter d'autres plausibles pour ce statut", async () => {
      installerHandler(construireOr({ statut: 'en_cours', actionsDisponibles: ['passer-en-controle'] }));
      rendre();

      expect(await screen.findByRole('button', { name: 'Passer en contrôle' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Terminer' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Restituer le véhicule' })).not.toBeInTheDocument();
    });

    it('une action affichée mais REFUSÉE par le serveur à l’appel montre le refus inline, jamais un succès silencieux', async () => {
      const or = construireOr({ statut: 'en_cours', actionsDisponibles: ['terminer'] });
      installerHandler(or);
      server.use(
        http.post('/api/v1/ordres-reparation/or-1/terminer', () =>
          HttpResponse.json(
            {
              type: 'https://docs.dmsforall.example/erreurs/OR_TRANSITION_INTERDITE',
              title: 'Transition interdite',
              status: 409,
              code: 'OR_TRANSITION_INTERDITE',
              instance: 'req-1',
              blocages: [],
              actionsProposees: [],
            },
            { status: 409, headers: { 'content-type': 'application/problem+json' } },
          ),
        ),
      );

      const utilisateur = userEvent.setup();
      rendre();

      await utilisateur.click(await screen.findByRole('button', { name: 'Terminer' }));
      const dialogue = await screen.findByRole('dialog');
      await utilisateur.click(within(dialogue).getByRole('button', { name: 'Confirmer' }));

      // Le refus s'affiche EN PLACE, dans le dialogue toujours ouvert — pas de fermeture
      // silencieuse qui laisserait croire que l'action a réussi.
      expect(await within(dialogue).findByText("Cette transition n'est pas autorisée pour ce statut.")).toBeInTheDocument();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('traduit le titre en allemand', async () => {
    await i18n.changeLanguage('de');
    installerHandler(construireOr());
    rendre();
    expect(await screen.findByText('Reparaturauftrag')).toBeInTheDocument();
  });
});
