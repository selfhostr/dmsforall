import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
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
 * script Lua atomique — voir `SCRIPT_CONSOMMER`). Utilisée par l'équipe authentification sur
 * `POST /auth/connexion` (par IP et par email), verrouillage progressif du compte.
 *
 * Le suffixe `Redis` distingue l'implémentation de l'interface `ServiceLimitationDebit` qu'elle
 * réalise : les consommateurs injectent l'interface par jeton, jamais cette classe.
 */
@Injectable()
export class ServiceLimitationDebitRedis implements ServiceLimitationDebit {
  private readonly journal = new Logger(ServiceLimitationDebitRedis.name);

  constructor(
    @Inject(JETON_REDIS) private readonly redis: Redis,
    private readonly horloge: Horloge,
  ) {}

  async consommer(
    cle: string,
    limite: number,
    fenetreSecondes: number,
  ): Promise<ResultatLimitationDebit> {
    const cleRedis = `limitation:${cle}`;
    const maintenantMs = this.horloge.maintenant().getTime();
    const fenetreMs = fenetreSecondes * 1000;
    const membre = `${maintenantMs}:${randomUUID()}`;

    // Signature publique inchangée (contrat gelé, module auth dépendant) : seule la mécanique
    // interne devient atomique.
    let resultat: [number, number];
    try {
      resultat = (await this.redis.eval(
        SCRIPT_CONSOMMER,
        1,
        cleRedis,
        maintenantMs,
        fenetreMs,
        limite,
        membre,
      )) as [number, number];
    } catch (erreur) {
      // FAIL OPEN, délibérément — et ce n'est pas un choix nouveau : `ServiceLimitationDebit`
      // (limitation-debit.types.ts) documente déjà « n'échoue jamais par exception : le refus
      // est une valeur de retour, pas une erreur ». L'implémentation ne respectait pas son
      // propre contrat gelé (aucun `catch` ici avant ce correctif) — Redis indisponible faisait
      // remonter une exception non gérée jusqu'au contrôleur.
      //
      // Pourquoi fail OPEN et non fail CLOSED : les deux consommateurs de cette classe
      // (`authentification.service.ts` pour `POST /auth/connexion`, `garde-limitation-
      // recherche.ts` pour la recherche) s'appuient sur cette fenêtre glissante Redis comme
      // défense DE DÉBIT, jamais comme unique rempart. Pour la connexion en particulier, le
      // commentaire de `authentification.service.ts` est explicite : le verrouillage progressif
      // du compte, persisté en base (`utilisateur.verrouille_jusqu_a`), « reste une seconde
      // barrière indépendante, pas la seule ligne de défense » — c'est-à-dire l'inverse : LUI est
      // la barrière primaire, et NE DÉPEND PAS de Redis. Fail closed transformerait Redis en
      // point de défaillance unique pour l'authentification et la recherche de tout le tenant —
      // un Redis en panne bloquerait alors des logins légitimes que la défense primaire (en
      // base) continue, elle, de couvrir. Le compromis : une salve de force brute pendant une
      // panne Redis n'est freinée que par le verrouillage progressif en base, plus lent à
      // s'armer — dégradation mesurée, pas un trou de sécurité silencieux (voir le log ci-
      // dessous).
      //
      // Distinct du verrouillage PIN de la borne (`pointage/service-verrouillage-pin.ts`) : ce
      // service-là N'A PAS de défense primaire alternative (aucune table, par construction —
      // voir son en-tête), donc le même arbitrage ne s'y applique pas forcément. Hors périmètre
      // de ce correctif (répertoire `pointage/`) — signalé, pas changé.
      this.journal.error(
        `Redis indisponible pour la limitation de débit (clé="${cle}") — tentative autorisée en dégradé, la protection de débit est momentanément hors service : ${String(erreur)}`,
      );
      return { autorise: true, resteSecondes: 0 };
    }

    const [autoriseBrut, scorePlusAncien] = resultat;

    if (autoriseBrut === 0) {
      const resteMs = scorePlusAncien + fenetreMs - maintenantMs;
      return { autorise: false, resteSecondes: Math.max(1, Math.ceil(resteMs / 1000)) };
    }

    return { autorise: true, resteSecondes: 0 };
  }
}
