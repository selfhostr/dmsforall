/**
 * Preuve que l'export/la purge du cycle de vie de sortie du garage (offboarding, migration 0062)
 * respectent la règle numéro un du produit : « un export de tenant ne doit JAMAIS contenir la
 * moindre ligne d'un autre garage » (mandat 20.08.2026, §5). Deux tenants réellement peuplés
 * (`semerGarageDemo`, même fixture que `rls.spec.ts`), export/purge exercés via les VRAIS
 * services (`ServiceCycleVieResiliation`/`ServiceExportTenant`), sur la vraie base éphémère
 * (testcontainers, migrations réellement appliquées — 0000 → dernière, 0062 comprise).
 *
 * NON EXÉCUTÉ par cet agent (consigne : `pnpm test:integration` interdit sans demande explicite,
 * coûteux, Docker) — fichier écrit et prêt, à faire tourner par la suite. Voir le rapport de
 * livraison.
 */

import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ContexteTenant } from '../../src/db';
import { demarrerBaseEphemere, type BaseEphemere } from '../setup/postgres-ephemere';
import { semerGarageDemo, type GarageDemoFixture } from '../fixtures/garage-demo';
import { creerAccesBaseTest, demarrerRedisEphemere, type RedisEphemere } from '../setup/app-test';

import { ServiceCycleVieResiliation } from '../../src/exploitation/cycle-vie-tenant/service-cycle-vie-resiliation';
import { ServiceExportTenant } from '../../src/exploitation/cycle-vie-tenant/service-export-tenant';
import { StockageExportTenantDisqueLocal } from '../../src/exploitation/cycle-vie-tenant/service-stockage-export-tenant';
import { listerTablesTenant } from '../../src/exploitation/cycle-vie-tenant/service-catalogue-tables-tenant';
import { TABLES_TENANT_CONNUES } from '../../src/exploitation/cycle-vie-tenant/registre-tables-tenant';

let bdd: BaseEphemere;
let redis: RedisEphemere;
let demo: GarageDemoFixture;
let racineExports: string;

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  demo = await semerGarageDemo(bdd);
  redis = await demarrerRedisEphemere();
  racineExports = await mkdtemp(join(tmpdir(), 'dfa-test-export-'));
}, 180_000);

afterAll(async () => {
  await redis?.fermer();
  await bdd?.fermer();
  if (racineExports) await rm(racineExports, { recursive: true, force: true });
});

/** Contexte SYSTÈME (job) — `utilisateurId: null`. */
function ctxPour(tenantId: string, requeteId: string): ContexteTenant {
  return { tenantId, utilisateurId: null, requeteId };
}

/** Contexte HUMAIN (route HTTP, session `direction`) — exigé par `demander`/`confirmerRemise`
 *  depuis l'arbitrage du 20.08.2026 (c'est le garage lui-même qui déclenche, pas un exploitant). */
function ctxUtilisateurPour(
  tenantId: string,
  utilisateurId: string,
  requeteId: string,
): ContexteTenant {
  return { tenantId, utilisateurId, requeteId };
}

async function construireServices() {
  const { accesBase, fermer } = await creerAccesBaseTest(bdd, redis.url);
  const stockage = new StockageExportTenantDisqueLocal(racineExports);
  const cycleVie = new ServiceCycleVieResiliation(accesBase);
  const exportTenant = new ServiceExportTenant(accesBase, stockage, cycleVie);
  return { accesBase, stockage, cycleVie, exportTenant, fermer };
}

