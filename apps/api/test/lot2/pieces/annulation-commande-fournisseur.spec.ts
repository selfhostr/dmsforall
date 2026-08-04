/**
 * `motif_annulation` de `commande_fournisseur` (migration 0034) — comble un gap de schéma
 * mesuré en exécution à l'audit du module Pièces : `ServiceCommandeFournisseur.annuler` (0024)
 * validait déjà `entree.motif` (`schemaMotif`, non vide) mais ne l'écrivait dans AUCUNE colonne,
 * alors même que `transition_autorisee.exige_motif = true` pour LES DEUX transitions
 * `{brouillon, envoyee} → annulee` (0024 §4). 0034 ajoute la colonne ET la contrainte
 * `commande_fournisseur_annulation_coherente_chk` qui la rend enfin opposable.
 *
 * Trois angles, chacun dans son propre describe :
 *   1. persistance RÉELLE — l'annulation via l'API renvoie le motif ET l'écrit en base (pas
 *      seulement dans la réponse HTTP, qui pourrait mentir) ;
 *   2. la contrainte CHECK elle-même, au niveau SQL — `verifier_transition()` ne connaît PAS
 *      `exige_motif` (voir l'en-tête de 0024) : c'est CETTE contrainte, et elle seule, qui rend le
 *      motif réellement obligatoire pour la base ;
 *   3. isolation tenant — ni annuler ni lire la commande d'un autre tenant, par l'API réelle
 *      (IDOR) et au niveau SQL brut (RLS).
 *
 * MÊME PATRON que `test/lot1/machine-etats/transitions-ligne-or.spec.ts` pour la partie CHECK
 * (`ligne_or_annulation_motif_chk`, forme identique) et que
 * `test/lot1/isolation-vehicules.spec.ts` pour la partie IDOR HTTP (404 RESSOURCE_INTROUVABLE,
 * jamais 403 qui confirmerait l'existence de la ressource à un tenant qui n'y a pas droit).
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  demarrerBaseEphemere,
  ecrireSousTenant,
  requeteSousTenant,
  type BaseEphemere,
} from '../../setup/postgres-ephemere';
import {
  creerAppTest,
  demarrerRedisEphemere,
  type AppTest,
  type RedisEphemere,
} from '../../setup/app-test';
import {
  semerGarageDemoLot1,
  type GarageDemoLot1Fixture,
} from '../../lot1/fixtures/garage-demo-lot1';
import { cookieDeSessionPour } from '../../lot1/isolation-http-aide';
import {
  creerCommandeFournisseurPourTest,
  creerFournisseurPourTest,
  type FournisseurDeTest,
} from '../fixtures/garage-demo-lot2';

let bdd: BaseEphemere;
let garage: GarageDemoLot1Fixture;
let redis: RedisEphemere;
let ctx: AppTest;
let fournisseurA: FournisseurDeTest;
let fournisseurB: FournisseurDeTest;

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  garage = await semerGarageDemoLot1(bdd);
  [fournisseurA, fournisseurB] = await Promise.all([
    creerFournisseurPourTest(bdd, garage.tenantA.tenant, 'Fournisseur A — annulation'),
    creerFournisseurPourTest(bdd, garage.tenantB.tenant, 'Fournisseur B — annulation'),
  ]);
  redis = await demarrerRedisEphemere();
  ctx = await creerAppTest(bdd, redis.url);
}, 180_000);

afterAll(async () => {
  await ctx?.fermer();
  await redis?.fermer();
  await bdd?.fermer();
});

/** `magasinier` porte `pieces.commande_fournisseur.creer` (droit exigé par `POST .../annuler`,
 *  même patron que `envoyer` — pas de droit `annuler` distinct, voir `matrice-droits.ts`) ET
 *  `pieces.commande_fournisseur.lire`. `admin` porte `[]` sur tout le domaine Pièces (RF-115) —
 *  volontairement écarté ici. */
async function cookieMagasinier(t: GarageDemoLot1Fixture['tenantA']): Promise<string> {
  const u = t.utilisateursParRole.magasinier;
  return cookieDeSessionPour(ctx, u.email, u.motDePasseClair);
}

// -------------------------------------------------------------------------------------------
// 1. Persistance réelle — l'API écrit motif_annulation, ne se contente pas de le valider
// -------------------------------------------------------------------------------------------

