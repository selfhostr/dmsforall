/**
 * Référence QR (QRR) — 27 chiffres, dont le dernier est un chiffre de contrôle
 * **modulo 10 récursif**.
 *
 * C'est l'endroit du module où une erreur est à la fois invisible et fatale : un chiffre de
 * contrôle faux produit une référence syntaxiquement parfaite que la banque **rejette**. Le
 * garage ne l'apprend qu'aux réclamations.
 *
 * ⚠️  Le modulo 10 récursif n'est **pas** l'algorithme de Luhn et n'est pas non plus un simple
 * modulo 10 : c'est un automate à report piloté par une table de transition. Toute
 * réimplémentation « de tête » a une chance élevée d'être fausse tout en semblant plausible.
 *
 * Preuve : `reference-qrr.spec.ts` confronte cette implémentation à **treize références
 * publiées** par la suite de tests de `python-stdnum` (`tests/test_ch_esr.doctest`, module
 * `stdnum.ch.esr`) — une implémentation indépendante, dont les jeux de valeurs proviennent de
 * bulletins réels. Un algorithme faux qui se valide lui-même échoue sur ce jeu.
 */

import { ErreurQrFacture } from './erreurs-qr';
import { LONGUEURS_MAX } from './structure';

/**
 * Table de report du modulo 10 récursif (norme des bulletins de versement suisses, reprise
 * telle quelle par la QR-facture). Ne pas « simplifier » : ces dix valeurs sont
 * l'algorithme.
 */
const TABLE_REPORT_MODULO10 = [0, 9, 4, 6, 8, 2, 7, 1, 3, 5] as const;

/** Longueur d'une référence QR complète, chiffre de contrôle compris. */
export const LONGUEUR_REFERENCE_QRR = LONGUEURS_MAX.referenceQrr;

/** Longueur de la partie utile, chiffre de contrôle exclu. */
export const LONGUEUR_BASE_REFERENCE_QRR = LONGUEUR_REFERENCE_QRR - 1;

/**
 * Calcule le chiffre de contrôle modulo 10 récursif d'une suite de chiffres.
 *
 * L'automate : report initial 0 ; pour chaque chiffre `d`,
 * `report ← TABLE[(report + d) mod 10]` ; en fin de course, chiffre de contrôle
 * `(10 − report) mod 10`.
 *
 * Les zéros de tête sont neutres (`TABLE[0] = 0`), ce qui permet de valider indifféremment une
 * référence rognée ou complétée à 27 chiffres.
 *
 * @param chiffres suite de chiffres décimaux, **sans** le chiffre de contrôle.
 */
export function calculerChiffreControleModulo10Recursif(chiffres: string): number {
  let report = 0;

  for (let i = 0; i < chiffres.length; i += 1) {
    const caractere = chiffres.charAt(i);
    const valeur = caractere.charCodeAt(0) - 48; // '0' = 48

    if (valeur < 0 || valeur > 9) {
      throw new ErreurQrFacture(
        'REFERENCE_QRR_INVALIDE',
        `Caractère non numérique « ${caractere} » en position ${i + 1} d'une référence QR.`,
        'reference',
      );
    }

    // `noUncheckedIndexedAccess` : l'index est mathématiquement dans [0..9], mais TypeScript
    // ne peut pas le prouver — d'où le `?? 0`, jamais atteint.
    report = TABLE_REPORT_MODULO10[(report + valeur) % 10] ?? 0;
  }

  return (10 - report) % 10;
}

/** Supprime les espaces (et espaces insécables) d'une référence saisie ou affichée. */
export function normaliserReferenceQrr(reference: string): string {
  return reference.replace(/\s/g, '');
}

/**
 * Construit une référence QR complète (27 chiffres) à partir d'une base quelconque de
 * chiffres — typiquement une concaténation `numéro de client + numéro de facture`, décidée par
 * la couche facturation. La base est **complétée à gauche par des zéros** jusqu'à 26 chiffres,
 * puis suffixée de son chiffre de contrôle.
 *
 * @throws ErreurQrFacture si la base n'est pas numérique, dépasse 26 chiffres, ou produirait
 *         une référence entièrement nulle (interdite par la spécification).
 */
