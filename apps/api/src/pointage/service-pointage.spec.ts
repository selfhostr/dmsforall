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
import type { EntreeArretPointage, EntreeDemarragePointage, RoleUtilisateur } from '@dfa/shared';

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
}));
import { chargerPointagePourEcriture } from './pointage-requetes';

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
