/**
 * Famille légale (RA-01/RA-03/RA-14) et envoi — sur vraie Postgres éphémère et vrai contrôleur
 * HTTP, canal `email` compris (`ServiceCourriel` + transport de capture hors production).
 *
 * PRIORITÉS DE CE FICHIER (brief de la tâche) :
 *  2. Famille légale — une facture impayée déclenche sa relance SANS consulter les consentements
 *     marketing (exécution du contrat) ; RA-14 (« plus aucun contact ») prime sur tout.
 *  7. Envoi canal `email` — cas normal aujourd'hui (aucun connecteur SMS n'est câblé, mais
 *     l'e-mail n'en a jamais eu besoin, voir issue #136) : part réellement, se trace, et ne peut
 *     pas partir deux fois pour la même ligne.
 *
 * -------------------------------------------------------------------------------------------
 * CORRECTIF ISSUE #136 (« les relances partent réellement ») — CE QUE ÇA CHANGE ICI :
 *
 * Avant #136, `envoyerPretes()` résolvait `NotificationSender` UNE SEULE FOIS pour tout le lot et
 * rendait un lot vide dès que `resoudre()` valait `null` (TOUJOURS, `SourceActivationsConnecteur-
 * Aucune`) — AVANT même de lire une seule ligne `relance_planifiee`. La vérification RA-08/RA-14 À
 * L'EXÉCUTION (`verifierArretAutomatiqueFacture`, dans `traiterUneRelance()`) n'était donc jamais
 * atteinte par un test passant par le VRAI contrôleur HTTP, quel que soit le canal.
 *
 * Depuis #136, la bifurcation se fait PAR LIGNE : `email` part par le socle courriel réel, sans
 * dépendre du registre de connecteurs — `traiterUneRelance()`, RA-08/RA-14 compris, est donc
 * désormais ATTEINT par le chemin HTTP normal pour toute ligne `email`. Les tests ci-dessous le
 * reprouvent DIRECTEMENT ici (pas seulement au niveau unitaire simulé de
 * `src/relances/service-relances-facture.spec.ts`, qui reste la couverture exhaustive des autres
 * branches — facture réglée/contentieuse/annulée par avoir, coordonnée absente). Seul le canal
 * `sms` reste structurellement hors d'atteinte par ce fichier (aucun `NotificationSender` câblé) —
 * à reprendre quand une vraie table/API d'activation de connecteur existera.
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
  mettrePdfEnCachePourTest,
  lireEmailClientPourTest,
  lireHistoriqueEnvoisPourRelance,
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
    await mettrePdfEnCachePourTest(ctx, cookieDirection, facture.id);
    await planifier(ctx, cookieDirection);

    const lignes = await lireRelancesPlanifieesPourObjet(bdd, garage.tenantA.tenant.id, facture.id);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]!.statut).toBe('prete'); // coordonnée (email) toujours exploitée, RA-03.
    expect(lignes[0]!.annuleRaison).toBeNull();

    // Preuve jusqu'au bout, pas seulement à la planification : le refus marketing n'empêche pas
    // non plus l'ENVOI réel — et draine cette ligne au passage, pour ne pas polluer le lot que les
    // tests suivants de ce fichier réclament via ce même endpoint global (`envoyer()` traite TOUT
    // le tenant, jamais un seul objet).
    const reponseEnvoi = await envoyer(ctx, cookieDirection);
    expect(reponseEnvoi.envoyees).toBeGreaterThanOrEqual(1);
    const apres = await lireRelancesPlanifieesPourObjet(bdd, garage.tenantA.tenant.id, facture.id);
    expect(apres[0]!.statut).toBe('envoyee');
  });
});

// =================================================================================================
// 2. RA-14 — « plus aucun contact » prime sur tout, y compris pour un canal (`email`) qui, lui,
//    part réellement depuis #136. Preuve DIRECTE par le chemin HTTP (voir la note de tête de
//    fichier) : la ligne est bloquée à L'ENVOI (`annulee`/`client_ne_plus_contacter`), et surtout
//    n'a laissé AUCUNE trace dans l'historique d'envoi — le client n'a matériellement rien reçu.
// =================================================================================================

describe('RA-14 — client "plus aucun contact"', () => {
  it('la planification n’en tient PAS compte (la ligne devient "prete" comme les autres), mais POST .../envoyer bloque la ligne à l’exécution — jamais expédiée, jamais perdue', async () => {
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
    await mettrePdfEnCachePourTest(ctx, cookieDirection, facture.id);
    await planifier(ctx, cookieDirection);

    const avant = await lireRelancesPlanifieesPourObjet(bdd, garage.tenantA.tenant.id, facture.id);
    expect(avant).toHaveLength(1);
    // RA-14 n'intervient jamais À LA PLANIFICATION (seulement à l'envoi, §9 cas n°8) : la ligne
    // est "prete" comme n'importe quelle autre — sinon ce test ne prouverait rien sur RA-14
    // spécifiquement, seulement qu'aucune ligne n'a jamais existé.
    expect(avant[0]!.statut).toBe('prete');

    const reponseEnvoi = await envoyer(ctx, cookieDirection);
    // La ligne est CLASSÉE (annulée), jamais silencieusement ignorée : ni envoyée, ni échouée
    // (un échec suppose une tentative de transport — il n'y en a AUCUNE ici), ni comptée dans un
    // lot vide comme si elle n'existait pas.
    expect(reponseEnvoi).toEqual({ envoyees: 0, echouees: 0, annulees: 1, encoreATraiter: false });

    // La RÈGLE elle-même, pas seulement son effet de bord : ce client précis n'est JAMAIS
    // destinataire, avec la raison explicite tracée pour l'auditabilité (nLPD).
    const apres = await lireRelancesPlanifieesPourObjet(bdd, garage.tenantA.tenant.id, facture.id);
    expect(apres).toHaveLength(1);
    expect(apres[0]!.id).toBe(avant[0]!.id);
    expect(apres[0]!.statut).toBe('annulee');
    expect(apres[0]!.annuleRaison).toBe('client_ne_plus_contacter');

    // Preuve matérielle, pas seulement le statut de la ligne planifiée : AUCUNE tentative de
    // transport n'a été construite ni journalisée pour ce client — le blocage a lieu AVANT tout
    // appel au socle courriel, jamais après un envoi qu'on aurait ensuite annulé a posteriori.
    const historique = await lireHistoriqueEnvoisPourRelance(
      bdd,
      garage.tenantA.tenant.id,
      avant[0]!.id,
    );
    expect(historique).toHaveLength(0);

    // Un second appel n'a plus rien à traiter (la ligne n'est plus "prete") : ni double-annulation,
    // ni tentative masquée derrière un lot vide.
    const reponseEnvoi2 = await envoyer(ctx, cookieDirection);
    expect(reponseEnvoi2).toEqual({ envoyees: 0, echouees: 0, annulees: 0, encoreATraiter: false });
  });
});

// =================================================================================================
// 3. Point 7 du brief — canal `email`, cas normal aujourd'hui (aucun connecteur SMS câblé, mais
//    l'e-mail n'en dépend jamais depuis #136) : la relance part RÉELLEMENT (transport de capture
//    hors production, jamais un SMTP réel — verrou `courrielDoitEnvoyerReellement` inchangé), se
//    trace, et ne peut pas repartir une seconde fois pour la même ligne.
// =================================================================================================

describe('POST /relances/facturation/envoyer — canal email, cas normal (aucun connecteur SMS requis)', () => {
  it('envoie réellement (capture hors production) une seule fois, trace l’envoi, et ne retouche plus la ligne au second appel', async () => {
    const client = garage.tenantA.clients[2]!;
    const dateDocument = joursAvant(10);
    const facture = await creerFactureEmisePourTest(ctx, garage.tenantA, cookiePour, {
      siteId: SITE_A(),
      clientId: client.id,
      dateDocument,
    });

    const cookieDirection = await cookiePour(garage.tenantA, 'direction');
    await mettrePdfEnCachePourTest(ctx, cookieDirection, facture.id);
    await planifier(ctx, cookieDirection);
    const avant = await lireRelancesPlanifieesPourObjet(bdd, garage.tenantA.tenant.id, facture.id);
    expect(avant).toHaveLength(1);
    expect(avant[0]!.statut).toBe('prete');

    // Deux appels de suite : le premier envoie réellement, le second ne retrouve plus rien à
    // réclamer (la ligne n'est plus "prete") — ni erreur, ni double envoi.
    const reponse1 = await envoyer(ctx, cookieDirection);
    const reponse2 = await envoyer(ctx, cookieDirection);
    expect(reponse1).toEqual({ envoyees: 1, echouees: 0, annulees: 0, encoreATraiter: false });
    expect(reponse2).toEqual({ envoyees: 0, echouees: 0, annulees: 0, encoreATraiter: false });

    const apres = await lireRelancesPlanifieesPourObjet(bdd, garage.tenantA.tenant.id, facture.id);
    expect(apres).toHaveLength(1);
    expect(apres[0]!.id).toBe(avant[0]!.id);
    expect(apres[0]!.statut).toBe('envoyee');
    expect(apres[0]!.annuleRaison).toBeNull();

    // Preuve matérielle d'un envoi RÉEL (via le socle courriel, transport de capture) : une seule
    // ligne d'historique, jamais deux (le second appel n'a rien reconstruit ni renvoyé).
    const historique = await lireHistoriqueEnvoisPourRelance(
      bdd,
      garage.tenantA.tenant.id,
      avant[0]!.id,
    );
    expect(historique).toHaveLength(1);
    expect(historique[0]!.canal).toBe('email');
    expect(historique[0]!.statutEnvoi).toBe('envoye');
    const emailClient = await lireEmailClientPourTest(bdd, garage.tenantA.tenant.id, client.id);
    expect(historique[0]!.destinataireFige).toBe(emailClient);
    expect(historique[0]!.fournisseurMessageId).toBeTruthy();
  });
});
