import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { Horloge } from '../horloge/horloge';
import { JETON_REDIS } from './redis.provider';
import type { ResultatLimitationDebit, ServiceLimitationDebit } from './limitation-debit.types';

/**
 * Purge + comptage + ajout conditionnel, en UN SEUL aller-retour Redis.
 *
 * Correctif finding 5 (audit sécurité) : l'ancienne implémentation faisait `zremrangebyscore`
 * puis `zcard` puis `multi()/zadd` — trois allers-retours distincts, sans atomicité entre eux.
 * Sous requêtes parallèles (N requêtes simultanées sur la même clé), toutes lisaient le même
 * `zcard` avant qu'aucun `zadd` ne soit commis : la limite de 5 tentatives devenait ~N essais
 * par salve. Un script Lua `EVAL` s'exécute de façon atomique côté serveur Redis (mono-thread,
 * aucune commande d'un autre client ne peut s'intercaler pendant son exécution) : la lecture du
 * compte et l'ajout de la tentative ne peuvent plus être désynchronisés par la concurrence.
 *
 * KEYS[1] = clé Redis (namespace `limitation:` déjà appliqué par l'appelant).
 * ARGV[1] = horodatage courant (ms). ARGV[2] = largeur de fenêtre (ms). ARGV[3] = limite.
 * ARGV[4] = identifiant unique de la tentative courante (membre du ZSET).
 *
 * Renvoie `{1, 0}` si autorisé (tentative ajoutée), ou `{0, <score du membre le plus ancien
 * restant>}` si refusé — le score sert à calculer `resteSecondes` côté appelant sans repasser
 * par Redis.
 */
const SCRIPT_CONSOMMER = `
local cle = KEYS[1]
local maintenant = tonumber(ARGV[1])
local fenetreMs = tonumber(ARGV[2])
local limite = tonumber(ARGV[3])
local membre = ARGV[4]

redis.call('ZREMRANGEBYSCORE', cle, 0, maintenant - fenetreMs)
local compteActuel = redis.call('ZCARD', cle)

if compteActuel >= limite then
  local plusAncien = redis.call('ZRANGE', cle, 0, 0, 'WITHSCORES')
  local scorePlusAncien = maintenant
  if plusAncien[2] then
    scorePlusAncien = tonumber(plusAncien[2])
  end
  return {0, scorePlusAncien}
end

redis.call('ZADD', cle, maintenant, membre)
redis.call('PEXPIRE', cle, fenetreMs)
return {1, 0}
`;

/**
 * Limitation de débit à fenêtre glissante, sur Redis (ZSET par clé, purgé et incrémenté par un
 * script Lua atomique — voir `SCRIPT_CONSOMMER`). Utilisée par expert-auth sur
 * `POST /auth/connexion` (par IP et par email), verrouillage progressif du compte.
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
    const fenetreMs = fenetreSecondes * 1000;
    const membre = `${maintenantMs}:${randomUUID()}`;

    // Signature publique inchangée (contrat gelé, module auth dépendant) : seule la mécanique
    // interne devient atomique.
    const resultat = (await this.redis.eval(
      SCRIPT_CONSOMMER,
      1,
      cleRedis,
      maintenantMs,
      fenetreMs,
      limite,
      membre,
    )) as [number, number];

    const [autoriseBrut, scorePlusAncien] = resultat;

    if (autoriseBrut === 0) {
      const resteMs = scorePlusAncien + fenetreMs - maintenantMs;
      return { autorise: false, resteSecondes: Math.max(1, Math.ceil(resteMs / 1000)) };
    }

    return { autorise: true, resteSecondes: 0 };
  }
}
