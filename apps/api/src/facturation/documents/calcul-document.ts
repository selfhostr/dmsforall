/**
 * Arithmétique de la chaîne documentaire — TOUT est TTC (§0.2 de `migrations/0010_facturation.sql`,
 * décision de conception du 29.07.2026, RF-40 révisée). Aucune autre fonction du module `facturation` ne
 * doit arrondir un montant : `arrondiCommercial`/`foisArrondiCommercial` sont la SEULE porte
 * d'entrée — et vivent maintenant dans `@dfa/shared` (`arithmetique/arrondi-commercial.ts`),
 * réexportées ici pour ne pas casser les imports existants (`export/ecritures/
 * construction-ecriture-paiement.ts`, ce fichier lui-même, leurs tests).
 *
 * ÉCART RÉSOLU (`fix/arrondi-unique`) : `docs/modele-documentaire-facturation.md` §3.2 et `RF-33`
 * demandaient déjà cette fonction unique dans `@dfa/shared` — c'est fait. Ce qui restait, et qui a
 * réellement causé un écart d'un centime en production potentielle, c'est que
 * `atelier/calcul-ligne.ts` (`CalculLigneSimple`) implémentait la MÊME règle avec `Math.round`
 * (flottant, arrondit les demis vers +∞, donc ASYMÉTRIQUE sur un montant négatif) au lieu
 * d'`arrondiCommercial` (bigint, demi éloigné de zéro, symétrique) — et que
 * `atelier/service-facturation-or.ts::inserterLigneDepuisOr` RECALCULAIT via
 * `calculerLigneDocument` une ligne déjà arrondie par `CalculLigneSimple`, appliquant deux règles
 * d'arrondi en cascade au même montant. Les deux sont corrigés : `calcul-ligne.ts` utilise
 * désormais `foisArrondiCommercial`, et `inserterLigneDepuisOr` copie les montants déjà figés de
 * `ligne_or` au lieu de les recalculer (voir `montantsLigneDocumentDepuisLigneOr` dans
 * `service-facturation-or.ts`).
 */
import { arrondiCommercial, foisArrondiCommercial } from '@dfa/shared';

export { arrondiCommercial, foisArrondiCommercial };

/* ------------------------------------------------------------------ */
/* Calcul d'une ligne — pipeline gelé (migration 0010 §8, §0.2)        */
/* ------------------------------------------------------------------ */

export interface EntreeCalculLigneDocument {
  /** `null` UNIQUEMENT pour une ligne `texte` (note libre sans prix). */
  readonly prixUnitaireTtcCentimes: number | null;
  readonly quantiteMillieme: number;
  /** Exclusifs (`MD-41`) — au plus un des deux non nul. */
  readonly remisePourmille: number | null;
  readonly remiseMontantCentimes: number | null;
  /** Part de la remise globale de pied de document déjà ventilée sur cette ligne (`MD-59`/`MD-60`) —
   *  `0` tant que le document est en brouillon (la ventilation n'a lieu qu'à l'émission). */
  readonly remiseGlobaleRepartieCentimes: number;
  readonly tauxTvaPourmille: number;
}

export interface MontantsLigneDocumentCalcules {
  /** Brut avant remise(s), = `prixUnitaireTtcCentimes × quantiteMillieme / 1000` arrondi. Colonne
   *  `ligne_document.base_centimes`. */
  readonly baseCentimes: number;
  readonly htCentimes: number;
  readonly tvaCentimes: number;
  readonly ttcCentimes: number;
}

/**
 * Pipeline TTC-ancré, verbatim de la migration 0010 §8 :
 *
 * ```
 * base  = arrondiCommercial(prixUnitaireTtcCentimes × quantiteMillieme, 1000)
 * remise = remiseMontantCentimes ?? arrondiCommercial(base × remisePourmille, 1000)
 * ttc   = base − remise − remiseGlobaleRepartieCentimes
 * tva   = arrondiCommercial(ttc × tauxTvaPourmille, 1000 + tauxTvaPourmille)
 * ht    = ttc − tva                                   -- RÉSIDU EXACT, jamais recalculé
 * ```
 *
 * `ttc = ht + tva` tient donc TOUJOURS exactement, par construction — c'est l'invariant que
 * `ligne_document_montant_coherent_chk` vérifie en base et que les tests de ce module reprouvent.
 */
export function calculerLigneDocument(
  entree: EntreeCalculLigneDocument,
): MontantsLigneDocumentCalcules {
  const prix = entree.prixUnitaireTtcCentimes ?? 0;
  const baseCentimes = foisArrondiCommercial(prix, entree.quantiteMillieme, 1000);

  const remiseCentimes =
    entree.remiseMontantCentimes ??
    (entree.remisePourmille
      ? foisArrondiCommercial(baseCentimes, entree.remisePourmille, 1000)
      : 0);

  const ttcCentimes = baseCentimes - remiseCentimes - entree.remiseGlobaleRepartieCentimes;
  const tvaCentimes = foisArrondiCommercial(
    ttcCentimes,
    entree.tauxTvaPourmille,
    1000 + entree.tauxTvaPourmille,
  );
  const htCentimes = ttcCentimes - tvaCentimes;

  return { baseCentimes, htCentimes, tvaCentimes, ttcCentimes };
}

/* ------------------------------------------------------------------ */
/* Remise globale — ventilation au prorata (MD-59/MD-60)               */
/* ------------------------------------------------------------------ */

export interface LigneAVentiler {
  readonly id: string;
  readonly numeroOrdre: number;
  readonly baseCentimes: number;
}

