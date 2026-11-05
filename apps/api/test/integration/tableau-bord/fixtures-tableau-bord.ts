/**
 * Fixtures locales au module Tableau de bord (`apps/api/src/tableau-bord/`) — PAS un ajout à
 * `test/lot1/fixtures/garage-demo-lot1.ts` (périmètre d'un autre lot, seulement LU ici, jamais
 * modifié) : ce fichier construit, par-dessus `semerGarageDemoLot1`, exactement ce que les tests
 * du tableau de bord ont besoin de créer eux-mêmes — des documents de vente ÉMIS à montant connu,
 * des paiements à montant connu, et (pour la matrice de droits) le seul rôle que la fixture lot 1
 * ne fournit pas : `poste_atelier`, le compte de SERVICE de la borne d'atelier.
 *
 * TOUT PASSE PAR LA VRAIE API HTTP (POST /documents-vente, .../emettre, .../avoirs, POST
 * /paiements, .../rembourser) — jamais un INSERT direct dans `document_vente`/`paiement` : cette
 * table est verrouillée par triggers (numérotation légale, calcul TVA, QR-facture, verrouillage
 * post-émission) qu'un INSERT à la main ne pourrait pas reproduire honnêtement (voir le même
 * choix, motivé en détail, dans `test/lot1/facturation/emission-document.spec.ts`).
 *
 * ARITHMÉTIQUE : chaque document de test est composé exclusivement de copies d'UNE SEULE ligne
 * primitive connue — forfait à 7'000 c. TTC, taux 8.1 % (81 ‰), quantité 1 — dont le HT/TVA exacts
 * ont été calculés UNE FOIS, hors de ce fichier, en reproduisant fidèlement `arrondiCommercial`
 * (`facturation/documents/calcul-document.ts`, formule MD-40 : demi éloigné de zéro, arithmétique
 * bigint) :
 *
 *   tva = arrondiCommercial(7000 × 81, 1000 + 81) = arrondiCommercial(567000, 1081) = 525
 *   ht  = 7000 − 525 = 6475
 *
 * Valeur DÉJÀ prouvée ailleurs dans ce dépôt (même cas, appelé « CF-13 ») : `calcul-document.spec.ts`
 * et `test/lot1/facturation/emission-document.spec.ts` (`LIGNE_UNIQUE`) arrivent au même couple
 * (6475, 525). Composer un document de N copies de cette ligne donne des totaux EXACTS par simple
 * multiplication (N×6475, N×525, N×7000) — la TVA est arrondie PAR LIGNE puis les lignes sont
 * SOMMÉES telles quelles (jamais recalculée sur le total, `document_vente_totaux_coherents_chk`),
 * donc AUCUNE seconde source d'arrondi n'intervient entre "ligne" et "somme de N lignes
 * identiques". Ne JAMAIS remplacer N copies de cette ligne par UNE SEULE ligne de montant N×7000 :
 * l'arrondi par ligne donnerait alors une TVA différente (vérifié : une ligne unique à 14'000 c.
 * TTC/81‰ arrondit à 1'049 c. de TVA, pas 1'050 — l'écart typique d'un arrondi ligne par ligne).
 */

import { randomUUID } from 'node:crypto';
import { hash as hacherArgon2 } from '@node-rs/argon2';
import { EN_TETE_IDEMPOTENCE, type RoleUtilisateur } from '@dfa/shared';

import type { BaseEphemere } from '../../setup/postgres-ephemere';
import type { AppTest } from '../../setup/app-test';
import { cookieDeSessionPour } from '../../lot1/isolation-http-aide';
import type { DonneesLot1Tenant } from '../../lot1/fixtures/garage-demo-lot1';

// -------------------------------------------------------------------------------------------
// 1. Ligne primitive — voir le calcul exact en tête de fichier.
// -------------------------------------------------------------------------------------------

export const PRIMITIVE_TTC = 7000;
export const PRIMITIVE_TVA = 525;
export const PRIMITIVE_HT = 6475;

interface LigneCreationTest {
  readonly type: string;
  readonly designation: string;
  readonly quantiteMillieme: number;
  readonly prixUnitaireTtcCentimes: number;
  readonly tauxTvaPourmille: number;
  readonly datePrestation: string;
}

/** `n` copies de la ligne primitive (7'000 c. TTC / 81‰) — totaux exacts = n×6475 / n×525 / n×7000
 *  (voir la démonstration en tête de fichier). `datePrestation` recopie `dateDocument` par défaut :
 *  aucune contrainte ne les lie, mais un décalage n'aurait aucun sens métier pour ces fixtures. */
