import type * as SentryReact from '@sentry/react';

import { ErreurApi, ErreurReseau } from '@/api/erreurs';
import { obtenirEnv } from '@/config/env';

import { nettoyerEvenement, nettoyerMigette } from './nettoyageDonnees';

/**
 * Supervision d'erreurs front (Sentry, instance auto-hébergée en Suisse — nLPD). Trois
 * décisions structurantes, documentées ici plutôt que dans un commentaire perdu :
 *
 * 1. OPTIONNEL PAR CONSTRUCTION. `VITE_SENTRY_DSN` est une variable facultative (config/env.ts).
 *    Sans elle, `initialiserSentry()` ne fait rien — pas d'import du SDK, pas de tentative
 *    réseau. Un front qui refuserait de démarrer faute de supervision serait une régression
 *    bien plus grave que l'absence de supervision elle-même.
 *
 * 2. PAS DE SESSION REPLAY, PAS DE CAPTURE D'ÉCRAN. Volontairement absent : ni
 *    `Sentry.replayIntegration()` ni `Sentry.replayCanvasIntegration()` ne sont importés ou
 *    ajoutés ci-dessous. Un écran d'ordre de réparation affiche nom du client, plaque, VIN,
 *    parfois IBAN — les filmer, même « masqués » par défaut, ajoute une surface d'exposition
 *    (bugs de masquage, éléments non standards non reconnus par le masquage automatique) que
 *    rien ne justifie pour un DMS soumis à la nLPD. Si un besoin de reproduction visuelle de bug
 *    émerge un jour, il devra être validé explicitement avec @laupernoe, pas ajouté au fil de l'eau.
 *
 * 3. CHARGEMENT DIFFÉRÉ. `@sentry/react` n'est importé dynamiquement que si un DSN est
 *    configuré, et l'échec de ce chargement (chunk injoignable, instance auto-hébergée en
 *    maintenance, wifi d'atelier capricieux) est rattrapé silencieusement : la supervision se
 *    dégrade, jamais l'application.
 */

type ModuleSentry = typeof SentryReact;

let promesseModule: Promise<ModuleSentry | null> | null = null;

/** À appeler une fois au démarrage (main.tsx), après le rendu initial — jamais dans le chemin
 *  critique du premier affichage. Idempotente. */
export function initialiserSentry(): void {
  if (promesseModule) return;

  const { VITE_SENTRY_DSN } = obtenirEnv();
  if (!VITE_SENTRY_DSN) {
    promesseModule = Promise.resolve(null);
    return;
  }

  promesseModule = import('@sentry/react')
    .then((Sentry) => {
      Sentry.init({
        dsn: VITE_SENTRY_DSN,
        // Comportement explicite plutôt qu'hérité de la valeur par défaut du SDK : si une
        // future version de @sentry/react change ce défaut, ce dépôt n'en hérite pas
        // silencieusement.
        sendDefaultPii: false,
        // Coupe la collecte à la source (voir nettoyageDonnees.ts pour le second filet) :
        // aucune variable locale de stack frame (un formulaire de connexion garde le mot de
        // passe saisi dans une variable locale le temps de l'appel réseau), aucun header, aucun
        // cookie, aucun paramètre de requête HTTP, aucune information utilisateur auto-déduite.
        dataCollection: {
          userInfo: false,
          cookies: false,
          httpHeaders: { request: false, response: false },
          httpBodies: [],
          urlQueryParams: false,
          stackFrameVariables: false,
        },
        // Aucune intégration ajoutée : les intégrations par défaut du SDK (erreurs globales,
        // fil de navigation, dédoublonnage…) suffisent, et n'incluent ni replay ni capture
        // d'écran par défaut — voir point 2 ci-dessus.
        //
        // `doitIgnorerErreur` est revérifiée ICI, pas seulement dans `signalerErreur` : les
        // intégrations par défaut du SDK (erreurs globales `window.onerror`/promesses non
        // rattrapées) capturent et envoient sans jamais passer par `signalerErreur` — c'est le
        // seul point de passage commun à TOUTE capture, manuelle ou automatique. Sans ce filtre
        // ici, une `ErreurApi` 4xx ou une `ErreurReseau` qui échapperait à React Query comme
        // rejet de promesse non géré serait quand même envoyée.
        beforeSend: (evenement, indice) =>
          doitIgnorerErreur(indice.originalException) ? null : nettoyerEvenement(evenement),
        beforeBreadcrumb: (migette) => nettoyerMigette(migette),
        // Pas de tracing de performance à ce stade — hors périmètre de cette intégration.
        tracesSampleRate: 0,
      });
      return Sentry;
    })
    .catch((cause: unknown) => {
      // Seule trace possible d'un Sentry indisponible ; ne doit surtout pas relancer (l'app
      // doit continuer sans supervision). `console.warn` est explicitement autorisé par la
      // configuration ESLint du dépôt (voir eslint.config.mjs, règle `no-console`).
      console.warn('Sentry indisponible : supervision désactivée pour cette session.', cause);
      return null;
    });
}

async function obtenirModuleActif(): Promise<ModuleSentry | null> {
  if (!promesseModule) return null;
  return promesseModule;
}

/** Erreurs qu'on NE remonte PAS à Sentry :
 *  - `ErreurReseau` : très majoritairement du wifi d'atelier ou une coupure ponctuelle, pas un
 *    bug applicatif — les remonter noierait le signal utile sous du bruit environnemental.
 *  - `ErreurApi` 4xx : fonctionnement normal de l'application (session expirée, identifiants
 *    invalides, droit insuffisant, conflit de validation…). Seules les erreurs serveur (5xx, y
 *    compris l'ERREUR_INTERNE synthétisée sur une réponse illisible) indiquent un incident
 *    côté backend qui mérite une alerte. */
export function doitIgnorerErreur(erreur: unknown): boolean {
  if (erreur instanceof ErreurReseau) return true;
  if (erreur instanceof ErreurApi) return erreur.probleme.status < 500;
  return false;
}

/** Point d'entrée unique pour signaler une erreur à Sentry. Ne fait rien (et ne charge rien) si
 *  Sentry n'est pas configuré, ou si `doitIgnorerErreur` juge l'erreur non pertinente.
 *  `contexte` : données déjà passées au crible de l'appelant (voir App.tsx) — reste néanmoins
 *  nettoyé par `nettoyerEvenement` avant envoi, comme tout le reste de l'événement.
 *  Retourne l'identifiant d'événement Sentry (utile pour un futur support), `undefined` sinon —
 *  jamais rejetée : une supervision qui plante ne doit jamais devenir une erreur applicative. */
export async function signalerErreur(
  erreur: unknown,
  contexte?: Record<string, unknown>,
): Promise<string | undefined> {
  if (doitIgnorerErreur(erreur)) return undefined;

  try {
    const Sentry = await obtenirModuleActif();
    if (!Sentry) return undefined;

    let idEvenement: string | undefined;
    Sentry.withScope((scope) => {
      if (erreur instanceof ErreurApi) {
        // Corrélation front/back : l'API renvoie X-Requete-Id, repris dans `instance` du
        // problem+json — c'est ce qui permet de relier un événement vu par un garagiste à la
        // trace serveur correspondante.
        scope.setTag('requeteId', erreur.probleme.instance);
        scope.setTag('codeErreurApi', erreur.probleme.code);
      }
      if (contexte) {
        scope.setContext('supplementaire', contexte);
      }
      idEvenement = Sentry.captureException(erreur);
    });
    return idEvenement;
  } catch {
    // Ceinture et bretelles : un échec de la supervision elle-même ne doit jamais remonter.
    return undefined;
  }
}
