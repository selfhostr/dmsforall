import * as Sentry from '@sentry/nestjs';
import type { Config } from '../config';
import {
  assainirAttributsSpan,
  assainirEvenement,
  nettoyerEvenementSentry,
} from './nettoyer-evenement';

/**
 * Initialise le SDK Sentry, ou ne fait rien si `SENTRY_DSN` est absent.
 *
 * À appeler depuis `main.ts`, APRÈS `chargerConfig` (la config doit être validée) et AVANT
 * `NestFactory.create` (pour instrumenter correctement la création de l'application) — voir
 * l'ordre documenté en tête de `main.ts`.
 *
 * Auto-hébergement (décision de conception, cohérence nLPD) : `SENTRY_DSN` pointe une instance Sentry
 * interne, hébergée en Suisse avec le reste de l'infrastructure. Rien de spécifique à coder
 * côté SDK pour ça — un DSN auto-hébergé a exactement la même forme qu'un DSN
 * sentry.io (`https://<clé>@<hôte>/<projet>`), seul l'hôte change. Voir `.env.example`.
 *
 * Deux garde-fous pour la règle « la supervision ne doit jamais impacter le service » :
 *   - `SENTRY_DSN` absent → on retourne avant tout appel au SDK, aucun réseau, aucun retard.
 *   - `Sentry.init` est appelé sous `try/catch` : une option de config invalide ou un souci de
 *     création de transport ne doit jamais empêcher l'API de démarrer.
 *
 * TROIS points de nettoyage, pas un seul (audit sécurité, finding H2) : `beforeSend` ne
 * s'applique jamais aux événements de TRANSACTION (voir `@sentry/core` `client.js`) — sans
 * `beforeSendTransaction`, la fraction de requêtes échantillonnée par
 * `SENTRY_TAUX_ECHANTILLONNAGE_TRACES` contournait intégralement le nettoyage. `beforeSendSpan`
 * couvre en plus les attributs de chaque span individuel (`http.url`, `db.statement`…).
 *
 * `beforeSendTransaction`/`beforeSendSpan` sont branchés ICI en lambdas plutôt que par des
 * fonctions nommées et exportées de `nettoyer-evenement.ts` (comme `nettoyerEvenementSentry`
 * pour `beforeSend`) : `@sentry/nestjs` ne réexporte pas de façon fiable, pour cette version du
 * SDK, les types `TransactionEvent`/`SpanJSON`/`SpanAttributes` (seul `@sentry/core`, une
 * dépendance transitive non déclarée dans `package.json`, les porte). Écrire les lambdas
 * directement dans l'objet passé à `Sentry.init(...)` laisse TypeScript inférer leur type depuis
 * le SDK par typage contextuel, sans jamais avoir à nommer ces types — voir les commentaires de
 * `assainirEvenement`/`assainirAttributsSpan` dans `nettoyer-evenement.ts` pour le détail de cet
 * arbitrage.
 */
export function initialiserSentry(config: Config): void {
  if (!config.SENTRY_DSN) {
    return;
  }

  try {
    Sentry.init({
      dsn: config.SENTRY_DSN,
      environment: config.SENTRY_ENVIRONMENT ?? config.NODE_ENV,
      release: config.VERSION_APP,
      tracesSampleRate: config.SENTRY_TAUX_ECHANTILLONNAGE_TRACES,
      // Jamais l'IP du client, les en-têtes ou les cookies bruts par défaut (nLPD) : le seul
      // filet retenu est le nettoyage explicite et testé de nettoyer-evenement.ts.
      sendDefaultPii: false,
      beforeSend: nettoyerEvenementSentry,
      beforeSendTransaction: (event, _hint) => assainirEvenement(event),
      beforeSendSpan: (span) => ({ ...span, data: assainirAttributsSpan(span.data) }),
    });
  } catch {
    // Best-effort : une supervision qui empêche l'API de démarrer serait pire que l'absence
    // de supervision (voir aussi capturer-erreur-inattendue.ts).
  }
}
