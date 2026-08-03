import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  ReponseClient,
  ReponseOrdreReparation,
  ReponseParametresAtelier,
  VehiculeResume,
} from '@dfa/shared';

import { server } from '@/test/msw/server';
import { renduAvecQueryClient } from '@/test/utils';

import { FormulaireNouvelOrdreReparation } from './FormulaireNouvelOrdreReparation';

// Radix Select (type d'OR) appelle `hasPointerCapture`/`scrollIntoView`, absents de jsdom — même
// stub que `EcranFicheVehicule.spec.tsx`.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

// `schemaCreationOrdreReparation` (validé côté client avant tout POST, source de vérité
// partagée avec le serveur) exige des UUID sur `siteId`/`clientId`/`vehiculeId` —
// `schemaIdentifiant = z.string().uuid()`. Des identifiants courts (`'v1'`, `'cl-1'`) feraient
// échouer la validation locale AVANT tout appel réseau, ce qui invaliderait silencieusement tous
// les scénarios ci-dessous (aucune requête ne partirait jamais).
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

function rendre(onCree = vi.fn(), onChangerVehicule = vi.fn()) {
  server.use(http.get('/api/v1/parametres-atelier', () => HttpResponse.json(PARAMETRES_ATELIER)));
  return {
    onCree,
    onChangerVehicule,
    ...renduAvecQueryClient(
      <FormulaireNouvelOrdreReparation
        site={SITE_ID}
        client={CLIENT}
        vehicule={VEHICULE}
        onChangerVehicule={onChangerVehicule}
        onCree={onCree}
      />,
    ),
  };
}

describe('FormulaireNouvelOrdreReparation', () => {
  it("ouvre directement l'OR quand le serveur ne remonte aucune confirmation à traiter", async () => {
    let corpsRecu: Record<string, unknown> | null = null;
    server.use(
      http.post('/api/v1/ordres-reparation', async ({ request }) => {
        corpsRecu = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ donnees: construireOr(), avertissements: [] }, { status: 201 });
      }),
    );
    const utilisateur = userEvent.setup();
    const { onCree } = rendre();

    await utilisateur.click(await screen.findByRole('button', { name: "Ouvrir l'OR" }));

    await waitFor(() => expect(onCree).toHaveBeenCalledWith(construireOr()));
    expect(corpsRecu).toMatchObject({
      siteId: SITE_ID,
      clientId: CLIENT_ID,
      vehiculeId: VEHICULE_ID,
      type: 'reparation',
    });
  });

  it('une demande verbatim ajoutée est envoyée TELLE QUELLE (jamais reformulée) dans `demandes[]`', async () => {
    let corpsRecu: { readonly demandes?: readonly { readonly verbatim: string }[] } | null = null;
    server.use(
      http.post('/api/v1/ordres-reparation', async ({ request }) => {
        corpsRecu = (await request.json()) as {
          readonly demandes?: readonly { readonly verbatim: string }[];
        };
        return HttpResponse.json({ donnees: construireOr(), avertissements: [] }, { status: 201 });
      }),
    );
    const utilisateur = userEvent.setup();
    rendre();

    const champDemande = screen.getByLabelText('Verbatim');
    await utilisateur.type(champDemande, 'Bruit bizarre au freinage');
    await utilisateur.click(screen.getByRole('button', { name: 'Ajouter' }));

    expect(screen.getByText('« Bruit bizarre au freinage »')).toBeInTheDocument();

    await utilisateur.click(screen.getByRole('button', { name: "Ouvrir l'OR" }));

    await waitFor(() =>
      expect(corpsRecu?.demandes).toEqual([{ verbatim: 'Bruit bizarre au freinage' }]),
    );
  });

  describe('CONFIRMATION_REQUISE (§4.4) — la création reste possible, un accord explicite suffit', () => {
    it('affiche « Continuer quand même » puis, après confirmation en deux temps, ouvre l’OR', async () => {
      let appel = 0;
      const corps: Record<string, unknown>[] = [];
      server.use(
        http.post('/api/v1/ordres-reparation', async ({ request }) => {
          appel += 1;
          corps.push((await request.json()) as Record<string, unknown>);
          if (appel === 1) {
            return HttpResponse.json(
              {
                type: 'https://docs.dmsforall.example/erreurs/CONFIRMATION_REQUISE',
                title: 'Confirmation requise',
                status: 409,
                code: 'CONFIRMATION_REQUISE',
                instance: 'req-1',
                confirmationsRequises: ['CLIENT_BLOQUE'],
              },
              { status: 409, headers: { 'content-type': 'application/problem+json' } },
            );
          }
          return HttpResponse.json(
            { donnees: construireOr(), avertissements: [] },
            { status: 201 },
          );
        }),
      );

      const utilisateur = userEvent.setup({ pointerEventsCheck: 0 });
      const { onCree } = rendre();

      await utilisateur.click(await screen.findByRole('button', { name: "Ouvrir l'OR" }));

      const boutonContinuer = await screen.findByRole('button', { name: 'Continuer quand même' });
      await utilisateur.click(boutonContinuer);

      const dialogue = await screen.findByRole('dialog');
      expect(
        within(dialogue).getByText('Une confirmation est requise pour poursuivre.'),
      ).toBeInTheDocument();
      await utilisateur.click(
        within(dialogue).getByRole('button', { name: 'Continuer quand même' }),
      );

      await waitFor(() => expect(onCree).toHaveBeenCalledTimes(1));
      expect(appel).toBe(2);
      expect(corps[1]?.confirmations).toEqual(['CLIENT_BLOQUE']);
    });
  });

  it('un refus RÉSEAU affiche une alerte distincte, jamais confondue avec une confirmation', async () => {
    server.use(http.post('/api/v1/ordres-reparation', () => HttpResponse.error()));
    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.click(await screen.findByRole('button', { name: "Ouvrir l'OR" }));

    expect(await screen.findByText('Connexion impossible')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continuer quand même' })).not.toBeInTheDocument();
  });
});
