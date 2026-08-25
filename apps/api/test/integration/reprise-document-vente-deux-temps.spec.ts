/**
 * Preuve, sur une vraie base Postgres éphémère, que le protocole en DEUX TEMPS de
 * `ecrireDocumentVenteReprise` (`apps/api/src/reprise/import/ecrivains/ecrivain-document-vente-reprise.ts`)
 * tient contre les triggers RÉELS de `document_vente` (migration 0010) :
 *
 *   1. l'écriture directe au statut `emis` est mécaniquement impossible (le writer ne le tente
 *      jamais — étape 1 crée TOUJOURS un brouillon, `document_vente_creation_brouillon`,
 *      SQLSTATE ZDFA1, la couvre) ;
 *   2. la transition `brouillon -> emis` de l'étape 2 est acceptée par
 *      `transition_document_autorisee`/`verifier_transition_document` pour `type_document =
 *      'facture'` ;
 *   3. le document ressort verrouillé : `numero`/`exercice`/`emis_le` posés, `statut = 'emis'`,
 *      exactement le comportement attendu de `document_vente_verrouiller_apres_emission` ;
 *   4. le CHECK `document_vente_taux_tva_doc_reprise_chk` (0010) accepte `taux_tva_pourmille`
 *      NULL avec `tva_non_ventilee = true` et `origine = 'reprise'` (le régime que ce writer
 *      utilise TOUJOURS, périmètre D-30 entêtes/totaux) ;
 *   5. le rejeu (même `numeroOrigine`, même tenant) est idempotent : `cree: false`, AUCUNE
 *      deuxième ligne, l'index unique partiel `document_vente_numero_origine_uk`
 *      (tenant_id, type_document, numero_origine) absorbe le doublon via `on conflict do nothing`.
 *
 * Un test qui mocke `tx.execute` ne prouve rien de tout ça (CONTRIBUTING.md) — c'était précisément
 * l'état signalé par l'agent précédent en tête de `ecrivain-document-vente-reprise.ts`
 * (« NON VÉRIFIÉ EN BASE RÉELLE »). Ce fichier comble ce trou.
 */

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ContexteTenant } from '../../src/db';
import {
  demarrerBaseEphemere,
  ecrireSousTenant,
  type BaseEphemere,
} from '../setup/postgres-ephemere';
import { creerAccesBaseTest } from '../setup/app-test';
import { semerGarageDemo, type GarageDemoFixture } from '../fixtures/garage-demo';
import {
  ecrireDocumentVenteReprise,
  type EntreeDocumentVenteReprise,
} from '../../src/reprise/import/ecrivains/ecrivain-document-vente-reprise';

let bdd: BaseEphemere;
let demo: GarageDemoFixture;

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  demo = await semerGarageDemo(bdd);
}, 180_000);

afterAll(async () => {
  await bdd?.fermer();
});

async function creerClientDeTest(tenantId: string): Promise<string> {
  const id = randomUUID();
  await ecrireSousTenant(bdd.poolApp, tenantId, (client) =>
    client.query(
      `insert into public.client (id, tenant_id, numero, type, nom, langue)
       values ($1, $2, $3, 'particulier', 'Dupont', 'fr')`,
      [id, tenantId, `CL-${randomUUID().slice(0, 8)}`],
    ),
  );
  return id;
}

function entreeDeBase(
  tenantId: string,
  siteId: string,
  clientId: string,
  numeroOrigine: string,
): EntreeDocumentVenteReprise {
  return {
    tenantId,
    siteId,
    clientId,
    clientDesignationFigee: 'Dupont Jean',
    langueFigee: 'fr',
    numeroOrigine,
    dateDocument: '2019-06-15',
    totalTtcCentimes: 12_345,
    totalTvaCentimes: 823,
    tauxTvaPourmille: null,
  };
}

