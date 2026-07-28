/**
 * Sentry, de bout en bout, sur vraie app NestJS + vrai SDK `@sentry/nestjs` initialisé (pas de
 * mock du SDK) — ce que les tests unitaires de `src/observabilite/` NE peuvent PAS prouver :
 *
 *   - `nettoyer-evenement.spec.ts` prouve que `nettoyerEvenementSentry(event)` nettoie un
 *     événement qu'on lui fournit à la main.
 *   - `initialiser-sentry.spec.ts` prouve que `Sentry.init()` est appelé avec les bonnes options.
 *   - AUCUN test existant ne prouve que, sur une VRAIE requête HTTP qui déclenche une VRAIE
 *     erreur inattendue, le SDK capture effectivement un événement, que cet événement passe
 *     réellement par `nettoyerEvenementSentry` (branché en `beforeSend`), et que ce qui atteint
 *     le TRANSPORT est bien nettoyé — c'est tout l'objet de ce fichier.
 *
 * Trois garanties, dans l'ordre de CONTRIBUTING.md (isolation tenant d'abord, mais ici il s'agit de
 * fiabilité et nLPD — l'ordre suit l'énoncé de la mission) :
 *
 *   1. Résilience : Sentry INJOIGNABLE (instance auto-hébergée éteinte) ne doit JAMAIS
 *      dégrader le service — ni requête normale, ni requête en erreur.
 *   2. nLPD : une erreur inattendue déclenchée par une requête qui porte un e-mail et un mot de
 *      passe en clair (POST /auth/connexion) — et, séparément, un cookie de session valide sur
 *      une requête authentifiée (GET /auth/moi) — ne laisse fuiter NI l'un NI l'autre dans ce
 *      que le transport Sentry aurait envoyé.
 *   3. Pas de bruit : un 401 « identifiants invalides » (le cas normal d'un mot de passe tapé de
 *      travers) ne doit produire AUCUN événement Sentry — sinon chaque échec de connexion
 *      deviendrait un incident et noierait les vrais.
 *
 * Interception : `client.on('beforeSendEvent', …)` sur le VRAI client retourné par
 * `Sentry.getClient()` après l'appel réel à `initialiserSentry()` (voir `app-test.ts`, qui
 * reproduit désormais l'étape 2 de `main.ts`). `beforeSendEvent` est émis dans `Client.sendEvent`
 * (voir `@sentry/core/build/cjs/client.js`) juste APRÈS que `processBeforeSend` (qui applique
 * `beforeSend` = `nettoyerEvenementSentry`) a produit l'événement final, et juste AVANT que ce
 * même événement soit enveloppé puis remis à `transport.send(envelope)` — c'est donc,
 * fidèlement, l'événement « tel qu'il serait envoyé », déjà nettoyé, sans encore avoir besoin
 * d'importer les types internes d'enveloppe (`Envelope`/`forEachEnvelopeItem` ne sont pas
 * réexportés par `@sentry/nestjs`, seul `@sentry/nestjs` est une dépendance directe d'apps/api —
 * `@sentry/core` ne l'est pas et pnpm interdit d'importer une dépendance transitive non
 * déclarée). Pas de mock réseau (`nock` et consorts) : le DSN pointe un port TCP local fermé,
 * donc le VRAI transport HTTP du SDK tente réellement une connexion, échoue réellement
 * (ECONNREFUSED), et cet échec est réellement avalé par le SDK (voir `Client.sendEnvelope`,
 * `catch (reason) { return {}; }`) — exactement le scénario « Sentry auto-hébergé est en panne ».
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:net';
import * as Sentry from '@sentry/nestjs';
import type { Event as EvenementSentry } from '@sentry/nestjs';

import { demarrerBaseEphemere, type BaseEphemere } from '../setup/postgres-ephemere';
import { semerGarageDemo, ajouterUtilisateurFixture, type GarageDemoFixture } from '../fixtures/garage-demo';
import { creerAppTest, demarrerRedisEphemere, extraireValeurCookie, type AppTest, type RedisEphemere } from '../setup/app-test';

const CHEMIN_CONNEXION = '/api/v1/auth/connexion';
const CHEMIN_MOI = '/api/v1/auth/moi';

/** Un port TCP local qu'on sait FERMÉ : on en ouvre un, puis on le referme aussitôt. Une
 *  tentative de connexion dessus produit un `ECONNREFUSED` quasi instantané (RST immédiat sur
 *  loopback), jamais un timeout — contrairement à un port au hasard qui pourrait, par
 *  malchance, être occupé par autre chose sur la machine qui exécute ces tests. */
