import { Logger, type Provider } from '@nestjs/common';
import type Redis from 'ioredis';
import { JETON_CONFIG, type Config } from '../../config';
import { connecterClientRedis } from '../redis';

/** Jeton d'injection du client Redis partagé (limitation de débit, et santé applicative). */
export const JETON_REDIS = Symbol.for('DFA_REDIS');

/** Même patron que `ServiceAccesBase`/`ServiceAccesAmorcage` (db/acces-base.service.ts,
 *  db/acces-amorcage.service.ts) pour le pool Postgres : un logger nommé par composant, pas le
 *  logger générique Nest. */
const journal = new Logger('ClientRedis');

export const providerRedis: Provider = {
  provide: JETON_REDIS,
  useFactory: (config: Config): Redis =>
    connecterClientRedis(config, journal, 'limitation de débit, verrouillage PIN'),
  inject: [JETON_CONFIG],
};
