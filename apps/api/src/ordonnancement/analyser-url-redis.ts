// Type `RedisOptions` de BullMQ lui-même (`bullmq`, PAS `ioredis`) — BullMQ définit sa PROPRE
// interface, structurellement proche mais distincte de celle d'`ioredis` (`ConnectionOptions`
// de `QueueOptions` n'accepte QUE ce type-ci, ou une instance déjà connectée). Utiliser le type
// `ioredis` ici échoue à la compilation (`Type 'RedisOptions' is not assignable to type
// 'ConnectionOptions'`), vérifié en exécution avant d'écrire ce commentaire.
import type { RedisOptions } from 'bullmq';

/**
 * `REDIS_URL` (`redis://[:motdepasse@]hote:port[/base]`, `rediss://` en TLS — voir
 * `charger-config.ts` § REDIS_URL et `docker-compose.yml` pour le format réel en
 * production, avec mot de passe) vers des `RedisOptions` ioredis PLATES.
 *
 * PAS une instance `Redis` construite ici, à dessein : `BullModule.forRootAsync` (voir
 * `ordonnancement.module.ts`) reçoit ces options plutôt qu'une instance déjà connectée — BullMQ
 * construit et FERME alors lui-même la connexion qu'il pilote (comportement documenté de
 * `@nestjs/bullmq`/BullMQ : une instance `Redis` fournie par l'appelant reste sous LA
 * responsabilité de l'appelant, une simple configuration ne l'est pas). Ça évite d'avoir à écrire
 * et maintenir notre propre logique de fermeture propre pour cette connexion, contrairement à
 * `JETON_REDIS` (`common/limitation/redis.provider.ts`), où une instance déjà construite doit
 * être partagée entre plusieurs consommateurs applicatifs — pas le cas ici, BullMQ est le seul
 * consommateur de cette connexion.
 *
 * `maxRetriesPerRequest: null` — exigé par BullMQ pour toute connexion qu'il pilote (commandes
 * bloquantes) — voir la doc BullMQ, « Important Notes ».
 *
 * Fonction PURE (aucune I/O, aucune connexion ouverte) : testable sans réseau ni Redis réel.
 */
export function analyserUrlRedisPourBullMq(url: string): RedisOptions {
  const analysee = new URL(url);

  const options: RedisOptions = {
    host: analysee.hostname,
    port: analysee.port ? Number(analysee.port) : 6379,
    maxRetriesPerRequest: null,
  };

  if (analysee.password) {
    options.password = decodeURIComponent(analysee.password);
  }
  // `default` = utilisateur ACL implicite d'un `redis://:motdepasse@hote` sans nom d'utilisateur
  // explicite (username vide côté `URL`) : ne jamais le poser explicitement, ioredis s'en charge
  // lui-même quand `password` est fourni seul.
  if (analysee.username && analysee.username !== 'default') {
    options.username = decodeURIComponent(analysee.username);
  }
  const base = analysee.pathname.replace(/^\//, '');
  if (base) {
    options.db = Number(base);
  }
  if (analysee.protocol === 'rediss:') {
    options.tls = {};
  }

  return options;
}
