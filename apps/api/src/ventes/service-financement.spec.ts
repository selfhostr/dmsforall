import { describe, expect, it, vi } from 'vitest';
import type { EntreeCreationFinancement } from '@dfa/shared';
import { schemaCreationFinancement } from '@dfa/shared';

import type { ContexteTenant, TransactionDfa } from '../db';
import type { LigneClient, LigneDossierVente } from '../db/schema';
import type { Horloge } from '../common/horloge/horloge';
import type { PrincipalAuthentifie } from '../common/contexte/contexte-requete.types';
import type {
  ReponseMemorisable,
  RequeteIdempotente,
  ResultatIdempotent,
  ServiceIdempotence,
} from '../common/idempotence';

import { ServiceFinancement } from './service-financement';

/**
 * Trou comblé (audit préalable) : `financement_vente` ne portait aucune donnée monétaire — un
 * dossier avec leasing confirmé n'exposait nulle part combien le client paie
 * (`montantFinanceCentimes`/`acompteCentimes`/`mensualiteCentimes`/`tauxInteretPourmille`/
 * `dureeMois`, migration 0042). Ce fichier prouve :
 *  1. la validation zod du contrat (`schemaCreationFinancement`) — montant négatif rejeté, durée
 *     nulle rejetée, jeu complet accepté ;
 *  2. la garde applicative RV-44 (« comptant n'est pas un financement ») — symétrique de la garde
 *     `organismeId` déjà exercée ailleurs, jamais testée avant ce lot ;
 *  3. que `creer()` persiste bien les cinq champs dans l'INSERT.
 * La présence des champs dans la RÉPONSE (omission par rôle, RF-116) est prouvée séparément dans
 * `mappers.spec.ts` (`versFinancementResponse`/`versFinancementResume`), qui exerce le mapper pur
 * sans reconstituer toute la chaîne de lecture client (`versClientResume`, hors périmètre ici).
 */

const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'u1', requeteId: null };
const PRINCIPAL: PrincipalAuthentifie = {
  utilisateurId: 'u1',
  role: 'direction',
} as unknown as PrincipalAuthentifie;
const MAINTENANT = new Date('2026-08-04T09:00:00.000Z');
const DOSSIER_ID = 'dossier-1';
const ORGANISME_ID = '22222222-2222-4222-8222-222222222222';
const CLE_IDEMPOTENCE = '11111111-1111-4111-8111-111111111111';

function horlogeFactice(): Horloge {
  return { maintenant: () => MAINTENANT } as unknown as Horloge;
}

function dossierVenteFixture(): Partial<LigneDossierVente> {
  return { id: DOSSIER_ID, tenantId: 'tid-1' };
}

function clientLigneFixture(): Partial<LigneClient> {
  return { id: ORGANISME_ID, tenantId: 'tid-1', nom: 'Organisme Leasing SA' };
}

/** Fausse transaction : `select().from().where().limit()` rend, DANS L'ORDRE, les jeux fournis ;
 *  `insert().values().returning()` capture les valeurs écrites — même patron que
 *  `clients/service-client.spec.ts::txFactice`. */
function txFactice(selects: readonly unknown[][] = []) {
  const files = [...selects];
  const insertValuesArgs: Array<Record<string, unknown>> = [];
  const insertsReturning: unknown[][] = [];

  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(files.shift() ?? []) }),
      }),
    }),
    insert: (_table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        insertValuesArgs.push(vals);
        return { returning: () => Promise.resolve(insertsReturning.shift() ?? []) };
      },
    }),
  };

  return {
    tx: tx as unknown as TransactionDfa,
    insertValuesArgs,
    poserRetourInsert: (lignes: unknown[]) => insertsReturning.push(lignes),
  };
}

function idempotenceFactice(tx: TransactionDfa): ServiceIdempotence {
  return {
    async executer<T extends ReponseMemorisable>(
      _ctx: ContexteTenant,
      _requete: RequeteIdempotente,
      travail: (tx: TransactionDfa) => Promise<T>,
    ): Promise<ResultatIdempotent<T>> {
      const reponse = await travail(tx);
      return { reponse, rejoue: false };
    },
  };
}

function serviceFactice(tx: TransactionDfa): ServiceFinancement {
  const svc = new ServiceFinancement(
    { enTenant: vi.fn((_ctx, travail) => travail(tx)) } as never,
    idempotenceFactice(tx),
    horlogeFactice(),
  );
  // `assembler()` (privé) recompose la fiche organisme via `versClientResume` (adresse,
  // véhicules détenus…) — hors périmètre de ce fichier, qui vérifie l'INSERT, pas le
  // ré-assemblage. Même doctrine que `service-vehicule-stock.spec.ts`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.spyOn(svc as any, 'assembler').mockResolvedValue({} as never);
  return svc;
}

