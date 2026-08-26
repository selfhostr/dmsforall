import { describe, expect, it } from 'vitest';
import 'reflect-metadata';

import { ProcesseurAnalyseReprise } from './analyse/processeur-analyse-reprise';
import { ProcesseurImportReprise } from './import/processeur-import-reprise';
import { OPTIONS_WORKER_REPRISE } from './reprise.jetons';

/**
 * Prouve que la configuration attendue est bien POSÉE — pas que la course (job stallé, redélivré à
 * un second worker) est reproduite : un défaut de concurrence de ce genre est délibérément
 * difficile/fragile à simuler fidèlement (voir `common/concurrence/ceder-controle-event-loop.spec.
 * ts` pour la preuve, elle, mesurable directement : le mécanisme de famine de l'event loop qui rend
 * ce filet nécessaire). Ici, on vérifie exactement ce que `@nestjs/bullmq` fait de
 * `@Processor(nom, options)` : `SetMetadata` pose les options sous la clé `bullmq:worker_metadata`
 * sur la classe elle-même (`Reflect.defineMetadata`) — c'est cette métadonnée que le module BullMQ
 * lit au démarrage pour construire le `Worker` réel (`lockDuration`, `concurrency`, ...).
 */
const CLE_METADATA_WORKER_BULLMQ = 'bullmq:worker_metadata';

describe('reprise — options worker BullMQ des deux processeurs de reprise', () => {
  it.each([
    ['ProcesseurAnalyseReprise', ProcesseurAnalyseReprise],
    ['ProcesseurImportReprise', ProcesseurImportReprise],
  ])('%s porte OPTIONS_WORKER_REPRISE sur le décorateur @Processor', (_nom, classeProcesseur) => {
    const options = Reflect.getMetadata(CLE_METADATA_WORKER_BULLMQ, classeProcesseur) as
      typeof OPTIONS_WORKER_REPRISE | undefined;

    expect(options).toBeDefined();
    expect(options).toEqual(OPTIONS_WORKER_REPRISE);
  });

  it('lockDuration est largement supérieur au budget de cession de l’event loop (filet cohérent avec le correctif)', () => {
    // Le VRAI correctif (cession régulière, voir `common/concurrence/`) borne le travail
    // synchrone d'affilée à ~20ms. Le filet BullMQ doit rester des ordres de grandeur au-dessus,
    // sans quoi il redeviendrait le facteur limitant plutôt qu'une marge de sécurité.
    expect(OPTIONS_WORKER_REPRISE.lockDuration).toBeGreaterThanOrEqual(60_000);
  });

  it('concurrency vaut 1 — un seul job de reprise à la fois par worker (goulot disque/sous-processus, pas la concurrence)', () => {
    expect(OPTIONS_WORKER_REPRISE.concurrency).toBe(1);
  });
});
