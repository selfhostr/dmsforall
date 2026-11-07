import { peut, type ActionsSession } from '@/droits';

export const peutLireReprise = (a: ActionsSession) => peut(a, 'ventes.reprise.lire');
export const peutEcrireReprise = (a: ActionsSession) => peut(a, 'ventes.reprise.creer');
export const peutRefuserReprise = (a: ActionsSession) => peut(a, 'ventes.reprise.refuser');
export const peutConfirmerReprise = (a: ActionsSession) => peut(a, 'ventes.reprise.confirmer');
