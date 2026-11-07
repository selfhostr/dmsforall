/**
 * Véhicules de courtoisie — isolation tenant (RLS réel + HTTP), anti-chevauchement et cycle d'un
 * prêt, sur vraie Postgres éphémère. Périmètre d'écriture : `apps/api/test/**`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  demarrerBaseEphemere,
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
import { construireCookiePour } from '../relances/fixtures-relances';

let bdd: BaseEphemere;
let garage: GarageDemoLot1Fixture;
let redis: RedisEphemere;
let ctx: AppTest;
let cookiePour: ReturnType<typeof construireCookiePour>;

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  garage = await semerGarageDemoLot1(bdd);
  redis = await demarrerRedisEphemere();
  ctx = await creerAppTest(bdd, redis.url);
  cookiePour = construireCookiePour(ctx);
}, 180_000);

afterAll(async () => {
  await ctx?.fermer();
  await redis?.fermer();
  await bdd?.fermer();
});

function appel(methode: 'get' | 'post' | 'patch', chemin: string, cookie: string) {
  return ctx.requete[methode](`/api/v1${chemin}`)
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
    .set('Cookie', cookie);
}

const DEBUT = '2030-03-12T07:00:00.000Z';
const FIN = '2030-03-12T17:00:00.000Z';

describe('courtoisie — isolation tenant', () => {
  it('le parc et les prêts du tenant A sont invisibles et inutilisables depuis le tenant B (HTTP puis RLS)', async () => {
    const cookieA = await cookiePour(garage.tenantA, 'direction');
    const cookieB = await cookiePour(garage.tenantB, 'direction');

    const cree = await appel('post', '/courtoisie/vehicules', cookieA).send({
      designation: 'VW Polo',
      plaque: 'VS 111 222',
    });
    expect(cree.status).toBe(201);
    const vehiculeId = cree.body.id as string;

    const pret = await appel('post', '/courtoisie/prets', cookieA).send({
      vehiculeCourtoisieId: vehiculeId,
      clientId: garage.tenantA.clients[0]!.id,
      debutLe: DEBUT,
      finPrevueLe: FIN,
    });
    expect(pret.status).toBe(201);

    // Liste de B : vide (jamais le véhicule de A).
    const listeB = await appel('get', '/courtoisie/vehicules', cookieB);
    expect(listeB.status).toBe(200);
    expect(listeB.body.vehicules).toEqual([]);

    // B ne peut ni prêter le véhicule de A, ni rendre/annuler son prêt, ni le modifier : 404.
    const pretB = await appel('post', '/courtoisie/prets', cookieB).send({
      vehiculeCourtoisieId: vehiculeId,
      clientId: garage.tenantB.clients[0]!.id,
      debutLe: DEBUT,
      finPrevueLe: FIN,
    });
    expect(pretB.status).toBe(404);
    expect(
      (await appel('post', `/courtoisie/prets/${pret.body.id}/rendre`, cookieB).send({})).status,
    ).toBe(404);
    expect(
      (
        await appel('patch', `/courtoisie/vehicules/${vehiculeId}`, cookieB).send({
          etat: 'hors_service',
        })
      ).status,
    ).toBe(404);
    const pretsB = await appel(
      'get',
      `/courtoisie/prets?clientId=${garage.tenantA.clients[0]!.id}`,
      cookieB,
    );
    expect(pretsB.body.donnees).toEqual([]);

    // Un client du tenant A ne peut pas être prêté par le tenant B non plus (client inconnu de B).
    // RLS : lecture directe sous B, id exact connu.
    const sousB = await requeteSousTenant(
      bdd.poolApp,
      garage.tenantB.tenant.id,
      'select id from vehicule_courtoisie where id = $1',
      [vehiculeId],
    );
    expect(sousB).toEqual([]);
    const sousA = await requeteSousTenant(
      bdd.poolApp,
      garage.tenantA.tenant.id,
      'select id from vehicule_courtoisie where id = $1',
      [vehiculeId],
    );
    expect(sousA).toHaveLength(1);
  });
});

describe('courtoisie — disponibilité, chevauchement, retour', () => {
  it('une voiture prêtée sur la période est occupée, un chevauchement est refusé (409), le retour la libère', async () => {
    const cookie = await cookiePour(garage.tenantA, 'receptionnaire');
    const cookieDir = await cookiePour(garage.tenantA, 'direction');
    const clientId = garage.tenantA.clients[1]!.id;

    const v = await appel('post', '/courtoisie/vehicules', cookieDir).send({
      designation: 'Seat Ibiza',
    });
    const vehiculeId = v.body.id as string;
    const periode = 'du=2031-05-01T00:00:00.000Z&au=2031-05-02T00:00:00.000Z';

    const avant = await appel('get', `/courtoisie/vehicules?${periode}`, cookie);
    const ligneAvant = (avant.body.vehicules as { id: string; disponibilite: string }[]).find(
      (x) => x.id === vehiculeId,
    );
    expect(ligneAvant?.disponibilite).toBe('libre');

    const pret = await appel('post', '/courtoisie/prets', cookie).send({
      vehiculeCourtoisieId: vehiculeId,
      clientId,
      debutLe: '2031-05-01T07:00:00.000Z',
      finPrevueLe: '2031-05-01T17:00:00.000Z',
    });
    expect(pret.status).toBe(201);
    expect(pret.body.statut).toBe('reserve'); // début futur

    const pendant = await appel('get', `/courtoisie/vehicules?${periode}`, cookie);
    const ligne = (
      pendant.body.vehicules as {
        id: string;
        disponibilite: string;
        pretSurPeriode: { id: string } | null;
      }[]
    ).find((x) => x.id === vehiculeId);
    expect(ligne?.disponibilite).toBe('occupe');
    expect(ligne?.pretSurPeriode?.id).toBe(pret.body.id);

    // Autre jour : libre.
    const autreJour = await appel(
      'get',
      '/courtoisie/vehicules?du=2031-05-03T00:00:00.000Z&au=2031-05-04T00:00:00.000Z',
      cookie,
    );
    expect(
      (autreJour.body.vehicules as { id: string; disponibilite: string }[]).find(
        (x) => x.id === vehiculeId,
      )?.disponibilite,
    ).toBe('libre');

    const chevauche = await appel('post', '/courtoisie/prets', cookie).send({
      vehiculeCourtoisieId: vehiculeId,
      clientId,
      debutLe: '2031-05-01T12:00:00.000Z',
      finPrevueLe: '2031-05-01T20:00:00.000Z',
    });
    expect(chevauche.status).toBe(409);

    // Rendre un prêt seulement réservé : refusé ; remettre puis rendre : accepté.
    expect(
      (await appel('post', `/courtoisie/prets/${pret.body.id}/rendre`, cookie).send({})).status,
    ).toBe(409);
    expect(
      (
        await appel('post', `/courtoisie/prets/${pret.body.id}/remettre`, cookie).send({
          kmDepart: 1000,
        })
      ).status,
    ).toBe(200);
    const kmBas = await appel('post', `/courtoisie/prets/${pret.body.id}/rendre`, cookie).send({
      kmRetour: 900,
    });
    expect(kmBas.status).toBe(400);
    const rendu = await appel('post', `/courtoisie/prets/${pret.body.id}/rendre`, cookie).send({
      kmRetour: 1042,
    });
    expect(rendu.status).toBe(200);
    expect(rendu.body.statut).toBe('retourne');

    const apres = await appel('get', `/courtoisie/vehicules?${periode}`, cookie);
    expect(
      (apres.body.vehicules as { id: string; disponibilite: string }[]).find(
        (x) => x.id === vehiculeId,
      )?.disponibilite,
    ).toBe('libre');

    // Filtre : un client inexistant donne une liste vide (jamais ignoré).
    const vide = await appel(
      'get',
      '/courtoisie/prets?clientId=00000000-0000-4000-8000-000000000099',
      cookie,
    );
    expect(vide.body.donnees).toEqual([]);
  });

  it('matrice : un technicien lit le parc mais ne prête pas ; un vendeur n’y a pas accès', async () => {
    const cookieTech = await cookiePour(garage.tenantA, 'technicien');
    const cookieVendeur = await cookiePour(garage.tenantA, 'vendeur');
    expect((await appel('get', '/courtoisie/vehicules', cookieTech)).status).toBe(200);
    expect(
      (
        await appel('post', '/courtoisie/prets', cookieTech).send({
          vehiculeCourtoisieId: '00000000-0000-4000-8000-000000000001',
          clientId: '00000000-0000-4000-8000-000000000002',
          debutLe: DEBUT,
          finPrevueLe: FIN,
        })
      ).status,
    ).toBe(403);
    expect((await appel('get', '/courtoisie/vehicules', cookieVendeur)).status).toBe(403);
  });
});
