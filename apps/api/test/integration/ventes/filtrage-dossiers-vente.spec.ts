/**
 * `GET /dossiers-vente` — preuve de bout en bout, sur vraie base PostgreSQL (testcontainers), vraie
 * app NestJS, vraies requêtes HTTP (`supertest`), que CHAQUE filtre de `FiltresDossiersVente` est
 * réellement traduit en SQL — pas seulement accepté par la validation zod.
 *
 * DÉFAUT MESURÉ (parcours navigateur + `curl` + lecture de code, avant ce fichier) :
 * `GET /dossiers-vente?q=<n'importe quoi>` rendait TOUJOURS la même liste — le tableau `conditions`
 * de `ServiceDossierVente.lister` (`ventes/service-dossier-vente.ts`) lisait `siteId`, `statut`,
 * `clientAcheteurId`, `vehiculeId`, mais JAMAIS `q`. Même famille de défaut que celui documenté sur
 * `GET /documents-vente` (`ordreReparationId` jamais traduit en SQL, CONTRIBUTING.md « Pièges vérifiés »).
 *
 * POURQUOI UN TEST D'INTÉGRATION ET PAS UN TEST UNITAIRE (piège documenté du dépôt) :
 * `ServiceDossierVente.lister` construit la requête en SQL BRUT (`tx.execute`, pas le query
 * builder Drizzle) — un test qui moquerait `tx.execute` pour lui faire rendre des lignes fixes ne
 * prouverait RIEN sur le contenu réel de la clause `where` : il validerait la logique AUTOUR de la
 * requête, jamais la requête elle-même. `service-dossier-vente.spec.ts` (unitaire, `tx` moqué) ne
 * couvre d'ailleurs PAS `lister()` pour cette raison exacte. Le test décisif — un identifiant ou un
 * fragment qui ne correspond à RIEN doit rendre une liste VIDE, jamais la même liste qu'un filtre
 * absent — exige une vraie base, un vrai planificateur de requêtes, une vraie évaluation SQL.
 *
 * DISCIPLINE ANTI-COLLISION (même patron que `cycle-vente-vehicule.spec.ts`) : chaque `it` sème ses
 * PROPRES véhicules/dossiers (jamais partagés). Les assertions vérifient qu'un identifiant PRÉCIS
 * est présent/absent de `donnees` plutôt qu'une égalité de tableau complète, pour rester correctes
 * même si d'autres `it` de ce fichier ont déjà semé des dossiers dans le même tenant au moment où
 * la requête s'exécute (aucun ordre d'exécution n'est supposé entre les `it`).
 *
 * Périmètre d'écriture : `apps/api/test/**` uniquement (brief de cette tâche — `apps/api/src/
 * ventes/` reste le périmètre d'écriture exclusif de l'agent qui a livré le correctif).
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
import {
  semerGarageDemoLot1,
  type GarageDemoLot1Fixture,
} from '../../lot1/fixtures/garage-demo-lot1';
import {
  construireCookiePour,
  creerDossier,
  creerVehicule,
  mettreEnStock,
  type ReponseHttp,
} from './fixtures-cycle-vente';

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

const SITE_A = () => garage.tenantA.tenant.sites[0]!.id;
// Deux clients DISTINCTS de la fixture lot 1 (`CLIENTS_TENANT_A`, `garage-demo-lot1.ts`) : un
// particulier (« Bertrand Nicolas », convention RM-01 nom+prénom) et une entreprise (« Transports
// Follonier Sàrl ») — désignations suffisamment distinctes pour prouver que `q` DISCRIMINE, pas
// seulement qu'il ne casse rien.
const CLIENT_PARTICULIER = () => garage.tenantA.clients[0]!;
const CLIENT_ENTREPRISE = () => garage.tenantA.clients[1]!;

/** `GET /dossiers-vente?...` — même doctrine que `recuperer()` de `fixtures-cycle-vente.ts` (pas
 *  d'en-tête `Origin` : la garde CSRF ne s'applique qu'aux verbes qui mutent). */
async function listerDossiers(
  cookie: string,
  query: Record<string, string>,
): Promise<ReponseHttp & { readonly body: { readonly donnees: readonly { id: string }[] } }> {
  const reponse = await ctx.requete
    .get('/api/v1/dossiers-vente')
    .query(query)
    .set('Cookie', cookie);
  return { status: reponse.status, body: reponse.body };
}

