import type { TFunction } from 'i18next';

import type { ActiviteIndirecte, ReponseOrdreReparation, ReponsePointage } from '@dfa/shared';

/**
 * `ActiviteIndirecte` (snake_case, `contrats/pointage/enums.ts`) -> suffixe camelCase de
 * `pointage:activites.*` (namespace déjà complet, VERBATIM du catalogue RM-87/§5 — voir l'en-tête
 * d'`enums.ts` : « sept tuiles déjà traduites »). `derive_horloge` N'EST PAS dans cette table : ce
 * n'est PAS une activité indirecte, c'est un motif d'ANOMALIE (`MotifAnomaliePointage`), table
 * séparée ci-dessous.
 */
const CLE_ACTIVITE_INDIRECTE: Readonly<Record<ActiviteIndirecte, string>> = {
  nettoyage: 'nettoyage',
  attente_pieces: 'attentePieces',
  attente_accord: 'attenteAccord',
  magasin: 'magasin',
  formation: 'formation',
  pause: 'pause',
  absence: 'absence',
};

export function libelleActiviteIndirecte(activite: ActiviteIndirecte, t: TFunction): string {
  return t(`pointage:activites.${CLE_ACTIVITE_INDIRECTE[activite]}`);
}

/**
 * `MotifAnomaliePointage` (snake_case) -> suffixe camelCase de `pointage:anomalies.motifs.*` —
 * mêmes six valeurs VERBATIM que le namespace i18n déjà posé (voir l'en-tête d'`enums.ts`), plus
 * `derive_horloge` ajouté au lot 2 par le contrat et déjà présent dans les trois locales.
 */
const CLE_MOTIF_ANOMALIE: Readonly<Record<string, string>> = {
  duree_trop: 'dureeTrop',
  nuit: 'nuit',
  chevauchement: 'chevauchement',
  periode_verrouillee: 'periodeVerrouillee',
  or_facture: 'orFacture',
  ligne_non_pointable: 'ligneNonPointable',
  derive_horloge: 'deriveHorloge',
};

export function libelleMotifAnomalie(motif: string, t: TFunction): string {
  const cle = CLE_MOTIF_ANOMALIE[motif];
  return cle ? t(`pointage:anomalies.motifs.${cle}`) : motif;
}

/**
 * Libellé de la cible d'un pointage, construit à partir de `ReponsePointage` SEUL — désormais
 * possible SANS charger le document OR : le serveur peuple `ordreReparationNumero` et
 * `ligneOrDesignation` directement sur la ressource pointage (voir le commentaire de tête de
 * `contrats/pointage/pointage.ts`, §« Ressource — lecture »). Avant l'ajout de ces deux champs,
 * cette fonction (alors nommée `libelleCiblePointageGenerique`) ne pouvait afficher qu'un texte
 * générique (« OR (sans ligne précise) », « Ligne d'OR ») faute de numéro — défaut 3 constaté sur
 * `EcranEquipePointage`, colonne « Cible » muette sur QUEL OR. Trois cas, JAMAIS un identifiant
 * technique affiché :
 *  - `indirect` -> le libellé de l'activité (nettoyage, pause, …) ;
 *  - `productif_or` -> `« {numéro} — OR entier »`, ou repli générique si le numéro manque
 *    (ne DEVRAIT pas arriver : `ordreReparationNumero` est garanti non nul dès que
 *    `ordreReparationId` l'est — voir le contrat — mais un contrat de LECTURE reste un contrat,
 *    pas une preuve à l'exécution ; le repli protège d'un serveur qui dévierait) ;
 *  - `productif_ligne` -> `« {numéro} — {désignation} »` si la ligne a une désignation saisie,
 *    `« {numéro} — Ligne d'OR »` si `ligneOrDesignation` est `null` (désignation elle-même
 *    nullable en base, même commentaire de contrat), repli générique si même le numéro manque.
 *
 * Utilisée par `EcranEquipePointage` (colonne « Cible », liste de TOUTE l'équipe — plus de N+1
 * de requêtes : la donnée voyage déjà sur `GET /pointages`) et `EcranBornePointage` (carte du
 * pointage en cours, mode PIN partagé — même bénéfice, aucun appel réseau supplémentaire).
 * `EcranPointageTechnicien` a sa propre variante plus riche (`libelleCiblePointageTechnicien`
 * ci-dessous), qui a de toute façon déjà chargé le document OR complet pour d'autres besoins
 * (liste des lignes assignées au choix de cible) ; cette fonction-ci lui sert de repli le temps
 * que ce document arrive, ou si son nature est `indirect`.
 */
