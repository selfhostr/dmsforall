/**
 * Serveur d'envoi des e-mails d'un garage (migration 0098) sur vraie base éphémère ET vrai serveur
 * SMTP factice (Mailpit en conteneur) : le mot de passe est chiffré en base et jamais relu par
 * l'API, l'étanchéité entre garages tient, seuls direction/admin règlent l'envoi, le test d'envoi
 * remet un vrai message (ou un problem+json précis : authentification, connexion, TLS).
 */

import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { demarrerBaseEphemere, type BaseEphemere } from '../setup/postgres-ephemere';
import {
  creerAppTest,
  demarrerRedisEphemere,
  type AppTest,
  type RedisEphemere,
} from '../setup/app-test';
import { semerGarageDemoLot1, type GarageDemoLot1Fixture } from '../lot1/fixtures/garage-demo-lot1';
import { construireCookiePour } from './ventes/fixtures-cycle-vente';

const CLE = Buffer.alloc(32, 7).toString('base64');
const MOT_DE_PASSE = 'Secret-Smtp-9876!';
const CHEMIN = '/api/v1/parametres-entreprise/envoi-courriel';

let bdd: BaseEphemere;
let redis: RedisEphemere;
let ctx: AppTest;
let garage: GarageDemoLot1Fixture;
let cookiePour: ReturnType<typeof construireCookiePour>;
let mailpit: StartedTestContainer;
let hoteSmtp: string;
let portSmtp: number;
let urlApiMailpit: string;

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  redis = await demarrerRedisEphemere();
  garage = await semerGarageDemoLot1(bdd);
  ctx = await creerAppTest(bdd, redis.url, { CLE_CHIFFREMENT_SECRETS: CLE });
  cookiePour = construireCookiePour(ctx);
  mailpit = await new GenericContainer('axllent/mailpit:latest')
    .withEnvironment({
      MP_SMTP_AUTH: `atelier:${MOT_DE_PASSE}`,
      MP_SMTP_AUTH_ALLOW_INSECURE: 'true',
    })
    .withExposedPorts(1025, 8025)
    .withWaitStrategy(Wait.forHttp('/api/v1/info', 8025))
    .start();
  hoteSmtp = mailpit.getHost();
  portSmtp = mailpit.getMappedPort(1025);
  urlApiMailpit = `http://${hoteSmtp}:${mailpit.getMappedPort(8025)}/api/v1`;
}, 240_000);

afterAll(async () => {
  await mailpit?.stop();
  await ctx?.fermer();
  await redis?.fermer();
  await bdd?.fermer();
});

async function avec(
  tenant: 'A' | 'B' = 'A',
  role: 'direction' | 'chef_atelier' | 'admin' = 'direction',
) {
  const t = tenant === 'A' ? garage.tenantA : garage.tenantB;
  const cookie = await cookiePour(t, role);
  const base = (m: 'patch' | 'post' | 'delete', chemin: string) =>
    ctx.requete[m](chemin).set('Origin', ctx.config.WEB_URL_PUBLIQUE).set('Cookie', cookie);
  return {
    get: (chemin: string = CHEMIN) => ctx.requete.get(chemin).set('Cookie', cookie),
    patch: (corps: Record<string, unknown>) => base('patch', CHEMIN).send(corps),
    supprimer: () => base('delete', CHEMIN),
    tester: (destinataire = 'direction@garage-martin.ch') =>
      base('post', `${CHEMIN}/test`).send({ destinataire }),
  };
}

const REGLAGE_VALIDE = () => ({
  hote: hoteSmtp,
  port: portSmtp,
  securite: 'aucune',
  utilisateur: 'atelier',
  motDePasse: MOT_DE_PASSE,
  adresseExpediteur: 'atelier@garage-martin.ch',
  nomAffiche: 'Garage Martin',
  adresseReponse: 'contact@garage-martin.ch',
});

