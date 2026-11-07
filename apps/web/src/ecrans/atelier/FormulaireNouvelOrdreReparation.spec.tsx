import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  ReponseClient,
  ReponseContexteAtelier,
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

/** `useContexteAtelier` (appelé par `FormulaireNouvelOrdreReparation` pour NOMMER les OR déjà
 *  ouverts dans la confirmation `VEHICULE_DEUX_OR_OUVERTS`, issues #64/#66) — vide par défaut,
 *  chaque test de la section confirmation le surcharge avec les OR voulus via `server.use`. Sans
 *  ce handler par défaut, CHAQUE test de ce fichier échouerait (`onUnhandledRequest: 'error'`,
 *  `test/setup.ts`), y compris ceux qui n'ont rien à voir avec cette confirmation. */
function contexteAtelierVide(
  overrides: Partial<ReponseContexteAtelier> = {},
): ReponseContexteAtelier {
  return {
    vehicule: {
      id: VEHICULE_ID,
      plaque: VEHICULE.plaque,
      canton: VEHICULE.canton,
      designation: VEHICULE.designation,
      premiereMiseEnCirculationLe: VEHICULE.premiereMiseEnCirculationLe,
      vin: VEHICULE.vin,
      codeTypeCh: null,
      importe: { estImporte: false, paysOrigine: null, importeLe: null },
      identificationIncomplete: false,
    },
    detenteurCourant: null,
    dernierKilometrage: null,
    expertise: null,
    garantie: { constructeur: null, garage: null },
    campagnesOuvertes: [],
    travauxReportes: { total: 0, elements: [] },
    alertesClient: [],
    ordresReparationOuverts: [],
    depotPneus: null,
    avertissements: [],
    ...overrides,
  };
}

/** `contexteAtelier` en paramètre (pas un `server.use` séparé après coup) : la requête `GET
 *  .../contexte-atelier` part dès le MONTAGE, sans attendre un clic — un `server.use` posé après
 *  `rendre()` perdrait la course contre celui, générique, déjà enregistré ici, et un `server.use`
 *  posé avant serait écrasé par celui-ci (dernier enregistré = prioritaire côté MSW). */
