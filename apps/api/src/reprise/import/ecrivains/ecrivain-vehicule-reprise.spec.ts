import { describe, expect, it, vi } from 'vitest';

import type { TransactionDfa } from '../../../db';
import type { CedeurEventLoop } from '../../../common/concurrence';
import type { LigneTable } from '../../lecteurs/types';
import { ecrireVehiculesReprise } from './ecrivain-vehicule-reprise';

/**
 * Même doctrine que `ecrivain-client-reprise.spec.ts` : la cession elle-même est déjà prouvée par
 * `common/concurrence/ceder-controle-event-loop.spec.ts` — ici on prouve le CÂBLAGE. Trois points
 * de cession CONSTANTS (indépendants du volume) s'ajoutent à la cession PAR LIGNE de la boucle de
 * construction des candidats : après `dedupliquerLot`, et après CHACUN des deux appels à
 * `reconstituerIntervallesSansChevauchement` (fonction pure, un seul passage synchrone, aucun
 * point de cession possible en son sein sans la transformer). Le nombre d'intervalles reconstruits
 * n'ajoute PAS de cession supplémentaire — une seule cession absorbe tout le CPU de l'appel, quel
 * que soit le nombre de plaques/détentions en sortie.
 */

function txFactice(): TransactionDfa {
  let compteur = 0;
  return {
    execute: vi.fn(() => Promise.resolve({ rows: [{ id: `vehicule-${compteur++}` }] })),
  } as unknown as TransactionDfa;
}

function cedeurEspion(): { cedeur: CedeurEventLoop; appels: () => number } {
  const cederSiNecessaire = vi.fn(async () => undefined);
  return { cedeur: { cederSiNecessaire }, appels: () => cederSiNecessaire.mock.calls.length };
}

function ligne(index: number, valeurs: Record<string, string>): LigneTable {
  return { index, valeurs };
}

const CESSIONS_CONSTANTES = 3; // dedup + reconstruction plaques + reconstruction détentions

describe('ecrireVehiculesReprise — cession de l’event loop (boucle CPU + reconstruction d’intervalles)', () => {
  it('cède une fois par ligne source, plus 3 cessions constantes (dedup + 2 reconstructions), sans plaque/détention', async () => {
    const lignes: LigneTable[] = Array.from({ length: 10 }, (_, i) =>
      ligne(i, { id: String(i), marque: 'VW', modele: 'Golf' }),
    );
    const { cedeur, appels } = cedeurEspion();

    const resultat = await ecrireVehiculesReprise(
      txFactice(),
      'tenant-1',
      lignes,
      new Map(),
      cedeur,
    );

    expect(resultat.insere).toBe(10);
    expect(appels()).toBe(lignes.length + CESSIONS_CONSTANTES);
  });

  it('cède même si TOUTES les lignes sont rejetées (marque/modèle absents) — la cession ne dépend pas d’une écriture réussie', async () => {
    const lignes: LigneTable[] = Array.from({ length: 6 }, (_, i) => ligne(i, { id: String(i) }));
    const { cedeur, appels } = cedeurEspion();

    const resultat = await ecrireVehiculesReprise(
      txFactice(),
      'tenant-1',
      lignes,
      new Map(),
      cedeur,
    );

    expect(resultat.insere).toBe(0);
    expect(appels()).toBe(lignes.length + CESSIONS_CONSTANTES);
  });

  it('lot vide -> exactement 3 cessions (les constantes, jamais zéro)', async () => {
    const { cedeur, appels } = cedeurEspion();

    await ecrireVehiculesReprise(txFactice(), 'tenant-1', [], new Map(), cedeur);

    expect(appels()).toBe(CESSIONS_CONSTANTES);
  });

  it('reconstruction de plaques/détentions présentes -> aucune cession supplémentaire par intervalle produit (une seule absorbe tout l’appel)', async () => {
    const clientIdParNumeroOrigine = new Map([['CLI-1', 'client-uuid-1']]);
    const lignes: LigneTable[] = [
      ligne(0, {
        id: 'V-1',
        marque: 'VW',
        modele: 'Golf',
        plaque: 'VD 123456',
        plaque_du: '2020-01-01',
        client_id: 'CLI-1',
      }),
      ligne(1, {
        id: 'V-2',
        marque: 'Audi',
        modele: 'A3',
        plaque: 'VD 654321',
        plaque_du: '2021-06-15',
        client_id: 'CLI-1',
      }),
    ];
    const { cedeur, appels } = cedeurEspion();

    const resultat = await ecrireVehiculesReprise(
      txFactice(),
      'tenant-1',
      lignes,
      clientIdParNumeroOrigine,
      cedeur,
    );

    expect(resultat.insere).toBe(2);
    // Toujours lignes.length + 3, PAS lignes.length + 3 + (nombre d'intervalles reconstruits) :
    // la reconstruction (tri + fusion) est un seul appel synchrone, une seule cession l'absorbe.
    expect(appels()).toBe(lignes.length + CESSIONS_CONSTANTES);
  });
});

