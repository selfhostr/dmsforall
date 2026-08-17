/**
 * Fixtures locales au module Relances (`apps/api/src/relances/`) — construites PAR-DESSUS
 * `semerGarageDemoLot1` (site/client/rôles déjà en place, lus ici, jamais dupliqués), même
 * doctrine que `test/integration/tableau-bord/fixtures-tableau-bord.ts` et
 * `test/integration/ventes/fixtures-cycle-vente.ts` (lus pour le PATRON, jamais importés :
 * périmètre d'écriture disjoint, CONTRIBUTING.md).
 *
 * TOUT PASSE PAR LA VRAIE API HTTP pour les tables verrouillées par triggers (`document_vente`,
 * `paiement`, `client_condition`) — jamais un INSERT direct : mêmes triggers de numérotation
 * légale, calcul TVA, verrouillage post-émission que documentés dans les fixtures ci-dessus.
 *
 * DEUX EXCEPTIONS ASSUMÉES, en lecture/écriture DIRECTE sur `relance_planifiee`/`client` via
 * `requeteSousTenant`/`ecrireSousTenant` (pool `dfa_app`, SOUS RLS — jamais `poolSuperutilisateur`) :
 *
 *  1. LECTURE de `relance_planifiee` — aucune route HTTP ne liste les lignes individuelles (seuls
 *     `POST .../planifier` et `.../envoyer` existent, et ne rendent que des COMPTEURS agrégés, §5
 *     de `docs/specification-relances-automatiques.md` : « au plus 9 lignes … aucune pagination »
 *     pour `regle_relance`, rien d'équivalent pour `relance_planifiee`). Une lecture directe,
 *     SCOPÉE tenant par le même mécanisme RLS qu'un contrôleur réel, est la seule façon de vérifier
 *     un palier/statut/raison_annulation précis plutôt que de rester sur des compteurs agrégés —
 *     complément aux assertions en DELTA sur les réponses HTTP, jamais un substitut.
 *  2. ÉCRITURE de `client.plus_aucun_contact`/`motif` (RA-14) — AUCUNE route HTTP n'existe pour ces
 *     deux colonnes (`0045_relances_socle.sql`, §D de son en-tête : « SIGNALÉ, PAS FAIT ICI » —
 *     `clients/client.controller.ts` n'a jamais été mis à jour pour les exposer). Un `UPDATE`
 *     ordinaire sur deux colonnes SANS trigger de verrouillage (contrairement à `document_vente`/
 *     `paiement`) n'est pas la même chose que contourner une machine à états : rien à reproduire
 *     malhonnêtement ici, juste une donnée que l'API ne sait pas encore écrire.
 *
 * ARITHMÉTIQUE : une seule ligne primitive connue, réutilisée SANS variation — le contenu HT/TVA
 * exact n'a aucune importance pour ce module (les relances ne recalculent jamais un montant, elles
 * lisent `total_ttc_centimes`/`solde_centimes` tels quels) ; les valeurs sont reprises telles
 * quelles de `fixtures-tableau-bord.ts`/`fixtures-cycle-vente.ts` (même cas, déjà démontré exact
 * ailleurs, « CF-13 ») pour rester cohérent avec le reste du dépôt plutôt que par nécessité propre
 * à ce fichier.
 *
 * DATES : `joursAvant(n)` calcule TOUJOURS depuis l'horloge RÉELLE du process de test (`new
 * Date()`) — `ServiceRelancesFacture` lit `Horloge.maintenant()` (`common/horloge/horloge.ts`),
 * qui N'EST PAS surchargeable en test (voir `AppTest.horloge`, qui est un objet DISTINCT réservé à
 * l'expiration de session — voir son en-tête). Aucune date absolue codée en dur : un test qui
 * écrirait `dateEcheance: '2026-01-01'` romprait le jour où il tournerait après cette date.
 *
 * Périmètre d'écriture : `apps/api/test/**` uniquement (CONTRIBUTING.md, brief de cette tâche).
 */

