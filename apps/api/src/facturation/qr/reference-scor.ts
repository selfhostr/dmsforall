/**
 * Référence Creditor (SCOR) — ISO 11649, clé de contrôle **ISO 7064 mod 97-10**.
 *
 * Forme : `RF` + 2 chiffres de contrôle + 1 à 21 caractères alphanumériques, 25 caractères au
 * maximum. C'est le type de référence des IBAN **ordinaires** ; un QR-IBAN impose QRR
 * (`RF-55`).
 *
 * Attention au piège classique : la clé se calcule sur la chaîne **réarrangée** (référence
 * d'abord, `RF` et la clé ensuite), pas sur la chaîne telle qu'elle s'écrit. Une implémentation
 * qui calcule sur la chaîne en ordre naturel produit des références plausibles et fausses.
 */

import { ErreurQrFacture } from './erreurs-qr';
import { resteModulo97 } from './modulo97';
import { LONGUEURS_MAX } from './structure';

/** Longueur maximale d'une référence SCOR, `RF` et clé compris. */
export const LONGUEUR_MAX_REFERENCE_SCOR = LONGUEURS_MAX.referenceScor;

/** Longueur maximale de la partie utile (hors `RF` et hors les deux chiffres de contrôle). */
export const LONGUEUR_MAX_BASE_REFERENCE_SCOR = LONGUEUR_MAX_REFERENCE_SCOR - 4;

/** Supprime espaces et met en majuscules. */
export function normaliserReferenceScor(reference: string): string {
  return reference.replace(/\s/g, '').toUpperCase();
}

/**
 * Construit une référence SCOR à partir d'une base alphanumérique (typiquement le numéro de
 * facture, ex. `2026-00424` → `202600424`).
 *
 * @throws ErreurQrFacture si la base est vide, non alphanumérique, ou trop longue.
 */
export function construireReferenceScor(base: string): string {
  const compacte = normaliserReferenceScor(base);

  if (compacte.length === 0 || !/^[0-9A-Z]+$/.test(compacte)) {
    throw new ErreurQrFacture(
      'REFERENCE_SCOR_INVALIDE',
      'La base d’une référence SCOR doit être une suite non vide de caractères alphanumériques.',
      'reference',
    );
  }

  if (compacte.length > LONGUEUR_MAX_BASE_REFERENCE_SCOR) {
    throw new ErreurQrFacture(
      'REFERENCE_SCOR_INVALIDE',
      `La base d’une référence SCOR ne peut pas dépasser ${LONGUEUR_MAX_BASE_REFERENCE_SCOR} ` +
        `caractères (reçu ${compacte.length}).`,
      'reference',
    );
  }

  // Réarrangement ISO 11649 : base + "RF00", puis clé = 98 − (reste mod 97).
  const cle = 98 - resteModulo97(`${compacte}RF00`);

  return `RF${String(cle).padStart(2, '0')}${compacte}`;
}

/** Vrai si la référence est une SCOR valide. */
export function estReferenceScorValide(reference: string): boolean {
  try {
    validerReferenceScor(reference);
    return true;
  } catch {
    return false;
  }
}

/**
 * Valide une référence SCOR et renvoie sa forme compacte (majuscules, sans espaces).
 *
 * @throws ErreurQrFacture avec le code `REFERENCE_SCOR_INVALIDE`.
 */
export function validerReferenceScor(reference: string): string {
  const compacte = normaliserReferenceScor(reference);

  if (compacte.length < 5 || compacte.length > LONGUEUR_MAX_REFERENCE_SCOR) {
    throw new ErreurQrFacture(
      'REFERENCE_SCOR_INVALIDE',
      `Une référence SCOR compte de 5 à ${LONGUEUR_MAX_REFERENCE_SCOR} caractères ` +
        `(reçu ${compacte.length}).`,
      'reference',
    );
  }

  if (!/^RF\d{2}[0-9A-Z]+$/.test(compacte)) {
    throw new ErreurQrFacture(
      'REFERENCE_SCOR_INVALIDE',
      'Une référence SCOR s’écrit « RF » + 2 chiffres de contrôle + caractères alphanumériques.',
      'reference',
    );
  }

  // Réarrangement : les 4 premiers caractères (RF + clé) passent à la fin ; le reste modulo 97
  // doit valoir exactement 1.
  if (resteModulo97(`${compacte.slice(4)}${compacte.slice(0, 4)}`) !== 1) {
    throw new ErreurQrFacture(
      'REFERENCE_SCOR_INVALIDE',
      'Clé de contrôle ISO 7064 mod 97-10 fausse.',
      'reference',
    );
  }

  return compacte;
}

/**
 * Présentation lisible d'une référence SCOR : groupes de 4 caractères séparés par une espace
 * (`RF18 5390 0754 7034`). Forme imprimée uniquement — la charge utile porte la forme compacte.
 */
export function formaterReferenceScorPourAffichage(reference: string): string {
  const compacte = validerReferenceScor(reference);
  return (compacte.match(/.{1,4}/g) ?? []).join(' ');
}
