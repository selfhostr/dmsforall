/**
 * Machine à états de `ordre_reparation` — preuve END-TO-END, PAR L'API RÉELLE (contrôleur →
 * service → trigger `verifier_transition()` en base), sur vraie base Postgres éphémère.
 *
 * Complète (sans les dupliquer) `test/lot1/machine-etats/transitions-ordre-reparation.spec.ts` et
 * `transitions-ligne-or.spec.ts` (hors périmètre d'écriture de cette tâche, pas touchés), qui
 * prouvent le garde-fou EN BASE en écrivant directement `ordre_reparation.statut` par SQL — un
 * dispositif nécessaire à l'époque où aucun contrôleur n'existait encore. Les contrôleurs de
 * transition (`ordre-reparation-transitions.controller.ts`) existent désormais : ce fichier prouve
 * la MÊME règle mais par le CHEMIN RÉEL qu'emprunte un utilisateur — cookie de session, garde de
 * droit, service, traduction de l'erreur SQL en `application/problem+json` — parce qu'un bug peut
 * se nicher dans n'importe lequel de ces maillons, pas seulement dans le trigger.
 *
 * DÉFAUT RÉEL DÉCOUVERT PAR CE FICHIER (signalé, PAS corrigé — `apps/api/src/` n'est pas notre
 * périmètre) : voir le commentaire détaillé en tête de la section 2. En bref, la chaîne
 * HTTP → service → `verifier_transition()` NE traduit PAS aujourd'hui le SQLSTATE `ZDFA1` en
 * `409 OR_TRANSITION_INTERDITE` — elle rend `500 ERREUR_INTERNE`. La base REFUSE bien la
 * transition interdite (la garantie la plus importante tient), mais l'API ne restitue pas ce refus
 * fidèlement à l'appelant. Les tests de la section 2 documentent ce défaut EXPRÈS (ils sont rouges
 * pour cette raison précise, pas par erreur d'écriture) — même convention que le commentaire C-13
 * de `test/lot1/contrat/contrat-generique-lot1.spec.ts` (« ACTUELLEMENT ROUGE, c'est ATTENDU »).
 *
 * Nommage des tenants : `garage-a` / `garage-b` dans les commentaires (physiquement
 * `garage.tenantA` / `garage.tenantB`, identifiants hérités de `garage-demo-lot1.ts`, hors
 * périmètre d'écriture de cette tâche).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demarrerBaseEphemere, ecrireSousTenant, type BaseEphemere } from '../setup/postgres-ephemere';
import { creerAppTest, demarrerRedisEphemere, type AppTest, type RedisEphemere } from '../setup/app-test';
import { creerOrPourTest, semerGarageDemoLot1, type GarageDemoLot1Fixture, type OrDeTest } from './fixtures/garage-demo-lot1';
import { cookieDeSessionPour } from './isolation-http-aide';

let bdd: BaseEphemere;
let garage: GarageDemoLot1Fixture;
let redis: RedisEphemere;
let ctx: AppTest;

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  garage = await semerGarageDemoLot1(bdd);
  redis = await demarrerRedisEphemere();
  ctx = await creerAppTest(bdd, redis.url);
}, 180_000);

afterAll(async () => {
  await ctx?.fermer();
  await redis?.fermer();
  await bdd?.fermer();
});

async function nouvelOrPlanifie(): Promise<OrDeTest> {
  const t = garage.tenantA;
  return creerOrPourTest(bdd, t.tenant, t.tenant.sites[0]!.id, t.clients[0]!, t.vehicules[0]!);
}

async function cookieReceptionnaire(): Promise<string> {
  const u = garage.tenantA.utilisateursParRole.receptionnaire;
  return cookieDeSessionPour(ctx, u.email, u.motDePasseClair);
}

async function cookieChefAtelier(): Promise<string> {
  const u = garage.tenantA.utilisateursParRole.chef_atelier;
  return cookieDeSessionPour(ctx, u.email, u.motDePasseClair);
}

/** `garage.tenantA.vehicules[0]` porte déjà, via la fixture partagée, un historique kilométrique
 *  qui culmine à 41'200 km (`garage-demo-lot1.ts`, non modifiable ici). Toute réception doit
 *  déclarer un kilométrage STRICTEMENT croissant (RM-23/24, `VEHICULE_KILOMETRAGE_REGRESSIF`
 *  sinon) : ce compteur, partagé par tout le fichier, garantit que chaque appel HTTP à
 *  `/receptionner` — qui insère lui-même une nouvelle lecture — reste au-dessus de tout ce qui
 *  précède, y compris les lectures insérées par les tests précédents du même fichier. */
