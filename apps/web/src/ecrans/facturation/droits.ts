import { peut, type ActionsSession } from '@/droits';

/** Montants de facturation visibles : l'option « voit les montants » de la grille ouvre
 *  `facturation.paiement.lire` (un domaine Facturation sans cette option reste muet). */
export const peutVoirMontantsFacturation = (a: ActionsSession) =>
  peut(a, 'facturation.paiement.lire');
export const peutEmettreFacture = (a: ActionsSession) =>
  peut(a, 'facturation.document.emettre_facture');
export const peutEncaisser = (a: ActionsSession) => peut(a, 'facturation.paiement.creer');
export const peutEmettreAvoir = (a: ActionsSession) =>
  peut(a, 'facturation.document.emettre_avoir');
export const peutCorrigerFacture = (a: ActionsSession) => peut(a, 'facturation.document.corriger');
export const peutCreerDevis = (a: ActionsSession) => peut(a, 'facturation.document.creer');
/** Accord du client sur un devis (`POST .../accepter`) : mêmes détenteurs que la création d'un devis. */
export const peutAccepterDevis = (a: ActionsSession) => peutCreerDevis(a);
/** Envoyer (émettre) un devis : `emettre_devis_bc`, distinct de l'émission d'une facture (le chef
 *  d'atelier peut envoyer un devis sans pouvoir émettre une facture). */
export const peutEmettreDevis = (a: ActionsSession) =>
  peut(a, 'facturation.document.emettre_devis_bc');
