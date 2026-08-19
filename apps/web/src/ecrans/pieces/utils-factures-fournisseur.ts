import type {
  ChampFactureFournisseur,
  ChampsOrigineFactureFournisseur,
  OrigineDonneeFacture,
  ReponseLigneFactureFournisseur,
} from '@dfa/shared';

import { formaterMontant } from '@/lib/formats';

import { formaterQuantiteMillieme } from './utils';

/**
 * Dérivations UI du module « factures fournisseur » — TOUT ce qui suit est calculé CÔTÉ ÉCRAN à
 * partir des formes RÉELLES du contrat (`@dfa/shared/contrats/pieces/facture-fournisseur.ts`,
 * `enums.ts`) : le contrat lui-même ne porte ni certitude à trois états, ni « nature d'écart », ni
 * pourcentage — seulement une origine par champ d'en-tête (`OrigineDonneeFacture`, un des trois
 * moyens de lecture) et un écart CHIFFRÉ par ligne (`EcartLigneFactureFournisseur`, trois deltas en
 * centimes/millièmes). Voir `factures-fournisseur.temporaire.ts` pour ce qui reste une hypothèse de
 * transport — RIEN ici n'en est une, ce fichier n'a plus besoin d'être remplacé quand le contrôleur
 * serveur existera.
 */

/** État UI à trois valeurs, jamais confondues (brief) — dérivé, PAS envoyé par le serveur : le
 *  contrat ne connaît que `OrigineDonneeFacture` (« par quel moyen ») + `valeur: T | null`
 *  (« lu ou non ») ; ce type combine les deux pour l'affichage. */
export type CertitudeValeurFacture = 'certaine' | 'incertaine' | 'absente';

/** `qr`/`texte_pdf` : décodage EXACT (symbole QR ou texte déjà numérique du PDF), jamais une
 *  reconnaissance — « certaine » au sens du brief. `ocr` : reconnaissance optique sur image,
 *  jamais garantie — « incertaine ». Voir la doc de `ORIGINES_DONNEE_FACTURE` (`@dfa/shared`). */
export function origineVersCertitude(origine: OrigineDonneeFacture): 'certaine' | 'incertaine' {
  return origine === 'ocr' ? 'incertaine' : 'certaine';
}

/** Certitude d'un champ d'EN-TÊTE — `valeur === null` -> `'absente'` AVANT toute lecture de
 *  `champsOrigine` (un champ non lu n'a, par construction, pas d'entrée dans la carte d'origine :
 *  `ChampsOrigineFactureFournisseur` est un `Partial`, voir sa doc de tête). Repli DÉFENSIF sur
 *  `'incertaine'` si une valeur non nulle existe sans origine tracée (ne devrait pas arriver côté
 *  serveur, mais un front ne doit jamais planter sur un contrat mal rempli). */
export function certitudeChampEnTete<T>(
  valeur: T | null,
  champ: ChampFactureFournisseur,
  champsOrigine: ChampsOrigineFactureFournisseur,
): CertitudeValeurFacture {
  if (valeur === null) return 'absente';
  const origine = champsOrigine[champ];
  return origine ? origineVersCertitude(origine) : 'incertaine';
}

/** Certitude d'un champ de LIGNE — l'origine est UNE SEULE valeur pour toute la ligne
 *  (`ReponseLigneFactureFournisseur.origine`, contrairement à l'en-tête où chaque champ a la
 *  sienne) : une ligne entière vient d'UN SEUL passage de la chaîne QR → texte PDF → OCR. */
export function certitudeChampLigne<T>(
  valeur: T | null,
  origineLigne: OrigineDonneeFacture,
): CertitudeValeurFacture {
  if (valeur === null) return 'absente';
  return origineVersCertitude(origineLigne);
}

/**
 * Nature de l'écart d'une ligne — DÉRIVÉE, le contrat ne porte que le delta chiffré
 * (`ecart: EcartLigneFactureFournisseur | null`). `null` : ligne non rapprochée à une ligne de
 * commande (`commandeFournisseurLigneId === null`, pas de comparaison possible) — distinct d'un
 * écart nul (comparé, et conforme, `'aucun'`).
 */
export type NatureEcartLigne =
  'aucun' | 'quantite' | 'prix_unitaire' | 'quantite_et_prix' | 'non_rapprochee';

export function deriverNatureEcart(ligne: ReponseLigneFactureFournisseur): NatureEcartLigne {
  if (ligne.commandeFournisseurLigneId === null || ligne.ecart === null) return 'non_rapprochee';
  const ecartPrix = ligne.ecart.prixUnitaireCentimes !== 0;
  const ecartQuantite = ligne.ecart.quantiteMillieme !== 0;
  if (ecartPrix && ecartQuantite) return 'quantite_et_prix';
  if (ecartPrix) return 'prix_unitaire';
  if (ecartQuantite) return 'quantite';
  return 'aucun';
}

export interface SyntheseEcartsFacture {
  /** Lignes dont la nature dérivée n'est pas `'aucun'` — toute anomalie confondue. */
  readonly nombreLignesAvecEcart: number;
  /** Sous-ensemble : lignes NON rapprochées (`'non_rapprochee'`) — aucun delta chiffré. */
  readonly nombreLignesNonRapprochees: number;
  /** Somme des `ecart.totalCentimes` des lignes CHIFFRABLES (nature `quantite`/`prix_unitaire`/
   *  `quantite_et_prix`). Positif = la facture demande plus que la commande. Entiers uniquement
   *  (CONTRIBUTING.md) — une somme d'entiers reste un entier, jamais un arrondi flottant ici. */
  readonly ecartTotalCentimes: number;
}

export function calculerSyntheseEcarts(
  lignes: readonly ReponseLigneFactureFournisseur[],
): SyntheseEcartsFacture {
  let nombreLignesAvecEcart = 0;
  let nombreLignesNonRapprochees = 0;
  let ecartTotalCentimes = 0;

  for (const ligne of lignes) {
    const nature = deriverNatureEcart(ligne);
    if (nature === 'aucun') continue;
    nombreLignesAvecEcart += 1;
    if (nature === 'non_rapprochee') {
      nombreLignesNonRapprochees += 1;
      continue;
    }
    if (ligne.ecart) ecartTotalCentimes += ligne.ecart.totalCentimes;
  }

  return { nombreLignesAvecEcart, nombreLignesNonRapprochees, ecartTotalCentimes };
}

/** Centimes -> montant SIGNÉ, ex. `1250` -> `"+1'234.50"`. `formaterMontant` seul ne préfixe le
 *  signe QUE pour les négatifs (`Intl.NumberFormat` par défaut) : ce formateur ajoute le `+`
 *  explicite pour les écarts positifs, pour qu'un dépassement de prix ne se lise jamais comme un
 *  simple montant neutre. */
export function formaterMontantEcart(centimes: number): string {
  const signe = centimes > 0 ? '+' : '';
  return `${signe}${formaterMontant(centimes)}`;
}

/** Millièmes -> quantité SIGNÉE, même raisonnement que `formaterMontantEcart`. */
export function formaterQuantiteEcart(millieme: number): string {
  const signe = millieme > 0 ? '+' : '';
  return `${signe}${formaterQuantiteMillieme(millieme)}`;
}
