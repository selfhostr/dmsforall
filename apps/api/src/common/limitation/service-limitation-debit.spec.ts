/**
 * Tests unitaires de `ServiceLimitationDebitRedis` — en particulier régression du finding 5
 * (audit sécurité étape 0) : l'ancienne implémentation (`zremrangebyscore` puis `zcard` puis
 * `multi()/zadd`, trois allers-retours Redis distincts) laissait passer bien plus de tentatives
 * que la limite configurée sous requêtes concurrentes, parce que toutes les lectures `zcard`
 * pouvaient s'exécuter avant qu'aucun `zadd` ne soit commis.
 *
 * `RedisFactice` ci-dessous n'interprète pas le Lua : elle réimplémente la même logique en
 * JavaScript, dans une méthode `eval` volontairement dépourvue de tout `await` interne. C'est
 * la propriété qui compte ici : dans un test qui déclenche N appels concurrents via
 * `Promise.all`, chaque invocation de `eval()` s'exécute intégralement (lecture + mutation de
 * l'état partagé) avant que le contrôle ne revienne à la boucle d'événements — exactement
 * l'atomicité que garantit un vrai script Redis `EVAL` (mono-thread, aucune commande d'un autre
 * client ne peut s'intercaler pendant son exécution). Avec l'ancienne implémentation
 * multi-aller-retour, ce même test échouerait : chaque `await` entre les commandes est un point
 * d'entrelacement où les appels concurrents peuvent lire un compte pas encore à jour.
 */

import { describe, expect, it } from 'vitest';
import type Redis from 'ioredis';
import { Horloge } from '../horloge/horloge';
import { ServiceLimitationDebitRedis } from './service-limitation-debit';

interface EntreeZset {
  readonly score: number;
  readonly membre: string;
}

/**
 * Doublure de test du client Redis : implémente uniquement `eval`, seule méthode utilisée par
 * `ServiceLimitationDebitRedis` depuis la correction du finding 5. Le comportement reproduit
 * fidèlement `SCRIPT_CONSOMMER` (purge par score, comptage, ajout conditionnel).
 */
class RedisFactice {
  private readonly stockage = new Map<string, EntreeZset[]>();

  // Signature volontairement large (les arguments variadiques de `eval` sont `string | Buffer |
  // number` côté ioredis) : seule la doublure de test a besoin de connaître l'ordre réel.
  async eval(_script: string, _numkeys: number, ...args: Array<string | number>): Promise<[number, number]> {
    const cle = String(args[0]);
    const maintenant = Number(args[1]);
    const fenetreMs = Number(args[2]);
    const limite = Number(args[3]);
    const membre = String(args[4]);

    const entrees = this.stockage.get(cle) ?? [];
    const restantes = entrees.filter((e) => e.score > maintenant - fenetreMs);

    if (restantes.length >= limite) {
      this.stockage.set(cle, restantes);
      const scorePlusAncien = restantes.reduce(
        (min, e) => (e.score < min ? e.score : min),
        restantes[0]?.score ?? maintenant,
      );
      return [0, scorePlusAncien];
    }

    restantes.push({ score: maintenant, membre });
    this.stockage.set(cle, restantes);
    return [1, 0];
  }
}

/** Horloge factice à date contrôlée par le test, pour vérifier la fenêtre glissante. */
function horlogeFigeeA(dateInitiale: number): Horloge {
  let courant = dateInitiale;
  return {
    maintenant: () => new Date(courant),
    avancer(ms: number): void {
      courant += ms;
    },
  } as Horloge & { avancer(ms: number): void };
}

function creerService(horloge: Horloge): ServiceLimitationDebitRedis {
  const redis = new RedisFactice() as unknown as Redis;
  return new ServiceLimitationDebitRedis(redis, horloge);
}

describe('ServiceLimitationDebitRedis.consommer', () => {
  it('autorise les tentatives jusqu\'à la limite puis refuse la suivante', async () => {
    const service = creerService(horlogeFigeeA(1_000_000));

    for (let i = 0; i < 5; i += 1) {
      const resultat = await service.consommer('cle-test', 5, 900);
      expect(resultat.autorise, `tentative ${String(i + 1)} devrait être autorisée`).toBe(true);
      expect(resultat.resteSecondes).toBe(0);
    }

    const refus = await service.consommer('cle-test', 5, 900);
    expect(refus.autorise).toBe(false);
    expect(refus.resteSecondes).toBeGreaterThan(0);
  });

  it('resteSecondes est toujours au moins 1 quand refusé (jamais 0, qui signifierait "réessaie immédiatement")', async () => {
    const service = creerService(horlogeFigeeA(1_000_000));
    await service.consommer('cle-reste', 1, 900);
    const refus = await service.consommer('cle-reste', 1, 900);
    expect(refus.autorise).toBe(false);
    expect(refus.resteSecondes).toBeGreaterThanOrEqual(1);
    expect(refus.resteSecondes).toBeLessThanOrEqual(900);
  });

  it('la fenêtre glissante purge les tentatives expirées : une tentative redevient possible après la fenêtre', async () => {
    const horloge = horlogeFigeeA(1_000_000) as Horloge & { avancer(ms: number): void };
    const service = creerService(horloge);

    await service.consommer('cle-fenetre', 1, 60);
    const refusAvant = await service.consommer('cle-fenetre', 1, 60);
    expect(refusAvant.autorise).toBe(false);

    horloge.avancer(60_001);

    const autoriseApres = await service.consommer('cle-fenetre', 1, 60);
    expect(autoriseApres.autorise).toBe(true);
  });

  it('deux clés distinctes (IP et email, par exemple) ont des compteurs indépendants', async () => {
    const service = creerService(horlogeFigeeA(1_000_000));

    await service.consommer('auth:connexion:ip:1.2.3.4', 1, 900);
    const refusIp = await service.consommer('auth:connexion:ip:1.2.3.4', 1, 900);
    expect(refusIp.autorise).toBe(false);

    const autoriseEmail = await service.consommer('auth:connexion:email:a@b.ch', 1, 900);
    expect(autoriseEmail.autorise).toBe(true);
  });

  it('régression finding 5 — N requêtes strictement concurrentes sur la même clé ne dépassent jamais la limite', async () => {
    const service = creerService(horlogeFigeeA(1_000_000));
    const limite = 5;
    const nombreRequetesConcurrentes = 100;

    const resultats = await Promise.all(
      Array.from({ length: nombreRequetesConcurrentes }, () => service.consommer('cle-concurrence', limite, 900)),
    );

    const nombreAutorises = resultats.filter((r) => r.autorise).length;
    expect(nombreAutorises).toBe(limite);
    expect(resultats.length - nombreAutorises).toBe(nombreRequetesConcurrentes - limite);
  });
});