/**
 * Résout le montant de remise globale à ventiler : `remiseGlobaleSaisieCentimes` prime si posé,
 * sinon `remiseGlobalePourmille` appliqué à la somme des bases des lignes. Les deux champs sont
 * exclusifs côté schéma zod (`MD-41`) — jamais les deux à la fois ici.
 */
export function resoudreRemiseGlobaleCentimes(
  remiseGlobaleSaisieCentimes: number | null,
  remiseGlobalePourmille: number | null,
  sommeBaseCentimes: number,
): number {
  if (remiseGlobaleSaisieCentimes != null) return remiseGlobaleSaisieCentimes;
  if (remiseGlobalePourmille != null)
    return foisArrondiCommercial(sommeBaseCentimes, remiseGlobalePourmille, 1000);
  return 0;
}

/**
 * Ventile `remiseGlobaleCentimes` sur `lignes` au prorata de leur `baseCentimes` (`MD-59`). Le
 * résidu d'arrondi va à la ligne de plus grande base ; à égalité, à celle dont `numeroOrdre` est le
 * plus petit (`MD-60`, prouvé par `CF-06` : trois lignes de base strictement égale). Rend TOUJOURS
 * une entrée par ligne (0 si `remiseGlobaleCentimes = 0` ou liste vide) — l'appelant peut itérer sans
 * vérifier l'absence de clé.
 *
 * Invariant garanti : `Σ résultat.values() === remiseGlobaleCentimes` (testé en unitaire).
 */
export function ventilerRemiseGlobale(
  lignes: readonly LigneAVentiler[],
  remiseGlobaleCentimes: number,
): ReadonlyMap<string, number> {
  const resultat = new Map<string, number>();
  for (const ligne of lignes) resultat.set(ligne.id, 0);
  if (remiseGlobaleCentimes === 0 || lignes.length === 0) return resultat;

  const sommeBase = lignes.reduce((s, l) => s + l.baseCentimes, 0);

  if (sommeBase === 0) {
    // Aucune base à ventiler au prorata (ex. document ne contenant que des lignes `texte`) : tout
    // part sur la ligne de plus petit numeroOrdre, seul critère encore disponible.
    const premiere = [...lignes].sort((a, b) => a.numeroOrdre - b.numeroOrdre)[0];
    if (premiere) resultat.set(premiere.id, remiseGlobaleCentimes);
    return resultat;
  }

  let sommeParts = 0;
  for (const ligne of lignes) {
    const part = foisArrondiCommercial(remiseGlobaleCentimes, ligne.baseCentimes, sommeBase);
    resultat.set(ligne.id, part);
    sommeParts += part;
  }

  const residu = remiseGlobaleCentimes - sommeParts;
  if (residu !== 0) {
    let cible = lignes[0];
    for (const ligne of lignes) {
      if (!cible) break;
      const plusGrande = ligne.baseCentimes > cible.baseCentimes;
      const exAequoPlusPetitOrdre =
        ligne.baseCentimes === cible.baseCentimes && ligne.numeroOrdre < cible.numeroOrdre;
      if (plusGrande || exAequoPlusPetitOrdre) cible = ligne;
    }
    if (cible) resultat.set(cible.id, (resultat.get(cible.id) ?? 0) + residu);
  }

  return resultat;
}

/* ------------------------------------------------------------------ */
/* Agrégation TVA du document (MD-44/MD-45) et totaux                  */
/* ------------------------------------------------------------------ */

export interface LigneAAgregerTva {
  readonly regimeTva: string;
  readonly tauxTvaPourmille: number;
  readonly htCentimes: number;
  readonly tvaCentimes: number;
}

export interface VentilationTvaCalculee {
  readonly regimeTva: string;
  readonly tauxTvaPourmille: number;
  readonly baseCentimes: number;
  readonly tvaCentimes: number;
}

/** Une entrée par couple `(regimeTva, tauxTvaPourmille)` présent — `MD-44` : la TVA du document est
 *  la somme des TVA de LIGNE, jamais recalculée sur une base agrégée. */
export function agregerTvaParTauxRegime(
  lignes: readonly LigneAAgregerTva[],
): readonly VentilationTvaCalculee[] {
  const parClef = new Map<
    string,
    { regimeTva: string; tauxTvaPourmille: number; baseCentimes: number; tvaCentimes: number }
  >();
  for (const ligne of lignes) {
    const clef = `${ligne.regimeTva}|${String(ligne.tauxTvaPourmille)}`;
    const existant = parClef.get(clef);
    if (existant) {
      existant.baseCentimes += ligne.htCentimes;
      existant.tvaCentimes += ligne.tvaCentimes;
    } else {
      parClef.set(clef, {
        regimeTva: ligne.regimeTva,
        tauxTvaPourmille: ligne.tauxTvaPourmille,
        baseCentimes: ligne.htCentimes,
        tvaCentimes: ligne.tvaCentimes,
      });
    }
  }
  return [...parClef.values()];
}

export interface TotauxDocument {
  readonly totalHtCentimes: number;
  readonly totalTvaCentimes: number;
  readonly totalTtcCentimes: number;
}

/** `total_ttc = total_ht + total_tva` tient par construction : chaque ligne le vérifie déjà. */
export function calculerTotauxDocument(
  lignes: readonly { htCentimes: number; tvaCentimes: number; ttcCentimes: number }[],
): TotauxDocument {
  return lignes.reduce<TotauxDocument>(
    (acc, l) => ({
      totalHtCentimes: acc.totalHtCentimes + l.htCentimes,
      totalTvaCentimes: acc.totalTvaCentimes + l.tvaCentimes,
      totalTtcCentimes: acc.totalTtcCentimes + l.ttcCentimes,
    }),
    { totalHtCentimes: 0, totalTvaCentimes: 0, totalTtcCentimes: 0 },
  );
}
