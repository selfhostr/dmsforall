/**
 * Profilage de colonnes — ce qui piège au chargement : taux de remplissage réel (NULL, chaîne
 * vide et espaces distingués), format de date réel (texte `aaaa.mm.jj` vu en pratique, pas
 * seulement `jj.mm.aaaa`), dates aberrantes (bug de siècle produisant des années futures).
 *
 * Fonction pure, aucune I/O.
 */
import type { LigneTable, ProfilColonne } from './types';

const RE_DATE_POINTS = /^(\d{1,4})\.(\d{1,2})\.(\d{1,4})$/;

function anneeMaxPlausible(): number {
  return new Date().getUTCFullYear() + 1;
}

interface DetectionDateTexte {
  formatDateDetecte?: 'jj.mm.aaaa' | 'aaaa.mm.jj' | 'inconnu';
  datesAberrantes?: number;
}

function detecterFormatDateTexte(valeurs: readonly string[]): DetectionDateTexte {
  let nbJourMoisAnnee = 0;
  let nbAnneeMoisJour = 0;
  let nbAberrantes = 0;
  let nbCorrespond = 0;
  const anneeMax = anneeMaxPlausible();

  for (const v of valeurs) {
    const m = RE_DATE_POINTS.exec(v);
    if (!m) continue;
    nbCorrespond++;
    const g1 = m[1]!;
    const g3 = m[3]!;
    if (g1.length === 4) {
      nbAnneeMoisJour++;
      const annee = Number(g1);
      if (annee < 1900 || annee > anneeMax) nbAberrantes++;
    } else if (g3.length === 4) {
      nbJourMoisAnnee++;
      const annee = Number(g3);
      if (annee < 1900 || annee > anneeMax) nbAberrantes++;
    }
  }

  if (nbCorrespond === 0) return {};
  const format: DetectionDateTexte['formatDateDetecte'] =
    nbAnneeMoisJour > nbJourMoisAnnee
      ? 'aaaa.mm.jj'
      : nbJourMoisAnnee > nbAnneeMoisJour
        ? 'jj.mm.aaaa'
        : 'inconnu';
  return { formatDateDetecte: format, datesAberrantes: nbAberrantes };
}

function profilerColonne(colonne: string, lignes: readonly LigneTable[]): ProfilColonne {
  let nulls = 0;
  let vides = 0;
  let espacesSeuls = 0;
  let remplis = 0;
  const valeursTexte: string[] = [];

  for (const ligne of lignes) {
    const v = ligne.valeurs[colonne];
    if (v === null || v === undefined) {
      nulls++;
      continue;
    }
    if (typeof v === 'string') {
      if (v.length === 0) {
        vides++;
        continue;
      }
      if (v.trim().length === 0) {
        espacesSeuls++;
        continue;
      }
      remplis++;
      valeursTexte.push(v.trim());
      continue;
    }
    remplis++;
  }

  const total = lignes.length;
  const detection = detecterFormatDateTexte(valeursTexte);

  return {
    colonne,
    total,
    remplis,
    nulls,
    vides,
    espacesSeuls,
    tauxRemplissage: total > 0 ? remplis / total : 0,
    ...detection,
  };
}

/** Profile chaque colonne d'un échantillon de lignes déjà lu. */
export function profilerColonnes(
  nomsColonnes: readonly string[],
  lignes: readonly LigneTable[],
): ProfilColonne[] {
  return nomsColonnes.map((colonne) => profilerColonne(colonne, lignes));
}

function parseDateTexteFrOuIso(v: string): Date | null {
  const trimmed = v.trim();
  const m = RE_DATE_POINTS.exec(trimmed);
  if (m) {
    const g1 = m[1]!;
    const g2 = m[2]!;
    const g3 = m[3]!;
    if (g1.length === 4) return new Date(Date.UTC(Number(g1), Number(g2) - 1, Number(g3)));
    if (g3.length === 4) return new Date(Date.UTC(Number(g3), Number(g2) - 1, Number(g1)));
    return null;
  }
  const iso = Date.parse(trimmed);
  return Number.isNaN(iso) ? null : new Date(iso);
}

/**
 * Date la plus récente et plausible observée sur un échantillon de table, tous types de colonnes
 * confondus (`Date` natives DBF/Access, ou texte `jj.mm.aaaa`/`aaaa.mm.jj`/ISO). Exclut les dates
 * aberrantes (avant 1900, ou au-delà de l'année courante + 1 — signature d'un bug de siècle)
 * plutôt que de les laisser fausser une estimation de fraîcheur.
 *
 * Mesuré sur échantillon borné (celui déjà lu par l'appelant, pas un balayage complet de la
 * table) : c'est une estimation, documentée comme telle dans le rapport de livraison.
 */
export function dateMaxPlausibleTable(
  nomsColonnes: readonly string[],
  lignes: readonly LigneTable[],
): Date | null {
  const anneeMax = anneeMaxPlausible();
  let max: Date | null = null;
  for (const colonne of nomsColonnes) {
    for (const ligne of lignes) {
      const v = ligne.valeurs[colonne];
      let date: Date | null = null;
      if (v instanceof Date) date = v;
      else if (typeof v === 'string') date = parseDateTexteFrOuIso(v);
      if (!date || Number.isNaN(date.getTime())) continue;
      const annee = date.getUTCFullYear();
      if (annee < 1900 || annee > anneeMax) continue;
      if (!max || date.getTime() > max.getTime()) max = date;
    }
  }
  return max;
}