function rendre(
  onCree = vi.fn(),
  onChangerVehicule = vi.fn(),
  contexteAtelier: ReponseContexteAtelier = contexteAtelierVide(),
) {
  server.use(
    http.get('/api/v1/parametres-atelier', () => HttpResponse.json(PARAMETRES_ATELIER)),
    http.get(`/api/v1/vehicules/${VEHICULE_ID}/contexte-atelier`, () =>
      HttpResponse.json(contexteAtelier),
    ),
  );
  return {
    onCree,
    onChangerVehicule,
    ...renduAvecQueryClient(
      <MemoryRouter>
        <FormulaireNouvelOrdreReparation
          site={SITE_ID}
          client={CLIENT}
          vehicule={VEHICULE}
          onChangerVehicule={onChangerVehicule}
          onCree={onCree}
        />
      </MemoryRouter>,
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

    await utilisateur.click(
      await screen.findByRole('button', { name: "Ouvrir l'ordre de réparation" }),
    );

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

    const champDemande = screen.getByLabelText('Demandes du client');
    await utilisateur.type(champDemande, 'Bruit bizarre au freinage');
    await utilisateur.click(screen.getByRole('button', { name: 'Ajouter' }));

    expect(screen.getByText('« Bruit bizarre au freinage »')).toBeInTheDocument();

    await utilisateur.click(screen.getByRole('button', { name: "Ouvrir l'ordre de réparation" }));

    await waitFor(() =>
      expect(corpsRecu?.demandes).toEqual([{ verbatim: 'Bruit bizarre au freinage' }]),
    );
  });

  it("CORRECTIF (test d'utilisabilité novice, 11.08.2026) : un texte tapé dans « Demandes du client » sans jamais cliquer « + Ajouter » n'est PAS perdu à la soumission — « le mécanicien reçoit une voiture sans savoir pourquoi elle est là »", async () => {
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

    const champDemande = screen.getByLabelText('Demandes du client');
    await utilisateur.type(
      champDemande,
      'Bruit anormal à l’avant droit quand je roule, surtout dans les virages',
    );
    // AUCUN clic sur « + Ajouter » — exactement le geste du testeur : direct sur le bouton du bas.
    await utilisateur.click(screen.getByRole('button', { name: "Ouvrir l'ordre de réparation" }));

    await waitFor(() =>
      expect(corpsRecu?.demandes).toEqual([
        { verbatim: 'Bruit anormal à l’avant droit quand je roule, surtout dans les virages' },
      ]),
    );
  });

  it('un texte tapé mais non ajouté se combine avec les demandes déjà ajoutées, sans doublon ni perte', async () => {
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

    const champDemande = screen.getByLabelText('Demandes du client');
    await utilisateur.type(champDemande, 'Vidange à faire');
    await utilisateur.click(screen.getByRole('button', { name: 'Ajouter' }));
    await utilisateur.type(champDemande, 'Bruit au freinage');
    // Ce second texte reste dans le champ, jamais cliqué « + Ajouter ».
    await utilisateur.click(screen.getByRole('button', { name: "Ouvrir l'ordre de réparation" }));

    await waitFor(() =>
      expect(corpsRecu?.demandes).toEqual([
        { verbatim: 'Vidange à faire' },
        { verbatim: 'Bruit au freinage' },
      ]),
    );
  });

  describe('CONFIRMATION_REQUISE (§4.4) — la création reste possible, un accord explicite suffit', () => {
    it("la modale de confirmation s'ouvre D'ELLE-MÊME (issues #64/#66 : plus besoin d'un premier clic sur un encart qu'on peut manquer), et confirmer ouvre l'OR", async () => {
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

      await utilisateur.click(
        await screen.findByRole('button', { name: "Ouvrir l'ordre de réparation" }),
      );

      // La modale apparaît SANS geste intermédiaire : aucun bouton « Continuer quand même » inline
      // à trouver d'abord — c'est exactement le défaut terrain corrigé (un second clic silencieux
      // sur le bouton déjà cliqué, faute de réaction visible dans son champ visuel).
      const dialogue = await screen.findByRole('dialog');
      expect(within(dialogue).getByText("Confirmez l'action pour continuer.")).toBeInTheDocument();
      await utilisateur.click(
        within(dialogue).getByRole('button', { name: 'Continuer quand même' }),
      );

      await waitFor(() => expect(onCree).toHaveBeenCalledTimes(1));
      expect(appel).toBe(2);
      expect(corps[1]?.confirmations).toEqual(['CLIENT_BLOQUE']);
    });

    it('nomme les OR déjà ouverts (issue #64/#66 : « voici lesquels ») au lieu du seul message générique du serveur', async () => {
      server.use(
        http.post('/api/v1/ordres-reparation', () =>
          HttpResponse.json(
            {
              type: 'https://docs.dmsforall.example/erreurs/CONFIRMATION_REQUISE',
              title: 'Confirmation requise',
              status: 409,
              code: 'CONFIRMATION_REQUISE',
              instance: 'req-2',
              confirmationsRequises: ['VEHICULE_DEUX_OR_OUVERTS'],
            },
            { status: 409, headers: { 'content-type': 'application/problem+json' } },
          ),
        ),
      );

      const utilisateur = userEvent.setup({ pointerEventsCheck: 0 });
      rendre(
        vi.fn(),
        vi.fn(),
        contexteAtelierVide({
          ordresReparationOuverts: [
            { id: 'or-1', numero: 'OR-000001', statut: 'ouvert' },
            { id: 'or-2', numero: 'OR-000002', statut: 'ouvert' },
          ],
        }),
      );

      await utilisateur.click(
        await screen.findByRole('button', { name: "Ouvrir l'ordre de réparation" }),
      );

      const dialogue = await screen.findByRole('dialog');
      // `contexteAtelier` (`GET .../contexte-atelier`) est une requête DISTINCTE du `POST` qui
      // a ouvert la modale — son propre aller-retour réseau n'est pas forcément résolu au
      // premier rendu de la modale, `findByText` (pas `getByText`) attend qu'il le soit.
      expect(
        await within(dialogue).findByText(
          'Déjà ouvert pour ce véhicule : OR-000001, OR-000002. Ouvrir quand même un nouvel ordre de réparation ?',
        ),
      ).toBeInTheDocument();
      // Chaque OR déjà ouvert est un lien vers sa fiche (nouvel onglet : la saisie en cours reste).
      const lien = within(dialogue).getByRole('link', { name: /OR-000001/ });
      expect(lien).toHaveAttribute('href', expect.stringContaining('/ordres-reparation/'));
      expect(lien).toHaveAttribute('target', '_blank');
    });

    it("« Annuler » referme la modale sans qu'elle se rouvre toute seule — le refus reste un vrai refus", async () => {
      server.use(
        http.post('/api/v1/ordres-reparation', () =>
          HttpResponse.json(
            {
              type: 'https://docs.dmsforall.example/erreurs/CONFIRMATION_REQUISE',
              title: 'Confirmation requise',
              status: 409,
              code: 'CONFIRMATION_REQUISE',
              instance: 'req-3',
              confirmationsRequises: ['CLIENT_BLOQUE'],
            },
            { status: 409, headers: { 'content-type': 'application/problem+json' } },
          ),
        ),
      );

      const utilisateur = userEvent.setup({ pointerEventsCheck: 0 });
      rendre();

      await utilisateur.click(
        await screen.findByRole('button', { name: "Ouvrir l'ordre de réparation" }),
      );
      const dialogue = await screen.findByRole('dialog');
      await utilisateur.click(within(dialogue).getByRole('button', { name: 'Annuler' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      // Laissée quelques instants : si le drapeau de rejet n'existait pas, `confirmationsRequises`
      // resterait posé côté hook et la modale se rouvrirait TOUTE SEULE au rendu suivant.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('un refus RÉSEAU affiche une alerte distincte, jamais confondue avec une confirmation', async () => {
    server.use(http.post('/api/v1/ordres-reparation', () => HttpResponse.error()));
    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.click(
      await screen.findByRole('button', { name: "Ouvrir l'ordre de réparation" }),
    );

    expect(await screen.findByText('Connexion impossible')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continuer quand même' })).not.toBeInTheDocument();
  });

  describe('brouillon local (issue #77) — la demande client et le kilométrage survivent à un démontage inattendu', () => {
    afterEach(() => {
      sessionStorage.clear();
    });

    const CLE_STOCKAGE = `dfa.brouillon.or-nouveau.${VEHICULE_ID}`;

    it("une saisie interrompue (démontage/remontage — panne réseau, `LimiteErreurEcran`) est restaurée avec un bandeau explicite, et peut être ignorée d'un geste", async () => {
      const utilisateur = userEvent.setup();
      let rendu = rendre();

      await utilisateur.type(screen.getByLabelText('Demandes du client'), 'Bruit au freinage');
      await utilisateur.type(screen.getByLabelText("Kilométrage à l'entrée"), '84200');

      // Laisse l'effet de sauvegarde (`useSauvegardeBrouillon`) s'exécuter avant le démontage —
      // simule le crash au pire moment : APRÈS que la frappe a été enregistrée localement.
      await waitFor(() => expect(sessionStorage.getItem(CLE_STOCKAGE)).not.toBeNull());
      rendu.unmount();

      // Remontage — même véhicule, formulaire « vierge » du point de vue du parent (aucune prop
      // ne transporte la saisie précédente, exactement le scénario de l'incident terrain).
      rendu = rendre();

      expect(await screen.findByText(/Brouillon repris de/)).toBeInTheDocument();
      expect(screen.getByLabelText('Demandes du client')).toHaveValue('Bruit au freinage');
      expect(screen.getByLabelText("Kilométrage à l'entrée")).toHaveValue('84200');

      // Exigence n°2 : rejetable d'un geste, sans quoi un formulaire qui se remplit tout seul
      // ferait douter de ce qu'on est en train d'envoyer.
      await utilisateur.click(screen.getByRole('button', { name: 'Ignorer le brouillon' }));
      expect(screen.queryByText(/Brouillon repris de/)).not.toBeInTheDocument();
      expect(screen.getByLabelText('Demandes du client')).toHaveValue('');
      expect(screen.getByLabelText("Kilométrage à l'entrée")).toHaveValue('');

      // Preuve fonctionnelle que le rejet est DURABLE, pas juste visuel sur l'instant : un
      // nouveau montage (même véhicule) ne doit RIEN reprendre — ni bandeau, ni valeur — même si
      // `useSauvegardeBrouillon` a réécrit un brouillon "vide" juste après la remise à zéro
      // ci-dessus (harmless : un brouillon sans aucune valeur n'est jamais traité comme une
      // reprise à annoncer, voir `brouillonEstVide`).
      rendu.unmount();
      rendre();
      expect(screen.queryByText(/Brouillon repris de/)).not.toBeInTheDocument();
      expect(await screen.findByLabelText('Demandes du client')).toHaveValue('');
      expect(screen.getByLabelText("Kilométrage à l'entrée")).toHaveValue('');
    });

    it('une CRÉATION RÉUSSIE efface le brouillon — sans quoi le formulaire suivant reprendrait la demande du client précédent, envoyée sans relecture', async () => {
      server.use(
        http.post('/api/v1/ordres-reparation', () =>
          HttpResponse.json({ donnees: construireOr(), avertissements: [] }, { status: 201 }),
        ),
      );
      const utilisateur = userEvent.setup();
      const { onCree, unmount } = rendre();

      await utilisateur.type(screen.getByLabelText('Demandes du client'), 'Vidange à faire');
      await waitFor(() => expect(sessionStorage.getItem(CLE_STOCKAGE)).not.toBeNull());

      await utilisateur.click(screen.getByRole('button', { name: "Ouvrir l'ordre de réparation" }));
      await waitFor(() => expect(onCree).toHaveBeenCalled());
      expect(sessionStorage.getItem(CLE_STOCKAGE)).toBeNull();

      unmount();
      rendre();
      // Aucun bandeau, aucune reprise : le prochain client ne doit JAMAIS hériter de la demande
      // du précédent.
      expect(screen.queryByText(/Brouillon repris de/)).not.toBeInTheDocument();
      expect(await screen.findByLabelText('Demandes du client')).toHaveValue('');
    });

    it("un simple échec de soumission NE DOIT PAS effacer le brouillon — l'utilisateur doit pouvoir corriger et renvoyer sans retaper", async () => {
      server.use(http.post('/api/v1/ordres-reparation', () => HttpResponse.error()));
      const utilisateur = userEvent.setup();
      rendre();

      await utilisateur.type(screen.getByLabelText('Demandes du client'), 'Bruit au freinage');
      await waitFor(() => expect(sessionStorage.getItem(CLE_STOCKAGE)).not.toBeNull());

      await utilisateur.click(screen.getByRole('button', { name: "Ouvrir l'ordre de réparation" }));
      expect(await screen.findByText('Connexion impossible')).toBeInTheDocument();
      expect(sessionStorage.getItem(CLE_STOCKAGE)).not.toBeNull();
    });
  });
});
