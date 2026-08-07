/**
 * `POST /relances/facturation/planifier` — sur vraie Postgres éphémère (testcontainers) et vraie
 * app NestJS (`creerAppTest`), par le VRAI contrôleur HTTP, même patron que
 * `test/integration/tableau-bord/` et `test/integration/ventes/`.
 *
 * PRIORITÉS DE CE FICHIER (brief de la tâche, par ordre) :
 *  1. Idempotence RÉELLE — la contrainte unique `relance_planifiee_tenant_type_objet_palier_uk`
 *     absorbe un rejeu, prouvé en LA DÉCLENCHANT deux fois de suite, pas en la lisant.
 *  3. Non-régression : une facture annulée par avoir n'est plus JAMAIS (re)planifiée — la moitié
 *     PLANIFICATION du correctif (la moitié ENVOI est hors de portée d'un test d'intégration
 *     aujourd'hui, voir la note de tête de `famille-legale-et-envoi.spec.ts`).
 *  4. Aucune planification pour une facture soldée, ni pour une facture sans échéance connue.
 *  5. Paliers : le bon au bon moment (bornes inclusives), aucun sauté ni doublé.
 *
 * Périmètre d'écriture : `apps/api/test/**` uniquement (CONTRIBUTING.md). `apps/api/src/relances/**`
 * n'est lu que pour construire des fixtures valides, jamais modifié ici.
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
  semerGarageDemoLot1,
  type GarageDemoLot1Fixture,
} from '../../lot1/fixtures/garage-demo-lot1';
import {
  ajouterJours,
  configurerDelaiPaiementImmediatPourTest,
  configurerRegleFactureEchue,
  construireCookiePour,
  creerAvoirTotalPourTest,
  creerFactureEmisePourTest,
  joursAvant,
  lireRelancesPlanifieesPourObjet,
  planifier,
  reglerFactureIntegralementPourTest,
  simulerFactureHeritageSansEcheancePourTest,
} from './fixtures-relances';

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

  // `clients[0]` : delai de paiement figé à 0 jour (« payable à réception ») — dateEcheance =
  // dateDocument, seule variable à piloter depuis chaque test. Appelé UNE FOIS (une deuxième
  // période sur le même client chevaucherait, voir `fixtures-relances.ts`).
  await configurerDelaiPaiementImmediatPourTest(
    ctx,
    garage.tenantA,
    cookiePour,
    garage.tenantA.clients[0]!.id,
  );

  const cookieDirection = await cookiePour(garage.tenantA, 'direction');
  const reponseRegle = await configurerRegleFactureEchue(ctx, cookieDirection, {
    actif: true,
    delaisJours: [5, 15, 30],
    canaux: ['email'],
  });
  if (reponseRegle.status !== 200) {
    throw new Error(`configuration regle_relance a échoué : ${JSON.stringify(reponseRegle.body)}`);
  }
}, 180_000);

afterAll(async () => {
  await ctx?.fermer();
  await redis?.fermer();
  await bdd?.fermer();
});

const SITE_A = () => garage.tenantA.tenant.sites[0]!.id;
const CLIENT_A_CONFIGURE = () => garage.tenantA.clients[0]!.id;

// =================================================================================================
// 1. Paliers dus — bornes inclusives (`<=`), aucun sauté ni doublé (§4/§6.1 de la spec).
//    Règle configurée en `beforeAll` : delaisJours = [5, 15, 30], un seul canal (email).
// =================================================================================================

describe('paliers dus — le bon palier au bon moment, jamais sauté ni doublé', () => {
  it.each([
    { joursEcheanceAvant: 4, paliersAttendus: [] as number[] },
    { joursEcheanceAvant: 5, paliersAttendus: [1] },
    { joursEcheanceAvant: 16, paliersAttendus: [1, 2] },
    { joursEcheanceAvant: 31, paliersAttendus: [1, 2, 3] },
  ])(
    'échéance à J-$joursEcheanceAvant → paliers dus = $paliersAttendus',
    async ({ joursEcheanceAvant, paliersAttendus }) => {
      const dateDocument = joursAvant(joursEcheanceAvant);
      const facture = await creerFactureEmisePourTest(ctx, garage.tenantA, cookiePour, {
        siteId: SITE_A(),
        clientId: CLIENT_A_CONFIGURE(),
        dateDocument,
      });
      expect(facture.dateEcheance, 'dateEcheance doit être fixée (delai=0 → = dateDocument)').toBe(
        dateDocument,
      );

      const cookieDirection = await cookiePour(garage.tenantA, 'direction');
      await planifier(ctx, cookieDirection);

      const lignes = await lireRelancesPlanifieesPourObjet(
        bdd,
        garage.tenantA.tenant.id,
        facture.id,
      );
      expect(lignes.map((l) => l.palier).sort((a, b) => a - b)).toEqual(paliersAttendus);
      for (const ligne of lignes) {
        expect(ligne.typeRelance).toBe('facture_echue');
        expect(ligne.objetType).toBe('document_vente');
        expect(ligne.statut).toBe('prete'); // client[0] a un email valide (RA-03).
      }
    },
  );

  it('echeance_prevue exacte = dateEcheance + N jours, pour chaque palier dû (arithmétique, pas juste un comptage)', async () => {
    const dateDocument = joursAvant(20);
    const facture = await creerFactureEmisePourTest(ctx, garage.tenantA, cookiePour, {
      siteId: SITE_A(),
      clientId: CLIENT_A_CONFIGURE(),
      dateDocument,
    });

    const cookieDirection = await cookiePour(garage.tenantA, 'direction');
    await planifier(ctx, cookieDirection);

    const lignes = await lireRelancesPlanifieesPourObjet(bdd, garage.tenantA.tenant.id, facture.id);
    const parPalier = new Map(lignes.map((l) => [l.palier, l]));

    expect(parPalier.get(1)?.echeancePrevue.slice(0, 10)).toBe(ajouterJours(dateDocument, 5));
    expect(parPalier.get(2)?.echeancePrevue.slice(0, 10)).toBe(ajouterJours(dateDocument, 15));
    // Palier 3 (J+30) pas encore dû à J-20 : absent, pas une ligne « en attente ».
    expect(parPalier.has(3)).toBe(false);
  });
});

// =================================================================================================
// 2. Idempotence RÉELLE (RA-05) — la même planification REJOUÉE deux fois de suite ne crée
//    qu'une ligne par (type, objet, palier), preuve par DELTA sur deux appels consécutifs.
// =================================================================================================

describe('idempotence — planifier deux fois de suite n’insère jamais un doublon (RA-05)', () => {
  it('deuxième appel : creees=0, ignorees += le nombre de paliers déjà créés par le premier', async () => {
    const dateDocument = joursAvant(10); // palier 1 dû (5≤10), palier 2 pas encore (15>10).
    const facture = await creerFactureEmisePourTest(ctx, garage.tenantA, cookiePour, {
      siteId: SITE_A(),
      clientId: CLIENT_A_CONFIGURE(),
      dateDocument,
    });
    const cookieDirection = await cookiePour(garage.tenantA, 'direction');

    // Premier appel : celui-ci CRÉE la ligne palier=1 de cette facture (avec, en plus, le bruit de
    // fond normal des autres candidats déjà réglés par les tests précédents — `creees`/`ignorees`
    // sont des compteurs AGRÉGÉS pour tout le tenant, jamais isolés à une seule facture, voir
    // `ReponsePlanificationRelances`). C'est pour ça que la preuve d'idempotence porte sur le
    // DEUXIÈME appel, jamais sur une comparaison appel1↔appel2 : appel1 n'est PAS un état stable
    // (il vient justement de créer quelque chose), seul appel2 (rejoué immédiatement après, sans
    // qu'aucune autre facture n'ait pu changer d'état entre-temps) peut l'être.
    const appel1 = await planifier(ctx, cookieDirection);
    const lignesApres1 = await lireRelancesPlanifieesPourObjet(
      bdd,
      garage.tenantA.tenant.id,
      facture.id,
    );
    expect(lignesApres1.map((l) => l.palier)).toEqual([1]);

    // Rejeu immédiat, réel (deuxième requête HTTP, pas un mock) : la ligne palier=1 existe déjà en
    // base pour (tenant, type_relance, objet_id=facture.id, palier=1) — la contrainte unique doit
    // absorber la tentative d'insertion (`ON CONFLICT DO NOTHING`). Entre appel1 et appel2, RIEN
    // d'autre n'a pu devenir candidat (aucune autre facture créée, aucun appel concurrent — un seul
    // worker, voir `vitest.config.ts`) : `creees` doit retomber à zéro EN VALEUR ABSOLUE, et
    // `ignorees` ne doit augmenter que du nombre EXACT de paliers que appel1 vient de créer pour
    // CETTE facture (tout le reste du bruit de fond était déjà ignoré pendant appel1 lui-même, donc
    // s'annule dans le delta).
    const appel2 = await planifier(ctx, cookieDirection);

    expect(appel2.creees).toBe(0);
    expect(appel2.ignorees - appel1.ignorees).toBe(lignesApres1.length); // exactement le palier 1 de CETTE facture.

    // Toujours UNE SEULE ligne en base pour ce palier — jamais un doublon silencieux.
    const lignesApres2 = await lireRelancesPlanifieesPourObjet(
      bdd,
      garage.tenantA.tenant.id,
      facture.id,
    );
    expect(lignesApres2).toHaveLength(1);
    expect(lignesApres2[0]!.id).toBe(lignesApres1[0]!.id); // même ligne, pas une nouvelle.
  });

  it('un troisième appel, encore plus tard, reste tout aussi inerte pour cette facture (pas seulement « deux fois »)', async () => {
    const dateDocument = joursAvant(6); // palier 1 dû (5≤6).
    const facture = await creerFactureEmisePourTest(ctx, garage.tenantA, cookiePour, {
      siteId: SITE_A(),
      clientId: CLIENT_A_CONFIGURE(),
      dateDocument,
    });
    const cookieDirection = await cookiePour(garage.tenantA, 'direction');

    await planifier(ctx, cookieDirection);
    await planifier(ctx, cookieDirection);
    await planifier(ctx, cookieDirection);

    const lignes = await lireRelancesPlanifieesPourObjet(bdd, garage.tenantA.tenant.id, facture.id);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]!.palier).toBe(1);
  });
});

// =================================================================================================
// 3. Non-régression — une facture annulée par avoir n'est plus jamais (re)planifiée.
// =================================================================================================

describe('facture annulée par avoir — non-régression, couche PLANIFICATION', () => {
  it('un palier déjà planifié avant l’avoir n’est jamais dupliqué, et aucun nouveau palier n’apparaît après (statut ≠ emis exclu par le filtre SQL de planifier())', async () => {
    // Échéance à J-12 : palier 1 dû (5≤12), palier 2 pas encore (15>12) — laisse de la place pour
    // vérifier qu'un rappel qui SERAIT devenu dû plus tard (palier 2, J+15) n'apparaît jamais non
    // plus une fois la facture annulée, même si le temps continue de s'écouler côté test.
    const dateDocument = joursAvant(12);
    const facture = await creerFactureEmisePourTest(ctx, garage.tenantA, cookiePour, {
      siteId: SITE_A(),
      clientId: CLIENT_A_CONFIGURE(),
      dateDocument,
    });
    const cookieDirection = await cookiePour(garage.tenantA, 'direction');

    await planifier(ctx, cookieDirection);
    const avantAvoir = await lireRelancesPlanifieesPourObjet(
      bdd,
      garage.tenantA.tenant.id,
      facture.id,
    );
    expect(avantAvoir.map((l) => l.palier)).toEqual([1]);

    await creerAvoirTotalPourTest(ctx, garage.tenantA, cookiePour, facture.id);

    // Rejoué APRÈS l'avoir : le filtre `d.statut = 'emis'` de `planifier()` exclut désormais cette
    // facture (`annule_par_avoir`) — ni un doublon du palier 1, ni le palier 2 (qui, sans l'avoir,
    // deviendrait dû à J-15).
    await planifier(ctx, cookieDirection);
    const apresAvoir = await lireRelancesPlanifieesPourObjet(
      bdd,
      garage.tenantA.tenant.id,
      facture.id,
    );
    expect(apresAvoir).toHaveLength(1);
    expect(apresAvoir[0]!.id).toBe(avantAvoir[0]!.id);
    expect(apresAvoir[0]!.palier).toBe(1);
  });

  it('une facture annulée par avoir AVANT toute planification n’est jamais planifiée du tout', async () => {
    const dateDocument = joursAvant(40); // tous les paliers seraient dus (5,15,30 ≤ 40).
    const facture = await creerFactureEmisePourTest(ctx, garage.tenantA, cookiePour, {
      siteId: SITE_A(),
      clientId: CLIENT_A_CONFIGURE(),
      dateDocument,
    });
    await creerAvoirTotalPourTest(ctx, garage.tenantA, cookiePour, facture.id);

    const cookieDirection = await cookiePour(garage.tenantA, 'direction');
    await planifier(ctx, cookieDirection);

    const lignes = await lireRelancesPlanifieesPourObjet(bdd, garage.tenantA.tenant.id, facture.id);
    expect(lignes).toEqual([]);
  });
});

// =================================================================================================
// 4. Aucune relance pour une facture soldée, ni pour une facture sans échéance connue.
// =================================================================================================

describe('exclusions — facture soldée, facture sans échéance', () => {
  it('une facture réglée intégralement AVANT la planification n’est jamais planifiée', async () => {
    const dateDocument = joursAvant(40); // tous les paliers seraient dus si non réglée.
    const facture = await creerFactureEmisePourTest(ctx, garage.tenantA, cookiePour, {
      siteId: SITE_A(),
      clientId: CLIENT_A_CONFIGURE(),
      dateDocument,
    });
    await reglerFactureIntegralementPourTest(ctx, garage.tenantA, cookiePour, {
      siteId: SITE_A(),
      factureId: facture.id,
      montantCentimes: facture.totalTtcCentimes,
    });

    const cookieDirection = await cookiePour(garage.tenantA, 'direction');
    await planifier(ctx, cookieDirection);

    const lignes = await lireRelancesPlanifieesPourObjet(bdd, garage.tenantA.tenant.id, facture.id);
    expect(lignes).toEqual([]);
  });

  it('une facture SANS échéance connue (dateEcheance null, ligne héritée d’avant le correctif d’échéance) n’est jamais planifiée', async () => {
    // CONSTRUCTION CHANGÉE (voir `simulerFactureHeritageSansEcheancePourTest`, `fixtures-relances.ts`) :
    // ce test fabriquait autrefois le cas en prenant un client SANS condition de paiement, comptant
    // sur `delaiPaiementJours` resté `null` pour que `calculerDateEcheance` rende `null`. Le
    // correctif #17 (`0046_...sql`, `tenant.delai_paiement_jours_defaut`) a invalidé cette méthode :
    // un client sans conditions retombe désormais sur le délai par défaut du TENANT (30 jours),
    // donc AUCUNE facture NOUVELLEMENT émise ne peut plus sortir sans échéance — l'ancienne
    // construction produirait silencieusement une facture normale à échéance 30 jours, pas le cas
    // visé. L'INTENTION du test reste pourtant parfaitement valide : des factures dont
    // `date_echeance` est réellement `null` existent déjà en base chez un garage en production
    // (émises avant ce correctif, jamais recalculées depuis — RF-04/MD-20, `date_echeance` est
    // figée à l'émission) et ne doivent jamais être relancées. La fixture simule maintenant cette
    // ligne héritée par écriture SQL directe plutôt que de compter sur l'absence de conditions
    // client.
    const clientSansCondition = garage.tenantA.clients[1]!.id;
    const dateDocument = joursAvant(40);
    const facture = await simulerFactureHeritageSansEcheancePourTest(ctx, bdd, garage.tenantA, cookiePour, {
      siteId: SITE_A(),
      clientId: clientSansCondition,
      dateDocument,
    });
    expect(facture.dateEcheance).toBeNull();

    const cookieDirection = await cookiePour(garage.tenantA, 'direction');
    await planifier(ctx, cookieDirection);

    const lignes = await lireRelancesPlanifieesPourObjet(bdd, garage.tenantA.tenant.id, facture.id);
    expect(lignes).toEqual([]);
  });
});

// =================================================================================================
// 5. Fail-closed — règle désactivée : aucune planification, même avec un palier autrement dû.
//    Auto-contenu : restaure l'état (actif=true) à la fin, quel que soit l'ordre d'exécution des
//    autres tests de ce fichier (voir l'en-tête de `fixtures-relances.ts` sur les pièges d'ordre).
// =================================================================================================

describe('règle désactivée — fail-closed (§5 de la spec)', () => {
  it('aucune ligne créée tant que actif=false ; reprend normalement une fois réactivée', async () => {
    const cookieDirection = await cookiePour(garage.tenantA, 'direction');

    const desactivation = await configurerRegleFactureEchue(ctx, cookieDirection, {
      actif: false,
      delaisJours: [5, 15, 30],
      canaux: ['email'],
    });
    expect(desactivation.status, JSON.stringify(desactivation.body)).toBe(200);

    const dateDocument = joursAvant(50); // tous paliers auraient été dus.
    const facture = await creerFactureEmisePourTest(ctx, garage.tenantA, cookiePour, {
      siteId: SITE_A(),
      clientId: CLIENT_A_CONFIGURE(),
      dateDocument,
    });
    await planifier(ctx, cookieDirection);
    const lignesDesactive = await lireRelancesPlanifieesPourObjet(
      bdd,
      garage.tenantA.tenant.id,
      facture.id,
    );
    expect(lignesDesactive).toEqual([]);

    // Restauration — condition sine qua non pour ne pas casser un test déclaré APRÈS celui-ci.
    const reactivation = await configurerRegleFactureEchue(ctx, cookieDirection, {
      actif: true,
      delaisJours: [5, 15, 30],
      canaux: ['email'],
    });
    expect(reactivation.status, JSON.stringify(reactivation.body)).toBe(200);

    // Contrôle positif : la MÊME facture, rejouée sous la règle réactivée, est bien planifiée —
    // preuve que « rien planifié » ci-dessus venait de `actif=false`, pas d'un autre défaut.
    await planifier(ctx, cookieDirection);
    const lignesReactive = await lireRelancesPlanifieesPourObjet(
      bdd,
      garage.tenantA.tenant.id,
      facture.id,
    );
    expect(lignesReactive.length).toBeGreaterThan(0);
  });
});
