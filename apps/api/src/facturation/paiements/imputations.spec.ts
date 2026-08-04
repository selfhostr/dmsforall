import { describe, expect, it } from 'vitest';
import type { EntreeCreationImputation } from '@dfa/shared';

import type { ContexteTenant, TransactionDfa } from '../../db';
import type { LigneDocumentVente, LigneImputationPaiement, LignePaiement } from '../../db/schema';
import { ErreurMetier } from '../../common/erreurs';

import {
  appliquerCompensationAvance,
  appliquerImputationsLettrage,
  estErreurInvariantImputation,
} from './imputations';

const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'u1', requeteId: null };

function documentFactice(champs: Partial<LigneDocumentVente> = {}): LigneDocumentVente {
  return {
    id: 'doc-1',
    tenantId: 'tid-1',
    siteId: 'site-1',
    typeDocument: 'facture',
    natureFacture: 'ordinaire',
    origine: 'dfa',
    statut: 'emis',
    statutReglement: 'non_regle',
    numero: 'F-000001',
    clientId: 'client-1',
    totalHtCentimes: 18900n,
    totalTvaCentimes: 1531n,
    ecartRepriseCentimes: 0n,
    totalTtcCentimes: 20431n,
    montantRegleCentimes: 0n,
    soldeCentimes: 20431n,
    devise: 'CHF',
    ...champs,
  } as unknown as LigneDocumentVente;
}

function paiementFactice(champs: Partial<LignePaiement> = {}): LignePaiement {
  return {
    id: 'pmt-1',
    tenantId: 'tid-1',
    siteId: 'site-1',
    dateValeur: '2026-07-29',
    moyen: 'especes',
    montantCentimes: 20430n,
    devise: 'CHF',
    payeurClientId: null,
    payeurLibelle: 'Client comptoir',
    ...champs,
  } as unknown as LignePaiement;
}

/**
 * Fausse transaction : `chargerDocumentPourEcriture` consomme, DANS L'ORDRE, les documents de
 * `documents` (un par appel `select().from().where().limit().for('update')`) ; `execute()` sert
 * `chargerArrondiEspecesActif` ; `insert().values().returning()` fabrique une `LigneImputationPaiement`
 * à partir des valeurs écrites ; `update().set().where()` capture le recalcul du document.
 */
function txFactice(params: {
  documents: readonly LigneDocumentVente[];
  arrondiEspecesActif?: boolean;
  /** Simule l'échec (déjà enveloppé, forme réelle Drizzle) du prochain `insert().values()` —
   *  utile pour prouver que le filet de sécurité du trigger `imputation_paiement_verifier_invariants`
   *  (ZDFA4) est bien traduit en `IMPUTATION_MONTANT_EXCEDENTAIRE`, pas seulement le pré-contrôle
   *  applicatif. */
  insertError?: unknown;
}) {
  const documentsQueue = [...params.documents];
  const updates: Array<Record<string, unknown>> = [];
  const inserts: Array<Record<string, unknown>> = [];
  let compteurImputation = 0;

  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => ({
            for: () => Promise.resolve([documentsQueue.shift()]),
          }),
        }),
      }),
    }),
    insert: () => ({
      values: (vals: Record<string, unknown>) => {
        if (params.insertError !== undefined) {
          throw params.insertError;
        }
        inserts.push(vals);
        compteurImputation += 1;
        const ligne: LigneImputationPaiement = {
          id: `imp-${compteurImputation}`,
          tenantId: vals.tenantId as string,
          paiementId: vals.paiementId as string,
          documentId: vals.documentId as string,
          montantCentimes: vals.montantCentimes as bigint,
          nature: vals.nature as LigneImputationPaiement['nature'],
          imputeLe: new Date('2026-07-29T10:00:00.000Z'),
          imputeParId: (vals.imputeParId as string | null) ?? null,
          creeLe: new Date('2026-07-29T10:00:00.000Z'),
          exporteLe: null,
          exportId: null,
        };
        return { returning: () => Promise.resolve([ligne]) };
      },
    }),
    update: () => ({
      set: (vals: Record<string, unknown>) => {
        updates.push(vals);
        return { where: () => Promise.resolve(undefined) };
      },
    }),
    execute: () =>
      Promise.resolve({ rows: [{ arrondi_especes_actif: params.arrondiEspecesActif ?? true }] }),
  };

  return { tx: tx as unknown as TransactionDfa, updates, inserts };
}

