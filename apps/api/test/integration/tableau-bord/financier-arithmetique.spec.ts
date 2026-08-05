/**
 * `GET /tableau-bord/financier` — exactitude arithmétique au centime (CONTRIBUTING.md : jamais de
 * `toBeCloseTo` sur de l'argent), bornes de période, filtre par site, période vide. Vraie Postgres
 * éphémère (testcontainers), vraie app NestJS, documents et paiements créés par les VRAIS
 * contrôleurs HTTP (`POST /documents-vente`, `.../emettre`, `.../avoirs`, `POST /paiements`,
 * `.../rembourser`) — voir `fixtures-tableau-bord.ts` pour le détail et la preuve du calcul de la
 * ligne primitive réutilisée partout ici (7'000 c. TTC/81‰ → 6'475 HT / 525 TVA).
 *
 * DISCIPLINE DE FENÊTRAGE, pour que chaque test reste vrai QUEL QUE SOIT L'ORDRE D'EXÉCUTION DES
 * AUTRES : `chiffreAffaires`/`nombreDocuments`/`encaissementsCentimes` sont bornés par
 * `du`/`au` (`date_document`/`date_valeur`) — chaque `it` ci-dessous utilise un MOIS dédié,
 * jamais réutilisé par un autre test de ce fichier, ce qui suffit à les isoler les uns des
 * autres. `encoursClientsCentimes` en revanche est un SNAPSHOT **non borné par la période** (voir
 * le contrat, `@dfa/shared/contrats/tableau-bord/financier.ts`) : un test qui l'affirme à une
 * valeur absolue serait vrai ou faux selon ce que les AUTRES tests du fichier ont laissé impayé
 * avant lui. Les deux tests qui le vérifient (section « encaissements et encours ») utilisent donc
 * un DELTA avant/après, jamais une valeur absolue — robuste à l'ordre.
 *
 * Périmètre d'écriture : `apps/api/test/**` uniquement (CONTRIBUTING.md).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { demarrerBaseEphemere, type BaseEphemere } from '../../setup/postgres-ephemere';
import {
  creerAppTest,
  demarrerRedisEphemere,
  type AppTest,
  type RedisEphemere,
} from '../../setup/app-test';
import { semerGarageDemoLot1, type GarageDemoLot1Fixture } from '../../lot1/fixtures/garage-demo-lot1';
import {
  construireCookiePour,
  creerAvoirTotalPourTest,
  creerFactureBrouillonPourTest,
  creerFactureEmisePourTest,
  creerPaiementPourTest,
  getFinancier,
  PRIMITIVE_HT,
  PRIMITIVE_TTC,
  PRIMITIVE_TVA,
  rembourserPaiementPourTest,
} from './fixtures-tableau-bord';

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

const SITE_0 = () => garage.tenantA.tenant.sites[0]!.id;
const SITE_1 = () => garage.tenantA.tenant.sites[1]!.id;
const CLIENT_0 = () => garage.tenantA.clients[0]!.id;

// =================================================================================================
// 1. Chiffre d'affaires — arithmétique exacte au centime (mois dédié : 2030-01)
// =================================================================================================

describe("chiffre d'affaires — deux lignes primitives, une facture émise (2030-01)", () => {
  it('ΣHT/ΣTVA/ΣTTC exacts au centime, nombreDocuments=1', async () => {
    await creerFactureEmisePourTest(ctx, garage.tenantA, 'receptionnaire', cookiePour, {
      siteId: SITE_0(),
      clientId: CLIENT_0(),
      dateDocument: '2030-01-15',
      nombreLignesPrimitives: 2,
    });

    const cookie = await cookiePour(garage.tenantA, 'direction');
    const reponse = await getFinancier(ctx, cookie, { du: '2030-01-01', au: '2030-01-31' });
    expect(reponse.status, JSON.stringify(reponse.body)).toBe(200);
    expect(reponse.body.chiffreAffaires).toEqual({
      totalHtCentimes: 2 * PRIMITIVE_HT, // 12 950 — pas 2×7000×0.925 ni aucune approximation
      totalTvaCentimes: 2 * PRIMITIVE_TVA, // 1 050
      totalTtcCentimes: 2 * PRIMITIVE_TTC, // 14 000
      nombreDocuments: 1,
    });
    // L'invariant qui compte : jamais recalculé séparément, toujours HT+TVA=TTC exactement.
    expect(
      reponse.body.chiffreAffaires.totalHtCentimes + reponse.body.chiffreAffaires.totalTvaCentimes,
    ).toBe(reponse.body.chiffreAffaires.totalTtcCentimes);
  });
});

// =================================================================================================
// 2. Un avoir TOTAL annule EXACTEMENT le chiffre d'affaires de la facture qu'il crédite
//    (`dateDocument` d'un avoir n'est pas paramétrable — période PAR DÉFAUT, isolée par site REN)
// =================================================================================================

describe("un avoir total (stocké en négatif) annule exactement le CA de la facture créditée (période par défaut, site REN)", () => {
  it('CA net = 0 après avoir, nombreDocuments=2 (facture annulée + avoir, tous deux hors brouillon)', async () => {
    const site = SITE_1();
    const facture = await creerFactureEmisePourTest(ctx, garage.tenantA, 'receptionnaire', cookiePour, {
      siteId: site,
      clientId: CLIENT_0(),
      dateDocument: new Date().toISOString().slice(0, 10),
      nombreLignesPrimitives: 1,
    });
    expect(facture.totalTtcCentimes).toBe(PRIMITIVE_TTC);

    const cookie = await cookiePour(garage.tenantA, 'direction');
    const avant = await getFinancier(ctx, cookie, { siteId: site });
    expect(avant.body.chiffreAffaires).toEqual({
      totalHtCentimes: PRIMITIVE_HT,
      totalTvaCentimes: PRIMITIVE_TVA,
      totalTtcCentimes: PRIMITIVE_TTC,
      nombreDocuments: 1,
    });

    const avoir = await creerAvoirTotalPourTest(ctx, garage.tenantA, 'receptionnaire', cookiePour, facture.id);
    // L'avoir est stocké EN NÉGATIF (document_vente_signe_avoir_chk) — jamais retraité côté API.
    expect(avoir.totalTtcCentimes).toBe(-PRIMITIVE_TTC);
    expect(avoir.totalHtCentimes).toBe(-PRIMITIVE_HT);
    expect(avoir.totalTvaCentimes).toBe(-PRIMITIVE_TVA);

    const apres = await getFinancier(ctx, cookie, { siteId: site });
    expect(apres.status, JSON.stringify(apres.body)).toBe(200);
    expect(apres.body.chiffreAffaires).toEqual({
      totalHtCentimes: 0,
      totalTvaCentimes: 0,
      totalTtcCentimes: 0,
      nombreDocuments: 2, // la facture (statut annule_par_avoir, PAS brouillon) + l'avoir (émis)
    });
  });
});

// =================================================================================================
// 3. Bornes de période — INCLUSIVES des deux côtés (2030-09, avec des sentinelles hors fenêtre en
//    2030-08 et 2030-10, deux mois qu'AUCUN autre test de ce fichier n'utilise)
// =================================================================================================

describe('bornes de période — incluses aux deux extrémités, exclues juste avant/après (2030-09)', () => {
  it('premier jour de la fenêtre compte, veille exclue ; dernier jour compte, lendemain exclu', async () => {
    // Hors fenêtre AVANT (veille du premier jour) — ne doit apparaître dans AUCUN total.
    await creerFactureEmisePourTest(ctx, garage.tenantA, 'receptionnaire', cookiePour, {
      siteId: SITE_0(),
      clientId: CLIENT_0(),
      dateDocument: '2030-08-31',
      nombreLignesPrimitives: 1,
    });
    // Premier jour de la fenêtre — INCLUS.
    await creerFactureEmisePourTest(ctx, garage.tenantA, 'receptionnaire', cookiePour, {
      siteId: SITE_0(),
      clientId: CLIENT_0(),
      dateDocument: '2030-09-01',
      nombreLignesPrimitives: 1,
    });
    // Dernier jour de la fenêtre — INCLUS.
    await creerFactureEmisePourTest(ctx, garage.tenantA, 'receptionnaire', cookiePour, {
      siteId: SITE_0(),
      clientId: CLIENT_0(),
      dateDocument: '2030-09-30',
      nombreLignesPrimitives: 1,
    });
    // Hors fenêtre APRÈS (lendemain du dernier jour) — ne doit apparaître dans AUCUN total.
    await creerFactureEmisePourTest(ctx, garage.tenantA, 'receptionnaire', cookiePour, {
      siteId: SITE_0(),
      clientId: CLIENT_0(),
      dateDocument: '2030-10-01',
      nombreLignesPrimitives: 1,
    });

    const cookie = await cookiePour(garage.tenantA, 'direction');
    const reponse = await getFinancier(ctx, cookie, { du: '2030-09-01', au: '2030-09-30' });
    expect(reponse.status, JSON.stringify(reponse.body)).toBe(200);
    expect(reponse.body.periode).toEqual({ du: '2030-09-01', au: '2030-09-30' });
    expect(reponse.body.chiffreAffaires).toEqual({
      totalHtCentimes: 2 * PRIMITIVE_HT, // seules les DEUX factures du 09-01 et du 09-30
      totalTvaCentimes: 2 * PRIMITIVE_TVA,
      totalTtcCentimes: 2 * PRIMITIVE_TTC,
      nombreDocuments: 2,
    });
  });
});

// =================================================================================================
// 4. Filtre par site — restreint quand fourni, agrège tous les sites quand absent (2030-04, tenant
//    A a deux sites — LAU/sites[0], REN/sites[1])
// =================================================================================================

describe('filtre siteId — restreint au site demandé, agrège tous les sites du tenant quand absent (2030-04)', () => {
  it('LAU=1×primitive (7 000), REN=3×primitive (21 000), siteId isole chacun, absence de siteId agrège les deux', async () => {
    await creerFactureEmisePourTest(ctx, garage.tenantA, 'receptionnaire', cookiePour, {
      siteId: SITE_0(),
      clientId: CLIENT_0(),
      dateDocument: '2030-04-10',
      nombreLignesPrimitives: 1,
    });
    await creerFactureEmisePourTest(ctx, garage.tenantA, 'receptionnaire', cookiePour, {
      siteId: SITE_1(),
      clientId: CLIENT_0(),
      dateDocument: '2030-04-10',
      nombreLignesPrimitives: 3,
    });

    const cookie = await cookiePour(garage.tenantA, 'direction');
    const fenetre = { du: '2030-04-01', au: '2030-04-30' };

    const site0 = await getFinancier(ctx, cookie, { ...fenetre, siteId: SITE_0() });
    expect(site0.body.chiffreAffaires).toEqual({
      totalHtCentimes: PRIMITIVE_HT,
      totalTvaCentimes: PRIMITIVE_TVA,
      totalTtcCentimes: PRIMITIVE_TTC,
      nombreDocuments: 1,
    });

    const site1 = await getFinancier(ctx, cookie, { ...fenetre, siteId: SITE_1() });
    expect(site1.body.chiffreAffaires).toEqual({
      totalHtCentimes: 3 * PRIMITIVE_HT,
      totalTvaCentimes: 3 * PRIMITIVE_TVA,
      totalTtcCentimes: 3 * PRIMITIVE_TTC,
      nombreDocuments: 1,
    });

    const tousSites = await getFinancier(ctx, cookie, fenetre);
    expect(tousSites.body.chiffreAffaires).toEqual({
      totalHtCentimes: PRIMITIVE_HT + 3 * PRIMITIVE_HT,
      totalTvaCentimes: PRIMITIVE_TVA + 3 * PRIMITIVE_TVA,
      totalTtcCentimes: PRIMITIVE_TTC + 3 * PRIMITIVE_TTC,
      nombreDocuments: 2,
    });
    expect(tousSites.body.siteId).toBeNull();
    expect(site0.body.siteId).toBe(SITE_0());
  });
});

// =================================================================================================
// 5. Une facture en BROUILLON (jamais émise) ne compte dans AUCUN agrégat (2030-05)
// =================================================================================================

describe('une facture en statut brouillon ne compte dans aucun total (2030-05)', () => {
  it('nombreDocuments=0 et tous les montants à 0, malgré un brouillon existant dans la fenêtre', async () => {
    await creerFactureBrouillonPourTest(ctx, garage.tenantA, 'receptionnaire', cookiePour, {
      siteId: SITE_0(),
      clientId: CLIENT_0(),
      dateDocument: '2030-05-15',
      nombreLignesPrimitives: 2,
    });

    const cookie = await cookiePour(garage.tenantA, 'direction');
    const reponse = await getFinancier(ctx, cookie, { du: '2030-05-01', au: '2030-05-31' });
    expect(reponse.status, JSON.stringify(reponse.body)).toBe(200);
    expect(reponse.body.chiffreAffaires).toEqual({
      totalHtCentimes: 0,
      totalTvaCentimes: 0,
      totalTtcCentimes: 0,
      nombreDocuments: 0, // et pas seulement les montants : le brouillon n'est même pas COMPTÉ
    });
  });
});

// =================================================================================================
// 6. Encaissements et encours — le snapshot n'est PAS borné par la période (voir l'en-tête de ce
//    fichier) : ces deux tests raisonnent en DELTA avant/après, jamais en valeur absolue.
// =================================================================================================

describe('encaissements et encours — exacts au centime, en delta (robuste à l’ordre d’exécution)', () => {
  it('une facture ÉMISE jamais payée augmente l’encours de tenant A d’EXACTEMENT son TTC (2030-02)', async () => {
    const cookie = await cookiePour(garage.tenantA, 'direction');
    const avant = await getFinancier(ctx, cookie);
    const encoursAvant = avant.body.encoursClientsCentimes as number;

    const facture = await creerFactureEmisePourTest(ctx, garage.tenantA, 'receptionnaire', cookiePour, {
      siteId: SITE_0(),
      clientId: CLIENT_0(),
      dateDocument: '2030-02-10',
      nombreLignesPrimitives: 1,
    });
    expect(facture.totalTtcCentimes).toBe(PRIMITIVE_TTC);

    const apres = await getFinancier(ctx, cookie);
    const encoursApres = apres.body.encoursClientsCentimes as number;

    // Définition du contrat (`ChiffreAffairesPeriodeTableauBord`/`ReponseFinancierTableauBord`,
    // `@dfa/shared/contrats/tableau-bord/financier.ts`) : « créances ouvertes sur les factures
    // encore au statut `emis` » — une facture émise et JAMAIS payée doit donc contribuer pour la
    // TOTALITÉ de son TTC, pas 0. Si cette assertion rougit, la cause n'est PAS dans
    // `tableau-bord/` (la requête SQL lit correctement `document_vente.solde_centimes`) mais dans
    // `facturation/documents/service-emission.ts` : `solde_centimes` (défaut 0 en base) n'est
    // JAMAIS initialisé à `total_ttc_centimes` à l'émission — seule une imputation ultérieure le
    // met à jour (`facturation/paiements/imputations.ts::recalculerDocumentApresImputation`).
    // Une facture émise puis jamais réglée resterait alors avec `solde_centimes = 0`, et
    // l'encours clients — la métrique même que ce test vérifie — sous-évaluerait silencieusement
    // le garage sur EXACTEMENT les factures qui restent impayées : le cas que cette métrique
    // existe pour signaler. Signalé, pas corrigé ici (hors périmètre `apps/api/test/**`).
    expect(encoursApres - encoursAvant).toBe(PRIMITIVE_TTC);
  });

  it('un règlement partiel réduit l’encours du montant réglé et alimente les encaissements au centime exact (2030-03)', async () => {
    const cookie = await cookiePour(garage.tenantA, 'direction');
    const avant = await getFinancier(ctx, cookie, { du: '2030-03-01', au: '2030-03-31' });
    const encoursAvant = avant.body.encoursClientsCentimes as number;
    expect(avant.body.encaissementsCentimes).toBe(0); // fenêtre 2030-03 encore vierge

    const facture = await creerFactureEmisePourTest(ctx, garage.tenantA, 'receptionnaire', cookiePour, {
      siteId: SITE_0(),
      clientId: CLIENT_0(),
      dateDocument: '2030-03-10',
      nombreLignesPrimitives: 2, // 14 000 c. TTC
    });
    expect(facture.totalTtcCentimes).toBe(2 * PRIMITIVE_TTC);

    await creerPaiementPourTest(ctx, garage.tenantA, 'receptionnaire', cookiePour, {
      siteId: SITE_0(),
      dateValeur: '2030-03-15',
      montantCentimes: 5000,
      payeurLibelle: 'Client règlement partiel',
      imputations: [{ documentId: facture.id, montantCentimes: 5000, nature: 'reglement' }],
    });

    const apres = await getFinancier(ctx, cookie, { du: '2030-03-01', au: '2030-03-31' });
    expect(apres.status, JSON.stringify(apres.body)).toBe(200);
    // Encaissements : borné par la période (dateValeur du paiement dans la fenêtre) — valeur
    // ABSOLUE légitime ici, fenêtre 2030-03 dédiée à ce seul test.
    expect(apres.body.encaissementsCentimes).toBe(5000);
    expect(apres.body.chiffreAffaires.totalTtcCentimes).toBe(2 * PRIMITIVE_TTC);
    // Encours : snapshot non borné — DELTA. 14 000 facturés − 5 000 réglés = 9 000 de solde neuf.
    const encoursApres = apres.body.encoursClientsCentimes as number;
    expect(encoursApres - encoursAvant).toBe(2 * PRIMITIVE_TTC - 5000);
  });

  it('un remboursement (paiement négatif, contre-passation) réduit net les encaissements (période par défaut, site LAU isolé)', async () => {
    const site = SITE_0();
    // Un paiement AVANCE non imputé : POST /paiements accepte des imputations vides (RF-65).
    const paiement = await creerPaiementPourTest(ctx, garage.tenantA, 'receptionnaire', cookiePour, {
      siteId: site,
      dateValeur: new Date().toISOString().slice(0, 10),
      montantCentimes: 5000,
      payeurLibelle: 'Avance client à rembourser',
    });
    expect(paiement.montantNonImputeCentimes).toBe(5000);

    const cookie = await cookiePour(garage.tenantA, 'direction');
    const avant = await getFinancier(ctx, cookie, { siteId: site });
    expect(avant.body.encaissementsCentimes).toBe(5000);

    const remboursement = await rembourserPaiementPourTest(
      ctx,
      garage.tenantA,
      'direction',
      cookiePour,
      paiement.id,
      2000,
    );
    expect(remboursement.montantCentimes).toBe(-2000); // signé, jamais une correction en place

    const apres = await getFinancier(ctx, cookie, { siteId: site });
    expect(apres.status, JSON.stringify(apres.body)).toBe(200);
    // 5 000 encaissés − 2 000 remboursés = 3 000 NET, jamais 5 000 (le remboursement ignoré) ni
    // 7 000 (le signe perdu en route).
    expect(apres.body.encaissementsCentimes).toBe(3000);
  });
});

// =================================================================================================
// 7. Période vide — sur un tenant JAMAIS touché par ce fichier (tenant B), tout est à zéro exact,
//    jamais une erreur, jamais `null` là où le contrat promet un nombre.
// =================================================================================================

describe('période vide — un tenant sans aucune donnée rend des zéros exacts, jamais une erreur (tenant B)', () => {
  it('chiffreAffaires, encaissements ET encours (snapshot compris) sont tous à zéro', async () => {
    const cookie = await cookiePour(garage.tenantB, 'direction');
    const reponse = await getFinancier(ctx, cookie, { du: '2040-01-01', au: '2040-01-31' });
    expect(reponse.status, JSON.stringify(reponse.body)).toBe(200);
    expect(reponse.body.chiffreAffaires).toEqual({
      totalHtCentimes: 0,
      totalTvaCentimes: 0,
      totalTtcCentimes: 0,
      nombreDocuments: 0,
    });
    expect(reponse.body.encaissementsCentimes).toBe(0);
    // Tenant B n'a JAMAIS de document créé dans ce fichier : l'encours (snapshot, non borné par
    // la période) est donc légitimement zéro ici aussi — à la différence des tests de la section 6
    // sur tenant A, où d'autres tests du même fichier laissent des factures impayées.
    expect(reponse.body.encoursClientsCentimes).toBe(0);
    expect(reponse.body.periode).toEqual({ du: '2040-01-01', au: '2040-01-31' });
  });
});
