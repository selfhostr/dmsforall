/**
 * Famille légale (RA-01/RA-03) et envoi — sur vraie Postgres éphémère et vrai contrôleur HTTP.
 *
 * PRIORITÉS DE CE FICHIER (brief de la tâche) :
 *  2. Famille légale — une facture impayée déclenche sa relance SANS consulter les consentements
 *     marketing (exécution du contrat) ; RA-14 (« plus aucun contact ») prime sur tout.
 *  7. Envoi sans connecteur configuré (cas normal aujourd'hui, aucun garage n'en a) : échoue
 *     proprement, la relance reste réclamable — jamais perdue, jamais marquée envoyée à tort.
 *
 * -------------------------------------------------------------------------------------------
 * LIMITE STRUCTURELLE CONSTATÉE EN LISANT LE CODE, SIGNALÉE ICI PLUTÔT QUE MASQUÉE PAR UN TEST
 * QUI N'AURAIT L'AIR DE PROUVER QUE CE QU'IL NE PROUVE PAS RÉELLEMENT :
 *
 * `ConnecteursModule` câble `JETON_SOURCE_ACTIVATIONS_CONNECTEUR` sur
 * `SourceActivationsConnecteurAucune` (`connecteurs/connecteurs.module.ts`, commentaire de tête :
 * « aucune table `connecteur_activation` n'existe … `resoudre(...)` rend TOUJOURS `null`
 * aujourd'hui, pour tout tenant »). `ServiceRelancesFacture.envoyerPretes()` retourne donc
 * TOUJOURS `{envoyees:0, echouees:0, annulees:0}` AVANT même de lire une seule ligne
 * `relance_planifiee` (voir le premier `if (!resolu) { … return … }` du service) : la vérification
 * RA-08/RA-14 À L'EXÉCUTION (`verifierArretAutomatiqueFacture`, appelée depuis
 * `traiterUneRelance()`) n'est donc, dans l'état actuel du dépôt, JAMAIS atteinte par un test qui
 * passe par le VRAI contrôleur HTTP — quel que soit le scénario construit. Cette moitié de la
 * garantie (« jamais ENVOYÉE à un client bloqué / à une facture annulée entre-temps ») est déjà
 * couverte, et seulement couverte, au niveau UNITAIRE avec un `RegistreConnecteursService` simulé
 * (`src/relances/service-relances-facture.spec.ts`, describe `envoyerPretes` : cas « RA-14 » et
 * « aucune facture rappel n'est due pour un dossier déjà réglé »).
 *
 * Ce que les tests ci-dessous prouvent honnêtement à la place, par le VRAI chemin HTTP :
 *  - la planification NE consulte PAS les consentements marketing (elle ne les lit tout
 *    simplement jamais, `service-relances-facture.ts::planifier` ne joint aucune colonne de
 *    consentement) ;
 *  - `POST .../envoyer` ne perd, ne casse ni ne marque à tort AUCUNE ligne `prete` existante —
 *    y compris une ligne appartenant à un client `plus_aucun_contact` ou à une facture annulée
 *    par avoir — puisqu'il n'atteint structurellement rien de tout cela aujourd'hui.
 *
 * À REPRENDRE quand une vraie table/API d'activation de connecteur existera : ajouter alors un
 * test d'intégration qui active un `NotificationSender` factice et reprouve RA-08/RA-14 à ce
 * niveau — le test unitaire cité ci-dessus n'est pas un substitut définitif, seulement ce qui est
 * atteignable aujourd'hui.
 * -------------------------------------------------------------------------------------------
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
import {
  semerGarageDemoLot1,
  type GarageDemoLot1Fixture,
} from '../../lot1/fixtures/garage-demo-lot1';
import {
  configurerDelaiPaiementImmediatPourTest,
  configurerRegleFactureEchue,
  construireCookiePour,
  creerFactureEmisePourTest,
  envoyer,
  joursAvant,
  lireRelancesPlanifieesPourObjet,
  marquerPlusAucunContactPourTest,
  planifier,
  refuserConsentementMarketingPourTest,
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

  // Trois clients distincts (numéros 0/1/2 de `CLIENTS_TENANT_A`), chacun avec sa propre condition
  // (une seule période par client, voir `fixtures-relances.ts`) : le client 0 sert au test de
  // consentement marketing, le client 1 au test `plus_aucun_contact`, le client 2 au test d'envoi
  // « cas normal » — trois clients pour ne dépendre d'AUCUN ordre d'exécution entre les tests.
  for (const client of garage.tenantA.clients) {
    await configurerDelaiPaiementImmediatPourTest(ctx, garage.tenantA, cookiePour, client.id);
  }

  const cookieDirection = await cookiePour(garage.tenantA, 'direction');
  const reponseRegle = await configurerRegleFactureEchue(ctx, cookieDirection, {
    actif: true,
    delaisJours: [5],
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

// =================================================================================================
// 1. Famille légale (RA-01) — le consentement marketing n'a AUCUNE incidence sur une relance de
//    facturation : c'est l'exécution d'un contrat déjà signé, pas une sollicitation commerciale.
// =================================================================================================

describe('Famille légale (facturation) — indépendante des consentements marketing', () => {
  it('un client ayant EXPLICITEMENT refusé le marketing email est planifié et mis "prete" exactement comme n’importe quel autre', async () => {
    const client = garage.tenantA.clients[0]!;
    await refuserConsentementMarketingPourTest(ctx, garage.tenantA, cookiePour, client.id);

    const dateDocument = joursAvant(10); // palier 1 dû (5 ≤ 10).
    const facture = await creerFactureEmisePourTest(ctx, garage.tenantA, cookiePour, {
      siteId: SITE_A(),
      clientId: client.id,
      dateDocument,
    });

    const cookieDirection = await cookiePour(garage.tenantA, 'direction');
    await planifier(ctx, cookieDirection);

    const lignes = await lireRelancesPlanifieesPourObjet(bdd, garage.tenantA.tenant.id, facture.id);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]!.statut).toBe('prete'); // coordonnée (email) toujours exploitée, RA-03.
    expect(lignes[0]!.annuleRaison).toBeNull();
  });
});

// =================================================================================================
// 2. RA-14 — « plus aucun contact » prime sur tout. Voir la note de tête de fichier pour la LIMITE
//    exacte de ce que ce test peut honnêtement prouver par le chemin HTTP aujourd'hui.
// =================================================================================================

describe('RA-14 — client "plus aucun contact"', () => {
  it('la planification n’en tient PAS compte (vérifiée à l’exécution, pas ici) — la ligne existe, "prete" comme les autres ; POST .../envoyer ne l’envoie, ne la perd ni ne la corrompt jamais (aucun connecteur actif aujourd’hui)', async () => {
    const client = garage.tenantA.clients[1]!;
    await marquerPlusAucunContactPourTest(
      bdd,
      garage.tenantA.tenant.id,
      client.id,
      'Litige en cours, mandataire désigné — test relances',
    );

    const dateDocument = joursAvant(10);
    const facture = await creerFactureEmisePourTest(ctx, garage.tenantA, cookiePour, {
      siteId: SITE_A(),
      clientId: client.id,
      dateDocument,
    });

    const cookieDirection = await cookiePour(garage.tenantA, 'direction');
    await planifier(ctx, cookieDirection);

    const avant = await lireRelancesPlanifieesPourObjet(bdd, garage.tenantA.tenant.id, facture.id);
    expect(avant).toHaveLength(1);
    expect(avant[0]!.statut).toBe('prete');

    const reponseEnvoi = await envoyer(ctx, cookieDirection);
    // Aucun connecteur actif (voir la note de tête de fichier) : lot vide, systématiquement.
    expect(reponseEnvoi).toEqual({ envoyees: 0, echouees: 0, annulees: 0, encoreATraiter: false });

    // Ce que ce test PEUT honnêtement affirmer : la ligne n'a ni disparu, ni été marquée
    // "envoyee" à tort — jamais perdue, jamais faussement déclarée partie.
    const apres = await lireRelancesPlanifieesPourObjet(bdd, garage.tenantA.tenant.id, facture.id);
    expect(apres).toHaveLength(1);
    expect(apres[0]!.id).toBe(avant[0]!.id);
    expect(apres[0]!.statut).toBe('prete');
    expect(apres[0]!.annuleRaison).toBeNull();
  });
});

// =================================================================================================
// 3. Point 7 du brief — cas normal aujourd'hui : aucun connecteur nulle part.
// =================================================================================================

describe('POST /relances/facturation/envoyer sans connecteur configuré — cas normal', () => {
  it('rend un lot vide sans erreur, et ne touche AUCUNE ligne "prete" existante (réclamable plus tard, jamais perdue)', async () => {
    const client = garage.tenantA.clients[2]!;
    const dateDocument = joursAvant(10);
    const facture = await creerFactureEmisePourTest(ctx, garage.tenantA, cookiePour, {
      siteId: SITE_A(),
      clientId: client.id,
      dateDocument,
    });

    const cookieDirection = await cookiePour(garage.tenantA, 'direction');
    await planifier(ctx, cookieDirection);
    const avant = await lireRelancesPlanifieesPourObjet(bdd, garage.tenantA.tenant.id, facture.id);
    expect(avant).toHaveLength(1);
    expect(avant[0]!.statut).toBe('prete');

    // Deux appels de suite : ni erreur, ni effet de bord cumulatif.
    const reponse1 = await envoyer(ctx, cookieDirection);
    const reponse2 = await envoyer(ctx, cookieDirection);
    expect(reponse1).toEqual({ envoyees: 0, echouees: 0, annulees: 0, encoreATraiter: false });
    expect(reponse2).toEqual({ envoyees: 0, echouees: 0, annulees: 0, encoreATraiter: false });

    const apres = await lireRelancesPlanifieesPourObjet(bdd, garage.tenantA.tenant.id, facture.id);
    expect(apres).toEqual(avant); // bit pour bit identique : rien n'a bougé.
  });
});