/**
 * Bug corrigé (audit 2026-08-04) — DOMAINE ARGENT, traité avec le plus grand soin :
 * `estErreurInvariantImputation` testait `erreur.code` au premier niveau, mais Drizzle enveloppe
 * SYSTÉMATIQUEMENT l'erreur `pg` brute dans une `DrizzleQueryError` (`code` sous `.cause`, jamais
 * en surface). Conséquence : le filet de sécurité de DERNIER RECOURS sur MD-51 — le trigger
 * `imputation_paiement_verifier_invariants` (SQLSTATE personnalisé `ZDFA4`) — ne se déclenchait
 * JAMAIS applicativement, et une sur-imputation qui échapperait au pré-contrôle applicatif (bug,
 * course concurrente sur le verrou `for update`, …) fuyait en 500 `ERREUR_INTERNE` au lieu du 409
 * `IMPUTATION_MONTANT_EXCEDENTAIRE` déjà écrit dans le `catch`. Voir
 * `common/erreurs-pg/remonter-cause-pg.ts`.
 */
describe('estErreurInvariantImputation', () => {
  it('reconnaît un ZDFA4 enveloppé sous .cause (forme réelle Drizzle)', () => {
    const brute = new Error('invariant MD-51 violé') as Error & { code: string };
    brute.code = 'ZDFA4';
    const enveloppee = new Error('Failed query') as Error & { cause: unknown };
    enveloppee.cause = brute;

    expect(estErreurInvariantImputation(enveloppee)).toBe(true);
  });

  it('ne reconnaît pas un autre SQLSTATE enveloppé (ex. 23505, contrainte non concernée)', () => {
    const brute = new Error('duplicate key') as Error & { code: string };
    brute.code = '23505';
    const enveloppee = new Error('Failed query') as Error & { cause: unknown };
    enveloppee.cause = brute;

    expect(estErreurInvariantImputation(enveloppee)).toBe(false);
  });

  it('appliquerImputationsLettrage — le trigger ZDFA4 (filet de dernier recours) rend 409 IMPUTATION_MONTANT_EXCEDENTAIRE, jamais 500', async () => {
    // Pré-contrôle applicatif satisfait (500 <= restant 1000) : seule la voie du trigger (filet de
    // sécurité `for update`, cf. commentaire du `catch` dans imputations.ts) est exercée ici.
    const document = documentFactice({ totalTtcCentimes: 1000n, montantRegleCentimes: 0n });
    const brute = new Error('invariant MD-51 violé') as Error & { code: string };
    brute.code = 'ZDFA4';
    const enveloppee = new Error('Failed query') as Error & { cause: unknown };
    enveloppee.cause = brute;
    const { tx } = txFactice({ documents: [document], insertError: enveloppee });
    const paiement = paiementFactice({ montantCentimes: 500n });

    await expect(
      appliquerImputationsLettrage(tx, CTX, paiement, [
        { documentId: 'doc-1', montantCentimes: 500, nature: 'reglement' },
      ]),
    ).rejects.toMatchObject({ code: 'IMPUTATION_MONTANT_EXCEDENTAIRE' });
  });

  it('appliquerCompensationAvance — le trigger ZDFA4 (filet de dernier recours) rend 409 IMPUTATION_MONTANT_EXCEDENTAIRE, jamais 500', async () => {
    const document = documentFactice({
      id: 'doc-regul',
      totalTtcCentimes: 1000n,
      montantRegleCentimes: 0n,
    });
    const brute = new Error('invariant MD-51 violé') as Error & { code: string };
    brute.code = 'ZDFA4';
    const enveloppee = new Error('Failed query') as Error & { cause: unknown };
    enveloppee.cause = brute;
    const { tx } = txFactice({ documents: [document], insertError: enveloppee });
    const paiementAvance = paiementFactice({ id: 'pmt-avance', montantCentimes: 5000n });

    await expect(
      appliquerCompensationAvance(tx, CTX, paiementAvance, 'doc-regul', 200),
    ).rejects.toMatchObject({ code: 'IMPUTATION_MONTANT_EXCEDENTAIRE' });
  });
});