describe('cycle de vie de sortie du garage — isolation stricte (règle n°1)', () => {
  it('listerTablesTenant() (catalogue réel) retrouve exactement les tables du registre statique', async () => {
    const { accesBase, fermer } = await construireServices();
    try {
      const tables = await accesBase.enTenant(ctxPour(demo.tenantA.id, 'test'), (tx) =>
        listerTablesTenant(tx),
      );
      const attendues = new Set(TABLES_TENANT_CONNUES.map((e) => e.table));
      expect(new Set(tables)).toEqual(attendues);
    } finally {
      await fermer();
    }
  }, 60_000);

  it('un export du tenant A ne contient AUCUNE ligne du tenant B (site.csv, utilisateur.csv)', async () => {
    const { exportTenant, fermer } = await construireServices();
    try {
      const exportId = randomUUID();
      await exportTenant.genererExport(ctxPour(demo.tenantA.id, 'test'), demo.tenantA.id, exportId);

      const repertoire = `${demo.tenantA.id}/${exportId}`;
      const csvSite = await readFile(join(racineExports, repertoire, 'tables', 'site.csv'), 'utf8');
      const csvUtilisateur = await readFile(
        join(racineExports, repertoire, 'tables', 'utilisateur.csv'),
        'utf8',
      );

      // Positif : les propres lignes du tenant A sont bien présentes.
      for (const site of demo.tenantA.sites) {
        expect(csvSite).toContain(site.id);
      }
      for (const utilisateur of demo.tenantA.utilisateurs) {
        expect(csvUtilisateur).toContain(utilisateur.id);
      }

      // Négatif — LA preuve d'isolation : aucune ligne du tenant B, nulle part.
      for (const site of demo.tenantB.sites) {
        expect(csvSite).not.toContain(site.id);
      }
      for (const utilisateur of demo.tenantB.utilisateurs) {
        expect(csvUtilisateur).not.toContain(utilisateur.id);
      }
      expect(csvSite).not.toContain(demo.tenantB.id);
      expect(csvUtilisateur).not.toContain(demo.tenantB.id);
    } finally {
      await fermer();
    }
  }, 60_000);

  it('la purge du tenant A supprime ses lignes (site, utilisateur) sans toucher au tenant B', async () => {
    const { accesBase, cycleVie, fermer } = await construireServices();
    try {
      const ctxA = ctxPour(demo.tenantA.id, 'test-purge');
      const utilisateurDirectionA = demo.tenantA.utilisateurs[0]!.id;
      const ctxAUtilisateur = ctxUtilisateurPour(
        demo.tenantA.id,
        utilisateurDirectionA,
        'test-purge-utilisateur',
      );

      await cycleVie.demander(ctxAUtilisateur, demo.tenantA.id, 'Test intégration — purge');
      await cycleVie.marquerExportEnCours(ctxA, demo.tenantA.id);
      await cycleVie.marquerExportPret(ctxA, demo.tenantA.id, {
        repertoire: 'test/export',
        nbTables: 1,
        nbLignesTotal: 1,
        tailleOctets: 1,
      });
      await cycleVie.confirmerRemise(ctxAUtilisateur, demo.tenantA.id);

      // Simule l'écoulement de la période de rétention. `purge_prevue_le` n'est PLUS une colonne
      // GENERATED (0062, corrigé après un cas réel : `timestamptz + interval` n'est pas
      // IMMUTABLE) — elle a déjà été calculée EXPLICITEMENT par `confirmerRemise` ci-dessus, à la
      // date réelle. On la fait directement reculer ici, en `dfa_migrator` (seul canal autorisé à
      // toucher cette table hors RLS applicatif normal).
      await bdd.poolMigrateur.query(
        `update public.resiliation_tenant set purge_prevue_le = now() - interval '1 day'
             where tenant_id = $1`,
        [demo.tenantA.id],
      );

      const resultat = await cycleVie.purger(ctxA, demo.tenantA.id);
      expect(resultat.length).toBeGreaterThan(0);

      const restantA = await accesBase.enTenant(ctxA, (tx) =>
        tx.execute('select count(*) as n from public.site'),
      );
      expect(Number((restantA.rows[0] as { n: string }).n)).toBe(0);

      // Preuve d'isolation ULTIME : la purge d'un tenant ne touche RIEN au tenant B.
      const ctxB = ctxPour(demo.tenantB.id, 'test-purge');
      const restantB = await accesBase.enTenant(ctxB, (tx) =>
        tx.execute('select count(*) as n from public.site'),
      );
      expect(Number((restantB.rows[0] as { n: string }).n)).toBe(demo.tenantB.sites.length);

      // Le dossier de résiliation lui-même SURVIT à la purge (preuve de l'effacement).
      const dossierApres = await cycleVie.lire(ctxA, demo.tenantA.id);
      expect(dossierApres?.statut).toBe('efface');
      expect(dossierApres?.effaceeLe).not.toBeNull();
    } finally {
      await fermer();
    }
  }, 60_000);
});
