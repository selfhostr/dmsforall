import { peut, type ActionsSession } from '@/droits';

export const peutEcrireVehiculeStock = (a: ActionsSession) =>
  peut(a, 'ventes.vehicule_stock.creer');
export const peutCorrigerVehiculeStock = (a: ActionsSession) =>
  peut(a, 'ventes.vehicule_stock.corriger');
/** Modifier la fiche véhicule associée à une unité de stock. */
export const peutModifierVehiculeAssocie = (a: ActionsSession) => peut(a, 'vehicule.modifier');
