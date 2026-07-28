/**
 * Isolation inter-tenant — modules CLIENTS (0006_clients.sql) et ATELIER (0008_atelier.sql), en
 * exécution, sur vraie base Postgres éphémère. Même doctrine que
 * `test/lot1/isolation-vehicules.spec.ts` (style de référence pour ce fichier) pour le module
 * véhicules.
 *
 * Complète (sans les dupliquer) deux fichiers déjà existants et hors périmètre de cette tâche :
 *   - `test/integration/rls.spec.ts` prouve la POSTURE générique (chaque table `tenant_id` a
 *     `relrowsecurity` + une politique référençant `tenant_courant()`), toutes tables confondues.
 *   - `test/lot1/isolation/isolation-donnees-lot1.spec.ts` couvre `client`, `vehicule*`,
 *     `ordre_reparation`, `ligne_or` — mais AUCUNE des cinq sous-tables du module clients
 *     (`client_adresse`, `client_contact`, `client_condition`, `client_consentement`,
 *     `client_note`) ni des quatre sous-tables du module atelier (`ordre_reparation_demande`,
 *     `devis_complementaire`, `devis_complementaire_ligne`, `or_controle_qualite`), et AUCUN IDOR
 *     HTTP (bloqué à l'époque : « aucun contrôleur du lot 1 n'existe », commentaire du fichier).
 *     Les contrôleurs existent désormais (`ClientController`, `OrdreReparationController`) : ce
 *     fichier couvre ce qui restait bloqué.
 *
 * Nommage des tenants : `garage-a` / `garage-b` (physiquement `garage.tenantA` / `garage.tenantB`,
 * hérités de la fixture partagée `garage-demo-lot1.ts`, hors périmètre d'écriture de cette tâche).
 */

import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demarrerBaseEphemere, ecrireSousTenant, requeteSousTenant, type BaseEphemere } from '../setup/postgres-ephemere';
import { creerAppTest, demarrerRedisEphemere, type AppTest, type RedisEphemere } from '../setup/app-test';
import {
  creerLignePourTest,
  creerOrPourTest,
  semerGarageDemoLot1,
  type GarageDemoLot1Fixture,
  type LigneOrDeTest,
  type OrDeTest,
} from './fixtures/garage-demo-lot1';
import { cookieDeSessionPour } from './isolation-http-aide';

let bdd: BaseEphemere;
let garage: GarageDemoLot1Fixture;
let redis: RedisEphemere;
let ctx: AppTest;

// -------------------------------------------------------------------------------------------
// Données complémentaires — sous-tables non semées par `garage-demo-lot1.ts`, sur chaque tenant.
// Écrites via `ecrireSousTenant` (pool dfa_app, sous RLS) : amorcer ces lignes EST déjà une preuve
// que le RLS n'empêche pas une écriture légitime sous le bon contexte tenant.
// -------------------------------------------------------------------------------------------

interface SousTablesClient {
  readonly adresseId: string;
  readonly contactId: string;
  readonly conditionId: string;
  readonly consentementId: string;
  readonly noteId: string;
}

async function semerSousTablesClient(tenantId: string, clientId: string): Promise<SousTablesClient> {
  const adresseId = randomUUID();
  const contactId = randomUUID();
  const conditionId = randomUUID();
  const consentementId = randomUUID();
  const noteId = randomUUID();
  await ecrireSousTenant(bdd.poolApp, tenantId, async (client: PoolClient) => {
    await client.query(
      `insert into client_adresse (id, tenant_id, client_id, type, rue, npa, localite, pays)
       values ($1, $2, $3, 'principale', 'Rue de Test 1', '1000', 'Lausanne', 'CH')`,
      [adresseId, tenantId, clientId],
    );
    await client.query(
      `insert into client_contact (id, tenant_id, client_id, nom, prenom, roles)
       values ($1, $2, $3, 'Contact', 'Test', array['signataire']::role_contact[])`,
      [contactId, tenantId, clientId],
    );
    await client.query(
      `insert into client_condition (id, tenant_id, client_id, valide_du)
       values ($1, $2, $3, current_date)`,
      [conditionId, tenantId, clientId],
    );
    await client.query(
      `insert into client_consentement (id, tenant_id, client_id, type, accorde)
       values ($1, $2, $3, 'marketing_email', true)`,
      [consentementId, tenantId, clientId],
    );
    await client.query(
      `insert into client_note (id, tenant_id, client_id, nature, texte)
       values ($1, $2, $3, 'interne', 'Note de test — isolation lot 1')`,
      [noteId, tenantId, clientId],
    );
  });
  return { adresseId, contactId, conditionId, consentementId, noteId };
}