async function poserPlaque(cookie: string, vehiculeId: string, valeur: string): Promise<void> {
  const reponse = await ctx.requete
    .post(`/api/v1/vehicules/${vehiculeId}/plaques`)
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
    .set('Cookie', cookie)
    .send({ valeur, canton: 'VD', pays: 'CH', debutLe: '2026-01-05' });
  if (reponse.status !== 201) {
    throw new Error(`fixture : pose de plaque échouée : ${JSON.stringify(reponse.body)}`);
  }
}

interface DossierSeme {
  readonly dossierId: string;
  readonly vehiculeId: string;
  readonly plaque: string;
}

/** Sème un dossier `prospection` complet (véhicule en stock + plaque posée) pour un client donné —
 *  factorise la préparation commune aux `it` ci-dessous, chacun avec ses propres identifiants
 *  (`suffixe` unique via `randomUUID()`, jamais deux `it` sur la même plaque/VIN). */
async function semerDossier(
  cookie: string,
  clientAcheteurId: string,
  plaque: string,
): Promise<DossierSeme> {
  const suffixe = randomUUID();
  const vehicule = await creerVehicule(ctx, cookie, suffixe);
  if (vehicule.status !== 201) {
    throw new Error(`fixture : création véhicule échouée : ${JSON.stringify(vehicule.body)}`);
  }
  const vehiculeId = (vehicule.body.donnees as { id: string }).id;

  const stock = await mettreEnStock(ctx, cookie, vehiculeId, SITE_A());
  if (stock.status !== 201) {
    throw new Error(`fixture : mise en stock échouée : ${JSON.stringify(stock.body)}`);
  }

  await poserPlaque(cookie, vehiculeId, plaque);

  const dossier = await creerDossier(ctx, cookie, {
    siteId: SITE_A(),
    clientAcheteurId,
    vehiculeId,
  });
  if (dossier.status !== 201) {
    throw new Error(`fixture : création dossier échouée : ${JSON.stringify(dossier.body)}`);
  }
  const dossierId = (dossier.body.donnees as { id: string }).id;

  return { dossierId, vehiculeId, plaque };
}

describe('GET /dossiers-vente — filtre q (nom du client acheteur / plaque du véhicule)', () => {
  it('un fragment de NOM DE CLIENT rend le dossier de ce client, jamais celui d’un autre client', async () => {
    const cookie = await cookiePour(garage.tenantA, 'direction');
    const d1 = await semerDossier(
      cookie,
      CLIENT_PARTICULIER().id,
      `VD ${randomUUID().slice(0, 6)}`,
    );
    const d2 = await semerDossier(cookie, CLIENT_ENTREPRISE().id, `VD ${randomUUID().slice(0, 6)}`);

    const parNomParticulier = await listerDossiers(cookie, { q: 'Bertrand' });
    expect(parNomParticulier.status, JSON.stringify(parNomParticulier.body)).toBe(200);
    const idsParticulier = parNomParticulier.body.donnees.map((d) => d.id);
    expect(idsParticulier).toContain(d1.dossierId);
    expect(idsParticulier).not.toContain(d2.dossierId);

    const parNomEntreprise = await listerDossiers(cookie, { q: 'Follonier' });
    expect(parNomEntreprise.status, JSON.stringify(parNomEntreprise.body)).toBe(200);
    const idsEntreprise = parNomEntreprise.body.donnees.map((d) => d.id);
    expect(idsEntreprise).toContain(d2.dossierId);
    expect(idsEntreprise).not.toContain(d1.dossierId);
  });

  it('un fragment de PLAQUE rend le dossier du véhicule correspondant, jamais un autre', async () => {
    const cookie = await cookiePour(garage.tenantA, 'direction');
    const fragmentUnique1 = randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
    const fragmentUnique2 = randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
    const d1 = await semerDossier(cookie, CLIENT_PARTICULIER().id, `VD ${fragmentUnique1}`);
    const d2 = await semerDossier(cookie, CLIENT_ENTREPRISE().id, `VD ${fragmentUnique2}`);

    const parPlaque1 = await listerDossiers(cookie, { q: fragmentUnique1 });
    expect(parPlaque1.status, JSON.stringify(parPlaque1.body)).toBe(200);
    const idsPlaque1 = parPlaque1.body.donnees.map((d) => d.id);
    expect(idsPlaque1).toContain(d1.dossierId);
    expect(idsPlaque1).not.toContain(d2.dossierId);
  });

  it('LE TEST DÉCISIF — un fragment qui ne correspond à AUCUN client ni AUCUNE plaque rend une liste VIDE (défaut mesuré : rendait la même liste que sans filtre)', async () => {
    const cookie = await cookiePour(garage.tenantA, 'direction');
    await semerDossier(cookie, CLIENT_PARTICULIER().id, `VD ${randomUUID().slice(0, 6)}`);

    const sansFiltre = await listerDossiers(cookie, {});
    expect(sansFiltre.status).toBe(200);
    expect(sansFiltre.body.donnees.length).toBeGreaterThan(0);

    const avecFiltreIntrouvable = await listerDossiers(cookie, {
      q: 'CLIENTQUINEXISTEPASDU100PERCENT',
    });
    expect(avecFiltreIntrouvable.status, JSON.stringify(avecFiltreIntrouvable.body)).toBe(200);
    // La preuve qui manquait avant le correctif : PAS la même liste que sans filtre, une liste VIDE.
    expect(avecFiltreIntrouvable.body.donnees).toEqual([]);
  });
});

