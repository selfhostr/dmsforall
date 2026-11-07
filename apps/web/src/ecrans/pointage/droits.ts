import { peut, type ActionsSession } from '@/droits';

/** Pointer soi-même (démarrer/arrêter). */
export const peutDemarrerPointage = (a: ActionsSession) => peut(a, 'atelier.pointage.demarrer');
/** Voir et pointer pour l'équipe (vue « Équipe »). */
export const peutVoirEquipePointage = (a: ActionsSession) =>
  peut(a, 'atelier.pointage.pointer_autrui');
export const peutCorrigerPointage = (a: ActionsSession) =>
  peut(a, 'atelier.pointage.corriger_autrui');
export const peutVerrouillerPeriode = (a: ActionsSession) =>
  peut(a, 'atelier.pointage.verrouiller_periode');
export const peutMarquerLigneRealisee = (a: ActionsSession) =>
  peut(a, 'atelier.ligne.marquer_realisee');
