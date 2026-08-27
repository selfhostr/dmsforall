import type { RoleUtilisateur } from '@dfa/shared';

import { ErreurMetier } from '../common/erreurs';

/**
 * PALLIATIF TEMPORAIRE — `apps/api/src/clients/**` (périmètre d'écriture de cette tâche) n'a PAS
 * accès en écriture à `apps/api/src/auth/matrice-droits.ts` (propriété d'un autre agent). Les deux
 * actions introduites pour RA-14 (`docs/specification-relances-automatiques.md` §5, « un client
 * peut demander l'arrêt de tout contact ») n'existent donc pas encore dans la matrice :
 *   - `client.contact.arreter`   (POST /clients/{id}/arreter-contact)
 *   - `client.contact.reprendre` (POST /clients/{id}/reprendre-contact)
 *
 * MÊME SITUATION, MÊME SOLUTION que celle déjà éprouvée trois fois dans ce dépôt (`pneus/
 * droits-provisoires.ts`, `relances/droits-provisoires.ts`, `tableau-bord/droits-provisoires.ts`,
 * les deux derniers RETIRÉS depuis que `matrice-droits.ts` porte leurs droits définitifs — voir
 * l'historique git) : les deux routes portent `@AucunDroitRequis()` (authentifié suffit pour
 * passer `GardeDroit`, `common/droits/garde-droit.ts`) et la vérification RÉELLE du rôle est faite
 * ICI, appelée en tout DÉBUT de chaque méthode concernée de `ServiceClient`
 * (`arreterContact`/`reprendreContact`), AVANT tout accès base — jamais un accès ouvert à tout
 * rôle authentifié en attendant que la matrice soit mise à jour.
 *
 * À FAIRE PAR expert-auth quand `matrice-droits.ts` est accessible à cette tâche : ajouter les
 * deux actions ci-dessus à `Action` (`auth/matrice-droits.ts`), une entrée `ROLES_CLIENT_CONTACT`
 * fusionnée dans `MATRICE_DROITS` avec EXACTEMENT les rôles ci-dessous (alignés sur `INFERE_
 * CLIENT_CONTACT`, déjà en place pour `client.consentement.enregistrer`/`client.note.ecrire` — RA-14
 * est la même famille de geste : contact opérationnel avec le client), puis dans CE module :
 * remplacer `@AucunDroitRequis()` par `@ExigerDroit('client.contact.arreter' | 'client.contact.
 * reprendre')` sur `client.controller.ts`, et retirer les appels à `verifierRoleAutorise` (devenus
 * redondants avec `GardeDroit`), et enfin supprimer ce fichier.
 */

/**
 * Réceptionnaire, chef d'atelier, direction — MÊME jeu de rôles que `INFERE_CLIENT_CONTACT`
 * (`auth/matrice-droits.ts`, gouvernant `client.consentement.enregistrer` et `client.note.ecrire`) :
 * RA-14 est la même famille de geste — un contact opérationnel avec la fiche client — pas une
 * décision financière (`client.condition.modifier`, direction seule) ni une simple lecture.
 * `magasinier` EXCLU comme pour `INFERE_CLIENT_CONTACT` : il a l'écriture générale de la fiche
 * (§10 L958) pour ses propres besoins de saisie, pas la gestion de la relation client. `comptable`/
 * `vendeur`/`technicien`/`poste_atelier` EXCLUS : aucun d'eux n'est au contact du client au sens de
 * RA-14. `admin` LISTÉ EXPLICITEMENT (comme dans `ROLES_PNEUS_DEPOT_ECRITURE` et consorts) : ce
 * tableau plat n'a pas le mécanisme de composition par héritage de `matrice-droits.ts` (`DROITS_
 * ADMIN = DROITS_DIRECTION`, etc.) — chaque rôle qui doit passer `verifierRoleAutorise` doit
 * figurer ici en toutes lettres.
 */
export const ROLES_CLIENT_CONTACT: readonly RoleUtilisateur[] = [
  'admin',
  'direction',
  'receptionnaire',
  'chef_atelier',
];

// Le palliatif jumeau qui vivait ici pour le droit d'effacement nLPD (`client.anonymiser`,
// `client.export.generer`) a été RETIRÉ (tâche « socle sécurité pré-production ») : les deux
// actions sont désormais dans `auth/matrice-droits.ts` (`INFERE_CLIENT_ANONYMISATION`/
// `INFERE_CLIENT_EXPORT`), et `client-rgpd.controller.ts` porte `@ExigerDroit(...)` — plus aucun
// appel à `verifierRoleAutorise` pour ces deux gestes. Voir l'historique git pour le detail.

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
