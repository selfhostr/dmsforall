import { peut, type ActionsSession } from '@/droits';

export const peutModifierVehicule = (a: ActionsSession) => peut(a, 'vehicule.modifier');
export const peutGererPlaqueVehicule = (a: ActionsSession) => peut(a, 'vehicule.plaque.gerer');
export const peutLireOrdresReparation = (a: ActionsSession) => peut(a, 'atelier.or.lire');
export const peutLireRendezVous = (a: ActionsSession) => peut(a, 'rendez_vous.lire');
