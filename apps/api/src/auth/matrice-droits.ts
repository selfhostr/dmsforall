/**
 * Matrice rôle × action — source de vérité UNIQUE de l'autorisation.
 *
 * Ce fichier ne contient que des données et des types : aucun import de NestJS, aucun service.
 * C'est délibéré. La matrice est lue par `common/droits/garde-droit.ts` ; si elle vivait dans le
 * même fichier que le garde, `common` importerait `auth` qui importe `common`, et le cycle rend
 * une classe `undefined` à l'exécution selon l'ordre de chargement des modules — panne qui ne se
 * manifeste que sur certains points d'entrée (l'API démarrait, l'export OpenAPI non).
 *
 * Un seul mécanisme d'autorisation existe dans le produit : `@ExigerDroit(...)` + `GardeDroit`.
 * L'ancien couple `@Roles`/`GardeRoles` a été supprimé — deux mécanismes concurrents lisant la
 * même matrice avec deux clés de métadonnées voisines (`dfa:action` / `dfa:actions`) créaient un
 * piège silencieux : décorer avec l'un et garder avec l'autre laissait passer TOUT rôle
 * authentifié, sans erreur ni test rouge.
 */

/**
 * Action métier protégée. Convention : `domaine.ressource.verbe`.
 * L'étape 1 (atelier, clients) en ajoutera une vingtaine — les ajouter ici et nulle part ailleurs.
 */
export type Action = 'socle.tenant.lire' | 'socle.site.lire';

/**
 * Lecture du socle : accordée à tous les rôles.
 *
 * Connaître son propre garage et ses sites est un préalable à toute utilisation de l'outil, y
 * compris pour un technicien qui ne fait que pointer. Les actions réellement sensibles
 * (écrire un site, gérer les utilisateurs, émettre une facture) arriveront avec les modules qui
 * les motivent et ne seront PAS accordées à tout le monde.
 */
const LECTURE_SOCLE: readonly Action[] = ['socle.tenant.lire', 'socle.site.lire'];

export const MATRICE_DROITS = {
  admin: LECTURE_SOCLE,
  direction: LECTURE_SOCLE,
  vendeur: LECTURE_SOCLE,
  receptionnaire: LECTURE_SOCLE,
  chef_atelier: LECTURE_SOCLE,
  technicien: LECTURE_SOCLE,
  magasinier: LECTURE_SOCLE,
  comptable: LECTURE_SOCLE,
} as const satisfies Readonly<Record<string, readonly Action[]>>;