/**
 * Défaut réel du 26.08.2026 (archive Auto-i, table "Lager") : la casse était déjà
 * corrigée (alias insensibles à la casse), mais AUCUN alias générique ne couvrait les noms de
 * colonnes RÉELS de cette source — toutes les lignes détectées, aucune écrite, 100% `reference_manquante`.
 * Schéma vérifié via `mdb-schema` (métadonnées de colonnes, jamais de donnée personnelle) :
 * `LagerNr`/`ReferenzNr`/`FzKey` pour l'identifiant propre, `ChassisNr` pour le VIN, `KundenNr`
 * pour le rattachement client — aucun ne matchait les alias d'avant ce correctif.
 */
describe('ecrireVehiculesReprise — alias de colonnes Auto-i réels (défaut du 26.08.2026)', () => {
  it('résout `LagerNr` comme identifiant propre (aucun alias générique ne le couvrait)', async () => {
    const lignes: LigneTable[] = [ligne(0, { LagerNr: 'L-001', Marke: 'VW', Modell: 'Golf' })];
    const resultat = await ecrireVehiculesReprise(
      txFactice(),
      'tenant-1',
      lignes,
      new Map(),
      cedeurEspion().cedeur,
    );
    expect(resultat.insere).toBe(1);
    expect(resultat.anomalies).toEqual([]);
  });

  it('résout `ReferenzNr` et `FzKey` comme repli, dans cet ordre après `LagerNr`', async () => {
    const lignes: LigneTable[] = [
      ligne(0, { ReferenzNr: 'REF-1', Marke: 'VW', Modell: 'Polo' }),
      ligne(1, { FzKey: 'FZ-2', Marke: 'Audi', Modell: 'A3' }),
    ];
    const resultat = await ecrireVehiculesReprise(
      txFactice(),
      'tenant-1',
      lignes,
      new Map(),
      cedeurEspion().cedeur,
    );
    expect(resultat.insere).toBe(2);
    expect(resultat.anomalies).toEqual([]);
  });

  it('résout `ChassisNr` comme VIN (`chassis` seul ne matchait pas `chassisnr` normalisé)', async () => {
    const vin = '1M8GDM9AXKP042788'; // 17 caractères, alphabet VIN valide
    const lignes: LigneTable[] = [
      ligne(0, { LagerNr: 'L-001', Marke: 'VW', Modell: 'Golf', ChassisNr: vin }),
    ];
    const resultat = await ecrireVehiculesReprise(
      txFactice(),
      'tenant-1',
      lignes,
      new Map(),
      cedeurEspion().cedeur,
    );
    expect(resultat.insere).toBe(1);
    expect(resultat.anomalies).toEqual([]);
  });

  it('résout `KundenNr` comme référence client (rattachement du véhicule à sa fiche déjà écrite)', async () => {
    const lignes: LigneTable[] = [
      ligne(0, {
        LagerNr: 'L-001',
        Marke: 'VW',
        Modell: 'Golf',
        KundenNr: 'K-1',
        Kontrollschild: 'VD 123456',
        plaque_du: '2021-06-15',
      }),
    ];
    const clientIdParNumeroOrigine = new Map([['K-1', 'client-existant']]);
    const resultat = await ecrireVehiculesReprise(
      txFactice(),
      'tenant-1',
      lignes,
      clientIdParNumeroOrigine,
      cedeurEspion().cedeur,
    );
    expect(resultat.insere).toBe(1);
    // Aucune anomalie `reference_manquante` "client référencé introuvable" : le rattachement a
    // réussi grâce à l'alias `kundennr`.
    expect(resultat.anomalies).toEqual([]);
  });

  it('résout `ErstIV` (jj.mm.aaaa) comme date de plaque — sans lui, AUCUN véhicule ne pouvait jamais être rattaché (défaut réel du 26.08.2026)', async () => {
    const lignes: LigneTable[] = [
      ligne(0, {
        LagerNr: 'L-001',
        Marke: 'VW',
        Modell: 'Golf',
        KundenNr: 'K-1',
        Kontrollschild: 'VD 123456',
        ErstIV: '15.03.2019',
      }),
    ];
    const clientIdParNumeroOrigine = new Map([['K-1', 'client-existant']]);
    const resultat = await ecrireVehiculesReprise(
      txFactice(),
      'tenant-1',
      lignes,
      clientIdParNumeroOrigine,
      cedeurEspion().cedeur,
    );
    expect(resultat.insere).toBe(1);
    expect(resultat.anomalies).toEqual([]);
  });
});