let prochainKilometrage = 100_000;
function kilometrageCroissant(): number {
  prochainKilometrage += 1_000;
  return prochainKilometrage;
}

interface CorpsErreurTransition {
  readonly code?: string;
  readonly detail?: string;
  readonly actionsProposees?: ReadonlyArray<{ code?: string }>;
  readonly blocages?: ReadonlyArray<{ type?: string; id?: string }>;
}

// -------------------------------------------------------------------------------------------
// 1. La chaîne AUTORISÉE traverse réellement guard + service + trigger, à travers PLUSIEURS
//    rôles (receptionnaire puis chef_atelier) — pas un raccourci direct-SQL.
// -------------------------------------------------------------------------------------------

describe('ordre_reparation — chaîne de transitions AUTORISÉES, par les vrais endpoints HTTP', () => {
  it('planifie → ouvert → en_cours → controle → termine, chacune via son endpoint réel, chacune persistée en base', async () => {
    const or = await nouvelOrPlanifie();
    const cookieReceptionn = await cookieReceptionnaire();
    const cookieChef = await cookieChefAtelier();

    // T-03 planifie -> ouvert (receptionnaire)
    const receptionne = await ctx.requete
      .post(`/api/v1/ordres-reparation/${or.id}/receptionner`)
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .set('Cookie', cookieReceptionn)
      .send({ kilometrageEntree: kilometrageCroissant(), unite: 'km' });
    expect(receptionne.status, JSON.stringify(receptionne.body)).toBeLessThan(300);
    expect((receptionne.body as { donnees?: { statut?: string } }).donnees?.statut).toBe('ouvert');

    // T-04 ouvert -> en_cours (chef_atelier : receptionnaire n'a pas ce droit, cf. matrice §"technicien"/"chef_atelier")
    const demarre = await ctx.requete
      .post(`/api/v1/ordres-reparation/${or.id}/demarrer`)
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .set('Cookie', cookieChef)
      .send({});
    expect(demarre.status, JSON.stringify(demarre.body)).toBeLessThan(300);
    expect((demarre.body as { donnees?: { statut?: string } }).donnees?.statut).toBe('en_cours');

    // T-11 en_cours -> controle (aucune ligne : I-08/I-09 trivialement satisfaites)
    const passeEnControle = await ctx.requete
      .post(`/api/v1/ordres-reparation/${or.id}/passer-en-controle`)
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .set('Cookie', cookieChef)
      .send({});
    expect(passeEnControle.status, JSON.stringify(passeEnControle.body)).toBeLessThan(300);
    expect((passeEnControle.body as { donnees?: { statut?: string } }).donnees?.statut).toBe('controle');

    // T-13 controle -> termine
    const chefUtilisateur = garage.tenantA.utilisateursParRole.chef_atelier;
    const termine = await ctx.requete
      .post(`/api/v1/ordres-reparation/${or.id}/valider-controle`)
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .set('Cookie', cookieChef)
      .send({ controleurId: chefUtilisateur.id, pointsControles: [] });
    expect(termine.status, JSON.stringify(termine.body)).toBeLessThan(300);
    expect((termine.body as { donnees?: { statut?: string } }).donnees?.statut).toBe('termine');
  });
});

