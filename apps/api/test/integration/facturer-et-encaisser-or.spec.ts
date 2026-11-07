/**
 * `POST /ordres-reparation/{orId}/facturer-et-encaisser` sur vraie base éphémère : nominal espèces
 * (arrondi 5 ct), carte, différé, idempotence (rejeu = même facture), échec partiel d'encaissement
 * (facture émise malgré tout), refus 409 identiques à `facturer`, droit d'encaisser, isolation tenant.
 */

import { randomUUID } from 'node:crypto';
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

let bdd: BaseEphemere;
let redis: RedisEphemere;
let ctx: AppTest;
let garage: GarageDemoLot1Fixture;
let cookiePour: ReturnType<typeof construireCookiePour>;

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  redis = await demarrerRedisEphemere();
  garage = await semerGarageDemoLot1(bdd);
  ctx = await creerAppTest(bdd, redis.url);
  cookiePour = construireCookiePour(ctx);
}, 180_000);

afterAll(async () => {
  await ctx?.fermer();
  await redis?.fermer();
  await bdd?.fermer();
});

/** OR `termine` avec une ligne `realisee` de `ttcCentimes` (TVA 8.1 % incluse), inséré directement
 *  (le sujet est la facturation, pas la machine à états de l'OR, couverte ailleurs). */
async function orTermine(
  statutLigne: 'realisee' | 'validee',
  ttcCentimes: number,
): Promise<string> {
  const tenant = garage.tenantA.tenant;
  const client = garage.tenantA.clients[0]!;
  const vehicule = garage.tenantA.vehicules[0]!;
  const id = randomUUID();
  const tva = Math.round((ttcCentimes * 81) / 1081);
  const c = await bdd.poolSuperutilisateur.connect();
  try {
    await c.query("set session_replication_role = 'replica'");
    await c.query(
      `insert into ordre_reparation
         (id, tenant_id, numero, site_id, type, statut, client_id, vehicule_id,
          client_designation_figee, adresse_facturation_figee, conditions_figees, ouvert_le, termine_le)
       values ($1,$2,$3,$4,'reparation','termine',$5,$6,$7,$8,$9, now(), now())`,
      [
        id,
        tenant.id,
        `OR-FE-${id.slice(0, 8)}`,
        tenant.sites[0]!.id,
        client.id,
        vehicule.id,
        client.designation,
        { rue: 'Test', npa: '1000', localite: 'Lausanne', pays: 'CH' },
        { conditionsGenerales: 'CGV' },
      ],
    );
    await c.query(
      `insert into ligne_or
         (id, tenant_id, ordre_reparation_id, numero_ordre, type, origine, statut, payeur,
          designation, montant_ht_centimes, montant_tva_centimes, montant_ttc_centimes)
       values ($1,$2,$3,1,'forfait','commandee',$4,'client',$5,$6,$7,$8)`,
      [
        randomUUID(),
        tenant.id,
        id,
        statutLigne,
        'Forfait vidange',
        ttcCentimes - tva,
        tva,
        ttcCentimes,
      ],
    );
    await c.query("set session_replication_role = 'origin'");
  } finally {
    c.release();
  }
  return id;
}

async function appeler(
  orId: string,
  corps: Record<string, unknown>,
  opts: { role?: 'direction' | 'chef_atelier'; tenant?: 'A' | 'B'; cle?: string } = {},
) {
  const cookie = await cookiePour(
    opts.tenant === 'B' ? garage.tenantB : garage.tenantA,
    opts.role ?? 'direction',
  );
  const r = await ctx.requete
    .post(`/api/v1/ordres-reparation/${orId}/facturer-et-encaisser`)
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
    .set('Cookie', cookie)
    .set('Idempotency-Key', opts.cle ?? randomUUID())
    .send(corps);
  return r;
}

interface Corps {
  donnees: {
    facture: { id: string; statut: string; numero: string | null; totalTtcCentimes: number };
    paiement?: { id: string; moyen: string; montantCentimes: number };
    ordreReparation: { statut: string };
  };
  avertissements: { code: string }[];
}

