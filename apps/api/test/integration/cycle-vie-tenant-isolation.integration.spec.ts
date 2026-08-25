/**
 * Preuve que l'export/la purge du cycle de vie de sortie du garage (offboarding, migration 0062)
 * respectent la règle numéro un du produit : « un export de tenant ne doit JAMAIS contenir la
 * moindre ligne d'un autre garage » (mandat 20.08.2026, §5). Deux tenants réellement peuplés
 * (`semerGarageDemo`, même fixture que `rls.spec.ts`), export/purge exercés via les VRAIS
 * services (`ServiceCycleVieResiliation`/`ServiceExportTenant`), sur la vraie base éphémère
 * (testcontainers, migrations réellement appliquées — 0000 → dernière, 0062 comprise).
 *
 * EXÉCUTÉ EN CI (forge) le 21.08.2026 — a trouvé un vrai défaut au premier passage : une FK
 * `on delete restrict` de `resiliation_tenant` vers `public.utilisateur` bloquait
 * `purger_donnees_tenant()` en PERMANENCE (elle ne pouvait jamais supprimer la ligne `utilisateur`
 * référencée, puisque `resiliation_tenant` survit toujours à la purge) — corrigé dans
 * `db/migrations/0062_cycle_vie_resiliation_tenant.sql` (colonnes `..._utilisateur_id` sans FK,
 * voir le commentaire à leur définition). Ce fichier a lui-même été corrigé sur deux points qui
 * n'avaient rien à voir avec ce défaut : le test d'exhaustivité comparait `listerTablesTenant()`
 * en mode PURGE (qui exclut `resiliation_tenant`/`_evenement`, §B de 0062) au registre complet
 * (qui les inclut depuis leur ajout aux fichiers Drizzle), et le test d'export appelait
 * `genererExport` sans avoir d'abord créé le dossier de résiliation via `cycleVie.demander(...)`.
 */

import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { ContexteTenant } from '../../src/db';
import { demarrerBaseEphemere, type BaseEphemere } from '../setup/postgres-ephemere';
import { semerGarageDemo, type GarageDemoFixture } from '../fixtures/garage-demo';
import { creerAccesBaseTest, demarrerRedisEphemere, type RedisEphemere } from '../setup/app-test';

import { ServiceCycleVieResiliation } from '../../src/exploitation/cycle-vie-tenant/service-cycle-vie-resiliation';
import { ServiceExportTenant } from '../../src/exploitation/cycle-vie-tenant/service-export-tenant';
import { StockageExportTenantDisqueLocal } from '../../src/exploitation/cycle-vie-tenant/service-stockage-export-tenant';
import { StockageArchiveRepriseDisqueLocal } from '../../src/reprise/depot/stockage-archive-reprise';
import {
  StockagePdfDisqueLocal,
  cleePdfDocument,
} from '../../src/facturation/impression/stockage-pdf';
import {
  listerTablesTenant,
  TABLES_CYCLE_VIE_TENANT,
} from '../../src/exploitation/cycle-vie-tenant/service-catalogue-tables-tenant';
import {
  TABLES_TENANT_CONNUES,
  TABLES_TENANT_SANS_DRIZZLE,
} from '../../src/exploitation/cycle-vie-tenant/registre-tables-tenant';

let bdd: BaseEphemere;
let redis: RedisEphemere;
let demo: GarageDemoFixture;
let racineExports: string;
let racineReprise: string;
let racinePdf: string;

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  demo = await semerGarageDemo(bdd);
  redis = await demarrerRedisEphemere();
  racineExports = await mkdtemp(join(tmpdir(), 'dfa-test-export-'));
  racineReprise = await mkdtemp(join(tmpdir(), 'dfa-test-reprise-'));
  racinePdf = await mkdtemp(join(tmpdir(), 'dfa-test-pdf-'));
}, 180_000);

