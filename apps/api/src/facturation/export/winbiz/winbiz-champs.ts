/**
 * Formatage des champs individuels d'une ligne WinBIZ (`EF-12`/`EF-13`).
 *
 * Chaque fonction est pure et testée indépendamment de la sérialisation complète — c'est ici, et
 * nulle part ailleurs, que vivent les conventions numériques et de date de la cible. Aucune
 * fonction de ce fichier ne recalcule un montant (`EF-03`) : toutes reçoivent une valeur déjà
 * arrêtée par le cœur et se contentent de choisir sa REPRÉSENTATION textuelle.
 */

import { LONGUEURS_CHAMPS_WINBIZ, MONTANT_MAX_CENTIMES_WINBIZ } from './winbiz.constantes';
import { ErreurExportWinbiz } from './winbiz.erreurs';

/**
 * `aaaa-mm-jj` (`schemaDateJour`, `@dfa/shared`) → `jj.mm.aaaa` (`EF-12`).
 *
 * @throws ErreurExportWinbiz `DATE_INVALIDE` si `iso` n'a pas la forme attendue.
 */
export function formaterDateWinbiz(iso: string): string {
  const correspondance = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (correspondance === null) {
    throw new ErreurExportWinbiz(
      'DATE_INVALIDE',
      `Date « ${iso} » non conforme à aaaa-mm-jj — impossible à convertir pour WinBIZ.`,
    );
  }
  // `noUncheckedIndexedAccess` : les trois groupes captent toujours une valeur dès que le motif
  // complet (ancré ^…$, aucun groupe optionnel) correspond — le repli `?? ''` n'est jamais
  // atteint en pratique, seulement là pour satisfaire le typage strict (même patron que
  // `facturation/qr/reference-qrr.ts`).
  const annee = correspondance[1] ?? '';
  const mois = correspondance[2] ?? '';
  const jour = correspondance[3] ?? '';
  return `${jour}.${mois}.${annee}`;
}

/**
 * Un montant en centimes entiers → sa représentation décimale WinBIZ (point décimal, PAS de
 * séparateur de milliers, décimales inutiles supprimées).
 *
 * Reproduit fidèlement les deux lignes de l'exemple officiel `ecr_standardv6.csv` (`EF-15`) :
 * `10810` (108.10 CHF) → `"108.1"` (pas `"108.10"`) et `10000` (100.00 CHF) → `"100"` (pas
 * `"100.00"`, pas de point du tout). La documentation ne précise aucune règle de padding — c'est
 * l'exemple qui fait foi, comme pour le reste de ce paragraphe (`EF-13` verbatim : « le nom des
 * colonnes ne détermine pas le contenu — seul l'ordre fait foi », même esprit appliqué ici au
 * format numérique : c'est l'exemple, pas une supposition de padding à deux décimales, qui fait
 * foi).
 *
 * @throws ErreurExportWinbiz `MONTANT_INVALIDE` si `centimes` n'est pas un entier sûr, est
 *         négatif (le contrat partagé garantit `montantCentimes` toujours positif — `sens` porte
 *         le signe, pas le montant), ou dépasse `MONTANT_MAX_CENTIMES_WINBIZ`.
 */
export function formaterMontantWinbiz(centimes: number): string {
  if (!Number.isSafeInteger(centimes)) {
    throw new ErreurExportWinbiz(
      'MONTANT_INVALIDE',
      `Un montant WinBIZ est un entier de centimes (reçu ${String(centimes)}).`,
    );
  }
  if (centimes < 0) {
    throw new ErreurExportWinbiz(
      'MONTANT_INVALIDE',
      `Montant négatif reçu (${centimes}) : le signe doit être porté par « sens », jamais par le ` +
        'montant (contrat LigneEcritureExport).',
    );
  }
  if (centimes > MONTANT_MAX_CENTIMES_WINBIZ) {
    throw new ErreurExportWinbiz(
      'MONTANT_INVALIDE',
      `Montant ${centimes} centimes hors bornes WinBIZ (max ${MONTANT_MAX_CENTIMES_WINBIZ}).`,
    );
  }

  const entier = Math.trunc(centimes / 100);
  const fraction = centimes % 100;

  if (fraction === 0) {
    return `${entier}`;
  }
  if (fraction % 10 === 0) {
    return `${entier}.${fraction / 10}`;
  }
  return `${entier}.${String(fraction).padStart(2, '0')}`;
}

/**
 * Un taux en pour-mille (`tauxTvaPourmille` du contrat partagé — 81, 26, 38…) → son pourcentage
 * WinBIZ (`"8.1"`, `"2.6"`, `"3.8"`), exactement la forme littérale de l'exemple officiel
 * (`EF-15` : `8.1`, pas `810`, `8,1` ni `081`). `pourmille / 10` produit par construction au plus
 * une décimale pour n'importe quel entier — aucun arrondi, une simple division exacte par 10.
 */