// -------------------------------------------------------------------------------------------
// 2. Transitions INTERDITES, par le VRAI endpoint HTTP — DÉFAUT RÉEL DOCUMENTÉ ICI.
//
// Ce que ces trois tests DEVRAIENT observer (et ce que documente `ApiReponseProbleme(409, …)` sur
// `ordre-reparation-transitions.controller.ts`) : `409 OR_TRANSITION_INTERDITE`, avec `detail` et
// `actionsProposees` fidèles au contenu du trigger.
//
// Ce qu'ils observent RÉELLEMENT (vérifié en exécution, 2026-07-28) : `500 ERREUR_INTERNE`.
//
// CAUSE RACINE (isolée en ajoutant temporairement `LOG_NIVEAU=debug` à `creerAppTest` pour lire le
// message journalisé par `ServiceJournal`, retiré depuis) : `ServiceTransitions.transitionner()`
// (atelier/service-transitions.ts) attrape l'erreur de l'UPDATE Drizzle et la passe telle quelle à
// `traduireErreurTransition()` → `interpreterErreurTransitionInterdite()`
// (common/avertissements/traducteur-erreur-transition-sql.ts), qui lit `erreur.code`,
// `erreur.table`, `erreur.detail`, `erreur.hint` DIRECTEMENT sur l'objet attrapé. Mais
// drizzle-orm@0.44 (node_modules/drizzle-orm/errors.js, classe `DrizzleQueryError`) enveloppe
// TOUJOURS l'erreur pg réelle dans un objet dont le message commence par `"Failed query: …"` et qui
// porte l'erreur pg d'origine dans sa propriété `.cause` — PAS dans ses propres `.code`/`.table`/
// `.detail`/`.hint`, qui sont `undefined`. `interpreterErreurTransitionInterdite` reçoit donc
// toujours `brute.code === undefined`, ne reconnaît jamais `ZDFA1`, et rend `null` ; le service
// relance alors l'erreur Drizzle telle quelle, que `FiltreProbleme` ne sait traiter que comme une
// exception non typée → `500 ERREUR_INTERNE`.
//
// PORTÉE : ce n'est pas spécifique à `receptionner`/`cloturer`. `traduireErreurTransition` est
// partagée par `service-transitions.ts` (11 actions de transition d'OR), `service-ligne-or.ts`
// (marquer-realisee, valider/refuser/annuler-lignes…) et `service-devis.ts` — TOUTE transition
// interdite déclenchée par le VRAI serveur HTTP (par opposition aux tests qui écrivent en SQL
// direct, comme `transitions-ordre-reparation.spec.ts`) ressort donc en 500, jamais en 409.
//
// SCÉNARIO DE REPRODUCTION MINIMAL (hors ce fichier de test, à la main) :
//   1. Créer un OR au statut `planifie` (n'importe lequel).
//   2. `POST /api/v1/ordres-reparation/{id}/cloturer` avec une session authentifiée ayant le droit
//      `atelier.or.cloturer` (ex. receptionnaire).
//   3. Observer `500 {"code":"ERREUR_INTERNE", …}` au lieu du `409 OR_TRANSITION_INTERDITE`
//      documenté par le contrôleur.
//
// La GARANTIE la plus importante (CONTRIBUTING.md : « les transitions interdites doivent échouer »)
// TIENT quand même : rien n'est écrit en base, l'OR reste dans son état d'origine (vérifié
// ci-dessous). C'est la FIDÉLITÉ de la traduction HTTP qui est cassée, pas l'intégrité des
// données — mais un 500 générique prive le front de `actionsProposees`/`blocages`, qu'un
// garagiste ne devrait jamais recevoir sous forme d'« erreur interne » pour un refus parfaitement
// normal et attendu de son métier.
// -------------------------------------------------------------------------------------------

