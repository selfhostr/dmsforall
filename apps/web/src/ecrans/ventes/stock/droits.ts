import type { RoleUtilisateur } from '@dfa/shared';

/**
 * Gouvernance du sous-module véhicules en stock (VN/VO, étape 4) — DUPLIQUÉE ici depuis
 * `apps/api/src/auth/matrice-droits.ts` (bloc `DROITS_VENTES_PAR_ROLE`, constantes
 * `LECTURE_VEHICULE_STOCK`/`ECRITURE_VEHICULE_STOCK`/`CORRECTION_VEHICULE_STOCK`, ligne ~1186),
 * JAMAIS importée depuis `apps/api` (frontière tenant/serveur, jamais franchie — même règle que
 * `ecrans/pieces/droits.ts`). Un défensif d'ERGONOMIE, pas la seule ligne de défense : un rôle
 * sans le droit qui parviendrait quand même à soumettre une action reçoit un `403
 * DROIT_INSUFFISANT` géré normalement (bandeau d'erreur générique via `messageErreur`) — le
 * serveur reste l'arbitre final.
 *
 * Lecture (`ventes.vehicule_stock.lire`) : `direction`, `comptable`, `vendeur`, `receptionnaire`,
 * `chef_atelier` — PAS `technicien`, `magasinier`, `admin` (`[]` littéral côté matrice, RF-115 :
 * `admin` n'a AUCUN droit `ventes.*`, même palier que `pieces.*` et le domaine financier de la
 * facturation).
 *
 * Écriture (`ventes.vehicule_stock.creer` + `.modifier`, TOUJOURS accordées ensemble côté
 * matrice — couvre aussi `receptionner`, gardé par `.modifier` côté contrôleur) : `direction`
 * SEULE. La matrice API documente ce choix comme conservateur (`vendeur` traité `non` en
 * attendant `[À VALIDER, QV-15]`) — reflété tel quel ici, pas atténué.
 *
 * Correction exceptionnelle (`ventes.vehicule_stock.corriger` — couvre `remettre-disponible` ET
 * `marquer-vendu`, AJOUTÉ après le premier gel de `enums.ts` mais gardé par le MÊME droit côté
 * service, `apps/api/src/ventes/service-vehicule-stock.ts::marquerVendu` : « motif obligatoire,
 * droit `ventes.vehicule_stock.corriger` », doctrine identique — motif obligatoire) : `direction`
 * SEULE, même doctrine que `vehicule.detention.corriger` (étape 1).
 */
const ROLES_LECTURE_VEHICULE_STOCK: ReadonlySet<RoleUtilisateur> = new Set([
  'direction',
  'comptable',
  'vendeur',
  'receptionnaire',
  'chef_atelier',
]);

const ROLES_ECRITURE_VEHICULE_STOCK: ReadonlySet<RoleUtilisateur> = new Set(['direction']);

const ROLES_CORRECTION_VEHICULE_STOCK: ReadonlySet<RoleUtilisateur> = new Set(['direction']);

export function peutLireVehiculeStock(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_LECTURE_VEHICULE_STOCK.has(role);
}

/** Couvre `POST .../stock` (mise en stock), `PATCH .../stock` (modification) et
 *  `POST .../stock/receptionner` — les trois sont gardés par le MÊME droit côté contrôleur
 *  (`ventes.vehicule_stock.modifier`, sauf la création qui porte `.creer` — accordés ensemble
 *  ici, comme côté matrice). */
export function peutEcrireVehiculeStock(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_ECRITURE_VEHICULE_STOCK.has(role);
}

/** `POST .../stock/remettre-disponible` ET `POST .../stock/marquer-vendu` — même droit. */
export function peutCorrigerVehiculeStock(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_CORRECTION_VEHICULE_STOCK.has(role);
}

/** Les CINQ rôles qui détiennent au moins `ventes.vehicule_stock.lire` — dérivé de
 *  `ROLES_LECTURE_VEHICULE_STOCK` ci-dessus, pas une liste choisie séparément. Candidat pour
 *  `RouteProtegee.rolesAutorises` sur les trois routes de ce sous-module (voir le rapport de
 *  livraison) : un rôle absent d'ici se heurterait de toute façon à un `403` sur CHAQUE appel
 *  (liste, fiche, entrée en stock), un écran cassé de bout en bout plutôt qu'un refus explicite
 *  (même raisonnement que `ROLES_PIECES`, `routes/droits-routes.ts`).
 */
export const ROLES_VENTES_STOCK: readonly RoleUtilisateur[] = [
  'direction',
  'comptable',
  'vendeur',
  'receptionnaire',
  'chef_atelier',
];
