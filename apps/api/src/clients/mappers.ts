import type {
  ClientResume,
  ReponseClient,
  ReponseClientAdresse,
  ReponseClientCondition,
  ReponseClientConsentement,
  ReponseClientContact,
  ReponseClientNote,
} from '@dfa/shared';
import type {
  LigneClient,
  LigneClientAdresse,
  LigneClientCondition,
  LigneClientConsentement,
  LigneClientContact,
  LigneClientNote,
} from '../db/schema';

/**
 * Rendu d'affichage calculé par le serveur — jamais recomposé côté client (voir le commentaire
 * de `ReponseClient.nomAffiche` dans `@dfa/shared`). `raisonSociale` prime : le CHECK
 * `client_identite_chk` garantit qu'il est renseigné pour toute entreprise, `nom`/`prenom` pour
 * tout particulier.
 */
export function calculerNomAffiche(ligne: Pick<LigneClient, 'raisonSociale' | 'nom' | 'prenom'>): string {
  if (ligne.raisonSociale) return ligne.raisonSociale;
  return [ligne.nom, ligne.prenom].filter((valeur): valeur is string => Boolean(valeur)).join(' ');
}

/**
 * `dernierPassageLe` n'est PAS une colonne de `client` (aucune table ne la matérialise) : c'est
 * une valeur dérivée, calculée par une sous-requête corrélée sur `ordre_reparation.ouvert_le`
 * (voir `service-client.ts`). Elle est donc toujours fournie par l'appelant, jamais lue sur la
 * ligne — GAP DE CONTRAT signalé en réponse de tâche : `ReponseClient.dernierPassageLe` existe
 * dans le contrat gelé sans colonne ni index dédiés côté schéma.
 */
export function versClientResponse(ligne: LigneClient, dernierPassageLe: Date | null): ReponseClient {
  return {
    id: ligne.id,
    numeroClient: ligne.numero,
    type: ligne.type,
    statut: ligne.statut,
    civilite: ligne.civilite,
    nom: ligne.nom,
    prenom: ligne.prenom,
    raisonSociale: ligne.raisonSociale,
    nomAffiche: calculerNomAffiche(ligne),
    ide: ligne.ide,
    langueCorrespondance: ligne.langue,
    email: ligne.email,
    telephone: ligne.telephone,
    telephoneE164: ligne.telephoneE164,
    poObligatoire: ligne.poObligatoire,
    groupeId: ligne.groupeClientId,
    fusionneVersClientId: ligne.fusionneVersClientId,
    referenceExterne: ligne.referenceExterne,
    dernierPassageLe: dernierPassageLe ? dernierPassageLe.toISOString() : null,
    creeLe: ligne.creeLe.toISOString(),
    modifieLe: ligne.modifieLe.toISOString(),
  };
}

export function versClientResume(ligne: LigneClient): ClientResume {
  return {
    id: ligne.id,
    numeroClient: ligne.numero,
    nomAffiche: calculerNomAffiche(ligne),
    type: ligne.type,
    statut: ligne.statut,
    langueCorrespondance: ligne.langue,
    poObligatoire: ligne.poObligatoire,
  };
}

export function versAdresseResponse(ligne: LigneClientAdresse): ReponseClientAdresse {
  return {
    id: ligne.id,
    type: ligne.type,
    rue: ligne.rue ?? '',
    complement: ligne.complement,
    npa: ligne.npa ?? '',
    localite: ligne.localite ?? '',
    pays: ligne.pays,
    actif: ligne.actif,
  };
}

export function versContactResponse(ligne: LigneClientContact): ReponseClientContact {
  return {
    id: ligne.id,
    nom: ligne.nom ?? '',
    prenom: ligne.prenom,
    fonction: ligne.fonction,
    telephone: ligne.telephone,
    telephoneE164: ligne.telephoneE164,
    email: ligne.email,
    langue: ligne.langue,
    roles: ligne.roles,
    actif: ligne.actif,
  };
}

export function versConditionResponse(ligne: LigneClientCondition): ReponseClientCondition {
  return {
    id: ligne.id,
    rabaisMoPourmille: ligne.rabaisMoPourmille ?? 0,
    rabaisPiecesPourmille: ligne.rabaisPiecesPourmille ?? 0,
    rabaisPneusPourmille: ligne.rabaisPneusPourmille ?? 0,
    tauxHoraireCode: ligne.tauxHoraireCode,
    delaiPaiementJours: ligne.delaiPaiementJours,
    modePaiement: ligne.modePaiement,
    plafondCentimes: ligne.plafondCentimes,
    valideDuLe: ligne.valideDu,
    valideAuLe: ligne.valideAu,
  };
}

export function versConsentementResponse(ligne: LigneClientConsentement): ReponseClientConsentement {
  return {
    id: ligne.id,
    type: ligne.type,
    accorde: ligne.accorde,
    recueilliLe: ligne.recueilliLe.toISOString(),
    canal: ligne.canal,
  };
}

export interface AuteurNote {
  readonly utilisateurId: string;
  readonly nomAffiche: string;
}

export function versNoteResponse(ligne: LigneClientNote, auteur: AuteurNote | null): ReponseClientNote {
  return {
    id: ligne.id,
    nature: ligne.nature,
    texte: ligne.texte,
    auteur,
    creeLe: ligne.creeLe.toISOString(),
  };
}
