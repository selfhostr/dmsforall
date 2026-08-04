/**
 * Non-régression du filtre `?statut=` de `GET /api/v1/vehicules` (module véhicules, lot 1).
 *
 * Bug reproduit en HTTP réel avant correctif : `GET /api/v1/vehicules?statut=actif&statut=archive`
 * rendait un 500. Cause : `service-vehicule.ts` (`executerListeVehicules`) construisait
 * `sql\`v.statut = any(${filtres.statut})\`` — Drizzle interpole un tableau JS directement dans un
 * `sql\`\`` comme une LISTE DE PARAMÈTRES SQL, pas comme un tableau. `any((...))` devient alors un
 * constructeur d'enregistrement, que Postgres rejette. Seul un test qui exécute RÉELLEMENT la
 * requête contre une vraie base peut attraper ceci : le SQL produit est syntaxiquement valide côté
 * TypeScript (Drizzle ne construit sa chaîne qu'à l'exécution), un test unitaire qui mocke la
 * transaction ne verrait jamais l'échec. Voir `apps/api/src/vehicules/service-vehicule.ts`.
 *
 * Le correctif adopte le même motif déjà en place dans `recherche/service-recherche.ts`
 * (`v.id = any(${sql.param(vehiculeIds)}::uuid[])`) : `sql.param(...)` + cast explicite vers le
 * type tableau de l'énumération Postgres `statut_vehicule`, plutôt que `inArray` de Drizzle (la
 * requête entière est un `sql\`\`` brut exécuté via `tx.execute`, pas un query builder Drizzle —
 * `inArray` attend une vraie `Column`, absente ici, l'aurait rendu incohérent avec le reste du
 * fichier, qui alias déjà toutes ses tables en SQL littéral `v.`/`pc.`/`ne.`).
 *
 * Deux angles, tous deux nécessaires :
 *   1. HTTP bout en bout, DEUX statuts (`?statut=actif&statut=archive`) — reproduction EXACTE du
 *      bug mesuré. Express 5 (ce dépôt) transforme nativement une clé de query répétée en tableau
 *      avec son parseur par défaut (`querystring`, mode "simple" depuis Express 5 — vérifié :
 *      `querystring.parse('statut=actif&statut=archive')` → `{ statut: ['actif', 'archive'] }`),
 *      donc ce scénario n'a besoin d'aucun autre correctif pour arriver jusqu'au filtre.
 *   2. `ServiceVehicule.lister` appelé DIRECTEMENT (sans HTTP), tableau à UN SEUL élément —
 *      nécessaire pour prouver que le correctif reste valide à un élément, sans dépendre du
 *      correctif SÉPARÉ et hors périmètre de cette tâche (`packages/shared/src/contrats`) qui doit
 *      transformer une valeur `statut` répétée une seule fois en tableau avant validation zod.
 *      Avec le parseur "simple" d'Express 5, `?statut=archive` (une occurrence) arrive côté serveur
 *      comme une chaîne nue, pas un tableau (vérifié : `querystring.parse('statut=archive')` →
 *      `{ statut: 'archive' }`) — et la notation `?statut[]=archive` n'aide pas non plus : ce
 *      parseur ne comprend pas la notation crochet (`{ 'statut[]': 'archive' }`, PAS
 *      `{ statut: ['archive'] }`). Aucune requête HTTP ne peut donc, aujourd'hui, exercer le
 *      chemin SQL à un élément sans dépendre de l'autre correctif — d'où l'appel direct au service,
 *      qui reste un test D'INTÉGRATION à part entière : vraie base Postgres, vraie transaction
 *      `AccesBase.enTenant`, même fonction `executerListeVehicules` que la route HTTP.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demarrerBaseEphemere, type BaseEphemere } from '../setup/postgres-ephemere';
import { semerGarageDemoLot1, type GarageDemoLot1Fixture } from './fixtures/garage-demo-lot1';
import {
  creerAccesBaseTest,
  creerAppTest,
  demarrerRedisEphemere,
  type AppTest,
  type RedisEphemere,
} from '../setup/app-test';
import { cookieDeSessionPour } from './isolation-http-aide';
import { ServiceVehicule } from '../../src/vehicules/service-vehicule';
import { Horloge } from '../../src/common/horloge';

let bdd: BaseEphemere;
let garage: GarageDemoLot1Fixture;
let redis: RedisEphemere;
let ctx: AppTest;

/** Un des 3 véhicules de tenantA, archivé via le VRAI endpoint métier (`vehicule.archiver`,
 *  RM-31) — pas une écriture SQL directe : ce fichier veut un tenant avec au moins un statut
 *  `actif` ET un statut `archive`, obtenu par le même chemin qu'un garagiste réel emprunterait.
 *  `receptionnaire` porte `vehicule.archiver` (matrice-droits.ts, INFERE_VEHICULE_GESTION). */
