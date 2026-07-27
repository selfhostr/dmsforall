import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { Horloge } from '../horloge/horloge';
import { JETON_REDIS } from './redis.provider';
import type { ResultatLimitationDebit, ServiceLimitationDebit } from './limitation-debit.types';

/**
 * Limitation de débit à fenêtre glissante, sur Redis (ZSET par clé). Utilisée par
 * expert-auth sur `POST /auth/connexion` (par IP et par email), verrouillage progressif du
 * compte. Un seul ZSET par clé : on purge les entrées hors fenêtre à chaque appel, puis on
 * compare le compte restant à la limite avant d'ajouter la tentative courante.
 *
 * Le suffixe `Redis` distingue l'implémentation de l'interface `ServiceLimitationDebit` qu'elle
 * réalise : les consommateurs injectent l'interface par jeton, jamais cette classe.
 */
@Injectable()
export class ServiceLimitationDebitRedis implements ServiceLimitationDebit {
  constructor(
    @Inject(JETON_REDIS) private readonly redis: Redis,
    private readonly horloge: Horloge,
  ) {}

  async consommer(cle: string, limite: number, fenetreSecondes: number): Promise<ResultatLimitationDebit> {
    const cleRedis = `limitation:${cle}`;
    const maintenantMs = this.horloge.maintenant().getTime();
    const debutFenetreMs = maintenantMs - fenetreSecondes * 1000;

    await this.redis.zremrangebyscore(cleRedis, 0, debutFenetreMs);
    const compteActuel = await this.redis.zcard(cleRedis);

    if (compteActuel >= limite) {
      const plusAncien = await this.redis.zrange(cleRedis, 0, 0, 'WITHSCORES');
      const scoreLePlusAncien = plusAncien[1] ? Number(plusAncien[1]) : maintenantMs;
      const resteMs = scoreLePlusAncien + fenetreSecondes * 1000 - maintenantMs;
      return { autorise: false, resteSecondes: Math.max(1, Math.ceil(resteMs / 1000)) };
    }

    const pipeline = this.redis.multi();
    pipeline.zadd(cleRedis, maintenantMs, `${maintenantMs}:${randomUUID()}`);
    pipeline.expire(cleRedis, fenetreSecondes);
    await pipeline.exec();

    return { autorise: true, resteSecondes: 0 };
  }
}
