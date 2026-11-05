/**
 * Intégration HTTP réelle du module Pneus (hangar à dépôt de pneus, `docs/specification-parc-et-
 * hangar-pneus.md`, RPP-01 → RPP-08). Motivation directe de ce fichier : `GET
 * /api/v1/sites/{siteId}/hangar-pneus` répond **500** en conditions réelles alors que les 17 tests
 * unitaires de `service-depot-pneus.spec.ts` passent tous — ceux-ci simulent la transaction avec
 * une fausse `tx` qui rend des données déjà propres (ex. `triValeur: l.dernierMouvementLe.
 * toISOString()`, un `Date` JS reformaté à la main en ISO-8601 avec millisecondes toujours
 * présentes), là où PostgreSQL, via `tx.execute(sql\`...\`)`, rend ce qu'il rend réellement — le
 * texte natif d'un cast `::text` sur un `timestamptz` (`AAAA-MM-JJ HH:MI:SS[.ffffff]+TZ`, la
 * fraction OMISE quand elle vaut zéro, jamais un `Z` final) pour les colonnes de tri
 * (`pneus/pagination-triee.ts`), ou un objet `Date` natif du pilote `pg` pour les colonnes non
 * castées. C'est exactement la famille de piège déjà mesurée deux fois dans ce dépôt (voir
 * `common/pagination/valeur-temporelle.ts` — perte de microseconde, pagination qui saute des
 * lignes en silence) : invisible à une fausse transaction, fatal contre une vraie base.
 *
 * Aucun mock ici : vraie base Postgres éphémère (testcontainers, `demarrerBaseEphemere`), vraie
 * app NestJS (`creerAppTest`), vraies requêtes HTTP via `supertest` — exactement le chemin qui
 * casse en production. Périmètre d'écriture : `apps/api/test/**` uniquement (CONTRIBUTING.md, brief de
 * cette tâche) ; `apps/api/src/pneus/**` est corrigé par un autre lot en parallèle et n'est ni
 * lu comme source de vérité du comportement attendu, ni modifié ici — ce fichier PROUVE le
 * comportement réel de la route, dans un sens ou dans l'autre, et rougit tant que le défaut existe.
 *
 * Allocation des véhicules/sites de `garage.tenantA` pour ne JAMAIS heurter
 * `depot_pneus_actif_uk` (RPP-02, unique sur `(tenant_id, vehicule_id, saison)` parmi les statuts
 * `en_depot`/`monte`) entre deux describe() de ce fichier, chacun devant rester indépendant :
 *   - site LAU (`sites[0]`), véhicule 0 : cycle complet + refus métier (RPP-02/RPP-05).
 *   - site LAU (`sites[0]`), véhicule 1 : chaîne de permissions (creer → changer-saison → sortir).
 *   - site REN (`sites[1]`), véhicule 2 : hangar peuplé + pagination + piège des dates (jamais
 *     touché par les describe() ci-dessus, pour que les comptages de pagination soient exacts).
 *   - tenant B entier : hangar vide (aucun autre describe() de ce fichier ne touche tenant B).
 * Un appel REJETÉ par `GardeDroit` (403, avant que le handler ne s'exécute) ne consomme JAMAIS ce
 * budget : aucune ligne n'est insérée avant le refus, donc les tentatives 403 réutilisent librement
 * n'importe quel véhicule/saison déjà alloué ci-dessus sans créer de conflit.
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demarrerBaseEphemere, type BaseEphemere } from '../../setup/postgres-ephemere';
import {
  creerAppTest,
  demarrerRedisEphemere,
  type AppTest,
  type RedisEphemere,
} from '../../setup/app-test';
import { cookieDeSessionPour } from '../../lot1/isolation-http-aide';
import {
  semerGarageDemoLot1,
  type GarageDemoLot1Fixture,
} from '../../lot1/fixtures/garage-demo-lot1';
import { creerDepotPneusPourTest, semerDepotsPneusMemeInstant } from '../fixtures/garage-demo-lot2';

let bdd: BaseEphemere;
let garage: GarageDemoLot1Fixture;
let redis: RedisEphemere;
let ctx: AppTest;

let cookieReceptionnaire: string;
let cookieTechnicien: string;
let cookieMagasinier: string;
let cookieVendeur: string;
let cookieComptable: string;

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  garage = await semerGarageDemoLot1(bdd);
  redis = await demarrerRedisEphemere();
  ctx = await creerAppTest(bdd, redis.url);

  const roles = garage.tenantA.utilisateursParRole;
  [cookieReceptionnaire, cookieTechnicien, cookieMagasinier, cookieVendeur, cookieComptable] =
    await Promise.all([
      cookieDeSessionPour(ctx, roles.receptionnaire.email, roles.receptionnaire.motDePasseClair),
      cookieDeSessionPour(ctx, roles.technicien.email, roles.technicien.motDePasseClair),
      cookieDeSessionPour(ctx, roles.magasinier.email, roles.magasinier.motDePasseClair),
      cookieDeSessionPour(ctx, roles.vendeur.email, roles.vendeur.motDePasseClair),
      cookieDeSessionPour(ctx, roles.comptable.email, roles.comptable.motDePasseClair),
    ]);
}, 180_000);

afterAll(async () => {
  await ctx?.fermer();
  await redis?.fermer();
  await bdd?.fermer();
});

async function creerDepotViaApi(
  cookie: string,
  vehiculeId: string,
  corps: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const reponse = await ctx.requete
    .post(`/api/v1/vehicules/${vehiculeId}/depots-pneus`)
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
    .set('Cookie', cookie)
    .set('Idempotency-Key', randomUUID())
    .send(corps);
  return { status: reponse.status, body: reponse.body as Record<string, unknown> };
}

// -------------------------------------------------------------------------------------------
// 1. GET hangar — cas limites : c'est CETTE route qui répond 500 en conditions réelles.
// -------------------------------------------------------------------------------------------

describe('GET /sites/{siteId}/hangar-pneus — cas limites de la route en défaut', () => {
  it('un site sans aucun dépôt de pneus répond 200 avec une page vide, jamais 500', async () => {
    const t = garage.tenantB; // tenant B entier : jamais touché par un autre describe() de ce fichier
    const site = t.tenant.sites[0]!.id;
    const cookie = await cookieDeSessionPour(
      ctx,
      t.utilisateursParRole.direction.email,
      t.utilisateursParRole.direction.motDePasseClair,
    );

    const reponse = await ctx.requete
      .get(`/api/v1/sites/${site}/hangar-pneus`)
      .set('Cookie', cookie);

    expect(reponse.status, `réponse brute : ${JSON.stringify(reponse.body)}`).toBe(200);
    expect(reponse.body.donnees).toEqual([]);
    expect(reponse.body.curseurSuivant).toBeNull();
    expect(reponse.body.limite).toBe(50);
  });

  it('un site introuvable pour ce tenant répond 404 RESSOURCE_INTROUVABLE, jamais 500', async () => {
    const reponse = await ctx.requete
      .get(`/api/v1/sites/${randomUUID()}/hangar-pneus`)
      .set('Cookie', cookieReceptionnaire);

    expect(reponse.status, `réponse brute : ${JSON.stringify(reponse.body)}`).toBe(404);
  });

  it('sans session (401), jamais 500 — la garde s’exécute avant tout accès base', async () => {
    const site = garage.tenantA.tenant.sites[0]!.id;
    const reponse = await ctx.requete.get(`/api/v1/sites/${site}/hangar-pneus`);
    expect(reponse.status).toBe(401);
  });
});

// -------------------------------------------------------------------------------------------
// 2. Cycle complet par la vraie API HTTP : entrée → changement de saison → sortie (RPP-01→RPP-05)
// -------------------------------------------------------------------------------------------

describe('cycle complet d’un dépôt de pneus, par la vraie API HTTP', () => {
  it('POST créer (en_depot) → visible au hangar du site → changer-saison (monte) → sortir (sorti, motif tracé)', async () => {
    const site = garage.tenantA.tenant.sites[0]!.id;
    const vehicule = garage.tenantA.vehicules[0]!.id;

    const creation = await creerDepotViaApi(cookieReceptionnaire, vehicule, {
      siteId: site,
      saison: 'ete',
      codeCase: 'LAU-A12',
    });
    expect(creation.status, JSON.stringify(creation.body)).toBe(201);
    expect(creation.body.statut).toBe('en_depot');
    expect(creation.body.saison).toBe('ete');
    expect(creation.body.codeCase).toBe('LAU-A12');
    const depotId = creation.body.id as string;

    // Le jeu fraîchement créé doit apparaître au hangar de SON site — c'est la route qui casse en
    // conditions réelles ; si elle 500, cette assertion échoue ici, pas dans un mock.
    const hangar = await ctx.requete
      .get(`/api/v1/sites/${site}/hangar-pneus`)
      .set('Cookie', cookieReceptionnaire);
    expect(hangar.status, `réponse brute : ${JSON.stringify(hangar.body)}`).toBe(200);
    const lignes = hangar.body.donnees as ReadonlyArray<Record<string, unknown>>;
    const ligneTrouvee = lignes.find((l) => l.id === depotId);
    expect(
      ligneTrouvee,
      `dépôt ${depotId} absent du hangar : ${JSON.stringify(lignes)}`,
    ).toBeDefined();
    expect(ligneTrouvee!.statut).toBe('en_depot');

    // Changement de saison : en_depot → monte (aucun jumeau hiver jamais entré pour ce véhicule).
    // `toBeLessThan(300)`, pas `toBe(200)` : `changerSaison`/`sortir` (`depot-pneus.controller.ts`)
    // ne portent pas de `@HttpCode` explicite → défaut NestJS d'un `@Post` sans décorateur = 201,
    // alors que `@ApiOkResponse` documente 200 en Swagger. Constaté en exécution réelle contre
    // cette vraie base (201 reçu, pas 200) — même ambiguïté déjà documentée pour des routes sœurs
    // du même style, voir `test/lot2/pieces/annulation-commande-fournisseur.spec.ts` (« ni
    // `annuler` ni `envoyer` ne portent de `@HttpCode` explicite »). Ce qui compte ici est prouvé
    // sans ambiguïté par les assertions de CONTENU juste après (statut, motifSortie).
    const saison = await ctx.requete
      .post(`/api/v1/depots-pneus/${depotId}/changer-saison`)
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .set('Cookie', cookieReceptionnaire)
      .send({});
    expect(saison.status, JSON.stringify(saison.body)).toBeLessThan(300);
    expect(saison.body.statut).toBe('monte');

    // Sortie : statut TERMINAL, motif tracé.
    const sortie = await ctx.requete
      .post(`/api/v1/depots-pneus/${depotId}/sortir`)
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .set('Cookie', cookieReceptionnaire)
      .send({ motif: 'rendu_au_client' });
    expect(sortie.status, JSON.stringify(sortie.body)).toBeLessThan(300);
    expect(sortie.body.statut).toBe('sorti');
    expect(sortie.body.motifSortie).toBe('rendu_au_client');

    // Sorti n'est plus considéré comme actif : le hangar par défaut (aucun filtre statut) continue
    // de le lister — RPP-05 : jamais supprimé.
    const hangarApres = await ctx.requete
      .get(`/api/v1/sites/${site}/hangar-pneus`)
      .set('Cookie', cookieReceptionnaire);
    const ligneApres = (hangarApres.body.donnees as ReadonlyArray<Record<string, unknown>>).find(
      (l) => l.id === depotId,
    );
    expect(ligneApres!.statut).toBe('sorti');
  });
});

// -------------------------------------------------------------------------------------------
// 3. Refus attendus — machine à états (RPP-05) et unicité (RPP-02)
// -------------------------------------------------------------------------------------------

describe('refus attendus', () => {
  it('sortir un dépôt DÉJÀ sorti est refusé (409 CONFLIT), jamais un second motif enregistré', async () => {
    const site = garage.tenantA.tenant.sites[0]!.id;
    const vehicule = garage.tenantA.vehicules[0]!.id;

    const creation = await creerDepotViaApi(cookieReceptionnaire, vehicule, {
      siteId: site,
      saison: 'hiver',
    });
    expect(creation.status, JSON.stringify(creation.body)).toBe(201);
    const depotId = creation.body.id as string;

    const premiereSortie = await ctx.requete
      .post(`/api/v1/depots-pneus/${depotId}/sortir`)
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .set('Cookie', cookieReceptionnaire)
      .send({ motif: 'mis_au_rebut' });
    // `toBeLessThan(300)` : même ambiguïté 200/201 documentée au test de cycle complet ci-dessus.
    expect(premiereSortie.status, JSON.stringify(premiereSortie.body)).toBeLessThan(300);

    const secondeSortie = await ctx.requete
      .post(`/api/v1/depots-pneus/${depotId}/sortir`)
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .set('Cookie', cookieReceptionnaire)
      .send({ motif: 'autre' });
    expect(secondeSortie.status, JSON.stringify(secondeSortie.body)).toBe(409);
    expect(secondeSortie.body.code).toBe('CONFLIT');

    // Le motif de la PREMIÈRE sortie reste inchangé — la seconde tentative n'a rien écrasé.
    const relecture = await ctx.requete
      .get(`/api/v1/vehicules/${vehicule}/depots-pneus`)
      .set('Cookie', cookieReceptionnaire);
    const ligne = (relecture.body.donnees as ReadonlyArray<Record<string, unknown>>).find(
      (l) => l.id === depotId,
    );
    expect(ligne!.motifSortie).toBe('mis_au_rebut');
  });

  it('un second jeu actif pour le même véhicule ET la même saison est refusé (409 CONFLIT, RPP-02, depot_pneus_actif_uk)', async () => {
    const site = garage.tenantA.tenant.sites[0]!.id;
    // Véhicule dédié à ce test précis, jamais utilisé ailleurs dans ce describe() : le premier
    // dépôt reste ACTIF (en_depot) après ce test, donc ce véhicule ne doit plus resservir.
    const vehicule = garage.tenantA.vehicules[0]!.id;

    const premier = await creerDepotViaApi(cookieReceptionnaire, vehicule, {
      siteId: site,
      saison: 'ete',
      codeCase: 'RPP-02-premier',
    });
    // Le véhicule 0 / saison été a déjà été "sorti" par le test de cycle complet ci-dessus (describe
    // précédent) : recréer un jeu été actif est donc légitime ici (RPP-02 n'interdit qu'un DEUXIÈME
    // jeu ACTIF simultané, pas un jeu après un autre déjà terminal).
    expect(premier.status, JSON.stringify(premier.body)).toBe(201);

    const second = await creerDepotViaApi(cookieReceptionnaire, vehicule, {
      siteId: site,
      saison: 'ete',
      codeCase: 'RPP-02-second',
    });
    expect(second.status, JSON.stringify(second.body)).toBe(409);
    expect(second.body.code).toBe('CONFLIT');
  });
});

// -------------------------------------------------------------------------------------------
// 4. Matrice rôle × action, par la vraie garde HTTP (`@ExigerDroit` + `GardeDroit`) — un rôle sans
//    droit ne doit RIEN pouvoir, jamais un 500 qui masquerait un refus attendu en erreur serveur.
// -------------------------------------------------------------------------------------------

describe('matrice rôle × action — pneus.depot.{lire,creer,changer_saison,sortir}', () => {
  it('lire (pneus.depot.lire) : comptable — qui n’a AUCUN droit d’écriture — peut consulter le hangar (200)', async () => {
    const site = garage.tenantA.tenant.sites[0]!.id;
    const reponse = await ctx.requete
      .get(`/api/v1/sites/${site}/hangar-pneus`)
      .set('Cookie', cookieComptable);
    expect(reponse.status, JSON.stringify(reponse.body)).toBe(200);
  });

  it('creer (pneus.depot.creer) : vendeur et comptable sont refusés (403 DROIT_INSUFFISANT), aucune ligne insérée', async () => {
    const site = garage.tenantA.tenant.sites[0]!.id;
    const vehicule = garage.tenantA.vehicules[1]!.id;

    for (const cookie of [cookieVendeur, cookieComptable]) {
      const reponse = await creerDepotViaApi(cookie, vehicule, { siteId: site, saison: 'ete' });
      expect(reponse.status, JSON.stringify(reponse.body)).toBe(403);
      expect(reponse.body.code).toBe('DROIT_INSUFFISANT');
    }
  });

  it('chaîne complète sur UN dépôt : technicien crée (201) → vendeur refusé de changer la saison (403) → magasinier change la saison (200) → technicien refusé de sortir (403) → réceptionnaire sort le jeu (200)', async () => {
    const site = garage.tenantA.tenant.sites[0]!.id;
    const vehicule = garage.tenantA.vehicules[1]!.id; // dédié à cette chaîne, aucun autre test n'y touche

    const creation = await creerDepotViaApi(cookieTechnicien, vehicule, {
      siteId: site,
      saison: 'ete',
    });
    expect(creation.status, JSON.stringify(creation.body)).toBe(201);
    const depotId = creation.body.id as string;

    const saisonRefusee = await ctx.requete
      .post(`/api/v1/depots-pneus/${depotId}/changer-saison`)
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .set('Cookie', cookieVendeur)
      .send({});
    expect(saisonRefusee.status, JSON.stringify(saisonRefusee.body)).toBe(403);
    expect(saisonRefusee.body.code).toBe('DROIT_INSUFFISANT');

    const saisonAutorisee = await ctx.requete
      .post(`/api/v1/depots-pneus/${depotId}/changer-saison`)
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .set('Cookie', cookieMagasinier)
      .send({});
    // `toBeLessThan(300)` : même ambiguïté 200/201 documentée au test de cycle complet ci-dessus.
    expect(saisonAutorisee.status, JSON.stringify(saisonAutorisee.body)).toBeLessThan(300);
    expect(saisonAutorisee.body.statut).toBe('monte');

    const sortieRefusee = await ctx.requete
      .post(`/api/v1/depots-pneus/${depotId}/sortir`)
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .set('Cookie', cookieTechnicien)
      .send({ motif: 'rendu_au_client' });
    expect(sortieRefusee.status, JSON.stringify(sortieRefusee.body)).toBe(403);
    expect(sortieRefusee.body.code).toBe('DROIT_INSUFFISANT');

    const sortieAutorisee = await ctx.requete
      .post(`/api/v1/depots-pneus/${depotId}/sortir`)
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .set('Cookie', cookieReceptionnaire)
      .send({ motif: 'rendu_au_client' });
    // `toBeLessThan(300)` : même ambiguïté 200/201 documentée au test de cycle complet ci-dessus.
    expect(sortieAutorisee.status, JSON.stringify(sortieAutorisee.body)).toBeLessThan(300);
    expect(sortieAutorisee.body.statut).toBe('sorti');
  });
});

// -------------------------------------------------------------------------------------------
// 5. Hangar peuplé + pagination sur plusieurs pages + piège des dates (insertion en lot, même
//    milliseconde) — le cœur de la couverture manquante : le seul chemin qui a une chance
//    d'exercer `expressionTriValeur`/`valeurCurseurTimestamptz` contre du VRAI texte PostgreSQL.
// -------------------------------------------------------------------------------------------

describe('GET /sites/{siteId}/hangar-pneus — hangar peuplé, contenu ET pagination sur données réelles', () => {
  it('un dépôt fraîchement créé porte exactement les champs attendus (saison, statut, codeCase, dimension recopiée)', async () => {
    const site = garage.tenantA.tenant.sites[1]!.id; // REN, dédié à ce describe()
    const vehicule = garage.tenantA.vehicules[2]!.id; // dédié à ce describe()

    // Dimension omise : doit être recopiée depuis vehicule.pneusEte/pneusHiver — mais la fixture
    // lot1 ne renseigne aucun des deux (vehicule.pneusEte/pneusHiver restent NULL), donc la
    // dimension attendue ici est explicitement NULL : c'est un contrôle sur le CHEMIN
    // "aucune dimension source, aucune dimension recopiée", pas un test de la recopie elle-même
    // (couverte par l'unitaire `service-depot-pneus.spec.ts`).
    const creation = await creerDepotViaApi(cookieReceptionnaire, vehicule, {
      siteId: site,
      saison: 'ete',
      codeCase: 'REN-B03',
    });
    expect(creation.status, JSON.stringify(creation.body)).toBe(201);
    expect(creation.body.saison).toBe('ete');
    expect(creation.body.statut).toBe('en_depot');
    expect(creation.body.codeCase).toBe('REN-B03');
    expect(creation.body.dimension).toBeNull();

    const hangar = await ctx.requete
      .get(`/api/v1/sites/${site}/hangar-pneus`)
      .query({ saison: 'ete' })
      .set('Cookie', cookieReceptionnaire);
    expect(hangar.status, JSON.stringify(hangar.body)).toBe(200);
    const ligne = (hangar.body.donnees as ReadonlyArray<Record<string, unknown>>).find(
      (l) => l.id === creation.body.id,
    );
    expect(
      ligne,
      'le dépôt créé doit apparaître dans le hangar filtré sur sa propre saison',
    ).toBeDefined();
    expect(ligne!.codeCase).toBe('REN-B03');
  });

  it('pagination par curseur, limite=3, sur 9 lignes dont 6 partagent EXACTEMENT le même dernier_mouvement_le (insertion en lot) : aucune ligne sautée, aucune dupliquée', async () => {
    const site = garage.tenantA.tenant.sites[1]!.id; // REN — même site que le test précédent
    const vehicule = garage.tenantA.vehicules[2]!.id; // même véhicule : les statuts ci-dessous sont
    // choisis pour ne JAMAIS entrer en conflit entre eux ni avec le dépôt "REN-B03" du test
    // précédent (déjà en_depot/ete sur ce même véhicule — l'index unique partiel RPP-02 n'est
    // enfreint que si DEUX lignes actives (en_depot/monte) partagent (véhicule, saison) : une
    // seule autre ligne active est créée ici (saison hiver), tout le reste est délibérément HORS
    // du périmètre actif (sorti, a_relancer).
    const t = garage.tenantA.tenant;

    // Une ligne active distincte (hiver) — garde le total exact et démontre qu'elle apparaît
    // correctement mêlée aux lignes en lot.
    const depotHiver = await creerDepotPneusPourTest(bdd, t, vehicule, site, {
      saison: 'hiver',
      statut: 'monte',
    });
    // Une ligne terminale (sorti, motif obligatoire) — même véhicule/saison que "REN-B03" du test
    // précédent, licite car cette ligne-ci n'est PAS active.
    const depotSorti = await creerDepotPneusPourTest(bdd, t, vehicule, site, {
      saison: 'ete',
      statut: 'sorti',
      motifSortie: 'vehicule_vendu',
    });
    // 6 lignes au MÊME instant exact (une seule requête, valeurs littérales — jamais `default now()`
    // répété) : reproduit le cas réel documenté par `common/pagination/valeur-temporelle.ts`
    // (insertion en lot / reprise de données). `a_relancer` : hors du périmètre actif, aucun
    // conflit RPP-02 possible quel que soit le nombre de lignes.
    const instantExAequo = new Date('2031-06-15T10:00:00.000Z');
    const idsExAequo = await semerDepotsPneusMemeInstant(bdd, t, vehicule, site, 6, instantExAequo);

    // Total sur CE site (REN, dédié à ce describe()) = 1 (REN-B03, test précédent) + 1 (hiver) +
    // 1 (sorti) + 6 (ex-aequo) = 9. limite=3 → exactement 3 pages pleines. Si une ligne était
    // sautée (perte de microseconde / mauvais format ::text) ou dupliquée (départage par id
    // manquant), soit moins de 3 pages pleines, soit une 4e page non vide.
    const idsCollectes: string[] = [];
    let curseur: string | undefined;
    let page = 0;
    let curseurSuivant: string | null = null;

    do {
      page += 1;
      const reponse = await ctx.requete
        .get(`/api/v1/sites/${site}/hangar-pneus`)
        .query(curseur ? { limite: 3, curseur } : { limite: 3 })
        .set('Cookie', cookieReceptionnaire);
      expect(reponse.status, `page ${String(page)} : ${JSON.stringify(reponse.body)}`).toBe(200);

      const donnees = reponse.body.donnees as ReadonlyArray<{ id: string }>;
      idsCollectes.push(...donnees.map((d) => d.id));
      curseurSuivant = reponse.body.curseurSuivant as string | null;
      curseur = curseurSuivant ?? undefined;

      expect(page, 'trop de pages : la pagination ne progresse plus').toBeLessThanOrEqual(6);
    } while (curseurSuivant !== null);

    expect(page).toBe(3);
    expect(idsCollectes).toHaveLength(9);
    expect(new Set(idsCollectes).size, 'aucune ligne dupliquée').toBe(9);

    for (const id of [depotHiver.id, depotSorti.id, ...idsExAequo]) {
      expect(idsCollectes, `id ${id} manquant de la pagination`).toContain(id);
    }
  });

  it('tri explicite entreLe:asc sur les mêmes données : aucune ligne sautée non plus (le départage keyset ne dépend pas du sens du tri)', async () => {
    const site = garage.tenantA.tenant.sites[1]!.id; // même site REN, données accumulées par les 2 tests précédents (9 lignes)

    const idsCollectes: string[] = [];
    let curseur: string | undefined;
    let curseurSuivant: string | null = null;
    let page = 0;

    do {
      page += 1;
      const reponse = await ctx.requete
        .get(`/api/v1/sites/${site}/hangar-pneus`)
        .query(
          curseur ? { limite: 4, curseur, tri: 'entreLe:asc' } : { limite: 4, tri: 'entreLe:asc' },
        )
        .set('Cookie', cookieReceptionnaire);
      expect(reponse.status, `page ${String(page)} : ${JSON.stringify(reponse.body)}`).toBe(200);

      const donnees = reponse.body.donnees as ReadonlyArray<{ id: string }>;
      idsCollectes.push(...donnees.map((d) => d.id));
      curseurSuivant = reponse.body.curseurSuivant as string | null;
      curseur = curseurSuivant ?? undefined;
      expect(page).toBeLessThanOrEqual(6);
    } while (curseurSuivant !== null);

    expect(idsCollectes).toHaveLength(9);
    expect(new Set(idsCollectes).size).toBe(9);
  });
});
