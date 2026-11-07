/**
 * Encaissement en espèces d'un solde qui ne se paie pas exactement (pas de pièce de 1 ou 2 ct),
 * de bout en bout sur une vraie Postgres (trigger MD-51 compris) : le client remet le multiple de
 * 5 ct le plus proche, la facture passe `regle` avec un solde de 0, et AUCUN centime ne reste en
 * avance client. Arrondi vers le bas : `+1/+2` ; vers le haut : `-1/-2` (règlement = espèces remises).
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EN_TETE_IDEMPOTENCE, type RoleUtilisateur } from '@dfa/shared';

import { demarrerBaseEphemere, type BaseEphemere } from '../../setup/postgres-ephemere';
import {
  creerAppTest,
  demarrerRedisEphemere,
  type AppTest,
  type RedisEphemere,
} from '../../setup/app-test';
import { cookieDeSessionPour } from '../isolation-http-aide';
import {
  semerGarageDemoLot1,
  type DonneesLot1Tenant,
  type GarageDemoLot1Fixture,
} from '../fixtures/garage-demo-lot1';

let bdd: BaseEphemere;
let garage: GarageDemoLot1Fixture;
let redis: RedisEphemere;
let ctx: AppTest;

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  garage = await semerGarageDemoLot1(bdd);
  redis = await demarrerRedisEphemere();
  ctx = await creerAppTest(bdd, redis.url);
}, 180_000);

afterAll(async () => {
  await ctx?.fermer();
  await redis?.fermer();
  await bdd?.fermer();
});

const cacheCookiesParTenantEtRole = new Map<string, Promise<string>>();

async function cookiePour(tenant: DonneesLot1Tenant, role: RoleUtilisateur): Promise<string> {
  const cle = `${tenant.tenant.id}:${role}`;
  const dejaMemorise = cacheCookiesParTenantEtRole.get(cle);
  if (dejaMemorise) return dejaMemorise;

  const utilisateur = tenant.utilisateursParRole[role];
  const promesse = cookieDeSessionPour(ctx, utilisateur.email, utilisateur.motDePasseClair);
  cacheCookiesParTenantEtRole.set(cle, promesse);
  return promesse;
}

interface DocumentDeTest {
  readonly id: string;
  readonly statut: string;
  readonly numero: string | null;
  readonly totalTtcCentimes: number;
}

/** Facture unique de `totalCentimes` TTC à 8.1%. */
async function creerEtEmettreFacture(
  tenant: DonneesLot1Tenant,
  role: RoleUtilisateur,
  totalCentimes: number,
): Promise<DocumentDeTest> {
  const cookie = await cookiePour(tenant, role);
  const brouillon = await ctx.requete
    .post('/api/v1/documents-vente')
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
    .set('Cookie', cookie)
    .set(EN_TETE_IDEMPOTENCE, randomUUID())
    .send({
      typeDocument: 'facture',
      siteId: tenant.tenant.sites[0]!.id,
      clientId: tenant.clients[0]!.id,
      devise: 'CHF',
      lignes: [
        {
          type: 'forfait',
          designation: 'Forfait diagnostic (test arrondi espèces)',
          quantiteMillieme: 1000,
          prixUnitaireTtcCentimes: totalCentimes,
          tauxTvaPourmille: 81,
          datePrestation: '2026-07-29',
        },
      ],
    });
  if (brouillon.status !== 201) {
    throw new Error(
      `création brouillon facture a échoué (${String(brouillon.status)}) : ${JSON.stringify(brouillon.body)}`,
    );
  }
  const doc = brouillon.body.donnees as DocumentDeTest;

  const emise = await ctx.requete
    .post(`/api/v1/documents-vente/${doc.id}/emettre`)
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
    .set('Cookie', cookie)
    .set(EN_TETE_IDEMPOTENCE, randomUUID());
  if (emise.status !== 200) {
    throw new Error(
      `émission de la facture a échoué (${String(emise.status)}) : ${JSON.stringify(emise.body)}`,
    );
  }
  return (emise.body as { donnees: DocumentDeTest }).donnees;
}

