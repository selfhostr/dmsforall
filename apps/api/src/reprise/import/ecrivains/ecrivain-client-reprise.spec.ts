import { describe, expect, it, vi } from 'vitest';

import type { TransactionDfa } from '../../../db';
import type { CedeurEventLoop } from '../../../common/concurrence';
import type { LigneTable } from '../../lecteurs/types';
import { ecrireClientsReprise } from './ecrivain-client-reprise';

/**
 * Preuve de la cession de l'event loop (défaut réel du 26.08.2026, § `ceder-controle-event-loop.
 * ts` : boucle CPU dépendante du volume source affamant le renouvellement du verrou BullMQ). Même
 * doctrine que `common/concurrence/ceder-controle-event-loop.spec.ts` : la cession elle-même
 * (mécanisme `setImmediate`) est déjà prouvée là-bas ; ici on prouve seulement le CÂBLAGE — que la
 * boucle CPU (construction des candidats) appelle bien `cederSiNecessaire()` à CHAQUE ligne source,
 * indépendamment du volume et du résultat (insertion, rejet, doublon), et que la boucle
 * d'ÉCRITURE (I/O socket réelle via `tx.execute`) n'en reçoit AUCUNE — un `setImmediate`
 * redondant là n'y apporterait rien, seulement une durée de transaction inutilement allongée.
 */

function txFactice(): TransactionDfa {
  let compteur = 0;
  return {
    execute: vi.fn(() => Promise.resolve({ rows: [{ id: `client-${compteur++}` }] })),
  } as unknown as TransactionDfa;
}

function cedeurEspion(): { cedeur: CedeurEventLoop; appels: () => number } {
  const cederSiNecessaire = vi.fn(async () => undefined);
  return { cedeur: { cederSiNecessaire }, appels: () => cederSiNecessaire.mock.calls.length };
}

function ligne(index: number, valeurs: Record<string, string>): LigneTable {
  return { index, valeurs };
}

describe('ecrireClientsReprise — cession de l’event loop (boucle CPU dépendante du volume source)', () => {
  it('cède une fois par ligne source, plus une fois après la déduplication de lot', async () => {
    const lignes: LigneTable[] = Array.from({ length: 12 }, (_, i) =>
      ligne(i, { id: String(i), nom: `Client ${i}` }),
    );
    const { cedeur, appels } = cedeurEspion();

    const resultat = await ecrireClientsReprise(txFactice(), 'tenant-1', lignes, 'fr', cedeur);

    expect(resultat.insere).toBe(12);
    // 12 cessions (une par ligne, boucle de construction des candidats) + 1 (juste après
    // `dedupliquerLot`, avant la boucle d'écriture) — jamais moins, jamais plus : la boucle
    // d'écriture (`tx.execute` par candidat retenu) ne doit recevoir AUCUNE cession supplémentaire.
    expect(appels()).toBe(lignes.length + 1);
  });

  it('cède même si TOUTES les lignes sont rejetées avant tout accès base (identifiant source absent) — la cession ne dépend pas d’une écriture réussie', async () => {
    const lignes: LigneTable[] = Array.from({ length: 8 }, (_, i) => ligne(i, {}));
    const { cedeur, appels } = cedeurEspion();

    const resultat = await ecrireClientsReprise(txFactice(), 'tenant-1', lignes, 'fr', cedeur);

    expect(resultat.insere).toBe(0);
    expect(resultat.anomalies).toHaveLength(8);
    expect(appels()).toBe(lignes.length + 1);
  });

  it('lot vide -> une seule cession (celle qui suit la déduplication, jamais zéro)', async () => {
    const { cedeur, appels } = cedeurEspion();

    await ecrireClientsReprise(txFactice(), 'tenant-1', [], 'fr', cedeur);

    expect(appels()).toBe(1);
  });

  it('doublons dans le lot source -> toujours une cession par ligne lue, doublons compris', async () => {
    const lignes: LigneTable[] = [
      ligne(0, { id: 'C-1', nom: 'Premier' }),
      ligne(1, { id: 'C-1', nom: 'Doublon' }),
      ligne(2, { id: 'C-2', nom: 'Autre' }),
    ];
    const { cedeur, appels } = cedeurEspion();

    const resultat = await ecrireClientsReprise(txFactice(), 'tenant-1', lignes, 'fr', cedeur);

    expect(resultat.insere).toBe(2);
    expect(resultat.ecarte).toBe(1);
    expect(appels()).toBe(lignes.length + 1);
  });
});
