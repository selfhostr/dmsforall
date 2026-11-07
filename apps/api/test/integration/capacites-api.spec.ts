/**
 * Grille de capacités de bout en bout (vraie base, vraie app, vrai cookie) : les droits d'une
 * personne sont relus de la base à chaque requête, les gestes de gestion respectent les gardes
 * (tenant, auto-élévation, dépassement, dernier patron), une fiduciaire ne peut rien écrire.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PREREGLAGES } from '@dfa/shared';

import { demarrerBaseEphemere, type BaseEphemere } from '../setup/postgres-ephemere';
import {
  ajouterUtilisateurFixture,
  semerGarageDemo,
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

let bdd: BaseEphemere;
let redis: RedisEphemere;
let ctx: AppTest;
let demo: GarageDemoFixture;
let compteur = 0;

interface Connecte {
  readonly utilisateur: UtilisateurFixture;
  readonly cookie: string;
}

async function nouveau(
  tenantId: string,
  role: UtilisateurFixture['role'],
): Promise<UtilisateurFixture> {
  compteur += 1;
  return ajouterUtilisateurFixture(bdd, tenantId, {
    prenom: 'Cap',
    nom: `${role}${compteur}`,
    role,
    email: `cap.${role}.${compteur}.${randomUUID().slice(0, 6)}@garage.test`,
  });
}

async function connecter(utilisateur: UtilisateurFixture): Promise<Connecte> {
  const reponse = await ctx.requete
    .post('/api/v1/auth/connexion')
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
    .send({ email: utilisateur.email, motDePasse: utilisateur.motDePasseClair });
  if (reponse.status !== 200) throw new Error(`connexion ${String(reponse.status)}`);
  const jeton = extraireValeurCookie(reponse, ctx.config.SESSION_COOKIE_NOM);
  return { utilisateur, cookie: `${ctx.config.SESSION_COOKIE_NOM}=${jeton}` };
}

function patchCapacites(acteur: Connecte, cibleId: string, corps: unknown) {
  return ctx.requete
    .patch(`/api/v1/utilisateurs/${cibleId}/capacites`)
    .set('Cookie', acteur.cookie)
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
    .send(corps as object);
}

function moi(c: Connecte) {
  return ctx.requete.get('/api/v1/auth/moi').set('Cookie', c.cookie);
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

describe('GET /capacites/modele', () => {
  it('rend domaines, niveaux, options et préréglages (dont fiduciaire) à qui gère les employés', async () => {
    const patron = await connecter(await nouveau(demo.tenantA.id, 'direction'));
    const r = await ctx.requete.get('/api/v1/capacites/modele').set('Cookie', patron.cookie);
    expect(r.status).toBe(200);
    expect(r.body.domaines.map((d: { id: string }) => d.id)).toEqual([
      'atelier',
      'accueil',
      'facturation',
      'pieces',
      'ventes',
      'finances',
    ]);
    expect(r.body.niveaux.map((n: { id: string }) => n.id)).toEqual(['rien', 'voir', 'faire']);
    const fid = r.body.prereglages.find((p: { id: string }) => p.id === 'fiduciaire');
    expect(fid.roleOrigine).toBe('comptable');
    expect(fid.grille.niveaux.facturation).toBe('voir');
  });

  it('un technicien reçoit 403', async () => {
    const tech = await connecter(await nouveau(demo.tenantA.id, 'technicien'));
    const r = await ctx.requete.get('/api/v1/capacites/modele').set('Cookie', tech.cookie);
    expect(r.status).toBe(403);
  });
});

describe('PATCH /utilisateurs/{id}/capacites', () => {
  it('droits relus à chaque requête : accorder Pièces : Faire prend effet sur la MÊME session ; le retirer la révoque', async () => {
    const patron = await connecter(await nouveau(demo.tenantA.id, 'direction'));
    const cible = await connecter(await nouveau(demo.tenantA.id, 'technicien'));

    const avant = await moi(cible);
    expect(avant.body.actions).not.toContain('pieces.mouvement.creer');
    expect(avant.body.capacites.personnalisee).toBe(false);

    const accord = await patchCapacites(patron, cible.utilisateur.id, {
      niveaux: { pieces: 'faire' },
    });
    expect(accord.status).toBe(200);
    expect(accord.body.capacites).toMatchObject({ personnalisee: true, prereglage: null });

    const apres = await moi(cible);
    expect(apres.status).toBe(200);
    expect(apres.body.actions).toContain('pieces.mouvement.creer');
    expect(apres.body.capacites.niveaux.pieces).toBe('faire');

    const retrait = await patchCapacites(patron, cible.utilisateur.id, {
      niveaux: { pieces: 'rien' },
    });
    expect(retrait.status).toBe(200);
    // Droits en baisse : la session de la personne est révoquée.
    const revoquee = await moi(cible);
    expect(revoquee.status).toBe(401);

    const audit = await bdd.poolSuperutilisateur.query(
      `select avant, apres from audit_utilisateur where utilisateur_cible_id = $1 order by cree_le`,
      [cible.utilisateur.id],
    );
    expect(audit.rows).toHaveLength(2);
    expect(audit.rows[0].avant.capacites.niveaux.pieces).toBe('voir');
    expect(audit.rows[0].apres.capacites.niveaux.pieces).toBe('faire');
  });

  it('accès inter-tenant : modifier une personne d’un autre garage rend 404, jamais 403 ni 200', async () => {
    const patronA = await connecter(await nouveau(demo.tenantA.id, 'direction'));
    const cibleB = await nouveau(demo.tenantB.id, 'technicien');
    const r = await patchCapacites(patronA, cibleB.id, { encadrer: true });
    expect(r.status).toBe(404);
    const { rows } = await bdd.poolSuperutilisateur.query(
      `select peut_encadrer from utilisateur where id = $1`,
      [cibleB.id],
    );
    expect(rows[0].peut_encadrer).toBe(false);
  });

  it('élévation : un technicien ne peut pas modifier une grille (403), personne ne modifie la sienne (403)', async () => {
    const tech = await connecter(await nouveau(demo.tenantA.id, 'technicien'));
    const autre = await nouveau(demo.tenantA.id, 'vendeur');
    expect((await patchCapacites(tech, autre.id, { encadrer: true })).status).toBe(403);
    expect((await patchCapacites(tech, tech.utilisateur.id, { encadrer: true })).status).toBe(403);

    const patron = await connecter(await nouveau(demo.tenantA.id, 'direction'));
    expect((await patchCapacites(patron, patron.utilisateur.id, { encadrer: false })).status).toBe(
      403,
    );
  });

  it('un patron dont la grille a perdu Finances ne peut plus l’accorder à autrui (403, champ nommé)', async () => {
    const reduit = await nouveau(demo.tenantA.id, 'direction');
    await bdd.poolSuperutilisateur.query(
      `update utilisateur set niveau_finances = 'rien' where id = $1`,
      [reduit.id],
    );
    const acteur = await connecter(reduit);
    const cible = await nouveau(demo.tenantA.id, 'vendeur');
    const r = await patchCapacites(acteur, cible.id, { niveaux: { finances: 'voir' } });
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).toContain('niveaux.finances');
  });

  it('corps hostile : tenantId, patron, gererEmployes sont refusés (400) ; rien n’est écrit', async () => {
    const patron = await connecter(await nouveau(demo.tenantA.id, 'direction'));
    const cible = await nouveau(demo.tenantA.id, 'vendeur');
    for (const corps of [
      { tenantId: demo.tenantB.id, encadrer: true },
      { patron: true },
      { gererEmployes: true },
      {},
    ]) {
      expect((await patchCapacites(patron, cible.id, corps)).status).toBe(400);
    }
  });

  it('dernier patron : le rétrograder (rôle) est refusé (409) tant qu’il n’y en a pas un autre', async () => {
    const admin = await connecter(await nouveau(demo.tenantB.id, 'admin'));
    const seul = await nouveau(demo.tenantB.id, 'direction');
    await bdd.poolSuperutilisateur.query(
      `update utilisateur set est_patron = false, peut_gerer_employes = false
        where tenant_id = $1 and role = 'direction' and id <> $2`,
      [demo.tenantB.id, seul.id],
    );
    const r = await ctx.requete
      .patch(`/api/v1/utilisateurs/${seul.id}`)
      .set('Cookie', admin.cookie)
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .send({ role: 'vendeur' });
    expect(r.status).toBe(409);
  });
});

describe('fiduciaire : lecture seule', () => {
  it('voit les factures mais ne peut ni créer un document, ni gérer les comptes, ni exporter', async () => {
    const u = await nouveau(demo.tenantA.id, 'comptable');
    const g = PREREGLAGES.fiduciaire.grille;
    await bdd.poolSuperutilisateur.query(
      `update utilisateur set niveau_atelier=$2, niveau_accueil=$3, niveau_facturation=$4,
              niveau_pieces=$5, niveau_ventes=$6, niveau_finances=$7 where id=$1`,
      [
        u.id,
        g.niveaux.atelier,
        g.niveaux.accueil,
        g.niveaux.facturation,
        g.niveaux.pieces,
        g.niveaux.ventes,
        g.niveaux.finances,
      ],
    );
    const fid = await connecter(u);
    const session = await moi(fid);
    expect(session.body.capacites.prereglage).toBe('fiduciaire');
    expect(session.body.actions).toContain('facturation.document.lire');
    expect(session.body.actions).not.toContain('facturation.document.creer');

    const origine = ctx.config.WEB_URL_PUBLIQUE;
    const creerCompte = await ctx.requete
      .post('/api/v1/utilisateurs')
      .set('Cookie', fid.cookie)
      .set('Origin', origine)
      .send({});
    expect(creerCompte.status).toBe(403);
    const exporter = await ctx.requete
      .post('/api/v1/exports-fiduciaires')
      .set('Cookie', fid.cookie)
      .set('Origin', origine)
      .send({});
    expect(exporter.status).toBe(403);
  });
});

describe('session expirée / compte désactivé', () => {
  it('désactiver une personne révoque sa session (401 immédiat)', async () => {
    const patron = await connecter(await nouveau(demo.tenantA.id, 'direction'));
    const cible = await connecter(await nouveau(demo.tenantA.id, 'vendeur'));
    expect((await moi(cible)).status).toBe(200);
    const r = await ctx.requete
      .post(`/api/v1/utilisateurs/${cible.utilisateur.id}/desactiver`)
      .set('Cookie', patron.cookie)
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE);
    expect(r.status).toBe(200);
    expect((await moi(cible)).status).toBe(401);
  });
});
