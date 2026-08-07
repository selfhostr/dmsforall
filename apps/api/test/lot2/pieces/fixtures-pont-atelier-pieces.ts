/**
 * Fixtures HTTP du pont ATELIER ↔ PIÈCES : poser une ligne `piece` sur un OR réserve du stock
 * (`pieces/service-reservation.ts`, effet de bord de `POST /ordres-reparation/{orId}/lignes`),
 * marquer la ligne réalisée sort la pièce et pose la consigne d'échange standard le cas échéant
 * (`ServiceLigneOr.marquerRealisee` -> `satisfaireReservationSiApplicable`), annuler/refuser la
 * ligne libère la réservation. TOUT PASSE PAR LA VRAIE API HTTP, jamais un INSERT direct sur
 * `ligne_or`/`reservation_piece`/`mouvement_stock`/`stock_article`/`consigne_echange_standard` —
 * même doctrine, motivée en détail, que `test/integration/ventes/fixtures-cycle-vente.ts` : ce
 * sont exactement les tables verrouillées par déclencheurs (RP-19→RP-25 en 0026, RP-16→RP-18 en
 * 0025/0040) que ce fichier a pour rôle de mettre sous test — les contourner par un INSERT direct
 * viderait le test de sa substance.
 *
 * `creerOrPourTest` (SQL, `lot1/fixtures/garage-demo-lot1.ts`) reste utilisé pour l'OR PORTEUR
 * lui-même : l'OR n'est pas le mécanisme sous test ici (le pont démarre à la ligne), et c'est déjà
 * la doctrine établie de ce dépôt (`test/lot2/pieces/annulation-commande-fournisseur.spec.ts` fait
 * le même choix pour ses propres prérequis).
 *
 * Chaque fonction rend `{ status, body }` BRUT (jamais un throw sur un statut inattendu) — les
 * specs de ce fichier ont autant besoin des chemins de refus (409 STOCK_INSUFFISANT, 403
 * DROIT_INSUFFISANT) que du chemin nominal.
 *
 * Périmètre d'écriture : `apps/api/test/**` uniquement (CONTRIBUTING.md, brief de cette tâche).
 */

import { randomUUID } from 'node:crypto';
import { EN_TETE_IDEMPOTENCE, type RoleUtilisateur } from '@dfa/shared';

import type { AppTest } from '../../setup/app-test';
import { cookieDeSessionPour } from '../../lot1/isolation-http-aide';
import type { DonneesLot1Tenant } from '../../lot1/fixtures/garage-demo-lot1';

