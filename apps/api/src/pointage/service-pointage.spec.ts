/**
 * FAILLE CORRIGÉE (audit sécurité) — garde-fou « soi vs autrui » du pointage.
 *
 * Avant correction, `POST /pointages` (`demarrer`) et `POST /pointages/{id}/arreter` (`arreter`) ne
 * reliaient JAMAIS l'identité de la session à la cible : un technicien pouvait imputer des heures à
 * n'importe quel collègue en fournissant son `technicienId`. Ces tests verrouillent la règle
 * corrigée, SANS base de données — la garde (`exigerDroitCiblerAutrui`) s'exécute avant tout accès
 * disque, ce qui permet de la prouver avec des dépendances entièrement simulées :
 *
 *  - `demarrer` : la garde tourne AVANT `idempotence.executer`. On observe donc directement si
 *    `executer` a été appelé (cible autorisée) ou si un `DROIT_INSUFFISANT` a été levé sans jamais
 *    l'appeler (cible refusée) — aucune écriture n'est atteinte.
 *  - `arreter` : la garde tourne DANS le callback d'idempotence, juste après le chargement du
 *    pointage sous verrou. On simule `executer` pour invoquer le callback et `chargerPointagePour-
 *    Ecriture` pour rendre un pointage à la cible voulue. Pour prouver que la garde LAISSE PASSER un
 *    rôle habilité sans dérouler tout le chemin d'écriture, on rend un pointage déjà `termine` : la
 *    garde passe, puis la transition échoue avec `POINTAGE_TRANSITION_INTERDITE` (code DIFFÉRENT) —
 *    preuve que ce n'est pas la garde qui a bloqué.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type {
  EntreeArretPointage,
  EntreeDemarragePointage,
  FiltresPointages,
  RoleUtilisateur,
} from '@dfa/shared';

import { ErreurMetier } from '../common/erreurs/erreur-metier';
import type { PrincipalAuthentifie } from '../common/contexte/contexte-requete.types';
import type { ContexteTenant } from '../db';

import { estCollisionIdPointage, ServicePointage } from './service-pointage';

// `chargerPointagePourEcriture` est une fonction de module : on la simule pour piloter le
// `technicienId` (et le statut) du pointage chargé par `arreter`, sans base.
vi.mock('./pointage-requetes', () => ({
  chargerPointagePourEcriture: vi.fn(),
  chargerPointageOuNull: vi.fn(),
  chargerPointageOuvertTechnicien: vi.fn(),
  chargerPointagesPourAgregatLigne: vi.fn(),
  chargerPointagesProductifsDuJour: vi.fn(),
}));
import { chargerPointagePourEcriture, chargerPointagesProductifsDuJour } from './pointage-requetes';

const TENANT = '11111111-1111-1111-1111-111111111111';
const MOI = '22222222-2222-2222-2222-222222222222';
const AUTRE = '33333333-3333-3333-3333-333333333333';
const BORNE = '44444444-4444-4444-4444-444444444444';
const POINTAGE_ID = '55555555-5555-5555-5555-555555555555';
const SITE = '66666666-6666-6666-6666-666666666666';

const CTX = { tenantId: TENANT, utilisateurId: MOI, requeteId: null } satisfies ContexteTenant;

function principal(role: RoleUtilisateur, utilisateurId: string): PrincipalAuthentifie {
  return {
    sessionId: 'sess',
    tenantId: TENANT,
    utilisateurId,
    role,
    langue: 'fr',
    siteId: role === 'poste_atelier' ? SITE : null,
  };
}

function entreeDemarrage(technicienId: string): EntreeDemarragePointage {
  return {
    id: POINTAGE_ID,
    siteId: SITE,
    technicienId,
    nature: 'indirect',
    activiteIndirecte: 'nettoyage',
    debutLe: '2026-07-31T08:00:00.000Z',
    source: 'ecran_atelier',
  } as unknown as EntreeDemarragePointage;
}

/** Dépendances non exercées par le chemin de garde — stubs inertes. */
const accesStub = { enTenant: vi.fn() } as unknown as ConstructorParameters<
  typeof ServicePointage
>[0];
const horlogeStub = {
  maintenant: () => new Date('2026-07-31T09:00:00.000Z'),
} as unknown as ConstructorParameters<typeof ServicePointage>[2];

