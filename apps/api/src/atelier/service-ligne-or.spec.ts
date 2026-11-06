import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  EntreeAnnulationLignes,
  EntreeCreationLigneOr,
  EntreeMarquageRealisee,
  EntreeRefusLignes,
  ReponseOrdreReparation,
  ReponseReservationPiece,
} from '@dfa/shared';
import type { ContexteTenant, TransactionDfa } from '../db';
import {
  article,
  ligneOr,
  reservationPiece,
  tauxHoraire,
  type LigneArticle,
  type LigneLigneOr,
  type LigneOrdreReparation,
  type LigneTauxHoraire,
} from '../db/schema';
import type { PrincipalAuthentifie } from '../common/contexte/contexte-requete.types';
import type { CreationTravailReporte } from './atelier.jetons';
import { ErreurMetier } from '../common/erreurs/erreur-metier';
import { CalculLigneSimple } from './calcul-ligne';

/**
 * RM-73 : quand un client refuse une ligne de devis, l'information ne doit plus disparaître —
 * `ServiceLigneOr.refuserLignes` doit alimenter les travaux reportés du véhicule via le port
 * `CreationTravailReporte` (`atelier.jetons.ts`), fourni par `VehiculesModule`
 * (`ServiceVehiculeTravailReporte`, `useExisting`).
 *
 * Fonctions de requête et transaction MOQUÉES — même doctrine que `service-or.spec.ts` : ce fichier
 * ne prouve pas que `vehicule_travail_reporte` est réellement écrit en base (ce serait un test
 * d'intégration, propriété de `vehicules/`), il prouve que `refuserLignes` APPELLE bien le port,
 * avec les bons champs, DANS LA MÊME TRANSACTION que le passage de la ligne à `refusee`.
 *
 * Même doctrine pour les suites RP-19/RP-21/RP-23/RP-38 ajoutées plus bas (câblage atelier ↔
 * pièces) : transaction et requêtes moquées, aucune preuve d'écriture réelle en base
 * (testcontainers, hors périmètre unitaire). Depuis que la dette technique signalée au rapport de
 * livraison étape 3-4 est soldée, `ServiceReservation`/`ServiceConsigne` sont des dépendances
 * INJECTÉES de `ServiceLigneOr` (plus de SQL recopié ici) : les tests RP-21/RP-23/RP-38 ci-dessous
 * moquent ces DEUX services plutôt que le SQL qu'ils exécutaient auparavant, et prouvent la
 * composition (même `tx`, mêmes paramètres) — le comportement DÉTAILLÉ de
 * `satisfaire(Tx|PourLigneTx)`/`liberer(Tx|PourLigneTx)`/`creerDepuisRealisationTx` est
 * re-couvert, lui, dans `pieces/service-reservation.spec.ts`/`pieces/service-consigne.spec.ts`
 * (propriétaire du comportement, un seul endroit).
 */
vi.mock('./or-requetes', () => ({
  chargerOrPourEcriture: vi.fn(),
  chargerLignesPourEcriture: vi.fn(),
  chargerLigneOrPourEcriture: vi.fn(),
  listerLignesOr: vi.fn(),
}));

import { CODE_TAUX_HORAIRE_DEFAUT, ServiceLigneOr } from './service-ligne-or';
import * as orRequetes from './or-requetes';

const CTX: ContexteTenant = { tenantId: 'tenant-a', utilisateurId: 'user-1', requeteId: 'req-1' };
const OR_ID = 'or-1';
const LIGNE_ID = 'ligne-1';
const VEHICULE_ID = 'vehicule-1';
const ARTICLE_ID = 'article-1';
const RESERVATION_ID = 'reservation-1';

function principal(role: PrincipalAuthentifie['role']): PrincipalAuthentifie {
  return {
    sessionId: 'session-1',
    tenantId: 'tenant-a',
    utilisateurId: 'user-1',
    role,
    langue: 'fr',
  };
}

function orFixture(): LigneOrdreReparation {
  return {
    id: OR_ID,
    tenantId: 'tenant-a',
    numero: 'OR-2026-042',
    siteId: 'site-1',
    type: 'reparation',
    statut: 'ouvert',
    clientId: 'client-1',
    vehiculeId: VEHICULE_ID,
    clientDesignationFigee: 'Jean Dupont',
    adresseFacturationFigee: {},
    conditionsFigees: {},
    plaqueFigee: 'VD 123456',
    detenteurFigeClientId: null,
    conducteurPresentNom: null,
    kmEntree: 85_000,
    kmSortie: null,
    plafondCentimes: null,
    plafondAutorisePar: null,
    restitutionPromiseLe: null,
    restitutionInitialeLe: null,
    localisation: 'atelier',
    sousTraitantNom: null,
    ordreReparationParentId: null,
    motifLien: null,
    rendezVousId: null,
    numeroCommandeInterne: null,
    receptionnaireId: 'user-1',
    retentionInvoqueeLe: null,
    litigeOuvertLe: null,
    ouvertLe: new Date('2026-07-28T07:00:00.000Z'),
    termineLe: null,
    factureLe: null,
    restitueLe: null,
    clotureLe: null,
    annuleLe: null,
    motifAnnulation: null,
    attenteAccord: false,
    attentePieces: false,
    attenteExterne: false,
    totalValideCentimes: 0,
    version: 1,
    creeLe: new Date('2026-07-28T07:00:00.000Z'),
    modifieLe: new Date('2026-07-28T07:00:00.000Z'),
  } as LigneOrdreReparation;
}

function ligneFixture(overrides: Partial<LigneLigneOr> = {}): LigneLigneOr {
  return {
    id: LIGNE_ID,
    tenantId: 'tenant-a',
    ordreReparationId: OR_ID,
    numeroOrdre: 1,
    type: 'piece',
    origine: 'proposee',
    statut: 'a_valider',
    payeur: 'client',
    blocage: 'accord',
    designation: 'Plaquettes de frein avant',
    referenceTexte: null,
    articleId: null,
    quantiteMillieme: 1000,
    tempsBaremeCentiemes: null,
    tempsBaremeConstructeurCentiemes: null,
    tauxHoraireCentimes: null,
    prixUnitaireCentimes: 8_000,
    rabaisPourmille: 0,
    tauxTvaPourmille: 81,
    montantHtCentimes: 8_000,
    montantTvaCentimes: 648,
    montantTtcCentimes: 8_648,
    technicienId: null,
    codeOperation: null,
    codeDefaut: null,
    numeroSinistre: null,
    numeroAccord: null,
    urgence: 'a_surveiller',
    securite: false,
    fourniParClient: false,
    aRestituer: false,
    restituee: false,
    motifAnnulation: null,
    factureId: null,
    payeurClientId: null,
    creeLe: new Date('2026-07-28T07:00:00.000Z'),
    modifieLe: new Date('2026-07-28T07:00:00.000Z'),
    ...overrides,
  } as LigneLigneOr;
}

/**
 * Fausse transaction : `update(...).set(...).where(...).returning()`, exercée par
 * `transitionnerLigne` pour chaque ligne refusée. `select(...)` répond systématiquement « aucune
 * réservation active » (tableau vide) — `libererReservationSiActive` (RP-23) le sonde après CHAQUE
 * refus/annulation ; ce filet fait retomber les tests EXISTANTS de ce fichier (aucune pièce en
 * jeu) sur un no-op silencieux, exactement le comportement attendu pour une ligne sans réservation.
 */
function txFactice(ligneRefusee: LigneLigneOr) {
  const returning = vi.fn(async () => [{ ...ligneRefusee, statut: 'refusee' }]);
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  const limit = vi.fn(async () => []);
  const selectWhere = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from }));
  return {
    tx: { update, select } as unknown as TransactionDfa,
    update,
    set,
    where,
    returning,
    select,
  };
}

/* ------------------------------------------------------------------------------------------- */
/* Infrastructure de test partagée — RP-19/RP-21/RP-23/RP-38 (câblage atelier ↔ pièces)          */
/* ------------------------------------------------------------------------------------------- */

function articleFixture(overrides: Partial<LigneArticle> = {}): LigneArticle {
  return {
    id: ARTICLE_ID,
    tenantId: 'tenant-a',
    numeroArticle: 'ART-001',
    designation: 'Plaquettes de frein avant (article)',
    marque: null,
    categorie: 'piece_mecanique',
    statut: 'actif',
    referencePrincipale: 'REF-001',
    codeBarres: null,
    prixAchatCentimes: null,
    prixVenteTtcCentimes: 8_000,
    tauxTvaPourmille: 81,
    estEchangeStandard: false,
    montantConsigneTtcCentimes: null,
    referenceRemplacementId: null,
    creeLe: new Date('2026-07-28T07:00:00.000Z'),
    modifieLe: new Date('2026-07-28T07:00:00.000Z'),
    ...overrides,
  } as LigneArticle;
}