async function portFerme(): Promise<number> {
  const serveur = createServer();
  const port = await new Promise<number>((resoudre, rejeter) => {
    serveur.once('error', rejeter);
    serveur.listen(0, '127.0.0.1', () => {
      const adresse = serveur.address();
      if (adresse === null || typeof adresse === 'string') {
        rejeter(new Error('adresse de serveur de test inattendue'));
        return;
      }
      resoudre(adresse.port);
    });
  });
  await new Promise<void>((resoudre) => serveur.close(() => resoudre()));
  return port;
}

/** DSN syntaxiquement valide (le SDK exige une URL `https://clé@hôte/projet`), pointant le port
 *  fermé ci-dessus — simule une instance Sentry auto-hébergée injoignable, sans jamais toucher
 *  au réseau réel. */
function dsnInjoignable(port: number): string {
  return `http://cleDePublique@127.0.0.1:${port}/1`;
}

/** Attend qu'une condition devienne vraie, en la réévaluant à intervalles courts — nécessaire
 *  parce que `Sentry.captureException` (appelé de façon synchrone et jamais attendue par
 *  `FiltreProbleme.catch`, exprès : voir `capturer-erreur-inattendue.ts`) termine son pipeline
 *  interne (`_prepareEvent` → `beforeSend` → `beforeEnvelope`) de façon asynchrone, sur des
 *  microtâches qui peuvent courir APRÈS que la réponse HTTP a déjà été reçue par supertest. */
async function attendreQue(condition: () => boolean, delaiMaxMs = 5000): Promise<void> {
  const debut = Date.now();
  while (!condition()) {
    if (Date.now() - debut > delaiMaxMs) {
      throw new Error(`Condition non satisfaite après ${delaiMaxMs}ms`);
    }
    await new Promise((resoudre) => setTimeout(resoudre, 25));
  }
}

/** Sérialise un événement Sentry et cherche une sous-chaîne — la façon la plus robuste de
 *  vérifier une absence de fuite : peu importe SOUS QUEL CHAMP une donnée sensible se cacherait
 *  (extra, breadcrumb, message d'exception, contexte…), si elle apparaît nulle part dans le JSON
 *  entier de l'événement, elle n'a fuité nulle part. */
function evenementContient(evenement: EvenementSentry, sousChaine: string): boolean {
  return JSON.stringify(evenement).includes(sousChaine);
}

let bdd: BaseEphemere;
let redis: RedisEphemere;
let demo: GarageDemoFixture;

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  demo = await semerGarageDemo(bdd);
  redis = await demarrerRedisEphemere();
}, 180_000);

afterAll(async () => {
  await redis?.fermer();
  await bdd?.fermer();
});

describe('sans SENTRY_DSN — cas nominal de développement (voir .env.example)', () => {
  let ctx: AppTest;

  beforeAll(async () => {
    // Pas de surcharge SENTRY_DSN : `envTest()` (app-test.ts) ne le pose jamais par défaut.
    ctx = await creerAppTest(bdd, redis.url);
  }, 60_000);

  afterAll(async () => {
    await ctx?.fermer();
  });

  it("l'API démarre et sert une requête normale sans qu'aucun client Sentry n'ait été créé", async () => {
    // Preuve que `initialiserSentry` est un no-op véritable, pas un no-op "silencieux mais quand
    // même partiellement initialisé" : AUCUN client global n'existe.
    expect(Sentry.getClient()).toBeUndefined();

    const debut = Date.now();
    const reponse = await ctx.requete.get(CHEMIN_MOI);
    const duree = Date.now() - debut;

    // Sans cookie, `GardeSession` refuse — 401 attendu, mais surtout : ça répond, et vite.
    expect(reponse.status).toBe(401);
    expect(duree).toBeLessThan(2000);
  });
});