let vehiculeArchiveId: string;

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  garage = await semerGarageDemoLot1(bdd);
  redis = await demarrerRedisEphemere();
  ctx = await creerAppTest(bdd, redis.url);

  const receptionnaire = garage.tenantA.utilisateursParRole.receptionnaire;
  const cookieReceptionnaire = await cookieDeSessionPour(
    ctx,
    receptionnaire.email,
    receptionnaire.motDePasseClair,
  );

  vehiculeArchiveId = garage.tenantA.vehicules[0]!.id;
  const reponseArchivage = await ctx.requete
    .post(`/api/v1/vehicules/${vehiculeArchiveId}/archiver`)
    .set('Cookie', cookieReceptionnaire)
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
    .send({
      motifArchivage: 'doublon',
      motif: 'Fiche en double, conservée pour test de filtre statut.',
    });
  if (reponseArchivage.status !== 201) {
    throw new Error(
      `archivage de fixture échoué (${String(reponseArchivage.status)}) : ${JSON.stringify(reponseArchivage.body)}`,
    );
  }
}, 180_000);

afterAll(async () => {
  await ctx?.fermer();
  await redis?.fermer();
  await bdd?.fermer();
});

describe('GET /api/v1/vehicules?statut= — HTTP bout en bout, DEUX statuts', () => {
  it('?statut=actif&statut=archive : 200, jamais 500 — reproduction exacte du bug mesuré', async () => {
    const admin = garage.tenantA.utilisateursParRole.admin;
    const cookie = await cookieDeSessionPour(ctx, admin.email, admin.motDePasseClair);

    const reponse = await ctx.requete
      .get('/api/v1/vehicules')
      .query({ statut: ['actif', 'archive'], limite: 200 })
      .set('Cookie', cookie);

    expect(reponse.status, JSON.stringify(reponse.body)).toBe(200);

    const donnees = reponse.body.donnees as Array<{ id: string }>;
    const idsRendus = donnees.map((v) => v.id);

    // Les 3 véhicules de tenantA (1 archivé + 2 actifs) sont tous présents — aucun n'a été
    // silencieusement filtré par une clause `any(...)` mal construite.
    for (const v of garage.tenantA.vehicules) {
      expect(idsRendus, `véhicule ${v.id} (${v.marque} ${v.modele}) manquant de la page`).toContain(
        v.id,
      );
    }

    // Isolation : aucun véhicule de tenantB ne fuite dans la réponse de tenantA.
    for (const v of garage.tenantB.vehicules) {
      expect(
        idsRendus,
        `véhicule ${v.id} de tenantB ne doit jamais apparaître sous tenantA`,
      ).not.toContain(v.id);
    }
  });
});

describe('ServiceVehicule.lister — appel direct, tableau `statut` à UN SEUL élément, vraie base Postgres', () => {
  it("statut: ['archive'] ne rend QUE le véhicule archivé", async () => {
    const { accesBase, fermer } = await creerAccesBaseTest(bdd, redis.url);
    try {
      const service = new ServiceVehicule(accesBase, new Horloge());
      const page = await service.lister(
        { tenantId: garage.tenantA.tenant.id, utilisateurId: null, requeteId: null },
        { statut: ['archive'], tri: 'creeLe:desc' },
        { limite: 200 },
      );

      const idsRendus = page.donnees.map((v) => v.id);
      expect(idsRendus).toEqual([vehiculeArchiveId]);
    } finally {
      await fermer();
    }
  });

  it("statut: ['actif'] exclut le véhicule archivé — le filtre discrimine dans les deux sens, pas seulement « non vide »", async () => {
    const { accesBase, fermer } = await creerAccesBaseTest(bdd, redis.url);
    try {
      const service = new ServiceVehicule(accesBase, new Horloge());
      const page = await service.lister(
        { tenantId: garage.tenantA.tenant.id, utilisateurId: null, requeteId: null },
        { statut: ['actif'], tri: 'creeLe:desc' },
        { limite: 200 },
      );

      const idsRendus = page.donnees.map((v) => v.id);
      const idsActifsAttendus = garage.tenantA.vehicules
        .map((v) => v.id)
        .filter((id) => id !== vehiculeArchiveId);

      expect(idsRendus, 'le véhicule archivé ne doit pas apparaître').not.toContain(
        vehiculeArchiveId,
      );
      expect(new Set(idsRendus)).toEqual(new Set(idsActifsAttendus));
    } finally {
      await fermer();
    }
  });
});
