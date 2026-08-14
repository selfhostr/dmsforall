import type { DeviseFacturation } from './enums';

/**
 * Détail additionnel du `problem+json` d'un `409 IMPUTATION_DEVISE_INCOHERENTE` (MD-50,
 * `facturation/paiements/imputations.ts::verifierCoherenceDevise`) — issue #15, dernier point :
 * avant cette addition, le refus portait bien le `code` machine stable mais AUCUNE donnée
 * exploitable par le front (le `detail` textuel, qui aurait porté les identifiants et devises,
 * est explicitement documenté comme « jamais affiché à l'utilisateur final » —
 * `ErreurMetier`/`ProblemeDetail.detail`). Un caissier qui tentait de régler une facture CHF avec
 * un paiement EUR recevait donc un refus qui ne disait NI quelle devise portait le paiement NI
 * quelle devise portait le document — exactement le défaut que l'issue #15 décrit : deviner à la
 * place de savoir.
 *
 * Transporté dans `ProblemeDetail.blocages[0].donnees` (`ElementBloquant`, `type: 'champ'`), même
 * mécanisme et même convention que `DetailCollisionPlaqueVehicule`
 * (`contrats/vehicules/collision-plaque.ts`) et `DetailStockInsuffisantPieces`
 * (`contrats/pieces/stock-insuffisant.ts`) : `blocages[0].id` porte le nom du champ fautif DANS
 * LE CORPS DE LA REQUÊTE qui a échoué — jamais un identifiant de rôle stable. Deux valeurs
 * possibles selon la route, et c'est VOULU (même doctrine que la collision de plaque) :
 *   - `POST /paiements` (imputations en ligne, `formeImputationInline`) et
 *     `POST /paiements/{id}/imputations` (`schemaCreationImputation`) — lettrage générique,
 *     `verifierCoherenceDevise` appelée depuis `appliquerImputationsLettrage` : `id: 'documentId'`,
 *     nom du champ dans le contrat partagé par ces deux routes (`paiement.ts` ligne 104).
 *   - `POST /paiements/{id}/abandonner` (`schemaAbandonnerAvance`) — compensation d'avance,
 *     `verifierCoherenceDevise` appelée depuis `appliquerCompensationAvance` : `id:
 *     'documentRegularisationId'`, nom du champ propre à ce schéma (`paiement.ts` ligne 172).
 * Un consommateur ne doit JAMAIS brancher sur `blocages[0].id` pour distinguer une route d'une
 * autre, seulement sur `.donnees` — même règle que la collision de plaque et le stock insuffisant.
 *
 * Aucune valeur devinée ou approximative n'y figure : les quatre champs sont ceux réellement lus
 * en base au moment du refus (`LignePaiement`/`LigneDocumentVente`), jamais reconstruits.
 */
export interface DetailImputationDeviseIncoherente {
  readonly paiementId: string;
  readonly paiementDevise: DeviseFacturation;
  readonly documentId: string;
  readonly documentDevise: DeviseFacturation;
}