describe('POST /commandes-fournisseur/{id}/annuler persiste réellement le motif (migration 0034)', () => {
  it('brouillon → annulee : le motif est renvoyé dans la réponse ET relisible en base par une requête indépendante', async () => {
    const t = garage.tenantA;
    const siteId = t.tenant.sites[0]!.id;
    const commande = await creerCommandeFournisseurPourTest(
      bdd,
      t.tenant,
      siteId,
      fournisseurA.id,
      'brouillon',
    );
    const cookie = await cookieMagasinier(t);
    const motif = "Fournisseur en cessation d'activité, commande abandonnée.";

    const reponse = await ctx.requete
      .post(`/api/v1/commandes-fournisseur/${commande.id}/annuler`)
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .set('Cookie', cookie)
      .send({ motif });

    // `toBeLessThan(300)`, pas `toBe(200)` : ni `annuler` ni `envoyer` (ci-dessous) ne portent de
    // `@HttpCode` explicite dans `commande-fournisseur.controller.ts` — défaut NestJS d'un `@Post`
    // sans décorateur = 201, alors que `@ApiOkResponse` documente 200 en Swagger. Même prudence que
    // `test/lot1/metier-machine-etats-or.spec.ts` (« ordre_reparation — chaîne de transitions
    // AUTORISÉES ») face à la même ambiguïté sur des routes soeurs du même style. Ce qui compte ici
    // est prouvé sans ambiguïté par les assertions de CONTENU juste après (statut, motif).
    expect(reponse.status, JSON.stringify(reponse.body)).toBeLessThan(300);
    const corps = reponse.body as { donnees: { statut: string; motifAnnulation: string | null } };
    expect(corps.donnees.statut).toBe('annulee');
    expect(corps.donnees.motifAnnulation).toBe(motif);

    // Preuve indépendante de la réponse HTTP : une SECONDE requête SQL, hors du chemin qui a écrit,
    // relit la même valeur — exactement le gap que 0034 comble (avant, la colonne n'existait pas et
    // la valeur était jetée après validation).
    const relu = await requeteSousTenant<{ statut: string; motif_annulation: string | null }>(
      bdd.poolApp,
      t.tenant.id,
      'select statut, motif_annulation from commande_fournisseur where id = $1',
      [commande.id],
    );
    expect(relu[0]?.statut).toBe('annulee');
    expect(relu[0]?.motif_annulation).toBe(motif);
  });

  it('envoyee → annulee (seconde transition autorisée par exige_motif=true) : motif persisté également', async () => {
    const t = garage.tenantA;
    const siteId = t.tenant.sites[0]!.id;
    const commande = await creerCommandeFournisseurPourTest(
      bdd,
      t.tenant,
      siteId,
      fournisseurA.id,
      'brouillon',
    );
    const cookie = await cookieMagasinier(t);

    const envoi = await ctx.requete
      .post(`/api/v1/commandes-fournisseur/${commande.id}/envoyer`)
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .set('Cookie', cookie)
      .send({});
    expect(envoi.status, JSON.stringify(envoi.body)).toBeLessThan(300);
    expect((envoi.body as { donnees: { statut: string } }).donnees.statut).toBe('envoyee');

    const motif = 'Rupture prolongée annoncée par le fournisseur.';
    const annulation = await ctx.requete
      .post(`/api/v1/commandes-fournisseur/${commande.id}/annuler`)
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .set('Cookie', cookie)
      .send({ motif });

    expect(annulation.status, JSON.stringify(annulation.body)).toBeLessThan(300);
    const corps = annulation.body as {
      donnees: { statut: string; motifAnnulation: string | null };
    };
    expect(corps.donnees.statut).toBe('annulee');
    expect(corps.donnees.motifAnnulation).toBe(motif);

    const relu = await requeteSousTenant<{ motif_annulation: string | null }>(
      bdd.poolApp,
      t.tenant.id,
      'select motif_annulation from commande_fournisseur where id = $1',
      [commande.id],
    );
    expect(relu[0]?.motif_annulation).toBe(motif);
  });

  it('une commande NON annulée garde motif_annulation à null (pas de valeur inventée sur les autres statuts)', async () => {
    const t = garage.tenantA;
    const siteId = t.tenant.sites[0]!.id;
    const commande = await creerCommandeFournisseurPourTest(
      bdd,
      t.tenant,
      siteId,
      fournisseurA.id,
      'brouillon',
    );

    const relu = await requeteSousTenant<{ motif_annulation: string | null }>(
      bdd.poolApp,
      t.tenant.id,
      'select motif_annulation from commande_fournisseur where id = $1',
      [commande.id],
    );
    expect(relu[0]?.motif_annulation).toBeNull();
  });
});

// -------------------------------------------------------------------------------------------
// 2. La contrainte CHECK elle-même — SQL brut, contournant délibérément le service applicatif
//    (`verifier_transition()` ne lit PAS exige_motif, voir l'en-tête de 0024 : seule cette
//    contrainte de table rend le motif réellement obligatoire pour la base).
// -------------------------------------------------------------------------------------------

