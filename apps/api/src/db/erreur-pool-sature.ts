/**
 * Traduit un épuisement du pool `pg` en `ErreurMetier` correctement typée, plutôt que de laisser
 * l'erreur brute de `pg-pool` remonter jusqu'à `FiltreProbleme` où elle se serait normalisée en
 * `ERREUR_INTERNE`/500 générique — indistinguable, côté client, d'un vrai défaut applicatif.
 *
 * Contexte (investigation du défaut mesuré, 88 reproductions sur `DocumentVenteController.lister`
 * / `OrdreReparationController.lister`, voir `observabilite/installer-gestionnaires-crash.ts` pour
 * le rapport complet) : sous charge concurrente, `pg-pool` lève `Error: timeout exceeded when
 * trying to connect`. Un service saturé qui répond « je suis occupé, réessaie » (503 +
 * `Retry-After`) est une réponse fondamentalement différente d'un service cassé (500) — le premier
 * dit au client (et à un load balancer, un `fetch` avec retry) QUAND retenter ; le second ne dit
 * rien d'actionnable.
 *
 * Pourquoi reconnaître l'erreur par SON MESSAGE plutôt que par un type dédié : `pg-pool`
 * (`node_modules/pg-pool/index.js`, ré-exporté par `pg`) lève un `Error` générique sans `code` ni
 * classe distincte pour ce cas précis — contrairement aux erreurs PostgreSQL elles-mêmes (qui
 * portent un SQLSTATE sur `.code`). Le message est donc la seule surface stable disponible ; il
 * est pin-jusqu'à la version de `pg-pool` verrouillée par le lockfile du dépôt, et cette fonction
 * est volontairement PERMISSIVE en cas de doute (voir `estErreurEpuisementPool`) : rater cette
 * détection ne fait que retomber sur le comportement historique (500 générique), jamais pire.
 *
 * Deux messages distincts couvrent les deux points où `pg-pool` peut échouer à fournir une
 * connexion (`Pool.connect`, `node_modules/pg-pool/index.js`) :
 *   - le pool est PLEIN (`DATABASE_POOL_MAX` connexions déjà en cours d'usage) et une requête en
 *     FILE D'ATTENTE expire avant qu'une connexion ne se libère → « timeout exceeded when trying
 *     to connect ». C'est le message mesuré dans l'incident qui a motivé ce fichier : une vraie
 *     saturation, pas une reconnexion lente.
 *   - le pool N'EST PAS encore plein mais une connexion TOUTE NEUVE (après une purge par
 *     `DATABASE_TIMEOUT_IDLE_MS`, typiquement) n'a pas terminé sa poignée de main TCP +
 *     authentification SCRAM avant `DATABASE_TIMEOUT_CONNEXION_MS` → « Connection terminated due
 *     to connection timeout ». Cas distinct (pas la file d'attente), même remède côté client :
 *     réessayer après un court délai.
 */
import { ErreurMetier } from '../common/erreurs/erreur-metier';

const MESSAGES_EPUISEMENT_POOL: ReadonlySet<string> = new Set([
  'timeout exceeded when trying to connect',
  'Connection terminated due to connection timeout',
]);

/** Vrai si `erreur` correspond à un des deux échecs de connexion `pg-pool` documentés ci-dessus. */
export function estErreurEpuisementPool(erreur: unknown): boolean {
  return erreur instanceof Error && MESSAGES_EPUISEMENT_POOL.has(erreur.message);
}

/**
 * Délai suggéré au client avant de retenter (`Retry-After`, RFC 9110 §10.2.3 — entier en
 * secondes). Valeur fixe plutôt qu'une variable de config supplémentaire : ce n'est pas un
 * paramètre de dimensionnement (contrairement à `DATABASE_POOL_MAX`/`MIN`/aux deux timeouts),
 * juste une estimation robuste de "le temps qu'une requête en cours a des chances de libérer sa
 * connexion" — courte pour ne pas faire attendre inutilement un client déjà en échec, longue
 * assez pour ne pas transformer une vraie saturation en martèlement immédiat.
 */
export const RETRY_APRES_SECONDES_EPUISEMENT_POOL = 3;

/**
 * Construit l'`ErreurMetier` à lever à la place de l'erreur `pg-pool` brute. `status: 503` en
 * override du statut par défaut du code (`ERREUR_INTERNE` vaut normalement 500,
 * `STATUT_HTTP_PAR_CODE_ERREUR` dans `packages/shared`) — même mécanisme, déjà éprouvé, que
 * `GET /sante/pret` (voir la docstring d'`OptionsErreurMetier.status`, `common/erreurs/
 * erreur-metier.ts`) : `CODES_ERREUR` (gelé) ne porte aucun code dédié "dépendance
 * temporairement indisponible", et en ajouter un est un changement de contrat partagé qui se
 * négocie séparément (hors périmètre de cette correction) plutôt qu'un geste unilatéral d'un seul
 * module.
 *
 * `FiltreProbleme` n'a besoin d'AUCUNE modification pour que ceci fonctionne : le chemin
 * `exception instanceof ErreurMetier` existant lit déjà `exception.status` (503 ici, pas la
 * valeur par défaut du code) et pose chaque en-tête de `exception.enTetes` (`Retry-After` ici) —
 * exactement le même mécanisme que RM/`sante.controller.ts`.
 */
export function traduireErreurPoolSature(erreur: unknown): ErreurMetier {
  return new ErreurMetier(
    'ERREUR_INTERNE',
    'Le pool de connexions à la base de données est temporairement saturé.',
    {
      status: 503,
      detail: erreur instanceof Error ? erreur.message : String(erreur),
      enTetes: { 'Retry-After': String(RETRY_APRES_SECONDES_EPUISEMENT_POOL) },
    },
  );
}
