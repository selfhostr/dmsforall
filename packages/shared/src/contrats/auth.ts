/**
 * Contrats d'authentification partagés API <-> web.
 *
 * Propriété : l'équipe authentification (voir contrats-etape-0.md §2.5 et §2.10).
 * Rien ici ne doit être écrit à la main côté front une fois l'OpenAPI généré :
 * ce fichier reste la source de vérité pour les schémas zod de validation,
 * les types générés depuis l'OpenAPI reprennent la forme des interfaces.
 */
import { z } from 'zod';

import type { CapacitesPersonne } from './capacites';
import { LANGUES, type Langue, type RoleUtilisateur } from './enums';
import type { ModuleApp } from './modules';
import type { SiteResume, TenantCourant } from './socle';

/**
 * Schéma de connexion.
 *
 * IMPORTANT : `motDePasse` n'utilise QUE `min(1)` ici — un formulaire de
 * connexion ne doit jamais divulguer la politique de mot de passe (longueur
 * minimale) à un attaquant non authentifié, ET ne doit jamais casser la connexion d'un compte
 * existant dont le mot de passe ne respecterait pas la politique courante (voir
 * `schemaMotDePasseNouveau` ci-dessous — la politique ne s'applique QU'au moment où un mot de
 * passe est choisi, jamais à sa vérification). `min(1)` reste donc figé ici, volontairement,
 * même après l'introduction de la politique de mot de passe.
 */
export const schemaConnexion = z
  .object({
    email: z.string().trim().toLowerCase().email().max(320),
    motDePasse: z.string().min(1).max(256),
  })
  .strict();
export type EntreeConnexion = z.infer<typeof schemaConnexion>;

/**
 * Politique de mot de passe — s'applique UNIQUEMENT au moment où un mot de passe est CHOISI par
 * un humain. Aujourd'hui, un seul chemin existe : la confirmation de réinitialisation en
 * libre-service (`schemaConfirmationReinitialisationMotDePasse` ci-dessous). La création d'un
 * employé et la réinitialisation d'accès par un admin/direction ne demandent JAMAIS de mot de
 * passe en entrée — le serveur en génère un (haute entropie, `auth/generateur-mot-de-passe-
 * temporaire.ts`), donc cette politique ne les concerne pas : un mot de passe généré par CSPRNG
 * la respecte par construction, très largement.
 *
 * CHOIX RETENU — longueur minimale 12, AUCUNE règle de composition imposée (pas de majuscule, de
 * chiffre ou de symbole obligatoire) :
 *
 *  - Aligné sur NIST SP 800-63B (et son évolution 2024) : la longueur est le facteur dominant de
 *    résistance à la force brute, la composition imposée pousse vers des motifs prévisibles
 *    (« Password1! ») sans gagner d'entropie réelle, et dégrade l'utilisabilité sans bénéfice de
 *    sécurité mesuré — recommandation explicite de NE PAS imposer de composition.
 *  - 12 plutôt que le minimum SHALL de 8 (marge réelle) ou le SHOULD de 15 des révisions les plus
 *    récentes : compromis délibéré pour un mécanicien qui tape sur une tablette d'atelier, parfois
 *    ganté — un mot de passe plus long qu'un mnémonique de 12 caractères sans exigence de symboles
 *    reste raisonnablement saisissable, alors que 15+ commence à décourager les phrases de passe
 *    simples (« garageSion2026 ») au profit de mots de passe courts+complexes moins mémorisables,
 *    l'inverse de ce que la longueur sans composition cherche à obtenir.
 *  - Le refus des mots de passe connus/compromis (liste des plus courants) et de ceux contenant
 *    l'email de l'employé N'EST PAS exprimable en zod (schéma sans contexte, partagé par le
 *    bundle web) : appliqué côté serveur SEUL, `apps/api/src/auth/politique-mot-de-passe.ts`,
 *    juste après cette validation structurelle.
 *
 * Parc existant : AUCUNE réapplication rétroactive. Un compte créé avant cette politique (mot de
 * passe généré, donc déjà conforme en pratique) ou un mot de passe historique plus court continue
 * de fonctionner À LA CONNEXION (`schemaConnexion` ci-dessus, inchangé) — seul un CHANGEMENT de
 * mot de passe est soumis à cette règle, jamais sa simple vérification.
 */
export const LONGUEUR_MOT_DE_PASSE_MIN = 12;

export const schemaMotDePasseNouveau = z.string().min(LONGUEUR_MOT_DE_PASSE_MIN).max(256);

/**
 * Corps de `POST /auth/mot-de-passe/oubli` — demande de réinitialisation en libre-service.
 *
 * Réponse IDENTIQUE que l'email corresponde ou non à un compte réel (anti-énumération, même
 * doctrine que `POST /auth/connexion`) : `.strict()` seul suffit ici, aucune règle de mot de
 * passe n'entre en jeu à cette étape.
 */
export const schemaDemandeReinitialisationMotDePasse = z
  .object({
    email: z.string().trim().toLowerCase().email().max(320),
  })
  .strict();
export type EntreeDemandeReinitialisationMotDePasse = z.infer<
  typeof schemaDemandeReinitialisationMotDePasse
>;

