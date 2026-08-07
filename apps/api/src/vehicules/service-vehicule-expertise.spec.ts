import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntreeExpertiseVehicule } from '@dfa/shared';
import type { ContexteTenant, TransactionDfa } from '../db';
import type { LigneVehicule, LigneVehiculeExpertise } from '../db/schema';

/**
 * Issue #15, point 2 : `POST /vehicules/{id}/expertises` acceptait sans le moindre contrôle une
 * échéance/date de contre-visite ANTÉRIEURE à l'expertise qui la déclenche (ex. `dateLe:
 * 2026-08-06`, `delaiContreVisiteLe: 2020-01-01` → `201`, accepté) — un ordre physiquement
 * impossible en Suisse (RM-28 : la contre-visite MFK suit toujours l'expertise cantonale).
 *
 * Ce fichier prouve, sans base réelle (même doctrine de mock que
 * `service-vehicule-kilometrage.spec.ts` : fonctions de requête et transaction MOQUÉES), que
 * `ServiceVehiculeExpertise.creer` refuse maintenant NETTEMENT (400 VALIDATION_ECHOUEE, jamais un
 * simple avertissement — voir la justification en tête de `exigerOrdreContreVisite` dans
 * `service-vehicule-expertise.ts`) toute incohérence d'ordre sur `delaiContreVisiteLe` ou
 * `dateContreVisiteLe`, et que le refus n'écrit RIEN (aucun `tx.insert`).
 */
vi.mock('./vehicule-requetes', () => ({
  chargerLigneVehicule: vi.fn(),
  listerExpertises: vi.fn(),
}));

import { ServiceVehiculeExpertise, exigerOrdreContreVisite } from './service-vehicule-expertise';
import * as vehiculeRequetes from './vehicule-requetes';

const CTX: ContexteTenant = { tenantId: 'tenant-a', utilisateurId: 'user-1', requeteId: 'req-1' };
const VEHICULE_ID = 'vehicule-1';

const ENTREE_BASE: EntreeExpertiseVehicule = {
  dateLe: '2026-08-06',
  resultat: 'accepte_avec_defauts',
  sourceEcheance: 'calculee',
};

function ligneInseree(champs: Partial<LigneVehiculeExpertise> = {}): LigneVehiculeExpertise {
  return {
    id: 'expertise-1',
    tenantId: 'tenant-a',
    vehiculeId: VEHICULE_ID,
    dateExpertise: '2026-08-06',
    resultat: 'accepte_avec_defauts',
    defauts: null,
    delaiContreVisite: null,
    dateContreVisite: null,
    prochaineEcheance: null,
    sourceEcheance: null,
    creeLe: new Date('2026-08-06T08:00:00.000Z'),
    modifieLe: new Date('2026-08-06T08:00:00.000Z'),
    ...champs,
  } as LigneVehiculeExpertise;
}

/** Fausse transaction : seul `insert(...).values(...).returning()` est exercé par ce service. */
function txFactice(ligne: LigneVehiculeExpertise) {
  const returning = vi.fn(async () => [ligne]);
  const values = vi.fn(() => ({ returning }));
  const insert = vi.fn(() => ({ values }));
  return { tx: { insert } as unknown as TransactionDfa, insert, values, returning };
}

function accesBaseFactice(tx: TransactionDfa) {
  return {
    enTenant: vi.fn(
      async (_ctx: ContexteTenant, travail: (tx: TransactionDfa) => Promise<unknown>) =>
        travail(tx),
    ),
  };
}

beforeEach(() => {
  vi.mocked(vehiculeRequetes.chargerLigneVehicule).mockResolvedValue({} as LigneVehicule);
});

describe('exigerOrdreContreVisite — validation pure (issue #15, point 2)', () => {
  it('accepte une entrée sans delaiContreVisiteLe ni dateContreVisiteLe (les deux champs sont facultatifs)', () => {
    expect(() => exigerOrdreContreVisite(ENTREE_BASE)).not.toThrow();
  });

  it('accepte delaiContreVisiteLe postérieur à dateLe', () => {
    expect(() =>
      exigerOrdreContreVisite({ ...ENTREE_BASE, delaiContreVisiteLe: '2026-09-06' }),
    ).not.toThrow();
  });

  it('accepte delaiContreVisiteLe EGAL à dateLe (comparaison stricte, égalité admise)', () => {
    expect(() =>
      exigerOrdreContreVisite({ ...ENTREE_BASE, delaiContreVisiteLe: '2026-08-06' }),
    ).not.toThrow();
  });

  it('refuse (VALIDATION_ECHOUEE) delaiContreVisiteLe antérieur à dateLe — cas exact de l’issue', () => {
    let erreur: unknown;
    try {
      exigerOrdreContreVisite({
        ...ENTREE_BASE,
        dateLe: '2026-08-06',
        delaiContreVisiteLe: '2020-01-01',
      });
    } catch (e) {
      erreur = e;
    }
    expect(erreur).toMatchObject({
      code: 'VALIDATION_ECHOUEE',
      status: 400,
      erreurs: [expect.objectContaining({ champ: 'delaiContreVisiteLe' })],
    });
  });

  it('refuse (VALIDATION_ECHOUEE) dateContreVisiteLe antérieure à dateLe', () => {
    let erreur: unknown;
    try {
      exigerOrdreContreVisite({
        ...ENTREE_BASE,
        dateLe: '2026-08-06',
        dateContreVisiteLe: '2020-01-01',
      });
    } catch (e) {
      erreur = e;
    }
    expect(erreur).toMatchObject({
      code: 'VALIDATION_ECHOUEE',
      status: 400,
      erreurs: [expect.objectContaining({ champ: 'dateContreVisiteLe' })],
    });
  });
});

describe('ServiceVehiculeExpertise.creer — intégration du refus (issue #15, point 2)', () => {
  it('201 accepté quand delaiContreVisiteLe suit bien dateLe', async () => {
    const { tx, insert } = txFactice(
      ligneInseree({ delaiContreVisite: '2026-10-06', dateExpertise: '2026-08-06' }),
    );
    const service = new ServiceVehiculeExpertise(accesBaseFactice(tx) as never);

    const resultat = await service.creer(CTX, VEHICULE_ID, {
      ...ENTREE_BASE,
      delaiContreVisiteLe: '2026-10-06',
    });

    expect(insert).toHaveBeenCalledTimes(1);
    expect(resultat.delaiContreVisiteLe).toBe('2026-10-06');
  });

  it('refuse 400 VALIDATION_ECHOUEE et n’écrit RIEN quand delaiContreVisiteLe précède dateLe de six ans (reproduction exacte de l’issue #15)', async () => {
    const { tx, insert } = txFactice(ligneInseree());
    const service = new ServiceVehiculeExpertise(accesBaseFactice(tx) as never);

    await expect(
      service.creer(CTX, VEHICULE_ID, {
        ...ENTREE_BASE,
        dateLe: '2026-08-06',
        delaiContreVisiteLe: '2020-01-01',
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ECHOUEE',
      status: 400,
      erreurs: [expect.objectContaining({ champ: 'delaiContreVisiteLe' })],
    });

    // Refus = AUCUNE écriture — pas de ligne d'expertise fausse insérée avant le refus.
    expect(insert).not.toHaveBeenCalled();
  });
});
