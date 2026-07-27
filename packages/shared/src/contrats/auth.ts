/**
 * Contrats d'authentification partagés API <-> web.
 *
 * Propriété : expert-auth (voir contrats-etape-0.md §2.5 et §2.10).
 * Rien ici ne doit être écrit à la main côté front une fois l'OpenAPI généré :
 * ce fichier reste la source de vérité pour les schémas zod de validation,
 * les types générés depuis l'OpenAPI reprennent la forme des interfaces.
 */
import { z } from 'zod';

import type { Langue, RoleUtilisateur } from './enums';
import type { SiteResume, TenantCourant } from './socle';

/**
 * Schéma de connexion.
 *
 * IMPORTANT : `motDePasse` n'utilise QUE `min(1)` ici — un formulaire de
 * connexion ne doit jamais divulguer la politique de mot de passe (longueur
 * minimale, complexité) à un attaquant non authentifié. La règle `min(12)`
 * ne s'applique qu'à la création ou au changement de mot de passe, hors
 * périmètre de l'étape 0.
 */
export const schemaConnexion = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  motDePasse: z.string().min(1).max(256),
});
export type EntreeConnexion = z.infer<typeof schemaConnexion>;

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
  readonly tenant: TenantCourant;
  readonly sites: readonly SiteResume[];
  readonly expireLe: string; // ISO 8601
}
