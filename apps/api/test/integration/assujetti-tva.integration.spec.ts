/**
 * Assujettissement à la TVA (migration 0090) sur vraie base éphémère : contrainte de base,
 * `PATCH /parametres-entreprise`, état de démarrage (A1 : étape TVA ; A2 : n° de rue), refus et
 * normalisation à l'émission (facture, devis, OR facturé), isolation entre garages. Montants exacts.
 */

import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EN_TETE_IDEMPOTENCE } from '@dfa/shared';

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

const NUMERO_TVA = 'CHE-116.281.710 TVA';

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

/** Remet les deux garages dans l'état de départ : assujettis, avec n° TVA. */
afterEach(async () => {
  await bdd.poolSuperutilisateur.query(
    'update tenant set assujetti_tva = true, numero_tva = $1 where id in ($2, $3)',
    [NUMERO_TVA, garage.tenantA.tenant.id, garage.tenantB.tenant.id],
  );
});

async function fixerTenantA(assujetti: boolean, numeroTva: string | null): Promise<void> {
  await bdd.poolSuperutilisateur.query(
    'update tenant set numero_tva = $2, assujetti_tva = $3 where id = $1',
    [garage.tenantA.tenant.id, numeroTva, assujetti],
  );
}

async function avec(tenant: 'A' | 'B' = 'A') {
  const t = tenant === 'A' ? garage.tenantA : garage.tenantB;
  const cookie = await cookiePour(t, 'direction');
  return {
    get: (chemin: string) => ctx.requete.get(chemin).set('Cookie', cookie),
    patch: (chemin: string, corps: Record<string, unknown>) =>
      ctx.requete
        .patch(chemin)
        .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
        .set('Cookie', cookie)
        .send(corps),
    post: (chemin: string, corps: Record<string, unknown> = {}) =>
      ctx.requete
        .post(chemin)
        .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
        .set('Cookie', cookie)
        .set(EN_TETE_IDEMPOTENCE, randomUUID())
        .send(corps),
  };
}

interface DocumentRepondu {
  id: string;
  statut: string;
  numero: string | null;
  totalHtCentimes: number;
  totalTvaCentimes: number;
  totalTtcCentimes: number;
  ventilationTva: Array<{
    regimeTva: string;
    tauxTvaPourmille: number;
    baseCentimes: number;
    tvaCentimes: number;
  }>;
  lignes: Array<{ regimeTva: string; tauxTvaPourmille: number }>;
}