describe("ordre_reparation — transitions INTERDITES, par le VRAI endpoint HTTP (RED PAR DÉFAUT RÉEL — voir le commentaire ci-dessus)", () => {
  it(
    "planifie → cloture (aucun endpoint applicatif ne s'interpose : /cloturer ne pré-vérifie rien) " +
      'DEVRAIT être refusée par le trigger avec 409 OR_TRANSITION_INTERDITE — observé aujourd\'hui : 500 (défaut signalé, non corrigé ici)',
    async () => {
      const or = await nouvelOrPlanifie();
      const cookie = await cookieReceptionnaire();

      const reponse = await ctx.requete
        .post(`/api/v1/ordres-reparation/${or.id}/cloturer`)
        .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
        .set('Cookie', cookie)
        .send({});

      expect(reponse.status).toBe(409);
      expect(reponse.headers['content-type']).toContain('application/problem+json');
      const corps = reponse.body as CorpsErreurTransition;
      expect(corps.code).toBe('OR_TRANSITION_INTERDITE');
      expect(corps.detail).toBe('entite=ordre_reparation;depuis=planifie;vers=cloture');
      expect(corps.actionsProposees).toEqual([{ code: 'RAFRAICHIR' }]);
      expect(corps.blocages?.[0]?.type).toBe('ordre_reparation');
      expect(corps.blocages?.[0]?.id).toBe(or.id);

      // Ce contrôle-ci N'EST PAS affecté par le défaut de traduction : la GARANTIE d'intégrité
      // (l'OR n'a pas bougé, quel que soit le code HTTP renvoyé à l'appelant) tient bel et bien.
      const relu = await ctx.requete.get(`/api/v1/ordres-reparation/${or.id}`).set('Cookie', cookie);
      expect(relu.body).toMatchObject({ statut: 'planifie' });
    },
  );

  it(
    'ouvert → cloture DEVRAIT être refusée avec un HINT DIFFÉRENT de « planifie → cloture » (les transitions ' +
      'réellement possibles depuis « ouvert ») — observé aujourd\'hui : 500 (même défaut)',
    async () => {
      const or = await nouvelOrPlanifie();
      const cookie = await cookieReceptionnaire();
      const receptionne = await ctx.requete
        .post(`/api/v1/ordres-reparation/${or.id}/receptionner`)
        .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
        .set('Cookie', cookie)
        .send({ kilometrageEntree: kilometrageCroissant(), unite: 'km' });
      expect(receptionne.status).toBeLessThan(300);

      const reponse = await ctx.requete
        .post(`/api/v1/ordres-reparation/${or.id}/cloturer`)
        .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
        .set('Cookie', cookie)
        .send({});

      expect(reponse.status).toBe(409);
      const corps = reponse.body as CorpsErreurTransition;
      expect(corps.code).toBe('OR_TRANSITION_INTERDITE');
      expect(corps.detail).toBe('entite=ordre_reparation;depuis=ouvert;vers=cloture');
    },
  );

  it("un OR au statut terminal « cloture » NE DEVRAIT accepter aucune transition, avec actionsProposees VIDE — observé aujourd'hui : 500 dès la première transition tentée (défaut de traduction, pas d'échec du trigger)", async () => {
    const or = await nouvelOrPlanifie();
    const cookieReceptionn = await cookieReceptionnaire();
    const cookieChef = await cookieChefAtelier();
    const chefUtilisateur = garage.tenantA.utilisateursParRole.chef_atelier;

    await ctx.requete
      .post(`/api/v1/ordres-reparation/${or.id}/receptionner`)
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .set('Cookie', cookieReceptionn)
      .send({ kilometrageEntree: kilometrageCroissant(), unite: 'km' });
    await ctx.requete
      .post(`/api/v1/ordres-reparation/${or.id}/demarrer`)
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .set('Cookie', cookieChef)
      .send({});
    await ctx.requete
      .post(`/api/v1/ordres-reparation/${or.id}/passer-en-controle`)
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .set('Cookie', cookieChef)
      .send({});
    await ctx.requete
      .post(`/api/v1/ordres-reparation/${or.id}/valider-controle`)
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .set('Cookie', cookieChef)
      .send({ controleurId: chefUtilisateur.id, pointsControles: [] });
    const restitue = await ctx.requete
      .post(`/api/v1/ordres-reparation/${or.id}/restituer`)
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .set('Cookie', cookieReceptionn)
      .send({});
    expect(restitue.status, JSON.stringify(restitue.body)).toBeLessThan(300);
    const cloture = await ctx.requete
      .post(`/api/v1/ordres-reparation/${or.id}/cloturer`)
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .set('Cookie', cookieReceptionn)
      .send({});
    expect(cloture.status, JSON.stringify(cloture.body)).toBeLessThan(300);
    expect((cloture.body as { donnees?: { statut?: string } }).donnees?.statut).toBe('cloture');

    // IMPORTANT : rejouer /cloturer ici ne prouverait RIEN — `cloturer()` écrit `statut = 'cloture'`
    // sans condition, et le trigger laisse toujours passer une écriture qui NE CHANGE PAS le statut
    // (`depuis is not distinct from vers`, voir verifier_transition() §6) : ce serait un aller-retour
    // sans effet, pas une transition refusée. Le test probant est une AUTRE action, qui tente un
    // VRAI changement de statut (`receptionner` vise toujours `ouvert`, sans jamais vérifier l'état
    // de départ en amont) : depuis « cloture », `ouvert` n'existe dans aucune ligne du référentiel.
    const tentative = await ctx.requete
      .post(`/api/v1/ordres-reparation/${or.id}/receptionner`)
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .set('Cookie', cookieReceptionn)
      .send({ kilometrageEntree: kilometrageCroissant(), unite: 'km' });
    expect(tentative.status).toBe(409);
    const corps = tentative.body as CorpsErreurTransition;
    expect(corps.code).toBe('OR_TRANSITION_INTERDITE');
    expect(corps.detail).toBe('entite=ordre_reparation;depuis=cloture;vers=ouvert');
    expect(corps.actionsProposees).toEqual([]);

    // Contrôle négatif — cette partie n'est PAS affectée par le défaut : l'OR est resté « cloture ».
    const relu = await ctx.requete.get(`/api/v1/ordres-reparation/${or.id}`).set('Cookie', cookieReceptionn);
    expect(relu.body).toMatchObject({ statut: 'cloture' });
  });
});