/**
 * Corps de `POST /auth/mot-de-passe/reinitialisation` — confirmation d'une réinitialisation en
 * libre-service : jeton reçu par courriel + nouveau mot de passe choisi par l'employé.
 *
 * `email` redemandé ICI (en plus du jeton) : c'est ce qui évite au serveur d'avoir besoin d'une
 * 7e opération d'amorçage hors-tenant (`AccesAmorcage`, `db/db.types.ts`) pour retrouver le
 * tenant à partir du seul jeton — `amorcage.utilisateur_par_email` (déjà utilisée par la
 * connexion) suffit à résoudre le tenant, PUIS le jeton est vérifié DANS ce tenant. Le connaître
 * ne renseigne rien à un attaquant qui ne l'a pas déjà (c'est lui qui l'a saisi).
 */
export const schemaConfirmationReinitialisationMotDePasse = z
  .object({
    email: z.string().trim().toLowerCase().email().max(320),
    jeton: z.string().min(1).max(512),
    nouveauMotDePasse: schemaMotDePasseNouveau,
  })
  .strict();
export type EntreeConfirmationReinitialisationMotDePasse = z.infer<
  typeof schemaConfirmationReinitialisationMotDePasse
>;

/**
 * Corps de `POST /auth/mot-de-passe/changement` (issue #58) -- la personne connectée remplace son
 * mot de passe. Le mot de passe actuel est exigé (un cookie volé ne suffit pas à le changer).
 */
export const schemaChangementMotDePasse = z
  .object({
    motDePasseActuel: z.string().min(1).max(256),
    nouveauMotDePasse: schemaMotDePasseNouveau,
  })
  .strict();
export type EntreeChangementMotDePasse = z.infer<typeof schemaChangementMotDePasse>;

/**
 * Corps de `PATCH /auth/moi/langue` (issue #62) -- la langue d'interface est une préférence du
 * PROFIL (jamais du poste) : un poste partagé affiche la langue de la personne connectée.
 */
export const schemaChangementLangue = z.object({ langue: z.enum(LANGUES) }).strict();
export type EntreeChangementLangue = z.infer<typeof schemaChangementLangue>;

export interface UtilisateurCourant {
  readonly id: string;
  readonly email: string;
  readonly prenom: string;
  readonly nom: string;
  readonly role: RoleUtilisateur;
  readonly langue: Langue;
}

/** Corps identique pour POST /auth/connexion et GET /auth/moi. */
export interface SessionCourante {
  readonly utilisateur: UtilisateurCourant;
  /**
   * `true` tant que la personne n'a pas remplacé son mot de passe temporaire (issue #58) : le
   * serveur refuse alors tout sauf le changement de mot de passe. Absent = `false` (anciennes
   * réponses).
   */
  readonly motDePasseAChanger?: boolean;
  readonly tenant: TenantCourant;
  /**
   * Sites sur lesquels CE compte peut agir — jamais « tous les sites du tenant » par principe.
   *
   * - compte de personne (`ROLES_PERSONNE`) : tous les sites du tenant, comme depuis l'étape 0 ;
   * - compte de service (`ROLES_COMPTE_DE_SERVICE`, ex. la borne d'atelier) : exactement UN site,
   *   celui de `siteRattachementId`.
   *
   * Le front ne doit donc jamais offrir un sélecteur de site à un compte de service : la liste
   * n'en contient qu'un.
   */
  readonly sites: readonly SiteResume[];
  /**
   * Site auquel le COMPTE est structurellement rattaché (`utilisateur.site_id`), `null` pour un
   * compte de personne (qui n'est rattaché à aucun site en particulier).
   *
   * Renseigné exactement pour les rôles de `ROLES_COMPTE_DE_SERVICE`. Côté serveur, la valeur
   * faisant foi est `PrincipalAuthentifie.siteId`, résolue depuis la session — ce champ n'est que
   * sa projection pour l'affichage (« Borne — atelier de Sion »), jamais une entrée à renvoyer
   * au serveur.
   */
  readonly siteRattachementId: string | null;
  /**
   * Site principal de la personne (`utilisateur.site_principal_id`) : défaut des filtres de site.
   * `null` pour une borne ou une personne sans affectation. Ne confère aucun droit.
   */
  readonly sitePrincipalId: string | null;
  /**
   * Actions de la matrice (`auth/matrice-droits.ts`) détenues par le rôle de ce compte, triées.
   * Lues côté serveur depuis la matrice : le front n'a plus à la recopier à la main. Informatif
   * pour l'affichage (bouton visible ou non) — le serveur re-vérifie toujours chaque requête.
   */
  readonly actions: readonly string[];
  /**
   * Grille de capacités de CE compte (`CapacitesPersonne`) : niveaux par domaine, encadrer,
   * options (voit les montants, voit les prix d'achat, avoirs plafonnés). Pour afficher « Marc
   * (Technicien, personnalisé) » ou griser une option ; la décision reste `actions`. Une borne a
   * une grille vide (profil d'appareil figé).
   */
  readonly capacites: CapacitesPersonne;
  /**
   * Modules effectivement actifs pour le garage (`GET|PATCH /parametres-modules`). Le front filtre
   * menus, routes et raccourcis dessus sans requête de plus ; le serveur refuse de toute façon les
   * écritures d'un module désactivé (`MODULE_DESACTIVE`).
   */
  readonly modulesActifs: readonly ModuleApp[];
  readonly expireLe: string; // ISO 8601
}
