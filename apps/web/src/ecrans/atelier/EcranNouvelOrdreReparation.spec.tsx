import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  PageCurseur,
  ReponseClient,
  ReponseOrdreReparation,
  ReponseParametresAtelier,
  VehiculeResume,
} from '@dfa/shared';

import i18n from '@/i18n';
import { server } from '@/test/msw/server';
import { renduAvecRoutes } from '@/test/utils';

import { EcranNouvelOrdreReparation } from './EcranNouvelOrdreReparation';

// Radix Select (`FormulaireNouvelOrdreReparation`) appelle `hasPointerCapture`/`scrollIntoView`,
// absents de jsdom — même stub que `EcranFicheVehicule.spec.tsx`.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

// `schemaCreationOrdreReparation` exige des UUID (`schemaIdentifiant = z.string().uuid()`) sur
// `siteId`/`clientId`/`vehiculeId` : le parcours complet ci-dessous soumet réellement le
// formulaire, donc ces identifiants doivent être des UUID valides pour franchir la validation
// locale AVANT tout appel réseau — voir `FormulaireNouvelOrdreReparation.spec.tsx`.
const SITE_ID = '11111111-1111-4111-8111-111111111111';
const CLIENT_ID = '22222222-2222-4222-8222-222222222222';
const VEHICULE_ID = '33333333-3333-4333-8333-333333333333';

const VEHICULE: VehiculeResume = {
  id: VEHICULE_ID,
  plaque: '123456',
  canton: 'VD',
  designation: 'VW Touran 2.0 TDI',
  vin: 'WVGZZZ1TZ8W123456',
  premiereMiseEnCirculationLe: '2018-03-14',
  identificationIncomplete: false,
  emplacementLibre: null,
};

const CLIENT: ReponseClient = {
  id: CLIENT_ID,
  numeroClient: 'CL-000123',
  type: 'particulier',
  statut: 'actif',
  civilite: null,
  nom: 'Dupont',
  prenom: 'Jean',
  raisonSociale: null,
  nomAffiche: 'Jean Dupont',
  ide: null,
  langueCorrespondance: 'fr',
  email: null,
  telephone: null,
  telephoneE164: null,
  poObligatoire: false,
  groupeId: null,
  fusionneVersClientId: null,
  referenceExterne: null,
  dernierPassageLe: null,
  creeLe: '2026-01-01T00:00:00.000Z',
  modifieLe: '2026-01-01T00:00:00.000Z',
  notesAlerte: [],
  plusAucunContact: false,
  motif: null,
};

const PARAMETRES_ATELIER: ReponseParametresAtelier = {
  or: {
    prefixe: 'OR',
    porteeNumerotation: 'tenant',
    resetAnnuel: true,
    etatPlanifieActif: false,
    sansRdvAutorise: true,
    rdvRetroactifAuto: false,
    deuxOrMemeVehicule: 'avertir',
  },
  reception: {
    kmEntreeObligatoire: false,
    kmSortieObligatoire: false,
    signature: 'recommandee',
    plafondDefautCentimes: 0,
  },
  travaux: {
    uniteTemps: 'heures_decimales',
    arrondiPointage: 'dixieme',
    chevauchementPointageAutorise: false,
    pointageObligatoirePourTerminer: false,
    controleQualite: 'jamais',
    dureeMaxPointageHeures: 12,
  },
  facturation: {
    multiPayeursAutorise: true,
    restitutionAvantPaiement: true,
    piecesClientAutorisees: true,
    politiqueDemontageRefuse: 'facturer',
    seuilDemontageCentimes: null,
    produitsAtelier: { mode: 'desactive', pourmille: null, plafondCentimes: null },
  },
  documents: { langue: 'client', mentionSecurite: 'obligatoire' },
  vehicule: { expertiseAlerteMois: 2, visibiliteHistoriqueNouveauDetenteur: 'tout' },
  planning: {
    noShowSeuilAlerte: 2,
    tamponPretMinutes: 15,
    rappel: { canal: 'sms', joursAvant: 1 },
  },
  fonctionnalites: { facturation: false, stockPieces: false, depotPneus: false, prets: false },
  version: 1,
};