function serviceAvecExecuter(executer: Mock): { service: ServicePointage; executer: Mock } {
  const idempotence = { executer } as unknown as ConstructorParameters<typeof ServicePointage>[1];
  return { service: new ServicePointage(accesStub, idempotence, horlogeStub), executer };
}

describe('ServicePointage.demarrer — garde soi/autrui (faille corrigée)', () => {
  const SENTINELLE = { rejoue: false, reponse: { statutHttp: 201, corps: {} } };

  it('REFUSE (403 DROIT_INSUFFISANT) un technicien qui démarre au nom d’un AUTRE — cœur de la faille, aucune écriture atteinte', async () => {
    const executer = vi.fn(async () => SENTINELLE);
    const { service } = serviceAvecExecuter(executer);

    await expect(
      service.demarrer(CTX, principal('technicien', MOI), entreeDemarrage(AUTRE), 'cle'),
    ).rejects.toMatchObject({ code: 'DROIT_INSUFFISANT' });

    // La preuve que rien n'a été écrit : l'idempotence (qui enveloppe toute écriture) n'est même
    // jamais entrée en jeu.
    expect(executer).not.toHaveBeenCalled();
  });

  it('REFUSE aussi un magasinier ciblant autrui (même absence de droit d’encadrement)', async () => {
    const executer = vi.fn(async () => SENTINELLE);
    const { service } = serviceAvecExecuter(executer);

    await expect(
      service.demarrer(CTX, principal('magasinier', MOI), entreeDemarrage(AUTRE), 'cle'),
    ).rejects.toBeInstanceOf(ErreurMetier);
    expect(executer).not.toHaveBeenCalled();
  });

  it('AUTORISE un technicien qui pointe pour LUI-MÊME (technicienId = session)', async () => {
    const executer = vi.fn(async () => SENTINELLE);
    const { service } = serviceAvecExecuter(executer);

    await service.demarrer(CTX, principal('technicien', MOI), entreeDemarrage(MOI), 'cle');
    expect(executer).toHaveBeenCalledTimes(1);
  });

  it('AUTORISE un chef d’atelier à démarrer au nom d’un technicien (encadrement : atelier.pointage.pointer_autrui)', async () => {
    const executer = vi.fn(async () => SENTINELLE);
    const { service } = serviceAvecExecuter(executer);

    await service.demarrer(CTX, principal('chef_atelier', MOI), entreeDemarrage(AUTRE), 'cle');
    expect(executer).toHaveBeenCalledTimes(1);
  });

  it('AUTORISE la borne poste_atelier à démarrer au nom du technicien identifié (compte de service exempté du contrôle soi/autrui — cas d’usage prévu, ne doit pas casser)', async () => {
    const executer = vi.fn(async () => SENTINELLE);
    const { service } = serviceAvecExecuter(executer);

    // La borne (session = BORNE) pointe pour un technicien (AUTRE) : différent de la session, mais
    // légitime par conception.
    await service.demarrer(CTX, principal('poste_atelier', BORNE), entreeDemarrage(AUTRE), 'cle');
    expect(executer).toHaveBeenCalledTimes(1);
  });
});

