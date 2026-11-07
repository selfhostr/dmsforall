import { peut, type ActionsSession } from '@/droits';

export const peutCreerOrdreReparation = (a: ActionsSession) => peut(a, 'atelier.or.creer');
export const peutCreerLigneOr = (a: ActionsSession) => peut(a, 'atelier.ligne.creer');
/** Reporter un travail à une prochaine visite. */
export const peutReporterTravail = (a: ActionsSession) =>
  peut(a, 'vehicule.travail_reporte.signaler');
export const peutValiderLigneOr = (a: ActionsSession) => peut(a, 'atelier.ligne.valider');
export const peutRefuserLigneOr = (a: ActionsSession) => peut(a, 'atelier.ligne.refuser');
export const peutAnnulerLigneOr = (a: ActionsSession) => peut(a, 'atelier.ligne.annuler');
/** Chercher une pièce depuis une ligne d'OR. */
export const peutRechercherArticlePiece = (a: ActionsSession) => peut(a, 'pieces.article.lire');
/** Voir les prêts de voiture de courtoisie (rattachés à un OR). */
export const peutLireCourtoisie = (a: ActionsSession) => peut(a, 'courtoisie.lire');
