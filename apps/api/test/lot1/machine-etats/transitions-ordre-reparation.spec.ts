/**
 * Machine à états de `ordre_reparation`, couche 2 (`verifier_transition()`, posé dans
 * 0003_prealables_etape1.sql, appliqué à cette table dans 0008_atelier.sql). Aucun service
 * n'existe encore pour ce module (les contrôleurs du lot 1 restent à écrire) — ce fichier prouve
 * donc directement le garde-fou EN BASE, avec le pool `dfa_app` sous RLS, exactement le chemin
 * qu'empruntera le futur service.
 *
 * Priorité aux transitions INTERDITES (CONTRIBUTING.md, plan §5.5 R-9 et voisines) : ce sont elles qui
 * attrapent un vrai bug — une transition autorisée qui passe ne prouve pas grand-chose tant que la
 * table `transition_autorisee` elle-même n'est pas fausse, alors qu'une transition interdite qui
 * passerait laisserait un OR facturé repartir « en_cours » en production.
 *
 * Chaque refus vérifie le SQLSTATE ZDFA1 ET le contenu exact de TABLE/DETAIL/HINT posé par
 * `verifier_transition()` — c'est ce contenu qui alimente `OR_TRANSITION_INTERDITE` +
 * `actionsProposees` côté service, une fois qu'il existera (contrat §3, D-05).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  demarrerBaseEphemere,
  ecrireSousTenant,
  type BaseEphemere,
} from '../../setup/postgres-ephemere';
import {
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

async function transitionnerOr(
  tenantId: string,
  orId: string,
  statutCible: string,
): Promise<{ statut: string }> {
  return ecrireSousTenant(bdd.poolApp, tenantId, async (client) => {
    const resultat = await client.query<{ statut: string }>(
      'update ordre_reparation set statut = $1 where id = $2 returning statut',
      [statutCible, orId],
    );
    return resultat.rows[0]!;
  });
}

/** `ordre_reparation_annulation_coherente_chk` exige `motif_annulation` dès que `statut = 'annule'`
 *  — indépendamment de `exige_motif` sur `transition_autorisee` (ce drapeau documente une exigence
 *  APPLICATIVE, cette contrainte CHECK-ci en est une AUTRE, posée directement sur la table.
 *  `transitionnerOr` seul suffit pour toute AUTRE cible : il ne pose que `statut`. */
async function annulerOr(
  tenantId: string,
  orId: string,
  motif: string,
): Promise<{ statut: string }> {
  return ecrireSousTenant(bdd.poolApp, tenantId, async (client) => {
    const resultat = await client.query<{ statut: string }>(
      "update ordre_reparation set statut = 'annule', motif_annulation = $1 where id = $2 returning statut",
      [motif, orId],
    );
    return resultat.rows[0]!;
  });
}

async function nouvelOr() {
  const t = garage.tenantA;
  return creerOrPourTest(bdd, t.tenant, t.tenant.sites[0]!.id, t.clients[0]!, t.vehicules[0]!);
}

describe('ordre_reparation — transitions autorisées', () => {
  it('planifie → ouvert (T-03, réception)', async () => {
    const or = await nouvelOr();
    const resultat = await transitionnerOr(garage.tenantA.tenant.id, or.id, 'ouvert');
    expect(resultat.statut).toBe('ouvert');
  });

  it("un UPDATE qui ne change PAS le statut est accepté sans consulter le référentiel (ce n'est pas une transition)", async () => {
    const or = await nouvelOr();
    const resultat = await ecrireSousTenant(
      bdd.poolApp,
      garage.tenantA.tenant.id,
      async (client) => {
        const r = await client.query<{ statut: string }>(
          'update ordre_reparation set km_entree = 12345 where id = $1 returning statut',
          [or.id],
        );
        return r.rows[0]!;
      },
    );
    expect(resultat.statut).toBe('planifie');
  });

  it('la chaîne complète planifie → ouvert → termine → restitue → cloture est acceptée pas à pas', async () => {
    const or = await nouvelOr();
    for (const cible of ['ouvert', 'termine', 'restitue', 'cloture']) {
      const resultat = await transitionnerOr(garage.tenantA.tenant.id, or.id, cible);
      expect(resultat.statut, `étape → ${cible}`).toBe(cible);
    }
  });
});

