/**
 * Pont ATELIER ↔ PIÈCES, sur vraie base PostgreSQL (testcontainers), vraie app NestJS, vraies
 * requêtes HTTP (`supertest`) — voir `fixtures-pont-atelier-pieces.ts` pour le détail des aides.
 *
 * CE QUE LE PONT FAIT (livré la veille de cette tâche, brief) : poser une ligne de type `piece`
 * sur un OR **réserve** le stock (`ServiceLigneOr.reserverPieceSiApplicable`, RP-19/RP-20) ;
 * marquer la ligne réalisée **sort** la pièce et pose la **consigne** si l'article est un échange
 * standard (`ServiceLigneOr.satisfaireReservationSiApplicable` -> `ServiceReservation.
 * satisfairePourLigneTx` / `ServiceConsigne.creerDepuisRealisationTx`, RP-21/RP-38) ; annuler ou
 * refuser la ligne **libère** la réservation (`ServiceReservation.libererPourLigneTx`, RP-23). Le
 * tout se produit DANS LA MÊME TRANSACTION que le changement d'état de la ligne — c'est exactement
 * ce que ce fichier met sous test, en priorité sur tout le reste (CONTRIBUTING.md : l'arithmétique de
 * stock est de l'argent).
 *
 * POINT DE CONCEPTION RESPECTÉ, PAS « CORRIGÉ » (RP-24) : un stock insuffisant à la POSE d'une
 * ligne ne rend PAS d'erreur HTTP — la ligne bascule `blocage: 'pieces'`, en suivant le `hint` du
 * déclencheur SQL `reservation_piece_verrouiller_stock` (migration 0026, SQLSTATE `ZDFA4`). Aucun
 * test ci-dessous n'attend un `409` là où le contrat prévoit ce blocage.
 *
 * DISCIPLINE ANTI-COLLISION (même piège que documenté dans `cycle-vente-vehicule.spec.ts` : deux
 * tests d'aujourd'hui ont déjà révélé une dépendance à l'ordre d'exécution) : CHAQUE `it` sème son
 * PROPRE article (`creerArticle`/`creerArticleEchangeStandard`, jamais un article réutilisé d'un
 * autre test) et son PROPRE ordre de réparation (`creerOrFrais`). `GET /articles/{id}/mouvements`
 * est de ce fait NATURELLEMENT scopé au test courant (un article neuf n'a que les mouvements que
 * CE test a produits) — aucun comptage d'ensemble n'est jamais nécessaire, uniquement des
 * assertions sur les valeurs EXACTES vues depuis un état de départ connu.
 *
 * Périmètre d'écriture : `apps/api/test/**` uniquement (CONTRIBUTING.md, brief de cette tâche).
 */

