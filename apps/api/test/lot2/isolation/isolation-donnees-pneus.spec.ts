/**
 * Isolation tenant — DONNÉES RÉELLES de `depot_pneus` (hangar à pneus, migration 0043). MÊME
 * PATRON que `isolation-donnees-pieces.spec.ts` (à relire pour le raisonnement complet) : pool
 * `dfa_app` sous RLS, deux tenants distincts, preuve en LECTURE (une donnée de B est invisible
 * sous A, jamais une erreur) ET en ÉCRITURE (une impersonation — `tenant_id = B` posé sous le
 * contexte A, avec un véhicule et un site RÉELLEMENT valides pour B — est refusée par la clause
 * `WITH CHECK` de la politique RLS, pas seulement filtrée en lecture).
 *
 * C'est la « règle n°1 du projet » (CONTRIBUTING.md) appliquée à `depot_pneus` : un jeu de pneus engage
 * la garde physique du garage sur un bien du client (RPP-01) — le pire scénario d'étanchéité
 * concevable pour ce module serait qu'un garage voie, ou pire modifie, le hangar d'un AUTRE garage.
 *
 * Périmètre d'écriture : `apps/api/test/**` uniquement (voir CONTRIBUTING.md et le brief de cette
 * tâche). `apps/api/src/pneus/**` n'est ni lu comme source de vérité du comportement attendu ni
 * modifié ici : ce fichier vérifie directement contre le SCHÉMA (migration 0043 — RLS, grants),
 * indépendamment de tout bug applicatif en cours de correction ailleurs.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  demarrerBaseEphemere,
  requeteSousTenant,
  type BaseEphemere,
} from '../../setup/postgres-ephemere';
import { semerGarageDemoLot1, type GarageDemoLot1Fixture } from '../../lot1/fixtures/garage-demo-lot1';
import { creerDepotPneusPourTest, type DepotPneusDeTest } from '../fixtures/garage-demo-lot2';

let bdd: BaseEphemere;
let garage: GarageDemoLot1Fixture;
let depotA: DepotPneusDeTest;
let depotB: DepotPneusDeTest;

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  garage = await semerGarageDemoLot1(bdd);

  const tA = garage.tenantA;
  const tB = garage.tenantB;
  [depotA, depotB] = await Promise.all([
    creerDepotPneusPourTest(bdd, tA.tenant, tA.vehicules[0]!.id, tA.tenant.sites[0]!.id, {
      saison: 'ete',
      codeCase: 'A-01',
    }),
    creerDepotPneusPourTest(bdd, tB.tenant, tB.vehicules[0]!.id, tB.tenant.sites[0]!.id, {
      saison: 'ete',
      codeCase: 'B-01',
    }),
  ]);
}, 180_000);

afterAll(async () => {
  await bdd?.fermer();
});

describe("lecture — un dépôt de pneus du tenant B est invisible sous le contexte du tenant A (et réciproquement)", () => {
  it("select explicite par id du dépôt de B rend zéro ligne sous A ; la même lecture sous B (contrôle positif) trouve la ligne", async () => {
    const sousA = await requeteSousTenant(
      bdd.poolApp,
      garage.tenantA.tenant.id,
      'select * from depot_pneus where id = $1',
      [depotB.id],
    );
    expect(sousA).toHaveLength(0);

    const sousB = await requeteSousTenant(
      bdd.poolApp,
      garage.tenantB.tenant.id,
      'select * from depot_pneus where id = $1',
      [depotB.id],
    );
    expect(sousB, 'contrôle positif : le propriétaire voit bien sa propre ligne').toHaveLength(1);
  });

  it("select explicite par id du dépôt de A rend zéro ligne sous B (symétrie)", async () => {
    const sousB = await requeteSousTenant(
      bdd.poolApp,
      garage.tenantB.tenant.id,
      'select * from depot_pneus where id = $1',
      [depotA.id],
    );
    expect(sousB).toHaveLength(0);
  });

  it("le code_case du dépôt de B (\"B-01\") n'apparaît dans aucune recherche par valeur exacte sous A", async () => {
    const lignes = await requeteSousTenant(
      bdd.poolApp,
      garage.tenantA.tenant.id,
      "select * from depot_pneus where code_case = 'B-01'",
    );
    expect(lignes).toHaveLength(0);
  });

  it('sans app.tenant_id positionné, toute lecture de depot_pneus rend zéro ligne (fail-closed)', async () => {
    const lignes = await requeteSousTenant(bdd.poolApp, null, 'select * from depot_pneus');
    expect(lignes).toHaveLength(0);
  });
});

describe("écriture — impersonation du tenant B refusée sous le contexte A (WITH CHECK), avec un véhicule et un site RÉELS de B", () => {
  it('insert tenant_id=B (véhicule ET site RÉELS de B, aucune FK cassée), exécuté sous le contexte A, viole la politique RLS', async () => {
    const tB = garage.tenantB;
    await expect(
      requeteSousTenant(
        bdd.poolApp,
        garage.tenantA.tenant.id,
        `insert into depot_pneus (id, tenant_id, vehicule_id, site_id, saison, statut)
         values (gen_random_uuid(), $1, $2, $3, 'hiver', 'en_depot')`,
        [tB.tenant.id, tB.vehicules[0]!.id, tB.tenant.sites[0]!.id],
      ),
    ).rejects.toThrow(/policy|permission/i);
  });

  it("un update qui ferait passer le dépôt de A vers tenant_id = B est refusé, la ligne ne bouge pas", async () => {
    const avant = await requeteSousTenant<{ tenant_id: string }>(
      bdd.poolApp,
      garage.tenantA.tenant.id,
      'select tenant_id from depot_pneus where id = $1',
      [depotA.id],
    );
    expect(avant[0]?.tenant_id).toBe(garage.tenantA.tenant.id);

    await expect(
      requeteSousTenant(
        bdd.poolApp,
        garage.tenantA.tenant.id,
        'update depot_pneus set tenant_id = $2 where id = $1',
        [depotA.id, garage.tenantB.tenant.id],
      ),
    ).rejects.toThrow(/policy|permission/i);

    const apres = await requeteSousTenant<{ tenant_id: string }>(
      bdd.poolApp,
      garage.tenantA.tenant.id,
      'select tenant_id from depot_pneus where id = $1',
      [depotA.id],
    );
    expect(apres[0]?.tenant_id).toBe(avant[0]?.tenant_id);
  });

  it('un delete sur son PROPRE dépôt, même sous le bon tenant, est refusé par le privilège Postgres (RPP-05 : jamais par DELETE, dfa_app n’a pas ce droit)', async () => {
    await expect(
      requeteSousTenant(
        bdd.poolApp,
        garage.tenantA.tenant.id,
        'delete from depot_pneus where id = $1',
        [depotA.id],
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});
