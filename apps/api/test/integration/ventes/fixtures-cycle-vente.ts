/**
 * Fixtures HTTP du cycle de vente d'un véhicule (`ventes/dossier-vente.controller.ts`,
 * `ventes/vehicule-stock.controller.ts`, `ventes/financement.controller.ts`,
 * `facturation/documents/document-vente.controller.ts`) — construites PAR-DESSUS
 * `semerGarageDemoLot1` (site/client existants réutilisés en lecture), jamais en dupliquant sa
 * connaissance des colonnes NOT NULL.
 *
 * TOUT PASSE PAR LA VRAIE API HTTP, jamais un INSERT direct — même doctrine, motivée en détail,
 * que `test/integration/tableau-bord/fixtures-tableau-bord.ts` et
 * `test/lot1/facturation/emission-document.spec.ts` : `document_vente` est verrouillée par des
 * triggers (numérotation légale, calcul TVA, verrouillage post-émission) qu'un INSERT à la main ne
 * reproduirait pas honnêtement, et c'est justement la MACHINE À ÉTATS du dossier de vente /
 * véhicule en stock (triggers `verifier_transition`, gardes applicatives de
 * `ServiceDossierVente`/`ServiceVehiculeStock`) que ce fichier a pour rôle de mettre sous test —
 * la contourner par un INSERT direct viderait le test de sa substance.
 *
 * Chaque fonction rend `{ status, body }` BRUT (jamais un throw sur un statut inattendu, à la
 * différence de `fixtures-tableau-bord.ts`) : les specs de ce répertoire ont autant besoin des
 * chemins de REFUS (403/404/409) que du chemin nominal, et un throw sur un 409 attendu serait
 * exactement le genre de fixture qui empêche d'écrire le test qu'on veut écrire.
 *
 * ARITHMÉTIQUE DES LIGNES : une seule ligne primitive connue, IDENTIQUE (mêmes valeurs, mêmes
 * commentaires justificatifs) à celle de `fixtures-tableau-bord.ts` — 7'000 c. TTC, taux 8.1 %
 * (81‰), quantité 1 → HT/TVA déjà démontrés exacts ailleurs dans ce dépôt (`calcul-document.spec.ts`,
 * `emission-document.spec.ts::LIGNE_UNIQUE`, `fixtures-tableau-bord.ts`, cas « CF-13 ») :
 *
 *   tva = arrondiCommercial(7000 × 81, 1000 + 81) = arrondiCommercial(567000, 1081) = 525
 *   ht  = 7000 − 525 = 6475
 *
 * Recopiée ici plutôt qu'importée : `test/integration/tableau-bord/` n'est pas le périmètre
 * d'écriture de cette tâche, et coupler ce fichier à un autre agrégat métier (tableau de bord)
 * pour une seule constante serait un couplage plus coûteux que trois lignes dupliquées.
 *
 * Périmètre d'écriture : `apps/api/test/**` uniquement (CONTRIBUTING.md, brief de cette tâche).
 */

import { randomUUID } from 'node:crypto';
import { EN_TETE_IDEMPOTENCE, type RoleUtilisateur } from '@dfa/shared';

import type { AppTest } from '../../setup/app-test';
import { cookieDeSessionPour } from '../../lot1/isolation-http-aide';
import type { DonneesLot1Tenant } from '../../lot1/fixtures/garage-demo-lot1';

export const PRIMITIVE_TTC = 7000;
export const PRIMITIVE_TVA = 525;
export const PRIMITIVE_HT = 6475;

