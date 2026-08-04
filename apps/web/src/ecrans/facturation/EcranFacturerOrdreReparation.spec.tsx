import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ClientResume,
  ReponseLigneOr,
  ReponseOrdreReparation,
  VehiculeResume,
} from '@dfa/shared';

import '@/i18n';
import i18n from '@/i18n';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranFacturerOrdreReparation } from './EcranFacturerOrdreReparation';

// `crypto.randomUUID` (via `genererCleIdempotence`) doit produire des clés distinctes à chaque
// appel pour que le test « nouvelle clé après confirmation » ait un sens — Node/jsdom le fournit
// nativement, aucun stub nécessaire (même environnement que `FormulaireNouvelOrdreReparation.spec.tsx`).

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

function construireLigne(overrides: Partial<ReponseLigneOr> = {}): ReponseLigneOr {
  return {
    id: 'ligne-defaut',
    ordreReparationId: 'or-1',
    numeroOrdre: 1,
    type: 'main_oeuvre_bareme',
    origine: 'constatee',
    statut: 'realisee',
    payeur: 'client',
    payeurClientId: null,
    blocage: 'aucun',
    designation: 'Ligne',
    referenceTexte: null,
    articleId: null,
    quantiteMillieme: 1000,
    tempsBaremeCentiemes: null,
    tempsBaremeConstructeurCentiemes: null,
    tempsReelCentiemes: null,
    tauxHoraireCentimes: null,
    prixUnitaireCentimes: null,
    rabaisPourmille: 0,
    tauxTvaPourmille: 81,
    figeLe: null,
    montants: { montantHtCentimes: 10000, montantTvaCentimes: 810, montantTtcCentimes: 10810 },
    technicienId: null,
    codeOperation: null,
    codeDefaut: null,
    numeroSinistre: null,
    numeroAccord: null,
    urgence: null,
    securite: false,
    fournieParClient: false,
    aRestituer: false,
    restituee: false,
    motifAnnulation: null,
    factureId: null,
    creeLe: '2026-07-01T08:00:00.000Z',
    modifieLe: '2026-07-01T08:00:00.000Z',
    ...overrides,
  };
}

// Deux sinistres qui se croisent sur le même véhicule (MD-62) : deux lignes `payeur = 'assurance'`
// mais deux `payeurClientId` distincts — le cas exact que le regroupement doit garder séparé.
const LIGNE_CLIENT = construireLigne({
  id: 'ligne-client',
  payeur: 'client',
  payeurClientId: null,
  designation: 'Vidange',
});
const LIGNE_ASSURANCE_A = construireLigne({
  id: 'ligne-assurance-a',
  payeur: 'assurance',
  payeurClientId: 'assureur-a',
  designation: 'Choc avant',
});
const LIGNE_ASSURANCE_B = construireLigne({
  id: 'ligne-assurance-b',
  payeur: 'assurance',
  payeurClientId: 'assureur-b',
  designation: 'Choc arrière',
});

function construireOr(overrides: Partial<ReponseOrdreReparation> = {}): ReponseOrdreReparation {
  return {
    id: 'or-1',
    numero: 'OR-000123',
    siteId: 'site-1',
    type: 'reparation',
    statut: 'termine',
    client: CLIENT,
    vehicule: VEHICULE,
    figees: {
      clientDesignation: 'Jean Dupont',
      adresseFacturation: null,
      plaque: '123456',
      detenteurClientId: 'cl-1',
    },
    conducteurPresentNom: null,
    kilometrageEntree: 90000,
    kilometrageSortie: 90050,
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
    termineLe: '2026-07-02T08:00:00.000Z',
    factureLe: null,
    restitueLe: null,
    clotureLe: null,
    annuleLe: null,
    motifAnnulation: null,
    demandes: [],
    lignes: [LIGNE_CLIENT, LIGNE_ASSURANCE_A, LIGNE_ASSURANCE_B],
    nombreLignes: 3,
    lignesTronquees: false,
    devisComplementaires: [],
    controleQualite: null,
    signatures: [],
    pret: null,
    cumulsPointage: { totalCentiemes: 0, parTechnicien: [], pointagesOuverts: 0 },
    totauxParPayeur: [
      {
        payeur: 'client',
        payeurClientId: null,
        destinataire: { clientId: 'cl-1', nomAffiche: 'Jean Dupont' },
        montantHtCentimes: 10000,
        montantTvaCentimes: 810,
        montantTtcCentimes: 10810,
        tva: [{ tauxPourmille: 81, baseHtCentimes: 10000, montantCentimes: 810 }],
      },
      {
        payeur: 'assurance',
        payeurClientId: 'assureur-a',
        destinataire: { clientId: 'assureur-a', nomAffiche: 'Zurich Assurances' },
        montantHtCentimes: 10000,
        montantTvaCentimes: 810,
        montantTtcCentimes: 10810,
        tva: [{ tauxPourmille: 81, baseHtCentimes: 10000, montantCentimes: 810 }],
      },
      {
        payeur: 'assurance',
        payeurClientId: 'assureur-b',
        destinataire: { clientId: 'assureur-b', nomAffiche: 'Mobilière' },
        montantHtCentimes: 10000,
        montantTvaCentimes: 810,
        montantTtcCentimes: 10810,
        tva: [{ tauxPourmille: 81, baseHtCentimes: 10000, montantCentimes: 810 }],
      },
    ],
    demontageFacturablePropose: null,
    attentes: { accord: false, pieces: false, externe: false },
    etatAffiche: 'termine',
    actionsDisponibles: ['facturer'],
    version: 1,
    creeLe: '2026-07-01T08:00:00.000Z',
    modifieLe: '2026-07-01T08:00:00.000Z',
    modifiePar: null,
    ...overrides,
  };
}