describe('appliquerImputationsLettrage — arrondi espèces (RF-49 → RF-52)', () => {
  it('204.31 réglé 204.30 en espèces + arrondi +1 ct : solde le document exactement, statut passe à regle (CF-05)', async () => {
    const document = documentFactice({ totalTtcCentimes: 20431n, montantRegleCentimes: 0n });
    const { tx, updates, inserts } = txFactice({ documents: [document] });
    const paiement = paiementFactice({ moyen: 'especes', montantCentimes: 20430n });

    const imputations: EntreeCreationImputation[] = [
      { documentId: 'doc-1', montantCentimes: 20430, nature: 'reglement' },
      { documentId: 'doc-1', montantCentimes: 1, nature: 'arrondi' },
    ];

    const resultat = await appliquerImputationsLettrage(tx, CTX, paiement, imputations);

    expect(resultat).toHaveLength(2);
    expect(inserts.map((i) => i.nature)).toEqual(['reglement', 'arrondi']);
    expect(inserts.map((i) => i.montantCentimes)).toEqual([20430n, 1n]);

    expect(updates).toHaveLength(1);
    expect(updates[0]?.montantRegleCentimes).toBe(20431n);
    expect(updates[0]?.soldeCentimes).toBe(0n);
    expect(updates[0]?.statutReglement).toBe('regle');
  });

  it("rejette l'arrondi sur un moyen autre que 'especes' (carte) — RF-49 littéral", async () => {
    const document = documentFactice({ totalTtcCentimes: 20431n, montantRegleCentimes: 0n });
    const { tx } = txFactice({ documents: [document] });
    const paiement = paiementFactice({ moyen: 'carte', montantCentimes: 20430n });

    const imputations: EntreeCreationImputation[] = [
      { documentId: 'doc-1', montantCentimes: 20430, nature: 'reglement' },
      { documentId: 'doc-1', montantCentimes: 1, nature: 'arrondi' },
    ];

    await expect(
      appliquerImputationsLettrage(tx, CTX, paiement, imputations),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ECHOUEE',
    });
  });

  it("rejette l'arrondi si arrondi_especes_actif est désactivé pour le tenant", async () => {
    const document = documentFactice({ totalTtcCentimes: 20431n, montantRegleCentimes: 0n });
    const { tx } = txFactice({ documents: [document], arrondiEspecesActif: false });
    const paiement = paiementFactice({ moyen: 'especes', montantCentimes: 20430n });

    const imputations: EntreeCreationImputation[] = [
      { documentId: 'doc-1', montantCentimes: 20430, nature: 'reglement' },
      { documentId: 'doc-1', montantCentimes: 1, nature: 'arrondi' },
    ];

    await expect(
      appliquerImputationsLettrage(tx, CTX, paiement, imputations),
    ).rejects.toMatchObject({ code: 'CONFLIT' });
  });

  it("rejette l'arrondi qui ne solde pas exactement le document (reliquat ouvert)", async () => {
    // Total 300, reglement 200 + arrondi 1 -> 201, très loin de solder : refusé.
    const document = documentFactice({ totalTtcCentimes: 300n, montantRegleCentimes: 0n });
    const { tx } = txFactice({ documents: [document] });
    const paiement = paiementFactice({ moyen: 'especes', montantCentimes: 200n });

    const imputations: EntreeCreationImputation[] = [
      { documentId: 'doc-1', montantCentimes: 200, nature: 'reglement' },
      { documentId: 'doc-1', montantCentimes: 1, nature: 'arrondi' },
    ];

    await expect(
      appliquerImputationsLettrage(tx, CTX, paiement, imputations),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ECHOUEE',
    });
  });

  it("rejette un arrondi hors borne de ±2 centimes, même s'il solderait le document", async () => {
    const document = documentFactice({ totalTtcCentimes: 20435n, montantRegleCentimes: 0n });
    const { tx } = txFactice({ documents: [document] });
    const paiement = paiementFactice({ moyen: 'especes', montantCentimes: 20430n });

    const imputations: EntreeCreationImputation[] = [
      { documentId: 'doc-1', montantCentimes: 20430, nature: 'reglement' },
      { documentId: 'doc-1', montantCentimes: 5, nature: 'arrondi' },
    ];

    await expect(
      appliquerImputationsLettrage(tx, CTX, paiement, imputations),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ECHOUEE',
    });
  });
});