describe('avec SENTRY_DSN pointant une instance injoignable (port local fermé)', () => {
  let ctx: AppTest;
  let evenements: EvenementSentry[];
  let desabonner: (() => void) | undefined;

  beforeAll(async () => {
    const port = await portFerme();
    ctx = await creerAppTest(bdd, redis.url, {
      SENTRY_DSN: dsnInjoignable(port),
      // Échantillonnage de traces à 0 : sans ça, une infime fraction des requêtes de ce fichier
      // produirait aussi des événements "transaction" (performance), qui feraient grossir
      // `evenements` sans rapport avec ce que ces tests vérifient (capture d'ERREURS) — un flake
      // rare mais réel sur le test "aucun événement" ci-dessous. Ce fichier ne teste que la
      // capture d'erreurs, jamais le tracing de performance.
      SENTRY_TAUX_ECHANTILLONNAGE_TRACES: '0',
    });

    const client = Sentry.getClient();
    // Sanity check : si CETTE assertion échoue, tout le reste du describe est vide de sens (un
    // client jamais créé rendrait chaque `it()` ci-dessous vacueusement vert) — exactement le
    // genre de faux positif que la mission demande d'éliminer.
    expect(client).toBeDefined();
    evenements = [];
    desabonner = client!.on('beforeSendEvent', (evenement) => {
      // Défense en profondeur en plus de SENTRY_TAUX_ECHANTILLONNAGE_TRACES=0 ci-dessus : ne
      // retenir que les événements d'ERREUR (`type` absent — voir `ErrorEvent` : les
      // transactions portent `type: 'transaction'`).
      if (evenement.type === undefined) {
        evenements.push(evenement);
      }
    });
  }, 60_000);

  afterEach(() => {
    evenements.length = 0;
  });

  afterAll(async () => {
    desabonner?.();
    await ctx?.fermer();
    // Referme le client global : sans ça, il resterait "actuel" pour tout le reste du process
    // (un seul worker vitest, `fileParallelism: false`) et polluerait les fichiers de spec
    // suivants, qui eux ne s'attendent à aucun client Sentry configuré.
    await Sentry.close(2000);
  });

  it('une requête normale répond vite, sans jamais attendre le réseau vers Sentry', async () => {
    const debut = Date.now();
    const reponse = await ctx.requete.get(CHEMIN_MOI);
    const duree = Date.now() - debut;

    expect(reponse.status).toBe(401);
    expect(duree).toBeLessThan(2000);
  });

  it(
    "une erreur interne inattendue répond normalement (jamais bloquée par un Sentry injoignable), " +
      "et produit malgré tout un événement Sentry — la preuve que le harnais d'interception capte " +
      'bien un événement RÉEL quand il y en a un (et donc que "zéro événement" dans le test suivant ' +
      "n'est pas un faux négatif dû à un hook mal branché)",
    async () => {
      // Sabotage temporaire, réversible : retire à `dfa_app` le droit d'exécuter la fonction
      // SECURITY DEFINER utilisée par `connecter()` pour résoudre l'e-mail (amorcage.utilisateur_
      // par_email — voir authentification.service.ts:75 et la migration 0001_socle_rls.sql:284).
      // Ça déclenche une VRAIE erreur Postgres non typée ("permission denied for function"),
      // exactement le genre d'erreur imprévue que `FiltreProbleme` transforme en 500
      // ERREUR_INTERNE et envoie à Sentry — sans toucher un octet de code applicatif.
      await bdd.poolMigrateur.query('revoke execute on function amorcage.utilisateur_par_email(text) from dfa_app');
      try {
        const debut = Date.now();
        const reponse = await ctx.requete
          .post(CHEMIN_CONNEXION)
          .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
          .set('Cookie', 'dfa_session=jeton-de-session-tres-secret-abc123')
          .send({ email: 'nlpd.test@garage-martin.test', motDePasse: 'MotDePasseTresSensible!99' });
        const duree = Date.now() - debut;

        expect(reponse.status).toBe(500);
        expect(reponse.body.code).toBe('ERREUR_INTERNE');
        // La garantie de résilience : même avec Sentry injoignable, la réponse part vite —
        // `capturerErreurInattendue` n'est JAMAIS `await`é par `FiltreProbleme.catch` (voir le
        // commentaire de tête de ce fichier), donc l'échec réseau du transport Sentry, qui se
        // produit APRÈS coup en tâche de fond, ne peut pas retarder cette réponse.
        expect(duree).toBeLessThan(3000);

        await attendreQue(() => evenements.length >= 1);
        expect(evenements.length).toBeGreaterThanOrEqual(1);
      } finally {
        await bdd.poolMigrateur.query('grant execute on function amorcage.utilisateur_par_email(text) to dfa_app');
      }
    },
  );

  it(
    "l'événement capturé pour l'erreur ci-dessus ne contient NULLE PART le mot de passe, " +
      "l'e-mail, le cookie ou le jeton de session portés par la requête",
    async () => {
      const EMAIL = 'nlpd.controle@garage-martin.test';
      const MOT_DE_PASSE = 'UnAutreMotDePasseSensible!77';
      const COOKIE_SECRET = 'dfa_session=un-jeton-de-session-strictement-secret-xyz789';

      await bdd.poolMigrateur.query('revoke execute on function amorcage.utilisateur_par_email(text) from dfa_app');
      try {
        const reponse = await ctx.requete
          .post(CHEMIN_CONNEXION)
          .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
          .set('Cookie', COOKIE_SECRET)
          .send({ email: EMAIL, motDePasse: MOT_DE_PASSE });
        expect(reponse.status).toBe(500);

        await attendreQue(() => evenements.length >= 1);
        expect(evenements.length).toBeGreaterThanOrEqual(1);

        for (const evenement of evenements) {
          expect(evenementContient(evenement, MOT_DE_PASSE)).toBe(false);
          expect(evenementContient(evenement, EMAIL)).toBe(false);
          expect(evenementContient(evenement, 'un-jeton-de-session-strictement-secret-xyz789')).toBe(false);
          expect(evenementContient(evenement, 'dfa_session=')).toBe(false);
          // Défense en profondeur : le corps de requête entier ne doit pas apparaître non plus
          // (chemin /auth → suppression intégrale de `request.data`, voir nettoyer-evenement.ts).
          expect(evenement.request?.data).toBeUndefined();
          expect(evenement.request?.cookies).toBeUndefined();
        }
      } finally {
        await bdd.poolMigrateur.query('grant execute on function amorcage.utilisateur_par_email(text) to dfa_app');
      }
    },
  );

  it(
    "sur une requête AUTHENTIFIÉE (session valide) qui échoue de façon inattendue, le jeton de " +
      "session en clair ne fuite pas non plus dans l'événement capturé",
    async () => {
      // Contrairement aux deux tests ci-dessus (échec AVANT authentification, sur /auth/connexion),
      // celui-ci porte une VRAIE session ouverte, pour prouver que le cookie de session d'une
      // requête authentifiée ordinaire — pas seulement un cookie parasite sur /auth — ne fuite
      // jamais non plus.
      const utilisateurDedie = await ajouterUtilisateurFixture(bdd, demo.tenantA.id, {
        prenom: 'Nlpd',
        nom: 'TestSessionAuthentifiee',
        role: 'technicien',
        email: 'nlpd.session.authentifiee@garage-martin.test',
      });
      const connexion = await ctx.requete
        .post(CHEMIN_CONNEXION)
        .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
        .send({ email: utilisateurDedie.email, motDePasse: utilisateurDedie.motDePasseClair });
      expect(connexion.status).toBe(200);
      const jetonClair = extraireValeurCookie(connexion, ctx.config.SESSION_COOKIE_NOM);
      const cookie = `${ctx.config.SESSION_COOKIE_NOM}=${jetonClair}`;

      // Sabotage temporaire, réversible : `GET /auth/moi` résout la session via la fonction
      // SECURITY DEFINER `amorcage.session_par_empreinte` (non affectée par ce revoke — elle
      // s'exécute avec les privilèges de son PROPRIÉTAIRE, pas de l'appelant), mais construit
      // ensuite sa réponse via un SELECT Drizzle ordinaire sur `utilisateur`, exécuté avec les
      // privilèges RÉELS de `dfa_app` (voir authentification.service.ts, sessionCourante()) :
      // retirer ce droit-là déclenche une VRAIE erreur imprévue, APRÈS authentification réussie.
      await bdd.poolMigrateur.query('revoke select on public.utilisateur from dfa_app');
      try {
        const reponse = await ctx.requete.get(CHEMIN_MOI).set('Cookie', cookie);
        expect(reponse.status).toBe(500);
        expect(reponse.body.code).toBe('ERREUR_INTERNE');

        await attendreQue(() => evenements.length >= 1);
        expect(evenements.length).toBeGreaterThanOrEqual(1);

        for (const evenement of evenements) {
          expect(evenementContient(evenement, jetonClair)).toBe(false);
          expect(evenementContient(evenement, `${ctx.config.SESSION_COOKIE_NOM}=${jetonClair}`)).toBe(false);
          expect(evenementContient(evenement, utilisateurDedie.email)).toBe(false);
          expect(evenement.request?.cookies).toBeUndefined();
        }
      } finally {
        await bdd.poolMigrateur.query('grant select on public.utilisateur to dfa_app');
      }
    },
  );

  it("un échec de connexion normal (401 identifiants invalides) ne produit AUCUN événement Sentry", async () => {
    const reponse = await ctx.requete
      .post(CHEMIN_CONNEXION)
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .send({ email: 'personne.nexiste.pas@garage-martin.test', motDePasse: 'peu-importe-lequel' });

    expect(reponse.status).toBe(401);
    expect(reponse.body.code).toBe('AUTH_IDENTIFIANTS_INVALIDES');

    // Fenêtre d'observation : on ne peut pas prouver une absence en interrogeant au temps T=0
    // (rien n'a encore eu le temps d'arriver même s'il y avait un bug) — on laisse une marge
    // largement supérieure au délai empiriquement observé pour un événement RÉEL dans le test
    // "produit malgré tout un événement Sentry" ci-dessus.
    await new Promise((resoudre) => setTimeout(resoudre, 500));
    expect(evenements).toHaveLength(0);
  });
});
