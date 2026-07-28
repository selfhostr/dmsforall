/**
 * Machine à états de `ligne_or` — même dispositif que `transitions-ordre-reparation.spec.ts`
 * (couche 2, `verifier_transition('ligne_or')`, posé dans 0008_atelier.sql). L'OR porteur reste
 * volontairement au statut `planifie` tout au long de ce fichier : le trigger `ligne_or_verrouiller_or`
 * (couche 3, I-15/CT-30) refuse toute écriture sur une ligne dont l'OR est
 * facture|restitue|cloture|annule, ce qui bloquerait ces tests pour une raison ÉTRANGÈRE à ce
 * qu'ils vérifient. Ce couplage est lui-même couvert par `isolation/isolation-donnees-lot1.spec.ts`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  demarrerBaseEphemere,
  ecrireSousTenant,
  type BaseEphemere,
} from '../../setup/postgres-ephemere';
import {
  creerLignePourTest,
  creerOrPourTest,
  semerGarageDemoLot1,
  type GarageDemoLot1Fixture,
} from '../fixtures/garage-demo-lot1';

let bdd: BaseEphemere;
let garage: GarageDemoLot1Fixture;

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  garage = await semerGarageDemoLot1(bdd);
}, 180_000);

afterAll(async () => {
  await bdd?.fermer();
});

interface ErreurTransitionPg {
  readonly code?: string;
  readonly table?: string;
  readonly detail?: string;
  readonly hint?: string;
  readonly message?: string;
}

async function transitionnerLigne(
  tenantId: string,
  ligneId: string,
  statutCible: string,
): Promise<{ statut: string }> {
  return ecrireSousTenant(bdd.poolApp, tenantId, async (client) => {
    const resultat = await client.query<{ statut: string }>(
      'update ligne_or set statut = $1 where id = $2 returning statut',
      [statutCible, ligneId],
    );
    return resultat.rows[0]!;
  });
}

/** `ligne_or_annulation_motif_chk` exige `motif_annulation` dès que `statut = 'annulee'` —
 *  contrainte CHECK indépendante de `exige_motif` sur `transition_autorisee` (qui documente une
 *  exigence applicative, pas celle-ci). `transitionnerLigne` seul suffit pour toute AUTRE cible. */
async function annulerLigne(
  tenantId: string,
  ligneId: string,
  motif: string,
): Promise<{ statut: string }> {
  return ecrireSousTenant(bdd.poolApp, tenantId, async (client) => {
    const resultat = await client.query<{ statut: string }>(
      "update ligne_or set statut = 'annulee', motif_annulation = $1 where id = $2 returning statut",
      [motif, ligneId],
    );
    return resultat.rows[0]!;
  });
}

async function nouvelleLigne(numeroOrdre = 1) {
  const t = garage.tenantA;
  const or = await creerOrPourTest(
    bdd,
    t.tenant,
    t.tenant.sites[0]!.id,
    t.clients[0]!,
    t.vehicules[0]!,
  );
  return creerLignePourTest(bdd, t.tenant, or.id, numeroOrdre);
}

describe('ligne_or — transitions autorisées', () => {
  it("proposee → validee (sous le plafond, pas d'accord client nécessaire)", async () => {
    const ligne = await nouvelleLigne();
    const resultat = await transitionnerLigne(garage.tenantA.tenant.id, ligne.id, 'validee');
    expect(resultat.statut).toBe('validee');
  });

  it('la chaîne complète proposee → validee → en_cours → realisee → facturee est acceptée pas à pas', async () => {
    const ligne = await nouvelleLigne(2);
    for (const cible of ['validee', 'en_cours', 'realisee', 'facturee']) {
      const resultat = await transitionnerLigne(garage.tenantA.tenant.id, ligne.id, cible);
      expect(resultat.statut, `étape → ${cible}`).toBe(cible);
    }
  });

  it("refusee → a_valider (le client rappelle et change d'avis, un nouveau devis reprend le circuit)", async () => {
    const ligne = await nouvelleLigne(3);
    await transitionnerLigne(garage.tenantA.tenant.id, ligne.id, 'a_valider');
    await transitionnerLigne(garage.tenantA.tenant.id, ligne.id, 'refusee');
    const resultat = await transitionnerLigne(garage.tenantA.tenant.id, ligne.id, 'a_valider');
    expect(resultat.statut).toBe('a_valider');
  });
});

describe('ligne_or — transitions INTERDITES', () => {
  it('proposee → en_cours est refusée (on ne travaille pas sans être passé par la validation)', async () => {
    const ligne = await nouvelleLigne(4);
    try {
      await transitionnerLigne(garage.tenantA.tenant.id, ligne.id, 'en_cours');
      expect.fail('la transition aurait dû être refusée');
    } catch (erreur) {
      const e = erreur as ErreurTransitionPg;
      expect(e.code).toBe('ZDFA1');
      expect(e.table).toBe('ligne_or');
      expect(e.detail).toBe('entite=ligne_or;depuis=proposee;vers=en_cours');
      expect(e.hint).toBe('Depuis « proposee », transitions autorisées : a_valider, validee.');
    }
  });

  it("a_valider → en_cours est refusée (RM-93 : on ne travaille pas sur ce qui n'est pas encore accordé)", async () => {
    const ligne = await nouvelleLigne(5);
    await transitionnerLigne(garage.tenantA.tenant.id, ligne.id, 'a_valider');
    await expect(
      transitionnerLigne(garage.tenantA.tenant.id, ligne.id, 'en_cours'),
    ).rejects.toMatchObject({ code: 'ZDFA1' });
  });

  it('refusee → realisee est refusée (RM-72, CT-28 : un refus client ne se contourne pas en la réalisant quand même)', async () => {
    const ligne = await nouvelleLigne(6);
    await transitionnerLigne(garage.tenantA.tenant.id, ligne.id, 'a_valider');
    await transitionnerLigne(garage.tenantA.tenant.id, ligne.id, 'refusee');
    await expect(
      transitionnerLigne(garage.tenantA.tenant.id, ligne.id, 'realisee'),
    ).rejects.toMatchObject({ code: 'ZDFA1' });
  });

  it('facturee est un état TERMINAL : une ligne facturée est figée, correction par avoir uniquement', async () => {
    const ligne = await nouvelleLigne(7);
    for (const cible of ['validee', 'en_cours', 'realisee', 'facturee']) {
      await transitionnerLigne(garage.tenantA.tenant.id, ligne.id, cible);
    }

    try {
      await transitionnerLigne(garage.tenantA.tenant.id, ligne.id, 'annulee');
      expect.fail('la transition aurait dû être refusée : facturee est terminal');
    } catch (erreur) {
      const e = erreur as ErreurTransitionPg;
      expect(e.code).toBe('ZDFA1');
      expect(e.hint).toBe("« facturee » est un état terminal : aucune transition n'en part.");
    }
  });

  it('annulee est un état TERMINAL : aucune sortie', async () => {
    const ligne = await nouvelleLigne(8);
    await transitionnerLigne(garage.tenantA.tenant.id, ligne.id, 'validee');
    const apresAnnulation = await annulerLigne(
      garage.tenantA.tenant.id,
      ligne.id,
      'Test : annulation motivée (spec §5.2)',
    );
    expect(apresAnnulation.statut).toBe('annulee');

    await expect(
      transitionnerLigne(garage.tenantA.tenant.id, ligne.id, 'validee'),
    ).rejects.toMatchObject({ code: 'ZDFA1' });
  });
});
