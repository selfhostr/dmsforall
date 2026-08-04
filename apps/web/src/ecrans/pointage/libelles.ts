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
 * Libellé GÉNÉRIQUE d'un pointage, construit UNIQUEMENT à partir des champs de `ReponsePointage`
 * (identifiants, `activiteIndirecte`) — sans numéro d'OR ni désignation de ligne, qui n'y
 * figurent pas (voir le commentaire de tête de `contrats/pointage/pointage.ts` §« Ressource —
 * lecture » : un objet plat à identifiants, pas un agrégat enrichi). Utilisé par les vues
 * jour/semaine et équipe, qui listent des pointages d'AUTRUI sans avoir déjà chargé l'OR
 * correspondant — contrairement à `EcranPointageTechnicien`, qui CONNAÎT le numéro d'OR et la
 * désignation de ligne au moment où IL démarre son propre pointage (voir sa fonction
 * `libelleCiblePointageTechnicien`, plus riche, propre à cet écran).
 */
export function libelleCiblePointageGenerique(pointage: ReponsePointage, t: TFunction): string {
  if (pointage.nature === 'indirect' && pointage.activiteIndirecte) {
    return libelleActiviteIndirecte(pointage.activiteIndirecte, t);
  }
  if (pointage.nature === 'productif_ligne') {
    return t('pointage:natures.productif_ligne');
  }
  return t('pointage:natures.productif_or');
}

/**
 * Libellé de la colonne « Cible » d'`EcranEquipePointage` (défaut 3) — LIMITATION DE CONTRAT
 * ASSUMÉE, documentée ici plutôt que masquée : `ReponsePointage` (`contrats/pointage/pointage.ts`)
 * ne porte NI numéro d'OR NI numéro/désignation de ligne, seulement des identifiants opaques
 * (`ordreReparationId`, `ligneOrId`). Contrairement à `EcranPointageTechnicien`
 * (`libelleCiblePointageTechnicien` ci-dessous), cet écran liste les pointages de TOUTE l'équipe —
 * charger le document OR de CHAQUE ligne du tableau pour en tirer le numéro serait un N+1 de
 * requêtes par rendu, hors périmètre d'un correctif d'écran. Amélioration apportée SANS toucher au
 * contrat : un libellé sans ambiguïté (« OR entier » / « Ligne d'OR »), jamais l'UUID brut de
 * `ordreReparationId`/`ligneOrId` — l'affichage précédent (`libelleCiblePointageGenerique`,
 * « OR (sans ligne précise) ») laissait à tort penser qu'une donnée manquait alors que c'est
 * toujours vrai pour `productif_or`.
 *
 * VRAI CORRECTIF, hors périmètre de ce fichier (`apps/web/src/ecrans/pointage/**` uniquement) :
 * ajouter à `ReponsePointage` un numéro d'OR (et la désignation de ligne si `ligneOrId` non nul),
 * porté par le serveur — voir `packages/shared/src/contrats/pointage/pointage.ts` (interface
 * `ReponsePointage`, §« Ressource — lecture ») pour le contrat, et le contrôleur de liste
 * `GET /pointages` sous `apps/api/src/pointage/` pour le peuplement. Une fois ce champ ajouté,
 * cette fonction devient obsolète au profit d'un affichage direct du numéro, comme
 * `libelleCiblePointageTechnicien` le fait déjà pour l'écran technicien (qui, lui, a déjà chargé
 * le document OR complet pour d'autres besoins).
 */
export function libelleCibleEquipePointage(pointage: ReponsePointage, t: TFunction): string {
  if (pointage.nature === 'indirect' && pointage.activiteIndirecte) {
    return libelleActiviteIndirecte(pointage.activiteIndirecte, t);
  }
  if (pointage.nature === 'productif_ligne') {
    return t('pointage:equipe.cible.ligneOr');
  }
  return t('pointage:equipe.cible.orEntier');
}

/**
 * Libellé RICHE de la cible d'un pointage, propre à `EcranPointageTechnicien` : numéro d'OR (et
 * désignation de ligne le cas échéant) plutôt que le texte générique de
 * `libelleCiblePointageGenerique` ci-dessus. `ReponsePointage` ne porte que des identifiants — ce
 * numéro/cette désignation viennent TOUJOURS de `or`, le document `ReponseOrdreReparation` déjà
 * chargé par l'écran via `useOrdreReparation(pointage.ordreReparationId)`.
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
 * `libelleCiblePointageGenerique` dans tous ces cas, jamais un texte à moitié construit.
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
  return libelleCiblePointageGenerique(pointage, t);
}
