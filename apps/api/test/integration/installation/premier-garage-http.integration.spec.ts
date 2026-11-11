/**
 * Premier garage depuis le navigateur — vraie base éphémère, vraie app Nest, vraies routes HTTP :
 *  - `GET /installation/etat` : true sans garage ;
 *  - mauvais code : 403 INSTALLATION_CODE_INVALIDE, rien créé ;
 *  - bon code : 201, cookie de session, le garage a ses valeurs par défaut (comme le CLI) ;
 *  - `GET /installation/etat` : false ensuite, second POST : 409 INSTALLATION_DEJA_FAITE ;
 *  - le code est à usage unique : sa ligne a disparu, un nouveau démarrage n'en tire pas ;
 *  - deux créations simultanées : un seul garage.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ServiceInstallation } from '../../../src/installation';
import { demarrerBaseEphemere, type BaseEphemere } from '../../setup/postgres-ephemere';
import {
  creerAppTest,
  demarrerRedisEphemere,
  extraireValeurCookie,
  type AppTest,
  type RedisEphemere,
} from '../../setup/app-test';

const MOT_DE_PASSE = 'Cheval-Montagne-Brouillard-42';

let bdd: BaseEphemere;
let redis: RedisEphemere;
let ctx: AppTest;
let code: string;

function saisie(codeInstallation: string, email = 'direction@premier.test') {
  return {
    codeInstallation,
    garage: 'Garage Premier Test',
    prenom: 'Dora',
    nom: 'Direction',
    email,
    motDePasse: MOT_DE_PASSE,
  };
}

function poster(corps: object) {
  return ctx.requete
    .post('/api/v1/installation/premier-garage')
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
    .send(corps);
}

async function compter(sql: string): Promise<number> {
  const r = await bdd.poolSuperutilisateur.query<{ n: string }>(sql);
  return Number(r.rows[0]?.n);
}

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  redis = await demarrerRedisEphemere();
  ctx = await creerAppTest(bdd, redis.url);
  // `main.ts` tire le code au démarrage ; ici l'app est créée sans lui.
  const tire = await ctx.app.get(ServiceInstallation).preparerCodeDemarrage();
  if (tire === null) throw new Error('aucun code tiré alors que la base est vide');
  code = tire;
}, 240_000);

afterAll(async () => {
  await ctx?.fermer();
  await redis?.fermer();
  await bdd?.fermer();
});

describe('installation par le navigateur', () => {
  it('instance neuve : premierGarageRequis = true, sans session', async () => {
    const r = await ctx.requete.get('/api/v1/installation/etat');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ premierGarageRequis: true });
  });

  it('le code est stocké haché, jamais en clair', async () => {
    const r = await bdd.poolSuperutilisateur.query<{ sel: Buffer; empreinte: Buffer }>(
      'select sel, empreinte from amorcage.code_installation',
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.empreinte.toString('latin1')).not.toContain(code.replaceAll('-', ''));
  });

  it('dfa_app ne peut ni lire ni écrire la table du code', async () => {
    await expect(
      bdd.poolApp.query('select * from amorcage.code_installation'),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('sans en-tête Origin : 403 AUTH_ORIGINE_REFUSEE (anti-CSRF comme ailleurs)', async () => {
    const r = await ctx.requete.post('/api/v1/installation/premier-garage').send(saisie(code));
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('AUTH_ORIGINE_REFUSEE');
  });

  it('mauvais code : 403 INSTALLATION_CODE_INVALIDE, aucun garage créé', async () => {
    const r = await poster(saisie('AAAA-BBBB-CCCC'));
    expect(r.status).toBe(403);
    expect(r.headers['content-type']).toContain('application/problem+json');
    expect(r.body.code).toBe('INSTALLATION_CODE_INVALIDE');
    expect(await compter('select count(*) n from tenant')).toBe(0);
  });

  it('bon code, mot de passe trop courant : 400 sur le champ, code conservé', async () => {
    const r = await poster({ ...saisie(code), motDePasse: 'password1234' });
    expect(r.status).toBe(400);
    expect(r.body.erreurs).toEqual([
      expect.objectContaining({ champ: 'motDePasse', code: 'MOT_DE_PASSE_FAIBLE' }),
    ]);
    expect(await compter('select count(*) n from tenant')).toBe(0);
    expect(await compter('select count(*) n from amorcage.code_installation')).toBe(1);
  });

  it('bon code, deux requêtes simultanées : une seule crée (201), l’autre reçoit 409', async () => {
    const [a, b] = await Promise.all([
      poster(saisie(code.toLowerCase())),
      poster(saisie(code, 'concurrent@premier.test')),
    ]);
    const statuts = [a.status, b.status].sort();
    expect(statuts).toEqual([201, 409]);
    const reussie = a.status === 201 ? a : b;
    const refusee = a.status === 201 ? b : a;
    expect(refusee.body.code).toBe('INSTALLATION_DEJA_FAITE');
    expect(reussie.body.utilisateur).toMatchObject({ role: 'direction' });

    const cookie = `${ctx.config.SESSION_COOKIE_NOM}=${extraireValeurCookie(reussie, ctx.config.SESSION_COOKIE_NOM)}`;
    const moi = await ctx.requete.get('/api/v1/auth/moi').set('Cookie', cookie);
    expect(moi.status).toBe(200);

    // Un seul garage, avec les mêmes valeurs par défaut que le CLI.
    expect(await compter('select count(*) n from tenant')).toBe(1);
    expect(await compter('select count(*) n from site')).toBe(1);
    expect(await compter("select count(*) n from taux_horaire where code = 'ATELIER'")).toBe(1);
    expect(await compter('select count(*) n from motif_rendez_vous')).toBeGreaterThan(0);
    expect(
      await compter("select count(*) n from audit_utilisateur where apres->>'source' = 'web'"),
    ).toBe(1);
  });

  it('ensuite : etat = false, code effacé, second POST = 409 même avec le bon code', async () => {
    const etat = await ctx.requete.get('/api/v1/installation/etat');
    expect(etat.body).toEqual({ premierGarageRequis: false });
    expect(await compter('select count(*) n from amorcage.code_installation')).toBe(0);

    const encore = await poster(saisie(code, 'autre@premier.test'));
    expect(encore.status).toBe(409);
    expect(encore.body.code).toBe('INSTALLATION_DEJA_FAITE');
    expect(await compter('select count(*) n from tenant')).toBe(1);
  });

  it('un redémarrage avec un garage n’émet plus de code', async () => {
    const tire = await ctx.app.get(ServiceInstallation).preparerCodeDemarrage();
    expect(tire).toBeNull();
    expect(await compter('select count(*) n from amorcage.code_installation')).toBe(0);
  });
});
