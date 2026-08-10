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
 *
 * `avoirs` alimente un DEUXIÈME canal, DISTINCT de `documents` : la nouvelle
 * `verifierDocumentImputable` (`imputations.ts`) interroge, pour un document `annule_par_avoir`,
 * le NUMÉRO de l'avoir qui l'a soldé — un `select({ numero }).from(documentVente).where(...)
 * .limit(1)` SANS `.for('update')`. Le même chaînage `select().from().where().limit()` doit donc
 * pouvoir servir DEUX formes différentes selon qu'il est prolongé par `.for()` ou non — et le
 * distinguo doit être PARESSEUX : `chargerDocumentPourEcriture` appelle aussi `.limit(1)` avant son
 * propre `.for('update')`, donc consommer `avoirsQueue` DÈS `.limit()` volerait l'entrée destinée au
 * VRAI lookup d'avoir (bug reproduit puis corrigé pendant l'écriture de ce fichier). `.limit()` rend
 * donc un objet « thenable » : `.for()` consomme `documentsQueue` et renvoie sa PROPRE Promise (le
 * `then` de l'objet n'est alors jamais invoqué, `await x.limit().for(...)` attend cette Promise-là,
 * pas l'objet) ; `.then()` — invoqué seulement par un `await` DIRECT sur `.limit()`, sans `.for()`
 * — consomme `avoirsQueue` à cet instant seulement.
 */
function txFactice(params: {
  documents: readonly LigneDocumentVente[];
  arrondiEspecesActif?: boolean;
  /** Simule l'échec (déjà enveloppé, forme réelle Drizzle) du prochain `insert().values()` —
   *  utile pour prouver que le filet de sécurité du trigger `imputation_paiement_verifier_invariants`
   *  (ZDFA4) est bien traduit en `IMPUTATION_MONTANT_EXCEDENTAIRE`, pas seulement le pré-contrôle
   *  applicatif. */
  insertError?: unknown;
  /** Numéros d'avoir rendus, DANS L'ORDRE, par le lookup de `verifierDocumentImputable` sur un
   *  document `annule_par_avoir` — voir le commentaire de tête. */
  avoirs?: readonly { readonly numero: string }[];
}) {
  const documentsQueue = [...params.documents];
  const avoirsQueue = [...(params.avoirs ?? [])];
  const updates: Array<Record<string, unknown>> = [];
  const inserts: Array<Record<string, unknown>> = [];
  let compteurImputation = 0;

  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => ({
            for: () => Promise.resolve([documentsQueue.shift()]),
            then: (
              resolve: (valeur: readonly { readonly numero: string }[]) => void,
              reject: (erreur: unknown) => void,
            ) => {
              const avoir = avoirsQueue.shift();
              return Promise.resolve(avoir ? [avoir] : []).then(resolve, reject);
            },
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

describe('cohérence de devise entre le paiement et le document imputé (correctif 2026-08-05)', () => {
  it('paiement CHF sur facture CHF (nominal) : imputation acceptée, solde recalculé', async () => {
    const document = documentFactice({ devise: 'CHF', totalTtcCentimes: 20431n });
    const { tx, updates } = txFactice({ documents: [document] });
    const paiement = paiementFactice({ devise: 'CHF', montantCentimes: 20431n });

    const resultat = await appliquerImputationsLettrage(tx, CTX, paiement, [
      { documentId: 'doc-1', montantCentimes: 20431, nature: 'reglement' },
    ]);

    expect(resultat).toHaveLength(1);
    expect(updates[0]?.montantRegleCentimes).toBe(20431n);
    expect(updates[0]?.statutReglement).toBe('regle');
  });

  it('paiement EUR sur facture EUR (nominal) : imputation acceptée', async () => {
    const document = documentFactice({ devise: 'EUR', totalTtcCentimes: 15000n });
    const { tx, updates } = txFactice({ documents: [document] });
    const paiement = paiementFactice({ devise: 'EUR', montantCentimes: 15000n });

    const resultat = await appliquerImputationsLettrage(tx, CTX, paiement, [
      { documentId: 'doc-1', montantCentimes: 15000, nature: 'reglement' },
    ]);

    expect(resultat).toHaveLength(1);
    expect(updates[0]?.montantRegleCentimes).toBe(15000n);
  });

  it('paiement CHF imputé sur une facture EUR : refusé (IMPUTATION_DEVISE_INCOHERENTE), jamais silencieusement accepté', async () => {
    const document = documentFactice({ devise: 'EUR', totalTtcCentimes: 15000n });
    const { tx, updates, inserts } = txFactice({ documents: [document] });
    const paiement = paiementFactice({ devise: 'CHF', montantCentimes: 15000n });

    await expect(
      appliquerImputationsLettrage(tx, CTX, paiement, [
        { documentId: 'doc-1', montantCentimes: 15000, nature: 'reglement' },
      ]),
    ).rejects.toMatchObject({ code: 'IMPUTATION_DEVISE_INCOHERENTE', status: 409 });

    // Aucune écriture n'a dû partir : le refus intervient AVANT toute insertion/mise à jour.
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it('paiement EUR imputé sur une facture CHF : refusé dans l’autre sens aussi', async () => {
    const document = documentFactice({ devise: 'CHF', totalTtcCentimes: 15000n });
    const { tx } = txFactice({ documents: [document] });
    const paiement = paiementFactice({ devise: 'EUR', montantCentimes: 15000n });

    await expect(
      appliquerImputationsLettrage(tx, CTX, paiement, [
        { documentId: 'doc-1', montantCentimes: 15000, nature: 'reglement' },
      ]),
    ).rejects.toMatchObject({ code: 'IMPUTATION_DEVISE_INCOHERENTE' });
  });

  it('appliquerCompensationAvance — une avance CHF ne peut pas compenser un document de régularisation EUR', async () => {
    const document = documentFactice({
      id: 'doc-regul',
      devise: 'EUR',
      totalTtcCentimes: 1000n,
      montantRegleCentimes: 800n,
    });
    const { tx } = txFactice({ documents: [document] });
    const paiementAvance = paiementFactice({
      id: 'pmt-avance',
      devise: 'CHF',
      montantCentimes: 5000n,
    });

    await expect(
      appliquerCompensationAvance(tx, CTX, paiementAvance, 'doc-regul', 200),
    ).rejects.toMatchObject({ code: 'IMPUTATION_DEVISE_INCOHERENTE' });
  });

  it('appelant historique sans devise explicite (défaut CHF du contrat) imputé sur une facture EUR reprise : refusé explicitement, pas un 500 ni une écriture silencieuse', async () => {
    // Simule le cas décrit par la tâche : un document repris d'un ancien DMS en EUR, et un
    // appelant qui n'envoie pas `devise` — le schéma zod (`schemaDeviseFacturation.default('CHF')`)
    // produit alors un paiement CHF. Le défaut aurait laissé ce règlement s'imputer tel quel sur
    // le document EUR ; il doit maintenant être refusé au même titre qu'un envoi explicite.
    const document = documentFactice({ devise: 'EUR', totalTtcCentimes: 15000n });
    const { tx, inserts } = txFactice({ documents: [document] });
    // `devise` absente de l'entrée : pas modélisé ici (paiementFactice simule la ligne DÉJÀ
    // écrite en base, où `devise` a déjà reçu son défaut 'CHF' via la colonne — voir
    // `schema/facturation/paiement.ts::devise`), donc CHF explicite ici représente fidèlement
    // ce que produirait un appelant historique muet sur la devise.
    const paiement = paiementFactice({ devise: 'CHF', montantCentimes: 15000n });

    await expect(
      appliquerImputationsLettrage(tx, CTX, paiement, [
        { documentId: 'doc-1', montantCentimes: 15000, nature: 'reglement' },
      ]),
    ).rejects.toMatchObject({ code: 'IMPUTATION_DEVISE_INCOHERENTE' });
    expect(inserts).toHaveLength(0);
  });

  it('avance client sans imputation (RF-65) : la devise déclarée à la création n’est pas vérifiée tant qu’aucun document n’est visé', () => {
    // Rien à exercer ici sur `imputations.ts` (aucune fonction de ce module n'est appelée sans
    // document cible) — le test documente l'invariant : `verifierCoherenceDevise` n'intervient
    // que dans `appliquerImputationsLettrage`/`appliquerCompensationAvance`, jamais à la création
    // seule d'un paiement (`service-paiement.ts::creer`, hors périmètre de ce fichier). Une avance
    // CHF créée sans imputation reste donc valide quelle que soit la devise des documents ouverts
    // du client — le contrôle s'appliquera à la première imputation qui la rattache à un document.
    const paiement = paiementFactice({ devise: 'CHF', montantCentimes: 5000n });
    expect(paiement.devise).toBe('CHF');
  });
});

/**
 * Défaut prouvé de bout en bout par un parcours navigateur (2026-08-10) — DOMAINE ARGENT : une
 * facture créditée en TOTALITÉ par un avoir (`statut = 'annule_par_avoir'`, RF-32) restait
 * imputable pour son montant D'ORIGINE. Séquence reproduite : facture CHF 60.00 → avoir total émis
 * → panneau Encaisser la propose encore « reste dû CHF 60.00 » → `POST /paiements` avec une
 * imputation dessus répondait `201 Created` → la facture portait ensuite `statutReglement:
 * 'partiel'`, un vrai encaissement réconcilié contre une créance déjà éteinte. Cause : RF-32
 * (`service-emission.ts` §6) met à jour `statut`/`annule_par_avoir_id` mais NE TOUCHE JAMAIS
 * `statut_reglement`/`solde_centimes` — `documentFactice` ci-dessous simule fidèlement CET état
 * exact : `statut: 'annule_par_avoir'` avec `statutReglement`/`soldeCentimes` D'AVANT l'annulation,
 * inchangés, exactement comme RF-32 les laisse en base.
 */
describe('imputation sur un document dont le statut ne permet plus de règlement (correctif 2026-08-10)', () => {
  it("appliquerImputationsLettrage — refuse une imputation sur une facture 'annule_par_avoir', message nommant l'avoir, AVANT toute écriture", async () => {
    const factureAnnulee = documentFactice({
      id: 'doc-facture-annulee',
      numero: 'F-000002',
      statut: 'annule_par_avoir',
      annuleParAvoirId: 'doc-avoir-1',
      // État D'AVANT l'annulation, jamais nettoyé par RF-32 — reproduit fidèlement le bug : la
      // facture se présente encore comme si elle devait CHF 60.00.
      statutReglement: 'non_regle',
      totalTtcCentimes: 6000n,
      montantRegleCentimes: 0n,
      soldeCentimes: 6000n,
    });
    const { tx, inserts, updates } = txFactice({
      documents: [factureAnnulee],
      avoirs: [{ numero: 'A-000001' }],
    });
    const paiement = paiementFactice({ montantCentimes: 100n });

    await expect(
      appliquerImputationsLettrage(tx, CTX, paiement, [
        { documentId: 'doc-facture-annulee', montantCentimes: 100, nature: 'reglement' },
      ]),
    ).rejects.toMatchObject({
      code: 'IMPUTATION_DOCUMENT_NON_REGLABLE',
      status: 409,
      message: expect.stringContaining("F-000002 a été annulé par l'avoir A-000001"),
    });

    // Refus AVANT toute écriture : ni l'imputation ni le recalcul du document ne doivent partir —
    // c'est exactement le défaut prouvé (le paiement de CHF 1.00 réellement en base sur 2026-00002).
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it("appliquerImputationsLettrage — l'avoir créditeur introuvable (incohérence de données) retombe sur son identifiant brut, jamais une exception non gérée", async () => {
    const factureAnnulee = documentFactice({
      id: 'doc-facture-annulee',
      numero: 'F-000003',
      statut: 'annule_par_avoir',
      annuleParAvoirId: 'doc-avoir-introuvable',
      soldeCentimes: 6000n,
    });
    const { tx } = txFactice({ documents: [factureAnnulee], avoirs: [] });
    const paiement = paiementFactice({ montantCentimes: 100n });

    await expect(
      appliquerImputationsLettrage(tx, CTX, paiement, [
        { documentId: 'doc-facture-annulee', montantCentimes: 100, nature: 'reglement' },
      ]),
    ).rejects.toMatchObject({
      code: 'IMPUTATION_DOCUMENT_NON_REGLABLE',
      message: expect.stringContaining('doc-avoir-introuvable'),
    });
  });

  it("appliquerCompensationAvance — refuse aussi une compensation sur un document de régularisation 'annule_par_avoir'", async () => {
    const documentRegul = documentFactice({
      id: 'doc-regul-annule',
      numero: 'F-000004',
      statut: 'annule_par_avoir',
      annuleParAvoirId: 'doc-avoir-2',
      soldeCentimes: 1000n,
    });
    const { tx, inserts } = txFactice({
      documents: [documentRegul],
      avoirs: [{ numero: 'A-000002' }],
    });
    const paiementAvance = paiementFactice({ id: 'pmt-avance', montantCentimes: 5000n });

    await expect(
      appliquerCompensationAvance(tx, CTX, paiementAvance, 'doc-regul-annule', 200),
    ).rejects.toMatchObject({ code: 'IMPUTATION_DOCUMENT_NON_REGLABLE' });
    expect(inserts).toHaveLength(0);
  });

  it("appliquerImputationsLettrage — refuse aussi un document encore en 'brouillon' (pas de total figé opposable), message générique sans lookup d'avoir", async () => {
    const brouillon = documentFactice({
      id: 'doc-brouillon',
      numero: null,
      statut: 'brouillon',
      annuleParAvoirId: null,
    });
    const { tx, inserts } = txFactice({ documents: [brouillon] });
    const paiement = paiementFactice({ montantCentimes: 100n });

    await expect(
      appliquerImputationsLettrage(tx, CTX, paiement, [
        { documentId: 'doc-brouillon', montantCentimes: 100, nature: 'reglement' },
      ]),
    ).rejects.toMatchObject({
      code: 'IMPUTATION_DOCUMENT_NON_REGLABLE',
      message: expect.stringContaining('"brouillon"'),
    });
    expect(inserts).toHaveLength(0);
  });

  it("un document 'emis' (nominal) reste imputable — non-régression de cette barrière", async () => {
    const document = documentFactice({ statut: 'emis', totalTtcCentimes: 10000n });
    const { tx, updates } = txFactice({ documents: [document] });
    const paiement = paiementFactice({ montantCentimes: 500n });

    await appliquerImputationsLettrage(tx, CTX, paiement, [
      { documentId: 'doc-1', montantCentimes: 500, nature: 'reglement' },
    ]);

    expect(updates[0]?.montantRegleCentimes).toBe(500n);
  });
});

/**
 * Second défaut du MÊME chemin, trouvé par le test d'intégration écrit pour PROUVER le premier
 * correctif ci-dessus (2026-08-10) : la barrière de `statut` laisse passer un avoir ÉMIS (il porte
 * bien `statut: 'emis'`, comme n'importe quelle facture ouverte) — rien d'autre ne s'opposait à ce
 * qu'un `POST /paiements` avec une imputation `reglement` vise DIRECTEMENT un avoir. Tranché par
 * MD-57 (`docs/modele-documentaire-facturation.md` §4.3) : « Ce qu'on ne fait jamais : créer un
 * avoir pour matérialiser un trop-perçu. Un avoir corrige un document, pas un mouvement d'argent. »
 * — `reglement`/`arrondi` sont, à l'inverse d'`escompte`/`perte`/`compensation`, les DEUX SEULES
 * natures où de l'argent circule RÉELLEMENT (MD-51) : les imputer sur un avoir revient à faire
 * *rentrer* un encaissement contre un document qui ne peut, par nature, que faire *sortir* de
 * l'argent du garage.
 */
describe("imputation d'un règlement sur un avoir (second correctif du même défaut, 2026-08-10)", () => {
  it("appliquerImputationsLettrage — refuse une imputation 'reglement' visant un avoir ÉMIS, AVANT toute écriture", async () => {
    const avoir = documentFactice({
      id: 'doc-avoir',
      numero: 'A-000001',
      typeDocument: 'avoir',
      statut: 'emis',
      totalTtcCentimes: -6000n,
      montantRegleCentimes: 0n,
      soldeCentimes: 0n,
    });
    const { tx, inserts, updates } = txFactice({ documents: [avoir] });
    const paiement = paiementFactice({ montantCentimes: 100n });

    await expect(
      appliquerImputationsLettrage(tx, CTX, paiement, [
        { documentId: 'doc-avoir', montantCentimes: 100, nature: 'reglement' },
      ]),
    ).rejects.toMatchObject({
      code: 'IMPUTATION_DOCUMENT_NON_REGLABLE',
      status: 409,
      message: expect.stringContaining('A-000001 est un avoir'),
    });
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it("appliquerImputationsLettrage — refuse aussi une imputation 'arrondi' visant un avoir (même raison : l'argent circule aussi sur cette nature, MD-49)", async () => {
    const avoir = documentFactice({
      id: 'doc-avoir',
      typeDocument: 'avoir',
      statut: 'emis',
      totalTtcCentimes: -6000n,
    });
    const { tx, inserts } = txFactice({ documents: [avoir] });
    const paiement = paiementFactice({ moyen: 'especes', montantCentimes: 100n });

    await expect(
      appliquerImputationsLettrage(tx, CTX, paiement, [
        { documentId: 'doc-avoir', montantCentimes: 1, nature: 'arrondi' },
      ]),
    ).rejects.toMatchObject({ code: 'IMPUTATION_DOCUMENT_NON_REGLABLE' });
    expect(inserts).toHaveLength(0);
  });

  it("appliquerImputationsLettrage — un lot visant un avoir AVANT une facture légitime rejette dès l'avoir, sans jamais atteindre la facture", async () => {
    const avoir = documentFactice({
      id: 'doc-avoir',
      typeDocument: 'avoir',
      statut: 'emis',
      totalTtcCentimes: -6000n,
    });
    const facture = documentFactice({
      id: 'doc-facture',
      typeDocument: 'facture',
      statut: 'emis',
      totalTtcCentimes: 10000n,
      montantRegleCentimes: 0n,
    });
    // Ordre [avoir, facture] — DÉLIBÉRÉMENT, pas l'inverse : la garde s'exécute PAR DOCUMENT, à
    // L'INTÉRIEUR de la boucle `for (const [documentId, groupe] of parDocument)`, dans l'ORDRE
    // d'itération du `Map` (celui du premier `documentId` rencontré dans `imputations[]`). Avec
    // l'avoir en tête, ce test prouve honnêtement, sur cette fausse transaction SANS sémantique de
    // rollback, qu'AUCUNE écriture ne part avant le refus — `doc-facture` n'est même jamais atteint.
    // L'inverse (une facture légitime AVANT un avoir dans le même lot) écrirait bien l'imputation de
    // la facture ICI, dans cette boucle ; l'atomicité qui l'annule ensuite vient de la TRANSACTION
    // Postgres englobante (`ServiceIdempotence.executer` → `AccesBase.enTenant`, voir
    // `common/idempotence/service-idempotence.ts`), pas de cette fonction — une fausse `tx` sans
    // `ROLLBACK` ne peut pas prouver cette moitié-là, seul un test d'intégration le peut.
    const { tx, inserts, updates } = txFactice({ documents: [avoir, facture] });
    const paiement = paiementFactice({ montantCentimes: 1000n });

    await expect(
      appliquerImputationsLettrage(tx, CTX, paiement, [
        { documentId: 'doc-avoir', montantCentimes: 100, nature: 'reglement' },
        { documentId: 'doc-facture', montantCentimes: 500, nature: 'reglement' },
      ]),
    ).rejects.toMatchObject({ code: 'IMPUTATION_DOCUMENT_NON_REGLABLE' });

    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it("appliquerCompensationAvance — reste AUTORISÉE sur un avoir : c'est PRÉCISÉMENT l'issue « abandon en faveur du garage » de MD-57, via le document de régularisation explicite (non-régression, cette garde ne s'applique PAS à `compensation`)", async () => {
    const avoir = documentFactice({
      id: 'doc-avoir-regul',
      typeDocument: 'avoir',
      statut: 'emis',
      totalTtcCentimes: -1000n,
      montantRegleCentimes: 0n,
    });
    const { tx, inserts, updates } = txFactice({ documents: [avoir] });
    const paiementAvance = paiementFactice({ id: 'pmt-avance', montantCentimes: 5000n });

    const ligne = await appliquerCompensationAvance(
      tx,
      CTX,
      paiementAvance,
      'doc-avoir-regul',
      200,
    );

    expect(ligne.nature).toBe('compensation');
    expect(inserts[0]?.nature).toBe('compensation');
    expect(updates[0]?.montantRegleCentimes).toBe(200n);
  });

  it('un avoir ENCORE en brouillon reste refusé par la barrière de statut (pas de doublon de raison nécessaire, la barrière de statut suffit déjà)', async () => {
    const avoirBrouillon = documentFactice({
      id: 'doc-avoir-brouillon',
      typeDocument: 'avoir',
      statut: 'brouillon',
      annuleParAvoirId: null,
      totalTtcCentimes: -1000n,
    });
    const { tx } = txFactice({ documents: [avoirBrouillon] });
    const paiement = paiementFactice({ montantCentimes: 100n });

    await expect(
      appliquerImputationsLettrage(tx, CTX, paiement, [
        { documentId: 'doc-avoir-brouillon', montantCentimes: 100, nature: 'reglement' },
      ]),
    ).rejects.toMatchObject({
      code: 'IMPUTATION_DOCUMENT_NON_REGLABLE',
      message: expect.stringContaining('"brouillon"'),
    });
  });

  it("une FACTURE émise (pas un avoir) reste imputable en 'reglement' — non-régression : la nouvelle garde ne touche que `typeDocument === 'avoir'`", async () => {
    const facture = documentFactice({
      id: 'doc-facture',
      typeDocument: 'facture',
      statut: 'emis',
      totalTtcCentimes: 10000n,
      montantRegleCentimes: 0n,
    });
    const { tx, updates } = txFactice({ documents: [facture] });
    const paiement = paiementFactice({ montantCentimes: 500n });

    await appliquerImputationsLettrage(tx, CTX, paiement, [
      { documentId: 'doc-facture', montantCentimes: 500, nature: 'reglement' },
    ]);

    expect(updates[0]?.montantRegleCentimes).toBe(500n);
  });
});

/**
 * Issue #9, GitHub — « un paiement negatif credite une facture ». Reproduction prouvée par le
 * rapporteur : `POST /paiements` avec `montantCentimes: -500` rendait 201 (barrière 1/3, corrigée
 * dans `service-paiement.ts`, empêche désormais ce cas à la création) ; `montantNonImputeCentimes`
 * ressortait à `+500` en valeur absolue (barrière 2/3, corrigée dans `mappeurs.ts`) ; ces 500 ct
 * s'imputaient ensuite sur une vraie facture, réduisant son solde de 10000 à 9500 (statut
 * `partiel`) — RIEN, dans `imputations.ts`, ne vérifiait la cohérence de signe entre le montant du
 * paiement et l'imputation demandée. BARRIÈRE 3/3 : `verifierPaiementImputable` refuse maintenant
 * toute imputation (`reglement`/`arrondi` via `appliquerImputationsLettrage`, `compensation` via
 * `appliquerCompensationAvance`) sur un paiement de montant non positif — le cas qui subsiste même
 * après les deux premières barrières : `POST /paiements/{id}/imputations` ciblant un remboursement
 * DÉJÀ créé légitimement par `rembourser()`.
 */
describe('imputation sur un paiement de montant non positif — issue #9 (barrière 3/3)', () => {
  it(
    'appliquerImputationsLettrage : reproduit exactement le scénario de l’issue — un paiement de ' +
      '-500 ct ne peut PLUS régler une facture de 10000 ct (refus AVANT toute écriture)',
    async () => {
      const document = documentFactice({ totalTtcCentimes: 10000n, montantRegleCentimes: 0n });
      const { tx, inserts, updates } = txFactice({ documents: [document] });
      const paiementRemboursement = paiementFactice({
        id: 'pmt-remb-1',
        montantCentimes: -500n,
        contrePasseId: 'pmt-avance-origine',
      });

      await expect(
        appliquerImputationsLettrage(tx, CTX, paiementRemboursement, [
          { documentId: 'doc-1', montantCentimes: 500, nature: 'reglement' },
        ]),
      ).rejects.toMatchObject({ code: 'IMPUTATION_MONTANT_EXCEDENTAIRE', status: 409 });

      // Le document ne doit avoir été ni chargé pour écriture au-delà du contrôle, ni modifié : la
      // garde intervient AVANT la boucle document-par-document, `restant`/solde ne bougent pas.
      expect(inserts).toHaveLength(0);
      expect(updates).toHaveLength(0);
    },
  );

  it('appliquerImputationsLettrage : refuse aussi une imputation `arrondi` sur un paiement négatif', async () => {
    const document = documentFactice({ totalTtcCentimes: 10000n, montantRegleCentimes: 9999n });
    const { tx, inserts } = txFactice({ documents: [document] });
    const paiementRemboursement = paiementFactice({ montantCentimes: -1n, moyen: 'especes' });

    await expect(
      appliquerImputationsLettrage(tx, CTX, paiementRemboursement, [
        { documentId: 'doc-1', montantCentimes: 1, nature: 'arrondi' },
      ]),
    ).rejects.toMatchObject({ code: 'IMPUTATION_MONTANT_EXCEDENTAIRE' });
    expect(inserts).toHaveLength(0);
  });

  it('appliquerImputationsLettrage : refuse aussi sur un paiement de montant nul (défensif)', async () => {
    const document = documentFactice();
    const { tx } = txFactice({ documents: [document] });
    const paiementNul = paiementFactice({ montantCentimes: 0n });

    await expect(
      appliquerImputationsLettrage(tx, CTX, paiementNul, [
        { documentId: 'doc-1', montantCentimes: 100, nature: 'reglement' },
      ]),
    ).rejects.toMatchObject({ code: 'IMPUTATION_MONTANT_EXCEDENTAIRE' });
  });

  it('appliquerCompensationAvance : refuse une compensation depuis un paiement de remboursement (montant négatif)', async () => {
    const document = documentFactice({
      id: 'doc-regul',
      totalTtcCentimes: 1000n,
      montantRegleCentimes: 800n,
    });
    const { tx, inserts } = txFactice({ documents: [document] });
    const paiementRemboursement = paiementFactice({
      id: 'pmt-remb-2',
      montantCentimes: -5000n,
      contrePasseId: 'pmt-avance-origine',
    });

    await expect(
      appliquerCompensationAvance(tx, CTX, paiementRemboursement, 'doc-regul', 200),
    ).rejects.toMatchObject({ code: 'IMPUTATION_MONTANT_EXCEDENTAIRE' });
    expect(inserts).toHaveLength(0);
  });

  it('un paiement de montant strictement positif reste imputable (non-régression)', async () => {
    const document = documentFactice({ totalTtcCentimes: 10000n, montantRegleCentimes: 0n });
    const { tx, updates } = txFactice({ documents: [document] });
    const paiementEncaissement = paiementFactice({ montantCentimes: 500n });

    await appliquerImputationsLettrage(tx, CTX, paiementEncaissement, [
      { documentId: 'doc-1', montantCentimes: 500, nature: 'reglement' },
    ]);

    expect(updates[0]?.montantRegleCentimes).toBe(500n);
    expect(updates[0]?.statutReglement).toBe('partiel');
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
