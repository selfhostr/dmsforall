/**
 * Décomposition d'une `EcritureExport` (N lignes, cœur DFA) en lignes WinBIZ SIMPLES — un débit,
 * un crédit, un montant (`EF-14` point 1 : « le canal écritures n'importe pas les écritures
 * multi-lignes »).
 *
 * ## Le motif « étoile », et pourquoi c'est la seule forme décomposée sans deviner
 *
 * Les deux formes réelles produites par la facturation DFA sont, presque toujours, une ligne
 * PIVOT d'un côté (le compte débiteurs pour une facture, le compte financier pour un paiement)
 * et une à N lignes de l'autre côté (les comptes de produit par taux + le compte TVA due, pour
 * une facture ; un seul compte débiteurs, pour un paiement) :
 *
 * - **1 débit × 1 crédit** (paiement simple) → une seule ligne WinBIZ, directement.
 * - **1 débit × N crédits** (facture : débiteurs ▸ {produit(s), TVA due}) → N lignes WinBIZ,
 *   chacune {pivot, ligne[i], montant = ligne[i].montantCentimes}.
 * - **N débits × 1 crédit** (avoir : {produit(s), TVA due} ▸ débiteurs) → symétrique.
 * - **N débits × M crédits** (N > 1 ET M > 1) → **refusé** (`ECRITURE_NON_DECOMPOSABLE`). Il
 *   n'existe alors PAS d'appariement canonique entre les deux ensembles sans en inventer un — et
 *   un appariement inventé fractionnerait potentiellement une ligne qui porte une info TVA,
 *   obligeant à fabriquer un montant de TVA partiel que le cœur n'a jamais calculé (violation
 *   directe de `EF-03`). Cette forme n'est, à la connaissance de cet adaptateur, produite ni par
 *   un document de vente ni par un paiement DFA — si elle apparaît un jour, c'est un signal que
 *   le cœur doit lui-même pré-décomposer avant d'appeler cet adaptateur, pas que celui-ci doit
 *   deviner.
 *
 * Chaque ligne WinBIZ produite porte un `Montant` qui est TOUJOURS, exactement, le
 * `montantCentimes` déjà calculé d'UNE ligne du cœur — jamais une somme, une part ni un
 * arrondi recalculés ici (`EF-03`, `EF-01`).
 */

import type { EcritureExport, LigneEcritureExport } from '@dfa/shared';

import { ErreurExportWinbiz } from './winbiz.erreurs';

/** Une ligne WinBIZ « simple » — un débit, un crédit, un montant, éventuellement adossée à la
 *  ligne du cœur qui porte l'information TVA (`null` si cette ligne ne porte pas de TVA). */
export interface LigneWinbizDecomposee {
  readonly compteDebit: string;
  readonly compteCredit: string;
  readonly montantCentimes: number;
  readonly ligneTva: LigneEcritureExport | null;
  /** La ligne du cœur d'où provient `montantCentimes`, pour le libellé et la traçabilité. */
  readonly ligneSource: LigneEcritureExport;
}

function verifierEcritureNonVide(ecriture: EcritureExport): void {
  if (ecriture.lignes.length === 0) {
    throw new ErreurExportWinbiz(
      'ECRITURE_VIDE',
      `Écriture « ${ecriture.reference} » sans aucune ligne — rien à sérialiser.`,
      ecriture.reference,
    );
  }
}

/**
 * Extrait l'unique élément d'un tableau dont la longueur `=== 1` vient d'être vérifiée par
 * l'appelant. Pur garde-fou de typage (`noUncheckedIndexedAccess` — un accès indexé reste typé
 * `T | undefined` même après un contrôle de longueur externe) : la branche `undefined` est
 * mathématiquement inatteignable ici.
 */
function ligneUnique(lignes: readonly LigneEcritureExport[]): LigneEcritureExport {
  const [premiere] = lignes;
  /* c8 ignore next 3 -- appelé uniquement après un contrôle `.length === 1` par l'appelant. */
  if (premiere === undefined) {
    throw new ErreurExportWinbiz(
      'ECRITURE_DESEQUILIBREE',
      'ligneUnique : tableau vide de façon inattendue.',
    );
  }
  return premiere;
}

/** Résout la ligne TVA d'une paire (pivot, autre) : erreur si le pivot porte lui-même la TVA
 *  (appariement non déterminable), simple passthrough sinon. */
function resoudreLigneTvaPivotVsAutre(
  ecriture: EcritureExport,
  pivot: LigneEcritureExport,
  autre: LigneEcritureExport,
): LigneEcritureExport | null {
  if (pivot.codeTva !== null) {
    throw new ErreurExportWinbiz(
      'LIGNE_PIVOT_PORTE_TVA',
      `Écriture « ${ecriture.reference} » : la ligne pivot (compte ${pivot.compte}) porte ` +
        `elle-même un code TVA (${pivot.codeTva}) — décomposition 1×N non déterminable : ` +
        'quelle ligne doit porter le bloc TVA de la ligne WinBIZ ?',
      ecriture.reference,
    );
  }
  return autre.codeTva !== null ? autre : null;
}

