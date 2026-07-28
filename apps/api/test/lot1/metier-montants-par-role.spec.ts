/**
 * Filtrage des montants par rôle — décision d'AUTORISATION appliquée CÔTÉ SERVEUR (CONTRIBUTING.md :
 * « un rôle sans droit aux montants ne doit recevoir aucun montant dans la charge utile réseau,
 * pas seulement un affichage masqué »). Ce fichier n'inspecte donc jamais un DTO ou un composant
 * d'écran : il lit le JSON RÉEL renvoyé par `GET /ordres-reparation/{orId}` sur une vraie requête
 * HTTP, pour le rôle `technicien` — le seul membre actuel de `ROLES_SANS_MONTANT`
 * (`auth/matrice-droits.ts`) — et vérifie que les clés financières sont ABSENTES DE L'OBJET, pas
 * seulement `null`/`undefined` : un champ présent à `null` reste une fuite d'information (« ce
 * plafond existe et vaut zéro » n'est pas la même chose que « vous n'avez pas le droit de le
 * savoir »). `mapperLigneOr`/`ServiceOr.assemblerDocument` (`atelier/mappeurs.ts`,
 * `atelier/service-or.ts`) omettent ces clés par un spread conditionnel (`...(voitMontants ? {…}
 * : {})`) — c'est exactement ce que `Object.hasOwn`/`'clé' in objet` permet de distinguer d'un
 * champ nullé.
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demarrerBaseEphemere, type BaseEphemere } from '../setup/postgres-ephemere';
import { creerAppTest, demarrerRedisEphemere, type AppTest, type RedisEphemere } from '../setup/app-test';
import { creerOrPourTest, semerGarageDemoLot1, type GarageDemoLot1Fixture, type OrDeTest } from './fixtures/garage-demo-lot1';
import { cookieDeSessionPour } from './isolation-http-aide';

let bdd: BaseEphemere;
let garage: GarageDemoLot1Fixture;
let redis: RedisEphemere;
let ctx: AppTest;
let cookieReceptionnaire: string;
let cookieTechnicien: string;
let or: OrDeTest;
let ligneId: string;

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  garage = await semerGarageDemoLot1(bdd);
  redis = await demarrerRedisEphemere();
  ctx = await creerAppTest(bdd, redis.url);

  const receptionnaire = garage.tenantA.utilisateursParRole.receptionnaire;
  const technicien = garage.tenantA.utilisateursParRole.technicien;
  cookieReceptionnaire = await cookieDeSessionPour(ctx, receptionnaire.email, receptionnaire.motDePasseClair);
  cookieTechnicien = await cookieDeSessionPour(ctx, technicien.email, technicien.motDePasseClair);

  const t = garage.tenantA;
  or = await creerOrPourTest(bdd, t.tenant, t.tenant.sites[0]!.id, t.clients[0]!, t.vehicules[0]!);

  // Une ligne réelle, créée par le SERVICE (donc avec de vrais montants calculés) — sans elle,
  // « montants absents » serait vrai par construction (aucune ligne n'a de montant) et ne
  // prouverait rien sur le filtrage lui-même.
  const creation = await ctx.requete
    .post(`/api/v1/ordres-reparation/${or.id}/lignes`)
    .set('Cookie', cookieReceptionnaire)
    .set('Idempotency-Key', randomUUID())
    .send({
      type: 'piece',
      origine: 'commandee',
      designation: 'Filtre à huile',
      prixUnitaireCentimes: 2500,
      quantiteMillieme: 1000,
      payeur: 'client',
    });
  expect(creation.status, JSON.stringify(creation.body)).toBe(201);
  ligneId = (creation.body as { donnees: { id: string } }).donnees.id;

  // Un plafond non nul sur l'en-tête de l'OR : donnée financière DISTINCTE des montants de ligne,
  // qui doit être filtrée elle aussi (`ServiceOr.assemblerDocument`, `voitMontants` couvre les
  // deux à la fois).
  const modification = await ctx.requete
    .patch(`/api/v1/ordres-reparation/${or.id}`)
    .set('Cookie', cookieReceptionnaire)
    .set('If-Match', 'W/"1"')
    .send({ plafondCentimes: 50000, plafondAutorisePar: 'Test' });
  expect(modification.status, `échec de préparation du fixture (plafond) : ${JSON.stringify(modification.body)}`).toBe(200);
}, 180_000);

afterAll(async () => {
  await ctx?.fermer();
  await redis?.fermer();
  await bdd?.fermer();
});

describe("GET /ordres-reparation/{id} — technicien (ROLES_SANS_MONTANT) : AUCUN montant dans la charge utile JSON réelle", () => {
  it("le document complet n'expose ni totauxParPayeur, ni plafondCentimes/plafondAutorisePar/totalValideCentimes, ni conditions figées, sous une session technicien", async () => {
    const reponse = await ctx.requete.get(`/api/v1/ordres-reparation/${or.id}`).set('Cookie', cookieTechnicien);
    expect(reponse.status, JSON.stringify(reponse.body)).toBe(200);
    const corps = reponse.body as Record<string, unknown>;

    // Absence STRICTE de clé, pas seulement une valeur null/undefined.
    expect(Object.hasOwn(corps, 'totauxParPayeur'), `champ "totauxParPayeur" présent alors qu'il devrait être omis : ${JSON.stringify(corps.totauxParPayeur)}`).toBe(false);
    expect(Object.hasOwn(corps, 'plafondCentimes')).toBe(false);
    expect(Object.hasOwn(corps, 'plafondAutorisePar')).toBe(false);
    expect(Object.hasOwn(corps, 'totalValideCentimes')).toBe(false);

    const figees = corps.figees as Record<string, unknown> | undefined;
    expect(figees, 'le sous-objet "figees" doit rester présent (il porte aussi des champs non financiers)').toBeDefined();
    expect(Object.hasOwn(figees!, 'conditions'), 'les conditions commerciales figées (rabais, plafond) sont un champ financier').toBe(false);
    // Contrôle positif : les champs NON financiers du même sous-objet restent bien exposés — la
    // preuve que le filtrage cible précisément l'argent, pas qu'un bug fait disparaître tout l'OR.
    expect(Object.hasOwn(figees!, 'clientDesignation')).toBe(true);
  });

  it('chaque ligne embarquée est présente (le TRAVAIL reste visible : un technicien voit ce qu’il doit faire) mais AUCUNE ne porte "montants", "tauxHoraireCentimes" ou "prixUnitaireCentimes"', async () => {
    const reponse = await ctx.requete.get(`/api/v1/ordres-reparation/${or.id}`).set('Cookie', cookieTechnicien);
    expect(reponse.status).toBe(200);
    const corps = reponse.body as { lignes?: ReadonlyArray<Record<string, unknown>> };

    expect(corps.lignes?.length, 'précondition : au moins une ligne doit être embarquée').toBeGreaterThan(0);
    const ligne = corps.lignes!.find((l) => l.id === ligneId);
    expect(ligne, 'la ligne créée en amont doit être présente — le technicien voit le TRAVAIL, seul l’argent est filtré').toBeDefined();

    expect(Object.hasOwn(ligne!, 'montants'), `champ "montants" présent sur la ligne : ${JSON.stringify(ligne!.montants)}`).toBe(false);
    expect(Object.hasOwn(ligne!, 'tauxHoraireCentimes')).toBe(false);
    expect(Object.hasOwn(ligne!, 'prixUnitaireCentimes')).toBe(false);
    // Contrôle positif : les champs non financiers de la même ligne restent bien exposés.
    expect(ligne!.designation).toBe('Filtre à huile');
    expect(Object.hasOwn(ligne!, 'statut')).toBe(true);
  });

  it("un simple JSON.stringify de la réponse entière ne contient AUCUNE des valeurs numériques financières injectées (2500, 50000) — preuve directe sur la charge utile réseau, pas sur un accesseur de test", async () => {
    const reponse = await ctx.requete.get(`/api/v1/ordres-reparation/${or.id}`).set('Cookie', cookieTechnicien);
    const brut = JSON.stringify(reponse.body);
    expect(brut).not.toContain('2500');
    expect(brut).not.toContain('50000');
  });
});

describe('GET /ordres-reparation/{id} — receptionnaire (rôle AVEC droit aux montants) : contrôle positif indispensable', () => {
  it('sans lui, un bug qui supprimerait TOUJOURS ces champs (peu importe le rôle) passerait aussi les trois tests ci-dessus', async () => {
    const reponse = await ctx.requete.get(`/api/v1/ordres-reparation/${or.id}`).set('Cookie', cookieReceptionnaire);
    expect(reponse.status, JSON.stringify(reponse.body)).toBe(200);
    const corps = reponse.body as Record<string, unknown>;

    expect(Object.hasOwn(corps, 'totauxParPayeur')).toBe(true);
    expect(Object.hasOwn(corps, 'plafondCentimes')).toBe(true);
    expect(corps.plafondCentimes).toBe(50000);

    const lignes = corps.lignes as ReadonlyArray<Record<string, unknown>>;
    const ligne = lignes.find((l) => l.id === ligneId)!;
    expect(Object.hasOwn(ligne, 'montants')).toBe(true);
    expect((ligne.montants as { montantHtCentimes: number }).montantHtCentimes).toBe(2500);
  });
});