interface SousTablesAtelier {
  readonly demandeId: string;
  readonly devisId: string;
  readonly devisLigneId: string;
  readonly controleId: string;
}

async function semerSousTablesAtelier(tenantId: string, orId: string, ligneId: string): Promise<SousTablesAtelier> {
  const demandeId = randomUUID();
  const devisId = randomUUID();
  const devisLigneId = randomUUID();
  const controleId = randomUUID();
  await ecrireSousTenant(bdd.poolApp, tenantId, async (client: PoolClient) => {
    await client.query(
      `insert into ordre_reparation_demande (id, tenant_id, ordre_reparation_id, ordre, verbatim)
       values ($1, $2, $3, 1, 'Verbatim de test — isolation lot 1')`,
      [demandeId, tenantId, orId],
    );
    await client.query(
      `insert into devis_complementaire (id, tenant_id, ordre_reparation_id, numero_ordre, montant_ttc_centimes)
       values ($1, $2, $3, 1, 15000)`,
      [devisId, tenantId, orId],
    );
    await client.query(
      `insert into devis_complementaire_ligne (id, tenant_id, devis_complementaire_id, ligne_or_id)
       values ($1, $2, $3, $4)`,
      [devisLigneId, tenantId, devisId, ligneId],
    );
    await client.query(
      `insert into or_controle_qualite (id, tenant_id, ordre_reparation_id, conforme)
       values ($1, $2, $3, true)`,
      [controleId, tenantId, orId],
    );
  });
  return { demandeId, devisId, devisLigneId, controleId };
}

let sousClientA: SousTablesClient;
let sousClientB: SousTablesClient;
let orA: OrDeTest;
let orB: OrDeTest;
let ligneA: LigneOrDeTest;
let ligneB: LigneOrDeTest;
let sousAtelierA: SousTablesAtelier;
let sousAtelierB: SousTablesAtelier;

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  garage = await semerGarageDemoLot1(bdd);

  const clientA = garage.tenantA.clients[0]!;
  const clientB = garage.tenantB.clients[0]!;
  [sousClientA, sousClientB] = await Promise.all([
    semerSousTablesClient(garage.tenantA.tenant.id, clientA.id),
    semerSousTablesClient(garage.tenantB.tenant.id, clientB.id),
  ]);

  const tA = garage.tenantA;
  const tB = garage.tenantB;
  orA = await creerOrPourTest(bdd, tA.tenant, tA.tenant.sites[0]!.id, tA.clients[0]!, tA.vehicules[0]!);
  orB = await creerOrPourTest(bdd, tB.tenant, tB.tenant.sites[0]!.id, tB.clients[0]!, tB.vehicules[0]!);
  ligneA = await creerLignePourTest(bdd, tA.tenant, orA.id);
  ligneB = await creerLignePourTest(bdd, tB.tenant, orB.id);

  [sousAtelierA, sousAtelierB] = await Promise.all([
    semerSousTablesAtelier(tA.tenant.id, orA.id, ligneA.id),
    semerSousTablesAtelier(tB.tenant.id, orB.id, ligneB.id),
  ]);

  redis = await demarrerRedisEphemere();
  ctx = await creerAppTest(bdd, redis.url);
}, 180_000);

afterAll(async () => {
  await ctx?.fermer();
  await redis?.fermer();
  await bdd?.fermer();
});

// -------------------------------------------------------------------------------------------
// 1. Lecture croisée, table par table — les 5 sous-tables clients + 4 sous-tables atelier non
//    couvertes par isolation-donnees-lot1.spec.ts.
// -------------------------------------------------------------------------------------------