export function construireReferenceQrr(base: string): string {
  const compacte = normaliserReferenceQrr(base);

  if (compacte.length === 0 || !/^\d+$/.test(compacte)) {
    throw new ErreurQrFacture(
      'REFERENCE_QRR_INVALIDE',
      'La base d’une référence QR doit être une suite non vide de chiffres.',
      'reference',
    );
  }

  if (compacte.length > LONGUEUR_BASE_REFERENCE_QRR) {
    throw new ErreurQrFacture(
      'REFERENCE_QRR_INVALIDE',
      `La base d’une référence QR ne peut pas dépasser ${LONGUEUR_BASE_REFERENCE_QRR} chiffres ` +
        `(reçu ${compacte.length}).`,
      'reference',
    );
  }

  const rembourree = compacte.padStart(LONGUEUR_BASE_REFERENCE_QRR, '0');
  const reference = `${rembourree}${calculerChiffreControleModulo10Recursif(rembourree)}`;

  if (/^0+$/.test(reference)) {
    throw new ErreurQrFacture(
      'REFERENCE_QRR_INVALIDE',
      'Une référence QR ne peut pas être composée uniquement de zéros.',
      'reference',
    );
  }

  return reference;
}

/** Vrai si la référence est une QRR valide (27 chiffres, non nulle, chiffre de contrôle juste). */
export function estReferenceQrrValide(reference: string): boolean {
  try {
    validerReferenceQrr(reference);
    return true;
  } catch {
    return false;
  }
}

/**
 * Valide une référence QR et renvoie sa forme compacte (27 chiffres, sans espaces).
 *
 * @throws ErreurQrFacture avec le code `REFERENCE_QRR_INVALIDE`.
 */
export function validerReferenceQrr(reference: string): string {
  const compacte = normaliserReferenceQrr(reference);

  if (compacte.length !== LONGUEUR_REFERENCE_QRR) {
    throw new ErreurQrFacture(
      'REFERENCE_QRR_INVALIDE',
      `Une référence QR compte exactement ${LONGUEUR_REFERENCE_QRR} chiffres ` +
        `(reçu ${compacte.length}).`,
      'reference',
    );
  }

  if (!/^\d+$/.test(compacte)) {
    throw new ErreurQrFacture(
      'REFERENCE_QRR_INVALIDE',
      'Une référence QR est exclusivement numérique.',
      'reference',
    );
  }

  if (/^0+$/.test(compacte)) {
    throw new ErreurQrFacture(
      'REFERENCE_QRR_INVALIDE',
      'Une référence QR ne peut pas être composée uniquement de zéros.',
      'reference',
    );
  }

  const base = compacte.slice(0, LONGUEUR_BASE_REFERENCE_QRR);
  const chiffreFourni = Number(compacte.charAt(LONGUEUR_BASE_REFERENCE_QRR));
  const chiffreAttendu = calculerChiffreControleModulo10Recursif(base);

  if (chiffreFourni !== chiffreAttendu) {
    throw new ErreurQrFacture(
      'REFERENCE_QRR_INVALIDE',
      `Chiffre de contrôle modulo 10 récursif faux : attendu ${chiffreAttendu}, ` +
        `reçu ${chiffreFourni}.`,
      'reference',
    );
  }

  return compacte;
}

/**
 * Présentation lisible d'une référence QR : `XX XXXXX XXXXX XXXXX XXXXX XXXXX`, soit un
 * premier groupe de 2 puis cinq groupes de 5. C'est la forme imprimée sur la section paiement,
 * **jamais** celle encodée dans la charge utile.
 */
export function formaterReferenceQrrPourAffichage(reference: string): string {
  const compacte = validerReferenceQrr(reference);
  const groupes = [compacte.slice(0, 2)];

  for (let debut = 2; debut < compacte.length; debut += 5) {
    groupes.push(compacte.slice(debut, debut + 5));
  }

  return groupes.join(' ');
}
