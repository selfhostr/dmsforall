import { peut, peutToutes, type ActionsSession } from '@/droits';

/**
 * Droits du module pièces : lus dans `session.actions` (voir `@/droits`), jamais recopiés par rôle.
 * Défensif d'ergonomie : le serveur reste l'arbitre (403 `DROIT_INSUFFISANT` géré par les écrans).
 */
export const peutEcrireArticle = (a: ActionsSession) => peut(a, 'pieces.article.creer');
/** Réglages de stock par site (emplacement, seuils). */
export const peutEcrireStockSite = (a: ActionsSession) => peut(a, 'pieces.stock.modifier');
export const peutCreerMouvement = (a: ActionsSession) => peut(a, 'pieces.mouvement.creer');
export const peutSatisfaireReservation = (a: ActionsSession) =>
  peut(a, 'pieces.reservation.satisfaire');
export const peutLibererReservation = (a: ActionsSession) => peut(a, 'pieces.reservation.liberer');
export const peutLireFournisseur = (a: ActionsSession) => peut(a, 'pieces.fournisseur.lire');
export const peutEcrireFournisseur = (a: ActionsSession) => peut(a, 'pieces.fournisseur.creer');
export const peutLireCommandeFournisseur = (a: ActionsSession) =>
  peut(a, 'pieces.commande_fournisseur.lire');
/** Créer, envoyer, annuler la commande entière. */
export const peutEcrireCommandeFournisseur = (a: ActionsSession) =>
  peut(a, 'pieces.commande_fournisseur.creer');
/** Réceptionner, annuler un reliquat de ligne. */
export const peutReceptionnerCommandeFournisseur = (a: ActionsSession) =>
  peut(a, 'pieces.commande_fournisseur.reception');
export const peutRetournerConsigne = (a: ActionsSession) => peut(a, 'pieces.consigne.retourner');
export const peutModifierParametragePieces = (a: ActionsSession) =>
  peut(a, 'pieces.parametrage.modifier');
export const peutLireFactureFournisseur = (a: ActionsSession) =>
  peut(a, 'pieces.facture_fournisseur.lire');
export const peutDeposerFactureFournisseur = (a: ActionsSession) =>
  peut(a, 'pieces.facture_fournisseur.deposer');
/** Valider OU rejeter le rapprochement : les deux transitions engagent la même décision. */
export const peutDeciderFactureFournisseur = (a: ActionsSession) =>
  peutToutes(a, 'pieces.facture_fournisseur.valider', 'pieces.facture_fournisseur.rejeter');