async function creerBrouillon(
  type: 'facture' | 'devis',
  ligne: Record<string, unknown>,
): Promise<string> {
  const api = await avec('A');
  const r = await api.post('/api/v1/documents-vente', {
    typeDocument: type,
    siteId: garage.tenantA.tenant.sites[0]!.id,
    clientId: garage.tenantA.clients[0]!.id,
    devise: 'CHF',
    dateDocument: '2026-11-02',
    lignes: [
      {
        type: 'forfait',
        designation: 'Vidange',
        quantiteMillieme: 1000,
        prixUnitaireTtcCentimes: 21_620,
        datePrestation: '2026-11-02',
        ...ligne,
      },
    ],
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return (r.body as { donnees: { id: string } }).donnees.id;
}

async function emettre(id: string) {
  return (await avec('A')).post(`/api/v1/documents-vente/${id}/emettre`);
}

describe('base : contrainte et défaut', () => {
  it('les garages existants / de test sont assujettis par défaut', async () => {
    const r = await bdd.poolSuperutilisateur.query(
      'select assujetti_tva from tenant where id = $1',
      [garage.tenantB.tenant.id],
    );
    expect(r.rows).toEqual([{ assujetti_tva: true }]);
  });

  it('un non-assujetti ne peut pas porter de n° TVA (CHECK, SQLSTATE 23514)', async () => {
    await expect(
      bdd.poolSuperutilisateur.query(
        'update tenant set assujetti_tva = false, numero_tva = $2 where id = $1',
        [garage.tenantA.tenant.id, NUMERO_TVA],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('PATCH /parametres-entreprise — assujettissement', () => {
  it('« Non » vide le n°, journalise avant/après, et n’affecte pas un autre garage', async () => {
    const a = await avec('A');
    const r = await a.patch('/api/v1/parametres-entreprise', { assujettiTva: false });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ assujettiTva: false, numeroTva: null });

    const audit = await bdd.poolSuperutilisateur.query(
      `select champ, valeur_avant, valeur_apres from audit_atelier
        where tenant_id = $1 and entite = 'tenant' order by champ`,
      [garage.tenantA.tenant.id],
    );
    expect(audit.rows).toEqual([
      { champ: 'assujetti_tva', valeur_avant: true, valeur_apres: false },
      { champ: 'numero_tva', valeur_avant: NUMERO_TVA, valeur_apres: null },
    ]);

    const b = await avec('B');
    const rb = await b.get('/api/v1/parametres-entreprise');
    expect(rb.body).toMatchObject({ assujettiTva: true, numeroTva: NUMERO_TVA });
  });

  it('« Non » avec un n° est refusé en 400, rien n’est écrit', async () => {
    const a = await avec('A');
    const r = await a.patch('/api/v1/parametres-entreprise', {
      assujettiTva: false,
      numeroTva: NUMERO_TVA,
    });
    expect(r.status).toBe(400);
    const relu = await a.get('/api/v1/parametres-entreprise');
    expect(relu.body).toMatchObject({ assujettiTva: true, numeroTva: NUMERO_TVA });
  });
});

describe('GET /accueil/etat-demarrage — étapes TVA (A1) et coordonnées (A2)', () => {
  async function etapes() {
    const r = await (await avec('A')).get('/api/v1/accueil/etat-demarrage');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return (r.body as { etapes: Record<string, boolean> }).etapes;
  }

  it('assujetti sans n° : TVA à faire ; avec n° : faite ; non assujetti : faite', async () => {
    await fixerTenantA(true, null);
    expect((await etapes()).numeroTva).toBe(false);
    await fixerTenantA(true, NUMERO_TVA);
    expect((await etapes()).numeroTva).toBe(true);
    await fixerTenantA(false, null);
    expect((await etapes()).numeroTva).toBe(true);
  });

  it('coordonnées : sans n° de rue, PAS fait ; avec, fait (comme l’émission)', async () => {
    const tid = garage.tenantA.tenant.id;
    expect((await etapes()).coordonnees).toBe(true);
    await bdd.poolSuperutilisateur.query(
      'update tenant_bloc_creancier set numero = null where tenant_id = $1',
      [tid],
    );
    try {
      expect((await etapes()).coordonnees).toBe(false);
    } finally {
      await bdd.poolSuperutilisateur.query(
        "update tenant_bloc_creancier set numero = '1' where tenant_id = $1",
        [tid],
      );
    }
    expect((await etapes()).coordonnees).toBe(true);
  });
});

describe('émission — garage NON assujetti', () => {
  it('ligne à 81 ‰ : facture refusée (409 TVA_NON_ASSUJETTI_TAUX_INTERDIT), aucun numéro consommé', async () => {
    await fixerTenantA(false, null);
    const id = await creerBrouillon('facture', { tauxTvaPourmille: 81 });
    const r = await emettre(id);
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body).toMatchObject({ code: 'TVA_NON_ASSUJETTI_TAUX_INTERDIT' });
    const etat = await bdd.poolSuperutilisateur.query(
      'select statut, numero from document_vente where id = $1',
      [id],
    );
    expect(etat.rows).toEqual([{ statut: 'brouillon', numero: null }]);
  });

  it('taux omis (0 par défaut) : facture émise, CHF 216.20 sans aucune TVA, régime exclu', async () => {
    await fixerTenantA(false, null);
    const id = await creerBrouillon('facture', {});
    const r = await emettre(id);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const doc = (r.body as { donnees: DocumentRepondu }).donnees;
    expect(doc).toMatchObject({
      statut: 'emis',
      totalHtCentimes: 21_620,
      totalTvaCentimes: 0,
      totalTtcCentimes: 21_620,
    });
    expect(doc.ventilationTva).toEqual([
      { regimeTva: 'exclu', tauxTvaPourmille: 0, baseCentimes: 21_620, tvaCentimes: 0 },
    ]);
    expect(doc.lignes).toMatchObject([{ regimeTva: 'exclu', tauxTvaPourmille: 0 }]);
  });

  it('taux 0 explicite en régime « normal » : ramené à « exclu » à l’émission', async () => {
    await fixerTenantA(false, null);
    const id = await creerBrouillon('facture', { tauxTvaPourmille: 0, regimeTva: 'normal' });
    const r = await emettre(id);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const doc = (r.body as { donnees: DocumentRepondu }).donnees;
    expect(doc.ventilationTva.map((v) => v.regimeTva)).toEqual(['exclu']);
  });

  it('devis à 81 ‰ : refusé aussi', async () => {
    await fixerTenantA(false, null);
    const id = await creerBrouillon('devis', { tauxTvaPourmille: 81 });
    const r = await emettre(id);
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'TVA_NON_ASSUJETTI_TAUX_INTERDIT' });
  });
});

describe('émission — garage ASSUJETTI', () => {
  it('sans n° TVA : facture refusée (409 TVA_NUMERO_REQUIS), devis émis', async () => {
    await fixerTenantA(true, null);
    const facture = await creerBrouillon('facture', { tauxTvaPourmille: 81 });
    const refus = await emettre(facture);
    expect(refus.status, JSON.stringify(refus.body)).toBe(409);
    expect(refus.body).toMatchObject({ code: 'TVA_NUMERO_REQUIS' });

    const devis = await creerBrouillon('devis', { tauxTvaPourmille: 81 });
    const ok = await emettre(devis);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it('avec n° TVA : taux omis refusé à la saisie (400), 81 ‰ → TVA 16.20 sur 216.20 TTC', async () => {
    const api = await avec('A');
    const sansTaux = await api.post('/api/v1/documents-vente', {
      typeDocument: 'facture',
      siteId: garage.tenantA.tenant.sites[0]!.id,
      clientId: garage.tenantA.clients[0]!.id,
      devise: 'CHF',
      dateDocument: '2026-11-02',
      lignes: [
        {
          type: 'forfait',
          designation: 'Vidange',
          quantiteMillieme: 1000,
          prixUnitaireTtcCentimes: 21_620,
          datePrestation: '2026-11-02',
        },
      ],
    });
    expect(sansTaux.status).toBe(400);

    const id = await creerBrouillon('facture', { tauxTvaPourmille: 81 });
    const r = await emettre(id);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const doc = (r.body as { donnees: DocumentRepondu }).donnees;
    // 21620 × 81 / 1081 = 1620.0 → TVA 1'620 ct, HT 20'000 ct.
    expect(doc).toMatchObject({
      totalHtCentimes: 20_000,
      totalTvaCentimes: 1_620,
      totalTtcCentimes: 21_620,
    });
    expect(doc.ventilationTva).toEqual([
      { regimeTva: 'normal', tauxTvaPourmille: 81, baseCentimes: 20_000, tvaCentimes: 1_620 },
    ]);
  });
});

/** OR `termine` avec une ligne `realisee` de `ttcCentimes` (TVA 8.1 % incluse à la saisie atelier),
 *  inséré directement : le sujet est la recopie en facture, pas la machine à états de l'OR. */
async function orTermine(ttcCentimes: number): Promise<string> {
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
        `OR-TVA-${id.slice(0, 8)}`,
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
          designation, montant_ht_centimes, montant_tva_centimes, montant_ttc_centimes, taux_tva_pourmille)
       values ($1,$2,$3,1,'forfait','commandee','realisee','client','Forfait vidange',$4,$5,$6,81)`,
      [randomUUID(), tenant.id, id, ttcCentimes - tva, tva, ttcCentimes],
    );
    await c.query("set session_replication_role = 'origin'");
  } finally {
    c.release();
  }
  return id;
}

describe('OR facturé', () => {
  async function facturerOr(ttc: number) {
    const orId = await orTermine(ttc);
    return (await avec('A')).post(`/api/v1/ordres-reparation/${orId}/facturer-et-encaisser`, {
      paiement: { mode: 'carte' },
    });
  }

  it('garage non assujetti : lignes d’OR recopiées à 0 ‰, TVA 0, total CHF 108.01 inchangé', async () => {
    await fixerTenantA(false, null);
    const r = await facturerOr(10_801);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const id = (r.body as { donnees: { facture: { id: string } } }).donnees.facture.id;
    const doc = await bdd.poolSuperutilisateur.query(
      `select total_ht_centimes::int ht, total_tva_centimes::int tva, total_ttc_centimes::int ttc
         from document_vente where id = $1`,
      [id],
    );
    expect(doc.rows).toEqual([{ ht: 10_801, tva: 0, ttc: 10_801 }]);
    const lignes = await bdd.poolSuperutilisateur.query(
      'select regime_tva, taux_tva_pourmille, ht_centimes::int ht, tva_centimes::int tva, ttc_centimes::int ttc from ligne_document where document_id = $1',
      [id],
    );
    expect(lignes.rows).toEqual([
      { regime_tva: 'exclu', taux_tva_pourmille: 0, ht: 10_801, tva: 0, ttc: 10_801 },
    ]);
    const recap = await bdd.poolSuperutilisateur.query(
      'select regime_tva, taux_tva_pourmille, base_centimes::int base, tva_centimes::int tva from document_vente_tva where document_id = $1',
      [id],
    );
    expect(recap.rows).toEqual([
      { regime_tva: 'exclu', taux_tva_pourmille: 0, base: 10_801, tva: 0 },
    ]);
  }, 120_000);

  it('garage assujetti : inchangé, TVA 8.1 % extraite (10801 → HT 9992, TVA 809)', async () => {
    const r = await facturerOr(10_801);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const id = (r.body as { donnees: { facture: { id: string } } }).donnees.facture.id;
    const doc = await bdd.poolSuperutilisateur.query(
      `select total_ht_centimes::int ht, total_tva_centimes::int tva, total_ttc_centimes::int ttc
         from document_vente where id = $1`,
      [id],
    );
    // 10801 × 81 / 1081 = 809.3… → 809 (tva figée de la ligne d'OR), HT = 10801 − 809 = 9992.
    expect(doc.rows).toEqual([{ ht: 9_992, tva: 809, ttc: 10_801 }]);
  }, 120_000);
});