async function messagesMailpit(): Promise<
  {
    Subject: string;
    From: { Address: string };
    To: { Address: string }[];
    ReplyTo: { Address: string }[];
  }[]
> {
  const r = await fetch(`${urlApiMailpit}/messages`);
  return ((await r.json()) as { messages: never[] }).messages;
}

describe('serveur d’envoi des e-mails du garage', () => {
  it('au départ : non configuré, aucun réglage, chiffrement disponible', async () => {
    const r = await (await avec('A')).get();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      reglage: null,
      source: 'aucune',
      configure: false,
      modeCapture: true,
      chiffrementDisponible: true,
    });
  });

  it('chef d’atelier : lecture, écriture et test refusés 403 DROIT_INSUFFISANT', async () => {
    const api = await avec('A', 'chef_atelier');
    for (const r of [await api.get(), await api.patch(REGLAGE_VALIDE()), await api.tester()]) {
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('DROIT_INSUFFISANT');
    }
  });

  it('premier enregistrement incomplet : 400 VALIDATION_ECHOUEE nommant les champs manquants', async () => {
    const r = await (await avec('A')).patch({ hote: 'smtp.example.org' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('VALIDATION_ECHOUEE');
    expect(r.body.erreurs.map((e: { champ: string }) => e.champ).sort()).toEqual([
      'adresseExpediteur',
      'port',
      'securite',
    ]);
  });

  it('refuse un nom affiché ou une adresse avec saut de ligne (injection d’en-tête)', async () => {
    const api = await avec('A');
    expect(
      (await api.patch({ ...REGLAGE_VALIDE(), nomAffiche: 'Garage\r\nBcc: x@y.ch' })).status,
    ).toBe(400);
    expect((await api.patch({ ...REGLAGE_VALIDE(), hote: 'smtp.example.org:25' })).status).toBe(
      400,
    );
  });

  it('enregistre : le mot de passe est chiffré en base, jamais renvoyé, jamais journalisé', async () => {
    const api = await avec('A');
    const r = await api.patch(REGLAGE_VALIDE());
    expect(r.status).toBe(200);
    expect(r.body.source).toBe('garage');
    expect(r.body.reglage).toMatchObject({
      hote: hoteSmtp,
      port: portSmtp,
      securite: 'aucune',
      utilisateur: 'atelier',
      motDePasseDefini: true,
      adresseExpediteur: 'atelier@garage-martin.ch',
      dernierTest: null,
    });
    expect(JSON.stringify(r.body)).not.toContain(MOT_DE_PASSE);
    expect(JSON.stringify((await api.get()).body)).not.toContain(MOT_DE_PASSE);

    const { rows } = await bdd.poolSuperutilisateur.query(
      `select mot_de_passe_chiffre from parametre_envoi_courriel where tenant_id = $1`,
      [garage.tenantA.tenant.id],
    );
    const stocke = String(rows[0].mot_de_passe_chiffre);
    expect(stocke.startsWith('v1.')).toBe(true);
    expect(stocke).not.toContain(MOT_DE_PASSE);
    expect(Buffer.from(stocke).toString('base64')).not.toContain(
      Buffer.from(MOT_DE_PASSE).toString('base64'),
    );

    const audit = await bdd.poolSuperutilisateur.query(
      `select champ, valeur_avant, valeur_apres from audit_atelier where tenant_id = $1 and champ like 'envoi_courriel.%'`,
      [garage.tenantA.tenant.id],
    );
    expect(audit.rows.map((l) => l.champ)).toContain('envoi_courriel.hote');
    expect(JSON.stringify(audit.rows)).not.toContain(MOT_DE_PASSE);
  });

  it('étanchéité : le garage B ne voit rien et ne peut pas tester le réglage de A', async () => {
    const b = await avec('B');
    expect((await b.get()).body.reglage).toBeNull();
    const t = await b.tester();
    expect(t.status).toBe(409);
    expect(t.body.code).toBe('COURRIEL_NON_CONFIGURE');
  });

  it('test d’envoi réussi : un vrai message part, avec l’expéditeur et la réponse du garage', async () => {
    const api = await avec('A');
    const r = await api.tester('direction@garage-martin.ch');
    expect(r.status).toBe(200);
    expect(typeof r.body.envoyeLe).toBe('string');
    const messages = await messagesMailpit();
    const recu = messages.find((m) => m.To.some((d) => d.Address === 'direction@garage-martin.ch'));
    expect(recu?.From.Address).toBe('atelier@garage-martin.ch');
    expect(recu?.ReplyTo[0]?.Address).toBe('contact@garage-martin.ch');
    const etat = (await api.get()).body.reglage.dernierTest;
    expect(etat).toMatchObject({ succes: true, cause: null });
  });

  it('modifier remet le dernier test à zéro ; changer d’hôte sans mot de passe efface l’ancien', async () => {
    const api = await avec('A');
    const r = await api.patch({ nomAffiche: 'Garage Martin SA' });
    expect(r.body.reglage.dernierTest).toBeNull();
    expect(r.body.reglage.motDePasseDefini).toBe(true);
    const r2 = await api.patch({ hote: 'autre.example.org' });
    expect(r2.body.reglage.motDePasseDefini).toBe(false);
    await api.patch(REGLAGE_VALIDE());
  });

  it('mauvais mot de passe : 422 COURRIEL_AUTHENTIFICATION_ECHEC en problem+json, échec conservé', async () => {
    const api = await avec('A');
    await api.patch({ motDePasse: 'mauvais-mot-de-passe' });
    const r = await api.tester();
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('COURRIEL_AUTHENTIFICATION_ECHEC');
    expect(r.headers['content-type']).toMatch(/problem\+json/);
    expect(JSON.stringify(r.body)).not.toContain('mauvais-mot-de-passe');
    expect((await api.get()).body.reglage.dernierTest).toMatchObject({
      succes: false,
      cause: 'authentification',
    });
    await api.patch({ motDePasse: MOT_DE_PASSE });
  });

  it('serveur injoignable : 422 COURRIEL_CONNEXION_ECHEC', async () => {
    const api = await avec('A');
    await api.patch({ port: 1 });
    const r = await api.tester();
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('COURRIEL_CONNEXION_ECHEC');
    await api.patch({ port: portSmtp });
  });

  it('TLS imposé sur un serveur sans TLS : 422 COURRIEL_TLS_ECHEC', async () => {
    const api = await avec('A');
    await api.patch({ securite: 'tls_implicite' });
    const r = await api.tester();
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('COURRIEL_TLS_ECHEC');
    await api.patch({ securite: 'aucune' });
  });

  it('supprimer le réglage : retour à « non configuré », ligne détruite, idempotent', async () => {
    const api = await avec('A');
    const r = await api.supprimer();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ reglage: null, source: 'aucune', configure: false });
    expect((await api.supprimer()).status).toBe(200);
    const { rowCount } = await bdd.poolSuperutilisateur.query(
      `select 1 from parametre_envoi_courriel where tenant_id = $1`,
      [garage.tenantA.tenant.id],
    );
    expect(rowCount).toBe(0);
  });
});

describe('serveur sans clé de chiffrement', () => {
  it('enregistrer un mot de passe est refusé 409 COURRIEL_CLE_CHIFFREMENT_ABSENTE', async () => {
    const sansCle = await creerAppTest(bdd, redis.url, { CLE_CHIFFREMENT_SECRETS: '' });
    try {
      const cookie = await construireCookiePour(sansCle)(garage.tenantA, 'direction');
      const r = await sansCle.requete
        .patch(CHEMIN)
        .set('Origin', sansCle.config.WEB_URL_PUBLIQUE)
        .set('Cookie', cookie)
        .send(REGLAGE_VALIDE());
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('COURRIEL_CLE_CHIFFREMENT_ABSENTE');
    } finally {
      await sansCle.fermer();
    }
  });
});
