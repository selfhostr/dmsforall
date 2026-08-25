/**
 * Preuve du délai dur (finding sécurité MOYENNE, audit 25.08.2026) : un sous-processus `mdbtools`
 * qui ne rend jamais la main (fichier `.mdb` forgé qui fait boucler le parseur) ne doit plus
 * occuper un slot de worker BullMQ indéfiniment — voir `DELAI_MAX_COMMANDE_COURTE_MS`.
 */

import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErreurDelaiDepasseProcessus } from '../erreurs';
import {
  executerCommandeCapturee,
  type FabriqueProcessus,
  type ProcessusExecute,
} from './executeur-processus';

/** Sous-processus factice qui n'émet jamais `close`/`error` — simule un binaire bloqué. */
function creerProcessusBloque(): { processus: ProcessusExecute; kill: ReturnType<typeof vi.fn> } {
  const emetteur = new EventEmitter();
  const kill = vi.fn();
  const stdout = new Readable({ read: () => undefined });
  const stderr = new Readable({ read: () => undefined });
  const processus: ProcessusExecute = {
    stdout,
    stderr,
    on: emetteur.on.bind(emetteur),
    kill,
  };
  return { processus, kill };
}

/** Sous-processus factice qui ferme immédiatement (succès). `close` n'est émis qu'une fois
 *  `stdout` réellement épuisé (`end`) — sans quoi une course est possible entre la livraison des
 *  octets bufferisés et l'émission de `close`, qui résoudrait avec un `stdout` vide. */
function creerProcessusRapide(): ProcessusExecute {
  const emetteur = new EventEmitter();
  const stdout = Readable.from([Buffer.from('ok', 'utf-8')]);
  const stderr = Readable.from([]);
  const processus: ProcessusExecute = {
    stdout,
    stderr,
    on: emetteur.on.bind(emetteur),
    kill: vi.fn(),
  };
  stdout.on('end', () => emetteur.emit('close', 0));
  return processus;
}

describe('executerCommandeCapturee — délai dur', () => {
  beforeEach(() => {
    // Seuls `setTimeout`/`clearTimeout` sont simulés — laisser `process.nextTick`/`setImmediate`
    // réels, dont dépendent les flux Node (`Readable`) utilisés par les fixtures de ce fichier.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('un processus qui ferme AVANT le délai résout normalement (pas de faux positif)', async () => {
    const fabrique: FabriqueProcessus = () => creerProcessusRapide();
    const resultat = await executerCommandeCapturee(
      fabrique,
      'mdb-tables',
      ['-1', '/x.mdb'],
      process.env,
      1_000,
    );
    expect(resultat.codeSortie).toBe(0);
    expect(resultat.stdout.toString('utf-8')).toBe('ok');
  });

  it('un processus qui ne rend JAMAIS la main est terminé (SIGTERM) et la promesse rejette', async () => {
    const { processus, kill } = creerProcessusBloque();
    const fabrique: FabriqueProcessus = () => processus;

    const promesse = executerCommandeCapturee(
      fabrique,
      'mdb-tables',
      ['-1', '/forge.mdb'],
      process.env,
      1_000,
    );
    const attenteRejet = expect(promesse).rejects.toThrow(ErreurDelaiDepasseProcessus);

    await vi.advanceTimersByTimeAsync(1_000);

    expect(kill).toHaveBeenCalledWith('SIGTERM');
    await attenteRejet;
  });

  it('escalade en SIGKILL si le processus ignore SIGTERM au-delà du délai de grâce', async () => {
    const { processus, kill } = creerProcessusBloque();
    const fabrique: FabriqueProcessus = () => processus;

    const promesse = executerCommandeCapturee(
      fabrique,
      'mdb-tables',
      ['-1', '/forge.mdb'],
      process.env,
      1_000,
    );
    promesse.catch(() => undefined); // évite un unhandledRejection pendant l'avance des timers

    await vi.advanceTimersByTimeAsync(1_000);
    expect(kill).toHaveBeenCalledWith('SIGTERM');
    expect(kill).not.toHaveBeenCalledWith('SIGKILL');

    await vi.advanceTimersByTimeAsync(5_000);
    expect(kill).toHaveBeenCalledWith('SIGKILL');
  });

  it("n'écrase pas une résolution déjà obtenue si le délai expire juste après une fermeture normale", async () => {
    const fabrique: FabriqueProcessus = () => creerProcessusRapide();
    const resultat = await executerCommandeCapturee(
      fabrique,
      'mdb-tables',
      ['-1', '/x.mdb'],
      process.env,
      1_000,
    );
    await vi.advanceTimersByTimeAsync(2_000); // le minuteur est déjà annulé — aucun effet
    expect(resultat.codeSortie).toBe(0);
  });
});
