import * as Sentry from '@sentry/nestjs';
import type { Config } from '../config';

/**
 * Filet de dernier recours, hors du cycle requête/réponse : `uncaughtException` et
 * `unhandledRejection` au niveau du PROCESS Node, jamais couverts par `FiltreProbleme`
 * (apps/api/src/common/erreurs/), qui ne voit que ce qui traverse le pipeline HTTP de Nest.
 *
 * Pourquoi ce fichier existe : investigation du défaut « `GET /auth/moi` répond parfois `500`
 * avec un CORPS VIDE » (~1 chargement sur 5, en développement, en enchaînant des navigations
 * dures). Reproduction réelle (voir le rapport de livraison) : sous charge concurrente, le pool
 * de connexions Postgres s'épuise et lève `Error: timeout exceeded when trying to connect` —
 * mais CETTE erreur-là traverse `FiltreProbleme` normalement et ressort en `problem+json` bien
 * formé (mesuré, pas supposé : 88 reproductions, 88 corps de 171 octets, aucun vide). Le corps
 * vide n'a PAS pu être reproduit comme un cas normal du pipeline HTTP.
 *
 * L'hypothèse qui reste, cohérente avec tous les faits observés mais NON CONFIRMÉE en exécution
 * (voir le rapport) : en développement, `nest start --watch` relance le PROCESS ENTIER à chaque
 * modification de fichier sous `apps/api/src` — dépôt travaillé par plusieurs agents en parallèle
 * sur EXACTEMENT ce répertoire. Une requête en vol au moment du redémarrage perd sa connexion
 * TCP brutalement ; le proxy de développement Vite (`apps/web/vite.config.ts`, `server.proxy`)
 * la traduit alors en `500` sans corps — AUCUN code Nest ne tourne à cet instant, donc
 * `FiltreProbleme` ne peut structurellement rien y faire (il n'existe pas encore / plus). Ce
 * scénario est absent en production (pas de `--watch`, pas de proxy Vite), donc hors du périmètre
 * de correction "empêcher le corps vide" — mais SI le process meurt d'une exception non
 * rattrapée (bug réel, pas un redémarrage volontaire du watcher), c'est exactement le trou que ce
 * fichier comble : sans lui, un `uncaughtException`/`unhandledRejection` ne laisse RIEN dans les
 * journaux — la cause exacte d'un crash reste à jamais indiagnosticable, ce qui est précisément
 * ce qui a rendu ce défaut difficile à cerner. Avec lui, la cause est toujours journalisée et
 * envoyée à Sentry avant que le process ne s'arrête.
 *
 * Comportement DÉLIBÉRÉMENT SYMÉTRIQUE pour les deux événements (journaliser, capturer, PUIS
 * quitter avec un code d'erreur) — alignement sur la doctrine Node officielle : après un
 * `uncaughtException`, l'état du process n'est plus digne de confiance (Node crashe de toute
 * façon si aucun gestionnaire n'est posé) ; un `unhandledRejection` non traité est, depuis
 * Node 15, promu au même traitement fatal PAR NODE LUI-MÊME en l'absence de tout gestionnaire —
 * poser un gestionnaire qui ne journalise QUE, sans jamais quitter, changerait silencieusement ce
 * comportement par défaut et laisserait le process continuer dans un état dont plus rien ne
 * garantit la cohérence (transaction Postgres à moitié conduite, contexte de requête corrompu…).
 * Un crash rapide et bruyant qu'un superviseur (`nest --watch` en dev, orchestrateur de
 * conteneurs en production) peut relancer proprement est préférable à un process zombie qui
 * répond de façon imprévisible.
 *
 * `Sentry.captureException` appelé DIRECTEMENT (pas `capturerErreurInattendue`, qui exige un
 * `ContexteErreurSentry` — requête/tenant/rôle — qui n'a AUCUN sens ici : il n'existe pas
 * nécessairement de requête HTTP en cours au moment d'un crash process). No-op silencieux du SDK
 * si `SENTRY_DSN` est absent (mêmes garanties que `initialiserSentry`) — jamais de second échec
 * en cascade pendant qu'on journalise déjà un premier incident.
 *
 * NON câblé automatiquement : à appeler depuis `main.ts`, juste après `initialiserSentry(config)`
 * (étape 2 de sa séquence documentée) — `main.ts` est hors du périmètre d'écriture de ce module.
 */
export function installerGestionnairesCrash(_config: Config): void {
  process.on('uncaughtException', (erreur) => {
    journaliserCrash('uncaughtException', erreur);
    void capturerEtQuitter(erreur);
  });

  process.on('unhandledRejection', (raison) => {
    const erreur = raison instanceof Error ? raison : new Error(String(raison));
    journaliserCrash('unhandledRejection', erreur);
    void capturerEtQuitter(erreur);
  });
}

function journaliserCrash(type: 'uncaughtException' | 'unhandledRejection', erreur: unknown): void {
  const message = erreur instanceof Error ? (erreur.stack ?? erreur.message) : String(erreur);
  // `process.stderr.write` directement, jamais `ServiceJournal` (pino, injecté par Nest) : un
  // crash process peut survenir AVANT que le conteneur d'injection existe, ou pendant sa
  // destruction — la même raison pour laquelle `main.ts` écrit déjà ses échecs de démarrage
  // directement sur `stderr` plutôt que via un service.
  process.stderr.write(`[${type}] Erreur fatale non rattrapée : ${message}\n`);
}

/** Délai maximal accordé à Sentry pour transmettre l'événement avant de quitter quand même : un
 *  incident déjà fatal ne doit jamais rester bloqué indéfiniment en attente du réseau. */
const DELAI_MAX_FLUSH_SENTRY_MS = 2_000;

async function capturerEtQuitter(erreur: unknown): Promise<void> {
  try {
    Sentry.captureException(erreur);
    // `captureException` met en file d'attente, il n'attend pas l'envoi réseau : sans `flush`,
    // `process.exit()` ci-dessous tuerait le process avant que l'événement ne parte, et Sentry
    // ne recevrait JAMAIS la cause d'un crash — exactement l'inverse du but de ce fichier.
    await Sentry.flush(DELAI_MAX_FLUSH_SENTRY_MS);
  } catch {
    // Best-effort, même garantie que capturer-erreur-inattendue.ts : une supervision qui échoue
    // ne doit jamais masquer ni retarder la sortie du process après une erreur déjà fatale.
  }
  process.exit(1);
}