import { randomUUID } from 'node:crypto';
import { hash as hacherArgon2 } from '@node-rs/argon2';
import type { PoolClient } from 'pg';
import { EN_TETE_IDEMPOTENCE, type RoleUtilisateur } from '@dfa/shared';

import {
  ecrireSousTenant,
  requeteSousTenant,
  type BaseEphemere,
} from '../../setup/postgres-ephemere';
import type { AppTest } from '../../setup/app-test';
import { cookieDeSessionPour } from '../../lot1/isolation-http-aide';
import type { DonneesLot1Tenant } from '../../lot1/fixtures/garage-demo-lot1';

// -------------------------------------------------------------------------------------------
// 1. Dates — toujours relatives à l'horloge réelle du process (voir l'en-tête).
// -------------------------------------------------------------------------------------------

/** `YYYY-MM-DD`, `n` jours avant AUJOURD'HUI (horloge réelle, UTC — même base que
 *  `calculerDateEcheance`/`calculerPaliersDus`, `relances/regles-planification.ts`). `n` négatif
 *  rend une date dans le FUTUR (utile pour construire une échéance pas-encore-due). */
export function joursAvant(n: number): string {
  const base = new Date();
  base.setUTCDate(base.getUTCDate() - n);
  return base.toISOString().slice(0, 10);
}

/** `dateIso` (`YYYY-MM-DD`) + `n` jours calendaires — même formule que `calculerPaliersDus`
 *  (`relances/regles-planification.ts` : `dateEcheance.getTime() + jours * 86 400 000`), pour
 *  vérifier une `echeance_prevue` EXACTE plutôt qu'un simple comptage de lignes. */