async function etatFacture(id: string) {
  const r = await bdd.poolSuperutilisateur.query(
    'select statut, numero, total_ttc_centimes::int as total, montant_regle_centimes::int as regle, solde_centimes::int as solde, statut_reglement from document_vente where id = $1',
    [id],
  );
  return r.rows[0] as {
    statut: string;
    numero: string | null;
    total: number;
    regle: number;
    solde: number;
    statut_reglement: string;
  };
}

describe('POST /ordres-reparation/{orId}/facturer-et-encaisser', () => {
  it('espèces : facture émise, encaissée, arrondi 5 ct, OR facturé', async () => {
    const orId = await orTermine('realisee', 10801);
    const r = await appeler(orId, { paiement: { mode: 'especes' } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const corps = r.body as Corps;
    expect(corps.donnees.facture.statut).toBe('emis');
    expect(corps.donnees.facture.numero).not.toBeNull();
    expect(corps.donnees.paiement?.moyen).toBe('especes');
    expect(corps.donnees.paiement?.montantCentimes).toBe(10800);
    expect(corps.donnees.ordreReparation.statut).toBe('facture');
    expect(corps.avertissements.map((a) => a.code)).not.toContain('ENCAISSEMENT_ECHOUE');
    const etat = await etatFacture(corps.donnees.facture.id);
    expect(etat).toMatchObject({ statut: 'emis', total: 10801, regle: 10801, solde: 0 });
    expect(etat.statut_reglement).toBe('regle');
  }, 120_000);

  it.each([
    { solde: 10944, paiement: 10945, arrondi: -1 },
    { solde: 10942, paiement: 10940, arrondi: 2 },
  ])(
    'espèces $solde : paiement au multiple de 5 ct ($paiement), arrondi signé $arrondi, facture réglée, aucune avance',
    async ({ solde, paiement, arrondi }) => {
      const orId = await orTermine('realisee', solde);
      const r = await appeler(orId, { paiement: { mode: 'especes' } });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      const corps = r.body as Corps;
      expect(corps.avertissements, JSON.stringify(corps.avertissements)).toEqual([]);
      expect(corps.donnees.paiement?.montantCentimes).toBe(paiement);
      expect(await etatFacture(corps.donnees.facture.id)).toMatchObject({
        total: solde,
        regle: solde,
        solde: 0,
        statut_reglement: 'regle',
      });
      const imp = await bdd.poolSuperutilisateur.query(
        'select nature, montant_centimes::int as montant from imputation_paiement where document_id = $1 order by nature',
        [corps.donnees.facture.id],
      );
      expect(imp.rows).toEqual([
        { nature: 'reglement', montant: paiement },
        { nature: 'arrondi', montant: arrondi },
      ]);
      // Aucune avance : le paiement est entièrement imputé en règlement.
      const nonImpute = await bdd.poolSuperutilisateur.query(
        `select p.montant_centimes::int - coalesce(sum(i.montant_centimes) filter (where i.nature = 'reglement'), 0)::int as reste
           from paiement p join imputation_paiement i on i.paiement_id = p.id
          where i.document_id = $1 group by p.id`,
        [corps.donnees.facture.id],
      );
      expect(nonImpute.rows).toEqual([{ reste: 0 }]);
    },
  );

  it('carte : encaisse le solde exact, sans arrondi', async () => {
    const orId = await orTermine('realisee', 10801);
    const r = await appeler(orId, { paiement: { mode: 'carte' } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const corps = r.body as Corps;
    expect(corps.donnees.paiement?.montantCentimes).toBe(10801);
    expect(await etatFacture(corps.donnees.facture.id)).toMatchObject({
      regle: 10801,
      solde: 0,
    });
  }, 120_000);

  it('différé (sans paiement) : facture émise, rien encaissé', async () => {
    const orId = await orTermine('realisee', 5000);
    const r = await appeler(orId, {});
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const corps = r.body as Corps;
    expect(corps.donnees.paiement).toBeUndefined();
    expect(await etatFacture(corps.donnees.facture.id)).toMatchObject({
      statut: 'emis',
      regle: 0,
      solde: 5000,
    });
  }, 120_000);

  it('rejeu avec la même clé : même facture, un seul document et un seul paiement', async () => {
    const orId = await orTermine('realisee', 7000);
    const cle = randomUUID();
    const premier = await appeler(orId, { paiement: { mode: 'twint' } }, { cle });
    expect(premier.status, JSON.stringify(premier.body)).toBe(201);
    const rejeu = await appeler(orId, { paiement: { mode: 'twint' } }, { cle });
    expect(rejeu.status).toBe(201);
    expect(rejeu.headers['idempotency-rejeu']).toBe('true');
    expect((rejeu.body as Corps).donnees.facture.id).toBe(
      (premier.body as Corps).donnees.facture.id,
    );
    const n = await bdd.poolSuperutilisateur.query(
      `select (select count(*)::int from document_vente where ordre_reparation_id = $1) as docs,
              (select count(*)::int from imputation_paiement where document_id = $2) as imputations`,
      [orId, (premier.body as Corps).donnees.facture.id],
    );
    expect(n.rows[0]).toEqual({ docs: 1, imputations: 1 });
    const conflit = await appeler(orId, { paiement: { mode: 'carte' } }, { cle });
    expect(conflit.status).toBe(409);
    expect((conflit.body as { code?: string }).code).toBe('IDEMPOTENCE_CONFLIT');
  }, 120_000);

  it('échec partiel : montant excédentaire -> facture émise quand même, avertissement, aucun paiement', async () => {
    const orId = await orTermine('realisee', 6000);
    const r = await appeler(orId, { paiement: { mode: 'carte', montantCentimes: 999999 } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const corps = r.body as Corps;
    expect(corps.avertissements.map((a) => a.code)).toContain('ENCAISSEMENT_ECHOUE');
    expect(corps.donnees.paiement).toBeUndefined();
    expect(corps.donnees.facture.statut).toBe('emis');
    const etat = await etatFacture(corps.donnees.facture.id);
    expect(etat).toMatchObject({ statut: 'emis', regle: 0, solde: 6000 });
    const p = await bdd.poolSuperutilisateur.query(
      'select count(*)::int as n from imputation_paiement where document_id = $1',
      [corps.donnees.facture.id],
    );
    expect(p.rows[0].n).toBe(0);
  }, 120_000);

  it('refus 409 identiques à facturer : ligne indécise ou OR déjà facturé, rien créé', async () => {
    const orId = await orTermine('validee', 5000);
    const r = await appeler(orId, {});
    expect(r.status).toBe(409);
    expect((r.body as { code?: string }).code).toBe('FACTURATION_LIGNES_INDECISES');
    const n = await bdd.poolSuperutilisateur.query(
      'select count(*)::int as n from document_vente where ordre_reparation_id = $1',
      [orId],
    );
    expect(n.rows[0].n).toBe(0);

    const orOk = await orTermine('realisee', 5000);
    expect((await appeler(orOk, {})).status).toBe(201);
    const deuxieme = await appeler(orOk, {});
    expect(deuxieme.status).toBe(409);
    expect((deuxieme.body as { code?: string }).code).toBe('OR_TRANSITION_INTERDITE');
  }, 120_000);

  it('rôle sans droit d’encaisser (chef d’atelier) : 403 si paiement demandé, rien créé', async () => {
    const orId = await orTermine('realisee', 5000);
    const r = await appeler(orId, { paiement: { mode: 'carte' } }, { role: 'chef_atelier' });
    expect(r.status).toBe(403);
    const n = await bdd.poolSuperutilisateur.query(
      'select count(*)::int as n from document_vente where ordre_reparation_id = $1',
      [orId],
    );
    expect(n.rows[0].n).toBe(0);
  }, 120_000);

  it('un autre tenant ne voit pas l’OR (404)', async () => {
    const orId = await orTermine('realisee', 5000);
    const r = await appeler(orId, {}, { tenant: 'B' });
    expect(r.status).toBe(404);
  }, 120_000);
});
