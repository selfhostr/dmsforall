import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { EntreeCreationVehicule, ReponseVehicule } from '@dfa/shared';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import { Horloge } from '../common/horloge';
import { ServiceVehicule } from './service-vehicule';
import * as vehiculeRequetes from './vehicule-requetes';

/**
 * `ServiceVehicule.creerDansTransaction` — SECONDE voie d'entrée sur la collision de plaque
 * (RM-18, dette technique n°6), au même titre que `ServiceVehiculePlaque.creer` (déjà couvert par
 * `service-vehicule-plaque.spec.ts`). Ce fichier ne reteste PAS le prédicat SQL de
 * `trouverVehiculeCollisionPlaque` (déjà prouvé ailleurs, contre la vraie base) — il isole
 * l'ORCHESTRATION propre à `creerDansTransaction` : bascule sur `VEHICULE_PLAQUE_COLLISION`,
 * relecture dans une transaction FRAÎCHE (second appel à `acces.enTenant`, jamais la `tx` de
 * l'appelant), forme de `blocages` identique à l'autre voie, cas de course, chemin nominal
 * inaffecté. Le piège de la transaction avortée (25P02) lui-même n'est prouvé qu'en exécution
 * réelle contre Postgres — un mock de `tx.execute` ne peut pas le révéler.
 */
vi.mock('./vehicule-requetes', async (importOriginal) => {
  const reel = await importOriginal<typeof import('./vehicule-requetes')>();
  return {
    ...reel,
    construireReponseVehicule: vi.fn(),
    trouverVehiculeCollisionPlaque: vi.fn(),
  };
});

const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'u1', requeteId: null };
const VEHICULE_ID = '11111111-1111-4111-8111-111111111111';
const VEHICULE_FAUTIF_ID = '22222222-2222-4222-8222-222222222222';
const MAINTENANT = new Date('2026-08-12T09:00:00.000Z');

const ENTREE: EntreeCreationVehicule = {
  marque: 'Audi',
  modele: 'A4',
  importe: false,
  plaque: 'VD 999999',
  canton: 'VD',
};

const REPONSE_FACTICE = { id: VEHICULE_ID, marque: 'Audi', modele: 'A4' } as ReponseVehicule;

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

const ERREUR_COLLISION = erreurDrizzleEnveloppee('23P01', 'vehicule_plaque_collision_excl');

/**
 * `tx` factice couvrant les deux INSERT que traverse `creerDansTransaction` :
 * `insert(vehicule).values().returning()` (toujours en succès dans ces tests) et
 * `execute(...)` (l'INSERT SQL brut de la plaque, qui échoue selon `erreurPlaque`).
 */
function txFactice(erreurPlaque?: unknown) {
  const executeMock = vi.fn(() =>
    erreurPlaque ? Promise.reject(erreurPlaque) : Promise.resolve({ rows: [] }),
  );
  const tx = {
    insert: (_table: unknown) => ({
      values: (_vals: unknown) => ({
        returning: () => Promise.resolve([{ id: VEHICULE_ID, identificationIncomplete: true }]),
      }),
    }),
    execute: executeMock,
  };
  return { tx: tx as unknown as TransactionDfa, executeMock };
}

/** `enTenant` factice : ouvre une transaction DISTINCTE de `tx` à chaque appel, pour pouvoir
 *  prouver que la relecture de secours ne réutilise jamais la `tx` de l'appelant (aboutie ou pas). */
function accesFactice(): {
  readonly acces: AccesBase;
  readonly enTenantMock: ReturnType<typeof vi.fn>;
} {
  const enTenantMock = vi.fn(
    (_ctx: ContexteTenant, travail: (tx: TransactionDfa) => Promise<unknown>) =>
      travail({} as TransactionDfa),
  );
  return {
    acces: {
      enTenant: enTenantMock,
      verifierConnexion: vi.fn(),
      verifierPostureRls: vi.fn(),
    } as unknown as AccesBase,
    enTenantMock,
  };
}

const LIGNE_VEHICULE_FAUTIF = {
  vehiculeId: VEHICULE_FAUTIF_ID,
  marque: 'Volkswagen',
  modele: 'Golf VII',
  version: 'Comfortline',
  plaque: 'VD 999999',
  canton: 'VD',
  debutLe: '2026-03-12',
  finLe: null,
};