// -------------------------------------------------------------------------------------------
// 3. La règle vit dans les DONNÉES du référentiel, pas dans du code — preuve par mutation :
//    retirer une ligne de `transition_autorisee` rend refusée une transition AUPARAVANT légale.
//
//    DÉLIBÉRÉMENT AU NIVEAU BASE (pool `dfa_app` sous RLS, comme `AccesBase.enTenant` le ferait),
//    PAS via HTTP : ce test vérifie une propriété du TRIGGER et du RÉFÉRENTIEL, indépendante du
//    défaut de traduction HTTP documenté en section 2 — le faire passer par la même route HTTP
//    l'aurait rendu rouge pour la MAUVAISE raison (500 de traduction, jamais atteint le point qui
//    nous intéresse ici : quelle donnée gouverne la décision).
//
//    `bdd.poolMigrateur` est légitime pour la DELETE : `transition_autorisee` n'a PAS `force row
//    level security` (0003_prealables_etape1.sql §4.2, délibérément : « FORCE empêcherait
//    dfa_migrator d'alimenter le référentiel »). Le propriétaire (dfa_migrator) n'est donc jamais
//    soumis au RLS sur cette table précise — exactement l'exemption documentée par le commentaire
//    de `poolMigrateur` dans postgres-ephemere.ts. La mutation est faite et défaite DANS LA MÊME
//    TRANSACTION (BEGIN … DELETE … assertion … ROLLBACK) : aucune trace ne survit au test, et
//    aucun autre test de ce fichier (ni d'un autre) n'est affecté par l'ordre d'exécution.
//
//    L'écriture elle-même (la transition testée) passe par `ecrireSousTenant` → pool `dfa_app`
//    sous RLS, EXACTEMENT le chemin qu'emprunte le service applicatif (`chargerOrPourEcriture` +
//    `tx.update(...)`), à la différence près (assumée, documentée ci-dessus) qu'on n'y ajoute pas
//    la couche Drizzle défaillante pour l'interprétation de l'erreur : on vérifie directement le
//    SQLSTATE et les champs `table`/`detail`/`hint` renvoyés par `pg`, comme le fait
//    `transitions-ordre-reparation.spec.ts`.
//
//    IMPORTANT (constaté en exécution) : la suppression doit être COMMITÉE, pas laissée ouverte
//    dans une transaction qu'on annule ensuite — Postgres ne pratique jamais la lecture sale
//    (dirty read) entre deux CONNEXIONS distinctes (ici : la connexion `dfa_migrator` qui supprime
//    et la connexion `dfa_app`, prise dans un AUTRE pool, qui tente la transition). Un DELETE
//    laissé en suspens dans une transaction non validée reste invisible à `dfa_app` — la
//    transition continuerait donc de réussir, ce qui aurait fait passer ce test au vert pour la
//    MAUVAISE raison (un `expect.fail` jamais atteint parce que rien n'a jamais été réellement
//    absent du point de vue de la connexion qui tente la transition). La mutation est donc un
//    DELETE autocommit, restauré par un INSERT autocommit symétrique dans un `finally` — la
//    fenêtre où le référentiel est réellement amputé est minimale et déterministe.
// -------------------------------------------------------------------------------------------

