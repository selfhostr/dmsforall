import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  EntreeAnnulationLignes,
  EntreeCreationLigneOr,
  EntreeMarquageRealisee,
  EntreeRefusLignes,
  ReponseOrdreReparation,
} from '@dfa/shared';
import type { ContexteTenant, TransactionDfa } from '../db';
import {
  article,
  consigneEchangeStandard,
  ligneOr,
  mouvementStock,
  reservationPiece,
  type LigneArticle,
  type LigneLigneOr,
  type LigneOrdreReparation,
  type LigneReservationPiece,
} from '../db/schema';
import type { PrincipalAuthentifie } from '../common/contexte/contexte-requete.types';
import type { CreationTravailReporte } from './atelier.jetons';

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
 * pièces, cf. rapport de livraison) : transaction et requêtes moquées, aucune preuve d'écriture
 * réelle en base (testcontainers, hors périmètre unitaire).
 */
vi.mock('./or-requetes', () => ({
  chargerOrPourEcriture: vi.fn(),
  chargerLignesPourEcriture: vi.fn(),
  chargerLigneOrPourEcriture: vi.fn(),
  listerLignesOr: vi.fn(),
}));

import { ServiceLigneOr } from './service-ligne-or';
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

function reservationFixture(overrides: Partial<LigneReservationPiece> = {}): LigneReservationPiece {
  return {
    id: RESERVATION_ID,
    tenantId: 'tenant-a',
    articleId: ARTICLE_ID,
    siteId: 'site-1',
    ligneOrId: LIGNE_ID,
    ordreReparationId: OR_ID,
    quantiteMillieme: 1000,
    statut: 'active',
    creeLe: new Date('2026-07-28T07:00:00.000Z'),
    satisfaiteLe: null,
    mouvementSortieId: null,
    libereeLe: null,
    motifLiberation: null,
    motifLiberationTexte: null,
    libereeParUtilisateurId: null,
    ...overrides,
  } as LigneReservationPiece;
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

/** `select().from(table).where().limit()` générique, indexé par référence de TABLE Drizzle
 *  (`article`, `reservationPiece`…) — plusieurs tables interviennent dans un même scénario
 *  (`marquerRealisee` lit `reservation_piece` PUIS `article`). */
function construireSelect(donnees: Map<unknown, unknown[]>) {
  return vi.fn(() => ({
    from: vi.fn((table: unknown) => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => donnees.get(table) ?? []),
      })),
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

/** Seuls `acces`, `travailReporte` et `serviceOr` sont exercés par `refuserLignes()` — les 3 autres
 *  dépendances du constructeur (idempotence, événements, calcul) n'interviennent QUE dans
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
  );
}

/** `creer()`/`marquerRealisee()` n'appellent jamais `acces.enTenant` directement (c'est
 *  `idempotence.executer` — mocké ici — qui l'aurait fait en production, voir
 *  `idempotence.types.ts`) ni `serviceOr`/`travailReporte` — dummies non exercés. */
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
  );
}

/** `marquerRealisee()` passe par `acces.enTenant` (pas d'idempotence sur une action de
 *  transition) — voir `service-ligne-or.ts::marquerRealisee`. */
