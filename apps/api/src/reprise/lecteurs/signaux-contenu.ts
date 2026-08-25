/**
 * Détecteurs de motifs mesurables sur le contenu d'une colonne — la brique de base du
 * classement de rôle métier (`detecteur-role.ts`). Chaque détecteur rend un taux
 * d'appariement (0..1) sur les valeurs non vides, jamais un jugement sur le nom de colonne.
 */
import type { LigneTable } from './types';

export interface ResultatSignal {
  /** Fraction des valeurs non vides qui correspondent au motif. */
  taux: number;
  /** Nombre de valeurs non vides examinées (le taux sur 0 valeur n'est pas significatif). */
  effectif: number;
}

const RESULTAT_VIDE: ResultatSignal = { taux: 0, effectif: 0 };

export function valeursTexteColonne(lignes: readonly LigneTable[], colonne: string): string[] {
  const valeurs: string[] = [];
  for (const ligne of lignes) {
    const v = ligne.valeurs[colonne];
    if (v === null || v === undefined || v instanceof Buffer) continue;
    const texte = v instanceof Date ? v.toISOString() : String(v);
    if (texte.trim().length === 0) continue;
    valeurs.push(texte.trim());
  }
  return valeurs;
}

export function valeursNumeriquesColonne(lignes: readonly LigneTable[], colonne: string): number[] {
  const valeurs: number[] = [];
  for (const ligne of lignes) {
    const v = ligne.valeurs[colonne];
    if (typeof v === 'number' && Number.isFinite(v)) valeurs.push(v);
  }
  return valeurs;
}

function evaluerMotif(valeurs: string[], test: (v: string) => boolean): ResultatSignal {
  if (valeurs.length === 0) return RESULTAT_VIDE;
  const nb = valeurs.filter(test).length;
  return { taux: nb / valeurs.length, effectif: valeurs.length };
}

// Châssis / VIN : 17 caractères alphanumériques, alphabet VIN (I, O, Q exclus par la norme).
const RE_CHASSIS = /^[A-HJ-NPR-Z0-9]{17}$/;
export function signalChassis(lignes: readonly LigneTable[], colonne: string): ResultatSignal {
  return evaluerMotif(
    valeursTexteColonne(lignes, colonne).map((v) => v.toUpperCase().replace(/\s+/g, '')),
    (v) => RE_CHASSIS.test(v),
  );
}

// Plaque suisse : 1-2 lettres de canton + 1 à 6 chiffres, séparateur optionnel.
const RE_PLAQUE_CH = /^[A-Z]{2}[ -]?\d{1,6}$/;
export function signalPlaqueSuisse(lignes: readonly LigneTable[], colonne: string): ResultatSignal {
  return evaluerMotif(
    valeursTexteColonne(lignes, colonne).map((v) => v.toUpperCase()),
    (v) => RE_PLAQUE_CH.test(v),
  );
}

// NPA suisse : 4 chiffres, plage postale réellement attribuée (1000-9999 en pratique large).
const RE_NPA = /^\d{4}$/;
export function signalNpaSuisse(lignes: readonly LigneTable[], colonne: string): ResultatSignal {
  return evaluerMotif(valeursTexteColonne(lignes, colonne), (v) => {
    if (!RE_NPA.test(v)) return false;
    const n = Number(v);
    return n >= 1000 && n <= 9999;
  });
}

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;
export function signalEmail(lignes: readonly LigneTable[], colonne: string): ResultatSignal {
  return evaluerMotif(valeursTexteColonne(lignes, colonne), (v) => RE_EMAIL.test(v));
}

// Nom de fichier documentaire : présence d'une extension connue (pièce jointe, scan, PDF...).
const RE_NOM_FICHIER = /\.(pdf|tif{1,2}|jpe?g|png|docx?|xlsx?|msg|eml)$/i;
export function signalNomFichier(lignes: readonly LigneTable[], colonne: string): ResultatSignal {
  return evaluerMotif(valeursTexteColonne(lignes, colonne), (v) => RE_NOM_FICHIER.test(v));
}

/** Montant en centimes plausible : valeur numérique dont la sous-unité (centimes) est entière. */
export function signalMontant(lignes: readonly LigneTable[], colonne: string): ResultatSignal {
  const valeurs = valeursNumeriquesColonne(lignes, colonne);
  if (valeurs.length === 0) return RESULTAT_VIDE;
  const nb = valeurs.filter((v) => {
    const centimes = Math.round(v * 100);
    return Math.abs(centimes / 100 - v) < 1e-6 && Math.abs(v) < 1_000_000;
  }).length;
  return { taux: nb / valeurs.length, effectif: valeurs.length };
}

/** Date plausible : entre 1970 et l'année courante + 1 (au-delà, suspicion de bug de siècle). */
export function signalDatePlausible(
  lignes: readonly LigneTable[],
  colonne: string,
): ResultatSignal {
  const anneeMax = new Date().getUTCFullYear() + 1;
  const valeurs: Date[] = [];
  for (const ligne of lignes) {
    const v = ligne.valeurs[colonne];
    if (v instanceof Date) valeurs.push(v);
  }
  if (valeurs.length === 0) return RESULTAT_VIDE;
  const nb = valeurs.filter(
    (d) => d.getUTCFullYear() >= 1970 && d.getUTCFullYear() <= anneeMax,
  ).length;
  return { taux: nb / valeurs.length, effectif: valeurs.length };
}

/** Colonne "énumération" plausible : peu de valeurs distinctes, fortement répétées (mode de
 * paiement, statut, type...) — signal pour distinguer une table de mouvements d'une table de
 * référence pure. */
export function signalEnumeration(lignes: readonly LigneTable[], colonne: string): ResultatSignal {
  const valeurs = valeursTexteColonne(lignes, colonne);
  if (valeurs.length < 3) return RESULTAT_VIDE;
  const distinctes = new Set(valeurs).size;
  if (distinctes > 15) return { taux: 0, effectif: valeurs.length };
  const tauxRepetition = Math.max(0, Math.min(1, 1 - distinctes / valeurs.length));
  return { taux: tauxRepetition, effectif: valeurs.length };
}

/** Colonne "identifiant" plausible : quasi toutes les valeurs non vides sont distinctes. */
export function signalIdentifiant(lignes: readonly LigneTable[], colonne: string): ResultatSignal {
  const valeurs = valeursTexteColonne(lignes, colonne);
  if (valeurs.length < 2) return RESULTAT_VIDE;
  const distinctes = new Set(valeurs).size;
  return { taux: distinctes / valeurs.length, effectif: valeurs.length };
}

/** Texte libre : longueur moyenne significative (désignation, remarque...), peu de répétition. */
export function signalTexteLibre(lignes: readonly LigneTable[], colonne: string): ResultatSignal {
  const valeurs = valeursTexteColonne(lignes, colonne);
  if (valeurs.length === 0) return RESULTAT_VIDE;
  const longueurMoyenne = valeurs.reduce((s, v) => s + v.length, 0) / valeurs.length;
  const taux = Math.max(0, Math.min(1, (longueurMoyenne - 8) / 30));
  return { taux, effectif: valeurs.length };
}
