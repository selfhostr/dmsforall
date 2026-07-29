/**
 * Erreurs du sous-domaine QR-facture.
 *
 * Volontairement **sans dépendance** sur `common/erreurs` ni sur `@dfa/shared` : ce module est
 * de l'arithmétique et du formatage purs, il doit rester testable et réutilisable (worker de
 * rendu, futur paquet partagé) sans traîner NestJS derrière lui. C'est la couche service de
 * facturation qui traduit une `ErreurQrFacture` en `ErreurMetier` / `problem+json`.
 */

export const CODES_ERREUR_QR = [
  /** IBAN absent, mal formé, ou dont la clé de contrôle ISO 7064 est fausse. */
  'IBAN_INVALIDE',
  /** QR-IBAN sans référence QRR, ou IBAN ordinaire avec une référence QRR (`RF-55`). */
  'TYPE_REFERENCE_INCOMPATIBLE_IBAN',
  /** Référence QRR mal formée ou chiffre de contrôle modulo 10 récursif faux. */
  'REFERENCE_QRR_INVALIDE',
  /** Référence SCOR mal formée ou clé de contrôle mod 97-10 fausse. */
  'REFERENCE_SCOR_INVALIDE',
  /** Bloc créancier incomplet — l'émission est refusée (`RF-54`, `PF-03`). */
  'CREANCIER_INCOMPLET',
  /** Devise hors CHF/EUR. */
  'DEVISE_NON_ADMISE',
  /** Montant hors bornes, non entier, ou non représentable. */
  'MONTANT_INVALIDE',
  /** Un champ dépasse la longueur maximale de la spécification. */
  'CHAMP_TROP_LONG',
  /**
   * Un champ contient CR, LF ou un caractère de contrôle. Refus **catégorique** : un `\r\n`
   * dans un champ insère un élément et décale tout ce qui suit — c'est une injection de
   * structure, pas une coquetterie de formatage.
   */
  'CHAMP_CARACTERE_INTERDIT',
  /** La charge utile dépasse 997 caractères. */
  'PAYLOAD_TROP_LONG',
  /** Plus de deux procédures alternatives. */
  'TROP_DE_PROCEDURES_ALTERNATIVES',
  /**
   * Garde-fou interne : le nombre d'éléments produits ne correspond pas au décompte attendu.
   * Ne devrait jamais survenir — si cette erreur apparaît, l'encodeur est cassé et il vaut
   * infiniment mieux refuser d'émettre que produire un QR décalé.
   */
  'DECOMPTE_ELEMENTS_INCOHERENT',
] as const;

export type CodeErreurQr = (typeof CODES_ERREUR_QR)[number];

export class ErreurQrFacture extends Error {
  readonly code: CodeErreurQr;
  /** Nom du champ fautif, quand il est identifiable (pour l'affichage « nommer le manquant »). */
  readonly champ?: string;

  constructor(code: CodeErreurQr, message: string, champ?: string) {
    super(message);
    this.name = 'ErreurQrFacture';
    this.code = code;
    if (champ !== undefined) {
      this.champ = champ;
    }
  }
}