export function ajouterJours(dateIso: string, n: number): string {
  const base = new Date(`${dateIso}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + n);
  return base.toISOString().slice(0, 10);
}

// -------------------------------------------------------------------------------------------
// 2. Cookies — cache par (tenant, rôle), même patron que `fixtures-tableau-bord.ts`.
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

type CookiePour = (tenant: DonneesLot1Tenant, role: RoleUtilisateur) => Promise<string>;

// -------------------------------------------------------------------------------------------
// 3. Conditions commerciales du client — `delaiPaiementJours` FIGÉ à l'émission (§ `echeance.ts`),
//    condition SINE QUA NON pour obtenir une `dateEcheance` non nulle. `delaiPaiementJours: 0`
//    (« payable à réception ») rend `dateEcheance === dateDocument`, la forme la plus simple à
//    piloter depuis un test : une seule variable (`dateDocument`) contrôle l'échéance entière.
//    `valideDuLe` loin dans le passé, `valideAuLe: null` (ouverte) : couvre toute date de test.
//    Appelée UNE SEULE FOIS par client (une deuxième période sur le même client produirait un
//    chevauchement `400 VALIDATION_ECHOUEE`, `ClientConditionController` — voir son en-tête).
// -------------------------------------------------------------------------------------------

export async function configurerDelaiPaiementImmediatPourTest(
  ctx: AppTest,
  tenant: DonneesLot1Tenant,
  cookiePour: CookiePour,
  clientId: string,
): Promise<void> {
  const cookie = await cookiePour(tenant, 'direction');
  const reponse = await ctx.requete
    .post(`/api/v1/clients/${clientId}/conditions`)
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
    .set('Cookie', cookie)
    .send({
      rabaisMoPourmille: 0,
      rabaisPiecesPourmille: 0,
      rabaisPneusPourmille: 0,
      delaiPaiementJours: 0,
      valideDuLe: '2000-01-01',
      valideAuLe: null,
    });
  if (reponse.status !== 201) {
    throw new Error(
      `fixture relances : condition client ${clientId} a échoué (${String(reponse.status)}) : ` +
        JSON.stringify(reponse.body),
    );
  }
}

// -------------------------------------------------------------------------------------------
// 4. Documents de vente — facture émise, à échéance contrôlée par `dateDocument`.
// -------------------------------------------------------------------------------------------

export const PRIMITIVE_TTC = 7000;

export interface FactureEcheeDeTest {
  readonly id: string;
  readonly numero: string;
  readonly statut: string;
  readonly dateEcheance: string | null;
  readonly totalTtcCentimes: number;
  readonly soldeCentimes: number;
}

async function requeteJson(
  ctx: AppTest,
  cookie: string,
  methode: 'post',
  chemin: string,
  corps?: Record<string, unknown>,
): Promise<{ readonly status: number; readonly body: Record<string, unknown> }> {
  const req = ctx.requete[methode](chemin)
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
    .set('Cookie', cookie)
    .set(EN_TETE_IDEMPOTENCE, randomUUID());
  const reponse = corps === undefined ? await req : await req.send(corps);
  return { status: reponse.status, body: reponse.body as Record<string, unknown> };
}

/** Crée un brouillon FACTURE (une ligne, montant primitif) puis l'émet immédiatement — le client
 *  DOIT déjà avoir une condition `delaiPaiementJours` figée (voir ci-dessus), sans quoi
 *  `dateEcheance` sort `null` et le document n'a plus aucune prise sur le test. `role` doit détenir
 *  `facturation.document.creer` + `.emettre_facture` — `direction` convient toujours. */
export async function creerFactureEmisePourTest(
  ctx: AppTest,
  tenant: DonneesLot1Tenant,
  cookiePour: CookiePour,
  params: {
    readonly siteId: string;
    readonly clientId: string;
    readonly dateDocument: string;
    readonly role?: RoleUtilisateur;
  },
): Promise<FactureEcheeDeTest> {
  const cookie = await cookiePour(tenant, params.role ?? 'direction');
  const brouillon = await requeteJson(ctx, cookie, 'post', '/api/v1/documents-vente', {
    typeDocument: 'facture',
    devise: 'CHF',
    siteId: params.siteId,
    clientId: params.clientId,
    dateDocument: params.dateDocument,
    lignes: [
      {
        type: 'forfait',
        designation: 'Prestation de test relances',
        quantiteMillieme: 1000,
        prixUnitaireTtcCentimes: PRIMITIVE_TTC,
        tauxTvaPourmille: 81,
        datePrestation: params.dateDocument,
      },
    ],
  });
  if (brouillon.status !== 201) {
    throw new Error(
      `fixture relances : brouillon facture a échoué (${String(brouillon.status)}) : ` +
        JSON.stringify(brouillon.body),
    );
  }
  const idBrouillon = (brouillon.body as { donnees: { id: string } }).donnees.id;

  const emission = await requeteJson(
    ctx,
    cookie,
    'post',
    `/api/v1/documents-vente/${idBrouillon}/emettre`,
  );
  if (emission.status !== 200) {
    throw new Error(
      `fixture relances : émission facture a échoué (${String(emission.status)}) : ` +
        JSON.stringify(emission.body),
    );
  }
  const d = (emission.body as { donnees: Record<string, unknown> }).donnees;
  return {
    id: d.id as string,
    numero: d.numero as string,
    statut: d.statut as string,
    dateEcheance: (d.dateEcheance as string | null) ?? null,
    totalTtcCentimes: d.totalTtcCentimes as number,
    soldeCentimes: d.soldeCentimes as number,
  };
}

/** Avoir TOTAL sur une facture déjà ÉMISE, émis dans la foulée — fait basculer la facture créditée
 *  à `annule_par_avoir` (RF-32, voir `service-emission.ts`). `dateDocument` de l'avoir n'est PAS
 *  paramétrable (figée à `maintenant()` côté serveur) : sans incidence ici, `planifier()` filtre
 *  sur le STATUT de la facture créditée, jamais sur la date de l'avoir. */
export async function creerAvoirTotalPourTest(
  ctx: AppTest,
  tenant: DonneesLot1Tenant,
  cookiePour: CookiePour,
  factureId: string,
): Promise<void> {
  const cookie = await cookiePour(tenant, 'direction');
  const brouillon = await requeteJson(
    ctx,
    cookie,
    'post',
    `/api/v1/documents-vente/${factureId}/avoirs`,
    { portee: 'total', motif: 'erreur_montant' },
  );
  if (brouillon.status !== 201) {
    throw new Error(
      `fixture relances : brouillon avoir sur ${factureId} a échoué (${String(brouillon.status)}) : ` +
        JSON.stringify(brouillon.body),
    );
  }
  const idAvoir = (brouillon.body as { donnees: { id: string } }).donnees.id;
  const emission = await requeteJson(
    ctx,
    cookie,
    'post',
    `/api/v1/documents-vente/${idAvoir}/emettre`,
  );
  if (emission.status !== 200) {
    throw new Error(
      `fixture relances : émission avoir sur ${factureId} a échoué (${String(emission.status)}) : ` +
        JSON.stringify(emission.body),
    );
  }
}

/** Règle un solde de facture INTÉGRALEMENT (`statut_reglement` → `regle`) via un paiement imputé
 *  en une fois — même montant que le total de la facture primitive (`PRIMITIVE_TTC`). */
export async function reglerFactureIntegralementPourTest(
  ctx: AppTest,
  tenant: DonneesLot1Tenant,
  cookiePour: CookiePour,
  params: { readonly siteId: string; readonly factureId: string; readonly montantCentimes: number },
): Promise<void> {
  const cookie = await cookiePour(tenant, 'direction');
  const reponse = await requeteJson(ctx, cookie, 'post', '/api/v1/paiements', {
    siteId: params.siteId,
    dateValeur: new Date().toISOString().slice(0, 10),
    moyen: 'virement',
    montantCentimes: params.montantCentimes,
    devise: 'CHF',
    payeurLibelle: 'Client de test relances',
    imputations: [
      {
        documentId: params.factureId,
        montantCentimes: params.montantCentimes,
        nature: 'reglement',
      },
    ],
  });
  if (reponse.status !== 201) {
    throw new Error(
      `fixture relances : règlement de ${params.factureId} a échoué (${String(reponse.status)}) : ` +
        JSON.stringify(reponse.body),
    );
  }
}

/**
 * Simule une facture ÉMISE AVANT le correctif #17 (`0046_ligne_or_types_sans_temps_et_delai_paiement_tenant.sql`,
 * `tenant.delai_paiement_jours_defaut`) — une ligne dont `date_echeance` est restée `null` en base,
 * exactement comme une facture historique déjà chez un garage en production.
 *
 * POURQUOI PAS `creerFactureEmisePourTest` AVEC UN CLIENT SANS CONDITIONS (l'ancienne méthode) :
 * depuis le correctif #17, `calculerDateEcheance` retombe sur `tenant.delai_paiement_jours_defaut`
 * (30 jours) quand le client n'a aucune condition en vigueur — AUCUNE facture NOUVELLEMENT émise ne
 * peut donc plus sortir sans échéance. Passer par ce chemin ne construit plus le cas visé, il
 * construit une facture normale à échéance à 30 jours ; le test mentirait sur ce qu'il prouve.
 *
 * CONSTRUCTION : émission RÉELLE via l'API (mêmes triggers de numérotation/TVA/verrouillage que
 * n'importe quelle facture), puis UNE SEULE colonne (`date_echeance`) est ramenée à `null` par
 * écriture SQL directe — `session_replication_role = replica`, posé en `SET LOCAL` (donc scopé À
 * LA TRANSACTION, jamais `SET SESSION` : la connexion revient ensuite au pool, un réglage qui y
 * survivrait contaminerait silencieusement un autre test la réutilisant plus tard) — seul moyen de
 * contourner `document_vente_verrouiller_apres_emission` (MD-20, `0010_facturation.sql`), dont la
 * liste blanche n'inclut PAS `date_echeance` et NE DOIT PAS l'inclure : une facture émise
 * aujourd'hui ne doit jamais pouvoir perdre son échéance par la voie applicative normale. Exige
 * `poolSuperutilisateur` : `session_replication_role` n'est réglable que par un rôle superutilisateur,
 * jamais par `dfa_app` (RLS).
 */
export async function simulerFactureHeritageSansEcheancePourTest(
  ctx: AppTest,
  bdd: BaseEphemere,
  tenant: DonneesLot1Tenant,
  cookiePour: CookiePour,
  params: { readonly siteId: string; readonly clientId: string; readonly dateDocument: string },
): Promise<FactureEcheeDeTest> {
  const facture = await creerFactureEmisePourTest(ctx, tenant, cookiePour, params);
  const client = await bdd.poolSuperutilisateur.connect();
  try {
    await client.query('begin');
    await client.query('set local session_replication_role = replica');
    await client.query(
      `update public.document_vente set date_echeance = null where tenant_id = $1 and id = $2`,
      [tenant.tenant.id, facture.id],
    );
    await client.query('commit');
  } catch (erreur) {
    await client.query('rollback').catch(() => undefined);
    throw erreur;
  } finally {
    client.release();
  }
  return { ...facture, dateEcheance: null };
}

// -------------------------------------------------------------------------------------------
// 5. Consentement marketing — Famille A (facture échue) n'en dépend jamais (RA-01), mais un test
//    doit pouvoir le PROUVER en enregistrant un refus explicite puis en constatant qu'il n'a aucun
//    effet sur la planification.
// -------------------------------------------------------------------------------------------

export async function refuserConsentementMarketingPourTest(
  ctx: AppTest,
  tenant: DonneesLot1Tenant,
  cookiePour: CookiePour,
  clientId: string,
): Promise<void> {
  const cookie = await cookiePour(tenant, 'receptionnaire');
  const reponse = await requeteJson(
    ctx,
    cookie,
    'post',
    `/api/v1/clients/${clientId}/consentements`,
    {
      type: 'marketing_email',
      accorde: false,
      recueilliLe: new Date().toISOString(),
      canal: 'formulaire_reception',
    },
  );
  if (reponse.status !== 201) {
    throw new Error(
      `fixture relances : consentement client ${clientId} a échoué (${String(reponse.status)}) : ` +
        JSON.stringify(reponse.body),
    );
  }
}

// -------------------------------------------------------------------------------------------
// 6. `client.plus_aucun_contact`/`motif` (RA-14) — écriture directe, voir §2 de l'en-tête : aucune
//    route HTTP n'existe pour ces deux colonnes à ce jour.
// -------------------------------------------------------------------------------------------

export async function marquerPlusAucunContactPourTest(
  bdd: BaseEphemere,
  tenantId: string,
  clientId: string,
  motif: string,
): Promise<void> {
  await ecrireSousTenant(bdd.poolApp, tenantId, async (client: PoolClient) => {
    await client.query(
      `update client set plus_aucun_contact = true, motif = $1 where tenant_id = $2 and id = $3`,
      [motif, tenantId, clientId],
    );
  });
}

// -------------------------------------------------------------------------------------------
// 7. Lecture directe de `relance_planifiee` — voir §1 de l'en-tête. Toujours filtrée par tenant ET
//    par `objet_id` : jamais un `select *` non scopé, même complément à une réponse HTTP.
// -------------------------------------------------------------------------------------------

export interface LigneRelancePlanifieeDeTest {
  readonly id: string;
  readonly typeRelance: string;
  readonly objetType: string;
  readonly objetId: string;
  readonly palier: number;
  readonly statut: string;
  readonly annuleRaison: string | null;
  readonly echeancePrevue: string;
}

export async function lireRelancesPlanifieesPourObjet(
  bdd: BaseEphemere,
  tenantId: string,
  objetId: string,
): Promise<readonly LigneRelancePlanifieeDeTest[]> {
  const lignes = await requeteSousTenant<{
    id: string;
    type_relance: string;
    objet_type: string;
    objet_id: string;
    palier: number;
    statut: string;
    annule_raison: string | null;
    echeance_prevue: string;
  }>(
    bdd.poolApp,
    tenantId,
    `select id, type_relance, objet_type, objet_id, palier, statut, annule_raison,
            echeance_prevue::text as echeance_prevue
       from public.relance_planifiee
      where tenant_id = $1 and objet_id = $2
      order by palier asc`,
    [tenantId, objetId],
  );
  return lignes.map((l) => ({
    id: l.id,
    typeRelance: l.type_relance,
    objetType: l.objet_type,
    objetId: l.objet_id,
    palier: l.palier,
    statut: l.statut,
    annuleRaison: l.annule_raison,
    echeancePrevue: l.echeance_prevue,
  }));
}

/** Lecture directe de `relance_envoi` (même doctrine que §7 ci-dessus : aucune route HTTP
 *  n'expose l'historique ligne à ligne pour un test — voir `service-historique-envois.ts` pour
 *  ce qui EST exposé, des compteurs agrégés). Sert à prouver qu'un envoi a — ou n'a PAS —
 *  réellement laissé une trace : `envoyees: 1` seul ne prouve rien sur ce qui a été construit et
 *  transmis, cette table si. */
export interface LigneHistoriqueEnvoiDeTest {
  readonly id: string;
  readonly relancePlanifieeId: string;
  readonly tentative: number;
  readonly canal: string;
  readonly destinataireFige: string;
  readonly statutEnvoi: string;
  readonly fournisseurMessageId: string | null;
}

export async function lireHistoriqueEnvoisPourRelance(
  bdd: BaseEphemere,
  tenantId: string,
  relancePlanifieeId: string,
): Promise<readonly LigneHistoriqueEnvoiDeTest[]> {
  const lignes = await requeteSousTenant<{
    id: string;
    relance_planifiee_id: string;
    tentative: number;
    canal: string;
    destinataire_fige: string;
    statut_envoi: string;
    fournisseur_message_id: string | null;
  }>(
    bdd.poolApp,
    tenantId,
    `select id, relance_planifiee_id, tentative, canal, destinataire_fige, statut_envoi,
            fournisseur_message_id
       from public.relance_envoi
      where tenant_id = $1 and relance_planifiee_id = $2
      order by tentative asc`,
    [tenantId, relancePlanifieeId],
  );
  return lignes.map((l) => ({
    id: l.id,
    relancePlanifieeId: l.relance_planifiee_id,
    tentative: l.tentative,
    canal: l.canal,
    destinataireFige: l.destinataire_fige,
    statutEnvoi: l.statut_envoi,
    fournisseurMessageId: l.fournisseur_message_id,
  }));
}

/** Lecture directe de `client.email` — troisième exception au patron « tout par l'API » (voir §2
 *  de l'en-tête) : `ClientFixtureLot1` (`garage-demo-lot1.ts`) n'expose pas l'e-mail semé, et
 *  aucune route de ce module ne le rend. Sert uniquement à comparer le `destinataire_fige` d'un
 *  envoi réel à la coordonnée effectivement connue du client, plutôt qu'à une valeur recopiée en
 *  dur qui romprait silencieusement si la fixture `CLIENTS_TENANT_A` changeait d'adresse. */
export async function lireEmailClientPourTest(
  bdd: BaseEphemere,
  tenantId: string,
  clientId: string,
): Promise<string | null> {
  const lignes = await requeteSousTenant<{ email: string | null }>(
    bdd.poolApp,
    tenantId,
    `select email from public.client where tenant_id = $1 and id = $2`,
    [tenantId, clientId],
  );
  return lignes[0]?.email ?? null;
}

// -------------------------------------------------------------------------------------------
// 8. Routes du module — planifier/envoyer/regles.
// -------------------------------------------------------------------------------------------

export interface ReponsePlanificationDeTest {
  readonly creees: number;
  readonly ignorees: number;
  readonly encoreATraiter: boolean;
}

export interface ReponseEnvoiDeTest {
  readonly envoyees: number;
  readonly echouees: number;
  readonly annulees: number;
  readonly encoreATraiter: boolean;
}

export async function planifier(ctx: AppTest, cookie: string): Promise<ReponsePlanificationDeTest> {
  const reponse = await ctx.requete
    .post('/api/v1/relances/facturation/planifier')
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
    .set('Cookie', cookie)
    .set(EN_TETE_IDEMPOTENCE, randomUUID());
  if (reponse.status !== 200) {
    throw new Error(
      `fixture relances : POST .../planifier a échoué (${String(reponse.status)}) : ` +
        JSON.stringify(reponse.body),
    );
  }
  return reponse.body as ReponsePlanificationDeTest;
}

export async function envoyer(ctx: AppTest, cookie: string): Promise<ReponseEnvoiDeTest> {
  const reponse = await ctx.requete
    .post('/api/v1/relances/facturation/envoyer')
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
    .set('Cookie', cookie)
    .set(EN_TETE_IDEMPOTENCE, randomUUID());
  if (reponse.status !== 200) {
    throw new Error(
      `fixture relances : POST .../envoyer a échoué (${String(reponse.status)}) : ` +
        JSON.stringify(reponse.body),
    );
  }
  return reponse.body as ReponseEnvoiDeTest;
}

export async function configurerRegleFactureEchue(
  ctx: AppTest,
  cookie: string,
  params: {
    readonly actif: boolean;
    readonly delaisJours: readonly number[];
    readonly canaux: readonly string[];
  },
): Promise<{ readonly status: number; readonly body: Record<string, unknown> }> {
  const reponse = await ctx.requete
    .put('/api/v1/relances/regles/facture_echue')
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
    .set('Cookie', cookie)
    .send(params);
  return { status: reponse.status, body: reponse.body as Record<string, unknown> };
}

// -------------------------------------------------------------------------------------------
// 9. `poste_atelier` — compte de SERVICE (borne d'atelier), absent de `utilisateursParRole`
//    (`ROLES_PERSONNE` seulement, voir `garage-demo-lot1.ts` §1). Même patron que
//    `test/integration/tableau-bord/fixtures-tableau-bord.ts::creerPosteAtelierPourTest`, recopié
//    ici (pas importé — périmètre d'écriture disjoint, CONTRIBUTING.md) pour la matrice de droits (§8 :
//    aucun droit `relances.*` par construction, DROITS_RELANCES_PAR_ROLE).
// -------------------------------------------------------------------------------------------

const MOT_DE_PASSE_POSTE_ATELIER = 'BorneAtelierTestRelances!77';

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
  const email = `borne.relances.${emailSuffixe}@test.local`;
  await bdd.poolSuperutilisateur.query(
    `insert into utilisateur
       (id, tenant_id, email, mot_de_passe_hash, prenom, nom, langue, role, statut,
        echecs_connexion, verrouille_jusqu_a, site_id)
     values ($1, $2, $3, $4, 'Borne', 'Atelier (test relances)', 'fr', 'poste_atelier', 'actif', 0, null, $5)`,
    [id, tenantId, email, motDePasseHash, siteId],
  );
  return { id, email, motDePasseClair: MOT_DE_PASSE_POSTE_ATELIER };
}

export async function getRegles(
  ctx: AppTest,
  cookie: string,
): Promise<{ readonly status: number; readonly body: unknown }> {
  const reponse = await ctx.requete.get('/api/v1/relances/regles').set('Cookie', cookie);
  return { status: reponse.status, body: reponse.body };
}