describe('schemaCreationFinancement — validation des champs monétaires (0042)', () => {
  const BASE: EntreeCreationFinancement = {
    type: 'leasing',
    organismeId: ORGANISME_ID,
    referenceContrat: null,
    montantFinanceCentimes: 2_500_000,
    acompteCentimes: 300_000,
    mensualiteCentimes: 45_000,
    tauxInteretPourmille: 39,
    dureeMois: 48,
  };

  it('accepte un jeu complet et cohérent de champs monétaires', () => {
    expect(schemaCreationFinancement.safeParse(BASE).success).toBe(true);
  });

  it('accepte un corps sans aucun champ monétaire (tous nullish)', () => {
    expect(
      schemaCreationFinancement.safeParse({ type: 'comptant', organismeId: null }).success,
    ).toBe(true);
  });

  it('rejette un montantFinanceCentimes négatif', () => {
    const resultat = schemaCreationFinancement.safeParse({
      ...BASE,
      montantFinanceCentimes: -1,
    });
    expect(resultat.success).toBe(false);
  });

  it('rejette un acompteCentimes négatif', () => {
    const resultat = schemaCreationFinancement.safeParse({ ...BASE, acompteCentimes: -100 });
    expect(resultat.success).toBe(false);
  });

  it('rejette une mensualiteCentimes non entière (jamais de float sur de l’argent)', () => {
    const resultat = schemaCreationFinancement.safeParse({ ...BASE, mensualiteCentimes: 450.5 });
    expect(resultat.success).toBe(false);
  });

  it('rejette une dureeMois nulle (0)', () => {
    const resultat = schemaCreationFinancement.safeParse({ ...BASE, dureeMois: 0 });
    expect(resultat.success).toBe(false);
  });

  it('rejette une dureeMois hors borne haute (garde-fou, > 120 mois)', () => {
    const resultat = schemaCreationFinancement.safeParse({ ...BASE, dureeMois: 121 });
    expect(resultat.success).toBe(false);
  });

  it('rejette un tauxInteretPourmille hors borne (> 1000)', () => {
    const resultat = schemaCreationFinancement.safeParse({
      ...BASE,
      tauxInteretPourmille: 1001,
    });
    expect(resultat.success).toBe(false);
  });
});

describe("ServiceFinancement.creer — RV-44, un comptant n'est pas un financement (trou comblé)", () => {
  it('refuse (400 VALIDATION_ECHOUEE) un comptant portant un détail monétaire, sans toucher la base', async () => {
    const { tx, insertValuesArgs } = txFactice([[dossierVenteFixture()]]);
    const service = serviceFactice(tx);

    const entree: EntreeCreationFinancement = {
      type: 'comptant',
      organismeId: null,
      referenceContrat: null,
      montantFinanceCentimes: 1_000_000,
    };

    await expect(
      service.creer(CTX, PRINCIPAL, DOSSIER_ID, entree, CLE_IDEMPOTENCE),
    ).rejects.toMatchObject({ code: 'VALIDATION_ECHOUEE', status: 400 });
    expect(insertValuesArgs).toHaveLength(0);
  });

  it('un comptant sans aucun détail monétaire est accepté', async () => {
    const { tx, insertValuesArgs, poserRetourInsert } = txFactice([[dossierVenteFixture()]]);
    poserRetourInsert([{ id: 'fin-1', organismeId: null }]);
    const service = serviceFactice(tx);

    const entree: EntreeCreationFinancement = {
      type: 'comptant',
      organismeId: null,
      referenceContrat: null,
    };

    await service.creer(CTX, PRINCIPAL, DOSSIER_ID, entree, CLE_IDEMPOTENCE);
    expect(insertValuesArgs).toHaveLength(1);
    expect(insertValuesArgs[0]).toMatchObject({
      montantFinanceCentimes: null,
      acompteCentimes: null,
      mensualiteCentimes: null,
      tauxInteretPourmille: null,
      dureeMois: null,
    });
  });
});

describe('ServiceFinancement.creer — persistance du détail monétaire (0042)', () => {
  it('un leasing avec montants persiste les cinq champs tels que saisis, sans les recalculer', async () => {
    const { tx, insertValuesArgs, poserRetourInsert } = txFactice([
      [dossierVenteFixture()],
      [clientLigneFixture()],
    ]);
    poserRetourInsert([{ id: 'fin-1', organismeId: ORGANISME_ID }]);
    const service = serviceFactice(tx);

    const entree: EntreeCreationFinancement = {
      type: 'leasing',
      organismeId: ORGANISME_ID,
      referenceContrat: 'LSG-2026-042',
      montantFinanceCentimes: 2_500_000,
      acompteCentimes: 300_000,
      mensualiteCentimes: 45_000,
      tauxInteretPourmille: 39,
      dureeMois: 48,
    };

    const resultat = await service.creer(CTX, PRINCIPAL, DOSSIER_ID, entree, CLE_IDEMPOTENCE);

    expect(resultat.reponse.statutHttp).toBe(201);
    expect(insertValuesArgs).toHaveLength(1);
    expect(insertValuesArgs[0]).toMatchObject({
      type: 'leasing',
      montantFinanceCentimes: 2_500_000,
      acompteCentimes: 300_000,
      mensualiteCentimes: 45_000,
      tauxInteretPourmille: 39,
      dureeMois: 48,
    });
  });

  it('un crédit sans détail monétaire saisi (proposition initiale) persiste des colonnes NULL, pas zéro', async () => {
    const { tx, insertValuesArgs, poserRetourInsert } = txFactice([
      [dossierVenteFixture()],
      [clientLigneFixture()],
    ]);
    poserRetourInsert([{ id: 'fin-1', organismeId: ORGANISME_ID }]);
    const service = serviceFactice(tx);

    const entree: EntreeCreationFinancement = {
      type: 'credit',
      organismeId: ORGANISME_ID,
      referenceContrat: null,
    };

    await service.creer(CTX, PRINCIPAL, DOSSIER_ID, entree, CLE_IDEMPOTENCE);

    expect(insertValuesArgs[0]).toMatchObject({
      montantFinanceCentimes: null,
      acompteCentimes: null,
      mensualiteCentimes: null,
      tauxInteretPourmille: null,
      dureeMois: null,
    });
  });
});
