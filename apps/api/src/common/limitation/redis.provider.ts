import { Logger, type Provider } from '@nestjs/common';
import Redis from 'ioredis';
import { JETON_CONFIG, type Config } from '../../config';

/** Jeton d'injection du client Redis partagé (limitation de débit, et santé applicative). */
export const JETON_REDIS = Symbol.for('DFA_REDIS');

/** Même patron que `ServiceAccesBase`/`ServiceAccesAmorcage` (db/acces-base.service.ts,
 *  db/acces-amorcage.service.ts) pour le pool Postgres : un logger nommé par composant, pas le
 *  logger générique Nest. */
const journal = new Logger('ClientRedis');

/** Type structurel minimal : NestJS invoke `onModuleDestroy` sur TOUTE instance de provider qui
 *  porte cette méthode — qu'elle vienne d'une classe, d'une factory ou d'une valeur
 *  (`@nestjs/core/hooks/on-module-destroy.hook.js`, `isFunction(instance.onModuleDestroy)`,
 *  vérifié sur ce dépôt). On peut donc accrocher le hook directement sur l'instance `ioredis`
 *  produite par la factory, sans avoir à l'envelopper dans une classe de service dédiée. */
interface AvecCycleDeVie {
  onModuleDestroy?: () => Promise<void>;
}

export const providerRedis: Provider = {
  provide: JETON_REDIS,
  useFactory: (config: Config): Redis => {
    const redis = new Redis(config.REDIS_URL, {
      // On gère nous-mêmes les erreurs (santé applicative) plutôt que de laisser ioredis
      // retenter indéfiniment en silence.
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });

    // Sans ce gestionnaire, une erreur sur la connexion (coupure réseau, bascule Redis,
    // redémarrage du service managé) remonte en `unhandledError` d'EventEmitter et TUE LE
    // PROCESSUS NODE — même raisonnement que le `pool.on('error', ...)` de `ServiceAccesBase`
    // pour Postgres. Redis ne sert ici qu'à la limitation de débit et au verrouillage PIN
    // (pointage borne) : une dépendance secondaire ne doit jamais pouvoir arrêter l'API entière.
    // On journalise fort (niveau `error`, pas `debug`) : un écouteur qui avale l'erreur en
    // silence ferait perdre la trace d'un Redis en panne, presque aussi grave que l'absence
    // d'écouteur. Le comportement applicatif face à un Redis indisponible (fail open / fail
    // closed) se décide au niveau de chaque consommateur, pas ici — voir
    // `service-limitation-debit.ts`.
    redis.on('error', (erreur) => {
      journal.error(
        `Erreur sur le client Redis partagé (limitation de débit, verrouillage PIN) : ${erreur.message}`,
      );
    });

    // `app.close()` (arrêt applicatif, y compris en test) ne fermait jamais cette connexion :
    // en test, une connexion ioredis pendante retardait/flakait l'arrêt du harnais ; en
    // production, ça retarde ou bloque l'arrêt propre attendu par un déploiement conteneurisé.
    // `quit()` est gracieux (laisse les commandes en vol se terminer) ; si la connexion est déjà
    // dans un état dégradé (Redis injoignable à l'arrêt), on retombe sur `disconnect()`,
    // synchrone et sans exception, plutôt que de laisser l'arrêt de l'application échouer pour
    // une dépendance secondaire.
    (redis as Redis & AvecCycleDeVie).onModuleDestroy = async () => {
      try {
        await redis.quit();
      } catch (erreur) {
        journal.warn(
          `Fermeture propre du client Redis en échec, déconnexion forcée : ${String(erreur)}`,
        );
        redis.disconnect();
      }
    };

    return redis;
  },
  inject: [JETON_CONFIG],
};