/** Contrôle positif (visible sous son propre tenant) + assertion d'isolation (invisible sous
 *  l'autre) dans le MÊME test — un test qui ne vérifierait que la moitié « invisible » passerait
 *  aussi bien si la requête ne trouvait jamais rien, ce qui ne prouverait rien. */
async function verifierIsolationLecture(table: string, idPropreA: string, idDeB: string): Promise<void> {
  const propre = await requeteSousTenant(bdd.poolApp, garage.tenantA.tenant.id, `select * from ${table} where id = $1`, [idPropreA]);
  expect(propre.length, `contrôle positif : ${table} de garage-a doit être visible sous son propre contexte`).toBeGreaterThan(0);

  const croise = await requeteSousTenant(bdd.poolApp, garage.tenantA.tenant.id, `select * from ${table} where id = $1`, [idDeB]);
  expect(croise, `${table} de garage-b doit être invisible sous le contexte de garage-a`).toHaveLength(0);
}

describe('lecture croisée — sous-tables du module CLIENTS (0006_clients.sql)', () => {
  it('client_adresse : une adresse de garage-b est invisible sous garage-a', async () => {
    await verifierIsolationLecture('client_adresse', sousClientA.adresseId, sousClientB.adresseId);
  });
  it('client_contact : un contact de garage-b est invisible sous garage-a', async () => {
    await verifierIsolationLecture('client_contact', sousClientA.contactId, sousClientB.contactId);
  });
  it('client_condition : des conditions commerciales de garage-b sont invisibles sous garage-a', async () => {
    await verifierIsolationLecture('client_condition', sousClientA.conditionId, sousClientB.conditionId);
  });
  it('client_consentement (append-only, nLPD) : un consentement de garage-b est invisible sous garage-a', async () => {
    await verifierIsolationLecture('client_consentement', sousClientA.consentementId, sousClientB.consentementId);
  });
  it('client_note : une note de garage-b (potentiellement une alerte, RM-13) est invisible sous garage-a', async () => {
    await verifierIsolationLecture('client_note', sousClientA.noteId, sousClientB.noteId);
  });
});

describe('lecture croisée — sous-tables du module ATELIER (0008_atelier.sql)', () => {
  it('ordre_reparation_demande (verbatim, append-only) : une demande de garage-b est invisible sous garage-a', async () => {
    await verifierIsolationLecture('ordre_reparation_demande', sousAtelierA.demandeId, sousAtelierB.demandeId);
  });
  it('devis_complementaire : un devis (donc un MONTANT) de garage-b est invisible sous garage-a', async () => {
    await verifierIsolationLecture('devis_complementaire', sousAtelierA.devisId, sousAtelierB.devisId);
  });
  it('devis_complementaire_ligne : une ligne de devis de garage-b est invisible sous garage-a', async () => {
    await verifierIsolationLecture('devis_complementaire_ligne', sousAtelierA.devisLigneId, sousAtelierB.devisLigneId);
  });
  it('or_controle_qualite : un contrôle qualité de garage-b est invisible sous garage-a', async () => {
    await verifierIsolationLecture('or_controle_qualite', sousAtelierA.controleId, sousAtelierB.controleId);
  });
});

// -------------------------------------------------------------------------------------------
// 2. Absence de contexte tenant = ZÉRO ligne, jamais toutes les lignes (fail-closed)
// -------------------------------------------------------------------------------------------

describe('fail-closed — sans app.tenant_id, aucune lecture ne rend jamais une ligne (9 sous-tables)', () => {
  const TABLES = [
    'client_adresse',
    'client_contact',
    'client_condition',
    'client_consentement',
    'client_note',
    'ordre_reparation_demande',
    'devis_complementaire',
    'devis_complementaire_ligne',
    'or_controle_qualite',
  ] as const;

  it.each(TABLES)('%s : select sans contexte tenant rend zéro ligne, pas une erreur', async (table) => {
    // Précondition : au moins une ligne existe réellement (les deux tenants confondus) — sinon
    // « zéro ligne rendue » serait vrai pour une raison sans intérêt (table vide).
    const totalA = await requeteSousTenant<{ n: string }>(bdd.poolApp, garage.tenantA.tenant.id, `select count(*) as n from ${table}`);
    const totalB = await requeteSousTenant<{ n: string }>(bdd.poolApp, garage.tenantB.tenant.id, `select count(*) as n from ${table}`);
    expect(Number(totalA[0]?.n ?? 0) + Number(totalB[0]?.n ?? 0), `précondition : ${table} doit contenir au moins une ligne`).toBeGreaterThan(0);

    const lignes = await requeteSousTenant(bdd.poolApp, null, `select * from ${table}`);
    expect(lignes, table).toHaveLength(0);
  });
});