describe('ecrireDocumentVenteReprise — protocole en deux temps contre une vraie base Postgres', () => {
  it('crée un document EMIS et VERROUILLÉ (brouillon -> emis franchi via les triggers réels de 0010)', async () => {
    const { accesBase, fermer } = await creerAccesBaseTest(
      bdd,
      'redis://inutilise-dans-ce-test:6379',
    );
    try {
      const tenantId = demo.tenantA.id;
      const siteId = demo.tenantA.sites[0]!.id;
      const clientId = await creerClientDeTest(tenantId);
      const ctx: ContexteTenant = { tenantId, utilisateurId: null, requeteId: randomUUID() };

      const resultat = await accesBase.enTenant(ctx, (tx) =>
        ecrireDocumentVenteReprise(
          tx,
          entreeDeBase(tenantId, siteId, clientId, `SRC-${randomUUID()}`),
        ),
      );

      expect(resultat.cree).toBe(true);
      expect(resultat.id).not.toBeNull();

      const ligne = await accesBase.enTenant(ctx, async (tx) => {
        const r = await tx.execute<{
          readonly statut: string;
          readonly numero: string | null;
          readonly exercice: number | null;
          readonly emis_le: string | null;
          readonly total_ttc_centimes: string;
          readonly total_tva_centimes: string;
          readonly total_ht_centimes: string;
          readonly tva_non_ventilee: boolean;
          readonly taux_tva_pourmille: number | null;
        }>(sql`
          select statut, numero, exercice, emis_le, total_ttc_centimes, total_tva_centimes,
                 total_ht_centimes, tva_non_ventilee, taux_tva_pourmille
            from public.document_vente
           where tenant_id = ${tenantId} and id = ${resultat.id}
        `);
        return r.rows[0]!;
      });

      // EXACT, jamais toBeCloseTo (CONTRIBUTING.md, arithmétique financière) : le montant TTC exact
      // reste 12'345 centimes, et HT = TTC - TVA = 12'345 - 823 = 11'522, EXACTEMENT.
      expect(ligne.statut).toBe('emis');
      expect(ligne.numero).not.toBeNull();
      expect(ligne.exercice).toBe(2019);
      expect(ligne.emis_le).not.toBeNull();
      expect(Number(ligne.total_ttc_centimes)).toBe(12_345);
      expect(Number(ligne.total_tva_centimes)).toBe(823);
      expect(Number(ligne.total_ht_centimes)).toBe(11_522);
      expect(ligne.tva_non_ventilee).toBe(true);
      expect(ligne.taux_tva_pourmille).toBeNull();
    } finally {
      await fermer();
    }
  });

  it('rejeu du MÊME numeroOrigine : idempotent, aucune deuxième ligne créée', async () => {
    const { accesBase, fermer } = await creerAccesBaseTest(
      bdd,
      'redis://inutilise-dans-ce-test:6379',
    );
    try {
      const tenantId = demo.tenantA.id;
      const siteId = demo.tenantA.sites[0]!.id;
      const clientId = await creerClientDeTest(tenantId);
      const numeroOrigine = `SRC-${randomUUID()}`;
      const ctx: ContexteTenant = { tenantId, utilisateurId: null, requeteId: randomUUID() };

      const premier = await accesBase.enTenant(ctx, (tx) =>
        ecrireDocumentVenteReprise(tx, entreeDeBase(tenantId, siteId, clientId, numeroOrigine)),
      );
      expect(premier.cree).toBe(true);

      const second = await accesBase.enTenant(ctx, (tx) =>
        ecrireDocumentVenteReprise(tx, entreeDeBase(tenantId, siteId, clientId, numeroOrigine)),
      );
      expect(second.cree).toBe(false);
      expect(second.id).toBeNull();

      const compte = await accesBase.enTenant(ctx, async (tx) => {
        const r = await tx.execute<{ readonly total: string }>(sql`
          select count(*)::text as total from public.document_vente
           where tenant_id = ${tenantId} and numero_origine = ${numeroOrigine}
        `);
        return r.rows[0]!.total;
      });
      expect(Number(compte)).toBe(1);
    } finally {
      await fermer();
    }
  });
});