describe('appliquerImputationsLettrage — paiement partiel et trop-perçu (MD-51)', () => {
  it('paiement partiel : imputation inférieure au total, statut passe à partiel, solde exact', async () => {
    const document = documentFactice({ totalTtcCentimes: 50000n, montantRegleCentimes: 0n });
    const { tx, updates } = txFactice({ documents: [document] });
    const paiement = paiementFactice({ moyen: 'virement', montantCentimes: 20000n });

    await appliquerImputationsLettrage(tx, CTX, paiement, [
      { documentId: 'doc-1', montantCentimes: 20000, nature: 'reglement' },
    ]);

    expect(updates[0]?.montantRegleCentimes).toBe(20000n);
    expect(updates[0]?.soldeCentimes).toBe(30000n);
    expect(updates[0]?.statutReglement).toBe('partiel');
  });

  it('un deuxième règlement qui solde exactement le reliquat fait passer le statut à regle', async () => {
    // Document déjà partiellement réglé (30000 sur 50000) : le lot vise le reliquat exact (20000).
    const document = documentFactice({ totalTtcCentimes: 50000n, montantRegleCentimes: 30000n });
    const { tx, updates } = txFactice({ documents: [document] });
    const paiement = paiementFactice({ moyen: 'virement', montantCentimes: 20000n });

    await appliquerImputationsLettrage(tx, CTX, paiement, [
      { documentId: 'doc-1', montantCentimes: 20000, nature: 'reglement' },
    ]);

    expect(updates[0]?.montantRegleCentimes).toBe(50000n);
    expect(updates[0]?.soldeCentimes).toBe(0n);
    expect(updates[0]?.statutReglement).toBe('regle');
  });

  it('rejette une imputation qui dépasserait le solde restant du document (MD-51.a, trop-perçu jamais forcé sur le document)', async () => {
    const document = documentFactice({ totalTtcCentimes: 50000n, montantRegleCentimes: 45000n });
    const { tx } = txFactice({ documents: [document] });
    const paiement = paiementFactice({ moyen: 'virement', montantCentimes: 10000n });

    await expect(
      appliquerImputationsLettrage(tx, CTX, paiement, [
        { documentId: 'doc-1', montantCentimes: 10000, nature: 'reglement' },
      ]),
    ).rejects.toMatchObject({ code: 'IMPUTATION_MONTANT_EXCEDENTAIRE' });
  });

  it("rejette un montant d'imputation nul", async () => {
    const document = documentFactice();
    const { tx } = txFactice({ documents: [document] });
    const paiement = paiementFactice();

    await expect(
      appliquerImputationsLettrage(tx, CTX, paiement, [
        { documentId: 'doc-1', montantCentimes: 0, nature: 'reglement' },
      ]),
    ).rejects.toMatchObject({ code: 'VALIDATION_ECHOUEE' });
  });

  it('rejette les natures reservées aux actions dédiées (escompte, perte, compensation) sur le lettrage générique', async () => {
    const document = documentFactice();
    const { tx } = txFactice({ documents: [document] });
    const paiement = paiementFactice();

    await expect(
      appliquerImputationsLettrage(tx, CTX, paiement, [
        { documentId: 'doc-1', montantCentimes: 100, nature: 'escompte' },
      ]),
    ).rejects.toBeInstanceOf(ErreurMetier);
  });
});