// -------------------------------------------------------------------------------------------
// 3. Écriture croisée — UPDATE ciblant l'UUID d'une ligne de garage-b : zéro ligne affectée.
// -------------------------------------------------------------------------------------------

async function verifierUpdateCroiseSansEffet(table: string, assignation: string, idDeB: string): Promise<void> {
  const lignes = await requeteSousTenant(
    bdd.poolApp,
    garage.tenantA.tenant.id,
    `update ${table} set ${assignation} where id = $1 returning id`,
    [idDeB],
  );
  expect(lignes, `UPDATE sur ${table} ciblant une ligne de garage-b ne doit affecter AUCUNE ligne sous garage-a`).toHaveLength(0);
}

describe('écriture croisée — UPDATE ciblant une ligne de garage-b, sous le contexte de garage-a', () => {
  it("client_adresse : modifier la localité d'une adresse de garage-b n'affecte aucune ligne", async () => {
    await verifierUpdateCroiseSansEffet('client_adresse', "localite = 'INTRUS'", sousClientB.adresseId);
  });
  it("client_note : modifier le texte d'une note de garage-b n'affecte aucune ligne", async () => {
    await verifierUpdateCroiseSansEffet('client_note', "texte = 'INTRUS'", sousClientB.noteId);
  });
  it("devis_complementaire : modifier le montant d'un devis de garage-b n'affecte aucune ligne (RLS avant tout calcul financier)", async () => {
    await verifierUpdateCroiseSansEffet('devis_complementaire', 'montant_ttc_centimes = 999999', sousAtelierB.devisId);
  });
  it("or_controle_qualite : requalifier un contrôle de garage-b en non conforme n'affecte aucune ligne", async () => {
    await verifierUpdateCroiseSansEffet(
      'or_controle_qualite',
      "conforme = false, motif_non_conformite = 'INTRUS'",
      sousAtelierB.controleId,
    );
  });
});

describe("écriture croisée — impersonation (WITH CHECK) refusée, sous-tables clients et atelier", () => {
  it('client_note : un insert portant tenant_id = garage-b, exécuté sous le contexte de garage-a, viole la politique RLS', async () => {
    await expect(
      requeteSousTenant(
        bdd.poolApp,
        garage.tenantA.tenant.id,
        `insert into client_note (id, tenant_id, client_id, nature, texte) values ($1, $2, $3, 'interne', 'Intrus')`,
        [randomUUID(), garage.tenantB.tenant.id, garage.tenantB.clients[0]!.id],
      ),
    ).rejects.toThrow(/policy|permission/i);
  });

  it('devis_complementaire : un insert portant tenant_id = garage-b, exécuté sous le contexte de garage-a, viole la politique RLS', async () => {
    await expect(
      requeteSousTenant(
        bdd.poolApp,
        garage.tenantA.tenant.id,
        `insert into devis_complementaire (id, tenant_id, ordre_reparation_id, numero_ordre, montant_ttc_centimes)
         values ($1, $2, $3, 99, 1)`,
        [randomUUID(), garage.tenantB.tenant.id, orB.id],
      ),
    ).rejects.toThrow(/policy|permission/i);
  });

  it('client_consentement (append-only, INSERT seul accordé) : impersonation refusée', async () => {
    await expect(
      requeteSousTenant(
        bdd.poolApp,
        garage.tenantA.tenant.id,
        `insert into client_consentement (id, tenant_id, client_id, type, accorde) values ($1, $2, $3, 'marketing_sms', false)`,
        [randomUUID(), garage.tenantB.tenant.id, garage.tenantB.clients[0]!.id],
      ),
    ).rejects.toThrow(/policy|permission/i);
  });
});