describe('ServiceVehicule.creerDansTransaction — 409 VEHICULE_PLAQUE_COLLISION enrichi sur la voie de création (dette technique n°6)', () => {
  beforeEach(() => {
    vi.mocked(vehiculeRequetes.construireReponseVehicule).mockResolvedValue(REPONSE_FACTICE);
    vi.mocked(vehiculeRequetes.trouverVehiculeCollisionPlaque).mockReset();
  });

  it('nomme le véhicule fautif dans blocages[0].donnees, avec le même contrat que ServiceVehiculePlaque.creer', async () => {
    vi.mocked(vehiculeRequetes.trouverVehiculeCollisionPlaque).mockResolvedValue(
      LIGNE_VEHICULE_FAUTIF,
    );
    const { tx, executeMock } = txFactice(ERREUR_COLLISION);
    const { acces, enTenantMock } = accesFactice();
    const horloge = { maintenant: () => MAINTENANT } as Horloge;
    const service = new ServiceVehicule(acces, horloge);

    await expect(service.creerDansTransaction(tx, CTX, ENTREE)).rejects.toMatchObject({
      code: 'VEHICULE_PLAQUE_COLLISION',
      blocages: [
        {
          type: 'champ',
          id: 'plaque',
          donnees: LIGNE_VEHICULE_FAUTIF,
        },
      ],
    });
    // L'INSERT véhicule a réussi, seul l'INSERT plaque échoue — une seule exécution sur `tx`.
    expect(executeMock).toHaveBeenCalledTimes(1);
    // La relecture court dans une transaction FRAÎCHE (second appel à `enTenant`), jamais sur `tx`.
    expect(enTenantMock).toHaveBeenCalledTimes(1);
    expect(vehiculeRequetes.trouverVehiculeCollisionPlaque).toHaveBeenCalledWith(
      expect.anything(),
      CTX,
      { valeur: 'VD 999999', debutLe: '2026-08-12' },
    );
  });

  it("cas de course : la ligne fautive n'est plus retrouvable à la relecture — reste 409 correct, sans blocages, jamais un 500 ni un identifiant inventé", async () => {
    vi.mocked(vehiculeRequetes.trouverVehiculeCollisionPlaque).mockResolvedValue(null);
    const { tx } = txFactice(ERREUR_COLLISION);
    const { acces } = accesFactice();
    const horloge = { maintenant: () => MAINTENANT } as Horloge;
    const service = new ServiceVehicule(acces, horloge);

    await expect(service.creerDansTransaction(tx, CTX, ENTREE)).rejects.toMatchObject({
      code: 'VEHICULE_PLAQUE_COLLISION',
      blocages: undefined,
    });
  });

  it("n'exécute JAMAIS la relecture de secours sur le chemin nominal (pas de collision)", async () => {
    const { tx, executeMock } = txFactice();
    const { acces, enTenantMock } = accesFactice();
    const horloge = { maintenant: () => MAINTENANT } as Horloge;
    const service = new ServiceVehicule(acces, horloge);

    await expect(service.creerDansTransaction(tx, CTX, ENTREE)).resolves.toMatchObject({
      donnees: REPONSE_FACTICE,
    });
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(enTenantMock).not.toHaveBeenCalled();
    expect(vehiculeRequetes.trouverVehiculeCollisionPlaque).not.toHaveBeenCalled();
  });

  it('une autre contrainte du même module (ex. VIN format) ne déclenche pas la relecture véhicule', async () => {
    const { tx } = txFactice(erreurDrizzleEnveloppee('23514', 'vehicule_vin_format_chk'));
    const { acces, enTenantMock } = accesFactice();
    const horloge = { maintenant: () => MAINTENANT } as Horloge;
    const service = new ServiceVehicule(acces, horloge);

    await expect(service.creerDansTransaction(tx, CTX, ENTREE)).rejects.toMatchObject({
      code: 'VALIDATION_ECHOUEE',
      blocages: undefined,
    });
    expect(enTenantMock).not.toHaveBeenCalled();
    expect(vehiculeRequetes.trouverVehiculeCollisionPlaque).not.toHaveBeenCalled();
  });

  it("ne pose pas de plaque quand l'entrée n'en porte pas — aucun risque de collision, aucune relecture", async () => {
    const { tx, executeMock } = txFactice();
    const { acces, enTenantMock } = accesFactice();
    const horloge = { maintenant: () => MAINTENANT } as Horloge;
    const service = new ServiceVehicule(acces, horloge);

    await service.creerDansTransaction(tx, CTX, { ...ENTREE, plaque: null });

    expect(executeMock).not.toHaveBeenCalled();
    expect(enTenantMock).not.toHaveBeenCalled();
  });
});