async function lireDocument(tenant: DonneesLot1Tenant, role: RoleUtilisateur, documentId: string) {
  const cookie = await cookiePour(tenant, role);
  const reponse = await ctx.requete
    .get(`/api/v1/documents-vente/${documentId}`)
    .set('Cookie', cookie);
  if (reponse.status !== 200) {
    throw new Error(
      `lecture document ${documentId} a échoué (${String(reponse.status)}) : ${JSON.stringify(reponse.body)}`,
    );
  }
  return reponse.body as DocumentDeTest & {
    statutReglement: string;
    montantRegleCentimes: number;
    soldeCentimes: number;
  };
}

async function encaisserEspeces(solde: number, remis: number, arrondi: number, moyen = 'especes') {
  const facture = await creerEtEmettreFacture(garage.tenantA, 'receptionnaire', solde);
  const cookie = await cookiePour(garage.tenantA, 'receptionnaire');
  const reponse = await ctx.requete
    .post('/api/v1/paiements')
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
    .set('Cookie', cookie)
    .set(EN_TETE_IDEMPOTENCE, randomUUID())
    .send({
      siteId: garage.tenantA.tenant.sites[0]!.id,
      dateValeur: '2026-08-10',
      moyen,
      montantCentimes: remis,
      devise: 'CHF',
      payeurLibelle: 'Client comptoir (test arrondi)',
      imputations: [
        { documentId: facture.id, montantCentimes: remis, nature: 'reglement' },
        { documentId: facture.id, montantCentimes: arrondi, nature: 'arrondi' },
      ],
    });
  return { facture, reponse };
}

describe('POST /paiements — arrondi espèces au 5 centimes, dans les deux sens', () => {
  it.each([
    // solde, espèces remises, arrondi signé de l'imputation
    [10941, 10940, 1],
    [10942, 10940, 2],
    [10943, 10945, -2],
    [10944, 10945, -1],
    [10948, 10950, -2],
    [10949, 10950, -1],
  ])(
    'solde %i ct, espèces %i ct, arrondi %i ct : 201, facture regle / solde 0, aucune avance',
    async (solde, remis, arrondi) => {
      const { facture, reponse } = await encaisserEspeces(solde, remis, arrondi);
      expect(reponse.status, JSON.stringify(reponse.body)).toBe(201);

      const paiement = (
        reponse.body as {
          donnees: {
            montantCentimes: number;
            montantNonImputeCentimes: number;
            imputations: readonly { nature: string; montantCentimes: number }[];
          };
        }
      ).donnees;
      expect(paiement.montantCentimes).toBe(remis);
      expect(paiement.montantNonImputeCentimes).toBe(0);
      expect(
        paiement.imputations.filter((i) => i.nature === 'arrondi').map((i) => i.montantCentimes),
      ).toEqual([arrondi]);

      const apres = await lireDocument(garage.tenantA, 'receptionnaire', facture.id);
      expect(apres.statutReglement).toBe('regle');
      expect(apres.montantRegleCentimes).toBe(solde);
      expect(apres.soldeCentimes).toBe(0);
    },
  );

  it('refuse l’arrondi négatif en carte : 109.45 en carte sur 109.44 reste impossible, facture inchangée', async () => {
    const { facture, reponse } = await encaisserEspeces(10944, 10945, -1, 'carte');
    expect(reponse.status).toBe(400);
    const apres = await lireDocument(garage.tenantA, 'receptionnaire', facture.id);
    expect(apres.statutReglement).toBe('non_regle');
    expect(apres.soldeCentimes).toBe(10944);
  });

  it('refuse 109.46 en espèces avec arrondi -2 sur 109.44 (pas un multiple de 5 ct)', async () => {
    const { facture, reponse } = await encaisserEspeces(10944, 10946, -2);
    expect(reponse.status).toBe(400);
    const apres = await lireDocument(garage.tenantA, 'receptionnaire', facture.id);
    expect(apres.soldeCentimes).toBe(10944);
  });
});
