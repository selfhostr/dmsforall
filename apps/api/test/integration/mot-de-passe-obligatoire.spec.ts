/**
 * Issues #58 (changement de mot de passe obligatoire à la première connexion) et #62 (langue dans
 * le profil), sur vraie base éphémère et vraie app : le refus est côté SERVEUR, pas seulement une
 * redirection de l'interface.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { demarrerBaseEphemere, type BaseEphemere } from '../setup/postgres-ephemere';
import {
  semerGarageDemo,
  ajouterUtilisateurFixture,
  type GarageDemoFixture,
  type UtilisateurFixture,
} from '../fixtures/garage-demo';
import {
  creerAppTest,
  demarrerRedisEphemere,
  extraireValeurCookie,
  type AppTest,
  type RedisEphemere,
} from '../setup/app-test';

const P = '/api/v1';
const NOUVEAU = 'Un-Nouveau-Mdp-Solide-2026!';

let bdd: BaseEphemere;
let redis: RedisEphemere;
let ctx: AppTest;
let demo: GarageDemoFixture;
let compteur = 0;

/** Employé `receptionnaire` dont le mot de passe est à changer (comme après une création). */
async function employeAChanger(tenantId = demo.tenantA.id): Promise<UtilisateurFixture> {
  compteur += 1;
  const u = await ajouterUtilisateurFixture(bdd, tenantId, {
    prenom: 'Neuf',
    nom: `Employe${compteur}`,
    role: 'receptionnaire',
    email: `neuf.employe.${compteur}@garage-martin.test`,
  });
  await ctx.poolMigrateur.query(
    'update utilisateur set mot_de_passe_a_changer = true where id = $1',
    [u.id],
  );
  return u;
}

async function connecter(u: UtilisateurFixture, motDePasse = u.motDePasseClair) {
  const r = await ctx.requete
    .post(`${P}/auth/connexion`)
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
    .send({ email: u.email, motDePasse });
  const cookie =
    r.status === 200
      ? `${ctx.config.SESSION_COOKIE_NOM}=${extraireValeurCookie(r, ctx.config.SESSION_COOKIE_NOM)}`
      : '';
  return { r, cookie };
}

function post(chemin: string, cookie: string, corps: object) {
  return ctx.requete
    .post(`${P}${chemin}`)
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
    .set('Cookie', cookie)
    .send(corps);
}

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  demo = await semerGarageDemo(bdd);
  redis = await demarrerRedisEphemere();
  ctx = await creerAppTest(bdd, redis.url);
}, 180_000);

afterAll(async () => {
  await ctx?.fermer();
  await redis?.fermer();
  await bdd?.fermer();
});

