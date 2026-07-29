/**
 * Montant de la QR-facture.
 *
 * **En interne, un montant est toujours un entier de centimes.** Le format « 1949.75 » attendu
 * par la charge utile n'existe qu'ici, au dernier moment, produit par division entière — jamais
 * par `(centimes / 100).toFixed(2)`, dont l'arrondi binaire finirait par produire un centime de
 * décalage entre le total imprimé et le total encodé dans le QR. Ce centime-là serait invisible
 * en test et scandaleux en production.
 *
 * Le montant est **facultatif** (`RF-57`) : un QR sans montant est valide, le payeur le saisit.
 * On distingue donc explicitement « pas de montant » (champ vide) de « montant nul » (refusé).
 */

import { ErreurQrFacture } from './erreurs-qr';
import {
  DEVISES_ADMISES,
  LONGUEURS_MAX,
  MONTANT_MAX_CENTIMES,
  MONTANT_MIN_CENTIMES,
  type DeviseQr,
} from './structure';

/**
 * Formate un montant en centimes vers la représentation de la charge utile : point décimal,
 * exactement deux décimales, aucun séparateur de milliers, aucun signe.
 *
 * `56660` → `"566.60"` ; `100` → `"1.00"` ; `99999999999` → `"999999999.99"`.
 *
 * @throws ErreurQrFacture `MONTANT_INVALIDE` si le montant n'est pas un entier sûr ou sort des
 *         bornes 0.01 … 999'999'999.99.
 */
export function formaterMontantPayload(centimes: number): string {
  if (!Number.isSafeInteger(centimes)) {
    throw new ErreurQrFacture(
      'MONTANT_INVALIDE',
      `Un montant est un entier de centimes (reçu ${String(centimes)}).`,
      'montant',
    );
  }

  if (centimes < MONTANT_MIN_CENTIMES || centimes > MONTANT_MAX_CENTIMES) {
    throw new ErreurQrFacture(
      'MONTANT_INVALIDE',
      `Montant hors bornes : ${MONTANT_MIN_CENTIMES} à ${MONTANT_MAX_CENTIMES} centimes ` +
        `(reçu ${centimes}).`,
      'montant',
    );
  }

  // Division entière + reste : aucun flottant n'intervient.
  const francs = Math.trunc(centimes / 100);
  const reste = centimes - francs * 100;
  const formate = `${francs}.${String(reste).padStart(2, '0')}`;

  /* c8 ignore next 8 -- inatteignable tant que MONTANT_MAX_CENTIMES tient sur 12 caractères ;
     le garde-fou existe pour le jour où quelqu'un relèvera la borne. */
  if (formate.length > LONGUEURS_MAX.montant) {
    throw new ErreurQrFacture(
      'MONTANT_INVALIDE',
      `Le montant formaté dépasse ${LONGUEURS_MAX.montant} caractères (« ${formate} »).`,
      'montant',
    );
  }

  return formate;
}

/**
 * Valeur du champ `QRCH/CcyAmt/Amt` : chaîne vide quand aucun montant n'est imposé au payeur.
 *
 * `null` et `undefined` signifient « QR sans montant ». `0` est **refusé** : une facture à zéro
 * n'a pas à porter une section paiement, et l'accepter ici masquerait un bug de calcul en
 * amont.
 */
export function encoderMontantOptionnel(centimes: number | null | undefined): string {
  if (centimes === null || centimes === undefined) {
    return '';
  }

  return formaterMontantPayload(centimes);
}

/**
 * Valide la devise. Hors CHF/EUR, il n'y a pas de section paiement QR du tout — la facture
 * porte les coordonnées bancaires en clair (`RF-58`), décision qui appartient à la couche
 * facturation, pas à l'encodeur.
 *
 * @throws ErreurQrFacture `DEVISE_NON_ADMISE`.
 */
export function validerDevise(devise: string): DeviseQr {
  const majuscule = devise.trim().toUpperCase();

  if (!(DEVISES_ADMISES as readonly string[]).includes(majuscule)) {
    throw new ErreurQrFacture(
      'DEVISE_NON_ADMISE',
      `Devise « ${devise} » non admise par la QR-facture (CHF ou EUR uniquement).`,
      'devise',
    );
  }

  return majuscule as DeviseQr;
}
