/**
 * Arithmétique financière des lignes et totaux d'OR — valeurs EXACTES en centimes, jamais de
 * comparaison approximative sur de l'argent (CONTRIBUTING.md : « jamais de toBeCloseTo sur de l'argent »).
 *
 * Les lignes de ce fichier sont créées par de VRAIES requêtes HTTP `POST
 * /ordres-reparation/{orId}/lignes` — pas par insertion SQL directe des montants — précisément
 * parce que le calcul lui-même (`CalculLigneSimple.calculer`, `atelier/calcul-ligne.ts`) s'exécute
 * dans le SERVICE appelé par ce endpoint. Insérer des montants pré-calculés par SQL prouverait
 * seulement que Postgres sait stocker un entier, pas que le CODE qui les a produits est correct.
 *
 * Règle vérifiée en priorité (CONTRIBUTING.md, ARCHITECTURE.md) : « TVA calculée par ligne puis
 * agrégée, jamais sur le total ». `atelier/totaux-payeur.ts` (`calculerTotauxParPayeur`) ne fait
 * QUE sommer des `montantTvaCentimes` déjà arrondis ligne par ligne — jamais recalculer la TVA sur
 * une base agrégée. Le test central de ce fichier (§2) construit un cas où les deux méthodes de
 * calcul divergent RÉELLEMENT (arrondi à zéro par ligne, arrondi à un centime sur l'agrégat) : si
 * un jour quelqu'un remplaçait « agrège les TVA déjà calculées » par « recalcule la TVA sur la
 * base HT agrégée », ce test rougirait pour la bonne raison — ce n'est pas le cas aujourd'hui
 * (lu dans `totaux-payeur.ts` : aucun défaut trouvé, ce test est un garde-fou de non-régression).
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demarrerBaseEphemere, type BaseEphemere } from '../setup/postgres-ephemere';
import {
  creerAppTest,
  demarrerRedisEphemere,
  type AppTest,
  type RedisEphemere,
} from '../setup/app-test';
import {
  creerOrPourTest,
  semerGarageDemoLot1,
  type GarageDemoLot1Fixture,
  type OrDeTest,
} from './fixtures/garage-demo-lot1';
import { cookieDeSessionPour } from './isolation-http-aide';

let bdd: BaseEphemere;
let garage: GarageDemoLot1Fixture;
let redis: RedisEphemere;
let ctx: AppTest;
let cookieReceptionnaire: string;

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  garage = await semerGarageDemoLot1(bdd);
  redis = await demarrerRedisEphemere();
  ctx = await creerAppTest(bdd, redis.url, { LOG_NIVEAU: 'debug' });
  const u = garage.tenantA.utilisateursParRole.receptionnaire;
  cookieReceptionnaire = await cookieDeSessionPour(ctx, u.email, u.motDePasseClair);
}, 180_000);

afterAll(async () => {
  await ctx?.fermer();
  await redis?.fermer();
  await bdd?.fermer();
});

interface MontantsLigneOr {
  readonly montantHtCentimes: number;
  readonly montantTvaCentimes: number;
  readonly montantTtcCentimes: number;
}
interface CorpsLigneOr {
  readonly donnees?: { readonly id?: string; readonly montants?: MontantsLigneOr };
}
interface CorpsOrComplet {
  readonly totauxParPayeur?: ReadonlyArray<{
    readonly payeur: string;
    readonly montantHtCentimes: number;
    readonly montantTvaCentimes: number;
    readonly montantTtcCentimes: number;
    readonly tva: ReadonlyArray<{
      readonly tauxPourmille: number;
      readonly baseHtCentimes: number;
      readonly montantCentimes: number;
    }>;
  }>;
}

async function nouvelOr(): Promise<OrDeTest> {
  const t = garage.tenantA;
  return creerOrPourTest(bdd, t.tenant, t.tenant.sites[0]!.id, t.clients[0]!, t.vehicules[0]!);
}

async function creerLigne(orId: string, entree: Record<string, unknown>): Promise<MontantsLigneOr> {
  const reponse = await ctx.requete
    .post(`/api/v1/ordres-reparation/${orId}/lignes`)
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
    .set('Cookie', cookieReceptionnaire)
    .set('Idempotency-Key', randomUUID())
    .send({
      type: 'piece',
      origine: 'commandee',
      designation: 'Ligne de test arithmétique',
      payeur: 'client',
      ...entree,
    });
  expect(reponse.status, `création de ligne refusée : ${JSON.stringify(reponse.body)}`).toBe(201);
  const montants = (reponse.body as CorpsLigneOr).donnees?.montants;
  if (!montants)
    throw new Error(
      `Aucun montant dans la réponse de création de ligne : ${JSON.stringify(reponse.body)}`,
    );
  return montants;
}

async function lireOrComplet(orId: string): Promise<CorpsOrComplet> {
  const reponse = await ctx.requete
    .get(`/api/v1/ordres-reparation/${orId}`)
    .set('Cookie', cookieReceptionnaire);
  expect(reponse.status, JSON.stringify(reponse.body)).toBe(200);
  return reponse.body as CorpsOrComplet;
}

// -------------------------------------------------------------------------------------------
// 1. Valeurs exactes en centimes — pas de flottant, pas d'approximation.
// -------------------------------------------------------------------------------------------

describe('calcul de ligne — valeurs EXACTES en centimes (taux légal suisse 8.1%, RM-65)', () => {
  it('prixUnitaireCentimes=1000, quantité=1, sans rabais : HT=1000, TVA=81 (1000*81/1000), TTC=1081', async () => {
    const or = await nouvelOr();
    const montants = await creerLigne(or.id, {
      prixUnitaireCentimes: 1000,
      quantiteMillieme: 1000,
    });
    expect(montants.montantHtCentimes).toBe(1000);
    expect(montants.montantTvaCentimes).toBe(81);
    expect(montants.montantTtcCentimes).toBe(1081);
    // Invariant de base (contrainte CHECK ligne_or_montant_coherent_chk) — revérifié côté service.
    expect(montants.montantTtcCentimes).toBe(
      montants.montantHtCentimes + montants.montantTvaCentimes,
    );
  });

  it("rabais 12.5% (125‰) : HT = round(1000 * 875/1000) = 875, TVA = round(875*81/1000) = 71, TTC = 946 — l'ordre RABAIS PUIS TVA est celui gelé par le contrat", async () => {
    const or = await nouvelOr();
    const montants = await creerLigne(or.id, {
      prixUnitaireCentimes: 1000,
      quantiteMillieme: 1000,
      rabaisPourmille: 125,
    });
    expect(montants.montantHtCentimes).toBe(875);
    expect(montants.montantTvaCentimes).toBe(71);
    expect(montants.montantTtcCentimes).toBe(946);
  });

  it('quantité fractionnaire (quantiteMillieme=2500 = 2.5 unités) à 333 centimes pièce : HT = round(333*2500/1000) = 833, TVA = round(833*81/1000) = 67, TTC = 900', async () => {
    const or = await nouvelOr();
    const montants = await creerLigne(or.id, { prixUnitaireCentimes: 333, quantiteMillieme: 2500 });
    expect(montants.montantHtCentimes).toBe(833);
    expect(montants.montantTvaCentimes).toBe(67);
    expect(montants.montantTtcCentimes).toBe(900);
  });

  it('ligne de type remise (montant négatif), TVA à la demie exacte : HT=-500, TVA=arrondiCommercial(-500*81,1000)=arrondiCommercial(-40.5)=-41 (demi éloigné de zéro, symétrique — RF-33/MD-40), TTC=-541', async () => {
    const or = await nouvelOr();
    const montants = await creerLigne(or.id, {
      type: 'remise',
      prixUnitaireCentimes: -500,
      quantiteMillieme: 1000,
    });
    expect(montants.montantHtCentimes).toBe(-500);
    // -500 * 81 / 1000 = -40.5, pile sur la demie. Règle du dépôt (arrondiCommercial,
    // packages/shared/src/arithmetique/arrondi-commercial.ts) : demi éloigné de zéro, valable côté
    // positif ET négatif — PAS Math.round (qui arrondit tous les .5 vers +Infini, donc -40.5 → -40,
    // asymétrique). Valeur EXACTE attendue, jamais approximative.
    expect(montants.montantTvaCentimes).toBe(-41);
    expect(montants.montantTtcCentimes).toBe(-541);
  });
});

// -------------------------------------------------------------------------------------------
// 2. TVA calculée PAR LIGNE puis agrégée — jamais recalculée sur le total. Cas de divergence
//    RÉELLE construit exprès : deux lignes à 5 centimes HT chacune arrondissent leur TVA à 0
//    séparément (0.405 → 0), alors qu'un calcul sur la base agrégée (10 centimes) arrondirait à 1
//    (0.81 → 1). Les deux méthodes ne peuvent PAS produire le même résultat ici — c'est exactement
//    ce qui rend ce test capable de détecter une agrégation-avant-calcul, s'il en existait une.
// -------------------------------------------------------------------------------------------

describe('agrégation des totaux — TVA par ligne, JAMAIS sur le total agrégé (RM-107)', () => {
  it('deux lignes à 5 centimes HT chacune : TVA par ligne = 0 + 0 = 0 (PAS 1, que donnerait un calcul sur la base agrégée de 10 centimes)', async () => {
    const or = await nouvelOr();
    const montants1 = await creerLigne(or.id, { prixUnitaireCentimes: 5, quantiteMillieme: 1000 });
    const montants2 = await creerLigne(or.id, { prixUnitaireCentimes: 5, quantiteMillieme: 1000 });

    // Round(5*81/1000) = round(0.405) = 0, sur CHAQUE ligne individuellement.
    expect(montants1.montantHtCentimes).toBe(5);
    expect(montants1.montantTvaCentimes).toBe(0);
    expect(montants2.montantHtCentimes).toBe(5);
    expect(montants2.montantTvaCentimes).toBe(0);

    const document = await lireOrComplet(or.id);
    const totalClient = document.totauxParPayeur?.find((t) => t.payeur === 'client');
    expect(totalClient, 'aucun total pour le payeur "client"').toBeDefined();
    expect(totalClient!.montantHtCentimes).toBe(10);
    // La preuve : si le code agrégeait AVANT de calculer la TVA, ce serait round(10*81/1000) =
    // round(0.81) = 1. La somme des TVA déjà arrondies par ligne donne 0 + 0 = 0.
    expect(totalClient!.montantTvaCentimes).toBe(0);
    expect(totalClient!.montantTtcCentimes).toBe(10);
    expect(totalClient!.tva).toEqual([
      { tauxPourmille: 81, baseHtCentimes: 10, montantCentimes: 0 },
    ]);
  });

  it('trois lignes de montants hétérogènes : le total HT/TVA/TTC est la somme EXACTE des montants de ligne, terme à terme', async () => {
    const or = await nouvelOr();
    const m1 = await creerLigne(or.id, { prixUnitaireCentimes: 1234, quantiteMillieme: 1000 }); // HT 1234, TVA round(99.954)=100, TTC 1334
    const m2 = await creerLigne(or.id, {
      prixUnitaireCentimes: 567,
      quantiteMillieme: 1000,
      rabaisPourmille: 100,
    }); // HT round(567*900/1000)=510, TVA round(41.31)=41, TTC 551
    const m3 = await creerLigne(or.id, {
      type: 'remise',
      prixUnitaireCentimes: -200,
      quantiteMillieme: 1000,
    }); // HT -200, TVA round(-16.2)=-16, TTC -216

    expect(m1).toEqual({
      montantHtCentimes: 1234,
      montantTvaCentimes: 100,
      montantTtcCentimes: 1334,
    });
    expect(m2).toEqual({ montantHtCentimes: 510, montantTvaCentimes: 41, montantTtcCentimes: 551 });
    expect(m3).toEqual({
      montantHtCentimes: -200,
      montantTvaCentimes: -16,
      montantTtcCentimes: -216,
    });

    const document = await lireOrComplet(or.id);
    const totalClient = document.totauxParPayeur?.find((t) => t.payeur === 'client');
    expect(totalClient!.montantHtCentimes).toBe(1234 + 510 - 200); // 1544
    expect(totalClient!.montantTvaCentimes).toBe(100 + 41 - 16); // 125
    expect(totalClient!.montantTtcCentimes).toBe(1334 + 551 - 216); // 1669
    expect(totalClient!.montantTtcCentimes).toBe(
      totalClient!.montantHtCentimes + totalClient!.montantTvaCentimes,
    );
  });
});

// -------------------------------------------------------------------------------------------
// 3. Regroupement PAR PAYEUR — RM-70/RF-92/MD-66 : une ligne payeur="garage" (geste commercial)
//    ne porte aucun montant (HT=TVA=TTC=0) ET NE FORME JAMAIS SON PROPRE GROUPE — elle rejoint le
//    groupe "client" (`totaux-payeur.ts::cleEffective` : `payeur === 'garage'` rend la clé
//    `('client', null)`), sans en changer le total puisqu'elle est déjà valorisée à 0.
//
//    CORRIGÉ ICI (le test attendait auparavant un groupe "garage" SÉPARÉ, à zéro — CE N'EST PAS
//    LE COMPORTEMENT DU CONTRAT) : `TotauxPayeurOr.payeur` ne rend JAMAIS `'garage'`
//    (`packages/shared/.../ordre-reparation.ts`), documenté verbatim en tête de
//    `atelier/totaux-payeur.ts` et déjà prouvé au niveau unitaire par
//    `atelier/totaux-payeur.spec.ts` (« une ligne payeur = 'garage' rejoint le groupe 'client' —
//    jamais de groupe 'garage' séparé ») et `atelier/service-facturation-or.spec.ts`. La ligne
//    fautive cherchait `document.totauxParPayeur?.find((t) => t.payeur === 'garage')`, qui rend
//    `undefined` PAR CONSTRUCTION — d'où l'erreur structurelle (`undefined.montantHtCentimes`),
//    pas une régression du regroupement.
// -------------------------------------------------------------------------------------------

describe('regroupement par payeur — un geste commercial (payeur=garage) ne pollue pas le total client', () => {
  it('une ligne payeur=client à 1000 centimes HT et une ligne payeur=garage à prix nominal 1000 : un SEUL total ("client"), la ligne garage n\'y ajoute rien, et aucun groupe "garage" n\'apparaît (RM-70/RF-92)', async () => {
    const or = await nouvelOr();
    await creerLigne(or.id, {
      prixUnitaireCentimes: 1000,
      quantiteMillieme: 1000,
      payeur: 'client',
    });
    const geste = await creerLigne(or.id, {
      prixUnitaireCentimes: 1000,
      quantiteMillieme: 1000,
      payeur: 'garage',
    });

    // RM-70, appliqué dans service-ligne-or.ts : payeur=garage force montants à zéro, sans même
    // appeler le calculateur.
    expect(geste).toEqual({ montantHtCentimes: 0, montantTvaCentimes: 0, montantTtcCentimes: 0 });

    const document = await lireOrComplet(or.id);
    // Un seul groupe : la ligne garage a rejoint 'client', pas créé le sien.
    expect(document.totauxParPayeur).toHaveLength(1);
    expect(document.totauxParPayeur?.some((t) => (t.payeur as string) === 'garage')).toBe(false);

    const totalClient = document.totauxParPayeur?.find((t) => t.payeur === 'client');
    expect(totalClient, 'aucun total pour le payeur "client"').toBeDefined();
    // 1000 (ligne client) + 0 (ligne garage, valorisée à zéro) — la fusion n'ajoute rien au total.
    expect(totalClient!.montantHtCentimes).toBe(1000);
    expect(totalClient!.montantTvaCentimes).toBe(81);
    expect(totalClient!.montantTtcCentimes).toBe(1081);
  });
});
