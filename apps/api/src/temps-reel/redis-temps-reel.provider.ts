/**
 * Deux connexions ioredis dédiées à ce module (voir `temps-reel.jetons.ts` pour pourquoi elles
 * sont séparées l'une de l'autre ET de `JETON_REDIS`). Cycle de vie (erreur journalisée sans
 * jamais tuer le process, fermeture propre accrochée à `onModuleDestroy`) factorisé dans
 * `common/redis/connecter-client-redis.ts`, partagé avec `common/limitation/redis.provider.ts`.
 */
import { Logger, type Provider } from '@nestjs/common';
import type Redis from 'ioredis';

import { JETON_CONFIG, type Config } from '../config';
import { connecterClientRedis } from '../common/redis';

import {
  JETON_REDIS_TEMPS_REEL_ABONNE,
  JETON_REDIS_TEMPS_REEL_PUBLIEUR,
} from './temps-reel.jetons';

const journal = new Logger('RedisTempsReel');

export const providerRedisPublieurTempsReel: Provider = {
  provide: JETON_REDIS_TEMPS_REEL_PUBLIEUR,
  useFactory: (config: Config): Redis =>
    connecterClientRedis(config, journal, 'publieur, canal temps réel'),
  inject: [JETON_CONFIG],
};

/**
 * Connexion en mode `SUBSCRIBE` — ne JAMAIS lui envoyer une commande hors Pub/Sub
 * (`GET`/`SET`/...), Redis la refuserait pendant qu'elle est abonnée à au moins un canal.
 */
export const providerRedisAbonneTempsReel: Provider = {
  provide: JETON_REDIS_TEMPS_REEL_ABONNE,
  useFactory: (config: Config): Redis =>
    connecterClientRedis(config, journal, 'abonné, canal temps réel'),
  inject: [JETON_CONFIG],
};