describe('ordre_reparation — transitions INTERDITES (ce sont elles qui attrapent les vrais bugs)', () => {
  it('planifie → en_cours est refusée (I-07 : la réception ne se saute pas)', async () => {
    const or = await nouvelOr();
    await expect(
      transitionnerOr(garage.tenantA.tenant.id, or.id, 'en_cours'),
    ).rejects.toMatchObject({ code: 'ZDFA1' });

    try {
      await transitionnerOr(garage.tenantA.tenant.id, or.id, 'en_cours');
      expect.fail('la transition aurait dû être refusée');
    } catch (erreur) {
      const e = erreur as ErreurTransitionPg;
      expect(e.table).toBe('ordre_reparation');
      expect(e.detail).toBe('entite=ordre_reparation;depuis=planifie;vers=en_cours');
      expect(e.hint).toBe('Depuis « planifie », transitions autorisées : annule, ouvert.');
      expect(e.message).toContain('Transition planifie → en_cours interdite sur ordre_reparation.');
    }
  });

  it('ouvert → facture est refusée (I-01 : aucune facturation directe sans passer par termine)', async () => {
    const or = await nouvelOr();
    await transitionnerOr(garage.tenantA.tenant.id, or.id, 'ouvert');
    await expect(transitionnerOr(garage.tenantA.tenant.id, or.id, 'facture')).rejects.toMatchObject(
      { code: 'ZDFA1' },
    );
  });

  it('ouvert → restitue est refusée (I-12 : pas de restitution sans passer par termine ou facture)', async () => {
    const or = await nouvelOr();
    await transitionnerOr(garage.tenantA.tenant.id, or.id, 'ouvert');
    await expect(
      transitionnerOr(garage.tenantA.tenant.id, or.id, 'restitue'),
    ).rejects.toMatchObject({ code: 'ZDFA1' });
  });

  it("cloture est un état TERMINAL : aucune transition n'en part, le HINT le dit explicitement", async () => {
    const or = await nouvelOr();
    for (const cible of ['ouvert', 'termine', 'restitue', 'cloture']) {
      await transitionnerOr(garage.tenantA.tenant.id, or.id, cible);
    }

    try {
      await transitionnerOr(garage.tenantA.tenant.id, or.id, 'ouvert');
      expect.fail('la transition aurait dû être refusée : cloture est terminal');
    } catch (erreur) {
      const e = erreur as ErreurTransitionPg;
      expect(e.code).toBe('ZDFA1');
      expect(e.table).toBe('ordre_reparation');
      expect(e.detail).toBe('entite=ordre_reparation;depuis=cloture;vers=ouvert');
      expect(e.hint).toBe("« cloture » est un état terminal : aucune transition n'en part.");
    }
  });

  it('annule est un état TERMINAL (I-06) : depuis planifie → annule (légal), puis annule → ouvert est refusée', async () => {
    const or = await nouvelOr();
    const apresAnnulation = await annulerOr(
      garage.tenantA.tenant.id,
      or.id,
      'Test : annulation avant tout travail (T-20)',
    );
    expect(apresAnnulation.statut).toBe('annule');

    try {
      await transitionnerOr(garage.tenantA.tenant.id, or.id, 'ouvert');
      expect.fail('la transition aurait dû être refusée : annule est terminal');
    } catch (erreur) {
      const e = erreur as ErreurTransitionPg;
      expect(e.hint).toBe("« annule » est un état terminal : aucune transition n'en part.");
    }
  });

  it("facture → en_cours est refusée (I-02 : une fois facturé, on ne remet plus la main sur l'atelier)", async () => {
    const or = await nouvelOr();
    for (const cible of ['ouvert', 'termine', 'facture']) {
      await transitionnerOr(garage.tenantA.tenant.id, or.id, cible);
    }
    await expect(
      transitionnerOr(garage.tenantA.tenant.id, or.id, 'en_cours'),
    ).rejects.toMatchObject({ code: 'ZDFA1' });
    // I-03 au passage : facture → annule est tout autant absente du référentiel.
    await expect(transitionnerOr(garage.tenantA.tenant.id, or.id, 'annule')).rejects.toMatchObject({
      code: 'ZDFA1',
    });
  });
});