/**
 * Décompose une `EcritureExport` en lignes WinBIZ simples.
 *
 * @throws ErreurExportWinbiz `ECRITURE_VIDE`, `ECRITURE_DESEQUILIBREE`, `ECRITURE_NON_DECOMPOSABLE`,
 *         `LIGNE_PIVOT_PORTE_TVA`, `LIGNES_TVA_CONFLIT`.
 */
export function decomposerEcritureWinbiz(
  ecriture: EcritureExport,
): readonly LigneWinbizDecomposee[] {
  verifierEcritureNonVide(ecriture);

  const debits = ecriture.lignes.filter((l) => l.sens === 'debit');
  const credits = ecriture.lignes.filter((l) => l.sens === 'credit');

  if (debits.length === 0 || credits.length === 0) {
    throw new ErreurExportWinbiz(
      'ECRITURE_DESEQUILIBREE',
      `Écriture « ${ecriture.reference} » : au moins un côté (débit ou crédit) est vide — une ` +
        'écriture équilibrée a toujours au moins une ligne de chaque côté.',
      ecriture.reference,
    );
  }

  // --- Cas 1×1 : une ligne WinBIZ directe. --------------------------------------------------
  if (debits.length === 1 && credits.length === 1) {
    const debit = ligneUnique(debits);
    const credit = ligneUnique(credits);
    if (debit.montantCentimes !== credit.montantCentimes) {
      throw new ErreurExportWinbiz(
        'ECRITURE_DESEQUILIBREE',
        `Écriture « ${ecriture.reference} » : débit (${debit.montantCentimes}) ≠ crédit ` +
          `(${credit.montantCentimes}) — le cœur garantit l'équilibre avant l'appel à ` +
          'l’adaptateur (MD-85) ; cette écriture le viole.',
        ecriture.reference,
      );
    }
    if (debit.codeTva !== null && credit.codeTva !== null && debit.codeTva !== credit.codeTva) {
      throw new ErreurExportWinbiz(
        'LIGNES_TVA_CONFLIT',
        `Écriture « ${ecriture.reference} » : débit et crédit portent chacun un code TVA ` +
          `différent (${debit.codeTva} / ${credit.codeTva}) — aucune des deux n'est choisie ` +
          'arbitrairement.',
        ecriture.reference,
      );
    }
    const ligneTva = debit.codeTva !== null ? debit : credit.codeTva !== null ? credit : null;
    return [
      {
        compteDebit: debit.compte,
        compteCredit: credit.compte,
        montantCentimes: debit.montantCentimes,
        ligneTva,
        ligneSource: ligneTva ?? debit,
      },
    ];
  }

  // --- Cas 1×N ou N×1 : motif étoile. --------------------------------------------------------
  const [pivotSide, pivot, autresLignes] =
    debits.length === 1
      ? (['debit', ligneUnique(debits), credits] as const)
      : credits.length === 1
        ? (['credit', ligneUnique(credits), debits] as const)
        : ([null, null, null] as const);

  if (pivot === null || autresLignes === null) {
    throw new ErreurExportWinbiz(
      'ECRITURE_NON_DECOMPOSABLE',
      `Écriture « ${ecriture.reference} » : ${debits.length} ligne(s) au débit et ` +
        `${credits.length} ligne(s) au crédit — ni 1×1, ni 1×N, ni N×1. Aucun appariement ` +
        'canonique en lignes WinBIZ simples sans en deviner un (EF-14).',
      ecriture.reference,
    );
  }

  const sommeAutres = autresLignes.reduce((somme, l) => somme + l.montantCentimes, 0);
  if (sommeAutres !== pivot.montantCentimes) {
    throw new ErreurExportWinbiz(
      'ECRITURE_DESEQUILIBREE',
      `Écriture « ${ecriture.reference} » : la somme des lignes non-pivot (${sommeAutres}) ne ` +
        `correspond pas au montant du pivot (${pivot.montantCentimes}).`,
      ecriture.reference,
    );
  }

  return autresLignes.map((autre) => {
    const ligneTva = resoudreLigneTvaPivotVsAutre(ecriture, pivot, autre);
    return {
      compteDebit: pivotSide === 'debit' ? pivot.compte : autre.compte,
      compteCredit: pivotSide === 'debit' ? autre.compte : pivot.compte,
      montantCentimes: autre.montantCentimes,
      ligneTva,
      ligneSource: autre,
    };
  });
}
