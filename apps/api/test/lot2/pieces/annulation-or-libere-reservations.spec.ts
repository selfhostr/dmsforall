/**
 * Issue #11 — « Annuler un OR ne libère pas la pièce réservée », sur vraie base PostgreSQL
 * (testcontainers), vraie app NestJS, vraies requêtes HTTP (`supertest`).
 *
 * CAUSE RACINE (voir `service-transitions.ts::annuler`, commentaire de méthode) :
 * `annulerLignes`/`refuserLignes` (`ServiceLigneOr`) appellent déjà `ServiceReservation.
 * libererPourLigneTx` ligne par ligne (RP-23) — mais `ServiceTransitions.annuler`, qui annule l'OR
 * ENTIER (T-20, un tout autre geste métier), n'appelait JUSQU'ICI AUCUN des deux : elle se
 * contentait d'écrire `ordre_reparation.statut = 'annule'` sans jamais toucher
 * `reservation_piece`. Toute ligne `piece` encore réservée au moment de l'annulation restait donc
 * `active` pour de bon.
 *
 * CE QUE CE FICHIER MET SOUS TEST :
 *   1. Reproduction EXACTE du scénario de l'issue : poser une ligne pièce (réservation `active`,
 *      disponible réduit), annuler l'OR ENTIER (pas `annuler-lignes`), relire réservation +
 *      disponible.
 *   2. Atomicité : plusieurs lignes pièce sur le même OR — l'annulation libère TOUTES leurs
 *      réservations `active`, dans la MÊME transaction que le passage à `annule`.
 *   3. RM-62, distinction demandée par le rapport de livraison : une ligne déjà `realisee`, dont
 *      la pièce est PHYSIQUEMENT sortie du stock (réservation `satisfaite`), ne doit PAS voir sa
 *      réservation « libérée » (ce serait faux : la pièce est réellement partie) — elle doit au
 *      contraire BLOQUER l'annulation de l'OR entier (RM-62 : « aucune pièce sortie »), au même
 *      titre qu'un pointage ouvert ou une ligne facturée. Prouvé aussi : un blocage laisse l'OR et
 *      TOUTES ses réservations strictement INCHANGÉS (rien n'est écrit avant la garde).
 *
 * TOUT PASSE PAR LA VRAIE API HTTP — même doctrine, motivée en détail, que
 * `pont-atelier-pieces.spec.ts` (fichier sœur, dont ce fichier réutilise les fixtures) : contourner
 * par un INSERT direct viderait le test de sa substance, en particulier ici où la garantie
 * recherchée est l'ATOMICITÉ transactionnelle réelle (verrous `for update`, tout-ou-rien).
 *
 * Périmètre d'écriture : `apps/api/test/**` uniquement (CONTRIBUTING.md, brief de cette tâche).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { demarrerBaseEphemere, type BaseEphemere } from '../../setup/postgres-ephemere';
import {
  creerAppTest,
  demarrerRedisEphemere,
  type AppTest,
  type RedisEphemere,
} from '../../setup/app-test';
import {
  creerOrPourTest,
  semerGarageDemoLot1,
  type GarageDemoLot1Fixture,
} from '../../lot1/fixtures/garage-demo-lot1';
import {
  ajustementInventaire,
  annulerOr,
  arreterPointage,
  construireCookiePour,
  creerArticle,
  creerLignePiece,
  demarrerPointage,
  disponibilite,
  listerReservations,
  marquerRealisee,
  obtenirOr,
} from './fixtures-pont-atelier-pieces';

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

/** OR frais, statut `planifie` — annulable (T-20 part de `planifie` OU `ouvert`) et jamais
 *  verrouillé, même doctrine que `creerOrFrais` de `pont-atelier-pieces.spec.ts`. */
async function creerOrFrais() {
  const t = garage.tenantA;
  return creerOrPourTest(bdd, t.tenant, SITE_A(), t.clients[0]!, t.vehicules[0]!);
}

/** `chef_atelier` hérite de `receptionnaire` (`DROITS_CHEF_ATELIER = [...DROITS_RECEPTIONNAIRE,
 *  …]`, `matrice-droits.ts`) : porte à la fois `atelier.ligne.creer`, les droits de pointage/
 *  réalisation ET `atelier.or.annuler` (T-20, réservé au réceptionnaire dans le référentiel
 *  §7.7 mais hérité ici) — une seule persona suffit pour tout ce fichier. */
async function cookieAtelier() {
  return cookiePour(garage.tenantA, 'chef_atelier');
}

async function cookiePieces() {
  return cookiePour(garage.tenantA, 'magasinier');
}