describe('ServicePointage.arreter — garde soi/autrui (faille corrigée)', () => {
  const chargeur = chargerPointagePourEcriture as unknown as Mock;

  // `executer` invoque le callback avec un `tx` factice : la garde y tourne après le chargement.
  const executerQuiDeroule = () =>
    vi.fn(async (_ctx: unknown, _meta: unknown, cb: (tx: unknown) => unknown) => ({
      rejoue: false,
      reponse: await cb({}),
    }));

  const entreeArret = { finLe: '2026-07-31T09:30:00.000Z' } as unknown as EntreeArretPointage;

  function pointageCharge(technicienId: string, statut: 'en_cours' | 'termine') {
    return {
      id: POINTAGE_ID,
      tenantId: TENANT,
      technicienId,
      statut,
      debutLe: new Date('2026-07-31T08:00:00.000Z'),
      finLe: statut === 'termine' ? new Date('2026-07-31T08:30:00.000Z') : null,
      anomalieMotif: null,
      anomalieDetecteeLe: null,
    };
  }

  beforeEach(() => chargeur.mockReset());

  it('REFUSE (403 DROIT_INSUFFISANT) un technicien qui arrête le pointage d’un AUTRE — la propriété est lue sur la ligne chargée, pas sur le corps', async () => {
    chargeur.mockResolvedValue(pointageCharge(AUTRE, 'en_cours'));
    const { service } = serviceAvecExecuter(executerQuiDeroule());

    await expect(
      service.arreter(CTX, principal('technicien', MOI), POINTAGE_ID, entreeArret, 'cle'),
    ).rejects.toMatchObject({ code: 'DROIT_INSUFFISANT' });
  });

  it('LAISSE PASSER la garde pour un technicien arrêtant SON PROPRE pointage — l’échec suivant est POINTAGE_TRANSITION_INTERDITE (pointage déjà terminé), PAS un refus de droit', async () => {
    chargeur.mockResolvedValue(pointageCharge(MOI, 'termine'));
    const { service } = serviceAvecExecuter(executerQuiDeroule());

    await expect(
      service.arreter(CTX, principal('technicien', MOI), POINTAGE_ID, entreeArret, 'cle'),
    ).rejects.toMatchObject({ code: 'POINTAGE_TRANSITION_INTERDITE' });
  });

  it('LAISSE PASSER la garde pour un chef d’atelier arrêtant le pointage d’un technicien (encadrement) — même échec neutre, PAS DROIT_INSUFFISANT', async () => {
    chargeur.mockResolvedValue(pointageCharge(AUTRE, 'termine'));
    const { service } = serviceAvecExecuter(executerQuiDeroule());

    await expect(
      service.arreter(CTX, principal('chef_atelier', MOI), POINTAGE_ID, entreeArret, 'cle'),
    ).rejects.toMatchObject({ code: 'POINTAGE_TRANSITION_INTERDITE' });
  });

  it('LAISSE PASSER la garde pour la borne poste_atelier arrêtant le pointage du technicien identifié (cas d’usage prévu) — même échec neutre', async () => {
    chargeur.mockResolvedValue(pointageCharge(AUTRE, 'termine'));
    const { service } = serviceAvecExecuter(executerQuiDeroule());

    await expect(
      service.arreter(CTX, principal('poste_atelier', BORNE), POINTAGE_ID, entreeArret, 'cle'),
    ).rejects.toMatchObject({ code: 'POINTAGE_TRANSITION_INTERDITE' });
  });
});

/**
 * Défaut HAUT confirmé (double-pointage concurrent en 500) : `estCollisionIdPointage` ne testait
 * `code`/`constraint` qu'au PREMIER NIVEAU de l'erreur levée par `tx.insert(pointage)...` dans
 * `demarrer`. Or Drizzle (`pg-core/session.js`) enveloppe SYSTÉMATIQUEMENT l'erreur brute du
 * pilote `pg` dans une `DrizzleQueryError` qui ne porte `code`/`constraint` que sous `.cause` —
 * jamais en surface. Un double-clic / une requête concurrente rejouant le MÊME `id` de pointage
 * (RM-87, idempotence côté client) ne déclenchait donc jamais le `409 CONFLIT` déjà écrit dans
 * `demarrer`, et remontait en `500 ERREUR_INTERNE`. MÊME PATRON DE PREUVE que
 * `vehicules/erreurs-contraintes.spec.ts` : les deux formes réellement observées (brute ET
 * enveloppée sous `.cause`), plus le repli sûr sur une chaîne non exploitable ou cyclique.
 */
