/**
 * Erreurs de l'adaptateur WinBIZ.
 *
 * Volontairement **sans dépendance** sur `common/erreurs` ni sur NestJS — même doctrine que
 * `facturation/qr/erreurs-qr.ts` : ce sous-domaine est de l'arithmétique et du formatage purs,
 * testable sans rien démarrer. C'est la couche d'orchestration de l'export (hors périmètre de ce
 * lot, voir `export.module.ts`) qui traduira une `ErreurExportWinbiz` vers `problem+json`.
 */

export const CODES_ERREUR_EXPORT_WINBIZ = [
  /** Une `EcritureExport` sans aucune ligne — rien à sérialiser. */
  'ECRITURE_VIDE',
  /**
   * `Σ débits ≠ Σ crédits` sur une écriture reçue. Ne devrait JAMAIS survenir : le cœur garantit
   * l'équilibre avant d'appeler l'adaptateur (`MD-85`). Ce garde-fou existe pour refuser
   * bruyamment plutôt que produire un CSV WinBIZ silencieusement déséquilibré si cette garantie
   * amont est un jour violée.
   */
  'ECRITURE_DESEQUILIBREE',
  /**
   * Le canal « import d'écritures » de WinBIZ n'admet que des lignes SIMPLES — un débit, un
   * crédit (`EF-14` point 1). Cette écriture a plusieurs lignes des DEUX côtés (ni 1×N, ni N×1,
   * ni 1×1) : la décomposition en écritures simples n'est pas déterminable sans deviner un
   * appariement, ce que cet adaptateur refuse de faire.
   */
  'ECRITURE_NON_DECOMPOSABLE',
  /**
   * La ligne « pivot » d'une décomposition 1×N (typiquement le compte débiteurs ou le compte
   * financier) porte elle-même un code TVA — situation inattendue pour laquelle l'appariement
   * 1×N décrit dans `winbiz-decomposition.ts` ne sait pas quelle ligne doit porter le bloc TVA
   * de la ligne WinBIZ produite.
   */
  'LIGNE_PIVOT_PORTE_TVA',
  /**
   * Cas 1×1 où les DEUX lignes portent un code TVA différent — l'adaptateur ne choisit pas
   * arbitrairement laquelle représenter dans le bloc TVA de la ligne WinBIZ.
   */
  'LIGNES_TVA_CONFLIT',
  /** Deux écritures du même lot portent le même `documentId` non nul — export en double. */
  'ECRITURE_DOUBLON',
  /** Date absente ou dont le format ne correspond pas à `aaaa-mm-jj` (`schemaDateJour`). */
  'DATE_INVALIDE',
  /** Montant non entier, hors bornes, ou négatif reçu là où seul un montant positif est admis. */
  'MONTANT_INVALIDE',
  /**
   * Numéro de compte vide ou plus long que les 12 caractères admis par `Cpt_debit`/`Cpt_credit`
   * (`EF-13`). Signale un `mapping_compte` mal saisi — cet adaptateur refuse plutôt que de
   * tronquer un numéro de compte, ce qui changerait de compte sans le dire.
   */
  'COMPTE_INVALIDE',
  /** Lot vide : aucune écriture à exporter. */
  'LOT_VIDE',
  /** Une ligne porte un `codeTva` non nul mais un `tauxPourmille` (ou une autre donnée TVA
   *  attendue) manquant — incohérence du contrat en amont, pas quelque chose que cet adaptateur
   *  peut deviner ou corriger. */
  'DONNEE_TVA_INCOMPLETE',
] as const;

export type CodeErreurExportWinbiz = (typeof CODES_ERREUR_EXPORT_WINBIZ)[number];

export class ErreurExportWinbiz extends Error {
  readonly code: CodeErreurExportWinbiz;
  /** Référence de l'écriture fautive (`EcritureExport.reference`), quand identifiable. */
  readonly reference?: string;

  constructor(code: CodeErreurExportWinbiz, message: string, reference?: string) {
    super(message);
    this.name = 'ErreurExportWinbiz';
    this.code = code;
    if (reference !== undefined) {
      this.reference = reference;
    }
  }
}
