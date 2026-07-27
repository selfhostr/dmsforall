import type { Provider } from '@nestjs/common';
import Redis from 'ioredis';
import { JETON_CONFIG, type Config } from '../../config';

/** Jeton d'injection du client Redis partagé (limitation de débit, et santé applicative). */
export const JETON_REDIS = Symbol.for('DFA_REDIS');

export const providerRedis: Provider = {
  provide: JETON_REDIS,
  useFactory: (config: Config): Redis => {
    return new Redis(config.REDIS_URL, {
      // On gère nous-mêmes les erreurs (santé applicative) plutôt que de laisser ioredis
      // retenter indéfiniment en silence.
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });
  },
  inject: [JETON_CONFIG],
};