// -------------------------------------------------------------------------------------------
// 4. IDOR par l'API RÉELLE — accès direct par UUID d'un autre tenant : 404, JAMAIS 403 (la
//    non-divulgation d'existence compte : un 403 confirmerait que la ressource existe ailleurs).
// -------------------------------------------------------------------------------------------

describe('IDOR via HTTP — GET /api/v1/clients/{id}', () => {
  it("un client de garage-b, demandé par son UUID réel sous une session garage-a, rend 404 RESSOURCE_INTROUVABLE — jamais 403", async () => {
    const u = garage.tenantA.utilisateursParRole.receptionnaire;
    const cookie = await cookieDeSessionPour(ctx, u.email, u.motDePasseClair);

    const reponse = await ctx.requete.get(`/api/v1/clients/${garage.tenantB.clients[0]!.id}`).set('Cookie', cookie);

    expect(reponse.status).toBe(404);
    expect((reponse.body as { code?: string }).code).toBe('RESSOURCE_INTROUVABLE');
  });

  it('à l’inverse, GET sur SON PROPRE client rend bien 200 — contrôle positif indispensable', async () => {
    const u = garage.tenantA.utilisateursParRole.receptionnaire;
    const cookie = await cookieDeSessionPour(ctx, u.email, u.motDePasseClair);

    const reponse = await ctx.requete.get(`/api/v1/clients/${garage.tenantA.clients[0]!.id}`).set('Cookie', cookie);

    expect(reponse.status).toBe(200);
    expect((reponse.body as { id?: string }).id).toBe(garage.tenantA.clients[0]!.id);
  });

  it('un UUID syntaxiquement valide mais qui n’existe NULLE PART (même pas chez garage-b) rend le MÊME 404 — jamais de distinction observable entre « inexistant » et « chez un autre tenant »', async () => {
    const u = garage.tenantA.utilisateursParRole.receptionnaire;
    const cookie = await cookieDeSessionPour(ctx, u.email, u.motDePasseClair);

    const reponse = await ctx.requete.get(`/api/v1/clients/${randomUUID()}`).set('Cookie', cookie);

    expect(reponse.status).toBe(404);
    expect((reponse.body as { code?: string }).code).toBe('RESSOURCE_INTROUVABLE');
  });
});

describe('IDOR via HTTP — GET /api/v1/ordres-reparation/{id}', () => {
  it("un OR de garage-b, demandé par son UUID réel sous une session garage-a, rend 404 RESSOURCE_INTROUVABLE — jamais 403", async () => {
    const u = garage.tenantA.utilisateursParRole.receptionnaire;
    const cookie = await cookieDeSessionPour(ctx, u.email, u.motDePasseClair);

    const reponse = await ctx.requete.get(`/api/v1/ordres-reparation/${orB.id}`).set('Cookie', cookie);

    expect(reponse.status).toBe(404);
    expect((reponse.body as { code?: string }).code).toBe('RESSOURCE_INTROUVABLE');
  });

  it('à l’inverse, GET sur SON PROPRE OR rend bien 200 — contrôle positif indispensable', async () => {
    const u = garage.tenantA.utilisateursParRole.receptionnaire;
    const cookie = await cookieDeSessionPour(ctx, u.email, u.motDePasseClair);

    const reponse = await ctx.requete.get(`/api/v1/ordres-reparation/${orA.id}`).set('Cookie', cookie);

    expect(reponse.status).toBe(200);
    expect((reponse.body as { id?: string }).id).toBe(orA.id);
  });

  it('un UUID syntaxiquement valide mais introuvable nulle part rend le MÊME 404 que celui de garage-b', async () => {
    const u = garage.tenantA.utilisateursParRole.receptionnaire;
    const cookie = await cookieDeSessionPour(ctx, u.email, u.motDePasseClair);

    const reponse = await ctx.requete.get(`/api/v1/ordres-reparation/${randomUUID()}`).set('Cookie', cookie);

    expect(reponse.status).toBe(404);
    expect((reponse.body as { code?: string }).code).toBe('RESSOURCE_INTROUVABLE');
  });
});
