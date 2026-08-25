/**
 * Preuve, sur une vraie base Postgres éphémère, que les ancrages de reprise ajoutés par
 * migrations/0066_ancrages_origine_reprise.sql tiennent leur promesse sur les cinq tables
 * concernées (`client`, `vehicule`, `article`, `fournisseur`, `paiement`) :
 *
 *   1. une reprise est REJOUABLE SANS DOUBLON : réimporter deux fois la même ligne source
 *      (même `numero_origine`) sous le MÊME tenant est refusé par l'index unique partiel ;
 *   2. l'isolation tenant (règle n°1 du projet) tient : deux tenants distincts peuvent porter
 *      le même `numero_origine` sans le moindre conflit — la contrainte est bien
 *      `(tenant_id, numero_origine)`, jamais `numero_origine` seul ;
 *   3. une ligne créée normalement par DFA (`origine = 'dfa'`) accepte `numero_origine = null`.
 *
 * Ces trois propriétés ne peuvent être prouvées qu'en base réelle (CHECK + index unique partiel
 * Postgres, RLS actif) — un mock ne prouverait rien (CONTRIBUTING.md : « un test qui mocke la couche
 * réseau/tx.execute ne prouve rien sur la requête réelle »).
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  demarrerBaseEphemere,
  ecrireSousTenant,
  type BaseEphemere,
} from '../setup/postgres-ephemere';
import { semerGarageDemo, type GarageDemoFixture } from '../fixtures/garage-demo';

let bdd: BaseEphemere;
let demo: GarageDemoFixture;

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  demo = await semerGarageDemo(bdd);
}, 180_000);

afterAll(async () => {
  await bdd?.fermer();
});

/**
 * Une table cible et de quoi construire une ligne INSERTable valide (colonnes obligatoires
 * hors `id`/`tenant_id`/`origine`/`numero_origine`, qui sont fournies par le test). `site_id`
 * n'a de sens que pour `paiement` — les quatre autres tables n'en ont pas.
 */
interface CasTable {
  readonly table: string;
  colonnesEtValeurs(siteId: string): {
    readonly colonnes: readonly string[];
    readonly valeurs: readonly unknown[];
  };
}

const CAS: readonly CasTable[] = [
  {
    table: 'client',
    colonnesEtValeurs: () => ({
      colonnes: ['numero', 'type', 'nom', 'langue'],
      valeurs: [`CL-${randomUUID().slice(0, 8)}`, 'particulier', 'Dupont', 'fr'],
    }),
  },
  {
    table: 'vehicule',
    colonnesEtValeurs: () => ({
      colonnes: ['marque', 'modele'],
      valeurs: ['Renault', 'Clio'],
    }),
  },
  {
    table: 'article',
    colonnesEtValeurs: () => ({
      colonnes: ['designation', 'categorie', 'reference_principale', 'prix_vente_ttc_centimes'],
      valeurs: ['Plaquettes de frein', 'piece_mecanique', `REF-${randomUUID().slice(0, 8)}`, 4500],
    }),
  },
  {
    table: 'fournisseur',
    colonnesEtValeurs: () => ({
      colonnes: ['nom'],
      valeurs: ['Distributeur pièces SA'],
    }),
  },
  {
    table: 'paiement',
    colonnesEtValeurs: (siteId: string) => ({
      colonnes: ['site_id', 'date_valeur', 'moyen', 'montant_centimes', 'payeur_libelle'],
      valeurs: [siteId, '2026-08-24', 'especes', 10000, 'Dupont'],
    }),
  },
];

async function inserer(
  bdd: BaseEphemere,
  tenantId: string,
  cas: CasTable,
  siteId: string,
  origine: 'dfa' | 'reprise',
  numeroOrigine: string | null,
): Promise<void> {
  const { colonnes, valeurs } = cas.colonnesEtValeurs(siteId);
  const toutesColonnes = ['id', 'tenant_id', 'origine', 'numero_origine', ...colonnes];
  const placeholders = toutesColonnes.map((_, i) => `$${String(i + 1)}`).join(', ');
  await ecrireSousTenant(bdd.poolApp, tenantId, (client) =>
    client.query(
      `insert into public.${cas.table} (${toutesColonnes.join(', ')}) values (${placeholders})`,
      [randomUUID(), tenantId, origine, numeroOrigine, ...valeurs],
    ),
  );
}

describe.each(CAS)('ancrage de reprise — $table', (cas) => {
  it("origine = dfa (la valeur par défaut d'une ligne créée normalement) accepte numero_origine = null", async () => {
    const siteId = demo.tenantA.sites[0]!.id;
    await expect(inserer(bdd, demo.tenantA.id, cas, siteId, 'dfa', null)).resolves.not.toThrow();
  });

  it("rejoue la même ligne source (même numero_origine) sous le MÊME tenant : refusé (idempotence de l'import)", async () => {
    const siteId = demo.tenantA.sites[0]!.id;
    const numeroSource = `SRC-${randomUUID()}`;

    await inserer(bdd, demo.tenantA.id, cas, siteId, 'reprise', numeroSource);

    await expect(
      inserer(bdd, demo.tenantA.id, cas, siteId, 'reprise', numeroSource),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it('le même numero_origine sous DEUX TENANTS DISTINCTS ne provoque aucun conflit (isolation tenant, règle n°1)', async () => {
    const numeroSource = `SRC-${randomUUID()}`;
    const siteA = demo.tenantA.sites[0]!.id;
    const siteB = demo.tenantB.sites[0]!.id;

    await inserer(bdd, demo.tenantA.id, cas, siteA, 'reprise', numeroSource);

    await expect(
      inserer(bdd, demo.tenantB.id, cas, siteB, 'reprise', numeroSource),
    ).resolves.not.toThrow();
  });

  it('origine = reprise sans numero_origine (ou origine = dfa avec un numero_origine renseigné) viole le CHECK de cohérence', async () => {
    const siteId = demo.tenantA.sites[0]!.id;

    await expect(inserer(bdd, demo.tenantA.id, cas, siteId, 'reprise', null)).rejects.toThrow(
      /chk|check|constraint/i,
    );

    await expect(
      inserer(bdd, demo.tenantA.id, cas, siteId, 'dfa', `SRC-${randomUUID()}`),
    ).rejects.toThrow(/chk|check|constraint/i);
  });
});
