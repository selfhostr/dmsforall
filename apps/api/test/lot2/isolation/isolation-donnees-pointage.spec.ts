/**
 * Isolation tenant — DONNÉES RÉELLES des deux tables du module Pointage (migration 0030) :
 * `pointage` et `pointage_verrouillage_site`. MÊME PATRON que
 * `test/lot1/isolation/isolation-donnees-lot1.spec.ts` : pool `dfa_app` sous RLS, deux tenants,
 * lecture ET écriture (impersonation refusée par le `WITH CHECK` de la politique, pas seulement
 * filtrée en lecture).
 *
 * Donnée sensible en particulier (droit du travail suisse, RM-87→RM-99) : un pointage d'un
 * technicien du tenant B ne doit jamais fuiter — ni le fait qu'il ait travaillé, ni combien de
 * temps, ni sur quel OR — vers un utilisateur du tenant A, quel que soit le chemin emprunté.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  demarrerBaseEphemere,
  requeteSousTenant,
  type BaseEphemere,
} from '../../setup/postgres-ephemere';
import {
  semerGarageDemoLot1,
  type GarageDemoLot1Fixture,
  type DonneesLot1Tenant,
} from '../../lot1/fixtures/garage-demo-lot1';
import { creerPointagePourTest } from '../fixtures/garage-demo-lot2';

let bdd: BaseEphemere;
let garage: GarageDemoLot1Fixture;

interface JeuPointage {
  readonly pointageId: string;
  readonly siteId: string;
  readonly technicienId: string;
}

async function semerJeuPointage(t: DonneesLot1Tenant): Promise<JeuPointage> {
  const siteId = t.tenant.sites[0]!.id;
  const technicienId = t.utilisateursParRole.technicien.id;
  const pointageId = randomUUID();
  await creerPointagePourTest(bdd, t.tenant, pointageId, siteId, technicienId, {
    nature: 'indirect',
    activiteIndirecte: 'pause',
  });
  await requeteSousTenantEcriture(t.tenant.id, siteId);
  return { pointageId, siteId, technicienId };
}

/** Amorce une ligne de `pointage_verrouillage_site` (verrouillage jamais posé, juste la ligne). */
async function requeteSousTenantEcriture(tenantId: string, siteId: string): Promise<void> {
  const client = await bdd.poolApp.connect();
  try {
    await client.query('begin');
    await client.query('select set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    await client.query(
      `insert into pointage_verrouillage_site (tenant_id, site_id) values ($1, $2)
       on conflict (tenant_id, site_id) do nothing`,
      [tenantId, siteId],
    );
    await client.query('commit');
  } catch (erreur) {
    await client.query('rollback').catch(() => undefined);
    throw erreur;
  } finally {
    client.release();
  }
}

let jeuA: JeuPointage;
let jeuB: JeuPointage;

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  garage = await semerGarageDemoLot1(bdd);
  [jeuA, jeuB] = await Promise.all([
    semerJeuPointage(garage.tenantA),
    semerJeuPointage(garage.tenantB),
  ]);
}, 180_000);

afterAll(async () => {
  await bdd?.fermer();
});

describe('lecture — le pointage du tenant B est invisible sous le contexte du tenant A', () => {
  it('pointage : select explicite par id rend zéro ligne sous le mauvais tenant, une ligne sous le bon', async () => {
    const sousA = await requeteSousTenant(
      bdd.poolApp,
      garage.tenantA.tenant.id,
      'select * from pointage where id = $1',
      [jeuB.pointageId],
    );
    expect(sousA).toHaveLength(0);
    const sousB = await requeteSousTenant(
      bdd.poolApp,
      garage.tenantB.tenant.id,
      'select * from pointage where id = $1',
      [jeuB.pointageId],
    );
    expect(sousB).toHaveLength(1);
  });

  it("pointage : la liste « qui est pointé en ce moment » (statut=en_cours) d'un tenant ne montre jamais le technicien de l'autre", async () => {
    const vusParA = await requeteSousTenant<{ technicien_id: string }>(
      bdd.poolApp,
      garage.tenantA.tenant.id,
      "select technicien_id from pointage where statut = 'en_cours'",
    );
    expect(vusParA.map((l) => l.technicien_id)).not.toContain(jeuB.technicienId);
  });

  it('pointage_verrouillage_site : la ligne de B est invisible sous A', async () => {
    const lignes = await requeteSousTenant(
      bdd.poolApp,
      garage.tenantA.tenant.id,
      'select * from pointage_verrouillage_site where site_id = $1',
      [jeuB.siteId],
    );
    expect(lignes).toHaveLength(0);
  });

  it('sans app.tenant_id positionné, toute lecture rend zéro ligne (fail-closed)', async () => {
    for (const table of ['pointage', 'pointage_verrouillage_site']) {
      const lignes = await requeteSousTenant(bdd.poolApp, null, `select * from ${table}`);
      expect(lignes, table).toHaveLength(0);
    }
  });
});

describe('écriture — impersonation du tenant B refusée sous le contexte A', () => {
  it('pointage : insert visant le site ET le technicien RÉELS de B, tenant_id=B, sous le contexte A — refusé', async () => {
    // statut 'termine' (pas 'en_cours') : le technicien de B a déjà un pointage 'en_cours' réel
    // (jeuB.pointageId, posé par semerJeuPointage) — utiliser 'en_cours' ici ferait planer une
    // ambiguïté avec `pointage_technicien_un_seul_en_cours_uk` (23505) sur ce qu'on veut isoler,
    // à savoir la politique RLS elle-même. 'termine' n'est concerné par aucun index unique.
    await expect(
      requeteSousTenant(
        bdd.poolApp,
        garage.tenantA.tenant.id,
        `insert into pointage (id, tenant_id, site_id, technicien_id, statut, nature, activite_indirecte, debut_le, fin_le)
         values ($1, $2, $3, $4, 'termine', 'indirect', 'pause', now() - interval '1 hour', now())`,
        [randomUUID(), garage.tenantB.tenant.id, jeuB.siteId, jeuB.technicienId],
      ),
    ).rejects.toThrow(/policy|permission/i);
  });

  it('pointage_verrouillage_site : insert visant le site RÉEL de B, tenant_id=B, sous le contexte A — refusé', async () => {
    // Site de A (première fois qu'un verrouillage y est tenté dans ce fichier) pour éviter le
    // conflit de clé primaire avec la ligne déjà amorcée par semerJeuPointage.
    const siteVierge = garage.tenantB.tenant.sites[1]!.id;
    await expect(
      requeteSousTenant(
        bdd.poolApp,
        garage.tenantA.tenant.id,
        `insert into pointage_verrouillage_site (tenant_id, site_id) values ($1, $2)`,
        [garage.tenantB.tenant.id, siteVierge],
      ),
    ).rejects.toThrow(/policy|permission/i);
  });

  it('pointage : un UPDATE qui ferait passer le pointage de A vers tenant_id = B est refusé, la ligne ne bouge pas', async () => {
    await expect(
      requeteSousTenant(
        bdd.poolApp,
        garage.tenantA.tenant.id,
        'update pointage set tenant_id = $2 where id = $1',
        [jeuA.pointageId, garage.tenantB.tenant.id],
      ),
    ).rejects.toThrow(/policy|permission/i);

    const releve = await requeteSousTenant<{ tenant_id: string }>(
      bdd.poolApp,
      garage.tenantA.tenant.id,
      'select tenant_id from pointage where id = $1',
      [jeuA.pointageId],
    );
    expect(releve[0]?.tenant_id).toBe(garage.tenantA.tenant.id);
  });
});
