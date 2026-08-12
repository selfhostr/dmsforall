import { describe, expect, it, vi } from 'vitest';
import type { EntreePlaqueVehicule } from '@dfa/shared';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import { ServiceVehiculePlaque } from './service-vehicule-plaque';

const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'u1', requeteId: null };
const VEHICULE_ID = '11111111-1111-4111-8111-111111111111';
const VEHICULE_FAUTIF_ID = '22222222-2222-4222-8222-222222222222';

const ENTREE: EntreePlaqueVehicule = {
  valeur: 'VD 123456',
  canton: 'VD',
  pays: 'CH',
  debutLe: '2026-07-15',
  interchangeable: false,
  professionnelle: false,
};

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
 * Fausse transaction couvrant les trois opérations traversées par `ServiceVehiculePlaque.creer` :
 *  - `select().from(vehicule).where().limit()` (`exigerVehiculeExiste`) ;
 *  - `insert(vehiculePlaque).values().returning()` (l'INSERT qui échoue sur la collision) ;
 *  - `execute(...)` (la relecture de secours `trouverVehiculeCollisionPlaque`, UNIQUEMENT dans la
 *    branche d'erreur).
 */
function txFactice(plan: {
  readonly selectVehicule?: readonly unknown[];
  readonly erreurInsertion?: unknown;
  readonly executes?: ReadonlyArray<{ rows: readonly unknown[] }>;
}) {
  const executes = [...(plan.executes ?? [])];
  const executeMock = vi.fn(() => Promise.resolve(executes.shift() ?? { rows: [] }));
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(plan.selectVehicule ?? [{ id: VEHICULE_ID }]),
        }),
      }),
    }),
    insert: (_table: unknown) => ({
      values: (_vals: unknown) => ({
        returning: () =>
          plan.erreurInsertion
            ? Promise.reject(plan.erreurInsertion)
            : Promise.resolve([{ id: 'p1', ...ENTREE, du: ENTREE.debutLe, au: null }]),
      }),
    }),
    execute: executeMock,
  };
  return { tx: tx as unknown as TransactionDfa, executeMock };
}

function accesFactice(tx: TransactionDfa): AccesBase {
  return {
    enTenant: vi.fn((_ctx: ContexteTenant, travail: (tx: TransactionDfa) => Promise<unknown>) =>
      travail(tx),
    ),
    verifierConnexion: vi.fn(),
    verifierPostureRls: vi.fn(),
  } as unknown as AccesBase;
}

const LIGNE_VEHICULE_FAUTIF = {
  vehicule_id: VEHICULE_FAUTIF_ID,
  marque: 'Volkswagen',
  modele: 'Golf VII',
  version: 'Comfortline',
  valeur: 'VD 123456',
  canton: 'VD',
  du: '2026-03-12',
  au: null,
};

describe('ServiceVehiculePlaque.creer — 409 VEHICULE_PLAQUE_COLLISION enrichi (dette technique n°6)', () => {
  it('nomme le véhicule fautif dans blocages[0].donnees quand la relecture le retrouve', async () => {
    const { tx, executeMock } = txFactice({
      erreurInsertion: ERREUR_COLLISION,
      executes: [{ rows: [LIGNE_VEHICULE_FAUTIF] }],
    });
    const service = new ServiceVehiculePlaque(accesFactice(tx));

    await expect(service.creer(CTX, VEHICULE_ID, ENTREE)).rejects.toMatchObject({
      code: 'VEHICULE_PLAQUE_COLLISION',
      blocages: [
        {
          type: 'champ',
          id: 'valeur',
          donnees: {
            vehiculeId: VEHICULE_FAUTIF_ID,
            marque: 'Volkswagen',
            modele: 'Golf VII',
            version: 'Comfortline',
            plaque: 'VD 123456',
            canton: 'VD',
            debutLe: '2026-03-12',
            finLe: null,
          },
        },
      ],
    });
    // La relecture ne s'exécute QUE dans la branche d'erreur — une seule requête `execute`.
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it("cas de course : la ligne fautive n'est plus retrouvable à la relecture — reste 409 correct, sans blocages, jamais un 500 ni un identifiant inventé", async () => {
    const { tx } = txFactice({
      erreurInsertion: ERREUR_COLLISION,
      executes: [{ rows: [] }],
    });
    const service = new ServiceVehiculePlaque(accesFactice(tx));

    await expect(service.creer(CTX, VEHICULE_ID, ENTREE)).rejects.toMatchObject({
      code: 'VEHICULE_PLAQUE_COLLISION',
      blocages: undefined,
    });
  });

  it("n'exécute JAMAIS la relecture de secours sur le chemin nominal (pas de collision)", async () => {
    const { tx, executeMock } = txFactice({});
    const service = new ServiceVehiculePlaque(accesFactice(tx));

    await expect(service.creer(CTX, VEHICULE_ID, ENTREE)).resolves.toMatchObject({
      valeur: ENTREE.valeur,
    });
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('une autre contrainte du même module (ex. VALIDATION_ECHOUEE) ne déclenche pas la relecture véhicule', async () => {
    const { tx, executeMock } = txFactice({
      erreurInsertion: erreurDrizzleEnveloppee('23514', 'vehicule_vin_format_chk'),
    });
    const service = new ServiceVehiculePlaque(accesFactice(tx));

    await expect(service.creer(CTX, VEHICULE_ID, ENTREE)).rejects.toMatchObject({
      code: 'VALIDATION_ECHOUEE',
      blocages: undefined,
    });
    expect(executeMock).not.toHaveBeenCalled();
  });
});
