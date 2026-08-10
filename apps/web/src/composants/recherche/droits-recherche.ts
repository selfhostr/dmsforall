import type { RoleUtilisateur, TypeResultatRecherche } from '@dfa/shared';
import { TYPES_RESULTAT_RECHERCHE } from '@dfa/shared';

/**
 * Portillons de droit propres à CHAQUE nature de `GET /recherche` — dupliqués depuis
 * `apps/api/src/auth/matrice-droits.ts` (lus par `ServiceRecherche.rechercher`,
 * `apps/api/src/recherche/service-recherche.ts`), même chaîne de duplication assumée que
 * `ecrans/pieces/droits.ts` / `routes/droits-routes.ts` (frontière tenant/serveur jamais
 * franchie, le serveur reste l'arbitre final — un rôle sans le droit ne voit JAMAIS le résultat
 * correspondant, quoi que ce fichier calcule).
 *
 * RAISON D'ÊTRE, DISTINCTE des autres `droits.ts` du dépôt : ceux-là gardent une ACTION ou
 * l'ATTEINTE d'une route. Celui-ci ne garde rien — `GET /recherche` reste appelé pour tout rôle
 * authentifié, exactement comme avant. Il sert uniquement à ce que `PanneauResultatsRecherche`
 * puisse dire honnêtement « je n'ai pas cherché partout » plutôt que d'afficher un « aucun
 * résultat » qui laisserait croire que la donnée n'existe pas (défaut constaté : `admin` cherche
 * une référence d'article réellement présente au jeu de démo, `pieces.article.lire` lui est fermé
 * — RF-115 — et « Aucun résultat » sonne comme une absence de donnée alors que c'est une absence
 * de recherche à cet endroit).
 *
 * `vehicule`, `client`, `ordre_reparation` n'ont AUCUN portillon côté serveur (voir le corps de
 * `ServiceRecherche.rechercher` : seuls `document_vente`/`article`/`fournisseur`/`depot_pneu`
 * portent un portillon de droit SUPPLÉMENTAIRE, indépendant de `recherche.executer` déjà vérifié
 * pour les sept natures au niveau route) — toujours interrogées, quel que soit le rôle.
 */
const NATURES_TOUJOURS_CHERCHEES: ReadonlySet<TypeResultatRecherche> = new Set([
  'vehicule',
  'client',
  'ordre_reparation',
]);

/**
 * `facturation.document.lire` — fermé au seul `poste_atelier` (compte de service, `[]` littéral
 * sur tout le domaine facturation). Ouvert à `admin` : la note de tête de
 * `apps/api/src/recherche/service-recherche.ts` (§RF-116) le qualifie explicitement de « no-op
 * fonctionnel » aujourd'hui — accordé à TOUS les rôles de personne, `admin` compris.
 */
const ROLES_LECTURE_DOCUMENT_VENTE: ReadonlySet<RoleUtilisateur> = new Set([
  'admin',
  'direction',
  'comptable',
  'vendeur',
  'receptionnaire',
  'chef_atelier',
  'magasinier',
  'technicien',
]);

/** `pieces.article.lire` — fermé à `admin` ET `poste_atelier` (RF-115, `[]` littéral sur tout le
 *  domaine pièces y compris la simple lecture — `DROITS_PIECES_PAR_ROLE` côté API). */
const ROLES_LECTURE_ARTICLE: ReadonlySet<RoleUtilisateur> = new Set([
  'direction',
  'comptable',
  'vendeur',
  'receptionnaire',
  'chef_atelier',
  'magasinier',
  'technicien',
]);

/** `pieces.fournisseur.lire` — `direction`/`chef_atelier`/`magasinier` SEULS (plus étroit que la
 *  lecture article : ni `comptable`, ni `vendeur`, ni `receptionnaire`, ni `technicien`). */
const ROLES_LECTURE_FOURNISSEUR: ReadonlySet<RoleUtilisateur> = new Set([
  'direction',
  'chef_atelier',
  'magasinier',
]);

/** `pneus.depot.lire` — ouvert à tous les rôles de personne, `poste_atelier` SEUL exclu (l'écran
 *  mural de l'atelier n'a aucune utilité au hangar à pneus). */