describe('#58 -- première connexion avec mot de passe temporaire', () => {
  it('la connexion réussit et la session annonce motDePasseAChanger', async () => {
    const u = await employeAChanger();
    const { r } = await connecter(u);
    expect(r.status).toBe(200);
    expect(r.body.motDePasseAChanger).toBe(true);
  });

  it('refuse les routes métier en 403 AUTH_CHANGEMENT_MOT_DE_PASSE_REQUIS (lecture et écriture)', async () => {
    const u = await employeAChanger();
    const { cookie } = await connecter(u);

    const lecture = await ctx.requete.get(`${P}/clients`).set('Cookie', cookie);
    expect(lecture.status).toBe(403);
    expect(lecture.body.code).toBe('AUTH_CHANGEMENT_MOT_DE_PASSE_REQUIS');

    const ecriture = await post('/clients', cookie, { nom: 'x' });
    expect(ecriture.status).toBe(403);
    expect(ecriture.body.code).toBe('AUTH_CHANGEMENT_MOT_DE_PASSE_REQUIS');

    const langue = await ctx.requete
      .patch(`${P}/auth/moi/langue`)
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .set('Cookie', cookie)
      .send({ langue: 'de' });
    expect(langue.status).toBe(403);
  });

  it('GET /auth/moi et la déconnexion restent ouverts', async () => {
    const u = await employeAChanger();
    const { cookie } = await connecter(u);
    const moi = await ctx.requete.get(`${P}/auth/moi`).set('Cookie', cookie);
    expect(moi.status).toBe(200);
    expect(moi.body.motDePasseAChanger).toBe(true);
    const sortie = await post('/auth/deconnexion', cookie, {});
    expect(sortie.status).toBe(204);
  });

  it('un mot de passe actuel faux est refusé et le blocage reste', async () => {
    const u = await employeAChanger();
    const { cookie } = await connecter(u);
    const r = await post('/auth/mot-de-passe/changement', cookie, {
      motDePasseActuel: 'pas-le-bon-mot-de-passe',
      nouveauMotDePasse: NOUVEAU,
    });
    expect(r.status).toBe(400);
    const lecture = await ctx.requete.get(`${P}/clients`).set('Cookie', cookie);
    expect(lecture.status).toBe(403);
  });

  it('refuse un nouveau mot de passe identique au temporaire ou trop court', async () => {
    const u = await employeAChanger();
    const { cookie } = await connecter(u);
    const identique = await post('/auth/mot-de-passe/changement', cookie, {
      motDePasseActuel: u.motDePasseClair,
      nouveauMotDePasse: u.motDePasseClair,
    });
    expect(identique.status).toBe(400);
    const court = await post('/auth/mot-de-passe/changement', cookie, {
      motDePasseActuel: u.motDePasseClair,
      nouveauMotDePasse: 'court',
    });
    expect(court.status).toBe(400);
  });

  it('après le changement : routes métier OK, ancien mot de passe mort, nouveau valide, drapeau levé', async () => {
    const u = await employeAChanger();
    const { cookie } = await connecter(u);
    const ok = await post('/auth/mot-de-passe/changement', cookie, {
      motDePasseActuel: u.motDePasseClair,
      nouveauMotDePasse: NOUVEAU,
    });
    expect(ok.status).toBe(204);

    const lecture = await ctx.requete.get(`${P}/clients`).set('Cookie', cookie);
    expect(lecture.status).toBe(200);

    expect((await connecter(u)).r.status).toBe(401);
    const relogin = await connecter(u, NOUVEAU);
    expect(relogin.r.status).toBe(200);
    expect(relogin.r.body.motDePasseAChanger).toBe(false);
  });

  it('révoque les autres sessions de la personne mais garde la courante', async () => {
    const u = await employeAChanger();
    const premiere = await connecter(u);
    const seconde = await connecter(u);
    await post('/auth/mot-de-passe/changement', premiere.cookie, {
      motDePasseActuel: u.motDePasseClair,
      nouveauMotDePasse: NOUVEAU,
    });
    expect((await ctx.requete.get(`${P}/auth/moi`).set('Cookie', premiere.cookie)).status).toBe(
      200,
    );
    expect((await ctx.requete.get(`${P}/auth/moi`).set('Cookie', seconde.cookie)).status).toBe(401);
  });

  it('sans session : 401 (pas de changement de mot de passe anonyme)', async () => {
    const r = await post('/auth/mot-de-passe/changement', '', {
      motDePasseActuel: 'x',
      nouveauMotDePasse: NOUVEAU,
    });
    expect(r.status).toBe(401);
  });

  it("un compte sans drapeau n'est pas affecté (parc existant)", async () => {
    compteur += 1;
    const u = await ajouterUtilisateurFixture(bdd, demo.tenantA.id, {
      prenom: 'Ancien',
      nom: `Compte${compteur}`,
      role: 'receptionnaire',
      email: `ancien.compte.${compteur}@garage-martin.test`,
    });
    const { r, cookie } = await connecter(u);
    expect(r.body.motDePasseAChanger).toBe(false);
    expect((await ctx.requete.get(`${P}/clients`).set('Cookie', cookie)).status).toBe(200);
  });

  it('isolation tenant : le changement du tenant A ne touche pas un homonyme du tenant B', async () => {
    const a = await employeAChanger(demo.tenantA.id);
    const b = await employeAChanger(demo.tenantB.id);
    const { cookie } = await connecter(a);
    await post('/auth/mot-de-passe/changement', cookie, {
      motDePasseActuel: a.motDePasseClair,
      nouveauMotDePasse: NOUVEAU,
    });
    const { rows } = await ctx.poolMigrateur.query<{ mot_de_passe_a_changer: boolean }>(
      'select mot_de_passe_a_changer from utilisateur where id = $1',
      [b.id],
    );
    expect(rows[0]?.mot_de_passe_a_changer).toBe(true);
    // Un corps qui tente de viser un autre compte/tenant est rejeté (.strict()).
    const { cookie: c2 } = await connecter(b);
    const forge = await post('/auth/mot-de-passe/changement', c2, {
      motDePasseActuel: b.motDePasseClair,
      nouveauMotDePasse: NOUVEAU,
      utilisateurId: a.id,
      tenantId: demo.tenantA.id,
    });
    expect(forge.status).toBe(400);
  });

  it('un compte de service ne peut jamais être marqué à changer (CHECK en base)', async () => {
    const site = demo.tenantA.sites[0]!;
    await expect(
      ctx.poolMigrateur.query(
        `insert into utilisateur (id, tenant_id, email, mot_de_passe_hash, prenom, nom, role, statut, site_id, mot_de_passe_a_changer)
         values ($1, $2, 'borne.mdp@garage-martin.test', 'x', 'Borne', 'Atelier', 'poste_atelier', 'actif', $3, true)`,
        [randomUUID(), demo.tenantA.id, site.id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('#62 -- la langue est une préférence du profil', () => {
  it('PATCH /auth/moi/langue enregistre la langue, relue par /auth/moi', async () => {
    compteur += 1;
    const u = await ajouterUtilisateurFixture(bdd, demo.tenantA.id, {
      prenom: 'Lang',
      nom: `Profil${compteur}`,
      role: 'receptionnaire',
      email: `lang.profil.${compteur}@garage-martin.test`,
    });
    const { cookie } = await connecter(u);
    const r = await ctx.requete
      .patch(`${P}/auth/moi/langue`)
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .set('Cookie', cookie)
      .send({ langue: 'de' });
    expect(r.status).toBe(204);
    const moi = await ctx.requete.get(`${P}/auth/moi`).set('Cookie', cookie);
    expect(moi.body.utilisateur.langue).toBe('de');
    // Une autre personne du même tenant garde sa langue.
    const autre = demo.tenantA.utilisateurs[0]!;
    const { rows } = await ctx.poolMigrateur.query<{ langue: string }>(
      'select langue from utilisateur where id = $1',
      [autre.id],
    );
    expect(rows[0]?.langue).toBe('fr');
  });

  it('refuse une langue inconnue, un corps visant un autre compte, et une requête sans session', async () => {
    compteur += 1;
    const u = await ajouterUtilisateurFixture(bdd, demo.tenantA.id, {
      prenom: 'Lang',
      nom: `Refus${compteur}`,
      role: 'receptionnaire',
      email: `lang.refus.${compteur}@garage-martin.test`,
    });
    const { cookie } = await connecter(u);
    const patch = (c: string, corps: object) =>
      ctx.requete
        .patch(`${P}/auth/moi/langue`)
        .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
        .set('Cookie', c)
        .send(corps);
    expect((await patch(cookie, { langue: 'en' })).status).toBe(400);
    expect(
      (await patch(cookie, { langue: 'it', utilisateurId: demo.tenantB.utilisateurs[0]!.id }))
        .status,
    ).toBe(400);
    expect((await patch('', { langue: 'it' })).status).toBe(401);
  });
});