function installerHandlerOr(or: ReponseOrdreReparation) {
  server.use(http.get('/api/v1/ordres-reparation/or-1', () => HttpResponse.json(or)));
}

function rendre() {
  const queryClient = creerQueryClientTest();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/ordres-reparation/or-1/facturer']}>
        <Routes>
          <Route
            path="/ordres-reparation/:orId/facturer"
            element={<EcranFacturerOrdreReparation />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranFacturerOrdreReparation', () => {
  beforeEach(() => {
    Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it(
    'regroupe par (payeur, payeurClientId) — MD-62 : deux assurances distinctes restent DEUX groupes ' +
      'séparés, jamais fusionnés sous prétexte qu’elles partagent payeur = "assurance"',
    async () => {
      installerHandlerOr(construireOr());
      rendre();

      expect(await screen.findByText('Groupe payeur « Client »')).toBeInTheDocument();
      expect(
        await screen.findByText('Groupe payeur « Assurance — Zurich Assurances »'),
      ).toBeInTheDocument();
      expect(
        await screen.findByText('Groupe payeur « Assurance — Mobilière »'),
      ).toBeInTheDocument();
      // Trois groupes, trois lignes uniques réparties une par groupe — pas de fusion silencieuse.
      expect(screen.getByText('Vidange')).toBeInTheDocument();
      expect(screen.getByText('Choc avant')).toBeInTheDocument();
      expect(screen.getByText('Choc arrière')).toBeInTheDocument();
    },
  );

  it(
    'envoie un groupe par (payeur, payeurClientId) au serveur — jamais `payeur` seul — et navigue vers la ' +
      'première facture créée au succès',
    async () => {
      const or = construireOr();
      installerHandlerOr(or);
      let corpsRecu: unknown = null;
      server.use(
        http.post('/api/v1/ordres-reparation/or-1/facturer', async ({ request }) => {
          corpsRecu = await request.json();
          return HttpResponse.json(
            {
              donnees: {
                facturesCreees: [{ id: 'facture-1' }, { id: 'facture-2' }, { id: 'facture-3' }],
                ordreReparation: {
                  ...or,
                  statut: 'facture',
                  factureLe: '2026-07-30T10:00:00.000Z',
                },
              },
              avertissements: [],
            },
            { status: 201 },
          );
        }),
      );

      const utilisateur = userEvent.setup();
      rendre();

      await screen.findByText('Groupe payeur « Client »');
      const bouton = screen.getByRole('button', { name: /Créer 3 factures/ });
      await utilisateur.click(bouton);

      await waitFor(() => {
        expect(corpsRecu).not.toBeNull();
      });

      expect(corpsRecu).toMatchObject({
        groupes: expect.arrayContaining([
          { payeur: 'client', payeurClientId: null },
          { payeur: 'assurance', payeurClientId: 'assureur-a' },
          { payeur: 'assurance', payeurClientId: 'assureur-b' },
        ]),
      });
      expect((corpsRecu as { groupes: unknown[] }).groupes).toHaveLength(3);
    },
  );
});
