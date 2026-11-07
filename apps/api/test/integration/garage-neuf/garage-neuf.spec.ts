/**
 * Un garage créé par `creer-garage` doit servir dès le premier jour — vraie base éphémère, vraie
 * app Nest, aucune donnée de démonstration :
 *  - paramètres atelier / site, taux horaire « ATELIER » et motifs de rendez-vous existent ;
 *  - `GET /parametres-atelier` et `GET /sites/{id}/parametres-atelier` répondent 200 (plus de 404),
 *    y compris pour un tenant créé SANS ces lignes (garage installé en 0.1.0) ;
 *  - les motifs se créent / se désactivent par l'API, un motif désactivé ne se choisit plus ;
 *  - le n° TVA se saisit (IDE validé) ;
 *  - une facture payable au comptoir s'émet SANS bloc créancier, avec l'avertissement FACTURE_SANS_QR ;
 *  - la migration 0079 rattrape un tenant existant, sans doublon à la seconde exécution.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { hash } from '@node-rs/argon2';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EN_TETE_IDEMPOTENCE } from '@dfa/shared';

import { creerGarage } from '../../../src/cli/creer-garage.service';
import { MOTIFS_RENDEZ_VOUS_PAR_DEFAUT } from '../../../src/parametrage/defauts-garage';
import { demarrerBaseEphemere, type BaseEphemere } from '../../setup/postgres-ephemere';
import {
  creerAppTest,
  demarrerRedisEphemere,
  type AppTest,
  type RedisEphemere,
} from '../../setup/app-test';
import { cookieDeSessionPour } from '../../lot1/isolation-http-aide';

const MOT_DE_PASSE = 'Cheval-Montagne-Brouillard-42';
const MIGRATION_0079 = readFileSync(
  path.resolve(__dirname, '../../../src/db/migrations/0079_garage_neuf_defauts.sql'),
  'utf8',
);

let bdd: BaseEphemere;
let redis: RedisEphemere;
let ctx: AppTest;
let client: Client;
let neuf: Awaited<ReturnType<typeof creerGarage>>;
let cookie: string;

const hacher = (clair: string): Promise<string> => hash(clair, { algorithm: 2 });

function entetes(c: string): Record<string, string> {
  return { Origin: ctx.config.WEB_URL_PUBLIQUE, Cookie: c };
}

async function compter(sql: string, valeurs: unknown[]): Promise<number> {
  const r = await bdd.poolSuperutilisateur.query<{ n: string }>(sql, valeurs);
  return Number(r.rows[0]?.n);
}

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  client = new Client({ connectionString: bdd.migrateur.url });
  await client.connect();
  neuf = await creerGarage(
    client,
    {
      garage: 'Garage Neuf Test',
      email: 'direction@garage-neuf.test',
      motDePasse: MOT_DE_PASSE,
      prenom: 'Dora',
      nom: 'Direction',
    },
    hacher,
  );
  redis = await demarrerRedisEphemere();
  ctx = await creerAppTest(bdd, redis.url);
  cookie = await cookieDeSessionPour(ctx, neuf.email, MOT_DE_PASSE);
}, 240_000);

afterAll(async () => {
  await client?.end();
  await ctx?.fermer();
  await redis?.fermer();
  await bdd?.fermer();
});

describe('après creer-garage', () => {
  it('pose les lignes de départ en base', async () => {
    expect(
      await compter('select count(*) n from parametre_atelier where tenant_id = $1', [
        neuf.tenantId,
      ]),
    ).toBe(1);
    expect(
      await compter('select count(*) n from parametre_site where site_id = $1', [neuf.siteId]),
    ).toBe(1);
    expect(
      await compter(
        "select count(*) n from taux_horaire where tenant_id = $1 and code = 'ATELIER' and montant_centimes = 14000",
        [neuf.tenantId],
      ),
    ).toBe(1);
    expect(
      await compter('select count(*) n from motif_rendez_vous where tenant_id = $1', [
        neuf.tenantId,
      ]),
    ).toBe(MOTIFS_RENDEZ_VOUS_PAR_DEFAUT.length);
  });

  it('le site porte le nom du garage, pas « PRINCIPAL »', async () => {
    const r = await bdd.poolSuperutilisateur.query<{ code: string; nom: string }>(
      'select code, nom from site where id = $1',
      [neuf.siteId],
    );
    expect(r.rows[0]).toEqual({ code: 'GARAGE-NEUF-TEST', nom: 'Garage Neuf Test' });
  });

  it('GET /parametres-atelier et GET /sites/{id}/parametres-atelier : 200', async () => {
    const atelier = await ctx.requete.get('/api/v1/parametres-atelier').set(entetes(cookie));
    expect(atelier.status).toBe(200);
    const site = await ctx.requete
      .get(`/api/v1/sites/${neuf.siteId}/parametres-atelier`)
      .set(entetes(cookie));
    expect(site.status).toBe(200);
  });

  it('GET /motifs-rendez-vous : les huit motifs, tous actifs', async () => {
    const r = await ctx.requete.get('/api/v1/motifs-rendez-vous').set(entetes(cookie));
    expect(r.status).toBe(200);
    const motifs = r.body as Array<{ code: string; actif: boolean }>;
    expect(motifs).toHaveLength(8);
    expect(motifs.every((m) => m.actif)).toBe(true);
  });
});

describe('motifs de rendez-vous : création et désactivation', () => {
  it('crée, refuse le doublon (409), désactive', async () => {
    const creation = await ctx.requete
      .post('/api/v1/motifs-rendez-vous')
      .set(entetes(cookie))
      .send({ code: 'lavage', libelleFr: 'Lavage', dureeDefautMinutes: 30 });
    expect(creation.status).toBe(201);
    expect(creation.body).toMatchObject({ code: 'LAVAGE', actif: true, dureeDefautMinutes: 30 });

    const doublon = await ctx.requete
      .post('/api/v1/motifs-rendez-vous')
      .set(entetes(cookie))
      .send({ code: 'LAVAGE', libelleFr: 'Lavage bis' });
    expect(doublon.status).toBe(409);

    const id = (creation.body as { id: string }).id;
    const desactive = await ctx.requete
      .patch(`/api/v1/motifs-rendez-vous/${id}`)
      .set(entetes(cookie))
      .send({ actif: false });
    expect(desactive.status).toBe(200);
    expect(desactive.body).toMatchObject({ code: 'LAVAGE', actif: false });
  });

  it('PATCH sur un motif inexistant : 404', async () => {
    const r = await ctx.requete
      .patch(`/api/v1/motifs-rendez-vous/${randomUUID()}`)
      .set(entetes(cookie))
      .send({ actif: false });
    expect(r.status).toBe(404);
  });
});

describe('n° TVA', () => {
  it('saisie validée, lecture, effacement', async () => {
    const mauvais = await ctx.requete
      .patch('/api/v1/parametres-entreprise')
      .set(entetes(cookie))
      .send({ numeroTva: 'CHE-116.281.711 TVA' });
    expect(mauvais.status).toBe(400);

    const bon = await ctx.requete
      .patch('/api/v1/parametres-entreprise')
      .set(entetes(cookie))
      .send({ numeroTva: 'CHE-116.281.710 TVA' });
    expect(bon.status).toBe(200);
    expect(bon.body).toEqual({
      raisonSociale: 'Garage Neuf Test',
      assujettiTva: true,
      numeroTva: 'CHE-116.281.710 TVA',
      delaiPaiementJoursDefaut: 30,
    });

    const relu = await ctx.requete.get('/api/v1/parametres-entreprise').set(entetes(cookie));
    expect((relu.body as { numeroTva: string }).numeroTva).toBe('CHE-116.281.710 TVA');

    const efface = await ctx.requete
      .patch('/api/v1/parametres-entreprise')
      .set(entetes(cookie))
      .send({ numeroTva: null });
    expect((efface.body as { numeroTva: string | null }).numeroTva).toBeNull();
  });
});

describe('facture au comptoir sans bloc créancier', () => {
  it('est émise, sans QR, avec l’avertissement FACTURE_SANS_QR', async () => {
    // Un garage neuf est assujetti (défaut) : sa facture exige son n° TVA (`TVA_NUMERO_REQUIS`).
    // Le test précédent l'a effacé ; on le ressaisit, comme le ferait le garagiste.
    const saisie = await ctx.requete
      .patch('/api/v1/parametres-entreprise')
      .set(entetes(cookie))
      .send({ numeroTva: 'CHE-116.281.710 TVA' });
    expect(saisie.status).toBe(200);

    const creationClient = await ctx.requete
      .post('/api/v1/clients')
      .set(entetes(cookie))
      .set(EN_TETE_IDEMPOTENCE, randomUUID())
      .send({ type: 'particulier', nom: 'Dupont', prenom: 'Jean', langueCorrespondance: 'fr' });
    expect(creationClient.status, JSON.stringify(creationClient.body)).toBe(201);
    const clientId = (creationClient.body as { donnees: { id: string } }).donnees.id;

    const brouillon = await ctx.requete
      .post('/api/v1/documents-vente')
      .set(entetes(cookie))
      .set(EN_TETE_IDEMPOTENCE, randomUUID())
      .send({
        typeDocument: 'facture',
        siteId: neuf.siteId,
        clientId,
        devise: 'CHF',
        dateDocument: '2026-11-02',
        lignes: [
          {
            type: 'forfait',
            designation: 'Vidange',
            quantiteMillieme: 1000,
            prixUnitaireTtcCentimes: 21_620,
            tauxTvaPourmille: 81,
            datePrestation: '2026-11-02',
          },
        ],
      });
    expect(brouillon.status, JSON.stringify(brouillon.body)).toBe(201);
    const documentId = (brouillon.body as { donnees: { id: string } }).donnees.id;

    const emission = await ctx.requete
      .post(`/api/v1/documents-vente/${documentId}/emettre`)
      .set(entetes(cookie))
      .set(EN_TETE_IDEMPOTENCE, randomUUID());
    expect(emission.status, JSON.stringify(emission.body)).toBe(200);
    const corps = emission.body as {
      donnees: { statut: string; numero: string; totalTtcCentimes: number; qr: unknown };
      avertissements: Array<{ code: string }>;
    };
    expect(corps.donnees.statut).toBe('emis');
    expect(corps.donnees.totalTtcCentimes).toBe(21_620);
    expect(corps.donnees.qr).toBeNull();
    expect(corps.avertissements.map((a) => a.code)).toEqual(['FACTURE_SANS_QR']);
  });
});

describe('garage installé avant les défauts (migration 0079)', () => {
  it('GET ne répond plus 404 ; la migration est idempotente et ne touche pas l’existant', async () => {
    // Tenant « 0.1.0 » : tenant + site + direction, sans aucune des lignes de départ.
    const tenantId = randomUUID();
    const siteId = randomUUID();
    const utilisateurId = randomUUID();
    await bdd.poolSuperutilisateur.query(
      "insert into tenant (id, slug, raison_sociale) values ($1, 'garage-ancien', 'Garage Ancien')",
      [tenantId],
    );
    await bdd.poolSuperutilisateur.query(
      "insert into site (id, tenant_id, code, nom) values ($1, $2, 'PRINCIPAL', 'Garage Ancien')",
      [siteId, tenantId],
    );
    await bdd.poolSuperutilisateur.query(
      `insert into utilisateur (id, tenant_id, email, mot_de_passe_hash, prenom, nom, langue, role, statut)
       values ($1, $2, 'direction@garage-ancien.test', $3, 'A', 'B', 'fr', 'direction', 'actif')`,
      [utilisateurId, tenantId, await hacher(MOT_DE_PASSE)],
    );
    await bdd.poolSuperutilisateur.query(
      'insert into utilisateur_site (tenant_id, utilisateur_id, site_id) values ($1, $2, $3)',
      [tenantId, utilisateurId, siteId],
    );
    const cookieAncien = await cookieDeSessionPour(
      ctx,
      'direction@garage-ancien.test',
      MOT_DE_PASSE,
    );

    // Sans la ligne, la lecture la crée à la volée au lieu de répondre 404.
    const lecture = await ctx.requete.get('/api/v1/parametres-atelier').set(entetes(cookieAncien));
    expect(lecture.status).toBe(200);
    expect(
      await compter('select count(*) n from parametre_atelier where tenant_id = $1', [tenantId]),
    ).toBe(1);

    // La migration rattrape le reste (site, taux, motifs) et ne duplique rien au second passage.
    await bdd.poolMigrateur.query(MIGRATION_0079);
    await bdd.poolMigrateur.query(MIGRATION_0079);
    const comptes = async (): Promise<number[]> => [
      await compter('select count(*) n from parametre_atelier where tenant_id = $1', [tenantId]),
      await compter('select count(*) n from parametre_site where tenant_id = $1', [tenantId]),
      await compter('select count(*) n from taux_horaire where tenant_id = $1', [tenantId]),
      await compter('select count(*) n from motif_rendez_vous where tenant_id = $1', [tenantId]),
    ];
    expect(await comptes()).toEqual([1, 1, 1, MOTIFS_RENDEZ_VOUS_PAR_DEFAUT.length]);

    // Un tenant qui a déjà son catalogue n'est pas retouché.
    expect(
      await compter('select count(*) n from motif_rendez_vous where tenant_id = $1', [
        neuf.tenantId,
      ]),
    ).toBe(MOTIFS_RENDEZ_VOUS_PAR_DEFAUT.length + 1); // + « LAVAGE » créé plus haut
  });

  it('tenant inconnu : isolation — le site d’un autre garage reste 404', async () => {
    const autre = await ctx.requete
      .get(`/api/v1/sites/${randomUUID()}/parametres-atelier`)
      .set(entetes(cookie));
    expect(autre.status).toBe(404);
  });
});