/** Forme du RETOUR de `ServiceReservation.satisfairePourLigneTx` (`pieces/`), pas la ligne base de
 *  données — c'est ce que `ServiceLigneOr.marquerRealisee` reçoit désormais (composition par
 *  service injecté, plus de lecture SQL directe de `reservation_piece` ici). */
function reponseReservationFixture(
  overrides: Partial<ReponseReservationPiece> = {},
): ReponseReservationPiece {
  return {
    id: RESERVATION_ID,
    articleId: ARTICLE_ID,
    siteId: 'site-1',
    ligneOrId: LIGNE_ID,
    ordreReparationId: OR_ID,
    quantiteMillieme: 1000,
    statut: 'satisfaite',
    creeLe: '2026-07-28T07:00:00.000Z',
    satisfaiteLe: '2026-07-28T08:00:00.000Z',
    mouvementSortieId: 'mouvement-sortie-1',
    libereeLe: null,
    motifLiberation: null,
    motifLiberationTexte: null,
    libereeParUtilisateurId: null,
    ...overrides,
  };
}

/** Enveloppe « thenable + `.returning()` » : imite le constructeur de requête Drizzle, qui reste
 *  exécutable SOIT directement (`await tx.insert(t).values(v)`, cas de `reserverPieceSiApplicable`
 *  qui n'appelle jamais `.returning()`), SOIT via `.returning()` (cas de `marquerRealisee`). */
function resultatChaine<T>(lignes: T[], erreur?: unknown) {
  const promesse = erreur !== undefined ? Promise.reject(erreur) : Promise.resolve(lignes);
  return {
    returning: () => promesse,
    then: (onFulfilled: (v: T[]) => unknown, onRejected: (e: unknown) => unknown) =>
      promesse.then(onFulfilled, onRejected),
    catch: (onRejected: (e: unknown) => unknown) => promesse.catch(onRejected),
  };
}

/** `select().from(table).where()` générique, indexé par référence de TABLE Drizzle (`article`,
 *  `reservationPiece`, `tauxHoraire`…) — plusieurs tables interviennent dans un même scénario
 *  (`marquerRealisee` lit `reservation_piece` PUIS `article`).
 *
 *  Le `.where()` est THENABLE **et** porte `.limit()` : Drizzle exécute la requête dans les deux
 *  formes, et les deux sont réellement employées ici — `chargerArticleLigne` termine par `.limit(1)`
 *  quand `resoudreTauxHoraireCentimes` (RM-65) `await`e le `.where()` directement, pour lire TOUS
 *  les taux du tenant. Un `.where()` qui ne rendrait que `{ limit }` ferait échouer le second en
 *  `await` sur un objet non thenable — donc en `undefined.filter is not a function`. */
function construireSelect(donnees: Map<unknown, unknown[]>) {
  return vi.fn(() => ({
    from: vi.fn((table: unknown) => ({
      where: vi.fn(() => {
        const lignes = donnees.get(table) ?? [];
        const promesse = Promise.resolve(lignes);
        return {
          limit: vi.fn(async () => lignes),
          then: (onFulfilled: (v: unknown[]) => unknown, onRejected: (e: unknown) => unknown) =>
            promesse.then(onFulfilled, onRejected),
          catch: (onRejected: (e: unknown) => unknown) => promesse.catch(onRejected),
        };
      }),
    })),
  }));
}

interface AppelEcriture {
  readonly table: unknown;
  readonly valeurs: unknown;
}

/** `insert(table).values(v)` générique — capture chaque appel (`appels`) pour les assertions,
 *  indexé par table pour la valeur/erreur rendue. */
function construireInsert(donnees: Map<unknown, { lignes?: unknown[]; erreur?: unknown }>) {
  const appels: AppelEcriture[] = [];
  const insert = vi.fn((table: unknown) => ({
    values: (valeurs: unknown) => {
      appels.push({ table, valeurs });
      const cfg = donnees.get(table);
      return resultatChaine(cfg?.lignes ?? [], cfg?.erreur);
    },
  }));
  return { insert, appels };
}

/** `update(table).set(v).where()` générique — même doctrine que `construireInsert`. */
function construireUpdate(donnees: Map<unknown, unknown[]>) {
  const appels: AppelEcriture[] = [];
  const update = vi.fn((table: unknown) => ({
    set: (valeurs: unknown) => {
      appels.push({ table, valeurs });
      return {
        where: vi.fn(() => resultatChaine(donnees.get(table) ?? [])),
      };
    },
  }));
  return { update, appels };
}

/**
 * `tx.transaction(async (tx2) => …)` — SAVEPOINT réel en production (`NodePgTransaction.
 * transaction()`, voir la docstring de `reserverPieceSiApplicable`), simulé ici en PASSTHROUGH :
 * le callback reçoit CE MÊME `tx` factice (un mock ne distingue pas `tx` de `tx2`, les deux
 * exercent le même `insert(reservationPiece)` moqué) et toute erreur qu'il lève est PROPAGÉE telle
 * quelle — exactement le comportement observable par l'appelant, que la transaction imbriquée
 * commit ou fasse `ROLLBACK TO SAVEPOINT` avant de la relancer.
 */
function ajouterTransactionPassthrough<T extends object>(tx: T): T {
  return Object.assign(tx, {
    transaction: vi.fn((travail: (tx: T) => Promise<unknown>) => travail(tx)),
  });
}

function idempotenceFactice(tx: TransactionDfa) {
  return {
    executer: vi.fn(
      async (
        _ctx: ContexteTenant,
        _requete: unknown,
        travail: (tx: TransactionDfa) => Promise<{ statutHttp: number; corps: unknown }>,
      ) => ({ reponse: await travail(tx), rejoue: false }),
    ),
  };
}

function calculFactice(
  montants = { montantHtCentimes: 8_000, montantTvaCentimes: 648, montantTtcCentimes: 8_648 },
) {
  return { calculer: vi.fn(() => montants) };
}

function accesBaseFactice(tx: TransactionDfa) {
  return {
    enTenant: vi.fn(
      async (_ctx: ContexteTenant, travail: (tx: TransactionDfa) => Promise<unknown>) =>
        travail(tx),
    ),
  };
}

function travailReporteFactice(): { creerDepuisRefus: ReturnType<typeof vi.fn> } {
  return { creerDepuisRefus: vi.fn(async () => undefined) };
}

/** Stub par défaut de `ServiceReservation` injecté : `libererPourLigneTx` en no-op silencieux
 *  (aucune réservation active — comportement par défaut sans mise en scène spécifique), jamais
 *  exercé par les tests RM-73/`creer()` qui utilisent ce stub. */
function serviceReservationFactice(
  overrides: Partial<{
    satisfairePourLigneTx: ReturnType<typeof vi.fn>;
    libererPourLigneTx: ReturnType<typeof vi.fn>;
  }> = {},
) {
  return {
    satisfairePourLigneTx: vi.fn(async () => null),
    libererPourLigneTx: vi.fn(async () => undefined),
    ...overrides,
  };
}

/** Stub par défaut de `ServiceConsigne` injecté — voir `serviceReservationFactice`. */
function serviceConsigneFactice(
  overrides: Partial<{ creerDepuisRealisationTx: ReturnType<typeof vi.fn> }> = {},
) {
  return {
    creerDepuisRealisationTx: vi.fn(async () => null),
    ...overrides,
  };
}

/** Seuls `acces`, `travailReporte` et `serviceOr` sont exercés par `refuserLignes()` (au-delà du
 *  stub par défaut de `ServiceReservation`, exercé par la libération automatique RP-23) — les 3
 *  autres dépendances du constructeur (idempotence, événements, calcul) n'interviennent QUE dans
 *  `creer()`/`modifier()`, jamais dans les actions groupées. */
function serviceFactice(
  acces: ReturnType<typeof accesBaseFactice>,
  travailReporte: ReturnType<typeof travailReporteFactice>,
  document: ReponseOrdreReparation,
): ServiceLigneOr {
  const serviceOr = { assemblerDocument: vi.fn(async () => document) };
  return new ServiceLigneOr(
    acces as never,
    {} as never,
    {} as never,
    {} as never,
    travailReporte as unknown as CreationTravailReporte,
    serviceOr as never,
    serviceReservationFactice() as never,
    serviceConsigneFactice() as never,
  );
}

/** `creer()`/`marquerRealisee()` n'appellent jamais `acces.enTenant` directement (c'est
 *  `idempotence.executer` — mocké ici — qui l'aurait fait en production, voir
 *  `idempotence.types.ts`) ni `serviceOr`/`travailReporte`/`ServiceReservation`/`ServiceConsigne`
 *  — dummies non exercés (`creer()` réserve la pièce par INSERT direct, RP-19/RP-20, GELÉ). */
