import { peut, type ActionsSession } from '@/droits';

/** Écriture du paramétrage atelier et des référentiels (taux horaires, prestations, sites). La
 *  lecture est ouverte à toute personne connectée : seules les actions d'écriture se grisent. */
export const peutModifierParametrage = (a: ActionsSession) => peut(a, 'parametrage.atelier.modifier');
