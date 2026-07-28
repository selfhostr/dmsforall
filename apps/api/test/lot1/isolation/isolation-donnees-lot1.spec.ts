/**
 * Isolation tenant — DONNÉES RÉELLES des tables du lot 1 (client, vehicule, vehicule_plaque,
 * vehicule_detention, vehicule_kilometrage, ordre_reparation, ligne_or), sur le pool `dfa_app`
 * sous RLS. Complète `test/integration/rls.spec.ts` §"couverture RLS générique", qui prouve que
 * CHAQUE table portant `tenant_id` a une politique bien formée (structure), mais ne manipule
 * aucune donnée en dehors de `site` : ce fichier prouve le COMPORTEMENT, avec un jeu de données
 * réaliste et deux tenants distincts (`garage-demo-lot1.ts`).
 *
 * BLOQUÉ POUR L1-15, documenté dans la réponse de tâche : l'isolation au niveau ENDPOINT HTTP
 * (b) ne peut pas encore être testée — aucun contrôleur du lot 1 n'existe (`app.module.ts`
 * n'importe que les modules de l'étape 0, l'assemblage est L1-16, « en dernier »). Ce fichier est
 * la moitié qui PEUT tourner maintenant : la couche qui, une fois les contrôleurs écrits, sera ce
 * qui les protège réellement. Une lecture inter-tenant y rend TOUJOURS zéro ligne, jamais une
 * erreur — c'est exactement ce qui, côté HTTP, deviendra un 404 et non un 403 (C-16, I-13, CT-11) :
 * l'API ne peut pas distinguer « n'existe pas » de « appartient à un autre tenant » si la couche
 * données elle-même ne fait pas cette distinction avant elle.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  requeteSousTenant,
  demarrerBaseEphemere,
  type BaseEphemere,
} from '../../setup/postgres-ephemere';
import {
  creerLignePourTest,
  creerOrPourTest,
  semerGarageDemoLot1,
  type GarageDemoLot1Fixture,
  type LigneOrDeTest,
  type OrDeTest,
} from '../fixtures/garage-demo-lot1';

let bdd: BaseEphemere;
let garage: GarageDemoLot1Fixture;
let orTenantA: OrDeTest;
let ligneTenantA: LigneOrDeTest;

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  garage = await semerGarageDemoLot1(bdd);
  const t = garage.tenantA;
  orTenantA = await creerOrPourTest(
    bdd,
    t.tenant,
    t.tenant.sites[0]!.id,
    t.clients[0]!,
    t.vehicules[0]!,
  );
  ligneTenantA = await creerLignePourTest(bdd, t.tenant, orTenantA.id);
}, 180_000);

afterAll(async () => {
  await bdd?.fermer();
});

describe('lecture — une donnée du tenant B est invisible sous le contexte du tenant A (et réciproquement)', () => {
  it("client : le compte vu sous chaque tenant correspond exactement à SES clients, jamais à ceux de l'autre", async () => {
    const vusParA = await requeteSousTenant<{ n: string }>(
      bdd.poolApp,
      garage.tenantA.tenant.id,
      'select count(*) as n from client',
    );
    const vusParB = await requeteSousTenant<{ n: string }>(
      bdd.poolApp,
      garage.tenantB.tenant.id,
      'select count(*) as n from client',
    );
    expect(Number(vusParA[0]?.n)).toBe(garage.tenantA.clients.length);
    expect(Number(vusParB[0]?.n)).toBe(garage.tenantB.clients.length);
  });

  it("client : un select explicite par id d'un client du tenant B rend zéro ligne sous le contexte du tenant A", async () => {
    const clientDeB = garage.tenantB.clients[0]!;
    const lignes = await requeteSousTenant(
      bdd.poolApp,
      garage.tenantA.tenant.id,
      'select * from client where id = $1',
      [clientDeB.id],
    );
    expect(lignes).toHaveLength(0);
  });

  it("vehicule : la recherche comptoir par VIN (normaliser_recherche, RM-112) d'un véhicule du tenant B ne trouve rien sous le tenant A", async () => {
    const vehiculeDeB = garage.tenantB.vehicules[0]!;
    const lignes = await requeteSousTenant(
      bdd.poolApp,
      garage.tenantA.tenant.id,
      'select * from vehicule where public.normaliser_recherche(vin) = public.normaliser_recherche($1)',
      [vehiculeDeB.vin],
    );
    expect(lignes).toHaveLength(0);
  });

  it("vehicule_plaque : la plaque courante d'un véhicule du tenant B est invisible sous le tenant A, même en cherchant par sa valeur exacte", async () => {
    const vehiculeDeB = garage.tenantB.vehicules[0]!;
    const lignes = await requeteSousTenant(
      bdd.poolApp,
      garage.tenantA.tenant.id,
      'select * from vehicule_plaque where valeur = $1',
      [vehiculeDeB.plaqueCourante],
    );
    expect(lignes).toHaveLength(0);
  });

  it("vehicule_kilometrage : l'historique kilométrique d'un véhicule du tenant B est invisible sous le tenant A", async () => {
    const vehiculeDeB = garage.tenantB.vehicules[0]!;
    const lignes = await requeteSousTenant(
      bdd.poolApp,
      garage.tenantA.tenant.id,
      'select * from vehicule_kilometrage where vehicule_id = $1',
      [vehiculeDeB.id],
    );
    expect(lignes).toHaveLength(0);
  });

  it('ordre_reparation / ligne_or : un OR (et sa ligne) du tenant A sont invisibles sous le contexte du tenant B', async () => {
    const orVuParB = await requeteSousTenant(
      bdd.poolApp,
      garage.tenantB.tenant.id,
      'select * from ordre_reparation where id = $1',
      [orTenantA.id],
    );
    const ligneVueParB = await requeteSousTenant(
      bdd.poolApp,
      garage.tenantB.tenant.id,
      'select * from ligne_or where id = $1',
      [ligneTenantA.id],
    );
    expect(orVuParB).toHaveLength(0);
    expect(ligneVueParB).toHaveLength(0);

    // Contrôle positif : la même lecture, sous le BON tenant, trouve bien la ligne — sinon le test
    // ci-dessus ne prouverait rien (un select qui rend toujours zéro ligne passerait aussi).
    const orVuParA = await requeteSousTenant(
      bdd.poolApp,
      garage.tenantA.tenant.id,
      'select * from ordre_reparation where id = $1',
      [orTenantA.id],
    );
    expect(orVuParA).toHaveLength(1);
  });

  it('sans app.tenant_id positionné, toute lecture rend zéro ligne, jamais une erreur (fail-closed)', async () => {
    for (const table of [
      'client',
      'vehicule',
      'vehicule_plaque',
      'vehicule_kilometrage',
      'ordre_reparation',
      'ligne_or',
    ]) {
      const lignes = await requeteSousTenant(bdd.poolApp, null, `select * from ${table}`);
      expect(lignes, table).toHaveLength(0);
    }
  });
});

describe("écriture — impersonation d'un autre tenant refusée par le RLS (WITH CHECK), pas seulement filtrée en lecture", () => {
  it('client : un insert portant tenant_id = B, exécuté sous le contexte de A, viole la politique RLS', async () => {
    await expect(
      requeteSousTenant(
        bdd.poolApp,
        garage.tenantA.tenant.id,
        `insert into client (id, tenant_id, numero, type, nom, langue, statut)
         values (gen_random_uuid(), $1, 'CLI-INTRUS', 'particulier', 'Intrus', 'fr', 'actif')`,
        [garage.tenantB.tenant.id],
      ),
    ).rejects.toThrow(/policy|permission/i);
  });

  it('vehicule_kilometrage (append-only, INSERT seul accordé) : impersonation refusée', async () => {
    const vehiculeDeA = garage.tenantA.vehicules[0]!;
    await expect(
      requeteSousTenant(
        bdd.poolApp,
        garage.tenantA.tenant.id,
        `insert into vehicule_kilometrage (id, tenant_id, vehicule_id, valeur, unite, releve_le, source)
         values (gen_random_uuid(), $1, $2, 999999, 'km', now(), 'declaratif')`,
        [garage.tenantB.tenant.id, vehiculeDeA.id],
      ),
    ).rejects.toThrow(/policy|permission/i);
  });

  it("ordre_reparation : un UPDATE qui ferait passer l'OR de A vers tenant_id = B est refusé, la ligne ne bouge pas", async () => {
    await expect(
      requeteSousTenant(
        bdd.poolApp,
        garage.tenantA.tenant.id,
        'update ordre_reparation set tenant_id = $2 where id = $1',
        [orTenantA.id, garage.tenantB.tenant.id],
      ),
    ).rejects.toThrow(/policy|permission/i);

    const releve = await requeteSousTenant<{ tenant_id: string }>(
      bdd.poolApp,
      garage.tenantA.tenant.id,
      'select tenant_id from ordre_reparation where id = $1',
      [orTenantA.id],
    );
    expect(releve[0]?.tenant_id).toBe(garage.tenantA.tenant.id);
  });
});
