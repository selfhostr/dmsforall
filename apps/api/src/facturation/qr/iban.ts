/**
 * IBAN et QR-IBAN du créancier.
 *
 * Enjeu métier : **le type de référence découle du type d'IBAN, il n'est jamais un choix**
 * (`RF-55`). Un QR-IBAN impose une référence QRR ; un IBAN ordinaire interdit QRR et n'admet
 * que SCOR ou aucune référence. Se tromper de couple produit un bulletin refusé par la banque
 * du garage, pas par celle du client — donc découvert tard et par le mauvais bout.
 *
 * Un QR-IBAN se reconnaît à son **IID** (identifiant d'institut financier), les cinq chiffres
 * qui suivent la clé de contrôle, lorsqu'il tombe dans la plage réservée **30000–31999**.
 */

import { ErreurQrFacture } from './erreurs-qr';
import { resteModulo97 } from './modulo97';
import { LONGUEURS_MAX, type TypeReference } from './structure';

/** Borne basse de la plage d'IID réservée aux QR-IBAN. */
export const IID_QR_IBAN_MIN = 30_000;

/** Borne haute (incluse) de la plage d'IID réservée aux QR-IBAN. */
export const IID_QR_IBAN_MAX = 31_999;

/** Longueur d'un IBAN suisse ou liechtensteinois. */
export const LONGUEUR_IBAN_CH_LI = LONGUEURS_MAX.iban;

/** Codes pays admis pour le compte du créancier d'une QR-facture. */
export const PAYS_IBAN_ADMIS = ['CH', 'LI'] as const;

/** Supprime espaces et met en majuscules. */
export function normaliserIban(iban: string): string {
  return iban.replace(/\s/g, '').toUpperCase();
}

/**
 * Valide l'IBAN du créancier et renvoie sa forme compacte (21 caractères, sans espaces) —
 * c'est cette forme-là qui entre dans la charge utile.
 *
 * @throws ErreurQrFacture `IBAN_INVALIDE`.
 */
export function validerIbanCreancier(iban: string): string {
  const compact = normaliserIban(iban);

  if (!/^[A-Z]{2}\d{2}[0-9A-Z]+$/.test(compact)) {
    throw new ErreurQrFacture(
      'IBAN_INVALIDE',
      'IBAN mal formé : deux lettres de pays, deux chiffres de contrôle, puis alphanumérique.',
      'ibanCreancier',
    );
  }

  const pays = compact.slice(0, 2);
  if (!(PAYS_IBAN_ADMIS as readonly string[]).includes(pays)) {
    throw new ErreurQrFacture(
      'IBAN_INVALIDE',
      `Le compte d’une QR-facture doit être un IBAN suisse ou liechtensteinois (reçu « ${pays} »).`,
      'ibanCreancier',
    );
  }

  if (compact.length !== LONGUEUR_IBAN_CH_LI) {
    throw new ErreurQrFacture(
      'IBAN_INVALIDE',
      `Un IBAN ${pays} compte ${LONGUEUR_IBAN_CH_LI} caractères (reçu ${compact.length}).`,
      'ibanCreancier',
    );
  }

  // ISO 13616 : les quatre premiers caractères passent à la fin, le reste mod 97 doit valoir 1.
  if (resteModulo97(`${compact.slice(4)}${compact.slice(0, 4)}`) !== 1) {
    throw new ErreurQrFacture(
      'IBAN_INVALIDE',
      'Clé de contrôle IBAN (ISO 7064 mod 97-10) fausse — l’IBAN a été mal saisi.',
      'ibanCreancier',
    );
  }

  return compact;
}

/**
 * IID du compte : les cinq chiffres suivant la clé de contrôle. L'IBAN est supposé déjà validé
 * par {@link validerIbanCreancier}.
 */
export function extraireIid(ibanValide: string): number {
  return Number(normaliserIban(ibanValide).slice(4, 9));
}

/** Vrai si l'IBAN est un QR-IBAN (IID dans la plage 30000–31999). */
export function estQrIban(ibanValide: string): boolean {
  const iid = extraireIid(ibanValide);
  return iid >= IID_QR_IBAN_MIN && iid <= IID_QR_IBAN_MAX;
}

/**
 * Détermine le type de référence imposé par l'IBAN et vérifie que la référence fournie lui
 * correspond (`RF-55`). Renvoie le type retenu et la référence sous sa forme canonique
 * (compacte) telle qu'elle doit entrer dans la charge utile.
 *
 * | IBAN du garage | Référence exigée | Interdit |
 * |---|---|---|
 * | QR-IBAN (IID 30000–31999) | QRR, obligatoire | SCOR, aucune |
 * | IBAN ordinaire | SCOR **ou** aucune | QRR |
 *
 * @throws ErreurQrFacture `TYPE_REFERENCE_INCOMPATIBLE_IBAN`, `REFERENCE_QRR_INVALIDE`,
 *         `REFERENCE_SCOR_INVALIDE`.
 */
export function determinerTypeReference(
  ibanValide: string,
  reference: string | null | undefined,
  outils: {
    validerQrr: (reference: string) => string;
    validerScor: (reference: string) => string;
  },
): { type: TypeReference; reference: string } {
  const brute = (reference ?? '').trim();

  if (estQrIban(ibanValide)) {
    if (brute.length === 0) {
      throw new ErreurQrFacture(
        'TYPE_REFERENCE_INCOMPATIBLE_IBAN',
        'Un QR-IBAN exige une référence QR (QRR) : une facture sans référence serait impayable.',
        'reference',
      );
    }

    if (/^RF/i.test(brute)) {
      throw new ErreurQrFacture(
        'TYPE_REFERENCE_INCOMPATIBLE_IBAN',
        'Un QR-IBAN interdit la référence SCOR : la référence doit être une QRR de 27 chiffres.',
        'reference',
      );
    }

    return { type: 'QRR', reference: outils.validerQrr(brute) };
  }

  if (brute.length === 0) {
    return { type: 'NON', reference: '' };
  }

  if (/^\d+$/.test(brute.replace(/\s/g, ''))) {
    throw new ErreurQrFacture(
      'TYPE_REFERENCE_INCOMPATIBLE_IBAN',
      'Un IBAN ordinaire interdit la référence QR (QRR) : utiliser une référence SCOR (RF…) ' +
        'ou aucune référence.',
      'reference',
    );
  }

  return { type: 'SCOR', reference: outils.validerScor(brute) };
}
