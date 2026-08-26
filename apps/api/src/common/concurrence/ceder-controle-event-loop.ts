/**
 * Cession périodique du contrôle de la boucle d'événements Node — évite qu'une boucle
 * synchrone/quasi-synchrone (calcul CPU pur sur un grand nombre d'éléments, consommation d'un
 * flux dont le tampon interne reste toujours déjà rempli) ne monopolise le fil unique de Node
 * pendant plusieurs secondes/minutes d'affilée.
 *
 * DÉFAUT RÉEL (26.08.2026) — analyse d'une archive de reprise de 2,39 Go/359 tables : une SECONDE
 * exécution concurrente du même job s'est déclenchée pendant que la première tournait encore,
 * chacune extrayant 2,3 Go. MÉCANISME confirmé par la mesure (script `mesure-event-loop.mjs`,
 * rapport de livraison) : un `for await` consommant un flux Node dont le tampon interne est déjà
 * rempli (cas d'une lecture locale rapide, ou d'un sous-processus qui écrit plus vite qu'il n'est
 * consommé) résout chaque itération via une MICROTÂCHE — sans jamais repasser par la phase
 * « timers » de la boucle d'événements tant que des données restent bufferisées. Mesuré : un
 * `setInterval(…, 15)` posé en parallèle d'une telle boucle n'a déclenché AUCUN tick sur 2
 * millions d'itérations/1,28 s d'affilée. Le worker BullMQ renouvelle son verrou via exactement ce
 * genre de minuteur (`Worker.lockRenewTime`, la moitié de `lockDuration` par défaut) : sans
 * cession explicite, ce renouvellement peut ne JAMAIS s'exécuter à temps sur une boucle assez
 * longue — le verrou Redis expire, le vérificateur de jobs « stalled » redistribue le job à un
 * AUTRE worker pendant que le premier continue, sans le savoir, à travailler sur les mêmes
 * données. Deux conséquences, pas une seule : cette famine bloque AUSSI l'API pour tous les
 * tenants (sondes de santé, autres requêtes) pendant la même fenêtre — un seul processus Node sert
 * tout le monde.
 *
 * SEUL `setImmediate` restaure le passage par la boucle complète (phase « check », après « poll ») :
 * `await Promise.resolve()` ou `process.nextTick` ne suffiraient pas — ce sont des microtâches,
 * exactement ce qui affame déjà la boucle ici. Vérifié par la même mesure : avec cession
 * `setImmediate` toutes les 1000 itérations, le `setInterval(…, 15)` a bien tické normalement
 * (98 ticks sur la même durée, pire écart ~16 ms).
 */
export const SEUIL_CESSION_EVENT_LOOP_MS_DEFAUT = 20;

export interface OptionsCedeurEventLoop {
  /** Durée maximale, en ms, pendant laquelle la boucle protégée peut travailler d'affilée avant
   *  qu'une cession réelle ne soit déclenchée. */
  readonly seuilMs?: number;
  /** Override de test — horloge injectable, jamais `performance.now()` réel en test unitaire (la
   *  logique de déclenchement doit être vérifiable sans dépendre du vrai event loop). */
  readonly horloge?: () => number;
  /** Override de test — mécanisme de cession injectable, jamais un VRAI `setImmediate` en test de
   *  la logique de déclenchement (rendrait le test dépendant du vrai event loop, donc lent/instable
   *  pour ce qui n'a besoin de vérifier qu'un COMPTAGE d'appels). */
  readonly ceder?: () => Promise<void>;
}

export interface CedeurEventLoop {
  /**
   * À appeler à CHAQUE itération de la boucle protégée (chaque table, chaque ligne...) — no-op
   * tant que le seuil n'est pas atteint depuis la dernière cession réelle ; cède effectivement la
   * main (macrotâche) sinon, puis réarme le compteur.
   */
  cederSiNecessaire(): Promise<void>;
}

function cederViaSetImmediate(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

export function creerCedeurEventLoop(options: OptionsCedeurEventLoop = {}): CedeurEventLoop {
  const seuilMs = options.seuilMs ?? SEUIL_CESSION_EVENT_LOOP_MS_DEFAUT;
  const horloge = options.horloge ?? (() => performance.now());
  const ceder = options.ceder ?? cederViaSetImmediate;

  let dernierePauseMs = horloge();

  return {
    async cederSiNecessaire(): Promise<void> {
      if (horloge() - dernierePauseMs < seuilMs) return;
      await ceder();
      dernierePauseMs = horloge();
    },
  };
}
