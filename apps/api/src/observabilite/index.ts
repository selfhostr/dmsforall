/**
 * Intégration Sentry (auto-hébergé en Suisse — décision @laupernoe, cohérence nLPD). Voir
 * `SENTRY_DSN` dans `apps/api/src/config/charger-config.ts` pour la config validée.
 *
 * Trois responsabilités séparées :
 *   - `initialiser-sentry.ts` : `Sentry.init()`, appelé depuis `main.ts` après `chargerConfig`
 *     et avant `NestFactory.create`. No-op propre si `SENTRY_DSN` est absent ; ne lève jamais.
 *   - `nettoyer-evenement.ts` : LE point critique de ce module — nettoyage des données
 *     personnelles avant tout envoi (branché comme `beforeSend`). À ne jamais contourner : un
 *     outil de supervision qui exfiltre des données de garages suisses est pire que pas de
 *     supervision.
 *   - `capturer-erreur-inattendue.ts` : point d'entrée appelé par `FiltreProbleme`
 *     (apps/api/src/common/erreurs/) UNIQUEMENT pour les erreurs qui deviennent
 *     `ERREUR_INTERNE` — jamais pour les erreurs métier normales (un 401 « identifiants
 *     invalides » n'est pas un incident).
 */
export * from './initialiser-sentry';
export * from './nettoyer-evenement';
export * from './capturer-erreur-inattendue';
