import { peut, type ActionsSession } from '@/droits';

export const peutLireFinancement = (a: ActionsSession) => peut(a, 'ventes.financement.lire');
export const peutCreerFinancement = (a: ActionsSession) => peut(a, 'ventes.financement.creer');
export const peutConfirmerOuRefuserFinancement = (a: ActionsSession) =>
  peut(a, 'ventes.financement.confirmer');