function serviceFacticePieces(
  tx: TransactionDfa,
  calcul: ReturnType<typeof calculFactice>,
): ServiceLigneOr {
  return new ServiceLigneOr(
    {} as never,
    idempotenceFactice(tx) as never,
    { publier: vi.fn() } as never,
    calcul as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

/** `marquerRealisee()` passe par `acces.enTenant` (pas d'idempotence sur une action de
 *  transition) — voir `service-ligne-or.ts::marquerRealisee`. `serviceReservation`/`serviceConsigne`
 *  paramétrables : c'est PRÉCISÉMENT ce que les tests RP-21/RP-38 ci-dessous exercent (composition,
 *  même `tx` transmis). */
function serviceFacticePiecesRealisation(
  tx: TransactionDfa,
  serviceReservation: ReturnType<typeof serviceReservationFactice> = serviceReservationFactice(),
  serviceConsigne: ReturnType<typeof serviceConsigneFactice> = serviceConsigneFactice(),
): ServiceLigneOr {
  return new ServiceLigneOr(
    accesBaseFactice(tx) as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    serviceReservation as never,
    serviceConsigne as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ServiceLigneOr.refuserLignes — câblage du port CreationTravailReporte (RM-73)', () => {
  it('refuser une ligne appelle le port avec les bons champs (vehiculeId, ligneOrId, designation, urgence, montant, sécurité, motif)', async () => {
    const or = orFixture();
    const ligne = ligneFixture();
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(or);
    vi.mocked(orRequetes.chargerLignesPourEcriture).mockResolvedValue([ligne]);
    const { tx } = txFactice(ligne);
    const acces = accesBaseFactice(tx);
    const travailReporte = travailReporteFactice();
    const service = serviceFactice(acces, travailReporte, {} as ReponseOrdreReparation);

    const entree: EntreeRefusLignes = {
      ligneIds: [LIGNE_ID],
      motif: 'Client refuse le devis, plaquettes reportées',
    };
    await service.refuserLignes(CTX, principal('receptionnaire'), OR_ID, entree);

    expect(travailReporte.creerDepuisRefus).toHaveBeenCalledTimes(1);
    const [txAppel, ctxAppel, entreeAppel, maintenantAppel] = travailReporte.creerDepuisRefus.mock
      .calls[0] as [TransactionDfa, ContexteTenant, unknown, Date];
    expect(ctxAppel).toBe(CTX);
    expect(entreeAppel).toEqual({
      vehiculeId: VEHICULE_ID,
      ordreReparationId: OR_ID,
      ligneOrId: LIGNE_ID,
      designation: 'Plaquettes de frein avant',
      urgence: 'a_surveiller',
      montantEstimeCentimes: 8_648,
      securite: false,
      motifRefus: 'Client refuse le devis, plaquettes reportées',
    });
    expect(maintenantAppel).toBeInstanceOf(Date);

    // Preuve d'atomicité : le port reçoit EXACTEMENT le même objet `tx` que celui utilisé pour
    // écrire `ligne_or.statut = 'refusee'` — pas une transaction séparée.
    expect(txAppel).toBe(tx);
  });

  it("motif absent de l'entrée -> motifRefus transmis à null, jamais `undefined`", async () => {
    const or = orFixture();
    const ligne = ligneFixture();
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(or);
    vi.mocked(orRequetes.chargerLignesPourEcriture).mockResolvedValue([ligne]);
    const { tx } = txFactice(ligne);
    const acces = accesBaseFactice(tx);
    const travailReporte = travailReporteFactice();
    const service = serviceFactice(acces, travailReporte, {} as ReponseOrdreReparation);

    const entree: EntreeRefusLignes = { ligneIds: [LIGNE_ID] };
    await service.refuserLignes(CTX, principal('receptionnaire'), OR_ID, entree);

    expect(travailReporte.creerDepuisRefus).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ motifRefus: null }),
      expect.any(Date),
    );
  });

  it('désignation absente en base (`null`) -> transmise en chaîne vide, jamais `null`, au port (même coalescence défensive que mapperLigneOr)', async () => {
    const or = orFixture();
    const ligne = ligneFixture({ designation: null });
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(or);
    vi.mocked(orRequetes.chargerLignesPourEcriture).mockResolvedValue([ligne]);
    const { tx } = txFactice(ligne);
    const acces = accesBaseFactice(tx);
    const travailReporte = travailReporteFactice();
    const service = serviceFactice(acces, travailReporte, {} as ReponseOrdreReparation);

    await service.refuserLignes(CTX, principal('receptionnaire'), OR_ID, { ligneIds: [LIGNE_ID] });

    expect(travailReporte.creerDepuisRefus).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ designation: '' }),
      expect.any(Date),
    );
  });

  it('refuser PLUSIEURS lignes appelle le port UNE FOIS PAR LIGNE, chacune avec son propre ligneOrId', async () => {
    const or = orFixture();
    const ligneA = ligneFixture({ id: 'ligne-a', designation: 'Plaquettes avant' });
    const ligneB = ligneFixture({ id: 'ligne-b', designation: 'Disques avant' });
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(or);
    vi.mocked(orRequetes.chargerLignesPourEcriture).mockResolvedValue([ligneA, ligneB]);
    const { tx } = txFactice(ligneA);
    const acces = accesBaseFactice(tx);
    const travailReporte = travailReporteFactice();
    const service = serviceFactice(acces, travailReporte, {} as ReponseOrdreReparation);

    await service.refuserLignes(CTX, principal('receptionnaire'), OR_ID, {
      ligneIds: ['ligne-a', 'ligne-b'],
    });

    expect(travailReporte.creerDepuisRefus).toHaveBeenCalledTimes(2);
    const ligneOrIds = travailReporte.creerDepuisRefus.mock.calls.map(
      (appel) => (appel[2] as { ligneOrId: string }).ligneOrId,
    );
    expect(ligneOrIds).toEqual(['ligne-a', 'ligne-b']);
  });

  it("RP-23, deuxième cas : refuser une ligne 'piece' appelle ServiceReservation.libererPourLigneTx(tx, ctx, ligneId, 'refus_devis'), avec le MÊME tx que la transition de la ligne", async () => {
    const or = orFixture();
    const ligne = ligneFixture({ type: 'piece', articleId: ARTICLE_ID });
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(or);
    vi.mocked(orRequetes.chargerLignesPourEcriture).mockResolvedValue([ligne]);
    const { tx } = txFactice(ligne);
    const acces = accesBaseFactice(tx);
    const travailReporte = travailReporteFactice();
    const libererPourLigneTx = vi.fn(async () => undefined);
    const service = new ServiceLigneOr(
      acces as never,
      {} as never,
      {} as never,
      {} as never,
      travailReporte as unknown as CreationTravailReporte,
      { assemblerDocument: vi.fn(async () => ({}) as ReponseOrdreReparation) } as never,
      { libererPourLigneTx } as never,
      {} as never,
    );

    await service.refuserLignes(CTX, principal('receptionnaire'), OR_ID, {
      ligneIds: [LIGNE_ID],
    });

    expect(libererPourLigneTx).toHaveBeenCalledWith(tx, CTX, LIGNE_ID, 'refus_devis');
  });
});

/* ------------------------------------------------------------------------------------------- */
/* RP-19/RP-20/RP-24 : réservation de pièce posée à la création d'une ligne d'OR                 */
/* ------------------------------------------------------------------------------------------- */

function entreePieceFixture(overrides: Partial<EntreeCreationLigneOr> = {}): EntreeCreationLigneOr {
  return {
    type: 'piece',
    origine: 'interne',
    designation: 'Plaquettes de frein avant',
    referenceTexte: null,
    articleId: ARTICLE_ID,
    quantiteMillieme: 1000,
    tempsBaremeCentiemes: null,
    prixUnitaireCentimes: 8_000,
    rabaisPourmille: 0,
    payeur: 'client',
    payeurClientId: null,
    technicienId: null,
    urgence: null,
    securite: false,
    fournieParClient: false,
    pieceARestituer: false,
    codeOperation: null,
    codeDefaut: null,
    numeroSinistre: null,
    numeroAccord: null,
    blocage: 'aucun',
    ...overrides,
  } as EntreeCreationLigneOr;
}