export interface ReponseHttp {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

/** Cache par (tenant, rôle) — même patron que `fixtures-cycle-vente.ts::construireCookiePour` :
 *  évite d'épuiser le budget anti-brute-force par IP sur un fichier qui ouvre beaucoup de
 *  sessions à travers de nombreux `describe()`. */
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

/** `avecCleIdempotence` : `undefined` (défaut) génère une clé aléatoire à chaque appel ; une
 *  chaîne explicite (y compris répétée entre deux appels) permet aux tests d'idempotence de
 *  rejouer EXACTEMENT la même clé ; `false` omet l'en-tête (routes qui n'en exigent pas :
 *  `marquer-realisee`, les actions groupées). */
async function poster(
  ctx: AppTest,
  cookie: string,
  chemin: string,
  corps: Record<string, unknown> = {},
  avecCleIdempotence: string | false | undefined = undefined,
): Promise<ReponseHttp> {
  const requete = ctx.requete
    .post(chemin)
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
    .set('Cookie', cookie);
  if (avecCleIdempotence !== false) {
    requete.set(EN_TETE_IDEMPOTENCE, avecCleIdempotence ?? randomUUID());
  }
  const reponse = await requete.send(corps);
  return { status: reponse.status, body: reponse.body as Record<string, unknown> };
}

async function recuperer(
  ctx: AppTest,
  cookie: string,
  chemin: string,
  query: Record<string, string> = {},
): Promise<ReponseHttp> {
  const reponse = await ctx.requete.get(chemin).query(query).set('Cookie', cookie);
  return { status: reponse.status, body: reponse.body as Record<string, unknown> };
}

// -------------------------------------------------------------------------------------------
// 1. Articles + stock (RP-01→RP-18) — `POST /articles` puis `ajustement-inventaire` (JAMAIS une
//    quantité physique posée directement : RP-16, le physique est un solde DÉRIVÉ des mouvements,
//    `stock.controller.ts` le documente littéralement : « PATCH stock, JAMAIS la quantité
//    physique »). `ajustement-inventaire` est la seule route qui fasse naître un `stock_article`
//    à une valeur choisie en un seul appel HTTP (delta positif depuis zéro, RP-12).
// -------------------------------------------------------------------------------------------

export function creerArticle(
  ctx: AppTest,
  cookie: string,
  overrides: Record<string, unknown> = {},
): Promise<ReponseHttp> {
  const suffixe = randomUUID().slice(0, 8).toUpperCase();
  return poster(ctx, cookie, '/api/v1/articles', {
    designation: `Article de test pont ${suffixe}`,
    categorie: 'piece_mecanique',
    referencePrincipale: `REF-PONT-${suffixe}`,
    prixVenteTtcCentimes: 9990,
    tauxTvaPourmille: 81,
    estEchangeStandard: false,
    ...overrides,
  });
}

/** Article d'échange standard (RP-37) — `montantConsigneTtcCentimes` OBLIGATOIRE et cohérent
 *  avec `estEchangeStandard: true` (zod `schemaCreationArticle.refine`, ET la contrainte CHECK
 *  `article_consigne_coherente_chk`, 0022 — les deux couches s'accordent, aucune n'est
 *  contournable même par un appelant malveillant). */
export function creerArticleEchangeStandard(
  ctx: AppTest,
  cookie: string,
  montantConsigneTtcCentimes = 8000,
  overrides: Record<string, unknown> = {},
): Promise<ReponseHttp> {
  return creerArticle(ctx, cookie, {
    designation: `Alternateur échange standard ${randomUUID().slice(0, 8)}`,
    estEchangeStandard: true,
    montantConsigneTtcCentimes,
    ...overrides,
  });
}

/** Fait naître (ou complète) `stock_article` à EXACTEMENT `quantiteCompteeMillieme` — première
 *  apparition de la ligne (delta positif depuis 0, repli `INSERT … ON CONFLICT` de 0040) tant
 *  qu'aucun autre mouvement n'a encore touché ce (article, site). */
export function ajustementInventaire(
  ctx: AppTest,
  cookie: string,
  articleId: string,
  siteId: string,
  quantiteCompteeMillieme: number,
  motif = 'Comptage initial de test (pont atelier-pièces).',
): Promise<ReponseHttp> {
  return poster(ctx, cookie, `/api/v1/articles/${articleId}/mouvements/ajustement-inventaire`, {
    siteId,
    quantiteCompteeMillieme,
    motif,
  });
}

export function casse(
  ctx: AppTest,
  cookie: string,
  articleId: string,
  corps: Record<string, unknown>,
  cleIdempotence?: string,
): Promise<ReponseHttp> {
  return poster(
    ctx,
    cookie,
    `/api/v1/articles/${articleId}/mouvements/casse`,
    { motif: 'Casse de test.', ...corps },
    cleIdempotence,
  );
}

export function sortieComptoir(
  ctx: AppTest,
  cookie: string,
  articleId: string,
  corps: { readonly siteId: string; readonly quantiteMillieme: number; readonly motif?: string },
  cleIdempotence?: string,
): Promise<ReponseHttp> {
  return poster(
    ctx,
    cookie,
    `/api/v1/articles/${articleId}/mouvements/sortie-comptoir`,
    corps,
    cleIdempotence,
  );
}

export function retourClient(
  ctx: AppTest,
  cookie: string,
  articleId: string,
  corps: { readonly siteId: string; readonly quantiteMillieme: number; readonly motif: string },
  cleIdempotence?: string,
): Promise<ReponseHttp> {
  return poster(
    ctx,
    cookie,
    `/api/v1/articles/${articleId}/mouvements/retour-client`,
    corps,
    cleIdempotence,
  );
}

export function disponibilite(
  ctx: AppTest,
  cookie: string,
  articleId: string,
  siteId: string,
): Promise<ReponseHttp> {
  return recuperer(ctx, cookie, `/api/v1/articles/${articleId}/disponibilite`, { siteId });
}

export function listerMouvements(
  ctx: AppTest,
  cookie: string,
  articleId: string,
  query: Record<string, string> = {},
): Promise<ReponseHttp> {
  return recuperer(ctx, cookie, `/api/v1/articles/${articleId}/mouvements`, query);
}

export function listerReservations(
  ctx: AppTest,
  cookie: string,
  query: Record<string, string> = {},
): Promise<ReponseHttp> {
  return recuperer(ctx, cookie, `/api/v1/reservations`, query);
}

export function listerConsignes(
  ctx: AppTest,
  cookie: string,
  query: Record<string, string> = {},
): Promise<ReponseHttp> {
  return recuperer(ctx, cookie, `/api/v1/consignes`, query);
}

// -------------------------------------------------------------------------------------------
// 2. Lignes d'OR (§7.8) — `creer` porte l'effet de bord RP-19/RP-20 (réservation, ou
//    `blocage: 'pieces'` sous RP-24 si le stock est insuffisant). `marquerRealisee` porte l'effet
//    de bord RP-21/RP-38 (sortie + consigne). `annulerLignes` porte l'effet de bord RP-23
//    (libération automatique de la réservation).
// -------------------------------------------------------------------------------------------

export function creerLignePiece(
  ctx: AppTest,
  cookie: string,
  orId: string,
  articleId: string,
  quantiteMillieme: number,
  overrides: Record<string, unknown> = {},
): Promise<ReponseHttp> {
  return poster(ctx, cookie, `/api/v1/ordres-reparation/${orId}/lignes`, {
    type: 'piece',
    origine: 'commandee',
    designation: `Pièce de test ${randomUUID().slice(0, 8)}`,
    articleId,
    quantiteMillieme,
    prixUnitaireCentimes: 9990,
    payeur: 'client',
    ...overrides,
  });
}

export function marquerRealisee(
  ctx: AppTest,
  cookie: string,
  orId: string,
  ligneId: string,
): Promise<ReponseHttp> {
  return poster(
    ctx,
    cookie,
    `/api/v1/ordres-reparation/${orId}/lignes/${ligneId}/marquer-realisee`,
    {},
    false,
  );
}

export function annulerLignes(
  ctx: AppTest,
  cookie: string,
  orId: string,
  ligneIds: readonly string[],
  motif = 'Annulation de test, réservation à libérer.',
): Promise<ReponseHttp> {
  return poster(
    ctx,
    cookie,
    `/api/v1/ordres-reparation/${orId}/annuler-lignes`,
    { ligneIds, motif },
    false,
  );
}

/** T-20 `{planifie,ouvert} -> annule` — issue #11 : annuler l'OR ENTIER (pas une ligne isolée,
 *  `annulerLignes` ci-dessus) doit libérer toutes les réservations `active` de ses lignes pièce. */
export function annulerOr(
  ctx: AppTest,
  cookie: string,
  orId: string,
  motif = 'Annulation de test (OR entier), réservations à libérer.',
): Promise<ReponseHttp> {
  return poster(ctx, cookie, `/api/v1/ordres-reparation/${orId}/annuler`, { motif }, false);
}

// -------------------------------------------------------------------------------------------
// 3. Pointage (RM-117) — SEUL chemin qui fasse passer `ligne_or.statut` `validee -> en_cours`,
//    précondition de `marquer-realisee` (`en_cours -> realisee`, CT-28).
// -------------------------------------------------------------------------------------------

/** `GET /ordres-reparation/{orId}` — document complet, lignes EMBARQUÉES (§8.3) : le moyen le
 *  plus direct de relire le `statut`/`blocage` d'une ligne précise après une action. */
export function obtenirOr(ctx: AppTest, cookie: string, orId: string): Promise<ReponseHttp> {
  return recuperer(ctx, cookie, `/api/v1/ordres-reparation/${orId}`);
}

export function demarrerPointage(
  ctx: AppTest,
  cookie: string,
  corps: {
    readonly siteId: string;
    readonly technicienId: string;
    readonly ordreReparationId: string;
    readonly ligneOrId: string;
  },
): Promise<ReponseHttp> {
  return poster(ctx, cookie, '/api/v1/pointages', {
    id: randomUUID(),
    nature: 'productif_ligne',
    debutLe: new Date().toISOString(),
    ...corps,
  });
}

/** `POST /pointages/{id}/arreter` — `en_cours -> termine` (RM-116). `Idempotency-Key`
 *  OBLIGATOIRE ICI (déviation documentée par le contrôleur lui-même) — à la différence de
 *  `marquerRealisee`/`annulerLignes` ci-dessus. Utile pour isoler, dans un test, un blocage dû à
 *  une pièce sortie (RM-62) d'un blocage dû à un pointage resté ouvert (I-09) : `marquerRealisee`
 *  NE ferme PAS le pointage automatiquement. */
export function arreterPointage(
  ctx: AppTest,
  cookie: string,
  pointageId: string,
  finLe = new Date().toISOString(),
): Promise<ReponseHttp> {
  return poster(ctx, cookie, `/api/v1/pointages/${pointageId}/arreter`, { finLe });
}
