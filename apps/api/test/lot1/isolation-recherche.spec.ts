/**
 * Isolation inter-tenant — module RECHERCHE (`GET /api/v1/recherche`), en exécution, sur vraie
 * base Postgres éphémère.
 *
 * `ServiceRecherche` (apps/api/src/recherche/service-recherche.ts) n'a pas de table à lui : il
 * agrège des requêtes sur `vehicule`/`client`/`ordre_reparation`, déjà sous RLS. Ce fichier ne
 * teste donc PAS une politique RLS de plus (les modules `clients` et `atelier` sont hors périmètre
 * de cette tâche — leurs contrôleurs sont en cours d'écriture), mais la propriété qui compte
 * réellement pour ce module : la PROJECTION qu'il expose au comptoir ne fuite jamais vers un autre
 * tenant, y compris quand la correspondance est exacte et non ambiguë (un VIN complet, une plaque
 * exacte). Portée volontairement restreinte à `types=vehicule` (la seule table dont ce fichier
 * contrôle par ailleurs la fixture et le cycle de vie — voir `isolation-vehicules.spec.ts`) : pas
 * de couplage avec les données clients/OR, dont la forme peut encore changer.
 *
 * `ServiceRecherche.rechercher` rescope explicitement par `tenant_id` EN PLUS du RLS posé par
 * `enTenant()` (défense en profondeur documentée dans le service lui-même) — une régression sur
 * l'UN des deux mécanismes doit donc être rattrapée par l'autre. Les tests ci-dessous n'ont aucun
 * moyen de distinguer laquelle des deux couches a été retirée : c'est le comportement observable
 * de bout en bout (la seule chose qui compte pour un attaquant, ou pour un garagiste qui ne doit
 * jamais voir les données d'un confrère) qui est vérifié ici.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demarrerBaseEphemere, type BaseEphemere } from '../setup/postgres-ephemere';
import { semerGarageDemoLot1, type GarageDemoLot1Fixture } from './fixtures/garage-demo-lot1';
import { creerAppTest, demarrerRedisEphemere, type AppTest, type RedisEphemere } from '../setup/app-test';
import { cookieDeSessionPour } from './isolation-http-aide';

let bdd: BaseEphemere;
let garage: GarageDemoLot1Fixture;
let redis: RedisEphemere;
let ctx: AppTest;

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  garage = await semerGarageDemoLot1(bdd);
  redis = await demarrerRedisEphemere();
  ctx = await creerAppTest(bdd, redis.url);
}, 180_000);

afterAll(async () => {
  await ctx?.fermer();
  await redis?.fermer();
  await bdd?.fermer();
});

interface CorpsRecherche {
  readonly resultats: ReadonlyArray<{ readonly id: string; readonly type: string }>;
}

async function rechercher(cookie: string, q: string): Promise<{ status: number; body: CorpsRecherche }> {
  const reponse = await ctx.requete
    .get('/api/v1/recherche')
    .query({ q, types: 'vehicule' })
    .set('Cookie', cookie);
  return { status: reponse.status, body: reponse.body as CorpsRecherche };
}

describe("recherche comptoir — un VIN complet et sans ambiguïté d'un véhicule de garage-b reste introuvable sous une session garage-a", () => {
  it("q = VIN complet du véhicule de garage-b, sous une session garage-a : aucun résultat", async () => {
    const admin = garage.tenantA.utilisateursParRole.admin;
    const cookie = await cookieDeSessionPour(ctx, admin.email, admin.motDePasseClair);
    const vinDeB = garage.tenantB.vehicules[0]!.vin;

    const { status, body } = await rechercher(cookie, vinDeB);

    expect(status).toBe(200);
    expect(body.resultats).toHaveLength(0);
  });

  it("contrôle positif : LE MÊME VIN, sous une session garage-b, trouve bien le véhicule — sinon le test ci-dessus ne prouverait rien (une recherche qui ne trouve jamais rien serait vide de sens)", async () => {
    const adminB = garage.tenantB.utilisateursParRole.admin;
    const cookie = await cookieDeSessionPour(ctx, adminB.email, adminB.motDePasseClair);
    const vehiculeB = garage.tenantB.vehicules[0]!;

    const { status, body } = await rechercher(cookie, vehiculeB.vin);

    expect(status).toBe(200);
    expect(body.resultats.map((r) => r.id)).toContain(vehiculeB.id);
  });

  it("contrôle positif : le VIN du PROPRE véhicule de garage-a se trouve bien sous sa propre session", async () => {
    const admin = garage.tenantA.utilisateursParRole.admin;
    const cookie = await cookieDeSessionPour(ctx, admin.email, admin.motDePasseClair);
    const vehiculeA = garage.tenantA.vehicules[0]!;

    const { status, body } = await rechercher(cookie, vehiculeA.vin);

    expect(status).toBe(200);
    expect(body.resultats.map((r) => r.id)).toContain(vehiculeA.id);
  });
});

describe('recherche comptoir — une plaque exacte de garage-b reste introuvable sous une session garage-a', () => {
  it('q = plaque courante du véhicule de garage-b, sous une session garage-a : aucun résultat', async () => {
    const admin = garage.tenantA.utilisateursParRole.admin;
    const cookie = await cookieDeSessionPour(ctx, admin.email, admin.motDePasseClair);
    const plaqueDeB = garage.tenantB.vehicules[0]!.plaqueCourante;

    const { status, body } = await rechercher(cookie, plaqueDeB);

    expect(status).toBe(200);
    expect(body.resultats).toHaveLength(0);
  });

  it('contrôle positif : LA MÊME plaque, sous une session garage-b, trouve bien le véhicule', async () => {
    const adminB = garage.tenantB.utilisateursParRole.admin;
    const cookie = await cookieDeSessionPour(ctx, adminB.email, adminB.motDePasseClair);
    const vehiculeB = garage.tenantB.vehicules[0]!;

    const { status, body } = await rechercher(cookie, vehiculeB.plaqueCourante);

    expect(status).toBe(200);
    expect(body.resultats.map((r) => r.id)).toContain(vehiculeB.id);
  });
});
