import { Logger } from '@nestjs/common';
import Redis from 'ioredis';
import type { Config } from '../../config';

/** Type structurel minimal : NestJS invoke `onModuleDestroy` sur TOUTE instance de provider qui
 *  porte cette méthode — qu'elle vienne d'une classe, d'une factory ou d'une valeur
 *  (`@nestjs/core/hooks/on-module-destroy.hook.js`, `isFunction(instance.onModuleDestroy)`,
 *  vérifié sur ce dépôt). On peut donc accrocher le hook directement sur l'instance `ioredis`
 *  produite par la factory, sans avoir à l'envelopper dans une classe de service dédiée. */
interface AvecCycleDeVie {
  onModuleDestroy?: () => Promise<void>;
}

/**
 * Connexion `ioredis` avec le cycle de vie commun à tous les clients Redis du dépôt (limitation
 * de débit, verrouillage PIN, canal temps réel) — factorisé depuis deux implémentations
 * jumelles (`common/limitation/redis.provider.ts`, `temps-reel/redis-temps-reel.provider.ts`)
 * qui ne divergeaient que sur le libellé journalisé.
 *
 * Sans le gestionnaire d'erreur : une coupure réseau/bascule Redis remonte en `unhandledError`
 * d'EventEmitter et TUE LE PROCESSUS NODE — même raisonnement que `pool.on('error', ...)` de
 * `ServiceAccesBase` pour Postgres. Redis n'est ici qu'une dépendance secondaire : sa panne ne
 * doit jamais pouvoir arrêter l'API entière. Le comportement applicatif face à un Redis
 * indisponible (fail open / fail closed) se décide chez chaque consommateur, pas ici.
 *
 * Sans `onModuleDestroy` : `app.close()` (arrêt applicatif, y compris en test) ne fermait jamais
 * la connexion — en test, une connexion ioredis pendante retardait/flakait l'arrêt du harnais ;
 * en production, ça retarde ou bloque l'arrêt propre attendu par un déploiement conteneurisé.
 * `quit()` est gracieux (laisse les commandes en vol se terminer) ; si la connexion est déjà
 * dans un état dégradé, on retombe sur `disconnect()`, synchrone et sans exception.
 */
export function connecterClientRedis(config: Config, journal: Logger, nomComposant: string): Redis {
  const redis = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: false,
  });

  redis.on('error', (erreur) => {
    journal.error(`Erreur sur la connexion Redis "${nomComposant}" : ${erreur.message}`);
  });

  (redis as Redis & AvecCycleDeVie).onModuleDestroy = async () => {
    try {
      await redis.quit();
    } catch (erreur) {
      journal.warn(
        `Fermeture propre de la connexion Redis "${nomComposant}" en échec, déconnexion forcée : ${String(erreur)}`,
      );
      redis.disconnect();
    }
  };

  return redis;
}
