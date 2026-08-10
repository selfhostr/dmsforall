/**
 * Réexporte `convertirEnKm` depuis `vehicules/kilometrage.regles.ts`.
 *
 * Cette fonction compare toujours la valeur convertie à `vehicule_kilometrage.valeur_km`
 * (colonne GÉNÉRÉE en base : `round(valeur * 1.609344)::integer`, voir `migrations/0007_vehicules.sql`)
 * pour détecter `VEHICULE_KILOMETRAGE_REGRESSIF`. Il n'existe qu'une seule implémentation,
 * importée ici — la source de vérité est `vehicules/kilometrage.regles.ts`.
 */

export { convertirEnKm } from '../vehicules/kilometrage.regles';