/** Article + stock frais (comptage initial via `ajustement-inventaire`, JAMAIS une quantité
 *  physique posée directement — RP-16). Même patron que `articleAvecStock` de
 *  `pont-atelier-pieces.spec.ts` (fichier sœur) — dupliqué localement plutôt qu'exporté depuis les
 *  fixtures partagées, pour ne pas élargir leur API publique au-delà de ce que ce fichier utilise. */
async function articleAvecStockPourTest(
  cookie: string,
  quantitePhysiqueMillieme: number,
): Promise<{ articleId: string; siteId: string }> {
  const article = await creerArticle(ctx, cookie);
  expect(article.status, JSON.stringify(article.body)).toBe(201);
  const articleId = (
    (article.body as { donnees: { id: string } }).donnees as unknown as { id: string }
  ).id;
  const siteId = SITE_A();
  const ajustement = await ajustementInventaire(
    ctx,
    cookie,
    articleId,
    siteId,
    quantitePhysiqueMillieme,
  );
  expect(ajustement.status, JSON.stringify(ajustement.body)).toBe(201);
  return { articleId, siteId };
}

// =================================================================================================
// 1. Reproduction exacte du scénario de l'issue #11.
// =================================================================================================

describe("issue #11 — annuler l'OR entier libère la réservation active de sa ligne pièce", () => {
  it('ouvrir un OR, poser une ligne pièce (réservation active, disponible réduit), annuler l’OR entier -> réservation `liberee`, disponible restauré', async () => {
    const { articleId, siteId } = await articleAvecStockPourTest(await cookiePieces(), 5000);
    const or = await creerOrFrais();
    const cookie = await cookieAtelier();

    const ligne = await creerLignePiece(ctx, cookie, or.id, articleId, 2000);
    expect(ligne.status, JSON.stringify(ligne.body)).toBe(201);
    const ligneId = (ligne.body as { donnees: { id: string } }).donnees.id;

    // Étape 1 de la reproduction : réservation active, disponible réduit.
    const pendant = await disponibilite(ctx, await cookiePieces(), articleId, siteId);
    expect(pendant.body).toMatchObject({
      quantitePhysiqueMillieme: 5000,
      quantiteReserveeMillieme: 2000,
      quantiteDisponibleMillieme: 3000,
    });
    const reservationsPendant = await listerReservations(ctx, await cookiePieces(), {
      ordreReparationId: or.id,
    });
    expect(
      (reservationsPendant.body as { donnees: readonly Record<string, unknown>[] }).donnees.find(
        (r) => r.ligneOrId === ligneId,
      ),
    ).toMatchObject({ statut: 'active', quantiteMillieme: 2000 });

    // Étape 2 : annuler l'OR ENTIER (pas `annuler-lignes`) — c'est le geste qui, avant correctif,
    // ne déclenchait AUCUNE libération.
    const annulation = await annulerOr(ctx, cookie, or.id);
    expect(annulation.status, JSON.stringify(annulation.body)).toBeLessThan(300);
    expect((annulation.body as { donnees: { statut: string } }).donnees.statut).toBe('annule');

    // Étape 3 : la réservation n'est plus `active`, le disponible est restauré à l'identique
    // d'avant la pose.
    const reservationsApres = await listerReservations(ctx, await cookiePieces(), {
      ordreReparationId: or.id,
    });
    const reservationApres = (
      reservationsApres.body as { donnees: readonly Record<string, unknown>[] }
    ).donnees.find((r) => r.ligneOrId === ligneId);
    expect(reservationApres).toMatchObject({
      statut: 'liberee',
      motifLiberation: 'annulation_ligne',
      quantiteMillieme: 2000,
    });

    const apres = await disponibilite(ctx, await cookiePieces(), articleId, siteId);
    expect(apres.body).toMatchObject({
      quantitePhysiqueMillieme: 5000,
      quantiteReserveeMillieme: 0,
      quantiteDisponibleMillieme: 5000,
    });
  });
});

// =================================================================================================
// 2. Atomicité : plusieurs lignes pièce sur le même OR — toutes leurs réservations `active` sont
//    libérées par la MÊME annulation, aucune ne reste orpheline.
// =================================================================================================