describe('estCollisionIdPointage (faille corrigée : .cause non déballé)', () => {
  /** Reproduit la forme réelle d'un `DatabaseError` du pilote `pg` pour une violation de contrainte. */
  function erreurPgBrute(
    code: string,
    constraint: string,
  ): Error & { code: string; constraint: string } {
    const erreur = new Error(`erreur pg simulée : ${constraint}`) as Error & {
      code: string;
      constraint: string;
    };
    erreur.code = code;
    erreur.constraint = constraint;
    return erreur;
  }

  /** Reproduit la forme réelle d'une `DrizzleQueryError` (`drizzle-orm/pg-core/session.js`). */
  function erreurDrizzleEnveloppee(code: string, constraint: string): Error & { cause: unknown } {
    const enveloppe = new Error('Failed query') as Error & { cause: unknown };
    enveloppe.cause = erreurPgBrute(code, constraint);
    return enveloppe;
  }

  it('reconnaît la collision enveloppée sous .cause (la forme réelle en production)', () => {
    expect(estCollisionIdPointage(erreurDrizzleEnveloppee('23505', 'pointage_pk'))).toBe(true);
  });

  it('reconnaît la collision sous forme brute (pilote pg directement, sans Drizzle)', () => {
    expect(estCollisionIdPointage(erreurPgBrute('23505', 'pointage_pk'))).toBe(true);
  });

  it('rend false pour un 23505 sur une AUTRE contrainte que pointage_pk', () => {
    expect(
      estCollisionIdPointage(
        erreurDrizzleEnveloppee('23505', 'pointage_technicien_un_seul_en_cours_uk'),
      ),
    ).toBe(false);
  });

  it('rend false pour un SQLSTATE non couvert (même enveloppé)', () => {
    expect(estCollisionIdPointage(erreurDrizzleEnveloppee('23514', 'pointage_pk'))).toBe(false);
  });

  it('rend false pour une exception sans .cause ni code exploitable', () => {
    expect(estCollisionIdPointage(new Error('boom'))).toBe(false);
  });

  it('rend false pour une valeur non-objet', () => {
    expect(estCollisionIdPointage('boom')).toBe(false);
    expect(estCollisionIdPointage(null)).toBe(false);
    expect(estCollisionIdPointage(undefined)).toBe(false);
  });

  it('ne boucle jamais à l’infini sur une chaîne .cause cyclique', () => {
    const cyclique = new Error('cyclique') as Error & { cause: unknown };
    cyclique.cause = cyclique;
    expect(estCollisionIdPointage(cyclique)).toBe(false);
  });
});

/**
 * Défaut UX corrigé (constat écran réel) — la colonne « Cible » d'`EcranEquipePointage` n'affichait
 * jamais le numéro d'OR. Le correctif ajoute `ordreReparationNumero`/`ligneOrDesignation` à
 * `ReponsePointage`, peuplés par `lister` via un `leftJoin` DIRECT sur `ordre_reparation`/`ligne_or`
 * (`service-pointage.ts`) — JAMAIS par un appel de résolution PAR LIGNE de la page (ce dépôt a déjà
 * épuisé son pool de connexions deux fois de cette façon, voir le commentaire de tête de la méthode).
 *
 * Ces tests le PROUVENT structurellement, sans base de données réelle : un `tx` factice qui compte
 * ses appels à `.select(...)` — le point d'entrée UNIQUE d'une requête Drizzle — pour une page
 * contenant PLUSIEURS pointages ciblant des OR DIFFÉRENTS. Si `lister` résolvait le numéro d'OR par
 * un aller-retour supplémentaire par ligne (N+1), `.select` serait appelé plus d'une fois ; le
 * correctif garantit exactement UN appel, quelle que soit la taille de la page.
 */
