import { describe, expect, it, vi } from 'vitest';

import { creerCedeurEventLoop } from './ceder-controle-event-loop';

/**
 * Deux volets, délibérément séparés (voir tête de fichier `ceder-controle-event-loop.ts`) :
 *   1. logique de déclenchement — horloge et cession INJECTÉES, aucune dépendance au vrai event
 *      loop, déterministe ;
 *   2. cession RÉELLE — un test unique, avec un vrai `setInterval` et un vrai `setImmediate`, qui
 *      prouve que le mécanisme fonctionne sur le runtime Node réel, pas seulement sur le papier.
 *      Tolérance volontairement large (comparée au seuil de production) pour rester stable sous
 *      charge CI — un test honnête sur ce qui est mesurable, jamais un test de course fragile sur
 *      un vrai job qui stallerait.
 */
describe('creerCedeurEventLoop — logique de déclenchement (horloge/cession injectées)', () => {
  it("n'appelle jamais la cession tant que le seuil n'est pas atteint", async () => {
    let horlogeMs = 0;
    const ceder = vi.fn(async () => undefined);
    const cedeur = creerCedeurEventLoop({ seuilMs: 20, horloge: () => horlogeMs, ceder });

    // Cumul volontairement borné SOUS le seuil (15 < 20) — 15 itérations de 1ms de "travail"
    // chacune, jamais assez pour franchir 20ms depuis la dernière (seule) référence posée.
    for (let i = 0; i < 15; i++) {
      horlogeMs += 1;
      await cedeur.cederSiNecessaire();
    }

    expect(ceder).not.toHaveBeenCalled();
  });

  it('déclenche la cession dès que le seuil est franchi, puis réarme la référence', async () => {
    let horlogeMs = 0;
    const ceder = vi.fn(async () => undefined);
    const cedeur = creerCedeurEventLoop({ seuilMs: 20, horloge: () => horlogeMs, ceder });

    horlogeMs = 25; // franchit le seuil dès le premier appel
    await cedeur.cederSiNecessaire();
    expect(ceder).toHaveBeenCalledTimes(1);

    // Juste après la cession, la référence est réarmée sur l'horloge courante (25) — un appel à
    // 30 (delta 5 < 20) ne doit PAS redéclencher.
    horlogeMs = 30;
    await cedeur.cederSiNecessaire();
    expect(ceder).toHaveBeenCalledTimes(1);

    // 25 + 20 = 45 franchit à nouveau le seuil depuis le dernier réarmement.
    horlogeMs = 45;
    await cedeur.cederSiNecessaire();
    expect(ceder).toHaveBeenCalledTimes(2);
  });

  it('ne cède jamais une seconde fois pour le même dépassement (délai remis à zéro exactement une fois par cession)', async () => {
    let horlogeMs = 0;
    const ceder = vi.fn(async () => undefined);
    const cedeur = creerCedeurEventLoop({ seuilMs: 10, horloge: () => horlogeMs, ceder });

    horlogeMs = 100; // très largement au-delà du seuil, une seule fois
    await cedeur.cederSiNecessaire();
    await cedeur.cederSiNecessaire();
    await cedeur.cederSiNecessaire();

    expect(ceder).toHaveBeenCalledTimes(1);
  });

  it('seuil par défaut appliqué sans option explicite', async () => {
    const ceder = vi.fn(async () => undefined);
    let horlogeMs = 0;
    const cedeur = creerCedeurEventLoop({ horloge: () => horlogeMs, ceder });

    horlogeMs = 19;
    await cedeur.cederSiNecessaire();
    expect(ceder).not.toHaveBeenCalled();

    horlogeMs = 20;
    await cedeur.cederSiNecessaire();
    expect(ceder).toHaveBeenCalledTimes(1);
  });
});

describe('creerCedeurEventLoop — cession réelle sur le runtime Node (pas de double injectée)', () => {
  it(
    "une boucle synchrone serrée qui cède régulièrement laisse un vrai minuteur s'exécuter " +
      '(preuve directe : SANS cession, ce même gabarit de boucle bloque le minuteur — voir le ' +
      "script de mesure cité en tête de fichier, 0 tick sur 2M d'itérations/1,28s)",
    async () => {
      const cedeur = creerCedeurEventLoop({ seuilMs: 5 });
      let ticks = 0;
      const minuteur = setInterval(() => {
        ticks += 1;
      }, 5);

      try {
        // Boucle CPU pure, sans aucune I/O réelle — le pire cas identifié par la mesure. Si la
        // cession ne fonctionnait pas (ou était retirée), `ticks` resterait à 0 tout du long.
        let n = 0;
        const debut = performance.now();
        while (performance.now() - debut < 200) {
          for (let i = 0; i < 10_000; i++) n += i % 7;
          await cedeur.cederSiNecessaire();
        }
        expect(n).toBeGreaterThan(0); // la boucle a réellement travaillé, pas un test vide
      } finally {
        clearInterval(minuteur);
      }

      // Tolérance large (>=3 ticks sur 200ms/seuil 5ms — largement moins que les ~40 attendus en
      // théorie) : l'objectif est de prouver que le minuteur avance NORMALEMENT, jamais de figer
      // un compte exact sensible à la charge CI.
      expect(ticks).toBeGreaterThanOrEqual(3);
    },
  );
});
