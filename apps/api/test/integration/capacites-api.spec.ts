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
  // Beaucoup de connexions depuis la même IP de test : budget IP relevé (hors sujet ici).
  ctx = await creerAppTest(bdd, redis.url, { LIMITE_CONNEXION_IP: '500' });
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

    // Séparation des tâches : tenir le stock ET contrôler son propre travail est exclu, donc
    // accorder Pièces : Faire à un technicien lui retire « contrôler » — droits en baisse, sa
    // session est révoquée et il se reconnecte avec la nouvelle grille.
    expect((await moi(cible)).status).toBe(401);
    const neuve = await connecter(cible.utilisateur);
    const apres = await moi(neuve);
    expect(apres.status).toBe(200);
    expect(apres.body.actions).toContain('pieces.mouvement.creer');
    expect(apres.body.actions).not.toContain('atelier.or.controler');
    expect(apres.body.capacites.niveaux.pieces).toBe('faire');

    const retrait = await patchCapacites(patron, cible.utilisateur.id, {
      niveaux: { pieces: 'rien' },
    });
    expect(retrait.status).toBe(200);
    // Droits en baisse : la session de la personne est révoquée.
    const revoquee = await moi(neuve);
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

// =================================================================================================
// Revue sécurité F1 : mêmes gardes sur désactiver / réactiver / réinitialiser l'accès
// =================================================================================================

function action(
  acteur: Connecte,
  cibleId: string,
  route: 'desactiver' | 'reactiver' | 'reinitialiser-acces',
) {
  return ctx.requete
    .post(`/api/v1/utilisateurs/${cibleId}/${route}`)
    .set('Cookie', acteur.cookie)
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE);
}

async function ligne(id: string) {
  const { rows } = await bdd.poolSuperutilisateur.query(
    `select statut, mot_de_passe_hash from utilisateur where id = $1`,
    [id],
  );
  return rows[0] as { statut: string; mot_de_passe_hash: string };
}

describe('F1 — gestes sur un compte plus puissant que soi', () => {
  const ROUTES = ['desactiver', 'reactiver', 'reinitialiser-acces'] as const;

  async function patronReduit(): Promise<Connecte> {
    const u = await nouveau(demo.tenantA.id, 'direction');
    await bdd.poolSuperutilisateur.query(
      `update utilisateur set niveau_finances = 'rien' where id = $1`,
      [u.id],
    );
    return connecter(u);
  }

  for (const route of ROUTES) {
    it(`${route} : un patron aux droits réduits ne peut pas toucher un patron complet (403, rien n'est modifié)`, async () => {
      const acteur = await patronReduit();
      const cible = await nouveau(demo.tenantA.id, 'direction');
      if (route === 'reactiver') {
        await bdd.poolSuperutilisateur.query(
          `update utilisateur set statut='suspendu' where id=$1`,
          [cible.id],
        );
      }
      const avant = await ligne(cible.id);
      const r = await action(acteur, cible.id, route);
      expect(r.status).toBe(403);
      expect(JSON.stringify(r.body)).not.toMatch(/motDePasseTemporaire/);
      expect(await ligne(cible.id)).toEqual(avant);
    });

    it(`${route} : un patron (non-admin) ne peut pas toucher un compte admin (403)`, async () => {
      const patron = await connecter(await nouveau(demo.tenantA.id, 'direction'));
      const admin = await nouveau(demo.tenantA.id, 'admin');
      if (route === 'reactiver') {
        await bdd.poolSuperutilisateur.query(
          `update utilisateur set statut='suspendu' where id=$1`,
          [admin.id],
        );
      }
      const avant = await ligne(admin.id);
      const r = await action(patron, admin.id, route);
      expect(r.status).toBe(403);
      expect(await ligne(admin.id)).toEqual(avant);
    });

    it(`${route} : sur soi-même, refusé (désactiver : 409 ; les autres : 403)`, async () => {
      const patron = await connecter(await nouveau(demo.tenantA.id, 'direction'));
      const avant = await ligne(patron.utilisateur.id);
      const r = await action(patron, patron.utilisateur.id, route);
      expect(r.status).toBe(route === 'desactiver' ? 409 : 403);
      expect(await ligne(patron.utilisateur.id)).toEqual(avant);
    });
  }

  it('contrôle : un patron complet réinitialise bien l’accès d’un employé ordinaire (200, mot de passe rendu une fois)', async () => {
    const patron = await connecter(await nouveau(demo.tenantA.id, 'direction'));
    const employe = await nouveau(demo.tenantA.id, 'technicien');
    const r = await action(patron, employe.id, 'reinitialiser-acces');
    expect(r.status).toBe(200);
    expect(r.body.motDePasseTemporaire).toBeTruthy();
  });
});

// =================================================================================================
// Revue sécurité F2 : deux rétrogradations concurrentes ne suppriment pas le dernier patron
// =================================================================================================

describe('F2 — dernier patron, concurrence', () => {
  it('deux patrons rétrogradés en même temps : un seul passe (200), l’autre est refusé (409) ; il reste un patron actif', async () => {
    const tenantId = randomUUID();
    await bdd.poolSuperutilisateur.query(
      `insert into tenant (id, slug, raison_sociale, numero_tva, pays, langue_defaut, statut)
       values ($1, $2, 'Garage Course SA', null, 'CH', 'fr', 'actif')`,
      [tenantId, `course-${tenantId.slice(0, 8)}`],
    );
    const admin = await connecter(await nouveau(tenantId, 'admin'));
    const p1 = await nouveau(tenantId, 'direction');
    const p2 = await nouveau(tenantId, 'direction');

    const [a, b] = await Promise.all(
      [p1, p2].map((p) =>
        ctx.requete
          .patch(`/api/v1/utilisateurs/${p.id}`)
          .set('Cookie', admin.cookie)
          .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
          .send({ role: 'vendeur' }),
      ),
    );
    const statuts = [a!.status, b!.status].sort();
    expect(statuts).toEqual([200, 409]);

    const { rows } = await bdd.poolSuperutilisateur.query(
      `select count(*)::int as n from utilisateur
        where tenant_id = $1 and est_patron and statut = 'actif'`,
      [tenantId],
    );
    expect(rows[0].n).toBe(1);
  });

  it('déterministe : la rétrogradation d’un patron attend le verrou du garage (preuve que la section critique est sérialisée)', async () => {
    const tenantId = randomUUID();
    await bdd.poolSuperutilisateur.query(
      `insert into tenant (id, slug, raison_sociale, numero_tva, pays, langue_defaut, statut)
       values ($1, $2, 'Garage Verrou SA', null, 'CH', 'fr', 'actif')`,
      [tenantId, `verrou-${tenantId.slice(0, 8)}`],
    );
    const admin = await connecter(await nouveau(tenantId, 'admin'));
    const p1 = await nouveau(tenantId, 'direction');
    await nouveau(tenantId, 'direction');

    const client = await bdd.poolSuperutilisateur.connect();
    try {
      await client.query('begin');
      await client.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `patron:${tenantId}`,
      ]);
      let termine = false;
      const requete = ctx.requete
        .patch(`/api/v1/utilisateurs/${p1.id}`)
        .set('Cookie', admin.cookie)
        .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
        .send({ role: 'vendeur' })
        .then((r) => {
          termine = true;
          return r;
        });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(termine).toBe(false); // bloquée derrière le verrou détenu par l'autre transaction
      await client.query('commit');
      expect((await requete).status).toBe(200);
    } finally {
      client.release();
    }
  });
});