function construireOr(overrides: Partial<ReponseOrdreReparation> = {}): ReponseOrdreReparation {
  return {
    id: 'or-9',
    numero: 'OR-000009',
    siteId: SITE_ID,
    type: 'reparation',
    statut: 'ouvert',
    client: {
      id: CLIENT.id,
      numeroClient: CLIENT.numeroClient,
      nomAffiche: CLIENT.nomAffiche,
      type: CLIENT.type,
      statut: CLIENT.statut,
      langueCorrespondance: CLIENT.langueCorrespondance,
      poObligatoire: CLIENT.poObligatoire,
      telephone: CLIENT.telephone,
      localite: null,
      nombreVehicules: 0,
      dernierPassageLe: CLIENT.dernierPassageLe,
    },
    vehicule: VEHICULE,
    figees: {
      clientDesignation: 'Jean Dupont',
      adresseFacturation: null,
      plaque: '123456',
      detenteurClientId: CLIENT_ID,
    },
    conducteurPresentNom: null,
    kilometrageEntree: null,
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
    etatAffiche: 'ouvert',
    actionsDisponibles: [],
    version: 1,
    creeLe: '2026-07-01T08:00:00.000Z',
    modifieLe: '2026-07-01T08:00:00.000Z',
    modifiePar: null,
    ...overrides,
  };
}

function rendre(routeInitiale: string) {
  return renduAvecRoutes(
    [
      { path: '/ordres-reparation/nouveau', element: <EcranNouvelOrdreReparation /> },
      { path: '/ordres-reparation/:id', element: <div>PAGE_FICHE_OR</div> },
      { path: '/recherche', element: <div>PAGE_RECHERCHE</div> },
    ],
    { routeInitiale },
  );
}

describe('EcranNouvelOrdreReparation', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  describe("le site n'est jamais inventé", () => {
    it("sans `?site=`, l'écran DEMANDE explicitement un site plutôt que d'en choisir un par défaut, même si `clientId` est connu", async () => {
      // Le client GET peut être déclenché (le hook est appelé inconditionnellement), mais l'écran
      // ne doit JAMAIS afficher le formulaire de création — ouvrir un OR sur un site incorrect ne
      // se découvre qu'à la facturation (voir l'en-tête du composant).
      server.use(http.get(`/api/v1/clients/${CLIENT_ID}`, () => HttpResponse.json(CLIENT)));
      rendre(`/ordres-reparation/nouveau?clientId=${CLIENT_ID}`);

      expect(await screen.findByText('Site non sélectionné')).toBeInTheDocument();
      expect(
        screen.getByText(
          "Choisissez un site avant d'ouvrir un ordre de réparation : la numérotation et le paramétrage de l'OR en dépendent.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: "Retour à l'accueil" })).toBeInTheDocument();
      expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    });
  });

  describe('le client est un prérequis explicite, jamais deviné', () => {
    it('sans `?clientId=`, renvoie vers `/recherche` (site conservé) plutôt que de proposer un second moyen de chercher un client ici', async () => {
      rendre(`/ordres-reparation/nouveau?site=${SITE_ID}`);

      expect(await screen.findByText('Client non sélectionné')).toBeInTheDocument();
      const lien = screen.getByRole('link', { name: 'Rechercher' });
      expect(lien).toHaveAttribute('href', expect.stringContaining('/recherche'));
      expect(lien).toHaveAttribute('href', expect.stringContaining(`site=${SITE_ID}`));
    });
  });

  describe('parcours complet : site + client connus -> sélection véhicule -> création -> navigation', () => {
    it("charge le client, laisse choisir un véhicule détenu, ouvre l'OR puis navigue vers sa fiche en conservant `?site=`", async () => {
      server.use(
        http.get(`/api/v1/clients/${CLIENT_ID}`, () => HttpResponse.json(CLIENT)),
        http.get(`/api/v1/clients/${CLIENT_ID}/vehicules`, () =>
          HttpResponse.json({
            donnees: [VEHICULE],
            curseurSuivant: null,
            limite: 50,
          } satisfies PageCurseur<VehiculeResume>),
        ),
        http.get('/api/v1/parametres-atelier', () => HttpResponse.json(PARAMETRES_ATELIER)),
        http.post('/api/v1/ordres-reparation', () =>
          HttpResponse.json({ donnees: construireOr(), avertissements: [] }, { status: 201 }),
        ),
      );

      const utilisateur = userEvent.setup();
      const { routeur } = rendre(
        `/ordres-reparation/nouveau?site=${SITE_ID}&clientId=${CLIENT_ID}`,
      );

      expect(await screen.findByText('Jean Dupont')).toBeInTheDocument();

      const optionVehicule = await screen.findByRole('radio', { name: /VW Touran 2\.0 TDI/ });
      await utilisateur.click(optionVehicule);

      const boutonCreer = await screen.findByRole('button', { name: "Ouvrir l'OR" });
      await utilisateur.click(boutonCreer);

      await waitFor(() => expect(screen.getByText('PAGE_FICHE_OR')).toBeInTheDocument());
      expect(routeur.state.location.pathname).toBe('/ordres-reparation/or-9');
      expect(routeur.state.location.search).toBe(`?site=${SITE_ID}`);
    });
  });
});