describe('GET /dossiers-vente — les autres filtres, un par un, avec le test décisif (identifiant inexistant -> liste vide)', () => {
  it('clientAcheteurId : un identifiant inexistant rend une liste vide, l’identifiant réel rend exactement ce dossier', async () => {
    const cookie = await cookiePour(garage.tenantA, 'direction');
    const d1 = await semerDossier(
      cookie,
      CLIENT_PARTICULIER().id,
      `VD ${randomUUID().slice(0, 6)}`,
    );

    const inexistant = await listerDossiers(cookie, { clientAcheteurId: randomUUID() });
    expect(inexistant.status, JSON.stringify(inexistant.body)).toBe(200);
    expect(inexistant.body.donnees).toEqual([]);

    const reel = await listerDossiers(cookie, { clientAcheteurId: CLIENT_PARTICULIER().id });
    expect(reel.status).toBe(200);
    expect(reel.body.donnees.map((d) => d.id)).toContain(d1.dossierId);
  });

  it('vehiculeId : un identifiant inexistant rend une liste vide, l’identifiant réel rend exactement ce dossier', async () => {
    const cookie = await cookiePour(garage.tenantA, 'direction');
    const d1 = await semerDossier(
      cookie,
      CLIENT_PARTICULIER().id,
      `VD ${randomUUID().slice(0, 6)}`,
    );

    const inexistant = await listerDossiers(cookie, { vehiculeId: randomUUID() });
    expect(inexistant.status, JSON.stringify(inexistant.body)).toBe(200);
    expect(inexistant.body.donnees).toEqual([]);

    const reel = await listerDossiers(cookie, { vehiculeId: d1.vehiculeId });
    expect(reel.status).toBe(200);
    expect(reel.body.donnees.map((d) => d.id)).toEqual([d1.dossierId]);
  });

  it('siteId : un identifiant inexistant rend une liste vide (le dossier réel n’y apparaît jamais)', async () => {
    const cookie = await cookiePour(garage.tenantA, 'direction');
    await semerDossier(cookie, CLIENT_PARTICULIER().id, `VD ${randomUUID().slice(0, 6)}`);

    const inexistant = await listerDossiers(cookie, { siteId: randomUUID() });
    expect(inexistant.status, JSON.stringify(inexistant.body)).toBe(200);
    expect(inexistant.body.donnees).toEqual([]);
  });

  it('statut : un dossier fraîchement créé (`prospection`) n’apparaît PAS sous un autre statut demandé, et apparaît bien sous `prospection`', async () => {
    const cookie = await cookiePour(garage.tenantA, 'direction');
    const d1 = await semerDossier(
      cookie,
      CLIENT_PARTICULIER().id,
      `VD ${randomUUID().slice(0, 6)}`,
    );

    const autreStatut = await listerDossiers(cookie, { statut: 'engage' });
    expect(autreStatut.status, JSON.stringify(autreStatut.body)).toBe(200);
    expect(autreStatut.body.donnees.map((d) => d.id)).not.toContain(d1.dossierId);

    const bonStatut = await listerDossiers(cookie, { statut: 'prospection' });
    expect(bonStatut.status).toBe(200);
    expect(bonStatut.body.donnees.map((d) => d.id)).toContain(d1.dossierId);
  });
});