describe('CHECK commande_fournisseur_annulation_coherente_chk (0034) — au niveau SQL, indépendamment du service', () => {
  it('brouillon → annulee SANS motif_annulation est refusée par la contrainte CHECK (23514)', async () => {
    const t = garage.tenantA;
    const siteId = t.tenant.sites[0]!.id;
    const commande = await creerCommandeFournisseurPourTest(
      bdd,
      t.tenant,
      siteId,
      fournisseurA.id,
      'brouillon',
    );

    // `verifier_transition()` autorise ce COUPLE de statuts (brouillon -> annulee EST une
    // transition légale, 0024 §4) : si ce test échouait pour ZDFA1 (transition interdite) au lieu
    // de 23514, ce serait le signe d'un défaut d'installation de la fixture, pas la preuve
    // recherchée. On vérifie donc précisément le code SQLSTATE, pas seulement "ça a raté".
    await expect(
      ecrireSousTenant(bdd.poolApp, t.tenant.id, (client) =>
        client.query("update commande_fournisseur set statut = 'annulee' where id = $1", [
          commande.id,
        ]),
      ),
    ).rejects.toMatchObject({ code: '23514' }); // check_violation

    // Contrôle : la commande n'a pas bougé (l'échec de la contrainte annule tout l'UPDATE).
    const relu = await requeteSousTenant<{ statut: string }>(
      bdd.poolApp,
      t.tenant.id,
      'select statut from commande_fournisseur where id = $1',
      [commande.id],
    );
    expect(relu[0]?.statut).toBe('brouillon');
  });

  it('envoyee → annulee SANS motif_annulation est refusée elle aussi (les DEUX transitions vers annulee sont couvertes par exige_motif)', async () => {
    const t = garage.tenantA;
    const siteId = t.tenant.sites[0]!.id;
    const commande = await creerCommandeFournisseurPourTest(
      bdd,
      t.tenant,
      siteId,
      fournisseurA.id,
      'envoyee',
    );

    await expect(
      ecrireSousTenant(bdd.poolApp, t.tenant.id, (client) =>
        client.query("update commande_fournisseur set statut = 'annulee' where id = $1", [
          commande.id,
        ]),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('contrôle positif : la MÊME transition, motif_annulation renseigné dans le même UPDATE, réussit', async () => {
    const t = garage.tenantA;
    const siteId = t.tenant.sites[0]!.id;
    const commande = await creerCommandeFournisseurPourTest(
      bdd,
      t.tenant,
      siteId,
      fournisseurA.id,
      'brouillon',
    );

    const resultat = await ecrireSousTenant(bdd.poolApp, t.tenant.id, (client) =>
      client.query<{ statut: string; motif_annulation: string | null }>(
        "update commande_fournisseur set statut = 'annulee', motif_annulation = $1 where id = $2 returning statut, motif_annulation",
        ['Motif direct SQL de contrôle.', commande.id],
      ),
    );
    expect(resultat.rows[0]).toEqual({
      statut: 'annulee',
      motif_annulation: 'Motif direct SQL de contrôle.',
    });
  });

  it('une commande annulee dont on tente ensuite de repasser motif_annulation à null (même transition) est refusée par la même contrainte', async () => {
    const t = garage.tenantA;
    const siteId = t.tenant.sites[0]!.id;
    const commande = await creerCommandeFournisseurPourTest(
      bdd,
      t.tenant,
      siteId,
      fournisseurA.id,
      'brouillon',
    );
    await ecrireSousTenant(bdd.poolApp, t.tenant.id, (client) =>
      client.query(
        "update commande_fournisseur set statut = 'annulee', motif_annulation = $1 where id = $2",
        ['Motif initial.', commande.id],
      ),
    );

    await expect(
      ecrireSousTenant(bdd.poolApp, t.tenant.id, (client) =>
        client.query('update commande_fournisseur set motif_annulation = null where id = $1', [
          commande.id,
        ]),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

// -------------------------------------------------------------------------------------------
// 3. Isolation tenant — ni annuler ni lire la commande d'un autre tenant
// -------------------------------------------------------------------------------------------

describe("isolation tenant — annulation et lecture d'une commande fournisseur d'un autre tenant", () => {
  it('POST /commandes-fournisseur/{id}/annuler sur une commande de tenant B, authentifié tenant A, rend 404 RESSOURCE_INTROUVABLE — jamais 403', async () => {
    const siteIdB = garage.tenantB.tenant.sites[0]!.id;
    const commandeB = await creerCommandeFournisseurPourTest(
      bdd,
      garage.tenantB.tenant,
      siteIdB,
      fournisseurB.id,
      'brouillon',
    );
    const cookieA = await cookieMagasinier(garage.tenantA);

    const reponse = await ctx.requete
      .post(`/api/v1/commandes-fournisseur/${commandeB.id}/annuler`)
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .set('Cookie', cookieA)
      .send({ motif: 'Tentative illégitime depuis tenant A.' });

    expect(reponse.status).toBe(404);
    expect((reponse.body as { code?: string }).code).toBe('RESSOURCE_INTROUVABLE');

    // La commande de B n'a RÉELLEMENT pas bougé : ni le statut, ni le motif — relu sous SON tenant.
    const relu = await requeteSousTenant<{ statut: string; motif_annulation: string | null }>(
      bdd.poolApp,
      garage.tenantB.tenant.id,
      'select statut, motif_annulation from commande_fournisseur where id = $1',
      [commandeB.id],
    );
    expect(relu[0]?.statut).toBe('brouillon');
    expect(relu[0]?.motif_annulation).toBeNull();
  });

  it('GET /commandes-fournisseur/{id} sur une commande DÉJÀ annulée (avec motif) de tenant B rend 404 sous tenant A — le motif ne fuite jamais', async () => {
    const siteIdB = garage.tenantB.tenant.sites[0]!.id;
    const commandeB = await creerCommandeFournisseurPourTest(
      bdd,
      garage.tenantB.tenant,
      siteIdB,
      fournisseurB.id,
      'brouillon',
    );
    const cookieB = await cookieMagasinier(garage.tenantB);
    const motifConfidentiel = 'Litige commercial confidentiel avec ce fournisseur.';
    const annulation = await ctx.requete
      .post(`/api/v1/commandes-fournisseur/${commandeB.id}/annuler`)
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .set('Cookie', cookieB)
      .send({ motif: motifConfidentiel });
    expect(annulation.status, JSON.stringify(annulation.body)).toBeLessThan(300);

    const cookieA = await cookieMagasinier(garage.tenantA);
    const reponse = await ctx.requete
      .get(`/api/v1/commandes-fournisseur/${commandeB.id}`)
      .set('Cookie', cookieA);

    expect(reponse.status).toBe(404);
    expect((reponse.body as { code?: string }).code).toBe('RESSOURCE_INTROUVABLE');
    expect(JSON.stringify(reponse.body)).not.toContain(motifConfidentiel);
  });

  it("à l'inverse, GET sur SA PROPRE commande annulée rend bien 200 avec le motif — contrôle positif indispensable", async () => {
    const siteIdA = garage.tenantA.tenant.sites[0]!.id;
    const commandeA = await creerCommandeFournisseurPourTest(
      bdd,
      garage.tenantA.tenant,
      siteIdA,
      fournisseurA.id,
      'brouillon',
    );
    const cookieA = await cookieMagasinier(garage.tenantA);
    const motif = 'Motif légitime, propre tenant.';
    const annulation = await ctx.requete
      .post(`/api/v1/commandes-fournisseur/${commandeA.id}/annuler`)
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .set('Cookie', cookieA)
      .send({ motif });
    expect(annulation.status, JSON.stringify(annulation.body)).toBeLessThan(300);

    const reponse = await ctx.requete
      .get(`/api/v1/commandes-fournisseur/${commandeA.id}`)
      .set('Cookie', cookieA);
    expect(reponse.status).toBe(200);
    const corps = reponse.body as { statut: string; motifAnnulation: string | null };
    expect(corps.statut).toBe('annulee');
    expect(corps.motifAnnulation).toBe(motif);
  });

  it('un UUID syntaxiquement valide mais inexistant partout rend le MÊME 404 que la commande de tenant B — la réponse ne distingue jamais les deux cas', async () => {
    const cookieA = await cookieMagasinier(garage.tenantA);
    const reponse = await ctx.requete
      .get(`/api/v1/commandes-fournisseur/${randomUUID()}`)
      .set('Cookie', cookieA);
    expect(reponse.status).toBe(404);
    expect((reponse.body as { code?: string }).code).toBe('RESSOURCE_INTROUVABLE');
  });

  it("SQL brut : un UPDATE ciblant statut/motif_annulation d'une commande de tenant B, sous le contexte A, n'affecte AUCUNE ligne (RLS, pas une erreur trompeuse)", async () => {
    const siteIdB = garage.tenantB.tenant.sites[0]!.id;
    const commandeB = await creerCommandeFournisseurPourTest(
      bdd,
      garage.tenantB.tenant,
      siteIdB,
      fournisseurB.id,
      'brouillon',
    );

    const lignesAffectees = await requeteSousTenant(
      bdd.poolApp,
      garage.tenantA.tenant.id,
      "update commande_fournisseur set statut = 'annulee', motif_annulation = 'Intrus' where id = $1 returning id",
      [commandeB.id],
    );
    expect(lignesAffectees).toHaveLength(0);

    const relu = await requeteSousTenant<{ statut: string; motif_annulation: string | null }>(
      bdd.poolApp,
      garage.tenantB.tenant.id,
      'select statut, motif_annulation from commande_fournisseur where id = $1',
      [commandeB.id],
    );
    expect(relu[0]?.statut).toBe('brouillon');
    expect(relu[0]?.motif_annulation).toBeNull();
  });
});
