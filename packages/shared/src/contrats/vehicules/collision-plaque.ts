/**
 * Détail additionnel du `problem+json` de `POST /vehicules/{vehiculeId}/plaques` quand l'attribution
 * échoue en `409 VEHICULE_PLAQUE_COLLISION` (RM-18, CT-06, `vehicule_plaque_collision_excl`) —
 * dette technique n°6 : nommer le véhicule qui porte déjà la plaque en conflit, pour que la
 * réceptionniste puisse y aller sans partir en chasse dans la liste des véhicules.
 *
 * Transporté dans `ProblemeDetail.blocages[0].donnees` (`ElementBloquant`, `type: 'champ'`,
 * `id: 'valeur'` — le champ du corps de requête qui porte la plaque en conflit), PAS via une
 * évolution de l'enveloppe `problem+json` elle-même : `blocages`/`donnees` sont DÉJÀ le mécanisme
 * additif prévu à cet effet (`packages/shared/src/contrats/probleme.ts`, hors périmètre de cette
 * livraison — voir note de livraison si un `TypeElementBloquant` dédié `'vehicule'` devient
 * souhaitable pour ce cas et ses semblables futurs).
 *
 * ABSENT (pas de `blocages` du tout sur l'erreur) dans le cas de course où la ligne fautive n'est
 * plus retrouvable au moment de la relecture (clôturée par une autre requête entre l'échec de
 * l'INSERT et la relecture) — jamais un objet à champs vides ou inventés.
 */
export interface DetailCollisionPlaqueVehicule {
  /** uuid du véhicule qui porte déjà la plaque — cible de la navigation proposée par le front. */
  readonly vehiculeId: string;
  readonly marque: string;
  readonly modele: string;
  readonly version: string | null;
  /** Valeur de la plaque en conflit, telle qu'enregistrée (peut différer en casse/espaces de
   *  celle saisie — normalisées identiques par `normaliser_recherche()`, jamais par du TypeScript). */
  readonly plaque: string;
  readonly canton: string | null;
  /** `jj.mm.aaaa`-compatible ISO (`aaaa-mm-jj`), période de validité de la plaque en conflit. */
  readonly debutLe: string;
  readonly finLe: string | null;
}
