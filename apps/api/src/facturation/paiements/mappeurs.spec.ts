import { describe, expect, it } from 'vitest';

import type { LigneImputationPaiement, LignePaiement } from '../../db/schema';

import { calculerIssuesDisponibles, calculerMontantNonImputeCentimes, versPaiement } from './mappeurs';

function imputation(champs: Partial<LigneImputationPaiement> = {}): LigneImputationPaiement {
  return {
    id: 'imp-1',
    tenantId: 'tid-1',
    paiementId: 'pmt-1',
    documentId: 'doc-1',
    montantCentimes: 10000n,
    nature: 'reglement',
    imputeLe: new Date('2026-07-29T10:00:00.000Z'),
    imputeParId: null,
    creeLe: new Date('2026-07-29T10:00:00.000Z'),
    ...champs,
  } as LigneImputationPaiement;
}

function ligne(champs: Partial<LignePaiement> = {}): LignePaiement {
  return {
    id: 'pmt-1',
    tenantId: 'tid-1',
    siteId: 'site-1',
    dateValeur: '2026-07-29',
    moyen: 'virement',
    montantCentimes: 20000n,
    devise: 'CHF',
    payeurClientId: null,
    payeurLibelle: 'Client comptoir',
    referenceQr: null,
    identifiantTransactionBanque: null,
    source: 'manuel',
    contrePasseId: null,
    exporteLe: null,
    exportId: null,
    creeParId: null,
    creeLe: new Date('2026-07-29T10:00:00.000Z'),
    modifieLe: new Date('2026-07-29T10:00:00.000Z'),
    ...champs,
  } as LignePaiement;
}

describe('calculerMontantNonImputeCentimes — trop-perçu / avance client (RF-79, MD-57)', () => {
  it('un paiement sans imputation est intégralement non imputé (acompte avant tout document, RF-65)', () => {
    expect(calculerMontantNonImputeCentimes(20000n, [])).toBe(20000n);
  });

  it("un paiement entièrement imputé en 'reglement' n'a plus rien de non imputé", () => {
    expect(calculerMontantNonImputeCentimes(20000n, [imputation({ montantCentimes: 20000n })])).toBe(0n);
  });

  it('CF-11 : virement de 585.60 pour une facture de 566.60 — 19.00 restent non imputés (trop-perçu)', () => {
    const nonImpute = calculerMontantNonImputeCentimes(58560n, [imputation({ montantCentimes: 56660n })]);
    expect(nonImpute).toBe(1900n);
  });

  it("seule la nature 'reglement' réduit le non-imputé — un 'arrondi'/'compensation' du même paiement ne le réduit pas (formule littérale du contrat gelé)", () => {
    const imputations = [
      imputation({ montantCentimes: 10000n, nature: 'reglement' }),
      imputation({ id: 'imp-2', montantCentimes: 500n, nature: 'compensation', documentId: 'doc-regul' }),
    ];
    // montant total 20000, reglement 10000 -> non imputé 10000, PAS 9500.
    expect(calculerMontantNonImputeCentimes(20000n, imputations)).toBe(10000n);
  });

  it('un paiement négatif (remboursement, MD-52) se traite en valeur absolue', () => {
    expect(calculerMontantNonImputeCentimes(-1900n, [])).toBe(1900n);
  });

  it('ne descend jamais sous zéro (filet de sécurité applicatif)', () => {
    // Cas normalement inatteignable (invariant MD-51.b empêche de dépasser le montant en base),
    // mais la fonction de mapping ne doit jamais produire un nombre négatif affiché au comptoir.
    expect(calculerMontantNonImputeCentimes(1000n, [imputation({ montantCentimes: 1500n })])).toBe(0n);
  });
});

describe('calculerIssuesDisponibles — RF-79, trois issues jamais automatiques', () => {
  it('vide quand le paiement est intégralement imputé', () => {
    expect(calculerIssuesDisponibles(0n)).toEqual([]);
  });

  it('les trois issues (remboursement, imputation_future, abandon) dès qu’un reliquat existe', () => {
    expect(calculerIssuesDisponibles(1900n)).toEqual(['remboursement', 'imputation_future', 'abandon']);
  });
});

describe('versPaiement — assemblage de la ressource publique', () => {
  it('un paiement réparti sur plusieurs factures (RF-71) porte toutes ses imputations, dans l’ordre reçu', () => {
    const p = ligne({ montantCentimes: 30000n });
    const imputations = [
      imputation({ id: 'imp-a', documentId: 'doc-A', montantCentimes: 10000n }),
      imputation({ id: 'imp-b', documentId: 'doc-B', montantCentimes: 20000n }),
    ];

    const reponse = versPaiement(p, imputations, new Map());

    expect(reponse.imputations).toHaveLength(2);
    expect(reponse.imputations.map((i) => i.documentId)).toEqual(['doc-A', 'doc-B']);
    expect(reponse.montantNonImputeCentimes).toBe(0);
    expect(reponse.issuesDisponibles).toEqual([]);
  });

  it("résout creePar/imputePar depuis la table de résumés fournie, null si l'identifiant est absent ou introuvable", () => {
    const resumes = new Map([['u-1', { utilisateurId: 'u-1', nomAffiche: 'Claire Dubois' }]]);
    const p = ligne({ creeParId: 'u-1' });
    const imputations = [imputation({ imputeParId: 'u-inconnu' })];

    const reponse = versPaiement(p, imputations, resumes);

    expect(reponse.creePar).toEqual({ utilisateurId: 'u-1', nomAffiche: 'Claire Dubois' });
    expect(reponse.imputations[0]?.imputePar).toBeNull();
  });

  it('un paiement de remboursement (montant négatif) reste correctement signé dans la réponse', () => {
    const p = ligne({ montantCentimes: -1900n, moyen: 'virement', contrePasseId: 'pmt-original' });

    const reponse = versPaiement(p, [], new Map());

    expect(reponse.montantCentimes).toBe(-1900);
    expect(reponse.contrePasseId).toBe('pmt-original');
    expect(reponse.montantNonImputeCentimes).toBe(1900);
  });
});