import { randomUUID } from 'node:crypto';
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
  creerOrPourTest,
  semerGarageDemoLot1,
  type GarageDemoLot1Fixture,
} from '../../lot1/fixtures/garage-demo-lot1';
import {
  ajustementInventaire,
  annulerLignes,
  casse,
  construireCookiePour,
  creerArticle,
  creerArticleEchangeStandard,
  creerLignePiece,
  demarrerPointage,
  disponibilite,
  listerConsignes,
  listerMouvements,
  listerReservations,
  marquerRealisee,
  obtenirOr,
  retourClient,
  sortieComptoir,
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

/** OR frais, statut `planifie` — pointable (RM-92 : un `planifie` reste pointable) et jamais
 *  verrouillé (`estOrVerrouille`, `service-or.ts`) : suffisant comme porteur pour tout ce fichier,
 *  qui ne teste JAMAIS la machine à états de l'OR lui-même, seulement celle de la ligne/pièce. */
async function creerOrFrais() {
  const t = garage.tenantA;
  return creerOrPourTest(bdd, t.tenant, SITE_A(), t.clients[0]!, t.vehicules[0]!);
}

/** `chef_atelier` porte TOUT ce dont l'atelier a besoin ici : `atelier.ligne.creer` (hérité de
 *  `receptionnaire`), `atelier.ligne.marquer_realisee`, `atelier.ligne.annuler` (`INFERE_LIGNE_
 *  DECISION`) ET les trois droits de pointage (`demarrer`/`arreter`/`lire`, `pointer_autrui` —
 *  voir `DROITS_POINTAGE_PAR_ROLE.chef_atelier`, `matrice-droits.ts`) : une seule persona pour
 *  tout le côté atelier du pont, jamais recomposée ligne à ligne dans chaque `it`. */
async function cookieAtelier() {
  return cookiePour(garage.tenantA, 'chef_atelier');
}

/** `magasinier` — seul rôle du référentiel à porter `pieces.mouvement.creer` ET `pieces.mouvement.
 *  forcer` (couplage DÉLIBÉRÉ, voir `matrice-droits.ts` ~L1146-1162 : « si `pieces.mouvement.creer`
 *  est un jour étendu à un autre rôle, ce fichier devra statuer explicitement sur `forcer` pour ce
 *  rôle » — donc AUCUN autre rôle ne peut aujourd'hui créer le moindre mouvement de stock). */
async function cookiePieces() {
  return cookiePour(garage.tenantA, 'magasinier');
}

/** Article + stock frais (comptage initial via `ajustement-inventaire`, JAMAIS une quantité
 *  physique posée directement — RP-16, `stock.controller.ts` : « PATCH stock, JAMAIS la quantité
 *  physique »). Rend `{ articleId }` et le `siteId` sur lequel le stock a été posé. */
async function articleAvecStock(
  quantitePhysiqueMillieme: number,
  overrides: Record<string, unknown> = {},
): Promise<{ articleId: string; siteId: string }> {
  const cookie = await cookiePieces();
  const article = await creerArticle(ctx, cookie, overrides);
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

async function articleEchangeStandardAvecStock(
  quantitePhysiqueMillieme: number,
  montantConsigneTtcCentimes = 8000,
): Promise<{ articleId: string; siteId: string }> {
  const cookie = await cookiePieces();
  const article = await creerArticleEchangeStandard(ctx, cookie, montantConsigneTtcCentimes);
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

/** Pose une ligne `piece` (via l'atelier) PUIS démarre un pointage dessus — SEUL chemin qui fasse
 *  passer `ligne_or.statut` `validee -> en_cours` (RM-117, `pointage/regles-pointage.ts`),
 *  précondition de `marquer-realisee` (`en_cours -> realisee`, CT-28). Rend l'id de la ligne créée
 *  et son corps complet (pour vérifier `blocage`/`statut` juste après la pose, AVANT le pointage).
 */
async function poserLigneEtDemarrer(
  orId: string,
  articleId: string,
  siteId: string,
  quantiteMillieme: number,
): Promise<{ ligneId: string; ligneCreee: Record<string, unknown> }> {
  const cookie = await cookieAtelier();
  const ligne = await creerLignePiece(ctx, cookie, orId, articleId, quantiteMillieme);
  expect(ligne.status, JSON.stringify(ligne.body)).toBe(201);
  const ligneCreee = (ligne.body as { donnees: Record<string, unknown> }).donnees;
  const ligneId = ligneCreee.id as string;

  const pointage = await demarrerPointage(ctx, cookie, {
    siteId,
    technicienId: garage.tenantA.utilisateursParRole.technicien.id,
    ordreReparationId: orId,
    ligneOrId: ligneId,
  });
  expect(pointage.status, JSON.stringify(pointage.body)).toBeLessThan(300);

  return { ligneId, ligneCreee };
}

async function ligneDansOr(orId: string, ligneId: string): Promise<Record<string, unknown>> {
  const cookie = await cookieAtelier();
  const document = await obtenirOr(ctx, cookie, orId);
  expect(document.status, JSON.stringify(document.body)).toBe(200);
  const lignes = (document.body as { lignes: readonly Record<string, unknown>[] }).lignes;
  const ligne = lignes.find((l) => l.id === ligneId);
  if (!ligne) throw new Error(`Ligne ${ligneId} introuvable dans le document OR ${orId}.`);
  return ligne;
}

// =================================================================================================
// 1. Cycle complet, article ORDINAIRE (pas d'échange standard) : pose -> réservation exacte,
//    réalise -> sortie exacte, sans consigne.
// =================================================================================================

describe('cycle complet : poser une ligne pièce réserve, marquer réalisée sort du stock (article sans échange standard)', () => {
  it('poser une ligne pièce réserve EXACTEMENT la quantité demandée, sans toucher au stock physique', async () => {
    const { articleId, siteId } = await articleAvecStock(5000);
    const or = await creerOrFrais();

    const avant = await disponibilite(ctx, await cookiePieces(), articleId, siteId);
    expect(avant.status).toBe(200);
    expect(avant.body).toMatchObject({
      quantitePhysiqueMillieme: 5000,
      quantiteReserveeMillieme: 0,
      quantiteDisponibleMillieme: 5000,
    });

    const cookie = await cookieAtelier();
    const ligne = await creerLignePiece(ctx, cookie, or.id, articleId, 2000);
    expect(ligne.status, JSON.stringify(ligne.body)).toBe(201);
    const donnees = (ligne.body as { donnees: Record<string, unknown> }).donnees;
    expect(donnees.blocage).toBe('aucun');
    expect(donnees.statut).toBe('validee');
    const ligneId = donnees.id as string;

    // Le physique n'a PAS bougé — seule la réservation existe pour l'instant.
    const apres = await disponibilite(ctx, await cookiePieces(), articleId, siteId);
    expect(apres.body).toMatchObject({
      quantitePhysiqueMillieme: 5000,
      quantiteReserveeMillieme: 2000,
      quantiteDisponibleMillieme: 3000,
    });

    const reservations = await listerReservations(ctx, await cookiePieces(), {
      ordreReparationId: or.id,
    });
    expect(reservations.status, JSON.stringify(reservations.body)).toBe(200);
    const page = reservations.body as { donnees: readonly Record<string, unknown>[] };
    expect(page.donnees).toHaveLength(1);
    expect(page.donnees[0]).toMatchObject({
      articleId,
      ligneOrId: ligneId,
      ordreReparationId: or.id,
      quantiteMillieme: 2000,
      statut: 'active',
    });
  });

  it('marquer réalisée sort la pièce du stock : mouvement sortie_or EXACT, réservation satisfaite, AUCUNE consigne (article pas échange standard)', async () => {
    const { articleId, siteId } = await articleAvecStock(5000);
    const or = await creerOrFrais();
    const { ligneId } = await poserLigneEtDemarrer(or.id, articleId, siteId, 2000);

    // `201`, PAS `200` : `marquerRealisee` (`ligne-or.controller.ts`) ne porte aucun `@HttpCode`
    // explicite — défaut NestJS d'un `@Post` sans décorateur, même piège déjà documenté par
    // `test/lot1/metier-machine-etats-or.spec.ts` sur des routes sœurs du même style. Mesuré en
    // exécution, pas supposé.
    const realisation = await marquerRealisee(ctx, await cookieAtelier(), or.id, ligneId);
    expect(realisation.status, JSON.stringify(realisation.body)).toBe(201);
    expect((realisation.body as { donnees: { statut: string } }).donnees.statut).toBe('realisee');

    // Stock : 5000 physiques, 2000 sortis, 0 réservé restant (la réservation vient d'être
    // satisfaite) -> 3000 disponible.
    const stock = await disponibilite(ctx, await cookiePieces(), articleId, siteId);
    expect(stock.body).toMatchObject({
      quantitePhysiqueMillieme: 3000,
      quantiteReserveeMillieme: 0,
      quantiteDisponibleMillieme: 3000,
    });

    const reservations = await listerReservations(ctx, await cookiePieces(), {
      ordreReparationId: or.id,
    });
    const reservation = (reservations.body as { donnees: readonly Record<string, unknown>[] })
      .donnees[0];
    expect(reservation).toMatchObject({ statut: 'satisfaite', quantiteMillieme: 2000 });
    expect(reservation!.mouvementSortieId).not.toBeNull();

    // Le mouvement lui-même : signé négatif (RP-17), rattaché à CETTE ligne.
    const mouvements = await listerMouvements(ctx, await cookiePieces(), articleId, {
      type: 'sortie_or',
    });
    const mvts = (mouvements.body as { donnees: readonly Record<string, unknown>[] }).donnees;
    expect(mvts).toHaveLength(1);
    expect(mvts[0]).toMatchObject({
      quantiteMillieme: -2000,
      ligneOrId: ligneId,
      type: 'sortie_or',
    });

    // Aucune consigne posée pour CETTE ligne — l'article n'est pas un échange standard.
    const consignes = await listerConsignes(ctx, await cookiePieces(), { siteId });
    const consignesDeCetteLigne = (
      consignes.body as { donnees: readonly Record<string, unknown>[] }
    ).donnees.filter((c) => c.ligneOrId === ligneId);
    expect(consignesDeCetteLigne).toEqual([]);
  });
});

// =================================================================================================
// 2. Consigne d'échange standard (RP-37/RP-38) : la vieille pièce revient EN STOCK (même article,
//    signe positif) dans le MÊME geste que la sortie — montant figé, exact.
// =================================================================================================

describe('consigne d’échange standard : réaliser une ligne dont l’article est échange standard pose la consigne', () => {
  it('sortie_or (-qty) ET retour_consigne (+qty) sont TOUS LES DEUX générés ; le physique net est inchangé ; la consigne porte le montant EXACT figé sur l’article', async () => {
    const { articleId, siteId } = await articleEchangeStandardAvecStock(3000, 8000);
    const or = await creerOrFrais();
    const { ligneId } = await poserLigneEtDemarrer(or.id, articleId, siteId, 1000);

    const realisation = await marquerRealisee(ctx, await cookieAtelier(), or.id, ligneId);
    expect(realisation.status, JSON.stringify(realisation.body)).toBe(201);

    // 3000 physiques : -1000 (sortie de la pièce neuve) +1000 (entrée du cœur échangé, RP-38 :
    // « c'est LE MÊME geste ») -> 3000, net INCHANGÉ. Réservé retombe à 0.
    const stock = await disponibilite(ctx, await cookiePieces(), articleId, siteId);
    expect(stock.body).toMatchObject({
      quantitePhysiqueMillieme: 3000,
      quantiteReserveeMillieme: 0,
      quantiteDisponibleMillieme: 3000,
    });

    const mouvements = await listerMouvements(ctx, await cookiePieces(), articleId, {});
    const parType = (mouvements.body as { donnees: readonly Record<string, unknown>[] }).donnees;
    const sortie = parType.find((m) => m.type === 'sortie_or');
    const entree = parType.find((m) => m.type === 'retour_consigne');
    expect(sortie).toMatchObject({ quantiteMillieme: -1000, ligneOrId: ligneId });
    expect(entree).toMatchObject({ quantiteMillieme: 1000, ligneOrId: ligneId });

    const consignes = await listerConsignes(ctx, await cookiePieces(), { siteId });
    const consigne = (
      consignes.body as { donnees: readonly Record<string, unknown>[] }
    ).donnees.find((c) => c.ligneOrId === ligneId);
    expect(consigne, JSON.stringify(consignes.body)).toBeDefined();
    expect(consigne).toMatchObject({
      articleId,
      ordreReparationId: or.id,
      statut: 'en_attente_retour_fournisseur',
      // Jamais `toBeCloseTo` sur de l'argent (CONTRIBUTING.md) : exactement le montant figé sur
      // l'article au moment de la pose (RP-38 : « figé TTC, jamais recalculé »).
      montantConsigneTtcCentimes: 8000,
      mouvementEntreeId: entree!.id,
    });
  });
});

// =================================================================================================
// 3. RP-24 : stock insuffisant à la POSE — DEVRAIT basculer blocage='pieces', PAS d'erreur HTTP
//    (le point de conception que le brief de cette tâche demande explicitement de RESPECTER, pas
//    de re-tester en 409).
//
// DÉFAUT MAJEUR CONSTATÉ EN EXÉCUTION, PAS SUPPOSÉ (`ServiceLigneOr.reserverPieceSiApplicable`,
// `atelier/service-ligne-or.ts` ~L869-887) : le mécanisme de rattrapage ZDFA4 EST LUI-MÊME CASSÉ,
// pour une raison différente de celle attendue. Preuve obtenue par reproduction directe en SQL
// (deux transactions séparées, hors HTTP) :
//   1. `INSERT INTO reservation_piece (...)` avec une quantité qui dépasse le disponible échoue
//      bien avec le SQLSTATE `ZDFA4` attendu (message : « La ligne d'OR doit basculer
//      blocage='pieces' … »).
//   2. Un `UPDATE ligne_or SET blocage = 'pieces' …` **indépendant** (sa propre transaction)
//      réussit sans problème.
// Mais dans le CODE RÉEL, ces deux instructions s'exécutent DANS LA MÊME transaction Drizzle
// (`AccesBase.enTenant`) — et PostgreSQL, une fois qu'une instruction A ÉCHOUÉ dans une
// transaction, bascule celle-ci en état « aborted » : **toute instruction suivante y est
// rejetée** (`25P02 current transaction is aborted`), MÊME si elle est par ailleurs parfaitement
// valide, TANT QU'aucun `ROLLBACK`/`ROLLBACK TO SAVEPOINT` n'a eu lieu. Le `try/catch` JavaScript
// de `reserverPieceSiApplicable` attrape bien l'exception ZDFA4 côté application, mais ne fait
// RIEN pour désamorcer l'état « aborted » côté PostgreSQL avant de tenter l'`UPDATE` de
// rattrapage (`tx.update(ligneOr).set({ blocage: 'pieces' })…`) — cet `UPDATE` échoue alors À SON
// TOUR, avec une erreur DIFFÉRENTE et NON reconnue (le code ne vérifie que ZDFA4, une seule fois),
// qui se propage donc TELLE QUELLE jusqu'au filtre global : `500 ERREUR_INTERNE`, jamais le `201`
// documenté. CORRECTIF probable (hors périmètre `apps/api/test/**`, signalé pas appliqué) : un
// `SAVEPOINT` posé avant l'`INSERT` spéculatif, `ROLLBACK TO SAVEPOINT` dans le `catch` avant de
// tenter l'`UPDATE` — exactement le rôle qu'un `SAVEPOINT` joue dans ce genre de récupération.
//
// CONSÉQUENCE MESURÉE : RP-24 ne fonctionne JAMAIS aujourd'hui par le chemin HTTP réel. Section
// scindée en deux : le test qui suit documente et PROUVE le comportement RÉEL actuel (500, ET
// — fait notable — la transaction entière est annulée : la ligne elle-même n'est jamais créée,
// pas même bloquée) ; le second documente le comportement ATTENDU PAR LE CONTRAT et reste ROUGE.
// =================================================================================================

describe('RP-24 — stock insuffisant à la pose : blocage="pieces", jamais un 409', () => {
  it(
    'CONSTAT RÉEL (mesuré en exécution) : le rattrapage ZDFA4 échoue LUI-MÊME (transaction ' +
      'PostgreSQL déjà « aborted », voir analyse ci-dessus) — la création rend `500 ' +
      'ERREUR_INTERNE`, et la transaction ENTIÈRE est annulée : aucune ligne, aucune réservation, ' +
      "aucun mouvement ne survit à la tentative (au moins l'atomicité elle-même reste intacte)",
    async () => {
      const { articleId, siteId } = await articleAvecStock(1000);
      const or = await creerOrFrais();

      const cookie = await cookieAtelier();
      const ligne = await creerLignePiece(ctx, cookie, or.id, articleId, 5000);
      expect(ligne.status, JSON.stringify(ligne.body)).toBe(500);
      expect((ligne.body as { code?: string }).code).toBe('ERREUR_INTERNE');

      // La transaction a TOUT annulé, y compris l'INSERT de la ligne elle-même : le document OR
      // ne porte AUCUNE ligne.
      const document = await obtenirOr(ctx, cookie, or.id);
      expect((document.body as { lignes: readonly unknown[] }).lignes).toEqual([]);

      const stock = await disponibilite(ctx, await cookiePieces(), articleId, siteId);
      expect(stock.body).toMatchObject({
        quantitePhysiqueMillieme: 1000,
        quantiteReserveeMillieme: 0,
        quantiteDisponibleMillieme: 1000,
      });

      const mouvements = await listerMouvements(ctx, await cookiePieces(), articleId, {});
      const types = (
        mouvements.body as { donnees: readonly Record<string, unknown>[] }
      ).donnees.map((m) => m.type);
      expect(types).toEqual(['ajustement_inventaire']);
    },
  );

  it(
    'DÉFAUT CONSTATÉ (documenté, PAS corrigé — hors périmètre `apps/api/test/**`) : le contrat ' +
      '(RP-24, brief de cette tâche) exige `201` avec `blocage: "pieces"`, jamais un `409` NI, a ' +
      'fortiori, un `500` — ce test documente le comportement ATTENDU et reste ROUGE tant que le ' +
      'rattrapage ZDFA4 (voir l’analyse en tête de section) n’est pas corrigé.',
    async () => {
      const { articleId } = await articleAvecStock(1000);
      const or = await creerOrFrais();
      const cookie = await cookieAtelier();

      const ligne = await creerLignePiece(ctx, cookie, or.id, articleId, 5000);
      expect(ligne.status, JSON.stringify(ligne.body)).toBe(201);
      expect((ligne.body as { donnees: { blocage: string } }).donnees.blocage).toBe('pieces');
    },
  );
});

// =================================================================================================
// 4. Atomicité RÉELLE : réserver puis réaliser EXACTEMENT 100% du disponible provoque un échec
//    RÉEL (contrainte SQL `stock_article_reservee_leq_physique_chk`, pas une simulation) — TOUT
//    doit rester annulé : la ligne reste `en_cours`, la réservation reste `active`, aucun
//    mouvement n'est créé, le stock est inchangé.
//
// CAUSE DU DÉCLENCHEMENT (analyse, PROUVÉE par le test qui suit, pas seulement affirmée) :
// `ServiceReservation.appliquerSatisfaction` écrit en DEUX temps DANS LA MÊME transaction :
//   1. INSERT mouvement_stock('sortie_or', -qty)     -> stock_article.physique -= qty IMMÉDIAT
//   2. UPDATE reservation_piece SET statut='satisfaite' -> stock_article.reservee -= qty (APRÈS)
// La contrainte CHECK `reservee <= physique` (0025, filet ultime) est évaluée IMMÉDIATEMENT à la
// fin de CHAQUE instruction (les CHECK ne sont jamais DEFERRABLE en PostgreSQL). Entre l'étape 1 et
// l'étape 2, `reservee` porte encore son ANCIENNE valeur alors que `physique` a DÉJÀ baissé : si
// cette ligne consomme la totalité du disponible (aucun autre exemplaire non réservé sur ce
// (article, site)), l'étape 1 fait passer `physique` EN DESSOUS de `reservee` (qui, lui, n'a pas
// encore bougé) — la contrainte est violée AVANT que l'étape 2 n'ait eu la chance de la
// rétablir. PostgreSQL annule alors TOUTE la transaction — exactement le comportement qu'un test
// d'atomicité doit constater, jamais simuler.
// =================================================================================================

describe('atomicité réelle : marquer réalisée une ligne dont la réservation couvre 100% du disponible', () => {
  it(
    'échoue réellement (contrainte stock_article_reservee_leq_physique_chk, pas un mock) ET annule ' +
      'TOUT : la ligne reste `en_cours`, la réservation reste `active`, aucun mouvement de sortie ' +
      "n'est créé, le stock physique/réservé est EXACTEMENT celui d'avant la tentative",
    async () => {
      const { articleId, siteId } = await articleAvecStock(2000);
      const or = await creerOrFrais();
      // Réserve EXACTEMENT tout le disponible (2000/2000) : aucun exemplaire non réservé ne reste
      // sur ce (article, site) — précondition du déclenchement documenté ci-dessus.
      const { ligneId } = await poserLigneEtDemarrer(or.id, articleId, siteId, 2000);

      const avant = await disponibilite(ctx, await cookiePieces(), articleId, siteId);
      expect(avant.body).toMatchObject({
        quantitePhysiqueMillieme: 2000,
        quantiteReserveeMillieme: 2000,
        quantiteDisponibleMillieme: 0,
      });
      const ligneAvant = await ligneDansOr(or.id, ligneId);
      expect(ligneAvant.statut).toBe('en_cours');

      const realisation = await marquerRealisee(ctx, await cookieAtelier(), or.id, ligneId);
      // Échec RÉEL et INATTENDU (pas un refus métier propre) : le filtre global
      // (`filtre-probleme.ts`) traduit toute exception NON `ErreurMetier` en 500 `ERREUR_INTERNE` —
      // c'est exactement ce qui doit sortir ici, la preuve que rien n'a été avalé en silence.
      expect(realisation.status, JSON.stringify(realisation.body)).toBe(500);
      expect((realisation.body as { code?: string }).code).toBe('ERREUR_INTERNE');

      // TOUT a été annulé — y compris la transition de la ligne, déjà écrite plus tôt dans la
      // MÊME transaction que la tentative de sortie.
      const ligneApres = await ligneDansOr(or.id, ligneId);
      expect(ligneApres.statut).toBe('en_cours');

      const reservations = await listerReservations(ctx, await cookiePieces(), {
        ordreReparationId: or.id,
      });
      const reservation = (
        reservations.body as { donnees: readonly Record<string, unknown>[] }
      ).donnees.find((r) => r.ligneOrId === ligneId);
      expect(reservation).toMatchObject({ statut: 'active', quantiteMillieme: 2000 });

      const stockApres = await disponibilite(ctx, await cookiePieces(), articleId, siteId);
      expect(stockApres.body).toMatchObject({
        quantitePhysiqueMillieme: 2000,
        quantiteReserveeMillieme: 2000,
        quantiteDisponibleMillieme: 0,
      });

      // Aucun mouvement de sortie (ni de consigne) n'a survécu — seul le comptage initial reste.
      const mouvements = await listerMouvements(ctx, await cookiePieces(), articleId, {});
      const types = (
        mouvements.body as { donnees: readonly Record<string, unknown>[] }
      ).donnees.map((m) => m.type);
      expect(types).toEqual(['ajustement_inventaire']);
    },
  );

  it(
    'DÉFAUT CONSTATÉ (documenté, PAS corrigé — hors périmètre `apps/api/test/**`) : ce scénario ' +
      'est pourtant un cas métier PARFAITEMENT ORDINAIRE (« la dernière pièce en stock sert à ' +
      'terminer LA réparation qui l’a réservée ») — il ne devrait PAS échouer. La transition est ' +
      "annulée proprement (test précédent), mais l'atelier ne peut structurellement JAMAIS clôturer " +
      "un travail qui a consommé 100% du disponible d'un article, ce qui est strictement pire que ce " +
      'que RP-24 (blocage à la POSE) anticipe — RP-24 ne couvre que le cas où le disponible manque ' +
      'AVANT la réservation, pas celui où il devient nul PAR la réservation elle-même puis se heurte ' +
      "à l'ordre d'écriture de `appliquerSatisfaction` (voir l'analyse en tête de section). Ce test " +
      'documente le comportement ATTENDU (succès) et reste ROUGE tant que ce n’est pas corrigé — ' +
      'CONTRIBUTING.md : « un test qui documente un vrai défaut est un bon test ».',
    async () => {
      const { articleId, siteId } = await articleAvecStock(1000);
      const or = await creerOrFrais();
      const { ligneId } = await poserLigneEtDemarrer(or.id, articleId, siteId, 1000);

      const realisation = await marquerRealisee(ctx, await cookieAtelier(), or.id, ligneId);
      expect(realisation.status, JSON.stringify(realisation.body)).toBeLessThan(300);
    },
  );
});

// =================================================================================================
// 5. Isolation inter-tenant — un article, une réservation, un mouvement, une consigne d'un tenant
//    ne sont NI visibles NI manipulables depuis un autre tenant.
// =================================================================================================

describe('isolation inter-tenant du pont atelier ↔ pièces', () => {
  it("tenant B ne peut lire ni le stock, ni les mouvements d'un article de tenant A (404)", async () => {
    const { articleId, siteId } = await articleAvecStock(1000);
    const cookieB = await cookiePour(garage.tenantB, 'magasinier');

    const stock = await disponibilite(ctx, cookieB, articleId, siteId);
    expect(stock.status, JSON.stringify(stock.body)).toBe(404);
    expect((stock.body as { code?: string }).code).toBe('RESSOURCE_INTROUVABLE');

    const mouvements = await listerMouvements(ctx, cookieB, articleId, {});
    expect(mouvements.status, JSON.stringify(mouvements.body)).toBe(404);
  });

  it("tenant B ne peut ni lire ni manipuler l'OR/la ligne de tenant A (404, jamais 403)", async () => {
    const { articleId, siteId } = await articleAvecStock(2000);
    const or = await creerOrFrais();
    const { ligneId } = await poserLigneEtDemarrer(or.id, articleId, siteId, 1000);

    const cookieB = await cookiePour(garage.tenantB, 'chef_atelier');
    const lecture = await obtenirOr(ctx, cookieB, or.id);
    expect(lecture.status).toBe(404);

    const realisation = await marquerRealisee(ctx, cookieB, or.id, ligneId);
    expect(realisation.status, JSON.stringify(realisation.body)).toBe(404);

    // Rien n'a bougé côté tenant A.
    const ligneApres = await ligneDansOr(or.id, ligneId);
    expect(ligneApres.statut).toBe('en_cours');
  });

  it(
    'la réservation ET la consigne de tenant A sont invisibles depuis tenant B (les collections ' +
      'sont filtrées par tenant, RLS) — même quand tenant B interroge EXACTEMENT le même ' +
      'ordreReparationId/siteId',
    async () => {
      const { articleId, siteId } = await articleEchangeStandardAvecStock(2000, 5500);
      const or = await creerOrFrais();
      const { ligneId } = await poserLigneEtDemarrer(or.id, articleId, siteId, 1000);
      await marquerRealisee(ctx, await cookieAtelier(), or.id, ligneId);

      const cookieB = await cookiePour(garage.tenantB, 'magasinier');
      const reservationsB = await listerReservations(ctx, cookieB, { ordreReparationId: or.id });
      expect(reservationsB.status).toBe(200);
      expect((reservationsB.body as { donnees: readonly unknown[] }).donnees).toEqual([]);

      const consignesB = await listerConsignes(ctx, cookieB, { siteId });
      expect(consignesB.status).toBe(200);
      const fuite = (
        consignesB.body as { donnees: readonly Record<string, unknown>[] }
      ).donnees.some((c) => c.ligneOrId === ligneId);
      expect(fuite).toBe(false);
    },
  );

  it(
    'SQL brut, sous contexte tenant B : un UPDATE ciblant la réservation de tenant A n’affecte ' +
      'AUCUNE ligne (RLS, pas une erreur trompeuse) — même garantie que `annulation-commande-' +
      'fournisseur.spec.ts` pour `commande_fournisseur`',
    async () => {
      const { articleId } = await articleAvecStock(1000);
      const or = await creerOrFrais();
      const cookie = await cookieAtelier();
      const ligne = await creerLignePiece(ctx, cookie, or.id, articleId, 500);
      const ligneId = (ligne.body as { donnees: { id: string } }).donnees.id;

      const lignesAffectees = await requeteSousTenant(
        bdd.poolApp,
        garage.tenantB.tenant.id,
        "update reservation_piece set statut = 'liberee', liberee_le = now(), motif_liberation = 'liberation_manuelle', motif_liberation_texte = 'Intrus' where ligne_or_id = $1 returning id",
        [ligneId],
      );
      expect(lignesAffectees).toHaveLength(0);

      const reservations = await listerReservations(ctx, await cookiePieces(), {
        ordreReparationId: or.id,
      });
      const reservation = (
        reservations.body as { donnees: readonly Record<string, unknown>[] }
      ).donnees.find((r) => r.ligneOrId === ligneId);
      expect(reservation).toMatchObject({ statut: 'active', quantiteMillieme: 500 });
    },
  );
});

// =================================================================================================
// 6. Annuler une ligne libère sa réservation (RP-23, premier cas) — DANS LA MÊME transaction que
//    la transition de la ligne.
// =================================================================================================

describe('annuler une ligne libère AUTOMATIQUEMENT sa réservation (RP-23)', () => {
  it('annuler une ligne encore réservée (jamais réalisée) rend son stock disponible à l’identique de avant la pose', async () => {
    const { articleId, siteId } = await articleAvecStock(4000);
    const or = await creerOrFrais();
    const cookie = await cookieAtelier();

    const ligne = await creerLignePiece(ctx, cookie, or.id, articleId, 1500);
    expect(ligne.status, JSON.stringify(ligne.body)).toBe(201);
    const ligneId = (ligne.body as { donnees: { id: string } }).donnees.id;

    const pendant = await disponibilite(ctx, await cookiePieces(), articleId, siteId);
    expect(pendant.body).toMatchObject({
      quantitePhysiqueMillieme: 4000,
      quantiteReserveeMillieme: 1500,
      quantiteDisponibleMillieme: 2500,
    });

    const annulation = await annulerLignes(ctx, cookie, or.id, [ligneId]);
    expect(annulation.status, JSON.stringify(annulation.body)).toBeLessThan(300);

    // Le disponible est EXACTEMENT revenu à ce qu'il était avant la pose — la réservation n'existe
    // plus, aucun mouvement de stock n'a jamais été créé (annuler ne sort rien du stock, RP-23).
    const apres = await disponibilite(ctx, await cookiePieces(), articleId, siteId);
    expect(apres.body).toMatchObject({
      quantitePhysiqueMillieme: 4000,
      quantiteReserveeMillieme: 0,
      quantiteDisponibleMillieme: 4000,
    });

    const reservations = await listerReservations(ctx, await cookiePieces(), {
      ordreReparationId: or.id,
    });
    const reservation = (
      reservations.body as { donnees: readonly Record<string, unknown>[] }
    ).donnees.find((r) => r.ligneOrId === ligneId);
    expect(reservation).toMatchObject({
      statut: 'liberee',
      motifLiberation: 'annulation_ligne',
      quantiteMillieme: 1500,
    });

    const mouvements = await listerMouvements(ctx, await cookiePieces(), articleId, {});
    const types = (mouvements.body as { donnees: readonly Record<string, unknown>[] }).donnees.map(
      (m) => m.type,
    );
    expect(types).toEqual(['ajustement_inventaire']);
  });
});

// =================================================================================================
// 7. Vente au comptoir (sortie/retour) — idempotence : deux appels, MÊME clé, un SEUL mouvement.
// =================================================================================================

describe('vente au comptoir — sortie et retour client, idempotence réelle', () => {
  it('sortie-comptoir : deux appels avec la MÊME Idempotency-Key ne produisent qu’UN SEUL mouvement et rendent le même résultat', async () => {
    const { articleId, siteId } = await articleAvecStock(3000);
    const cookie = await cookiePieces();
    const cle = randomUUID();
    const corps = { siteId, quantiteMillieme: 500, motif: 'Vente comptoir de test' };

    // `ResultatCreationMouvement.corps` N'EST PAS enveloppé dans `{ donnees }` (à la différence de
    // `ligne-or`/`article`) — `ServiceMouvement.creerMouvementSortie` rend `versMouvementResponse(...)`
    // directement (`service-mouvement.ts`) : le mouvement EST le corps de la réponse.
    const premier = await sortieComptoir(ctx, cookie, articleId, corps, cle);
    expect(premier.status, JSON.stringify(premier.body)).toBe(201);
    const idPremier = (premier.body as { id: string }).id;

    const second = await sortieComptoir(ctx, cookie, articleId, corps, cle);
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    const idSecond = (second.body as { id: string }).id;
    // Même clé, même geste : le rejeu rend EXACTEMENT le même mouvement, jamais un second.
    expect(idSecond).toBe(idPremier);

    // Le stock n'a été décrémenté qu'UNE SEULE fois — 3000 - 500 = 2500, PAS 2000.
    const stock = await disponibilite(ctx, cookie, articleId, siteId);
    expect(stock.body).toMatchObject({
      quantitePhysiqueMillieme: 2500,
      quantiteReserveeMillieme: 0,
      quantiteDisponibleMillieme: 2500,
    });

    const mouvements = await listerMouvements(ctx, cookie, articleId, { type: 'sortie_comptoir' });
    expect((mouvements.body as { donnees: readonly unknown[] }).donnees).toHaveLength(1);
  });

  it('retour-client : idempotence symétrique — un SEUL mouvement, stock incrémenté une seule fois', async () => {
    const { articleId, siteId } = await articleAvecStock(1000);
    const cookie = await cookiePieces();
    const cle = randomUUID();
    const corps = { siteId, quantiteMillieme: 300, motif: 'Retour client de test' };

    const premier = await retourClient(ctx, cookie, articleId, corps, cle);
    expect(premier.status, JSON.stringify(premier.body)).toBe(201);
    const idPremier = (premier.body as { id: string }).id;

    const second = await retourClient(ctx, cookie, articleId, corps, cle);
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect((second.body as { id: string }).id).toBe(idPremier);

    // 1000 + 300 = 1300, PAS 1600.
    const stock = await disponibilite(ctx, cookie, articleId, siteId);
    expect(stock.body).toMatchObject({
      quantitePhysiqueMillieme: 1300,
      quantiteReserveeMillieme: 0,
      quantiteDisponibleMillieme: 1300,
    });

    const mouvements = await listerMouvements(ctx, cookie, articleId, { type: 'retour_client' });
    expect((mouvements.body as { donnees: readonly unknown[] }).donnees).toHaveLength(1);
  });

  it(
    'une clé DIFFÉRENTE pour le MÊME article/quantité est un geste DISTINCT : deux mouvements, ' +
      'le stock est décrémenté deux fois — contrôle négatif indispensable, sans lui l’idempotence ' +
      'ci-dessus pourrait n’être qu’une coïncidence (ex. un service qui dédoublonnerait sur le ' +
      'corps de la requête plutôt que sur la clé)',
    async () => {
      const { articleId, siteId } = await articleAvecStock(3000);
      const cookie = await cookiePieces();
      const corps = { siteId, quantiteMillieme: 500, motif: 'Vente comptoir de test (2 clés)' };

      const premier = await sortieComptoir(ctx, cookie, articleId, corps, randomUUID());
      expect(premier.status, JSON.stringify(premier.body)).toBe(201);
      const second = await sortieComptoir(ctx, cookie, articleId, corps, randomUUID());
      expect(second.status, JSON.stringify(second.body)).toBe(201);
      expect((second.body as { id: string }).id).not.toBe((premier.body as { id: string }).id);

      const stock = await disponibilite(ctx, cookie, articleId, siteId);
      expect(stock.body).toMatchObject({ quantitePhysiqueMillieme: 2000 });

      const mouvements = await listerMouvements(ctx, cookie, articleId, {
        type: 'sortie_comptoir',
      });
      expect((mouvements.body as { donnees: readonly unknown[] }).donnees).toHaveLength(2);
    },
  );
});

// =================================================================================================
// 8. Droit de forcer (`pieces.mouvement.forcer`) — matrice rôle × action.
// =================================================================================================

describe('pieces.mouvement.forcer — matrice rôle × action', () => {
  it('un rôle SANS `pieces.mouvement.creer` du tout (chef_atelier) est refusé 403 DROIT_INSUFFISANT sur la moindre casse, forcer ou non', async () => {
    const { articleId, siteId } = await articleAvecStock(1000);
    const cookie = await cookieAtelier();

    const sansForcer = await casse(ctx, cookie, articleId, { siteId, quantiteMillieme: 200 });
    expect(sansForcer.status, JSON.stringify(sansForcer.body)).toBe(403);
    expect((sansForcer.body as { code?: string }).code).toBe('DROIT_INSUFFISANT');

    const avecForcer = await casse(ctx, cookie, articleId, {
      siteId,
      quantiteMillieme: 5000,
      forcer: true,
    });
    expect(avecForcer.status, JSON.stringify(avecForcer.body)).toBe(403);
    expect((avecForcer.body as { code?: string }).code).toBe('DROIT_INSUFFISANT');
  });

  it('magasinier (a `pieces.mouvement.creer` ET `pieces.mouvement.forcer`) : une casse dans la limite du disponible réussit normalement', async () => {
    const { articleId, siteId } = await articleAvecStock(1000);
    const cookie = await cookiePieces();

    const casseNormale = await casse(ctx, cookie, articleId, { siteId, quantiteMillieme: 400 });
    expect(casseNormale.status, JSON.stringify(casseNormale.body)).toBe(201);

    const stock = await disponibilite(ctx, cookie, articleId, siteId);
    expect(stock.body).toMatchObject({
      quantitePhysiqueMillieme: 600,
      quantiteDisponibleMillieme: 600,
    });
  });

  it('magasinier, SANS forcer, au-delà du disponible : refusé 409 STOCK_INSUFFISANT, aucun mouvement créé', async () => {
    const { articleId, siteId } = await articleAvecStock(1000);
    const cookie = await cookiePieces();

    const refus = await casse(ctx, cookie, articleId, { siteId, quantiteMillieme: 1500 });
    expect(refus.status, JSON.stringify(refus.body)).toBe(409);
    expect((refus.body as { code?: string }).code).toBe('STOCK_INSUFFISANT');

    const mouvements = await listerMouvements(ctx, cookie, articleId, { type: 'casse' });
    expect((mouvements.body as { donnees: readonly unknown[] }).donnees).toEqual([]);
  });

  it(
    'DÉFAUT CONSTATÉ, MESURÉ EN EXÉCUTION (documenté, PAS corrigé — hors périmètre `apps/api/' +
      "test/**`) : `forcer: true` par magasinier au-delà du disponible ne change RIEN à l'issue " +
      'observable — TOUJOURS `409 STOCK_INSUFFISANT`, jamais un `201`. La prémisse du brief de ' +
      "cette tâche (« un rôle qui a `pieces.mouvement.forcer` PEUT passer outre ») s'avère FAUSSE " +
      'pour `casse`/`perte`/`retour-fournisseur` telles qu’implémentées aujourd’hui : `forcer` ne ' +
      'fait sauter QUE la garde applicative `verifierDisponible` (service-mouvement.ts) — mais la ' +
      'contrainte SQL `stock_article_reservee_leq_physique_chk` (0025), elle, refuse INCONDITIONNEL' +
      'LEMENT tout mouvement qui ferait passer `physique` sous `reservee`. Or dès que la quantité ' +
      'sortie dépasse le DISPONIBLE (physique − réservé) et que `reservee` ne bouge PAS dans le ' +
      'MÊME mouvement (le cas de `casse`/`perte`, qui ne touchent jamais `reservation_piece`), ' +
      'physique_après < reservee EST TOUJOURS vrai algébriquement (physique_après = physique_avant ' +
      '− Q, et Q > disponible ⟺ physique_avant − Q < reservee) — la contrainte retombe donc ' +
      'TOUJOURS, `forcer` ou pas. Le service traduit la violation en 409 STOCK_INSUFFISANT (filet ' +
      '`estViolationStockInsuffisant`, service-mouvement.ts) au lieu de 500 : le SYMPTÔME visible ' +
      "(409 dans les deux cas) masque que `forcer` n'a AUCUN effet différenciateur ici. Ce test " +
      'documente le comportement ATTENDU PAR LE BRIEF (`forcer: true` devrait réussir, 2xx) et ' +
      'reste ROUGE tant que ce n’est pas corrigé.',
    async () => {
      const { articleId, siteId } = await articleAvecStock(1000);
      const cookie = await cookiePieces();

      const force = await casse(ctx, cookie, articleId, {
        siteId,
        quantiteMillieme: 1500,
        forcer: true,
      });
      expect(force.status, JSON.stringify(force.body)).toBeLessThan(300);
    },
  );
});
