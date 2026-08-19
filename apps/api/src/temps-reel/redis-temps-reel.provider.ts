/**
 * Deux connexions ioredis dédiées à ce module (voir `temps-reel.jetons.ts` pour pourquoi elles
 * sont séparées l'une de l'autre ET de `JETON_REDIS`). Même patron de cycle de vie que
 * `common/limitation/redis.provider.ts` : erreur journalisée sans jamais tuer le process (Redis
 * est une dépendance SECONDAIRE — sa panne dégrade la notification temps réel, jamais l'API), et
 * fermeture propre (`quit`, secours `disconnect`) accrochée à `onModuleDestroy`.
 */
import { Logger, type Provider } from '@nestjs/common';
import Redis from 'ioredis';

import { JETON_CONFIG, type Config } from '../config';

import {
  JETON_REDIS_TEMPS_REEL_ABONNE,
  JETON_REDIS_TEMPS_REEL_PUBLIEUR,
} from './temps-reel.jetons';

const journal = new Logger('RedisTempsReel');

interface AvecCycleDeVie {
  onModuleDestroy?: () => Promise<void>;
}

function creerClient(config: Config, nom: string): Redis {
  const redis = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: false,
  });

  redis.on('error', (erreur) => {
    journal.error(`Erreur sur la connexion Redis "${nom}" (canal temps réel) : ${erreur.message}`);
  });

  (redis as Redis & AvecCycleDeVie).onModuleDestroy = async () => {
    try {
      await redis.quit();
    } catch (erreur) {
      journal.warn(`Fermeture propre de "${nom}" en échec, déconnexion forcée : ${String(erreur)}`);
      redis.disconnect();
    }
  };

  return redis;
}

export const providerRedisPublieurTempsReel: Provider = {
  provide: JETON_REDIS_TEMPS_REEL_PUBLIEUR,
  useFactory: (config: Config): Redis => creerClient(config, 'publieur'),
  inject: [JETON_CONFIG],
};

/**
 * Connexion en mode `SUBSCRIBE` — ne JAMAIS lui envoyer une commande hors Pub/Sub
 * (`GET`/`SET`/...), Redis la refuserait pendant qu'elle est abonnée à au moins un canal.
 */
export const providerRedisAbonneTempsReel: Provider = {
  provide: JETON_REDIS_TEMPS_REEL_ABONNE,
  useFactory: (config: Config): Redis => creerClient(config, 'abonne'),
  inject: [JETON_CONFIG],
};
