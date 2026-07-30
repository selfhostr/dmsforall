/**
 * Arithmétique de la chaîne documentaire — TOUT est TTC (§0.2 de `migrations/0010_facturation.sql`,
 * décision de @laupernoe du 29.07.2026, RF-40 révisée). Aucune autre fonction du module `facturation` ne
 * doit arrondir un montant : celle-ci est la SEULE porte d'entrée.
 *
 * ÉCART SIGNALÉ (à faire remonter à expert-facturation/expert-nestjs qui livrera `paiements/` et
 * `export/`) : `docs/modele-documentaire-facturation.md` §3.2 et la spec étape 2 (`RF-33`) affirment
 * que `arrondiCommercial` doit vivre dans `@dfa/shared`, être la SEULE fonction d'arrondi de tout le
 * dépôt, et être appliquée aussi par `paiements/` (escompte, arrondi 5 centimes) et par `export/`
 * (agrégats). Au moment d'écrire ce fichier, `packages/shared/src/` ne contient AUCUN module hors
 * `contrats/` (vérifié : `find packages/shared/src -type f | grep -v contrats` ne rend rien), et mon
 * périmètre d'écriture pour cette tâche est EXCLUSIVEMENT `apps/api/src/facturation/{racine,
 * documents/}` — je n'ai pas le droit d'ajouter un fichier dans `packages/shared`. La fonction est
 * donc implémentée ICI, locale au sous-module `documents/`, sur le MÊME modèle que
 * `atelier/calcul-ligne.ts` (`CalculLigneSimple`, « implémentation intérimaire, à retirer le jour où
 * le vrai module est livré »). Si `paiements/` ou `export/` ont besoin de la même fonction, il faut
 * soit qu'ils importent `arrondiCommercial` d'ici (couplage entre sous-modules `facturation/`,
 * tolérable car même domaine et même agent à l'origine), soit — mieux — qu'un futur geste
 * d'orchestration la déplace vers `@dfa/shared` et que les trois points d'usage soient réalignés en
 * une fois. À ARBITRER PAR L'ORCHESTRATEUR, pas décidé unilatéralement ici.
 */

/**
 * Arrondit `num / den` au plus proche entier ; à égalité, s'éloigne de zéro (« demi éloigné de
 * zéro », `MD-40`). Arithmétique entière exclusivement (`bigint`) — jamais de flottant. `den` DOIT
 * être strictement positif (le signe porté par `num` seul, cohérent avec l'usage : les
 * dénominateurs de ce module sont toujours `1000` ou `1000 + taux`).
 *
 * Copié à l'identique de `docs/modele-documentaire-facturation.md` §3.2 (MD-40) — ne pas réécrire
 * « pour simplifier », la démonstration de correction (CF-02) porte sur CETTE forme précise.
 */
export function arrondiCommercial(num: bigint, den: bigint): bigint {
  if (den <= 0n) {
    throw new Error('arrondiCommercial : le dénominateur doit être strictement positif.');
  }
  return num >= 0n ? (num + den / 2n) / den : -((-num + den / 2n) / den);
}

/** `arrondiCommercial(a × b, den)`, en `bigint` de bout en bout — évite toute perte de précision
 *  d'un produit intermédiaire en `number` (MD-40 : `quantite_millieme × prix_unitaire_centimes` peut
 *  atteindre 10¹⁴ sur une ligne extrême). Rend un `number` : les montants de ligne restent plafonnés
 *  à ±CHF 1'000'000 par `ligne_document_montant_*_chk` (migration §8), très en-deçà de 2⁵³. */
export function foisArrondiCommercial(a: number, b: number, den: number): number {
  return Number(arrondiCommercial(BigInt(a) * BigInt(b), BigInt(den)));
}

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
export function calculerLigneDocument(entree: EntreeCalculLigneDocument): MontantsLigneDocumentCalcules {
  const prix = entree.prixUnitaireTtcCentimes ?? 0;
  const baseCentimes = foisArrondiCommercial(prix, entree.quantiteMillieme, 1000);

  const remiseCentimes =
    entree.remiseMontantCentimes ??
    (entree.remisePourmille ? foisArrondiCommercial(baseCentimes, entree.remisePourmille, 1000) : 0);

  const ttcCentimes = baseCentimes - remiseCentimes - entree.remiseGlobaleRepartieCentimes;
  const tvaCentimes = foisArrondiCommercial(ttcCentimes, entree.tauxTvaPourmille, 1000 + entree.tauxTvaPourmille);
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
  if (remiseGlobalePourmille != null) return foisArrondiCommercial(sommeBaseCentimes, remiseGlobalePourmille, 1000);
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
      const exAequoPlusPetitOrdre = ligne.baseCentimes === cible.baseCentimes && ligne.numeroOrdre < cible.numeroOrdre;
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
export function agregerTvaParTauxRegime(lignes: readonly LigneAAgregerTva[]): readonly VentilationTvaCalculee[] {
  const parClef = new Map<string, { regimeTva: string; tauxTvaPourmille: number; baseCentimes: number; tvaCentimes: number }>();
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
export function calculerTotauxDocument(lignes: readonly { htCentimes: number; tvaCentimes: number; ttcCentimes: number }[]): TotauxDocument {
  return lignes.reduce<TotauxDocument>(
    (acc, l) => ({
      totalHtCentimes: acc.totalHtCentimes + l.htCentimes,
      totalTvaCentimes: acc.totalTvaCentimes + l.tvaCentimes,
      totalTtcCentimes: acc.totalTtcCentimes + l.ttcCentimes,
    }),
    { totalHtCentimes: 0, totalTvaCentimes: 0, totalTtcCentimes: 0 },
  );
}