afterAll(async () => {
  await redis?.fermer();
  await bdd?.fermer();
  if (racineExports) await rm(racineExports, { recursive: true, force: true });
  if (racineReprise) await rm(racineReprise, { recursive: true, force: true });
  if (racinePdf) await rm(racinePdf, { recursive: true, force: true });
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
  const stockageReprise = new StockageArchiveRepriseDisqueLocal(racineReprise);
  const stockagePdf = new StockagePdfDisqueLocal(racinePdf);
  const cycleVie = new ServiceCycleVieResiliation(
    accesBase,
    stockageReprise,
    stockagePdf,
    stockage,
  );
  const exportTenant = new ServiceExportTenant(accesBase, stockage, cycleVie);
  return { accesBase, stockage, stockageReprise, stockagePdf, cycleVie, exportTenant, fermer };
}

/**
 * Tenant jetable, SITE + UTILISATEUR compris — `resiliation_tenant_tenant_uk` (0062) autorise AU
 * PLUS UN dossier de résiliation par tenant, POUR TOUJOURS : réutiliser `demo.tenantA` à la fois
 * pour le test d'export ET le test de purge (chacun ouvrant son propre dossier via
 * `cycleVie.demander`) collisionnerait sur cette contrainte. Même patron d'insertion que
 * `fixtures/garage-demo.ts::semerTenant` (`poolSuperutilisateur` — `tenant`/`site` sont FORCE ROW
 * LEVEL SECURITY, même le propriétaire ne peut pas y écrire sans contourner le RLS).
 */
async function semerTenantJetable(prefixe: string): Promise<{
  readonly tenantId: string;
  readonly siteId: string;
  readonly utilisateurDirectionId: string;
}> {
  const tenantId = randomUUID();
  const siteId = randomUUID();
  const utilisateurId = randomUUID();
  const suffixe = randomUUID().slice(0, 8);

  await bdd.poolSuperutilisateur.query(
    `insert into tenant (id, slug, raison_sociale, numero_tva, pays, langue_defaut, statut)
     values ($1, $2, $3, null, 'CH', 'fr', 'actif')`,
    [tenantId, `${prefixe}-${suffixe}`, `Garage jetable ${suffixe} SA`],
  );
  await bdd.poolSuperutilisateur.query(
    `insert into site (id, tenant_id, code, nom, rue, npa, localite, pays, actif)
     values ($1, $2, 'S1', 'Site unique', null, null, null, 'CH', true)`,
    [siteId, tenantId],
  );
  await bdd.poolSuperutilisateur.query(
    `insert into utilisateur
       (id, tenant_id, email, mot_de_passe_hash, prenom, nom, langue, role, statut, echecs_connexion, verrouille_jusqu_a)
     values ($1, $2, $3, 'placeholder-hash-non-utilise-en-test', 'Test', 'Direction', 'fr', 'direction', 'actif', 0, null)`,
    [utilisateurId, tenantId, `direction-${suffixe}@garage-jetable.test`],
  );

  return { tenantId, siteId, utilisateurDirectionId: utilisateurId };
}

describe('cycle de vie de sortie du garage — isolation stricte (règle n°1)', () => {
  it('listerTablesTenant() (catalogue réel) retrouve exactement les tables du registre statique', async () => {
    const { accesBase, fermer } = await construireServices();
    try {
      // Mode PURGE (défaut, sans `inclureCycleVie`) : exclut `resiliation_tenant`/
      // `resiliation_tenant_evenement` (§B de 0062 — elles doivent survivre à la purge), mais
      // trouve bien les tables SANS fichier Drizzle (`vehicule_ocr_scan_journal`,
      // `client_anonymisation`) puisque la découverte porte sur le catalogue Postgres réel, pas
      // sur le schéma Drizzle — voir `registre-tables-tenant.ts`.
      const tablesPurge = await accesBase.enTenant(ctxPour(demo.tenantA.id, 'test'), (tx) =>
        listerTablesTenant(tx),
      );
      const exclusCycleVie = new Set<string>(TABLES_CYCLE_VIE_TENANT);
      const attenduesPurge = new Set([
        ...TABLES_TENANT_CONNUES.map((e) => e.table).filter((t) => !exclusCycleVie.has(t)),
        ...TABLES_TENANT_SANS_DRIZZLE.map((e) => e.table),
      ]);
      expect(new Set(tablesPurge)).toEqual(attenduesPurge);

      // Mode EXPORT (`inclureCycleVie: true`) : le registre COMPLET, cycle-vie tenant compris.
      const tablesExport = await accesBase.enTenant(ctxPour(demo.tenantA.id, 'test'), (tx) =>
        listerTablesTenant(tx, { inclureCycleVie: true }),
      );
      const attenduesExport = new Set([
        ...TABLES_TENANT_CONNUES.map((e) => e.table),
        ...TABLES_TENANT_SANS_DRIZZLE.map((e) => e.table),
      ]);
      expect(new Set(tablesExport)).toEqual(attenduesExport);
    } finally {
      await fermer();
    }
  }, 60_000);

  it('un export du tenant sujet ne contient AUCUNE ligne du tenant B (site.csv, utilisateur.csv)', async () => {
    const { cycleVie, exportTenant, fermer } = await construireServices();
    try {
      // Tenant JETABLE, pas `demo.tenantA` : `resiliation_tenant_tenant_uk` (0062) autorise AU
      // PLUS UN dossier par tenant pour toujours — réutiliser `demo.tenantA` collisionnerait avec
      // le test de purge ci-dessous, qui ouvre lui aussi un dossier sur SON tenant. `demo.tenantB`
      // reste la cible de comparaison « jamais touchée », commune aux deux tests.
      const sujet = await semerTenantJetable('export-test');

      // `genererExport` exige un dossier de résiliation déjà ouvert (`marquerExportEnCours`
      // relit la ligne existante) — le créer d'abord, comme le fait réellement
      // `ServiceDemandeResiliationTenant.demander` avant d'enqueuer le job d'export.
      await cycleVie.demander(
        ctxUtilisateurPour(sujet.tenantId, sujet.utilisateurDirectionId, 'test-export'),
        sujet.tenantId,
        'Test intégration — export',
      );

      const exportId = randomUUID();
      await exportTenant.genererExport(ctxPour(sujet.tenantId, 'test'), sujet.tenantId, exportId);

      const repertoire = `${sujet.tenantId}/${exportId}`;
      const csvSite = await readFile(join(racineExports, repertoire, 'tables', 'site.csv'), 'utf8');
      const csvUtilisateur = await readFile(
        join(racineExports, repertoire, 'tables', 'utilisateur.csv'),
        'utf8',
      );

      // Positif : les propres lignes du tenant sujet sont bien présentes.
      expect(csvSite).toContain(sujet.siteId);
      expect(csvUtilisateur).toContain(sujet.utilisateurDirectionId);

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
    const { accesBase, cycleVie, stockageReprise, stockage, stockagePdf, fermer } =
      await construireServices();
    try {
      const ctxA = ctxPour(demo.tenantA.id, 'test-purge');
      const utilisateurDirectionA = demo.tenantA.utilisateurs[0]!.id;
      const ctxAUtilisateur = ctxUtilisateurPour(
        demo.tenantA.id,
        utilisateurDirectionA,
        'test-purge-utilisateur',
      );

      // CORRECTIF nLPD (mandat 24/25.08.2026) : dépôt d'une VRAIE archive de reprise sur disque
      // pour le tenant A (dossier_reprise + tranche réelle écrite via `PortStockageArchiveReprise`
      // — même adaptateur que la production, pas un mock), ET une archive pour le tenant B —
      // JAMAIS référencée par un dossier de résiliation, elle ne doit survivre QUE parce que la
      // purge du tenant A ne doit RIEN toucher hors de son propre répertoire. C'est la preuve
      // décisive (voir le rapport de livraison) : sans cette assertion, une purge qui se tromperait
      // de racine passerait inaperçue.
      const dossierRepriseIdA = randomUUID();
      const racineDossierA = stockageReprise.racineDossier(demo.tenantA.id, dossierRepriseIdA);
      await stockageReprise.ecrireTranche(racineDossierA, 0, Buffer.from('archive-tenant-a-test'));
      expect(await stockageReprise.trancheExiste(racineDossierA, 0)).toBe(true);

      const dossierRepriseIdB = randomUUID();
      const racineDossierB = stockageReprise.racineDossier(demo.tenantB.id, dossierRepriseIdB);
      await stockageReprise.ecrireTranche(racineDossierB, 0, Buffer.from('archive-tenant-b-test'));
      expect(await stockageReprise.trancheExiste(racineDossierB, 0)).toBe(true);

      // DEUXIÈME CORRECTIF nLPD (mandat 24/25.08.2026) : mêmes preuves, deux fuites de plus — un
      // VRAI PDF de facture et un VRAI export de résiliation, pour tenant A ET tenant B. Le
      // répertoire d'export du tenant A ci-dessous est délibérément DIFFÉRENT de celui écrit par
      // `marquerExportPret` plus bas (`test/export`, un placeholder qui ne préfixe même pas
      // `tenantId`) — une tentative « orpheline », jamais référencée par
      // `resiliation_tenant.export_repertoire` (voir la doc de `StockageExportTenant.purgerTenant`
      // : `exportId` régénéré à chaque déclenchement). Elle doit disparaître QUAND MÊME : la purge
      // vise le répertoire ENTIER du tenant, pas la seule colonne.
      const clePdfA = cleePdfDocument(demo.tenantA.id, randomUUID());
      await stockagePdf.ecrire(clePdfA, Buffer.from('%PDF facture tenant A'));
      const clePdfB = cleePdfDocument(demo.tenantB.id, randomUUID());
      await stockagePdf.ecrire(clePdfB, Buffer.from('%PDF facture tenant B'));

      await stockage.ecrire(
        `${demo.tenantA.id}/export-orphelin/tables/client.csv`,
        'export orphelin tenant A',
      );
      await stockage.ecrire(
        `${demo.tenantB.id}/export-1/tables/client.csv`,
        'export tenant B — ne doit jamais disparaître',
      );

      const empreinteA = createHash('sha256').update('archive-tenant-a-test').digest();
      await accesBase.enTenant(ctxAUtilisateur, (tx) =>
        tx.execute(sql`
          insert into public.dossier_reprise
            (id, tenant_id, statut, taille_octets_annoncee, empreinte_sha256_annoncee,
             stockage_chemin, cree_par_id)
          values
            (${dossierRepriseIdA}, ${demo.tenantA.id}, 'depot_en_cours', 21, ${empreinteA},
             ${racineDossierA}, ${utilisateurDirectionA})
        `),
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

      // La preuve du correctif : le fichier réel du tenant A a disparu du disque…
      expect(await stockageReprise.trancheExiste(racineDossierA, 0)).toBe(false);
      // … et LE PLUS IMPORTANT : le répertoire d'un AUTRE tenant, jamais visé par cette purge,
      // reste intact — aucune traversée, aucune purge à la racine.
      expect(await stockageReprise.trancheExiste(racineDossierB, 0)).toBe(true);

      // DEUXIÈME CORRECTIF nLPD : le PDF de facture du tenant A a disparu…
      await expect(stockagePdf.lire(clePdfA)).rejects.toThrow();
      // … celui du tenant B est INTACT, mêmes octets.
      expect((await stockagePdf.lire(clePdfB)).toString()).toBe('%PDF facture tenant B');

      // … l'export de résiliation du tenant A (y compris la tentative « orpheline ») a disparu…
      await expect(stockage.listerFichiers(`${demo.tenantA.id}/export-orphelin`)).resolves.toEqual(
        [],
      );
      // … celui du tenant B — jamais visé par la purge du tenant A — est INTACT.
      const fichiersExportB = await stockage.listerFichiers(`${demo.tenantB.id}/export-1`);
      expect(fichiersExportB.map((f) => f.chemin)).toEqual(['tables/client.csv']);

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
