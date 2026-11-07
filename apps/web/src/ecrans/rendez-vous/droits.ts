import { peut, type ActionsSession } from '@/droits';

export const peutLireRendezVous = (a: ActionsSession) => peut(a, 'rendez_vous.lire');
export const peutCreerRendezVous = (a: ActionsSession) => peut(a, 'rendez_vous.creer');
/** Arrivée, absence, annulation, déplacement. */
export const peutAgirSurRendezVous = (a: ActionsSession) => peut(a, 'rendez_vous.modifier');
