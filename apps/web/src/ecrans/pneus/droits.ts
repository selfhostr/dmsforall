import { peut, type ActionsSession } from '@/droits';

export const peutLireDepotPneus = (a: ActionsSession) => peut(a, 'pneus.depot.lire');
export const peutCreerDepotPneus = (a: ActionsSession) => peut(a, 'pneus.depot.creer');
export const peutChangerSaisonDepotPneus = (a: ActionsSession) =>
  peut(a, 'pneus.depot.changer_saison');
/** Déplacer un dépôt : même droit que l'entrée. */
export const peutDeplacerDepotPneus = (a: ActionsSession) => peut(a, 'pneus.depot.creer');
export const peutSortirDepotPneus = (a: ActionsSession) => peut(a, 'pneus.depot.sortir');