interface ErreurTransitionPg {
  readonly code?: string;
  readonly table?: string;
  readonly detail?: string;
  readonly hint?: string;
}

describe('transition_autorisee — le référentiel fait AUTORITÉ : une ligne en moins change réellement le verdict de verifier_transition()', () => {
  it('planifie → ouvert, normalement acceptée, devient refusée (ZDFA1) si sa ligne du référentiel est retirée — puis redevient acceptée une fois restaurée', async () => {
    const or = await nouvelOrPlanifie();
    let erreurCapturee: ErreurTransitionPg | undefined;
    const supprimees = await bdd.poolMigrateur.query(
      `delete from transition_autorisee
        where entite = 'ordre_reparation' and statut_depuis = 'planifie' and statut_vers = 'ouvert'
      returning exige_motif`,
    );
    expect(supprimees.rowCount, 'précondition : la ligne existait bien avant suppression').toBe(1);
    const exigeMotifOriginal = (supprimees.rows[0] as { exige_motif: boolean }).exige_motif;

    try {
      // Le pool applicatif (dfa_app) lit maintenant un référentiel réellement amputé (DELETE
      // commité) : MÊME transition, MÊME OR, verdict opposé — la preuve que c'est bien le CONTENU
      // de la table qui gouverne, pas une règle dupliquée quelque part en dur.
      try {
        await ecrireSousTenant(bdd.poolApp, garage.tenantA.tenant.id, (pgClient) =>
          pgClient.query('update ordre_reparation set statut = $1 where id = $2', ['ouvert', or.id]),
        );
        expect.fail("la transition aurait dû être refusée (ZDFA1) une fois la ligne du référentiel retirée");
      } catch (erreur) {
        erreurCapturee = erreur as ErreurTransitionPg;
      }
    } finally {
      // Restauration immédiate, COMMITÉE elle aussi : le référentiel produit ne doit JAMAIS
      // rester amputé au-delà de cette assertion, y compris si une expect() ci-dessus a levé.
      await bdd.poolMigrateur.query(
        `insert into transition_autorisee (entite, statut_depuis, statut_vers, exige_motif)
         values ('ordre_reparation', 'planifie', 'ouvert', $1)`,
        [exigeMotifOriginal],
      );
    }

    expect(erreurCapturee?.code).toBe('ZDFA1');
    expect(erreurCapturee?.table).toBe('ordre_reparation');
    expect(erreurCapturee?.detail).toBe('entite=ordre_reparation;depuis=planifie;vers=ouvert');

    // Preuve que la restauration a bien eu lieu : la MÊME transition, sur le MÊME OR, réussit à
    // nouveau une fois le référentiel intact — via le chemin HTTP normal, cette fois (succès :
    // n'emprunte jamais le code de traduction d'erreur défaillant de la section 2).
    const cookie = await cookieReceptionnaire();
    const reponseApresRestauration = await ctx.requete
      .post(`/api/v1/ordres-reparation/${or.id}/receptionner`)
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .set('Cookie', cookie)
      .send({ kilometrageEntree: kilometrageCroissant(), unite: 'km' });
    expect(reponseApresRestauration.status, JSON.stringify(reponseApresRestauration.body)).toBeLessThan(300);
    expect((reponseApresRestauration.body as { donnees?: { statut?: string } }).donnees?.statut).toBe('ouvert');
  });
});