export function lignesPrimitives(n: number, dateDocument: string): readonly LigneCreationTest[] {
  return Array.from({ length: n }, (_, i) => ({
    type: 'forfait',
    designation: `Prestation de test tableau-bord #${String(i + 1)}`,
    quantiteMillieme: 1000,
    prixUnitaireTtcCentimes: PRIMITIVE_TTC,
    tauxTvaPourmille: 81,
    datePrestation: dateDocument,
  }));
}

// -------------------------------------------------------------------------------------------
// 2. Cookies — cache par (tenant, rôle), même patron que emission-document.spec.ts : évite
//    d'épuiser le budget anti-brute-force par IP (POST /auth/connexion) sur un fichier qui
//    ouvre beaucoup de sessions différentes.
// -------------------------------------------------------------------------------------------

export function construireCookiePour(
  ctx: AppTest,
): (tenant: DonneesLot1Tenant, role: RoleUtilisateur) => Promise<string> {
  const cache = new Map<string, Promise<string>>();
  return (tenant: DonneesLot1Tenant, role: RoleUtilisateur): Promise<string> => {
    const cle = `${tenant.tenant.id}:${role}`;
    const dejaMemorise = cache.get(cle);
    if (dejaMemorise) return dejaMemorise;
    const utilisateur = tenant.utilisateursParRole[role];
    const promesse = cookieDeSessionPour(ctx, utilisateur.email, utilisateur.motDePasseClair);
    cache.set(cle, promesse);
    return promesse;
  };
}

// -------------------------------------------------------------------------------------------
// 3. `poste_atelier` — compte de SERVICE (borne d'atelier), absent de la fixture lot 1
//    (`ROLES_PERSONNE` seulement). Même patron d'insertion que `ajouterUtilisateurFixture`
//    (`test/fixtures/garage-demo.ts`, LU pour référence, pas importé — écrit ici en toute
//    autonomie pour ne dépendre d'aucune fonction non exportée), et mêmes valeurs de convention
//    que le seed réel (`db/seed/seed-dev.ts` : prénom "Borne", nom "Atelier <site>") — un compte
//    de service reste une ligne `utilisateur` ordinaire (`utilisateur_site_compte_de_service_chk`,
//    migration 0039), authentifiable par le VRAI `POST /auth/connexion` comme n'importe quel
//    rôle : aucun mécanisme d'auth séparé à simuler.
// -------------------------------------------------------------------------------------------

const MOT_DE_PASSE_POSTE_ATELIER = 'BorneAtelierTest!77';

export interface PosteAtelierDeTest {
  readonly id: string;
  readonly email: string;
  readonly motDePasseClair: string;
}

export async function creerPosteAtelierPourTest(
  bdd: BaseEphemere,
  tenantId: string,
  siteId: string,
  emailSuffixe: string,
): Promise<PosteAtelierDeTest> {
  const motDePasseHash = await hacherArgon2(MOT_DE_PASSE_POSTE_ATELIER, { algorithm: 2 });
  const id = randomUUID();
  const email = `borne.tableau-bord.${emailSuffixe}@test.local`;
  await bdd.poolSuperutilisateur.query(
    `insert into utilisateur
       (id, tenant_id, email, mot_de_passe_hash, prenom, nom, langue, role, statut,
        echecs_connexion, verrouille_jusqu_a, site_id)
     values ($1, $2, $3, $4, 'Borne', 'Atelier (test)', 'fr', 'poste_atelier', 'actif', 0, null, $5)`,
    [id, tenantId, email, motDePasseHash, siteId],
  );
  return { id, email, motDePasseClair: MOT_DE_PASSE_POSTE_ATELIER };
}

// -------------------------------------------------------------------------------------------
// 4. Documents de vente — brouillon / émission / avoir, par la vraie API HTTP.
// -------------------------------------------------------------------------------------------

export interface DocumentEmisDeTest {
  readonly id: string;
  readonly statut: string;
  readonly numero: string;
  readonly totalHtCentimes: number;
  readonly totalTvaCentimes: number;
  readonly totalTtcCentimes: number;
}