describe('ServicePointage.lister — ordreReparationNumero / ligneOrDesignation SANS N+1', () => {
  /** Ligne brute telle que rendue par le SELECT réel (colonnes `pointage` + jointures), avec des
   *  valeurs par défaut « pointage indirect sans cible » — surchargées par cas de test. */
  function ligneListee(overrides: Record<string, unknown>) {
    return {
      id: POINTAGE_ID,
      tenantId: TENANT,
      siteId: SITE,
      technicienId: MOI,
      statut: 'en_cours',
      nature: 'indirect',
      ordreReparationId: null,
      ligneOrId: null,
      activiteIndirecte: 'nettoyage',
      source: 'ecran_atelier',
      appareilId: null,
      debutLe: new Date('2026-07-31T08:00:00.000Z'),
      finLe: null,
      dureeArrondieCentiemes: null,
      decalageHorlogeMsDebut: null,
      decalageHorlogeMsFin: null,
      clotureAutomatique: false,
      anomalieMotif: null,
      anomalieDetecteeLe: null,
      anomalieTraiteeLe: null,
      derniereCorrectionMotif: null,
      derniereCorrectionParUtilisateurId: null,
      derniereCorrectionLe: null,
      debutLeOrigine: null,
      finLeOrigine: null,
      creeLe: new Date('2026-07-31T08:00:00.000Z'),
      modifieLe: new Date('2026-07-31T08:00:00.000Z'),
      triValeur: '2026-07-31 08:00:00+00',
      technicienPrenom: 'Marco',
      technicienNom: 'Rossi',
      ordreReparationNumero: null,
      ligneOrDesignation: null,
      ...overrides,
    };
  }

  /** `tx` factice : chaîne `.select().from().innerJoin().leftJoin().leftJoin().where().orderBy()
   *  .limit()` — chaque maillon retourne le même builder (chaînable à volonté), `.limit()` seul
   *  résout la promesse. `.select` est le SEUL point compté : un maillon de chaîne SUPPLÉMENTAIRE
   *  par ligne de résultat n'existe structurellement pas dans ce mock, exactement comme dans le vrai
   *  client Drizzle (`.select` initie UNE requête, quel que soit ce qu'elle retourne). */
  function txFausseAvecCompteur(lignes: readonly unknown[]) {
    let appelsSelect = 0;
    const builder = {
      from: vi.fn(() => builder),
      innerJoin: vi.fn(() => builder),
      leftJoin: vi.fn(() => builder),
      where: vi.fn(() => builder),
      orderBy: vi.fn(() => builder),
      limit: vi.fn(() => Promise.resolve(lignes)),
    };
    return {
      tx: {
        select: vi.fn(() => {
          appelsSelect += 1;
          return builder;
        }),
      },
      nombreAppelsSelect: () => appelsSelect,
    };
  }

  it('une seule requête (`tx.select` appelé UNE fois) pour une page de 3 pointages ciblant 2 OR différents + un pointage indirect', async () => {
    const lignes = [
      ligneListee({
        id: 'p1',
        nature: 'productif_or',
        ordreReparationId: 'or-1',
        activiteIndirecte: null,
        ordreReparationNumero: 'OR-2026-00001',
      }),
      ligneListee({
        id: 'p2',
        nature: 'productif_ligne',
        ordreReparationId: 'or-2',
        ligneOrId: 'ligne-2',
        activiteIndirecte: null,
        ordreReparationNumero: 'OR-2026-00002',
        ligneOrDesignation: 'Vidange + filtres',
      }),
      ligneListee({ id: 'p3' }), // indirect : aucune cible, ni requête ni valeur à résoudre.
    ];
    const { tx, nombreAppelsSelect } = txFausseAvecCompteur(lignes);
    const acces = {
      enTenant: vi.fn((_ctx: unknown, cb: (tx: unknown) => unknown) => cb(tx)),
    } as unknown as ConstructorParameters<typeof ServicePointage>[0];
    const idempotence = {} as unknown as ConstructorParameters<typeof ServicePointage>[1];
    const service = new ServicePointage(acces, idempotence, horlogeStub);

    const filtres = { tri: 'debutLe:desc' } as unknown as FiltresPointages;
    const page = await service.lister(CTX, principal('chef_atelier', MOI), filtres, 10, undefined);

    // La preuve d'absence de N+1 : UN SEUL appel à `.select`, indépendamment du nombre de pointages
    // et du nombre d'OR distincts qu'ils ciblent.
    expect(nombreAppelsSelect()).toBe(1);

    expect(page.donnees).toHaveLength(3);
    expect(page.donnees[0]).toMatchObject({
      ordreReparationNumero: 'OR-2026-00001',
      ligneOrDesignation: null,
    });
    expect(page.donnees[1]).toMatchObject({
      ordreReparationNumero: 'OR-2026-00002',
      ligneOrDesignation: 'Vidange + filtres',
    });
    // Pointage indirect (RM-87, aucune cible) : les deux champs restent `null`, jamais une chaîne
    // vide ni une valeur empruntée à un autre pointage de la même page.
    expect(page.donnees[2]).toMatchObject({
      ordreReparationId: null,
      ligneOrId: null,
      ordreReparationNumero: null,
      ligneOrDesignation: null,
    });
  });

  it('active bien les deux `leftJoin` (ordre_reparation, ligne_or) en plus de l’`innerJoin` utilisateur existant', async () => {
    const { tx } = txFausseAvecCompteur([ligneListee({ id: 'p1' })]);
    const acces = {
      enTenant: vi.fn((_ctx: unknown, cb: (tx: unknown) => unknown) => cb(tx)),
    } as unknown as ConstructorParameters<typeof ServicePointage>[0];
    const idempotence = {} as unknown as ConstructorParameters<typeof ServicePointage>[1];
    const service = new ServicePointage(acces, idempotence, horlogeStub);

    const filtres = { tri: 'debutLe:desc' } as unknown as FiltresPointages;
    await service.lister(CTX, principal('direction', MOI), filtres, 10, undefined);

    const builderRendu = (tx.select as Mock).mock.results[0]?.value as {
      innerJoin: Mock;
      leftJoin: Mock;
    };
    expect(builderRendu.innerJoin).toHaveBeenCalledTimes(1);
    expect(builderRendu.leftJoin).toHaveBeenCalledTimes(2);
  });
});

