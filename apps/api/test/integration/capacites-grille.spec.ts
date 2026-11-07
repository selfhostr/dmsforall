/**
 * Migration 0087 (grille de capacités par personne) sur une VRAIE base : le trigger d'insertion
 * remplit la grille depuis le rôle, la borne reste un profil figé (CHECK), la fonction d'amorçage
 * de session rend la grille, une grille illisible est refusée par le type. Aucun mock.
 */
import { randomUUID, createHash } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PREREGLAGES, ROLES_PERSONNE } from '@dfa/shared';

import { demarrerBaseEphemere, type BaseEphemere } from '../setup/postgres-ephemere';

let bdd: BaseEphemere;
const tenantId = randomUUID();
const siteId = randomUUID();

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  await bdd.poolSuperutilisateur.query(
    `insert into tenant (id, slug, raison_sociale, numero_tva, pays, langue_defaut, statut)
     values ($1, 'garage-grille', 'Garage Grille SA', null, 'CH', 'fr', 'actif')`,
    [tenantId],
  );
  await bdd.poolSuperutilisateur.query(
    `insert into site (id, tenant_id, code, nom, rue, npa, localite, pays, actif)
     values ($1, $2, 'S1', 'Site', null, null, null, 'CH', true)`,
    [siteId, tenantId],
  );
}, 180_000);

afterAll(async () => {
  await bdd?.fermer();
});

async function inserer(role: string, extra = '', siteIdCompte: string | null = null) {
  const id = randomUUID();
  await bdd.poolSuperutilisateur.query(
    `insert into utilisateur (id, tenant_id, email, mot_de_passe_hash, prenom, nom, langue, role, statut, site_id ${extra ? ', ' + extra.split('=')[0] : ''})
     values ($1, $2, $3, 'x', 'P', 'N', 'fr', $4, 'actif', $5 ${extra ? ', ' + extra.split('=')[1] : ''})`,
    [id, tenantId, `${role}-${id}@grille.test`, role, siteIdCompte],
  );
  const { rows } = await bdd.poolSuperutilisateur.query(`select * from utilisateur where id = $1`, [
    id,
  ]);
  return { id, ligne: rows[0] as Record<string, unknown> };
}

describe('0087 — trigger d’insertion : la grille vient du rôle quand on ne la précise pas', () => {
  for (const role of ROLES_PERSONNE) {
    it(`${role} : grille = préréglage`, async () => {
      const { ligne } = await inserer(role);
      const g = PREREGLAGES[role].grille;
      expect(ligne).toMatchObject({
        niveau_atelier: g.niveaux.atelier,
        niveau_accueil: g.niveaux.accueil,
        niveau_facturation: g.niveaux.facturation,
        niveau_pieces: g.niveaux.pieces,
        niveau_ventes: g.niveaux.ventes,
        niveau_finances: g.niveaux.finances,
        peut_encadrer: g.encadrer,
        peut_gerer_employes: g.gererEmployes,
        est_patron: g.patron,
        voit_montants: g.options.voitMontants,
        voit_prix_achat: g.options.voitPrixAchat,
        avoirs_plafonnes: g.options.avoirsPlafonnes,
      });
    });
  }

  it('une valeur explicite l’emporte sur le préréglage (fiduciaire : comptable en lecture)', async () => {
    const { ligne } = await inserer('comptable', `niveau_finances='voir'`);
    expect(ligne.niveau_finances).toBe('voir');
    expect(ligne.niveau_facturation).toBe('faire');
  });

  it('la borne reste un profil figé : grille vide, et une grille non vide est refusée par CHECK', async () => {
    const { ligne } = await inserer('poste_atelier', '', siteId);
    expect(ligne).toMatchObject({
      niveau_atelier: 'rien',
      peut_encadrer: false,
      voit_montants: false,
    });
    await expect(inserer('poste_atelier', `niveau_atelier='faire'`, siteId)).rejects.toThrow(
      /utilisateur_borne_sans_grille_chk/,
    );
  });

  it('un patron sans « gérer les employés » est refusé par CHECK', async () => {
    await expect(inserer('vendeur', `est_patron=true`)).rejects.toThrow(
      /utilisateur_patron_gere_employes_chk/,
    );
  });

  it('un niveau inconnu est refusé par le type', async () => {
    await expect(inserer('vendeur', `niveau_pieces='tout'`)).rejects.toThrow(/niveau_acces/);
  });
});

describe('0087 — amorcage.session_par_empreinte rend la grille, relue à chaque appel', () => {
  it('une baisse de droits en base est visible à l’appel suivant, sans nouvelle session', async () => {
    const { id } = await inserer('direction');
    const jeton = randomUUID();
    const empreinte = createHash('sha256').update(jeton, 'utf8').digest();
    await bdd.poolSuperutilisateur.query(
      `insert into session (tenant_id, utilisateur_id, empreinte_token, expire_le, vu_le)
       values ($1, $2, $3, now() + interval '1 hour', now())`,
      [tenantId, id, empreinte],
    );
    const lire = async () =>
      (
        await bdd.poolSuperutilisateur.query(
          `select niveau_finances, voit_montants, est_patron from amorcage.session_par_empreinte($1::bytea)`,
          [empreinte],
        )
      ).rows[0];
    expect(await lire()).toMatchObject({
      niveau_finances: 'faire',
      voit_montants: true,
      est_patron: true,
    });

    await bdd.poolSuperutilisateur.query(
      `update utilisateur set niveau_finances='rien', voit_montants=false where id=$1`,
      [id],
    );
    expect(await lire()).toMatchObject({ niveau_finances: 'rien', voit_montants: false });
  });
});