async function creerBrouillonDocument(
  ctx: AppTest,
  cookie: string,
  entree: {
    readonly typeDocument: 'devis' | 'bon_commande' | 'facture';
    readonly siteId: string;
    readonly clientId: string;
    readonly dateDocument: string;
    readonly lignes: readonly LigneCreationTest[];
  },
): Promise<{ id: string }> {
  const reponse = await ctx.requete
    .post('/api/v1/documents-vente')
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
    .set('Cookie', cookie)
    .set(EN_TETE_IDEMPOTENCE, randomUUID())
    .send({ devise: 'CHF', ...entree });
  if (reponse.status !== 201) {
    throw new Error(
      `fixture tableau-bord : création brouillon ${entree.typeDocument} a échoué (${String(reponse.status)}) : ${JSON.stringify(reponse.body)}`,
    );
  }
  return (reponse.body as { donnees: { id: string } }).donnees;
}

async function emettreDocument(
  ctx: AppTest,
  cookie: string,
  documentId: string,
): Promise<DocumentEmisDeTest> {
  const reponse = await ctx.requete
    .post(`/api/v1/documents-vente/${documentId}/emettre`)
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
    .set('Cookie', cookie)
    .set(EN_TETE_IDEMPOTENCE, randomUUID());
  if (reponse.status !== 200) {
    throw new Error(
      `fixture tableau-bord : émission du document ${documentId} a échoué (${String(reponse.status)}) : ${JSON.stringify(reponse.body)}`,
    );
  }
  return (reponse.body as { donnees: DocumentEmisDeTest }).donnees;
}

/** Crée un brouillon FACTURE (n copies de la ligne primitive) puis l'émet — retourne le document
 *  ÉMIS (numéro légal attribué, totaux figés en base). `role` doit détenir
 *  `facturation.document.creer` ET `facturation.document.emettre_facture` — `receptionnaire`
 *  convient (même rôle que `test/lot1/facturation/emission-document.spec.ts`). */
export async function creerFactureEmisePourTest(
  ctx: AppTest,
  tenant: DonneesLot1Tenant,
  role: RoleUtilisateur,
  cookiePour: (tenant: DonneesLot1Tenant, role: RoleUtilisateur) => Promise<string>,
  params: {
    readonly siteId: string;
    readonly clientId: string;
    readonly dateDocument: string;
    readonly nombreLignesPrimitives: number;
  },
): Promise<DocumentEmisDeTest> {
  const cookie = await cookiePour(tenant, role);
  const brouillon = await creerBrouillonDocument(ctx, cookie, {
    typeDocument: 'facture',
    siteId: params.siteId,
    clientId: params.clientId,
    dateDocument: params.dateDocument,
    lignes: lignesPrimitives(params.nombreLignesPrimitives, params.dateDocument),
  });
  return emettreDocument(ctx, cookie, brouillon.id);
}

/** Crée un brouillon FACTURE sans jamais l'émettre — pour prouver qu'un brouillon ne compte dans
 *  aucun agrégat du tableau de bord. */
export async function creerFactureBrouillonPourTest(
  ctx: AppTest,
  tenant: DonneesLot1Tenant,
  role: RoleUtilisateur,
  cookiePour: (tenant: DonneesLot1Tenant, role: RoleUtilisateur) => Promise<string>,
  params: {
    readonly siteId: string;
    readonly clientId: string;
    readonly dateDocument: string;
    readonly nombreLignesPrimitives: number;
  },
): Promise<{ id: string }> {
  const cookie = await cookiePour(tenant, role);
  return creerBrouillonDocument(ctx, cookie, {
    typeDocument: 'facture',
    siteId: params.siteId,
    clientId: params.clientId,
    dateDocument: params.dateDocument,
    lignes: lignesPrimitives(params.nombreLignesPrimitives, params.dateDocument),
  });
}

/** Crée un AVOIR TOTAL sur une facture déjà ÉMISE, et l'émet — `dateDocument` de l'avoir n'est
 *  JAMAIS paramétrable (`service-avoir.ts` la fige à `maintenant()`, la date réelle du serveur au
 *  moment de l'appel) : tout test qui l'utilise doit interroger le tableau de bord sur la période
 *  PAR DÉFAUT (mois civil courant), jamais sur une fenêtre `du`/`au` fixée dans le passé/futur. */