export function formaterTauxWinbiz(tauxPourmille: number): string {
  const dixiemesDePourcent = tauxPourmille % 10;
  const partieEntiere = Math.trunc(tauxPourmille / 10);
  return dixiemesDePourcent === 0 ? `${partieEntiere}` : `${partieEntiere}.${dixiemesDePourcent}`;
}

export interface ChampTexteWinbiz {
  readonly valeur: string;
  readonly tronque: boolean;
}

/**
 * Assainit un champ texte libre (`Libellé`, `Comment`…) : les caractères qui casseraient la
 * structure CSV (`;`, qui EST le séparateur `EF-12`) ou une ligne (`CR`, `LF`) sont remplacés par
 * une espace plutôt qu'échappés — la documentation WinBIZ ne décrit AUCUNE convention de
 * guillemets/échappement pour ce format, en introduire une inventerait une règle non sourcée.
 * Les espaces multiples résultant du remplacement sont réduites à une seule, puis la chaîne est
 * rognée aux bords et tronquée à `longueurMax`.
 */
export function nettoyerTexteWinbiz(valeur: string, longueurMax: number): ChampTexteWinbiz {
  const assaini = valeur
    .replace(/[;\r\n\t]/g, ' ')
    // Caractères de contrôle C0 restants (hors tabulation déjà traitée ci-dessus).
    // eslint-disable-next-line no-control-regex -- volontaire : neutraliser les caractères de contrôle C0.
    .replace(/[\x00-\x1f]/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();

  if (assaini.length <= longueurMax) {
    return { valeur: assaini, tronque: false };
  }
  return { valeur: assaini.slice(0, longueurMax), tronque: true };
}

/**
 * `Pièce` (colonne 2, 10 caractères max, `EF-13`) : c'est le numéro DFA affiché (`RF-108`) que
 * la fiduciaire retape pour retrouver le document. `document_vente.numero` autorise jusqu'à 20
 * caractères (`schemaCreationDocument`, `packages/shared`) — largement plus que les 10 admis
 * ici. Une troncature depuis la GAUCHE conserverait le préfixe (souvent la constante « FA-» ou
 * l'année) et perdrait le suffixe (le plus souvent la partie réellement discriminante, le numéro
 * de séquence) ; cet adaptateur tronque donc depuis la DROITE de la chaîne assainie — garder les
 * 10 DERNIERS caractères — ce qui conserve la partie la plus susceptible d'identifier le document
 * de façon unique pour les formats `PRÉFIXE-AAAA-NNNNN` usuels.
 *
 * **Signalé à @laupernoe** : c'est une perte d'information réelle, pas un détail cosmétique — voir le
 * rapport de livraison. `tronque: true` permet à l'appelant de l'exposer explicitement (log,
 * écran d'export) plutôt que de la laisser invisible.
 */
export function formaterPieceWinbiz(reference: string): ChampTexteWinbiz {
  const { valeur: assaini } = nettoyerTexteWinbiz(reference, Number.POSITIVE_INFINITY);
  if (assaini.length <= LONGUEURS_CHAMPS_WINBIZ.piece) {
    return { valeur: assaini, tronque: false };
  }
  return {
    valeur: assaini.slice(assaini.length - LONGUEURS_CHAMPS_WINBIZ.piece),
    tronque: true,
  };
}

/**
 * `Libellé` (colonne 3, 100 caractères) — troncature classique depuis la fin, 100 caractères
 * laissant en pratique toujours la place au libellé métier complet.
 */
export function formaterLibelleWinbiz(libelle: string): ChampTexteWinbiz {
  return nettoyerTexteWinbiz(libelle, LONGUEURS_CHAMPS_WINBIZ.libelle);
}

/**
 * `Cpt_debit`/`Cpt_credit` (colonnes 4/5, 12 caractères) : un compte issu de `mapping_compte`
 * plus long que 12 caractères est une anomalie de PARAMÉTRAGE (compte mal saisi par le garage ou
 * sa fiduciaire), pas un texte libre — le tronquer changerait de compte sans le dire. Cet
 * adaptateur REFUSE plutôt que de couper (contrairement à `formaterPieceWinbiz`/
 * `formaterLibelleWinbiz`, où tronquer un texte descriptif reste défendable).
 *
 * @throws ErreurExportWinbiz `COMPTE_INVALIDE`.
 */
export function verifierLongueurCompteWinbiz(compte: string): string {
  const nettoye = compte.trim();
  if (nettoye.length === 0 || nettoye.length > LONGUEURS_CHAMPS_WINBIZ.compte) {
    throw new ErreurExportWinbiz(
      'COMPTE_INVALIDE',
      `Compte « ${compte} » vide ou plus long que ${LONGUEURS_CHAMPS_WINBIZ.compte} caractères ` +
        '— vérifier le paramétrage mapping_compte du tenant plutôt que de le tronquer.',
    );
  }
  return nettoye;
}
