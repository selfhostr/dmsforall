import { peut, type ActionsSession } from '@/droits';

export const peutPreterCourtoisie = (a: ActionsSession) => peut(a, 'courtoisie.preter');
export const peutGererParcCourtoisie = (a: ActionsSession) => peut(a, 'courtoisie.parc.gerer');