describe('appliquerImputationsLettrage — un paiement réparti sur plusieurs factures (RF-71)', () => {
  it('un seul paiement impute deux documents distincts, chacun recalculé indépendamment', async () => {
    const documentA = documentFactice({
      id: 'doc-A',
      totalTtcCentimes: 10000n,
      montantRegleCentimes: 0n,
    });
    const documentB = documentFactice({
      id: 'doc-B',
      totalTtcCentimes: 25000n,
      montantRegleCentimes: 5000n,
    });
    const { tx, updates, inserts } = txFactice({ documents: [documentA, documentB] });
    const paiement = paiementFactice({ moyen: 'virement', montantCentimes: 30000n });

    const imputations: EntreeCreationImputation[] = [
      { documentId: 'doc-A', montantCentimes: 10000, nature: 'reglement' },
      { documentId: 'doc-B', montantCentimes: 20000, nature: 'reglement' },
    ];

    const resultat = await appliquerImputationsLettrage(tx, CTX, paiement, imputations);

    expect(resultat).toHaveLength(2);
    expect(resultat.map((i) => i.documentId)).toEqual(['doc-A', 'doc-B']);
    expect(inserts.every((i) => i.paiementId === 'pmt-1')).toBe(true);

    // Document A : soldé intégralement (10000/10000).
    expect(updates[0]?.montantRegleCentimes).toBe(10000n);
    expect(updates[0]?.statutReglement).toBe('regle');

    // Document B : 5000 déjà réglé + 20000 de ce lot = 25000, soldé aussi.
    expect(updates[1]?.montantRegleCentimes).toBe(25000n);
    expect(updates[1]?.statutReglement).toBe('regle');
  });
});

describe('appliquerCompensationAvance — abandon d’avance (RF-79 issue 3)', () => {
  it("impute l'avance sur le document de régularisation, nature compensation, rattachée au paiement d'avance", async () => {
    const document = documentFactice({
      id: 'doc-regul',
      totalTtcCentimes: 1000n,
      montantRegleCentimes: 800n,
    });
    const { tx, inserts, updates } = txFactice({ documents: [document] });
    const paiementAvance = paiementFactice({ id: 'pmt-avance', montantCentimes: 5000n });

    const ligne = await appliquerCompensationAvance(tx, CTX, paiementAvance, 'doc-regul', 200);

    expect(ligne.nature).toBe('compensation');
    expect(ligne.paiementId).toBe('pmt-avance');
    expect(ligne.documentId).toBe('doc-regul');
    expect(inserts[0]?.nature).toBe('compensation');
    expect(updates[0]?.montantRegleCentimes).toBe(1000n);
    expect(updates[0]?.statutReglement).toBe('regle');
  });

  it('rejette une compensation qui dépasse le solde restant du document de régularisation', async () => {
    const document = documentFactice({
      id: 'doc-regul',
      totalTtcCentimes: 1000n,
      montantRegleCentimes: 950n,
    });
    const { tx } = txFactice({ documents: [document] });
    const paiementAvance = paiementFactice({ id: 'pmt-avance', montantCentimes: 5000n });

    await expect(
      appliquerCompensationAvance(tx, CTX, paiementAvance, 'doc-regul', 200),
    ).rejects.toMatchObject({
      code: 'IMPUTATION_MONTANT_EXCEDENTAIRE',
    });
  });
});