const ROLES_LECTURE_DEPOT_PNEU: ReadonlySet<RoleUtilisateur> = new Set([
  'admin',
  'direction',
  'comptable',
  'vendeur',
  'receptionnaire',
  'chef_atelier',
  'magasinier',
  'technicien',
]);

/** Portillon par nature GARDÉE (les trois de `NATURES_TOUJOURS_CHERCHEES` n'y figurent pas). */
const PORTILLONS_PAR_NATURE: Partial<Record<TypeResultatRecherche, ReadonlySet<RoleUtilisateur>>> =
  {
    document_vente: ROLES_LECTURE_DOCUMENT_VENTE,
    article: ROLES_LECTURE_ARTICLE,
    fournisseur: ROLES_LECTURE_FOURNISSEUR,
    depot_pneu: ROLES_LECTURE_DEPOT_PNEU,
  };

/**
 * Natures RÉELLEMENT interrogées par `GET /recherche` pour ce rôle (§7.5 `contrats-api-etape-1`),
 * dans l'ordre canonique de `TYPES_RESULTAT_RECHERCHE`. Un rôle `undefined` signifie que la
 * session n'a PAS (encore) livré de rôle exploitable — en cours de résolution (`useSession` avec
 * `isPending`), ou résolue à « pas de session » (401 sur `/auth/moi`, `useSession().data === null`).
 * CE N'EST PAS un cas théorique bloqué par `RouteProtegee` : la palette de commande (`Ctrl+K`) est
 * montée dans l'en-tête, donc affichable AVANT que `RouteProtegee` ait eu la moindre chance
 * d'intervenir — constaté par l'échec réel de `EcranRecherche.spec.tsx` avant ce correctif (401 sur
 * la session, palette déjà montée). Le rôle réellement utilisé côté serveur pour exécuter la
 * recherche reste inconnu ici dans ce cas : cette fonction reste un minorant SÛR des natures
 * GARANTIES cherchées (les trois toujours interrogées, indépendamment du rôle), mais ne doit
 * JAMAIS servir à affirmer qu'un périmètre est restreint — voir `recherchePerimetreRestreint`, qui
 * retourne délibérément `false` pour un rôle `undefined`, précisément pour empêcher ça.
 */
export function naturesRechercheesPourRole(
  role: RoleUtilisateur | undefined,
): readonly TypeResultatRecherche[] {
  return TYPES_RESULTAT_RECHERCHE.filter((nature) => {
    if (NATURES_TOUJOURS_CHERCHEES.has(nature)) {
      return true;
    }
    const portillon = PORTILLONS_PAR_NATURE[nature];
    return portillon !== undefined && role !== undefined && portillon.has(role);
  });
}

/**
 * `true` quand on SAIT, à coup sûr, qu'au moins une nature de `GET /recherche` n'a pas été
 * interrogée pour ce rôle — c'est ce qui distingue « aucun résultat parce que la donnée n'existe
 * pas » de « aucun résultat dans ce que j'ai eu le droit de chercher », voir
 * `PanneauResultatsRecherche`.
 *
 * `role === undefined` retourne TOUJOURS `false` : la session n'a pas encore livré de rôle
 * exploitable (en cours de résolution, ou résolue à « pas de session ») — le portillon de droit
 * réel, lui, est appliqué côté serveur sur la session serveur, qui a bel et bien cherché dans les
 * sept natures. Affirmer ici un périmètre restreint qu'on ne peut pas prouver serait FAUX, pas
 * seulement prudent — exactement le défaut constaté en revue (RF-11x) : un réceptionnaire ouvrant
 * la palette avant résolution de session recevait « votre recherche a porté sur véhicules, clients
 * et ordres de réparation », alors que le serveur avait réellement cherché partout. Sous-annoncer
 * (message plat, `PanneauResultatsRecherche` retombe sur `vide.description`) est sûr ; prétendre un
 * périmètre non vérifié ne l'est pas.
 */
export function recherchePerimetreRestreint(role: RoleUtilisateur | undefined): boolean {
  if (role === undefined) {
    return false;
  }
  return naturesRechercheesPourRole(role).length < TYPES_RESULTAT_RECHERCHE.length;
}