describe("annulation de l'OR entier — plusieurs lignes pièce, toutes leurs réservations actives sont libérées", () => {
  it('trois lignes pièce (trois articles distincts) réservées -> une seule annulation de l’OR libère les TROIS réservations', async () => {
    const cookiePiece = await cookiePieces();
    const a1 = await articleAvecStockPourTest(cookiePiece, 3000);
    const a2 = await articleAvecStockPourTest(cookiePiece, 3000);
    const a3 = await articleAvecStockPourTest(cookiePiece, 3000);
    const or = await creerOrFrais();
    const cookie = await cookieAtelier();

    const l1 = await creerLignePiece(ctx, cookie, or.id, a1.articleId, 1000);
    const l2 = await creerLignePiece(ctx, cookie, or.id, a2.articleId, 1500);
    const l3 = await creerLignePiece(ctx, cookie, or.id, a3.articleId, 500);
    for (const l of [l1, l2, l3]) expect(l.status, JSON.stringify(l.body)).toBe(201);
    const ligneIds = [l1, l2, l3].map((l) => (l.body as { donnees: { id: string } }).donnees.id);

    const annulation = await annulerOr(ctx, cookie, or.id);
    expect(annulation.status, JSON.stringify(annulation.body)).toBeLessThan(300);

    const reservations = await listerReservations(ctx, cookiePiece, { ordreReparationId: or.id });
    const donnees = (reservations.body as { donnees: readonly Record<string, unknown>[] }).donnees;
    expect(donnees).toHaveLength(3);
    for (const ligneId of ligneIds) {
      const r = donnees.find((d) => d.ligneOrId === ligneId);
      expect(r, `réservation de la ligne ${ligneId}`).toMatchObject({
        statut: 'liberee',
        motifLiberation: 'annulation_ligne',
      });
    }

    // Chaque article a retrouvé son disponible complet.
    for (const { articleId, siteId } of [a1, a2, a3]) {
      const stock = await disponibilite(ctx, cookiePiece, articleId, siteId);
      expect(stock.body).toMatchObject({
        quantitePhysiqueMillieme: 3000,
        quantiteReserveeMillieme: 0,
        quantiteDisponibleMillieme: 3000,
      });
    }
  });
});

// =================================================================================================
// 3. RM-62 — distinction lignes `active` vs `realisee` (pièce déjà sortie).
// =================================================================================================

