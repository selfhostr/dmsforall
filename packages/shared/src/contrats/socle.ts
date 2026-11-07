import { z } from 'zod';

import { ROLES_PERSONNE, type Langue, type RolePersonne, type StatutUtilisateur } from './enums';
import type { PageCurseur } from './pagination';
import { IDS_PREREGLAGE, type CapacitesPersonne } from './capacites';

/** Corps de `GET /api/v1/tenant/courant`. */
export interface TenantCourant {
  readonly id: string;
  readonly slug: string;
  readonly raisonSociale: string;
  readonly langueDefaut: Langue;
}

/** Élément de `GET /api/v1/sites` et corps de `GET /api/v1/sites/{siteId}`. */
export interface SiteResume {
  readonly id: string;
  readonly code: string;
  readonly nom: string;
  readonly actif: boolean;
}

// =================================================================================================
// Gestion des employés (issue #137) — le patron d'un garage crée/gère lui-même les accès de ses
// employés, sans passer par l'éditeur. `apps/api/src/socle/service-utilisateur.ts` (droits
// `socle.utilisateur.*`, `direction`/`admin` seuls, `auth/matrice-droits.ts`).
// =================================================================================================

/** Un site où travaille l'employé — affichage/planning uniquement, voir `UtilisateurResume`. */
export interface SiteAffecteResume {
  readonly id: string;
  readonly nom: string;
}

/**
 * Élément de `GET /api/v1/utilisateurs` — « qui a quel rôle sur quel site, d'un coup d'œil ».
 *
 * `sites` est PUREMENT DESCRIPTIF (migration 0054, table `utilisateur_site`) : le rôle vaut sur
 * tout le tenant, AUCUN droit n'est scopé par site. Une liste vide signifie seulement « pas
 * encore renseigné où travaille cette personne », jamais une restriction d'accès.
 */
export interface UtilisateurResume {
  readonly id: string;
  readonly prenom: string;
  readonly nom: string;
  readonly email: string;
  readonly role: RolePersonne;
  /** Grille de capacités de la personne (le rôle n'en est que le préréglage d'origine). */
  readonly capacites: CapacitesPersonne;
  readonly statut: StatutUtilisateur;
  readonly sites: readonly SiteAffecteResume[];
  /** ISO 8601, `null` si l'employé ne s'est encore jamais connecté. */
  readonly derniereConnexionLe: string | null;
  readonly creeLe: string;
}

export type PageUtilisateurResume = PageCurseur<UtilisateurResume>;

/**
 * Tuple non vide requis par `z.enum` — `ROLES_PERSONNE` est calculé (`.filter()`), donc typé
 * `readonly RolePersonne[]`, pas une tuple littérale. Le cast est sûr : `ROLES_UTILISATEUR`
 * (source) est une constante `as const` non vide et le restera (retrait d'un rôle = migration).
 */
const ROLES_PERSONNE_TUPLE = ROLES_PERSONNE as unknown as [RolePersonne, ...RolePersonne[]];

const schemaEmailUtilisateur = z.string().trim().toLowerCase().min(3).max(320).email();
const schemaNomPersonne = z.string().trim().min(1).max(100);
const schemaSiteIds = z.array(z.string().uuid()).min(1).max(50);

/** Corps de `POST /api/v1/utilisateurs`. `.strict()` : un `tenantId` glissé dans le corps est
 *  REFUSÉ (400 VALIDATION_ECHOUEE), jamais silencieusement ignoré — le tenant vient exclusivement
 *  de la session (doctrine produit n°1). Aucun mot de passe n'est demandé : le serveur en génère
 *  un et le rend une seule fois dans la réponse (`ReponseAccesTemporaire`) — personne ne choisit
 *  le mot de passe d'autrui. */
export const schemaCreationUtilisateur = z
  .object({
    prenom: schemaNomPersonne,
    nom: schemaNomPersonne,
    email: schemaEmailUtilisateur,
    role: z.enum(ROLES_PERSONNE_TUPLE),
    /** Préréglage de départ (défaut : celui du rôle). Son rôle d'origine doit égaler `role`. */
    prereglage: z.enum(IDS_PREREGLAGE).optional(),
    siteIds: schemaSiteIds,
  })
  .strict();
export type EntreeCreationUtilisateur = z.infer<typeof schemaCreationUtilisateur>;

/** Corps de `PATCH /api/v1/utilisateurs/{id}` — au moins un des deux champs, `.strict()` (même
 *  doctrine tenant que la création). Ni prénom/nom/email ne se modifient ici : hors périmètre du
 *  besoin (« modifier son rôle ou ses sites quand il change de poste »). */
export const schemaModificationUtilisateur = z
  .object({
    role: z.enum(ROLES_PERSONNE_TUPLE).optional(),
    /** Avec `role` : préréglage appliqué (ex. `fiduciaire` pour `comptable`). Défaut : celui du rôle. */
    prereglage: z.enum(IDS_PREREGLAGE).optional(),
    siteIds: schemaSiteIds.optional(),
  })
  .strict()
  .refine((valeur) => valeur.role !== undefined || valeur.siteIds !== undefined, {
    message: 'Au moins un champ (role ou siteIds) doit être fourni.',
  });
export type EntreeModificationUtilisateur = z.infer<typeof schemaModificationUtilisateur>;

/**
 * Mot de passe temporaire en clair — présent UNE SEULE FOIS, dans la réponse de création ou de
 * réinitialisation d'accès. Jamais persisté en clair, jamais journalisé (l'audit trace le geste,
 * pas la valeur — voir `apps/api/src/db/schema/audit-utilisateur.ts`).
 */
export interface ReponseAccesTemporaire {
  readonly motDePasseTemporaire: string;
}

/** Corps de `201 POST /api/v1/utilisateurs`. */
export interface ReponseCreationUtilisateur {
  readonly utilisateur: UtilisateurResume;
  readonly acces: ReponseAccesTemporaire;
}

// =================================================================================================
// Bornes d'atelier (comptes de service `poste_atelier`) — phase 0 rôles. Une borne est une
// tablette murale rattachée à UN site ; elle se connecte avec un identifiant et un mot de passe
// générés par le serveur. Les PIN de pointage sont, eux, par technicien (`PUT /pointage/pins`).
// Droits `socle.borne.*` : `direction` et `admin` seuls.
// =================================================================================================

/** Élément de `GET /api/v1/bornes`. */
export interface BorneResume {
  readonly id: string;
  /** Libellé affiché (ex. « Atelier Sion »). */
  readonly nom: string;
  /** Identifiant de connexion de la tablette (généré par le serveur). */
  readonly identifiant: string;
  readonly site: SiteAffecteResume;
  readonly statut: StatutUtilisateur;
  /** ISO 8601, `null` si la borne ne s'est encore jamais connectée. */
  readonly derniereConnexionLe: string | null;
  readonly creeLe: string;
}

export type PageBorneResume = PageCurseur<BorneResume>;

/** Corps de `POST /api/v1/bornes`. `.strict()` : un `tenantId` dans le corps est refusé (400). */
export const schemaCreationBorne = z
  .object({
    nom: z.string().trim().min(1).max(100),
    siteId: z.string().uuid(),
  })
  .strict();
export type EntreeCreationBorne = z.infer<typeof schemaCreationBorne>;

/** Corps de `201 POST /api/v1/bornes` : le mot de passe n'apparaît qu'ici, une seule fois. */
export interface ReponseCreationBorne {
  readonly borne: BorneResume;
  readonly acces: ReponseAccesTemporaire;
}
