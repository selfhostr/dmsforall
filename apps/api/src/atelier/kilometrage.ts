import type { UniteDistance } from '@dfa/shared';

/** Conversion mile -> km FAITE PAR LE SERVEUR (CT-08) : le client n'a aucune arithmétique
 *  d'unité à rejouer, et la comparaison de régression (VEHICULE_KILOMETRAGE_REGRESSIF) se fait
 *  toujours sur la valeur convertie. */
const FACTEUR_MILE_VERS_KM = 1.60934;

export function convertirEnKm(valeur: number, unite: UniteDistance): number {
  return unite === 'mi' ? Math.round(valeur * FACTEUR_MILE_VERS_KM) : valeur;
}