/**
 * `GET /pointages/dernier-du-jour` — `resoudreCibleReprise`/`journeeTravailCourante` (pures) sont
 * déjà couvertes en profondeur par `regles-pointage.spec.ts` ; ce bloc prouve l'ORCHESTRATION
 * propre au service : la garde soi/autrui (MÊME garde que `demarrer`/`arreter`), le technicien par
 * défaut quand `technicienId` est absent, et que le `ctx` (jamais reconstruit) porte l'isolation
 * tenant jusqu'à la requête. `chargerPointagesProductifsDuJour` est une fonction de module : on la
 * simule, même patron que `chargerPointagePourEcriture` en tête de fichier — ce test NE PROUVE PAS
 * le WHERE réel (scoping tenant/technicien, filtre `nature`, bornes de date) : ça, seule une
 * intégration contre une vraie base peut le prouver (signalé au rapport de tâche).
 */
describe('ServicePointage.dernierDuJour — orchestration (garde soi/autrui, journée, isolation)', () => {
  const chargeur = chargerPointagesProductifsDuJour as unknown as Mock;
  const HORLOGE_FIXE = new Date('2026-08-14T15:00:00.000Z');
  const horlogeFixeStub = {
    maintenant: () => HORLOGE_FIXE,
  } as unknown as ConstructorParameters<typeof ServicePointage>[2];

  beforeEach(() => chargeur.mockReset());

  function serviceAvecAcces(): { service: ServicePointage; acces: { enTenant: Mock } } {
    const acces = {
      enTenant: vi.fn((_ctx: unknown, cb: (tx: unknown) => unknown) => cb({})),
    };
    const idempotence = {} as unknown as ConstructorParameters<typeof ServicePointage>[1];
    return {
      service: new ServicePointage(
        acces as unknown as ConstructorParameters<typeof ServicePointage>[0],
        idempotence,
        horlogeFixeStub,
      ),
      acces,
    };
  }

  it('technicienId ABSENT : interroge la cible du technicien de la SESSION, aucune vérification de droit supplémentaire', async () => {
    chargeur.mockResolvedValue([]);
    const { service } = serviceAvecAcces();

    const resultat = await service.dernierDuJour(CTX, principal('technicien', MOI), undefined);

    expect(resultat).toEqual({ cible: null });
    expect(chargeur).toHaveBeenCalledWith(
      expect.anything(),
      CTX,
      MOI,
      new Date('2026-08-14T00:00:00.000Z'),
      new Date('2026-08-14T23:59:59.999Z'),
    );
  });

  it('technicienId présent = SOI-MÊME : autorisé sans droit d’encadrement', async () => {
    chargeur.mockResolvedValue([]);
    const { service } = serviceAvecAcces();

    await service.dernierDuJour(CTX, principal('technicien', MOI), MOI);
    expect(chargeur).toHaveBeenCalledWith(
      expect.anything(),
      CTX,
      MOI,
      expect.any(Date),
      expect.any(Date),
    );
  });

  it('technicienId présent = AUTRUI, appelant SANS droit d’encadrement ni statut de compte de service : REFUSÉ (403 DROIT_INSUFFISANT), AUCUNE requête exécutée', async () => {
    const { service, acces } = serviceAvecAcces();

    await expect(
      service.dernierDuJour(CTX, principal('technicien', MOI), AUTRE),
    ).rejects.toMatchObject({ code: 'DROIT_INSUFFISANT' });
    expect(acces.enTenant).not.toHaveBeenCalled();
    expect(chargeur).not.toHaveBeenCalled();
  });

  it('technicienId présent = AUTRUI, appelant avec atelier.pointage.pointer_autrui (chef d’atelier) : AUTORISÉ', async () => {
    chargeur.mockResolvedValue([]);
    const { service } = serviceAvecAcces();

    const resultat = await service.dernierDuJour(CTX, principal('chef_atelier', MOI), AUTRE);
    expect(resultat).toEqual({ cible: null });
    expect(chargeur).toHaveBeenCalledWith(
      expect.anything(),
      CTX,
      AUTRE,
      expect.any(Date),
      expect.any(Date),
    );
  });

  it('technicienId présent = AUTRUI, appelant = borne poste_atelier (compte de service, exempté du contrôle soi/autrui) : AUTORISÉ', async () => {
    chargeur.mockResolvedValue([]);
    const { service } = serviceAvecAcces();

    const resultat = await service.dernierDuJour(CTX, principal('poste_atelier', BORNE), AUTRE);
    expect(resultat).toEqual({ cible: null });
    expect(chargeur).toHaveBeenCalledWith(
      expect.anything(),
      CTX,
      AUTRE,
      expect.any(Date),
      expect.any(Date),
    );
  });

  it('technicienId inexistant : la requête ne remonte aucun pointage → cible null, PAS de code d’erreur distinct (ne révèle pas si l’identifiant existe)', async () => {
    const INEXISTANT = '99999999-9999-9999-9999-999999999999';
    chargeur.mockResolvedValue([]); // simule ce qu'un technicienId inexistant produit réellement en base : aucune ligne.
    const { service } = serviceAvecAcces();

    const resultat = await service.dernierDuJour(CTX, principal('chef_atelier', MOI), INEXISTANT);
    expect(resultat).toEqual({ cible: null });
  });

  it('isolation tenant : le `ctx` transmis à la requête est EXACTEMENT celui du contexte tenant reçu, jamais reconstruit depuis le principal', async () => {
    chargeur.mockResolvedValue([]);
    const { service, acces } = serviceAvecAcces();

    await service.dernierDuJour(CTX, principal('technicien', MOI), undefined);

    expect(acces.enTenant).toHaveBeenCalledWith(CTX, expect.any(Function));
    expect(chargeur).toHaveBeenCalledWith(
      expect.anything(),
      CTX,
      MOI,
      expect.any(Date),
      expect.any(Date),
    );
  });

  it('un technicien d’un AUTRE tenant ne remonte jamais : la requête est scopée par le `ctx` du tenant courant, jamais par un `tenantId` lu ailleurs', async () => {
    // Preuve d'orchestration (pas de SQL réel ici, signalé au rapport) : le SEUL tenant transmis à
    // la couche de requête est `CTX.tenantId` — aucun autre canal (principal.tenantId, un
    // `technicienId` d'un autre tenant) n'influence le `ctx` transmis.
    const AUTRE_TENANT_CTX = {
      tenantId: '77777777-7777-7777-7777-777777777777',
      utilisateurId: MOI,
      requeteId: null,
    } satisfies ContexteTenant;
    chargeur.mockResolvedValue([]);
    const { service } = serviceAvecAcces();

    await service.dernierDuJour(AUTRE_TENANT_CTX, principal('technicien', MOI), undefined);
    expect(chargeur).toHaveBeenCalledWith(
      expect.anything(),
      AUTRE_TENANT_CTX,
      MOI,
      expect.any(Date),
      expect.any(Date),
    );
  });

  it('délègue la résolution à `resoudreCibleReprise` avec l’horloge injectée — une cible pointable remontée par la requête est bien rendue', async () => {
    chargeur.mockResolvedValue([
      {
        id: 'p1',
        ordreReparationId: 'or1',
        ligneOrId: 'l1',
        siteId: SITE,
        debutLe: new Date('2026-08-14T08:00:00.000Z'),
        finLe: new Date('2026-08-14T08:30:00.000Z'),
        statutOr: 'en_cours',
        statutLigne: 'en_cours',
        numeroOr: 'OR-2026-00042',
        designationLigne: 'Vidange',
      },
    ]);
    const { service } = serviceAvecAcces();

    const resultat = await service.dernierDuJour(CTX, principal('technicien', MOI), undefined);
    expect(resultat).toEqual({
      cible: {
        type: 'ligne',
        ordreReparationId: 'or1',
        numeroOr: 'OR-2026-00042',
        ligneOrId: 'l1',
        libelle: 'Vidange',
        siteId: SITE,
        interrompuLe: '2026-08-14T08:30:00.000Z',
        cumulSecondesDuJour: 1800,
      },
    });
  });
});