function serviceFacticePiecesRealisation(tx: TransactionDfa): ServiceLigneOr {
  return new ServiceLigneOr(
    accesBaseFactice(tx) as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
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
    const tx = { select, insert, update } as unknown as TransactionDfa;

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
    const tx = { select, insert, update } as unknown as TransactionDfa;

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
  });

  it('article introuvable pour ce tenant → RESSOURCE_INTROUVABLE, aucune ligne insérée', async () => {
    const or = orFixture();
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(or);
    vi.mocked(orRequetes.listerLignesOr).mockResolvedValue([]);

    const select = construireSelect(new Map()); // article : aucune ligne pour cette table
    const { insert, appels: appelsInsert } = construireInsert(new Map());
    const { update } = construireUpdate(new Map());
    const tx = { select, insert, update } as unknown as TransactionDfa;

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
    const tx = { select, insert, update } as unknown as TransactionDfa;

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
/* ------------------------------------------------------------------------------------------- */

describe('ServiceLigneOr.marquerRealisee — sortie de stock et consigne (RP-21/RP-38)', () => {
  it("ligne 'piece' avec réservation active → mouvement sortie_or + réservation 'satisfaite'", async () => {
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

    const reservation = reservationFixture();
    const select = construireSelect(
      new Map<unknown, unknown[]>([
        [reservationPiece, [reservation]],
        [article, [articleFixture({ estEchangeStandard: false })]],
      ]),
    );
    const mouvementSortie = { id: 'mouvement-sortie-1' };
    const { insert, appels: appelsInsert } = construireInsert(
      new Map([[mouvementStock, { lignes: [mouvementSortie] }]]),
    );
    const { update, appels: appelsUpdate } = construireUpdate(
      new Map([[ligneOr, [ligneRealisee]]]),
    );
    const tx = { select, insert, update } as unknown as TransactionDfa;

    const service = serviceFacticePiecesRealisation(tx);
    const entree: EntreeMarquageRealisee = {};
    await service.marquerRealisee(CTX, principal('receptionnaire'), OR_ID, LIGNE_ID, entree);

    const appelSortie = appelsInsert.find((a) => a.table === mouvementStock);
    expect(appelSortie?.valeurs).toMatchObject({
      articleId: ARTICLE_ID,
      type: 'sortie_or',
      quantiteMillieme: -1000,
      siteId: 'site-1',
      ligneOrId: LIGNE_ID,
      reservationId: RESERVATION_ID,
    });

    const appelReservation = appelsUpdate.find((a) => a.table === reservationPiece);
    expect(appelReservation?.valeurs).toMatchObject({
      statut: 'satisfaite',
      mouvementSortieId: 'mouvement-sortie-1',
    });
    expect((appelReservation?.valeurs as { satisfaiteLe: Date }).satisfaiteLe).toBeInstanceOf(Date);

    // Article non-échange-standard : aucune consigne posée.
    expect(appelsInsert.some((a) => a.table === consigneEchangeStandard)).toBe(false);
  });

  it("article d'échange standard → consigne posée EN PLUS de la sortie (mouvement retour_consigne positif)", async () => {
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

    const reservation = reservationFixture();
    const select = construireSelect(
      new Map<unknown, unknown[]>([
        [reservationPiece, [reservation]],
        [
          article,
          [articleFixture({ estEchangeStandard: true, montantConsigneTtcCentimes: 12_000 })],
        ],
      ]),
    );
    const mouvementSortie = { id: 'mouvement-sortie-1' };
    const mouvementEntreeConsigne = { id: 'mouvement-entree-consigne-1' };
    let appelsMouvementStock = 0;
    const { insert, appels: appelsInsert } = construireInsert(new Map());
    // `construireInsert` générique rend TOUJOURS la même valeur pour une table donnée — la
    // séquence sortie_or PUIS retour_consigne exige deux réponses différentes pour LA MÊME table
    // (`mouvementStock`) : override local du handler pour ce test précis.
    const insertPersonnalise = vi.fn((table: unknown) => ({
      values: (valeurs: unknown) => {
        if (table === mouvementStock) {
          appelsMouvementStock += 1;
          appelsInsert.push({ table, valeurs });
          const lignes = appelsMouvementStock === 1 ? [mouvementSortie] : [mouvementEntreeConsigne];
          return resultatChaine(lignes);
        }
        return insert(table).values(valeurs);
      },
    }));
    const { update } = construireUpdate(new Map([[ligneOr, [ligneRealisee]]]));
    const tx = { select, insert: insertPersonnalise, update } as unknown as TransactionDfa;

    const service = serviceFacticePiecesRealisation(tx);
    await service.marquerRealisee(CTX, principal('receptionnaire'), OR_ID, LIGNE_ID, {});

    const appelsMouvement = appelsInsert.filter((a) => a.table === mouvementStock);
    expect(appelsMouvement).toHaveLength(2);
    expect(appelsMouvement[1]?.valeurs).toMatchObject({
      articleId: ARTICLE_ID,
      type: 'retour_consigne',
      quantiteMillieme: 1000, // positif : entrée du cœur d'échange standard (symétrique de RP-40)
      siteId: 'site-1',
      ligneOrId: LIGNE_ID,
    });

    const appelConsigne = appelsInsert.find((a) => a.table === consigneEchangeStandard);
    expect(appelConsigne?.valeurs).toMatchObject({
      ligneOrId: LIGNE_ID,
      ordreReparationId: OR_ID,
      articleId: ARTICLE_ID,
      siteId: 'site-1',
      montantConsigneTtcCentimes: 12_000,
      mouvementEntreeId: 'mouvement-entree-consigne-1',
    });
  });

  it("ligne 'piece' SANS réservation active (jamais créée, blocage='pieces' à la pose) → aucun mouvement généré", async () => {
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

    const select = construireSelect(new Map()); // reservation_piece : aucune ligne active
    const { insert, appels: appelsInsert } = construireInsert(new Map());
    const { update } = construireUpdate(new Map([[ligneOr, [ligneRealisee]]]));
    const tx = { select, insert, update } as unknown as TransactionDfa;

    const service = serviceFacticePiecesRealisation(tx);
    const resultat = await service.marquerRealisee(
      CTX,
      principal('receptionnaire'),
      OR_ID,
      LIGNE_ID,
      {},
    );

    expect(resultat.donnees.statut).toBe('realisee');
    expect(appelsInsert.some((a) => a.table === mouvementStock)).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------- */
/* RP-23 : libération automatique de la réservation à l'annulation d'une ligne                   */
/* ------------------------------------------------------------------------------------------- */

describe('ServiceLigneOr.annulerLignes — libération automatique de la réservation (RP-23)', () => {
  it("ligne 'piece' avec réservation active annulée → réservation 'liberee', motif 'annulation_ligne'", async () => {
    const or = orFixture();
    const ligne = ligneFixture({ type: 'piece', articleId: ARTICLE_ID, statut: 'validee' });
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(or);
    vi.mocked(orRequetes.chargerLignesPourEcriture).mockResolvedValue([ligne]);

    const reservation = reservationFixture();
    const select = construireSelect(
      new Map<unknown, unknown[]>([[reservationPiece, [reservation]]]),
    );
    const { insert } = construireInsert(new Map());
    const ligneAnnulee = { ...ligne, statut: 'annulee' as const, motifAnnulation: 'Doublon' };
    const { update, appels: appelsUpdate } = construireUpdate(new Map([[ligneOr, [ligneAnnulee]]]));
    const tx = { select, insert, update } as unknown as TransactionDfa;

    const acces = accesBaseFactice(tx);
    const travailReporte = travailReporteFactice();
    const document = {} as ReponseOrdreReparation;
    const serviceOr = { assemblerDocument: vi.fn(async () => document) };
    const service = new ServiceLigneOr(
      acces as never,
      {} as never,
      {} as never,
      {} as never,
      travailReporte as unknown as CreationTravailReporte,
      serviceOr as never,
    );

    const entree: EntreeAnnulationLignes = { ligneIds: [LIGNE_ID], motif: 'Doublon' };
    await service.annulerLignes(CTX, principal('receptionnaire'), OR_ID, entree);

    const appelLiberation = appelsUpdate.find((a) => a.table === reservationPiece);
    expect(appelLiberation?.valeurs).toMatchObject({
      statut: 'liberee',
      motifLiberation: 'annulation_ligne',
    });
    expect((appelLiberation?.valeurs as { libereeLe: Date }).libereeLe).toBeInstanceOf(Date);
  });

  it("ligne 'piece' SANS réservation active → aucun UPDATE sur reservation_piece (silencieux)", async () => {
    const or = orFixture();
    const ligne = ligneFixture({ type: 'piece', articleId: ARTICLE_ID, statut: 'validee' });
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(or);
    vi.mocked(orRequetes.chargerLignesPourEcriture).mockResolvedValue([ligne]);

    const select = construireSelect(new Map()); // reservation_piece : aucune ligne active
    const { insert } = construireInsert(new Map());
    const ligneAnnulee = { ...ligne, statut: 'annulee' as const, motifAnnulation: 'Doublon' };
    const { update, appels: appelsUpdate } = construireUpdate(new Map([[ligneOr, [ligneAnnulee]]]));
    const tx = { select, insert, update } as unknown as TransactionDfa;

    const acces = accesBaseFactice(tx);
    const travailReporte = travailReporteFactice();
    const document = {} as ReponseOrdreReparation;
    const serviceOr = { assemblerDocument: vi.fn(async () => document) };
    const service = new ServiceLigneOr(
      acces as never,
      {} as never,
      {} as never,
      {} as never,
      travailReporte as unknown as CreationTravailReporte,
      serviceOr as never,
    );

    await service.annulerLignes(CTX, principal('receptionnaire'), OR_ID, {
      ligneIds: [LIGNE_ID],
      motif: 'Doublon',
    });

    expect(appelsUpdate.some((a) => a.table === reservationPiece)).toBe(false);
  });
});