export interface ReponseHttp {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

/** Cache par (tenant, rôle), même patron que `fixtures-tableau-bord.ts::construireCookiePour` —
 *  évite d'épuiser le budget anti-brute-force par IP (`POST /auth/connexion`) sur un fichier qui
 *  ouvre beaucoup de sessions différentes à travers de nombreux `describe()`. */
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

async function poster(
  ctx: AppTest,
  cookie: string,
  chemin: string,
  corps: Record<string, unknown> = {},
  avecCleIdempotence = true,
): Promise<ReponseHttp> {
  const requete = ctx.requete
    .post(chemin)
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
    .set('Cookie', cookie);
  if (avecCleIdempotence) requete.set(EN_TETE_IDEMPOTENCE, randomUUID());
  const reponse = await requete.send(corps);
  return { status: reponse.status, body: reponse.body as Record<string, unknown> };
}

async function recuperer(ctx: AppTest, cookie: string, chemin: string): Promise<ReponseHttp> {
  const reponse = await ctx.requete.get(chemin).set('Cookie', cookie);
  return { status: reponse.status, body: reponse.body as Record<string, unknown> };
}

// -------------------------------------------------------------------------------------------
// 1. Véhicule (étape 1) + extension véhicule en stock (étape 4, `RV-01` : « vehicule_stock.id EST
//    vehicule.id », pas un second identifiant).
// -------------------------------------------------------------------------------------------

/** `POST /vehicules` — `Idempotency-Key` obligatoire (`vehicule.creer`). VIN toujours fourni : la
 *  provenance par défaut de ces fixtures (`achat_particulier`) rend `statutCommercial` initial
 *  `disponible` immédiatement (dérivation : `en_commande` réservé à `neuf_constructeur` SANS VIN
 *  connu, `service-vehicule-stock.ts::mettreEnStock`), ce qui évite une étape `receptionner`
 *  hors sujet pour ce cycle. */
export function creerVehicule(ctx: AppTest, cookie: string, suffixe: string): Promise<ReponseHttp> {
  return poster(ctx, cookie, '/api/v1/vehicules', {
    vin: `WVWZZZ1KZ${suffixe.slice(0, 7).toUpperCase().padEnd(7, '0')}`,
    marque: 'Volkswagen',
    modele: 'Golf',
    version: 'VIII',
    importe: false,
  });
}

/** `POST /vehicules/{id}/stock` — `Idempotency-Key` obligatoire (`ventes.vehicule_stock.creer`).
 *  Provenance `achat_particulier` par défaut → `statutCommercial` initial `disponible`. */
export function mettreEnStock(
  ctx: AppTest,
  cookie: string,
  vehiculeId: string,
  siteId: string,
  overrides: Record<string, unknown> = {},
): Promise<ReponseHttp> {
  return poster(ctx, cookie, `/api/v1/vehicules/${vehiculeId}/stock`, {
    siteId,
    provenance: 'achat_particulier',
    dateEntreeStock: '2026-01-05',
    prixAchatCentimes: 1_500_000,
    prixVenteAfficheCentimes: 1_990_000,
    ...overrides,
  });
}

export function getVehiculeStock(ctx: AppTest, cookie: string, vehiculeId: string): Promise<ReponseHttp> {
  return recuperer(ctx, cookie, `/api/v1/vehicules/${vehiculeId}/stock`);
}

/** `POST /vehicules/{id}/stock/marquer-vendu` — `ventes.vehicule_stock.corriger`. Endpoint de
 *  CORRECTION (docstring `vehicule-stock.ts`) : usage normal = effet de bord programmatique de
 *  l'émission de facture (`emettreDocument` ci-dessous). Utilisé ici pour exercer directement
 *  RPP-06 (signalement des dépôts de pneus ouverts) sans construire tout un dossier de vente. */
export function marquerVenduDirect(
  ctx: AppTest,
  cookie: string,
  vehiculeId: string,
  motif = 'Marquage vendu de test (correction manuelle).',
): Promise<ReponseHttp> {
  return poster(
    ctx,
    cookie,
    `/api/v1/vehicules/${vehiculeId}/stock/marquer-vendu`,
    { motif },
    false,
  );
}

/** `POST /vehicules/{id}/stock/remettre-disponible` — `ventes.vehicule_stock.corriger`. Utilisé
 *  pour PROVOQUER, honnêtement (vraie base, aucun mock), l'échec du marquage-vendu automatique à
 *  l'émission d'une facture (`reserve -> disponible` entre l'engagement et l'émission — RV-37,
 *  scénario « véhicule déjà repris entre-temps » explicitement anticipé par la docstring de
 *  `ServiceVehiculeStock.marquerVendu`). */
export function remettreDisponible(
  ctx: AppTest,
  cookie: string,
  vehiculeId: string,
  motif = 'Remise à disponible de test.',
): Promise<ReponseHttp> {
  return poster(
    ctx,
    cookie,
    `/api/v1/vehicules/${vehiculeId}/stock/remettre-disponible`,
    { motif },
    false,
  );
}

// -------------------------------------------------------------------------------------------
// 2. Dossier de vente (RV-29 → RV-38, RV-52 → RV-58).
// -------------------------------------------------------------------------------------------

export function creerDossier(
  ctx: AppTest,
  cookie: string,
  corps: { readonly siteId: string; readonly clientAcheteurId: string; readonly vehiculeId?: string },
): Promise<ReponseHttp> {
  return poster(ctx, cookie, '/api/v1/dossiers-vente', corps);
}

export function getDossier(ctx: AppTest, cookie: string, dossierVenteId: string): Promise<ReponseHttp> {
  return recuperer(ctx, cookie, `/api/v1/dossiers-vente/${dossierVenteId}`);
}

export function engager(
  ctx: AppTest,
  cookie: string,
  dossierVenteId: string,
  bonCommandeDocumentId: string,
  identitePieceType = 'carte_identite',
): Promise<ReponseHttp> {
  return poster(
    ctx,
    cookie,
    `/api/v1/dossiers-vente/${dossierVenteId}/engager`,
    { bonCommandeDocumentId, identitePieceType },
    false,
  );
}

export function preparer(ctx: AppTest, cookie: string, dossierVenteId: string): Promise<ReponseHttp> {
  return poster(ctx, cookie, `/api/v1/dossiers-vente/${dossierVenteId}/preparer`, {}, false);
}

export function marquerPretALivrer(
  ctx: AppTest,
  cookie: string,
  dossierVenteId: string,
): Promise<ReponseHttp> {
  return poster(
    ctx,
    cookie,
    `/api/v1/dossiers-vente/${dossierVenteId}/marquer-pret-a-livrer`,
    {},
    false,
  );
}

export function livrer(
  ctx: AppTest,
  cookie: string,
  dossierVenteId: string,
  dateLivraisonEffective: string,
  kilometrageDepart = 0,
): Promise<ReponseHttp> {
  return poster(
    ctx,
    cookie,
    `/api/v1/dossiers-vente/${dossierVenteId}/livrer`,
    { dateLivraisonEffective, kilometrageDepart, uniteKilometrage: 'km' },
    false,
  );
}

export function cloturer(ctx: AppTest, cookie: string, dossierVenteId: string): Promise<ReponseHttp> {
  return poster(ctx, cookie, `/api/v1/dossiers-vente/${dossierVenteId}/cloturer`, {}, false);
}

// -------------------------------------------------------------------------------------------
// 3. Financement (RV-39 → RV-45) — `comptant` est créé `confirme` d'emblée (aucune confirmation
//    tierce n'a de sens, RV-44), exactement ce dont `marquer-pret-a-livrer` a besoin (RV-37).
// -------------------------------------------------------------------------------------------

export function creerFinancementComptant(
  ctx: AppTest,
  cookie: string,
  dossierVenteId: string,
): Promise<ReponseHttp> {
  return poster(ctx, cookie, `/api/v1/dossiers-vente/${dossierVenteId}/financements`, {
    type: 'comptant',
  });
}

// -------------------------------------------------------------------------------------------
// 4. Documents de vente (chaîne facturation) — `bon_commande` (engagement) et `facture` (RV-37,
//    marquage vendu). `n` copies de la ligne primitive → totaux exacts (n×6475 / n×525 / n×7000),
//    même démonstration qu'en tête de fichier.
// -------------------------------------------------------------------------------------------

function lignesPrimitives(n: number, dateDocument: string) {
  return Array.from({ length: n }, (_, i) => ({
    type: 'forfait',
    designation: `Ligne de test cycle de vente #${String(i + 1)}`,
    quantiteMillieme: 1000,
    prixUnitaireTtcCentimes: PRIMITIVE_TTC,
    tauxTvaPourmille: 81,
    datePrestation: dateDocument,
  }));
}

export function creerDocumentVente(
  ctx: AppTest,
  cookie: string,
  entree: {
    readonly typeDocument: 'devis' | 'bon_commande' | 'facture';
    readonly siteId: string;
    readonly clientId: string;
    readonly dateDocument: string;
    readonly dossierVenteId?: string | null;
    readonly vehiculeId?: string | null;
    readonly nombreLignesPrimitives: number;
  },
): Promise<ReponseHttp> {
  return poster(ctx, cookie, '/api/v1/documents-vente', {
    typeDocument: entree.typeDocument,
    siteId: entree.siteId,
    clientId: entree.clientId,
    dateDocument: entree.dateDocument,
    devise: 'CHF',
    ...(entree.dossierVenteId !== undefined ? { dossierVenteId: entree.dossierVenteId } : {}),
    ...(entree.vehiculeId !== undefined ? { vehiculeId: entree.vehiculeId } : {}),
    lignes: lignesPrimitives(entree.nombreLignesPrimitives, entree.dateDocument),
  });
}

export function emettreDocument(ctx: AppTest, cookie: string, documentId: string): Promise<ReponseHttp> {
  return poster(ctx, cookie, `/api/v1/documents-vente/${documentId}/emettre`, {});
}

// -------------------------------------------------------------------------------------------
// 5. Assemblage du parcours nominal — CRÉE ses propres client/véhicule/dossier à chaque appel
//    (jamais de partage entre tests, voir la tête de fichier), et rend chaque identifiant utile.
//    Ne s'arrête PAS avant `pret_a_livrer` : la facture (qui marque le véhicule vendu, RV-37) et la
//    livraison restent à la charge de l'appelant, dont le comportement exact est le sujet même de
//    la plupart des tests de ce répertoire.
// -------------------------------------------------------------------------------------------

export interface DossierJusquApretALivrer {
  readonly vehiculeId: string;
  readonly dossierVenteId: string;
  readonly bonCommandeId: string;
}

/** Lève si une étape échoue de façon inattendue (fixture de MONTAGE, pas de test) — chaque étape
 *  du CYCLE lui-même reste testée explicitement, décrite en toutes lettres, dans les specs qui
 *  utilisent cette fonction ; celle-ci n'existe que pour amener rapidement un dossier au point
 *  commun `pret_a_livrer` sans réécrire la même préparation dans chaque `it`. */
export async function amenerDossierJusquAPretALivrer(
  ctx: AppTest,
  cookie: string,
  siteId: string,
  clientAcheteurId: string,
  suffixe: string,
): Promise<DossierJusquApretALivrer> {
  const vehicule = await creerVehicule(ctx, cookie, suffixe);
  if (vehicule.status !== 201) {
    throw new Error(`fixture cycle-vente : création véhicule échouée : ${JSON.stringify(vehicule.body)}`);
  }
  const vehiculeId = (vehicule.body as { donnees: { id: string } }).donnees.id;

  const stock = await mettreEnStock(ctx, cookie, vehiculeId, siteId);
  if (stock.status !== 201) {
    throw new Error(`fixture cycle-vente : mise en stock échouée : ${JSON.stringify(stock.body)}`);
  }

  const dossier = await creerDossier(ctx, cookie, { siteId, clientAcheteurId, vehiculeId });
  if (dossier.status !== 201) {
    throw new Error(`fixture cycle-vente : création dossier échouée : ${JSON.stringify(dossier.body)}`);
  }
  const dossierVenteId = (dossier.body as { donnees: { id: string } }).donnees.id;

  const bonCommande = await creerDocumentVente(ctx, cookie, {
    typeDocument: 'bon_commande',
    siteId,
    clientId: clientAcheteurId,
    dateDocument: '2026-01-10',
    dossierVenteId,
    vehiculeId,
    nombreLignesPrimitives: 1,
  });
  if (bonCommande.status !== 201) {
    throw new Error(
      `fixture cycle-vente : création bon de commande échouée : ${JSON.stringify(bonCommande.body)}`,
    );
  }
  const bonCommandeBrouillonId = (bonCommande.body as { donnees: { id: string } }).donnees.id;
  const bonCommandeEmis = await emettreDocument(ctx, cookie, bonCommandeBrouillonId);
  if (bonCommandeEmis.status !== 200) {
    throw new Error(
      `fixture cycle-vente : émission bon de commande échouée : ${JSON.stringify(bonCommandeEmis.body)}`,
    );
  }
  const bonCommandeId = (bonCommandeEmis.body as { donnees: { id: string } }).donnees.id;

  // `>= 300`, jamais `!== 200` : aucune des transitions ci-dessous ne porte de `@HttpCode`
  // explicite (`@Post` seul), donc le défaut NestJS s'applique (`201`), ALORS QUE
  // `@ApiOkResponse` documente `200` en Swagger — même ambiguïté déjà mesurée en conditions
  // réelles et documentée dans `test/lot2/pneus/hangar-pneus.spec.ts`. Ce que cette fixture de
  // MONTAGE doit garantir est que l'étape a réussi, pas son code HTTP exact (chaque spec qui
  // exerce une transition en assertion PRINCIPALE le fait elle-même, en toutes lettres).
  const engagement = await engager(ctx, cookie, dossierVenteId, bonCommandeId);
  if (engagement.status >= 300) {
    throw new Error(`fixture cycle-vente : engagement échoué : ${JSON.stringify(engagement.body)}`);
  }

  const preparation = await preparer(ctx, cookie, dossierVenteId);
  if (preparation.status >= 300) {
    throw new Error(`fixture cycle-vente : préparation échouée : ${JSON.stringify(preparation.body)}`);
  }

  const financement = await creerFinancementComptant(ctx, cookie, dossierVenteId);
  if (financement.status !== 201) {
    throw new Error(`fixture cycle-vente : financement échoué : ${JSON.stringify(financement.body)}`);
  }

  const pret = await marquerPretALivrer(ctx, cookie, dossierVenteId);
  if (pret.status >= 300) {
    throw new Error(`fixture cycle-vente : marquer-pret-a-livrer échoué : ${JSON.stringify(pret.body)}`);
  }

  return { vehiculeId, dossierVenteId, bonCommandeId };
}
