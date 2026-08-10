/**
 * `POST /paiements` sur une facture soldée en TOTALITÉ par un avoir (`statut = 'annule_par_avoir'`,
 * RF-32) — défaut prouvé de bout en bout par un parcours navigateur (2026-08-10), jusqu'en base :
 *
 *   1. Facture `2026-00002` (CHF 60.00) créditée intégralement par un avoir émis →
 *      `statut: annule_par_avoir`.
 *   2. Le panneau Encaisser (front) proposait ENCORE cette facture, « reste dû CHF 60.00 ».
 *   3. `POST /paiements` avec une imputation dessus répondait `201 Created`.
 *   4. La facture portait ensuite `statutReglement: 'partiel'`, un vrai encaissement réconcilié
 *      contre une créance déjà éteinte — un encaissement imputé sur une créance éteinte en
 *      comptabilité suisse.
 *
 * Cause : ni le trigger `imputation_paiement_verifier_invariants` (MD-51, `0010_facturation.sql`
 * §11 — invariants de MONTANT seulement) ni `statut_reglement` (RF-68 : colonne délibérément
 * INDÉPENDANTE de `statut`, jamais fusionnée) ne s'opposaient à une imputation sur un document dont
 * le `statut` interdit tout règlement. RF-32 (`service-emission.ts` §6) met à jour
 * `statut`/`annule_par_avoir_id` mais NE TOUCHE JAMAIS `statut_reglement`/`solde_centimes`.
 *
 * Correctif : `verifierDocumentImputable` (`facturation/paiements/imputations.ts`), appelée par
 * `appliquerImputationsLettrage`/`appliquerCompensationAvance` juste après le chargement `for
 * update` du document — même famille de barrière applicative que `verifierCoherenceDevise`/
 * `verifierPaiementImputable` dans le même fichier.
 *
 * INTÉGRATION, sur une vraie Postgres éphémère (testcontainers), par le VRAI chemin HTTP
 * (`POST /documents-vente`, `.../emettre`, `.../avoirs`, `POST /paiements`) — même doctrine que
 * `emission-document.spec.ts` : un test qui simulerait `tx.execute`/un faux client de base ne
 * prouverait rien de la séquence réelle (RF-32 en base, trigger MD-51, verrou `for update`).
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

/** Facture unique CHF 60.00 TTC à 8.1% — même patron que `LIGNE_UNIQUE` de
 *  `emission-document.spec.ts`, montant choisi rond pour lire les assertions sans calcul mental. */
