/**
 * Comptes de service — identité durable d'un APPAREIL, par opposition à un compte de personne.
 *
 * Aujourd'hui un seul : `poste_atelier`, la borne tactile murale de l'atelier
 * (`docs/specification-pointage-borne.md` §0.2). Ce fichier porte tout ce que le reste du produit
 * doit savoir de cette identité — et rien de plus : ni le code PIN, ni la table `pin_pointage`,
 * ni le verrouillage anti-balayage, qui appartiennent au module `pointage/`.
 *
 * ------------------------------------------------------------------------------------------------
 * POURQUOI UN COMPTE `utilisateur` ORDINAIRE, ET PAS UN JETON D'APPAREIL SÉPARÉ
 * ------------------------------------------------------------------------------------------------
 * Un « jeton d'appareil » (crédential propre à la tablette, présenté en en-tête) paraît la réponse
 * naturelle, et c'est bien la doctrine du produit pour les INTÉGRATIONS. Elle est ici écartée pour
 * une raison structurelle, pas esthétique : **toutes les colonnes `cree_par_utilisateur_id` du
 * produit sont des clés étrangères vers `public.utilisateur`** — y compris celles de `pointage`, la
 * seule table que la borne écrit. Un acteur qui n'est pas une ligne de `utilisateur` ne peut donc
 * RIEN écrire d'auditable : il faudrait rendre ces FK nullables (perte d'audit trail) ou inventer
 * un acteur fictif (mensonge dans le trail). Aucune des deux options n'est acceptable pour une
 * donnée qui sert à établir des heures de travail.
 *
 * Le compte ordinaire, à l'inverse, réutilise TOUT ce qui existe et a déjà été audité : Argon2id,
 * limitation de débit et verrouillage progressif au login, cookie httpOnly, `GardeSession`,
 * `MATRICE_DROITS`, `journal_securite`, révocation (`statut = 'suspendu'` ou révocation de
 * session). Aucune seconde surface d'authentification à écrire, ni à maintenir, ni à auditer.
 *
 * ------------------------------------------------------------------------------------------------
 * CE QUI RESTE VRAI D'UN COMPTE DE SERVICE (à ne pas éroder par commodité)
 * ------------------------------------------------------------------------------------------------
 *  1. Il est rattaché à UN site (`utilisateur.site_id`, biconditionnelle en base). Ce site est
 *     résolu depuis la SESSION, jamais depuis la requête — c'est ce qui empêche une borne de lire
 *     les PIN d'un autre site.
 *  2. Ses droits sont minimaux (voir `DROITS_POSTE_ATELIER` dans `matrice-droits.ts`), et il
 *     figure dans `ROLES_SANS_MONTANT` : une tablette murale ne montre jamais d'argent.
 *  3. Il n'est JAMAIS le sujet d'un geste métier. Un compte de service ne travaille pas : il ne
 *     peut pas être le technicien d'un pointage, le signataire d'un document, ni le destinataire
 *     d'une affectation. C'est le PIN qui désigne la personne réelle derrière le geste.
 */
import { estCompteDeService, type RoleUtilisateur } from '@dfa/shared';

import type { PrincipalAuthentifie } from '../common/contexte/contexte-requete.types';
import { ErreurSessionExpiree, ErreurSiteHorsPortee } from './erreurs-auth';

// =================================================================================================
// Durée de vie de la session d'un compte de service
// =================================================================================================

/**
 * Durées de session appliquées aux comptes de service, EN REMPLACEMENT de
 * `SESSION_DUREE_MINUTES` / `SESSION_INACTIVITE_MINUTES` (480 min / 120 min pour une personne).
 *
 * CE N'EST PAS UN CONFORT — c'est une condition de sécurité du mode borne. RM-129 fonde tout
 * l'anti-balayage du PIN sur le fait que « cette session ne peut pas se rafraîchir sans le mot de
 * passe du compte de la borne, que les techniciens ne connaissent justement pas ». Avec les durées
 * d'une personne, la session de la tablette mourrait au bout de 8 h (ou de 2 h d'inactivité, donc
 * chaque nuit), et quelqu'un devrait retaper le mot de passe DEVANT l'atelier tous les matins :
 * la prémisse de RM-129 serait fausse au bout d'une semaine, et le PIN ne protégerait plus rien.
 *
 * Risque assumé, et il est borné : une tablette volée avec sa session ouverte donne exactement les
 * droits de `DROITS_POSTE_ATELIER` — pointer sur UN site, lire les OR de ce site, sans montants,
 * sans transition d'OR, sans document, sans paiement. Le pire résultat possible est un pointage
 * mensonger, c'est-à-dire précisément le risque que la spécification déclare déjà accepter pour un
 * PIN emprunté. La révocation reste immédiate et centrale : suspendre le compte ou révoquer sa
 * session invalide la borne à la requête suivante.
 *
 * Constantes de code et non variables d'environnement à ce stade : `apps/api/src/config/` n'est pas
 * dans le périmètre d'écriture de ce module. À promouvoir en `SESSION_SERVICE_*_MINUTES` validées
 * par zod le jour où un exploitant a besoin de les régler par déploiement — signalé à @laupernoe.
 */
