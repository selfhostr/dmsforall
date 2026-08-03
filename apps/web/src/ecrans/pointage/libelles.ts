import type { TFunction } from 'i18next';

import type { ActiviteIndirecte, ReponsePointage } from '@dfa/shared';

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