async function creerEtEmettreFacture(
  tenant: DonneesLot1Tenant,
  role: RoleUtilisateur,
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
          designation: 'Forfait diagnostic (test imputation sur facture annulée)',
          quantiteMillieme: 1000,
          prixUnitaireTtcCentimes: 6000,
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

/** Émet un avoir TOTAL sur `factureId` — SEULE l'émission (pas la création du brouillon) fait
 *  basculer la facture créditée à `annule_par_avoir` (RF-32, prouvé par `emission-document.spec.ts`
 *  §1 déjà). */
async function creerEtEmettreAvoirTotal(
  tenant: DonneesLot1Tenant,
  role: RoleUtilisateur,
  factureId: string,
): Promise<DocumentDeTest> {
  const cookie = await cookiePour(tenant, role);
  const creation = await ctx.requete
    .post(`/api/v1/documents-vente/${factureId}/avoirs`)
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
    .set('Cookie', cookie)
    .set(EN_TETE_IDEMPOTENCE, randomUUID())
    .send({ portee: 'total', motif: 'erreur_montant' });
  if (creation.status !== 201) {
    throw new Error(
      `création de l'avoir a échoué (${String(creation.status)}) : ${JSON.stringify(creation.body)}`,
    );
  }
  const avoirId = (creation.body as { donnees: DocumentDeTest }).donnees.id;

  const emis = await ctx.requete
    .post(`/api/v1/documents-vente/${avoirId}/emettre`)
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
    .set('Cookie', cookie)
    .set(EN_TETE_IDEMPOTENCE, randomUUID());
  if (emis.status !== 200) {
    throw new Error(
      `émission de l'avoir a échoué (${String(emis.status)}) : ${JSON.stringify(emis.body)}`,
    );
  }
  return (emis.body as { donnees: DocumentDeTest }).donnees;
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

describe('POST /paiements — refuse une imputation sur une facture annulée par avoir (correctif 2026-08-10)', () => {
  it('facture CHF 60.00 → avoir total émis (annule_par_avoir) → POST /paiements avec imputation dessus : 409 IMPUTATION_DOCUMENT_NON_REGLABLE, la facture reste non_regle/0/6000, AUCUNE imputation n’est écrite', async () => {
    const facture = await creerEtEmettreFacture(garage.tenantA, 'receptionnaire');
    expect(facture.totalTtcCentimes).toBe(6000);

    const avant = await lireDocument(garage.tenantA, 'receptionnaire', facture.id);
    expect(avant.statut).toBe('emis');

    const avoir = await creerEtEmettreAvoirTotal(garage.tenantA, 'receptionnaire', facture.id);
    expect(avoir.statut).toBe('emis');

    // RF-32 confirmé : la facture bascule annule_par_avoir, MAIS statutReglement/soldeCentimes
    // restent ceux D'AVANT l'annulation — exactement la reproduction du défaut de la tâche.
    const factureAnnulee = await lireDocument(garage.tenantA, 'receptionnaire', facture.id);
    expect(factureAnnulee.statut).toBe('annule_par_avoir');
    expect(factureAnnulee.statutReglement).toBe('non_regle');
    expect(factureAnnulee.montantRegleCentimes).toBe(0);
    expect(factureAnnulee.soldeCentimes).toBe(6000);

    // Séquence exacte de la tâche : POST /paiements avec une imputation de CHF 1.00 (100 ct) sur
    // la facture annulée.
    const cookie = await cookiePour(garage.tenantA, 'receptionnaire');
    const tentative = await ctx.requete
      .post('/api/v1/paiements')
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .set('Cookie', cookie)
      .set(EN_TETE_IDEMPOTENCE, randomUUID())
      .send({
        siteId: garage.tenantA.tenant.sites[0]!.id,
        dateValeur: '2026-08-10',
        moyen: 'especes',
        montantCentimes: 100,
        devise: 'CHF',
        payeurLibelle: 'Client comptoir (test régression)',
        imputations: [{ documentId: facture.id, montantCentimes: 100, nature: 'reglement' }],
      });

    expect(tentative.status).toBe(409);
    expect((tentative.body as { code?: string }).code).toBe('IMPUTATION_DOCUMENT_NON_REGLABLE');
    expect((tentative.body as { detail?: string }).detail).toMatch(
      new RegExp(`avoir_id=${avoir.id}`),
    );

    // État APRÈS le refus, pas seulement le code HTTP : la facture n'a PAS bougé — le défaut
    // prouvé par la tâche (`statutReglement: 'partiel'`, `montantRegleCentimes: 100`) ne doit
    // plus jamais se reproduire.
    const factureApresRefus = await lireDocument(garage.tenantA, 'receptionnaire', facture.id);
    expect(factureApresRefus.statutReglement).toBe('non_regle');
    expect(factureApresRefus.montantRegleCentimes).toBe(0);
    expect(factureApresRefus.soldeCentimes).toBe(6000);
  });

  /**
   * SECOND défaut du MÊME chemin, trouvé par CE test lui-même lors de sa première exécution
   * (rapporté par le coordinateur, 2026-08-10) : la barrière de `statut` ci-dessus laisse passer un
   * avoir ÉMIS — il porte `statut = 'emis'` comme n'importe quelle facture ouverte. Rien d'autre ne
   * s'y opposait : `POST /paiements` avec une imputation `reglement` visant DIRECTEMENT un avoir
   * répondait `201 Created`. Tranché par MD-57 (`docs/modele-documentaire-facturation.md` §4.3,
   * table des trois issues d'un trop-perçu) : « Ce qu'on ne fait **jamais** : créer un avoir pour
   * matérialiser un trop-perçu. **Un avoir corrige un document, pas un mouvement d'argent.** » —
   * `reglement`/`arrondi` sont, à la différence d'`escompte`/`perte`/`compensation`, les deux SEULES
   * natures où de l'argent circule RÉELLEMENT (MD-51). Corrigé par `verifierDocumentPasAvoir`
   * (`imputations.ts`), appelée UNIQUEMENT depuis `appliquerImputationsLettrage` — jamais depuis
   * `appliquerCompensationAvance`, voir le test suivant.
   */
  it("l'avoir lui-même (statut 'emis', document de crédit — pas une créance) refuse toute imputation `reglement` : 409 IMPUTATION_DOCUMENT_NON_REGLABLE, pas 201", async () => {
    const facture = await creerEtEmettreFacture(garage.tenantA, 'receptionnaire');
    const avoir = await creerEtEmettreAvoirTotal(garage.tenantA, 'receptionnaire', facture.id);

    const cookie = await cookiePour(garage.tenantA, 'receptionnaire');
    const tentative = await ctx.requete
      .post('/api/v1/paiements')
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .set('Cookie', cookie)
      .set(EN_TETE_IDEMPOTENCE, randomUUID())
      .send({
        siteId: garage.tenantA.tenant.sites[0]!.id,
        dateValeur: '2026-08-10',
        moyen: 'especes',
        montantCentimes: 100,
        devise: 'CHF',
        payeurLibelle: 'Client comptoir (test régression avoir)',
        imputations: [{ documentId: avoir.id, montantCentimes: 100, nature: 'reglement' }],
      });

    expect(tentative.status).toBe(409);
    expect((tentative.body as { code?: string }).code).toBe('IMPUTATION_DOCUMENT_NON_REGLABLE');
    expect((tentative.body as { detail?: string }).detail).toMatch(
      new RegExp(`document_id=${avoir.id};type_document=avoir`),
    );
  });

  /**
   * Non-régression : MD-57 prévoit exactement UNE issue légitime pour poser une imputation sur un
   * avoir — « abandon en faveur du garage » d'une avance client, nature `compensation`, via
   * `POST /paiements/{id}/abandonner` (RF-79 issue 3, motif + document de régularisation choisis
   * explicitement). `verifierDocumentPasAvoir` ne doit PAS bloquer ce chemin — seulement le lettrage
   * générique (`reglement`/`arrondi`). Rôle `direction` : `facturation.paiement.abandonner` est
   * réservé à `direction`/`comptable` (`DISPOSITION_AVANCE_PAIEMENT`, `matrice-droits.ts`),
   * `receptionnaire` ne l'a pas.
   */
  it("POST /paiements/{id}/abandonner (compensation) reste AUTORISÉ sur un avoir — c'est l'issue légitime de MD-57, distincte du lettrage générique refusé ci-dessus", async () => {
    const facture = await creerEtEmettreFacture(garage.tenantA, 'receptionnaire');
    const avoir = await creerEtEmettreAvoirTotal(garage.tenantA, 'receptionnaire', facture.id);

    // Une avance client non imputée (RF-65) : un paiement de CHF 20.00 sans imputation.
    const cookieReceptionnaire = await cookiePour(garage.tenantA, 'receptionnaire');
    const avance = await ctx.requete
      .post('/api/v1/paiements')
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .set('Cookie', cookieReceptionnaire)
      .set(EN_TETE_IDEMPOTENCE, randomUUID())
      .send({
        siteId: garage.tenantA.tenant.sites[0]!.id,
        dateValeur: '2026-08-10',
        moyen: 'virement',
        montantCentimes: 2000,
        devise: 'CHF',
        payeurLibelle: 'Client comptoir (avance à compenser)',
      });
    expect(avance.status).toBe(201);
    const paiementId = (avance.body as { donnees: { id: string } }).donnees.id;

    const cookieDirection = await cookiePour(garage.tenantA, 'direction');
    const abandon = await ctx.requete
      .post(`/api/v1/paiements/${paiementId}/abandonner`)
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .set('Cookie', cookieDirection)
      .set(EN_TETE_IDEMPOTENCE, randomUUID())
      .send({
        documentRegularisationId: avoir.id,
        montantCentimes: 2000,
        motif: 'Compensation avance contre avoir (test non-régression)',
      });

    // `@HttpCode(HttpStatus.OK)` sur cette route (`paiement.controller.ts`) — CONTRAIREMENT aux
    // trois créations de paiement (`POST /paiements`, `.../imputations`, `.../rembourser`, toutes
    // `201`), `abandonner` MODIFIE un paiement déjà existant (ajoute une imputation dessus), elle
    // n'en crée pas un nouveau : 200, pas 201.
    expect(abandon.status).toBe(200);
    expect(
      (
        abandon.body as { donnees: { imputations: readonly { nature: string }[] } }
      ).donnees.imputations.at(-1)?.nature,
    ).toBe('compensation');
  });
});
