import * as Sentry from '@sentry/nestjs';

/**
 * Contexte de diagnostic transmis à Sentry avec chaque erreur inattendue. Volontairement
 * restreint à des identifiants techniques :
 *   - `tenantId` est un UUID technique, pas une donnée personnelle — il identifie un garage
 *     (personne morale), jamais une personne physique.
 *   - `requeteId` permet de corréler l'événement Sentry avec la ligne du journal pino
 *     correspondante (déjà émise par `ServiceJournal`, voir `FiltreProbleme`).
 *   - Jamais d'e-mail, de nom d'utilisateur ou de tout autre identifiant nominatif ici : c'est
 *     la responsabilité de l'appelant (`FiltreProbleme`) de ne construire ce contexte qu'à
 *     partir de `PrincipalAuthentifie.{tenantId,role}` et de `ContexteRequete.requeteId`,
 *     jamais à partir d'un objet utilisateur complet.
 */
export interface ContexteErreurSentry {
  readonly requeteId: string;
  readonly tenantId?: string;
  readonly role?: string;
  readonly endpoint?: string;
  readonly methode?: string;
}

/**
 * Envoie une exception INATTENDUE à Sentry, avec son contexte de diagnostic.
 *
 * Réservée aux erreurs qui deviennent `ERREUR_INTERNE` (voir `FiltreProbleme`) — jamais aux
 * erreurs métier normales (identifiants invalides, droit insuffisant…), qui ne sont pas des
 * incidents et noieraient les vrais problèmes si elles étaient envoyées une par une.
 *
 * Ne double pas la journalisation pino existante (`ServiceJournal`, toujours appelée en
 * parallèle par `FiltreProbleme`) : cette fonction est un envoi ADDITIONNEL vers un système de
 * supervision externe, pas un remplacement du journal applicatif.
 *
 * Ne lève JAMAIS : si Sentry est indisponible, mal configuré, ou si le SDK n'a même pas été
 * initialisé (`SENTRY_DSN` absent — `Sentry.withScope`/`captureException` sont alors des
 * no-op documentés du SDK), la requête HTTP en cours ne doit ni échouer ni ralentir. C'est
 * un appel best-effort vers un système de supervision, jamais un chemin critique.
 */
export function capturerErreurInattendue(exception: unknown, contexte: ContexteErreurSentry): void {
  try {
    Sentry.withScope((scope) => {
      scope.setTag('requeteId', contexte.requeteId);
      if (contexte.tenantId) {
        scope.setTag('tenantId', contexte.tenantId);
      }
      if (contexte.role) {
        scope.setTag('role', contexte.role);
      }
      if (contexte.endpoint) {
        scope.setTag('endpoint', contexte.endpoint);
      }
      if (contexte.methode) {
        scope.setTag('methode', contexte.methode);
      }
      Sentry.captureException(exception);
    });
  } catch {
    // Volontairement silencieux : voir le commentaire de la fonction. L'erreur d'origine est
    // de toute façon déjà journalisée par ServiceJournal côté appelant.
  }
}