describe('ServiceLigneOr.creer — réservation de pièce à la pose (RP-19/RP-20/RP-24)', () => {
  it("type='piece' + articleId + stock suffisant → réserve la pièce (INSERT reservation_piece), blocage inchangé", async () => {
    const or = orFixture();
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(or);
    vi.mocked(orRequetes.listerLignesOr).mockResolvedValue([]);

    const ligneInseree = ligneFixture({
      type: 'piece',
      articleId: ARTICLE_ID,
      fourniParClient: false,
      quantiteMillieme: 1000,
      blocage: 'aucun',
      statut: 'validee',
    });
    const select = construireSelect(new Map([[article, [articleFixture()]]]));
    const { insert, appels: appelsInsert } = construireInsert(
      new Map<unknown, { lignes?: unknown[]; erreur?: unknown }>([
        [ligneOr, { lignes: [ligneInseree] }],
        [reservationPiece, { lignes: [] }],
      ]),
    );
    const { update } = construireUpdate(new Map());
    const tx = ajouterTransactionPassthrough({
      select,
      insert,
      update,
    }) as unknown as TransactionDfa;

    const service = serviceFacticePieces(tx, calculFactice());
    const resultat = await service.creer(
      CTX,
      principal('receptionnaire'),
      OR_ID,
      entreePieceFixture(),
      'idem-1',
    );

    expect(resultat.reponse.statutHttp).toBe(201);
    const corps = resultat.reponse.corps as { donnees: { blocage: string } };
    expect(corps.donnees.blocage).toBe('aucun');

    const appelReservation = appelsInsert.find((a) => a.table === reservationPiece);
    expect(appelReservation?.valeurs).toEqual({
      tenantId: 'tenant-a',
      articleId: ARTICLE_ID,
      siteId: 'site-1',
      ligneOrId: LIGNE_ID,
      ordreReparationId: OR_ID,
      quantiteMillieme: 1000,
    });
    // Garde de régression pour le correctif SAVEPOINT (voir la docstring de
    // `reserverPieceSiApplicable`) : l'INSERT spéculatif DOIT passer par `tx.transaction(...)`,
    // jamais par un `tx.insert(...)` nu — sans quoi un ZDFA4 laisserait la transaction PostgreSQL
    // "aborted" (25P02) et le rattrapage `blocage='pieces'` échouerait à son tour (500).
    expect(
      (tx as unknown as { transaction: ReturnType<typeof vi.fn> }).transaction,
    ).toHaveBeenCalledTimes(1);
  });

  it("stock insuffisant (ZDFA4) → PAS d’erreur HTTP, la ligne bascule blocage='pieces' (RP-24)", async () => {
    const or = orFixture();
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(or);
    vi.mocked(orRequetes.listerLignesOr).mockResolvedValue([]);

    const ligneInseree = ligneFixture({
      type: 'piece',
      articleId: ARTICLE_ID,
      fourniParClient: false,
      quantiteMillieme: 1000,
      blocage: 'aucun',
    });
    const ligneBloquee = { ...ligneInseree, blocage: 'pieces' as const };
    const select = construireSelect(new Map([[article, [articleFixture()]]]));
    // Même enveloppe que Drizzle réellement observée en production (voir remonter-cause-pg.ts) :
    // l'erreur pg brute est déballée depuis `.cause`, jamais en surface.
    const erreurZdfa4 = Object.assign(new Error('DrizzleQueryError'), {
      cause: { code: 'ZDFA4', message: 'Stock insuffisant.' },
    });
    const { insert } = construireInsert(
      new Map<unknown, { lignes?: unknown[]; erreur?: unknown }>([
        [ligneOr, { lignes: [ligneInseree] }],
        [reservationPiece, { erreur: erreurZdfa4 }],
      ]),
    );
    const { update, appels: appelsUpdate } = construireUpdate(new Map([[ligneOr, [ligneBloquee]]]));
    const tx = ajouterTransactionPassthrough({
      select,
      insert,
      update,
    }) as unknown as TransactionDfa;

    const service = serviceFacticePieces(tx, calculFactice());
    const resultat = await service.creer(
      CTX,
      principal('receptionnaire'),
      OR_ID,
      entreePieceFixture(),
      'idem-2',
    );

    expect(resultat.reponse.statutHttp).toBe(201);
    const corps = resultat.reponse.corps as { donnees: { blocage: string } };
    expect(corps.donnees.blocage).toBe('pieces');

    const appelBlocage = appelsUpdate.find((a) => a.table === ligneOr);
    expect(appelBlocage?.valeurs).toEqual({ blocage: 'pieces' });

    // Preuve du correctif : le rattrapage `UPDATE ligne_or` a bien été TENTÉ ET RÉUSSI (une ligne
    // rendue) APRÈS l'échec ZDFA4 — c'est exactement ce qui échouait avant (transaction "aborted",
    // 500 ERREUR_INTERNE) sans le SAVEPOINT posé par `tx.transaction(...)`.
    expect(
      (tx as unknown as { transaction: ReturnType<typeof vi.fn> }).transaction,
    ).toHaveBeenCalledTimes(1);
  });

  it('article introuvable pour ce tenant → RESSOURCE_INTROUVABLE, aucune ligne insérée', async () => {
    const or = orFixture();
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(or);
    vi.mocked(orRequetes.listerLignesOr).mockResolvedValue([]);

    const select = construireSelect(new Map()); // article : aucune ligne pour cette table
    const { insert, appels: appelsInsert } = construireInsert(new Map());
    const { update } = construireUpdate(new Map());
    const tx = ajouterTransactionPassthrough({
      select,
      insert,
      update,
    }) as unknown as TransactionDfa;

    const service = serviceFacticePieces(tx, calculFactice());

    await expect(
      service.creer(CTX, principal('receptionnaire'), OR_ID, entreePieceFixture(), 'idem-3'),
    ).rejects.toMatchObject({ code: 'RESSOURCE_INTROUVABLE' });
    expect(appelsInsert.some((a) => a.table === ligneOr)).toBe(false);
  });

  it('article désactivé → VALIDATION_ECHOUEE (champ articleId), aucune ligne insérée', async () => {
    const or = orFixture();
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(or);
    vi.mocked(orRequetes.listerLignesOr).mockResolvedValue([]);

    const select = construireSelect(
      new Map([[article, [articleFixture({ statut: 'desactive' })]]]),
    );
    const { insert, appels: appelsInsert } = construireInsert(new Map());
    const { update } = construireUpdate(new Map());
    const tx = ajouterTransactionPassthrough({
      select,
      insert,
      update,
    }) as unknown as TransactionDfa;

    const service = serviceFacticePieces(tx, calculFactice());

    await expect(
      service.creer(CTX, principal('receptionnaire'), OR_ID, entreePieceFixture(), 'idem-4'),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ECHOUEE',
      erreurs: [expect.objectContaining({ champ: 'articleId' })],
    });
    expect(appelsInsert.some((a) => a.table === ligneOr)).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------- */
/* RP-21/RP-38 : sortie de stock et consigne à la réalisation d'une ligne d'OR                   */
/*                                                                                                */
/* Dette technique soldée (rapport de livraison étape 3-4) : `ServiceLigneOr` composait          */
/* auparavant en répliquant le SQL de `ServiceReservation`/`ServiceConsigne` directement ici.    */
/* Il compose maintenant en APPELANT ces services (`satisfairePourLigneTx`,                      */
/* `creerDepuisRealisationTx`), qui reçoivent le `tx` en cours — la MÊME transaction que le       */
/* passage de la ligne à `realisee`. Le comportement DÉTAILLÉ de ces méthodes (verrou, machine à  */
/* états, cohérence des colonnes de libération) est couvert dans                                 */
/* `pieces/service-reservation.spec.ts`/`pieces/service-consigne.spec.ts` — ce fichier prouve     */
/* seulement la COMPOSITION : bons paramètres, même `tx`, et — point central de cette tâche —     */
/* qu'un échec en cours de composition n'est PAS avalé (propriété dont dépend l'atomicité réelle,  */
/* portée par `AccesBase.enTenant` en production : un rejet qui sort du callback fait ROLLBACK     */
/* tout ce qui a été écrit dans ce `tx`, réservation/consigne/statut de ligne ensemble).           */
/* ------------------------------------------------------------------------------------------- */

describe('ServiceLigneOr.marquerRealisee — sortie de stock et consigne (RP-21/RP-38)', () => {
  it("ligne 'piece' avec réservation active → satisfairePourLigneTx(tx, ctx, ligneId) PUIS creerDepuisRealisationTx(tx, ctx, {…}), avec le MÊME tx que la transition de la ligne", async () => {
    const or = orFixture();
    const ligne = ligneFixture({
      type: 'piece',
      articleId: ARTICLE_ID,
      statut: 'en_cours',
      quantiteMillieme: 1000,
    });
    const ligneRealisee = { ...ligne, statut: 'realisee' as const };
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(or);
    vi.mocked(orRequetes.chargerLigneOrPourEcriture).mockResolvedValue(ligne);

    const { update } = construireUpdate(new Map([[ligneOr, [ligneRealisee]]]));
    const tx = { update } as unknown as TransactionDfa;

    const reservationSatisfaite = reponseReservationFixture({
      articleId: ARTICLE_ID,
      siteId: 'site-2',
      quantiteMillieme: 1000,
    });
    const satisfairePourLigneTx = vi.fn(async () => reservationSatisfaite);
    const creerDepuisRealisationTx = vi.fn(async () => null);
    const service = serviceFacticePiecesRealisation(
      tx,
      serviceReservationFactice({ satisfairePourLigneTx }),
      serviceConsigneFactice({ creerDepuisRealisationTx }),
    );

    const entree: EntreeMarquageRealisee = {};
    await service.marquerRealisee(CTX, principal('receptionnaire'), OR_ID, LIGNE_ID, entree);

    expect(satisfairePourLigneTx).toHaveBeenCalledTimes(1);
    expect(satisfairePourLigneTx).toHaveBeenCalledWith(tx, CTX, LIGNE_ID);

    expect(creerDepuisRealisationTx).toHaveBeenCalledTimes(1);
    expect(creerDepuisRealisationTx).toHaveBeenCalledWith(tx, CTX, {
      ligneOrId: LIGNE_ID,
      ordreReparationId: OR_ID,
      articleId: ARTICLE_ID,
      siteId: 'site-2',
      quantiteMillieme: 1000,
      auteurId: CTX.utilisateurId,
    });

    // `update` (transition ligne_or) a bien tourné sur ce MÊME `tx` — les trois écritures
    // (transition, satisfaction, consigne) partagent l'unique transaction reçue en paramètre.
    expect(update).toHaveBeenCalled();
  });

  it("aucune réservation active (satisfairePourLigneTx rend null) → creerDepuisRealisationTx N'EST PAS appelé (rien à consigner sans sortie de stock)", async () => {
    const or = orFixture();
    const ligne = ligneFixture({
      type: 'piece',
      articleId: ARTICLE_ID,
      statut: 'en_cours',
      blocage: 'pieces',
    });
    const ligneRealisee = { ...ligne, statut: 'realisee' as const };
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(or);
    vi.mocked(orRequetes.chargerLigneOrPourEcriture).mockResolvedValue(ligne);

    const { update } = construireUpdate(new Map([[ligneOr, [ligneRealisee]]]));
    const tx = { update } as unknown as TransactionDfa;

    const satisfairePourLigneTx = vi.fn(async () => null);
    const creerDepuisRealisationTx = vi.fn(async () => null);
    const service = serviceFacticePiecesRealisation(
      tx,
      serviceReservationFactice({ satisfairePourLigneTx }),
      serviceConsigneFactice({ creerDepuisRealisationTx }),
    );

    const resultat = await service.marquerRealisee(
      CTX,
      principal('receptionnaire'),
      OR_ID,
      LIGNE_ID,
      {},
    );

    expect(resultat.donnees.statut).toBe('realisee');
    expect(satisfairePourLigneTx).toHaveBeenCalledTimes(1);
    expect(creerDepuisRealisationTx).not.toHaveBeenCalled();
  });

  it("ligne PAS de type 'piece' → ni satisfairePourLigneTx ni creerDepuisRealisationTx appelés", async () => {
    const or = orFixture();
    const ligne = ligneFixture({ type: 'main_oeuvre_bareme', articleId: null, statut: 'en_cours' });
    const ligneRealisee = { ...ligne, statut: 'realisee' as const };
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(or);
    vi.mocked(orRequetes.chargerLigneOrPourEcriture).mockResolvedValue(ligne);

    const { update } = construireUpdate(new Map([[ligneOr, [ligneRealisee]]]));
    const tx = { update } as unknown as TransactionDfa;

    const satisfairePourLigneTx = vi.fn(async () => null);
    const creerDepuisRealisationTx = vi.fn(async () => null);
    const service = serviceFacticePiecesRealisation(
      tx,
      serviceReservationFactice({ satisfairePourLigneTx }),
      serviceConsigneFactice({ creerDepuisRealisationTx }),
    );

    await service.marquerRealisee(CTX, principal('receptionnaire'), OR_ID, LIGNE_ID, {});

    expect(satisfairePourLigneTx).not.toHaveBeenCalled();
    expect(creerDepuisRealisationTx).not.toHaveBeenCalled();
  });

  it("ATOMICITÉ : un échec DANS creerDepuisRealisationTx (ex. consigne qui échoue APRÈS la sortie de stock déjà satisfaite dans ce tx) fait échouer marquerRealisee EN ENTIER — l'erreur n'est PAS avalée, elle sort du callback `acces.enTenant` (là où un vrai ROLLBACK Postgres annulerait ensemble la transition de ligne, la satisfaction ET la tentative de consigne, tous écrits dans le MÊME tx)", async () => {
    const or = orFixture();
    const ligne = ligneFixture({
      type: 'piece',
      articleId: ARTICLE_ID,
      statut: 'en_cours',
      quantiteMillieme: 1000,
    });
    const ligneRealisee = { ...ligne, statut: 'realisee' as const };
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(or);
    vi.mocked(orRequetes.chargerLigneOrPourEcriture).mockResolvedValue(ligne);

    const { update } = construireUpdate(new Map([[ligneOr, [ligneRealisee]]]));
    const tx = { update } as unknown as TransactionDfa;

    const reservationSatisfaite = reponseReservationFixture();
    const satisfairePourLigneTx = vi.fn(async () => reservationSatisfaite);
    const echecConsigne = new Error('échec simulé : insertion de consigne_echange_standard');
    const creerDepuisRealisationTx = vi.fn(async () => {
      throw echecConsigne;
    });
    const service = serviceFacticePiecesRealisation(
      tx,
      serviceReservationFactice({ satisfairePourLigneTx }),
      serviceConsigneFactice({ creerDepuisRealisationTx }),
    );

    await expect(
      service.marquerRealisee(CTX, principal('receptionnaire'), OR_ID, LIGNE_ID, {}),
    ).rejects.toBe(echecConsigne);

    // La sortie de stock (satisfairePourLigneTx) a bien été exécutée AVANT l'échec, DANS LE MÊME
    // tx que la transition de ligne déjà écrite (`update` a tourné) — sans le rejet non avalé
    // ci-dessus, ces écritures resteraient commitées séparément de la consigne manquante,
    // exactement l'incohérence de stock que cette tâche doit rendre impossible.
    expect(satisfairePourLigneTx).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------------------------------- */
/* RP-23 : libération automatique de la réservation à l'annulation d'une ligne                   */
/* ------------------------------------------------------------------------------------------- */

describe('ServiceLigneOr.annulerLignes — libération automatique de la réservation (RP-23)', () => {
  it("ligne 'piece' annulée → ServiceReservation.libererPourLigneTx(tx, ctx, ligneId, 'annulation_ligne'), avec le MÊME tx que la transition de la ligne", async () => {
    const or = orFixture();
    const ligne = ligneFixture({ type: 'piece', articleId: ARTICLE_ID, statut: 'validee' });
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(or);
    vi.mocked(orRequetes.chargerLignesPourEcriture).mockResolvedValue([ligne]);

    const ligneAnnulee = { ...ligne, statut: 'annulee' as const, motifAnnulation: 'Doublon' };
    const { update } = construireUpdate(new Map([[ligneOr, [ligneAnnulee]]]));
    const tx = { update } as unknown as TransactionDfa;

    const acces = accesBaseFactice(tx);
    const travailReporte = travailReporteFactice();
    const document = {} as ReponseOrdreReparation;
    const serviceOr = { assemblerDocument: vi.fn(async () => document) };
    const libererPourLigneTx = vi.fn(async () => undefined);
    const service = new ServiceLigneOr(
      acces as never,
      {} as never,
      {} as never,
      {} as never,
      travailReporte as unknown as CreationTravailReporte,
      serviceOr as never,
      { libererPourLigneTx } as never,
      {} as never,
    );

    const entree: EntreeAnnulationLignes = { ligneIds: [LIGNE_ID], motif: 'Doublon' };
    await service.annulerLignes(CTX, principal('receptionnaire'), OR_ID, entree);

    expect(libererPourLigneTx).toHaveBeenCalledTimes(1);
    expect(libererPourLigneTx).toHaveBeenCalledWith(tx, CTX, LIGNE_ID, 'annulation_ligne');
  });
});

/* ------------------------------------------------------------------------------------------- */
/* RM-65 / RM-07 / P-02 : résolution du taux horaire d'une ligne de main-d'œuvre                 */
/*                                                                                                */
/* Trou de couverture qui a laissé passer un défaut BLOQUANT en exécution réelle : `POST          */
/* /ordres-reparation/{id}/lignes` avec `type: main_oeuvre_temps_reel` répondait 400              */
/* `taux_horaire_introuvable` pour TOUT client sans condition commerciale négociée — c'est-à-dire */
/* pour l'immense majorité des clients d'un garage (seuls quelques comptes flotte en ont une).    */
/* La résolution ne lisait que `or.conditionsFigees.tauxHoraireCode` et rendait `null` sinon,     */
/* alors que RM-07 qualifie ce taux client d'« ÉVENTUEL » et que §7.9/P-02 rattachent le          */
/* référentiel `taux_horaire` au GARAGE. Une ligne `piece` sur le même OR passait : seule la      */
/* main-d'œuvre était cassée, et aucun test ne couvrait `resoudreTauxHoraireCentimes`.            */
/*                                                                                                */
/* Ces tests exercent le VRAI `CalculLigneSimple` (pas un calcul factice) : le taux résolu doit   */
/* non seulement exister, mais produire les bons centimes, TVA 8.1 % comprise.                    */
/* ------------------------------------------------------------------------------------------- */

function tauxHoraireFixture(overrides: Partial<LigneTauxHoraire> = {}): LigneTauxHoraire {
  return {
    id: 'taux-1',
    tenantId: 'tenant-a',
    code: CODE_TAUX_HORAIRE_DEFAUT,
    libelle: 'Taux horaire atelier',
    montantCentimes: 14_500,
    // Bornes volontairement très larges : ces tests ne doivent pas dépendre du jour où ils
    // tournent (`resoudreTauxHoraireCentimes` compare à la date du jour).
    valideDu: '2020-01-01',
    valideAu: null,
    creeLe: new Date('2026-07-28T07:00:00.000Z'),
    modifieLe: new Date('2026-07-28T07:00:00.000Z'),
    ...overrides,
  } as LigneTauxHoraire;
}

/** 1.5 h barémée, sans pièce ni prix unitaire — la ligne d'atelier la plus banale qui soit. */
function entreeMainOeuvreFixture(
  overrides: Partial<EntreeCreationLigneOr> = {},
): EntreeCreationLigneOr {
  return entreePieceFixture({
    type: 'main_oeuvre_bareme',
    designation: 'Remplacement plaquettes AV — main-d’œuvre',
    articleId: null,
    prixUnitaireCentimes: null,
    tempsBaremeCentiemes: 150,
    ...overrides,
  });
}

/** Comme `serviceFacticePieces`, mais avec le VRAI calcul de montants (arithmétique prouvée). */
function serviceFacticeMainOeuvre(tx: TransactionDfa): ServiceLigneOr {
  return new ServiceLigneOr(
    {} as never,
    idempotenceFactice(tx) as never,
    { publier: vi.fn() } as never,
    new CalculLigneSimple(),
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

function txMainOeuvre(taux: readonly LigneTauxHoraire[], ligneInseree: LigneLigneOr) {
  const select = construireSelect(new Map<unknown, unknown[]>([[tauxHoraire, [...taux]]]));
  const { insert, appels: appelsInsert } = construireInsert(
    new Map<unknown, { lignes?: unknown[]; erreur?: unknown }>([
      [ligneOr, { lignes: [ligneInseree] }],
    ]),
  );
  const { update } = construireUpdate(new Map());
  const tx = ajouterTransactionPassthrough({ select, insert, update }) as unknown as TransactionDfa;
  return { tx, appelsInsert };
}

/** Valeurs figées telles qu'elles partent à l'`INSERT` — c'est là que RM-65 se joue. */
function valeursLigneInseree(appels: readonly { table: unknown; valeurs: unknown }[]) {
  return appels.find((a) => a.table === ligneOr)?.valeurs as
    | {
        tauxHoraireCentimes: number | null;
        montantHtCentimes: number;
        montantTvaCentimes: number;
        montantTtcCentimes: number;
      }
    | undefined;
}

describe("ServiceLigneOr.creer — taux horaire d'une ligne de main-d'œuvre (RM-65)", () => {
  it('client SANS condition commerciale négociée → la ligne PASSE au taux standard du garage, figé à 145.00/h (1.5 h → 217.50 HT, 235.12 TTC à 8.1 %)', async () => {
    // `conditionsFigees: {}` = exactement ce que rend `GET /ordres-reparation/{id}` pour un client
    // ordinaire : le snapshot RM-50 n'a trouvé aucune ligne `client_condition` à figer.
    const or = { ...orFixture(), conditionsFigees: {} };
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(or);
    vi.mocked(orRequetes.listerLignesOr).mockResolvedValue([]);

    const { tx, appelsInsert } = txMainOeuvre(
      [tauxHoraireFixture()],
      ligneFixture({ type: 'main_oeuvre_bareme', tauxHoraireCentimes: 14_500 }),
    );
    const service = serviceFacticeMainOeuvre(tx);

    const resultat = await service.creer(
      CTX,
      principal('receptionnaire'),
      OR_ID,
      entreeMainOeuvreFixture(),
      'idem-mo-1',
    );

    expect(resultat.reponse.statutHttp).toBe(201);
    expect(valeursLigneInseree(appelsInsert)).toMatchObject({
      tauxHoraireCentimes: 14_500,
      montantHtCentimes: 21_750,
      montantTvaCentimes: 1_762,
      montantTtcCentimes: 23_512,
    });
  });

  it("conditionsFigees ABSENTES (`null`, OR ouvert avant l'existence des conditions) → même repli sur le taux standard", async () => {
    const or = { ...orFixture(), conditionsFigees: null };
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(or);
    vi.mocked(orRequetes.listerLignesOr).mockResolvedValue([]);

    const { tx, appelsInsert } = txMainOeuvre(
      [tauxHoraireFixture()],
      ligneFixture({ type: 'main_oeuvre_bareme', tauxHoraireCentimes: 14_500 }),
    );

    await serviceFacticeMainOeuvre(tx).creer(
      CTX,
      principal('receptionnaire'),
      OR_ID,
      entreeMainOeuvreFixture({ type: 'main_oeuvre_temps_reel' }),
      'idem-mo-2',
    );

    expect(valeursLigneInseree(appelsInsert)?.tauxHoraireCentimes).toBe(14_500);
  });

  it('client AVEC taux négocié (RM-07) → le taux flotte PRIME sur le taux standard du garage', async () => {
    const or = { ...orFixture(), conditionsFigees: { tauxHoraireCode: 'FLOTTE' } };
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(or);
    vi.mocked(orRequetes.listerLignesOr).mockResolvedValue([]);

    const { tx, appelsInsert } = txMainOeuvre(
      [
        tauxHoraireFixture(),
        tauxHoraireFixture({
          id: 'taux-2',
          code: 'FLOTTE',
          libelle: 'Taux flotte',
          montantCentimes: 11_000,
        }),
      ],
      ligneFixture({ type: 'main_oeuvre_bareme', tauxHoraireCentimes: 11_000 }),
    );

    await serviceFacticeMainOeuvre(tx).creer(
      CTX,
      principal('receptionnaire'),
      OR_ID,
      entreeMainOeuvreFixture(),
      'idem-mo-3',
    );

    expect(valeursLigneInseree(appelsInsert)).toMatchObject({
      tauxHoraireCentimes: 11_000,
      montantHtCentimes: 16_500,
      montantTvaCentimes: 1_337,
      montantTtcCentimes: 17_837,
    });
  });

  it("taux négocié EXPIRÉ → refus explicite qui NOMME le code, jamais un repli silencieux sur le tarif public (facturer 145.- un client à qui on a promis 110.- est pire qu'un blocage)", async () => {
    const or = { ...orFixture(), conditionsFigees: { tauxHoraireCode: 'FLOTTE' } };
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(or);
    vi.mocked(orRequetes.listerLignesOr).mockResolvedValue([]);

    const { tx, appelsInsert } = txMainOeuvre(
      [
        tauxHoraireFixture(),
        tauxHoraireFixture({
          id: 'taux-2',
          code: 'FLOTTE',
          montantCentimes: 11_000,
          valideDu: '2020-01-01',
          valideAu: '2020-12-31',
        }),
      ],
      ligneFixture(),
    );

    await expect(
      serviceFacticeMainOeuvre(tx).creer(
        CTX,
        principal('receptionnaire'),
        OR_ID,
        entreeMainOeuvreFixture(),
        'idem-mo-4',
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ECHOUEE',
      erreurs: [
        expect.objectContaining({
          code: 'taux_horaire_introuvable',
          message: expect.stringContaining('FLOTTE'),
        }),
      ],
    });
    expect(appelsInsert.some((a) => a.table === ligneOr)).toBe(false);
  });

  it("P-02, garage à taux UNIQUE nommé autrement que « ATELIER » → ce taux-là s'applique", async () => {
    const or = { ...orFixture(), conditionsFigees: {} };
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(or);
    vi.mocked(orRequetes.listerLignesOr).mockResolvedValue([]);

    const { tx, appelsInsert } = txMainOeuvre(
      [tauxHoraireFixture({ code: 'MO', libelle: 'Main-d’œuvre', montantCentimes: 12_000 })],
      ligneFixture({ type: 'main_oeuvre_bareme', tauxHoraireCentimes: 12_000 }),
    );

    await serviceFacticeMainOeuvre(tx).creer(
      CTX,
      principal('receptionnaire'),
      OR_ID,
      entreeMainOeuvreFixture(),
      'idem-mo-5',
    );

    expect(valeursLigneInseree(appelsInsert)).toMatchObject({
      tauxHoraireCentimes: 12_000,
      montantHtCentimes: 18_000,
      montantTvaCentimes: 1_458,
      montantTtcCentimes: 19_458,
    });
  });

  it('référentiel de taux VIDE → refus, et le message désigne le paramétrage du garage (pas le client)', async () => {
    const or = { ...orFixture(), conditionsFigees: {} };
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(or);
    vi.mocked(orRequetes.listerLignesOr).mockResolvedValue([]);

    const { tx, appelsInsert } = txMainOeuvre([], ligneFixture());

    await expect(
      serviceFacticeMainOeuvre(tx).creer(
        CTX,
        principal('receptionnaire'),
        OR_ID,
        entreeMainOeuvreFixture(),
        'idem-mo-6',
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ECHOUEE',
      erreurs: [
        expect.objectContaining({
          code: 'taux_horaire_introuvable',
          message: expect.stringContaining('taux horaires'),
        }),
      ],
    });
    expect(appelsInsert.some((a) => a.table === ligneOr)).toBe(false);
  });

  it("PLUSIEURS taux en vigueur, aucun « ATELIER » → AMBIGU, donc refus : deviner lequel facturer n'est pas au logiciel de le faire", async () => {
    const or = { ...orFixture(), conditionsFigees: {} };
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(or);
    vi.mocked(orRequetes.listerLignesOr).mockResolvedValue([]);

    const { tx, appelsInsert } = txMainOeuvre(
      [
        tauxHoraireFixture({ code: 'MECANIQUE', montantCentimes: 14_000 }),
        tauxHoraireFixture({ id: 'taux-2', code: 'CARROSSERIE', montantCentimes: 16_000 }),
      ],
      ligneFixture(),
    );

    await expect(
      serviceFacticeMainOeuvre(tx).creer(
        CTX,
        principal('receptionnaire'),
        OR_ID,
        entreeMainOeuvreFixture(),
        'idem-mo-7',
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ECHOUEE' });
    expect(appelsInsert.some((a) => a.table === ligneOr)).toBe(false);
  });

  it("un taux PÉRIMÉ et son remplaçant en vigueur (même code, historisation §7.9) → c'est le taux du jour qui est figé", async () => {
    const or = { ...orFixture(), conditionsFigees: {} };
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(or);
    vi.mocked(orRequetes.listerLignesOr).mockResolvedValue([]);

    const { tx, appelsInsert } = txMainOeuvre(
      [
        tauxHoraireFixture({
          id: 'taux-ancien',
          montantCentimes: 13_500,
          valideDu: '2015-01-01',
          valideAu: '2019-12-31',
        }),
        tauxHoraireFixture({ montantCentimes: 14_500 }),
      ],
      ligneFixture({ type: 'main_oeuvre_bareme', tauxHoraireCentimes: 14_500 }),
    );

    await serviceFacticeMainOeuvre(tx).creer(
      CTX,
      principal('receptionnaire'),
      OR_ID,
      entreeMainOeuvreFixture(),
      'idem-mo-8',
    );

    expect(valeursLigneInseree(appelsInsert)?.tauxHoraireCentimes).toBe(14_500);
  });
});

/* ------------------------------------------------------------------------------------------- */
/* RM-65 — désaccord de borne base/code sur une bascule de tarif, reproduit en exécution le      */
/* 10.08.2026 :                                                                                  */
/*                                                                                                */
/*   POST /referentiels/taux-horaires {code:TEST-LIMITE, valideDuLe:2026-08-01,                  */
/*        valideAuLe:2026-08-10}                                                    → 201        */
/*   POST /referentiels/taux-horaires {code:TEST-LIMITE, valideDuLe:2026-08-10,                  */
/*        valideAuLe:null}                                                          → 201        */
/*                                                                                                */
/* La contrainte EXCLUDE `daterange(valide_du, valide_au, '[)')` (migration 0005_parametrage.sql, */
/* même borne sur `client_condition` en 0006) ACCEPTE cette saisie : borne haute EXCLUSIVE, les    */
/* deux périodes ne se chevauchent pas. `resoudreTauxHoraireCentimes` lisait AUPARAVANT           */
/* `valideAu >= dateJour` — borne haute INCLUSIVE, en désaccord avec la base — et les DEUX lignes  */
/* remontaient comme « en vigueur » le jour de la bascule ; sans ORDER BY, laquelle `.find()`      */
/* retenait dépendait de l'ordre de retour de PostgreSQL, non garanti. Ces tests rejouent EXACTEMENT */
/* cette séquence et prouvent qu'un seul taux est retenu, TOUJOURS LE MÊME, quel que soit l'ordre  */
/* dans lequel les lignes sont rendues.                                                            */
/* ------------------------------------------------------------------------------------------- */
describe('ServiceLigneOr.creer — bascule de tarif sur la borne de date (RM-65)', () => {
  const VEILLE_BASCULE = new Date('2026-08-09T10:00:00.000Z');
  const JOUR_BASCULE = new Date('2026-08-10T10:00:00.000Z');

  const ANCIEN_TAUX = tauxHoraireFixture({
    id: 'taux-ancien-limite',
    code: 'TEST-LIMITE',
    libelle: 'Ancien taux (avant bascule)',
    montantCentimes: 10_000,
    valideDu: '2026-08-01',
    valideAu: '2026-08-10',
  });
  const NOUVEAU_TAUX = tauxHoraireFixture({
    id: 'taux-nouveau-limite',
    code: 'TEST-LIMITE',
    libelle: 'Nouveau taux (dès bascule)',
    montantCentimes: 20_000,
    valideDu: '2026-08-10',
    valideAu: null,
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['ancien puis nouveau', [ANCIEN_TAUX, NOUVEAU_TAUX], 'idem-limite-ordre-1'],
    [
      'nouveau puis ancien (ordre PostgreSQL non garanti)',
      [NOUVEAU_TAUX, ANCIEN_TAUX],
      'idem-limite-ordre-2',
    ],
  ])(
    "le jour de la bascule (le 10, borne haute exclusive de l'ancien = borne basse inclusive du nouveau) → le NOUVEAU taux (200.00/h) s'applique SEUL, quel que soit l'ordre de retour des lignes (%s)",
    async (_libelle, ordreLignes, idemKey) => {
      vi.useFakeTimers();
      vi.setSystemTime(JOUR_BASCULE);

      const or = { ...orFixture(), conditionsFigees: { tauxHoraireCode: 'TEST-LIMITE' } };
      vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(or);
      vi.mocked(orRequetes.listerLignesOr).mockResolvedValue([]);

      const { tx, appelsInsert } = txMainOeuvre(
        ordreLignes,
        ligneFixture({ type: 'main_oeuvre_bareme', tauxHoraireCentimes: 20_000 }),
      );

      const resultat = await serviceFacticeMainOeuvre(tx).creer(
        CTX,
        principal('receptionnaire'),
        OR_ID,
        entreeMainOeuvreFixture(),
        idemKey,
      );

      expect(resultat.reponse.statutHttp).toBe(201);
      // 1.5 h à 200.00/h : HT = 30'000, TVA 8.1 % = 2'430 (pas d'arrondi ambigu), TTC = 32'430.
      expect(valeursLigneInseree(appelsInsert)).toMatchObject({
        tauxHoraireCentimes: 20_000,
        montantHtCentimes: 30_000,
        montantTvaCentimes: 2_430,
        montantTtcCentimes: 32_430,
      });
    },
  );

  it("la veille de la bascule (le 9) → l'ANCIEN taux (100.00/h) s'applique encore, seul", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(VEILLE_BASCULE);

    const or = { ...orFixture(), conditionsFigees: { tauxHoraireCode: 'TEST-LIMITE' } };
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(or);
    vi.mocked(orRequetes.listerLignesOr).mockResolvedValue([]);

    const { tx, appelsInsert } = txMainOeuvre(
      [ANCIEN_TAUX, NOUVEAU_TAUX],
      ligneFixture({ type: 'main_oeuvre_bareme', tauxHoraireCentimes: 10_000 }),
    );

    await serviceFacticeMainOeuvre(tx).creer(
      CTX,
      principal('receptionnaire'),
      OR_ID,
      entreeMainOeuvreFixture(),
      'idem-limite-veille',
    );

    // 1.5 h à 100.00/h : HT = 15'000, TVA 8.1 % = 1'215 (pas d'arrondi ambigu), TTC = 16'215.
    expect(valeursLigneInseree(appelsInsert)).toMatchObject({
      tauxHoraireCentimes: 10_000,
      montantHtCentimes: 15_000,
      montantTvaCentimes: 1_215,
      montantTtcCentimes: 16_215,
    });
  });
});

describe("ServiceLigneOr.modifier — taux horaire d'une ligne devenue main-d'œuvre (RM-65)", () => {
  it("PATCH type=main_oeuvre_temps_reel sur une ligne sans taux figé, client sans condition → le taux standard s'applique (pas de 400)", async () => {
    const or = { ...orFixture(), conditionsFigees: {} };
    const ligne = ligneFixture({ type: 'forfait', tauxHoraireCentimes: null, statut: 'validee' });
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(or);
    vi.mocked(orRequetes.chargerLigneOrPourEcriture).mockResolvedValue(ligne);

    const select = construireSelect(
      new Map<unknown, unknown[]>([[tauxHoraire, [tauxHoraireFixture()]]]),
    );
    const { update, appels: appelsUpdate } = construireUpdate(
      new Map([[ligneOr, [{ ...ligne, type: 'main_oeuvre_temps_reel' }]]]),
    );
    const tx = { select, update } as unknown as TransactionDfa;
    const service = new ServiceLigneOr(
      accesBaseFactice(tx) as never,
      {} as never,
      {} as never,
      new CalculLigneSimple(),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.modifier(CTX, principal('receptionnaire'), OR_ID, LIGNE_ID, {
      type: 'main_oeuvre_temps_reel',
      tempsBaremeCentiemes: 150,
    } as never);

    expect(appelsUpdate.find((a) => a.table === ligneOr)?.valeurs).toMatchObject({
      tauxHoraireCentimes: 14_500,
      montantHtCentimes: 21_750,
      montantTvaCentimes: 1_762,
      montantTtcCentimes: 23_512,
    });
  });

  it('référentiel VIDE → 400 VALIDATION_ECHOUEE, jamais un UPDATE qui violerait `ligne_or_taux_horaire_requis_chk`', async () => {
    const or = { ...orFixture(), conditionsFigees: {} };
    const ligne = ligneFixture({ type: 'forfait', tauxHoraireCentimes: null, statut: 'validee' });
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(or);
    vi.mocked(orRequetes.chargerLigneOrPourEcriture).mockResolvedValue(ligne);

    const select = construireSelect(new Map<unknown, unknown[]>([[tauxHoraire, []]]));
    const { update, appels: appelsUpdate } = construireUpdate(new Map());
    const tx = { select, update } as unknown as TransactionDfa;
    const service = new ServiceLigneOr(
      accesBaseFactice(tx) as never,
      {} as never,
      {} as never,
      new CalculLigneSimple(),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.modifier(CTX, principal('receptionnaire'), OR_ID, LIGNE_ID, {
        type: 'main_oeuvre_bareme',
        tempsBaremeCentiemes: 150,
      } as never),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ECHOUEE',
      erreurs: [expect.objectContaining({ code: 'taux_horaire_introuvable' })],
    });
    expect(appelsUpdate.some((a) => a.table === ligneOr)).toBe(false);
  });
});

/**
 * F-01-bis pour `ligne_or` (même défaut que `neGarderQueChampsEnvoyes`, ici sur
 * `schemaModificationLigneOr` — SIX champs à `.default(...)` survivent à `.partial()` :
 * `quantiteMillieme(1000)`, `rabaisPourmille(0)`, `payeur('client')`, `securite(false)`,
 * `fournieParClient(false)`, `pieceARestituer(false)`).
 *
 * Ligne mise en scène : `payeur = 'garage'` (geste commercial, RM-70 — montants valorisés à 0,
 * AUCUN `payeurClientId` requis, donc rien ne bloque le repli buggé sur `'client'`), quantité
 * réelle 2× (2000 millièmes), rabais réel 10% (100 pour-mille), et les trois drapeaux à `true`.
 * Le corps envoyé ne touche QUE `designation`.
 */
describe("ServiceLigneOr.modifier — F-01-bis, un PATCH { designation } ne doit RIEN écraser d'autre", () => {
  function ligneGoodwillFixture(): LigneLigneOr {
    return ligneFixture({
      type: 'piece',
      statut: 'validee',
      payeur: 'garage',
      payeurClientId: null,
      quantiteMillieme: 2_000,
      rabaisPourmille: 100,
      prixUnitaireCentimes: 8_000,
      tauxTvaPourmille: 81,
      montantHtCentimes: 0,
      montantTvaCentimes: 0,
      montantTtcCentimes: 0,
      securite: true,
      fourniParClient: true,
      aRestituer: true,
    });
  }

  function construireServiceEtTx() {
    const ligne = ligneGoodwillFixture();
    const or = { ...orFixture(), plafondCentimes: null };
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(or);
    vi.mocked(orRequetes.chargerLigneOrPourEcriture).mockResolvedValue(ligne);

    const { update, appels: appelsUpdate } = construireUpdate(new Map([[ligneOr, [ligne]]]));
    const tx = { update } as unknown as TransactionDfa;
    const service = new ServiceLigneOr(
      accesBaseFactice(tx) as never,
      {} as never,
      {} as never,
      new CalculLigneSimple(),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, appelsUpdate, ligne };
  }

  it("un PATCH { designation } SEUL ne doit PAS toucher payeur/quantité/rabais/drapeaux/montants d'une ligne au geste commercial 'garage'", async () => {
    const { service, appelsUpdate } = construireServiceEtTx();

    // Corps BRUT tel qu'il arrive réellement sur le fil HTTP — `ligne-or.controller.ts` ne parse
    // plus rien lui-même (voir son commentaire `@ApiCorpsZod`) : c'est `ServiceLigneOr.modifier`
    // qui parse ET filtre par présence réelle dans CE corps (`neGarderQueChampsEnvoyes`).
    await service.modifier(CTX, principal('receptionnaire'), OR_ID, LIGNE_ID, {
      designation: 'Nouvelle désignation',
    });

    const valeurs = appelsUpdate.find((a) => a.table === ligneOr)?.valeurs;
    // Seul `designation` doit apparaître dans le `SET` (plus les montants, toujours réécrits mais
    // INCHANGÉS puisque rien de tarifaire n'a été envoyé) — jamais `payeur`, `quantiteMillieme`,
    // `rabaisPourmille`, `securite`, `fourniParClient`, `aRestituer` avec une valeur par défaut.
    expect(valeurs).toMatchObject({
      designation: 'Nouvelle désignation',
      montantHtCentimes: 0,
      montantTvaCentimes: 0,
      montantTtcCentimes: 0,
    });
    expect(valeurs).not.toHaveProperty('payeur');
    expect(valeurs).not.toHaveProperty('quantiteMillieme');
    expect(valeurs).not.toHaveProperty('rabaisPourmille');
    expect(valeurs).not.toHaveProperty('securite');
    expect(valeurs).not.toHaveProperty('fourniParClient');
    expect(valeurs).not.toHaveProperty('aRestituer');
  });
});

describe('ServiceLigneOr.marquerRealisee — sans pointage, tous types (0076)', () => {
  const TYPES = [
    'main_oeuvre_bareme',
    'main_oeuvre_temps_reel',
    'forfait',
    'piece',
    'fourniture',
    'produit_atelier',
    'sous_traitance',
    'taxe',
    'remise',
    'texte',
  ] as const;

  function preparer(ligne: LigneLigneOr) {
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(orFixture());
    vi.mocked(orRequetes.chargerLigneOrPourEcriture).mockResolvedValue(ligne);
    const { update, appels } = construireUpdate(
      new Map([[ligneOr, [{ ...ligne, statut: 'realisee' as const }]]]),
    );
    const tx = { update } as unknown as TransactionDfa;
    return { service: serviceFacticePiecesRealisation(tx), appels };
  }

  const combinaisons = TYPES.flatMap((type) =>
    (['validee', 'en_cours'] as const).map((statut) => [type, statut] as const),
  );

  it.each(combinaisons)('ligne %s au statut %s → écrite realisee', async (type, statut) => {
    const { service, appels } = preparer(ligneFixture({ type, statut }));
    const resultat = await service.marquerRealisee(
      CTX,
      principal('receptionnaire'),
      OR_ID,
      LIGNE_ID,
      {},
    );
    expect(resultat.donnees.statut).toBe('realisee');
    expect(appels).toHaveLength(1);
    expect(appels[0]?.valeurs).toEqual({ statut: 'realisee' });
  });

  const REFUSES = [
    ['proposee', 'VALIDER_LIGNES', 'proposée'],
    ['a_valider', 'VALIDER_LIGNES', 'en attente de l’accord du client'],
    ['refusee', 'RAFRAICHIR', 'refusée par le client'],
    ['realisee', 'RAFRAICHIR', 'déjà réalisée'],
    ['facturee', 'RAFRAICHIR', 'déjà facturée'],
    ['annulee', 'RAFRAICHIR', 'annulée'],
  ] as const;

  it.each(REFUSES)(
    'ligne au statut %s → 409 LIGNE_TRANSITION_INTERDITE, aucune écriture, detail lisible',
    async (statut, action, libelle) => {
      const { service, appels } = preparer(ligneFixture({ type: 'forfait', statut }));
      const erreur = await service
        .marquerRealisee(CTX, principal('receptionnaire'), OR_ID, LIGNE_ID, {})
        .catch((e: unknown) => e);
      expect(erreur).toBeInstanceOf(ErreurMetier);
      const e = erreur as ErreurMetier;
      expect(e.code).toBe('LIGNE_TRANSITION_INTERDITE');
      expect(e.status).toBe(409);
      expect(e.detail).toContain(`La ligne est ${libelle}`);
      expect(e.detail).toContain('validée ou en cours');
      expect(e.blocages?.[0]?.donnees).toMatchObject({
        statutActuel: statut,
        statutDemande: 'realisee',
        statutsAcceptes: ['validee', 'en_cours'],
      });
      expect(e.actionsProposees).toEqual([{ code: action }]);
      expect(appels).toHaveLength(0);
    },
  );
});
