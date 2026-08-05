import type { RoleUtilisateur } from '@dfa/shared';

import { ErreurMetier } from '../common/erreurs';

/**
 * PALLIATIF TEMPORAIRE — `apps/api/src/relances/**` (périmètre d'écriture de cet agent) n'a PAS
 * accès en écriture à `apps/api/src/auth/matrice-droits.ts` (propriété d'un autre agent). Les
 * quatre actions proposées par ce lot n'existent donc pas encore :
 *   - `relances.facturation.regle.lire`
 *   - `relances.facturation.regle.ecrire`
 *   - `relances.facturation.planifier`
 *   - `relances.facturation.envoyer`
 *
 * MÊME SITUATION, MÊME SOLUTION déjà éprouvée deux fois dans ce dépôt (`pneus/droits-
 * provisoires.ts`, `tableau-bord/droits-provisoires.ts`, tous deux retirés depuis que leurs
 * actions ont rejoint la matrice) : les routes portent `@AucunDroitRequis()` (authentifié suffit
 * pour passer `GardeDroit`, `common/droits/garde-droit.ts`) et la vérification RÉELLE du rôle est
 * faite ICI, en service, AVANT toute lecture ou écriture de données — jamais un accès ouvert à
 * tout rôle authentifié en attendant que la matrice soit mise à jour. `verifierRoleAutorise` est
 * appelée en tout DÉBUT de chaque méthode des deux services de ce module
 * (`ServiceRegleRelance`/`ServiceRelancesFacture`), avant tout appel à `AccesBase.enTenant`.
 *
 * À FAIRE PAR expert-auth quand `matrice-droits.ts` est accessible à cette tâche : ajouter les
 * quatre actions ci-dessus à `TOUTES_ACTIONS`, deux blocs `ROLES_RELANCES_FACTURATION_*_PAR_ROLE`
 * (mêmes rôles qu'ici, EXACTEMENT), les fusionner dans `MATRICE_DROITS`, puis dans CE module :
 * remplacer `@AucunDroitRequis()` par `@ExigerDroit('relances.facturation.regle.lire' | ...)` sur
 * les routes correspondantes de `relances.controller.ts`, et supprimer les appels à
 * `verifierRoleAutorise` (devenus redondants avec `GardeDroit`).
 */

/**
 * Lecture (`GET /relances/regles`) ET écriture (`PUT /relances/regles/{typeRelance}`,
 * `POST /relances/facturation/planifier`, `POST /relances/facturation/envoyer`) — UN SEUL jeu de
 * rôles pour les deux, contrairement à `ROLES_PNEUS_DEPOT_LECTURE`/`ECRITURE` (qui distinguent
 * lecture ouverte et écriture restreinte) : ici, même LIRE la configuration ou les compteurs de
 * planification expose une politique de relance CLIENT (quels délais, quels canaux) qui est déjà
 * une décision commerciale/financière, pas un fait neutre comme un statut d'OR. Aligné sur le
 * palier de gouvernance déjà posé pour tout ce qui touche au rappel de facture
 * (`ROLES_TABLEAU_BORD_FINANCIER`, `tableau-bord/droits-provisoires.ts`, retiré depuis, mais
 * dont le choix — `direction` + `comptable` SEULS — reste la référence) : `admin` EXCLU
 * délibérément (`RF-115`, littéral : « admin est un rôle technique et n'a aucun droit
 * financier » — un rappel de facture EST une action financière, pas une action technique).
 * `vendeur`/`receptionnaire`/`chef_atelier`/`technicien`/`magasinier` EXCLUS : déclencher un envoi
 * de rappel à un client, ou configurer QUAND et COMMENT il part, n'est le geste d'aucun de ces
 * rôles dans ce dépôt.
 */
export const ROLES_RELANCES_FACTURATION: readonly RoleUtilisateur[] = ['direction', 'comptable'];

/** Lève `403 DROIT_INSUFFISANT` si `role` n'est pas dans `rolesAutorises` — voir l'en-tête de ce
 *  fichier : appelée en tout début de service, AVANT tout accès base. */
export function verifierRoleAutorise(
  role: RoleUtilisateur,
  rolesAutorises: readonly RoleUtilisateur[],
  nomAction: string,
): void {
  if (!rolesAutorises.includes(role)) {
    throw new ErreurMetier(
      'DROIT_INSUFFISANT',
      `Le rôle "${role}" n'a pas accès à "${nomAction}".`,
    );
  }
}