export function libelleCiblePointage(pointage: ReponsePointage, t: TFunction): string {
  if (pointage.nature === 'indirect') {
    return pointage.activiteIndirecte
      ? libelleActiviteIndirecte(pointage.activiteIndirecte, t)
      : t('pointage:natures.indirect');
  }
  if (pointage.nature === 'productif_ligne') {
    if (!pointage.ordreReparationNumero) return t('pointage:natures.productif_ligne');
    return pointage.ligneOrDesignation
      ? t('pointage:cible.ligne', {
          numero: pointage.ordreReparationNumero,
          designation: pointage.ligneOrDesignation,
        })
      : t('pointage:cible.ligneSansDesignation', { numero: pointage.ordreReparationNumero });
  }
  return pointage.ordreReparationNumero
    ? t('pointage:cible.or', { numero: pointage.ordreReparationNumero })
    : t('pointage:natures.productif_or');
}

/**
 * Libellé de la cible d'un pointage, propre à `EcranPointageTechnicien` : quand le document OR
 * est déjà chargé (`or`, via `useOrdreReparation(pointage.ordreReparationId)` — nécessaire de
 * toute façon pour lister les lignes assignables au choix de cible), on en tire le numéro et,
 * pour une ligne, sa désignation EXACTE au sein de ce document (utile notamment quand `or.lignes`
 * contient la ligne mais que sa désignation a pu changer depuis le peuplement de `ReponsePointage`
 * — un cas marginal, mais ce document est la source la plus fraîche disponible ici). Tant que `or`
 * n'est pas chargé, repli sur `libelleCiblePointage` ci-dessus, qui tire désormais le même
 * numéro/désignation directement de `ReponsePointage` — plus un texte générique vide de sens.
 *
 * Correctif défaut 2 (repli après F5) : avant, l'écran ne savait retrouver ce libellé riche que
 * depuis une mémoire locale (`dernierCible`) posée au moment où LUI-MÊME démarrait le pointage —
 * perdue au rechargement de page, ce qui rabattait l'affichage sur le texte générique
 * (« OR (sans ligne précise) ») alors que le serveur connaît parfaitement la cible
 * (`ordreReparationId`/`ligneOrId` sur `ReponsePointage`). Cette fonction dérive le libellé
 * riche depuis la RÉPONSE API du document OR à chaque rendu, jamais depuis un état volatile
 * initialisé une seule fois — un F5 ne perd donc plus l'affichage de la cible.
 *
 * `or` est `undefined` tant que la requête de détail n'a pas abouti (chargement, erreur, ou
 * pointage `indirect` qui n'a justement AUCUN `ordreReparationId` à résoudre) : repli sur
 * `libelleCiblePointage` dans tous ces cas — depuis l'ajout de `ordreReparationNumero`/
 * `ligneOrDesignation` à `ReponsePointage`, ce repli n'est PLUS un texte générique vide de sens :
 * il affiche déjà le numéro d'OR réel (voire la désignation de ligne) pendant que ce document se
 * charge, jamais un texte à moitié construit.
 */
export function libelleCiblePointageTechnicien(
  pointage: ReponsePointage,
  or: ReponseOrdreReparation | undefined,
  t: TFunction,
): string {
  if (or && pointage.nature === 'productif_or') {
    return t('pointage:technicien.cible.or', { numero: or.numero });
  }
  if (or && pointage.nature === 'productif_ligne') {
    const ligne = or.lignes.find((candidate) => candidate.id === pointage.ligneOrId);
    if (ligne) {
      return t('pointage:technicien.cible.ligne', {
        numero: or.numero,
        designation: ligne.designation,
      });
    }
    // Ligne absente du document chargé (ex. page de lignes tronquée, `lignesTronquees`) : le
    // numéro d'OR seul reste plus informatif que le repli générique.
    return t('pointage:technicien.cible.or', { numero: or.numero });
  }
  return libelleCiblePointage(pointage, t);
}
