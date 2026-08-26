/**
 * Critères d'inclusion des trois domaines neufs (pneus, ventes VN/VO, pièces — D-40/D-41/D-42,
 * `docs/reprise/decisions.md`) — fonctions PURES, testées sans base ni port de lecture, même
 * doctrine que `reconciliation-annee-reprise.ts`.
 *
 * EXTENSION SEAM, PAS ENCORE CÂBLÉ : aucun écrivain d'import ne consomme ces fonctions à ce stade
 * (`pneus`/`ventes_vn_vo` n'ont pas d'écrivain concret, voir
 * `import/service-import-reprise.ts::rolePrincipalPourDomaine`) — mais le PIÈGE DU DÉPÔT (un
 * filtre accepté sans être appliqué au SQL) coûte cher : quand cet écrivain sera écrit, le filtre
 * de statut doit être CE code, jamais une condition ad hoc redécouverte à cette occasion-là. Le
 * critère est écrit une fois ici, explicite, testé, prêt à être appelé.
 *
 * Delibérément des fonctions BOOLÉENNES sur un `statut` typé (jamais une chaîne libre) : un statut
 * hors énumération ne compile pas, contrairement à un `['en_depot', 'monte'].includes(statut)`
 * recopié à chaque appel qui tolérerait une faute de frappe silencieuse.
 */

import type { StatutCommandeFournisseur, StatutDepotPneus, StatutDossierVente } from '@dfa/shared';

/**
 * D-41 : un dépôt pneus est repris s'il est ENCORE EN COURS — jamais un dépôt déjà sorti.
 * Littéral de la décision : `('en_depot', 'monte')`. `a_relancer` (jeu en dépôt oublié, RPP-04)
 * n'y figure PAS explicitement dans le texte de la décision — AMBIGUÏTÉ SIGNALÉE, PAS TRANCHÉE :
 * `a_relancer` n'est de toute façon jamais un statut qu'une SOURCE externe peut porter (c'est un
 * état calculé par le job RPP-04 sur des données déjà en DFA, `service-depot-pneus.ts:473`) — un
 * import ne peut donc jamais présenter une ligne source « a_relancer » à ce prédicat ; la question
 * ne se pose que si un futur écrivain choisissait, à tort, de faire porter ce statut par une ligne
 * fraîchement importée.
 */
export function depotPneusRepris(statut: StatutDepotPneus): boolean {
  return statut === 'en_depot' || statut === 'monte';
}

/**
 * D-40 : une commande fournisseur est reprise si elle n'est PAS SOLDÉE. Littéral de la décision :
 * `('brouillon', 'envoyee', 'partiellement_recue')`. `recue`/`cloturee` sont soldées (archive
 * froide, D-15) ; `annulee` N'EST PAS listée par la décision — une commande annulée ne représente
 * plus rien à réapprovisionner, elle est donc exclue au même titre qu'une commande soldée, bien
 * que le texte de D-40 ne la nomme pas explicitement parmi les exclusions.
 */
export function commandeFournisseurReprise(statut: StatutCommandeFournisseur): boolean {
  return statut === 'brouillon' || statut === 'envoyee' || statut === 'partiellement_recue';
}

/** Statuts `dossier_vente` qui NE SONT JAMAIS repris (D-42) — la forme négative de la décision
 *  (« tout sauf… ») est la source de vérité, `dossierVenteRepris` en dérive plutôt que l'inverse,
 *  pour qu'un neuvième statut ajouté un jour à `STATUTS_DOSSIER_VENTE` (liste GELÉE aujourd'hui,
 *  §6.2) tombe côté « repris » par défaut plutôt que d'exiger une mise à jour manuelle oubliable
 *  de cette liste. */
const STATUTS_DOSSIER_VENTE_EXCLUS_REPRISE: ReadonlySet<StatutDossierVente> = new Set([
  'livre',
  'clos',
  'annule',
  'abandonne',
]);

/**
 * D-42 : un dossier de vente est repris s'il est OUVERT — tout statut SAUF
 * `livre`/`clos`/`annule`/`abandonne`. Couvre `prospection`/`engage`/`en_preparation`/
 * `pret_a_livrer` avec le schéma actuel de `STATUTS_DOSSIER_VENTE`.
 */
export function dossierVenteRepris(statut: StatutDossierVente): boolean {
  return !STATUTS_DOSSIER_VENTE_EXCLUS_REPRISE.has(statut);
}
