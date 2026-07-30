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
import { enDate } from '../db';
import { calculerNomAffiche } from '../common/identite-client';

/**
 * `dernierPassageLe` n'est PAS une colonne de `client` (aucune table ne la matérialise) : c'est
 * une valeur dérivée, calculée par une sous-requête corrélée sur `ordre_reparation.ouvert_le`
 * (voir `service-client.ts`). Elle est donc toujours fournie par l'appelant, jamais lue sur la
 * ligne — GAP DE CONTRAT signalé en réponse de tâche : `ReponseClient.dernierPassageLe` existe
 * dans le contrat gelé sans colonne ni index dédiés côté schéma.
 */
export function versClientResponse(
  ligne: LigneClient,
  // `Date | string` et non `Date` : `dernierPassageLe` vient toujours d'une requête SQL brute
  // (`ServiceClient.dernierPassage`, `tx.execute`) — mesuré, le pilote `pg` y rend en fait
  // `timestamptz` en `Date` (pas en chaîne) par défaut ; `enDate()` reste défensif au cas où un
  // chemin d'exécution différent rendrait un jour une chaîne à la place (voir `enDate()`,
  // `db/acces-amorcage.service.ts`). Champ d'AFFICHAGE uniquement, jamais une valeur de curseur —
  // la précision milliseconde de `Date`/`toISOString()` y est appropriée.
  dernierPassageLe: Date | string | null,
  notesAlerte: readonly ReponseClientNote[],
): ReponseClient {
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
    dernierPassageLe: dernierPassageLe ? enDate(dernierPassageLe).toISOString() : null,
    notesAlerte,
    creeLe: ligne.creeLe.toISOString(),
    modifieLe: ligne.modifieLe.toISOString(),
  };
}

/**
 * Champs de désambiguïsation comptoir (`ClientResume.telephone/localite/nombreVehicules/
 * dernierPassageLe`) : jamais déductibles de `LigneClient` seule (adresse, détentions et OR sont
 * d'autres tables) — TOUJOURS fournis par l'appelant, qui les a obtenus par une jointure/agrégat
 * dans SA requête (jamais une requête par ligne ici). Voir `ServiceClient.lister` (une seule
 * requête, LEFT JOIN LATERAL) et `ServiceClientOrdresReparation.lister` (une seule requête
 * supplémentaire, exécutée une fois pour le client de l'OR, pas par ligne).
 */
export interface ExtraClientResume {
  readonly localite: string | null;
  readonly nombreVehicules: number;
  // `Date | string` : provient d'une sous-requête SQL brute (`LEFT JOIN LATERAL` sur
  // `ordre_reparation`, via `tx.execute`) — mesuré, le pilote `pg` y rend en fait `timestamptz` en
  // `Date` (pas en chaîne) par défaut ; `enDate()` reste défensif au cas où un chemin d'exécution
  // différent rendrait un jour une chaîne à la place. Voir `enDate()`, réutilisé ci-dessous dans
  // `versClientResume`. Champ d'AFFICHAGE uniquement (`ClientResume.dernierPassageLe`), jamais une
  // valeur de curseur.
  readonly dernierPassageLe: Date | string | null;
}

export function versClientResume(ligne: LigneClient, extra: ExtraClientResume): ClientResume {
  return {
    id: ligne.id,
    numeroClient: ligne.numero,
    nomAffiche: calculerNomAffiche(ligne),
    type: ligne.type,
    statut: ligne.statut,
    langueCorrespondance: ligne.langue,
    poObligatoire: ligne.poObligatoire,
    telephone: ligne.telephone,
    localite: extra.localite,
    nombreVehicules: extra.nombreVehicules,
    dernierPassageLe: extra.dernierPassageLe ? enDate(extra.dernierPassageLe).toISOString() : null,
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