describe("RM-62 : une pièce déjà SORTIE (ligne realisee) bloque l'annulation de l'OR entier, elle ne se « libère » pas", () => {
  it('OR avec une seule ligne pièce déjà `realisee` (réservation `satisfaite`) -> annulation refusée (409 OR_ANNULATION_IMPOSSIBLE), réservation INCHANGÉE, OR toujours `ouvert`', async () => {
    const { articleId, siteId } = await articleAvecStockPourTest(await cookiePieces(), 4000);
    const or = await creerOrFrais();
    const cookie = await cookieAtelier();

    const ligne = await creerLignePiece(ctx, cookie, or.id, articleId, 1000);
    expect(ligne.status, JSON.stringify(ligne.body)).toBe(201);
    const ligneId = (ligne.body as { donnees: { id: string } }).donnees.id;

    // `en_cours` -> `realisee` : seul chemin qui sorte la pièce du stock (précondition d'un
    // pointage démarré, RM-117 — même patron que `poserLigneEtDemarrer` du fichier sœur).
    const pointage = await demarrerPointage(ctx, cookie, {
      siteId,
      technicienId: garage.tenantA.utilisateursParRole.technicien.id,
      ordreReparationId: or.id,
      ligneOrId: ligneId,
    });
    expect(pointage.status, JSON.stringify(pointage.body)).toBeLessThan(300);
    const pointageId = (pointage.body as { donnees: { id: string } }).donnees.id;

    const realisation = await marquerRealisee(ctx, cookie, or.id, ligneId);
    expect(realisation.status, JSON.stringify(realisation.body)).toBe(201);

    // `marquerRealisee` NE ferme PAS le pointage tout seul (vérifié : `ServiceLigneOr.
    // marquerRealisee` n'appelle jamais `ServiceArret`/`ServicePointage.arreter`) — sans cet arrêt
    // explicite, le blocage RM-62 visé par CE test serait masqué par le blocage PRÉEXISTANT
    // « pointage ouvert » (I-09, `verifierPointageOuvert`), et ce test prouverait le mauvais garde-
    // fou. Isolé ici pour ne tester QUE la garde « pièce sortie » ajoutée par ce correctif.
    const arret = await arreterPointage(ctx, cookie, pointageId);
    expect(arret.status, JSON.stringify(arret.body)).toBeLessThan(300);

    const avantAnnulation = await listerReservations(ctx, await cookiePieces(), {
      ordreReparationId: or.id,
    });
    const reservationAvant = (
      avantAnnulation.body as { donnees: readonly Record<string, unknown>[] }
    ).donnees.find((r) => r.ligneOrId === ligneId);
    expect(reservationAvant).toMatchObject({ statut: 'satisfaite' });

    // La ligne est `realisee`, le pointage est arrêté, l'OR n'a AUCUNE facture : sans la garde
    // RM-62 ajoutée par ce correctif (`listerPiecesSortiesPourOrTx`), rien n'empêcherait
    // l'annulation de l'OR entier — c'est CE test qui le met sous test, isolément.
    const annulation = await annulerOr(ctx, cookie, or.id);
    expect(annulation.status, JSON.stringify(annulation.body)).toBe(409);
    expect((annulation.body as { code?: string }).code).toBe('OR_ANNULATION_IMPOSSIBLE');

    // Rien n'a bougé : la réservation reste `satisfaite` (JAMAIS « libérée » — la pièce est
    // réellement sortie du stock, la libérer serait faux) et l'OR reste `ouvert`.
    const apresAnnulation = await listerReservations(ctx, await cookiePieces(), {
      ordreReparationId: or.id,
    });
    expect(
      (apresAnnulation.body as { donnees: readonly Record<string, unknown>[] }).donnees.find(
        (r) => r.ligneOrId === ligneId,
      ),
    ).toMatchObject({ statut: 'satisfaite' });

    const document = await obtenirOr(ctx, cookie, or.id);
    expect((document.body as { statut: string }).statut).not.toBe('annule');

    const stock = await disponibilite(ctx, await cookiePieces(), articleId, siteId);
    expect(stock.body).toMatchObject({
      quantitePhysiqueMillieme: 3000, // 4000 - 1000 sortis
      quantiteReserveeMillieme: 0,
      quantiteDisponibleMillieme: 3000,
    });
  });

  it("OR avec DEUX lignes pièce — une `realisee` (bloquante), une encore `active` — l'annulation refuse ET laisse la réservation active INTACTE (tout-ou-rien, aucune libération partielle)", async () => {
    const cookiePiece = await cookiePieces();
    const aRealisee = await articleAvecStockPourTest(cookiePiece, 2000);
    const aActive = await articleAvecStockPourTest(cookiePiece, 2000);
    const or = await creerOrFrais();
    const cookie = await cookieAtelier();

    const ligneRealisee = await creerLignePiece(ctx, cookie, or.id, aRealisee.articleId, 500);
    expect(ligneRealisee.status, JSON.stringify(ligneRealisee.body)).toBe(201);
    const ligneRealiseeId = (ligneRealisee.body as { donnees: { id: string } }).donnees.id;

    const ligneActive = await creerLignePiece(ctx, cookie, or.id, aActive.articleId, 700);
    expect(ligneActive.status, JSON.stringify(ligneActive.body)).toBe(201);
    const ligneActiveId = (ligneActive.body as { donnees: { id: string } }).donnees.id;

    const pointage = await demarrerPointage(ctx, cookie, {
      siteId: aRealisee.siteId,
      technicienId: garage.tenantA.utilisateursParRole.technicien.id,
      ordreReparationId: or.id,
      ligneOrId: ligneRealiseeId,
    });
    expect(pointage.status, JSON.stringify(pointage.body)).toBeLessThan(300);
    const pointageId = (pointage.body as { donnees: { id: string } }).donnees.id;
    const realisation = await marquerRealisee(ctx, cookie, or.id, ligneRealiseeId);
    expect(realisation.status, JSON.stringify(realisation.body)).toBe(201);
    // Isole la garde « pièce sortie » (RM-62) du blocage préexistant « pointage ouvert » (I-09) —
    // même raison que le test précédent.
    const arret = await arreterPointage(ctx, cookie, pointageId);
    expect(arret.status, JSON.stringify(arret.body)).toBeLessThan(300);

    const annulation = await annulerOr(ctx, cookie, or.id);
    expect(annulation.status, JSON.stringify(annulation.body)).toBe(409);

    // La ligne encore active AVANT la tentative d'annulation doit rester EXACTEMENT active après
    // — la garde s'évalue AVANT toute écriture, aucune libération partielle ne doit avoir eu lieu.
    const reservations = await listerReservations(ctx, cookiePiece, { ordreReparationId: or.id });
    const donnees = (reservations.body as { donnees: readonly Record<string, unknown>[] }).donnees;
    expect(donnees.find((r) => r.ligneOrId === ligneActiveId)).toMatchObject({
      statut: 'active',
      quantiteMillieme: 700,
    });
    expect(donnees.find((r) => r.ligneOrId === ligneRealiseeId)).toMatchObject({
      statut: 'satisfaite',
    });

    const stockActive = await disponibilite(ctx, cookiePiece, aActive.articleId, aActive.siteId);
    expect(stockActive.body).toMatchObject({
      quantitePhysiqueMillieme: 2000,
      quantiteReserveeMillieme: 700,
      quantiteDisponibleMillieme: 1300,
    });
  });
});
