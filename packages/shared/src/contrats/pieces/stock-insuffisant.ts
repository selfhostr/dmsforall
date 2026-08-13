/**
 * Détail additionnel du `problem+json` d'un `409 STOCK_INSUFFISANT` (RP-15/PP-02,
 * `pieces/service-mouvement.ts::verifierDisponible`) — issue #15, point 3 : avant cette
 * addition, le refus portait bien le `code` machine stable mais AUCUNE donnée exploitable par le
 * front (le `detail` textuel, qui aurait porté les quantités, est explicitement documenté comme
 * « jamais affiché à l'utilisateur final » — `ErreurMetier`/`ProblemeDetail.detail`). Un magasinier
 * qui tentait de sortir plus de pièces que le disponible recevait donc un refus qui ne disait NI
 * combien était disponible NI combien était demandé — exactement le défaut que l'issue #15 décrit :
 * deviner à la place de savoir.
 *
 * Transporté dans `ProblemeDetail.blocages[0].donnees` (`ElementBloquant`, `type: 'champ'`), même
 * mécanisme et même convention que `DetailCollisionPlaqueVehicule`
 * (`contrats/vehicules/collision-plaque.ts`) : `blocages[0].id` porte le nom du champ fautif DANS
 * LE CORPS DE LA REQUÊTE qui a échoué (`quantiteMillieme`, présent identique sur les schémas
 * `casse`/`perte`/`transfert`/`sortie-comptoir`/`retour-client` — voir `contrats/pieces/mouvement.ts`),
 * jamais un identifiant de rôle stable. Un consommateur ne doit JAMAIS brancher sur `blocages[0].id`
 * pour distinguer une route d'une autre, seulement sur `.donnees` (même règle que la collision de
 * plaque).
 *
 * Les quantités restent en MILLIÈMES bruts, jamais formatées côté serveur (même doctrine que
 * `centimes` pour l'argent) : c'est au front de les rendre lisibles (`7.000` unité(s)), dans sa
 * propre langue — exactement pourquoi `ProblemeDetail.detail`/`title`/`ElementBloquant.libelle` ne
 * sont JAMAIS lus par le front (voir leur documentation respective).
 *
 * ABSENT (pas de `blocages` du tout) sur le filet de sécurité de
 * `ServiceMouvement.creerMouvementSortie` (violation tardive de la contrainte base derrière le
 * verrou applicatif, cas de course) quand le `disponible` recalculé au moment du refus ne serait
 * plus fiable — jamais une valeur approximative ou pré-course présentée comme le disponible réel.
 */
export interface DetailStockInsuffisantPieces {
  readonly articleId: string;
  readonly siteId: string;
  /** Stock réellement disponible (`physique - reservee`) au moment du refus, en millièmes. */
  readonly disponibleMillieme: number;
  /** Quantité demandée par la requête refusée, en millièmes. */
  readonly demandeMillieme: number;
}