export const SESSION_COMPTE_DE_SERVICE_DUREE_MINUTES = 90 * 24 * 60;

/**
 * Fenêtre d'inactivité d'un compte de service. 30 jours : une borne inutilisée un mois entier
 * signale un site fermé ou une tablette retirée — dans les deux cas, exiger une reconnexion est le
 * bon comportement. Reste très en deçà de la durée absolue, donc la borne d'un site en activité
 * normale n'est jamais déconnectée par ce chemin.
 */
export const SESSION_COMPTE_DE_SERVICE_INACTIVITE_MINUTES = 30 * 24 * 60;

/** Durée de session absolue, en minutes, applicable à ce rôle. */
export function dureeSessionMinutes(role: RoleUtilisateur, dureePersonneMinutes: number): number {
  return estCompteDeService(role) ? SESSION_COMPTE_DE_SERVICE_DUREE_MINUTES : dureePersonneMinutes;
}

/** Fenêtre d'inactivité, en minutes, applicable à ce rôle. */
export function inactiviteSessionMinutes(
  role: RoleUtilisateur,
  inactivitePersonneMinutes: number,
): number {
  return estCompteDeService(role)
    ? SESSION_COMPTE_DE_SERVICE_INACTIVITE_MINUTES
    : inactivitePersonneMinutes;
}

// =================================================================================================
// Portée de site d'un principal
// =================================================================================================

/**
 * SEUL accès sanctionné à `PrincipalAuthentifie.siteId`. Ne jamais lire le champ directement :
 * il est optionnel dans le type (voir son commentaire) et un `principal.siteId ?? null` recopié
 * ailleurs re-crée exactement le défaut fail-open que cette fonction existe pour empêcher.
 *
 * Rend :
 *  - `null` pour un compte de PERSONNE — aucune restriction de site, comportement inchangé depuis
 *    l'étape 0 ;
 *  - le site du compte pour un compte de SERVICE ;
 *  - lève `401 AUTH_SESSION_EXPIREE` pour un compte de service SANS site. Ce cas est impossible
 *    par contrainte de base (`utilisateur_site_compte_de_service_chk`) : s'il se produit
 *    néanmoins, c'est que la session a été résolue par un chemin qui ne remonte pas `site_id`
 *    (migration 0039 non appliquée, fonction d'amorçage périmée) — un état où le serveur ne SAIT
 *    pas à quel site la borne appartient. Refuser est la seule réponse correcte : accepter
 *    laisserait une borne agir sans portée, donc sur n'importe quel site du tenant.
 */
export function siteImposeAuPrincipal(principal: PrincipalAuthentifie): string | null {
  if (!estCompteDeService(principal.role)) return null;

  const siteId = principal.siteId ?? null;
  if (siteId === null) throw new ErreurSessionExpiree();
  return siteId;
}

/**
 * Site d'une borne, exigé. À appeler par tout traitement qui n'a de sens QUE pour un compte de
 * service (identification par PIN, écran de borne) : lève `401 AUTH_SESSION_EXPIREE` si le
 * principal n'est pas un compte de service.
 *
 * Ce n'est pas un contrôle d'autorisation — celui-ci reste porté par `@ExigerDroit(...)` et
 * `MATRICE_DROITS`. C'est une garantie de COHÉRENCE : le code appelant reçoit un `string`, jamais
 * un `string | null` qu'il devrait retraiter (et pourrait retraiter en fail-open).
 */
export function exigerSiteDuCompteDeService(principal: PrincipalAuthentifie): string {
  const siteId = siteImposeAuPrincipal(principal);
  if (siteId === null) throw new ErreurSessionExpiree();
  return siteId;
}

/**
 * Vérifie qu'un principal a le droit d'agir sur `siteId`.
 *
 * Un compte de personne passe toujours (aucune autorisation du produit n'est scopée par site — le
 * périmètre reste le tenant). Un compte de service ne passe que sur SON site : `403
 * DROIT_INSUFFISANT` sinon, jamais `404`, parce que le site existe bel et bien dans le tenant de
 * l'appelant et qu'il n'y a donc rien à dissimuler.
 *
 * À poser dans les services qui reçoivent un `siteId` (ou le déduisent d'un OR, d'une ligne, d'un
 * pointage) — pas dans un guard global : la position du site varie d'une route à l'autre, et un
 * guard qui devine cette position finit par ne rien vérifier sur celles qu'il n'a pas prévues.
 */
export function verifierSiteAutorise(principal: PrincipalAuthentifie, siteId: string): void {
  const sitePrincipal = siteImposeAuPrincipal(principal);
  if (sitePrincipal === null || sitePrincipal === siteId) return;
  throw new ErreurSiteHorsPortee();
}