export async function creerAvoirTotalPourTest(
  ctx: AppTest,
  tenant: DonneesLot1Tenant,
  role: RoleUtilisateur,
  cookiePour: (tenant: DonneesLot1Tenant, role: RoleUtilisateur) => Promise<string>,
  factureId: string,
): Promise<DocumentEmisDeTest> {
  const cookie = await cookiePour(tenant, role);
  const reponse = await ctx.requete
    .post(`/api/v1/documents-vente/${factureId}/avoirs`)
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
    .set('Cookie', cookie)
    .set(EN_TETE_IDEMPOTENCE, randomUUID())
    .send({ portee: 'total', motif: 'erreur_montant' });
  if (reponse.status !== 201) {
    throw new Error(
      `fixture tableau-bord : création de l'avoir sur ${factureId} a échoué (${String(reponse.status)}) : ${JSON.stringify(reponse.body)}`,
    );
  }
  const brouillonAvoir = (reponse.body as { donnees: { id: string } }).donnees;
  return emettreDocument(ctx, cookie, brouillonAvoir.id);
}

// -------------------------------------------------------------------------------------------
// 5. Paiements — par la vraie API HTTP (`POST /paiements`, `.../rembourser`).
// -------------------------------------------------------------------------------------------

export interface PaiementDeTest {
  readonly id: string;
  readonly montantCentimes: number;
  readonly montantNonImputeCentimes: number;
}

export async function creerPaiementPourTest(
  ctx: AppTest,
  tenant: DonneesLot1Tenant,
  role: RoleUtilisateur,
  cookiePour: (tenant: DonneesLot1Tenant, role: RoleUtilisateur) => Promise<string>,
  params: {
    readonly siteId: string;
    readonly dateValeur: string;
    readonly montantCentimes: number;
    readonly payeurLibelle: string;
    readonly imputations?: readonly {
      readonly documentId: string;
      readonly montantCentimes: number;
      readonly nature?: string;
    }[];
  },
): Promise<PaiementDeTest> {
  const cookie = await cookiePour(tenant, role);
  const reponse = await ctx.requete
    .post('/api/v1/paiements')
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
    .set('Cookie', cookie)
    .set(EN_TETE_IDEMPOTENCE, randomUUID())
    .send({
      siteId: params.siteId,
      dateValeur: params.dateValeur,
      moyen: 'virement',
      montantCentimes: params.montantCentimes,
      devise: 'CHF',
      payeurLibelle: params.payeurLibelle,
      imputations: params.imputations ?? [],
    });
  if (reponse.status !== 201) {
    throw new Error(
      `fixture tableau-bord : création paiement a échoué (${String(reponse.status)}) : ${JSON.stringify(reponse.body)}`,
    );
  }
  return (reponse.body as { donnees: PaiementDeTest }).donnees;
}

/** `dateValeur` du remboursement n'est PAS paramétrable (`service-paiement.ts` la fige à
 *  `horloge.maintenant()`, même contrainte que l'avoir ci-dessus) — interroger le tableau de bord
 *  sur la période par défaut pour tout test qui l'utilise. */
export async function rembourserPaiementPourTest(
  ctx: AppTest,
  tenant: DonneesLot1Tenant,
  role: RoleUtilisateur,
  cookiePour: (tenant: DonneesLot1Tenant, role: RoleUtilisateur) => Promise<string>,
  paiementId: string,
  montantCentimes: number,
): Promise<PaiementDeTest> {
  const cookie = await cookiePour(tenant, role);
  const reponse = await ctx.requete
    .post(`/api/v1/paiements/${paiementId}/rembourser`)
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
    .set('Cookie', cookie)
    .set(EN_TETE_IDEMPOTENCE, randomUUID())
    .send({ montantCentimes, referenceVirement: 'Remboursement de test tableau-bord' });
  if (reponse.status !== 201) {
    throw new Error(
      `fixture tableau-bord : remboursement du paiement ${paiementId} a échoué (${String(reponse.status)}) : ${JSON.stringify(reponse.body)}`,
    );
  }
  return (reponse.body as { donnees: PaiementDeTest }).donnees;
}

// -------------------------------------------------------------------------------------------
// 6. Appels GET du tableau de bord lui-même.
// -------------------------------------------------------------------------------------------

export function getFinancier(ctx: AppTest, cookie: string, query: Record<string, string> = {}) {
  return ctx.requete.get('/api/v1/tableau-bord/financier').query(query).set('Cookie', cookie);
}

export function getActivite(ctx: AppTest, cookie: string, query: Record<string, string> = {}) {
  return ctx.requete.get('/api/v1/tableau-bord/activite').query(query).set('Cookie', cookie);
}
