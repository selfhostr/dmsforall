/**
 * Détail additionnel du `problem+json` d'un `409 VEHICULE_PLAQUE_COLLISION` (RM-18, CT-06,
 * `vehicule_plaque_collision_excl`) — dette technique n°6 : nommer le véhicule qui porte déjà la
 * plaque en conflit, pour que la réceptionniste puisse y aller sans partir en chasse dans la
 * liste des véhicules.
 *
 * Transporté dans `ProblemeDetail.blocages[0].donnees` (`ElementBloquant`, `type: 'champ'`), PAS
 * via une évolution de l'enveloppe `problem+json` elle-même : `blocages`/`donnees` sont DÉJÀ le
 * mécanisme additif prévu à cet effet (`packages/shared/src/contrats/probleme.ts`, voir note de
 * livraison si un `TypeElementBloquant` dédié `'vehicule'` devient souhaitable pour ce cas et ses
 * semblables futurs).
 *
 * `blocages[0].id` VARIE selon la route qui a levé l'erreur — et c'est VOULU (issue #95 :
 * confirmé, pas corrigé). `ElementBloquant.id` documente lui-même sa double nature (`probleme.ts`) :
 * « uuid de l'élément ; nom du champ quand `type = 'champ'` ». Pour `'champ'`, `id` est TOUJOURS le
 * nom du champ FAUTIF DANS LE CORPS DE LA REQUÊTE QUI A ÉCHOUÉ — jamais un identifiant de rôle
 * stable partagé entre endpoints. C'est la convention déjà en vigueur partout ailleurs dans l'API
 * pour ce type (`atelier/service-transitions.ts` : `'kilometrageEntree'`, `'numeroCommandeInterne'` ;
 * `vehicules/service-vehicule-kilometrage.ts` : `'valeur'`), donc :
 *   - `POST /vehicules` (`service-vehicule.ts::relancerErreurContraintePlaqueCreation`) :
 *     `id: 'plaque'` — nom du champ dans `EntreeCreationVehicule`.
 *   - `POST /vehicules/{id}/plaques` (`service-vehicule-plaque.ts::creer`) : `id: 'valeur'` — nom
 *     du champ dans `EntreePlaqueVehicule`.
 * Un écran qui brancherait en dur sur l'une des deux valeurs casserait sur l'autre endpoint : ne
 * JAMAIS lire `blocages[0].id` pour ce code. Le consommateur front actuel
 * (`DialogueModifierIdentiteVehicule.tsx`) fait déjà ça bien — il ne lit QUE
 * `blocages[0].donnees` (cast vers `DetailCollisionPlaqueVehicule`), jamais `.id` — c'est le seul
 * usage à préserver.
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
