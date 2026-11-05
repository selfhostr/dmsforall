/**
 * Calendaire LOCAL (fuseau du navigateur), volontairement distinct de l'arithmétique UTC de
 * `apps/api/src/vehicules/vehicule.mappers.ts::ajouterMoisIso` : celle-ci raisonne sur des dates
 * ISO déjà résolues côté serveur, celle-ci part de « aujourd'hui » tel que le garagiste le vit
 * devant son écran — un `Date.UTC` ferait glisser le jour affiché de 1 en soirée en Suisse l'été
 * (UTC+2). Même doctrine que `dateVersFormatSuisse` (`lib/formats.ts`) : jours civils locaux.
 */

/** `aaaa-mm-jj` local, jamais `toISOString()` (qui convertit en UTC et peut changer de jour). */
export function versDateIsoLocale(date: Date): string {
  const annee = date.getFullYear();
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  const jour = String(date.getDate()).padStart(2, '0');
  return `${annee}-${mois}-${jour}`;
}
