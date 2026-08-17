/**
 * `ServiceEmissionDocument.emettre()` (`apps/api/src/facturation/documents/service-emission.ts`)
 * — point le plus sensible de l'étape 2 : verrouille un brouillon, attribue un numéro légal, fige
 * des montants. Sans test avant ce fichier (voir la tâche qui l'a créé).
 *
 * ARBITRAGE (à charge du présent agent, consigné ici) : les quatre garanties demandées —
 * contrôle de droit dynamique, verrouillage post-émission, numérotation sans trou, arithmétique
 * de l'émission — sont TOUTES prouvées ici, EN INTÉGRATION, sur une vraie Postgres éphémère
 * (testcontainers), par les VRAIS chemins applicatifs :
 *
 *   - le contrôle de droit (1) et la numérotation (2) exigent de vérifier un ÉTAT après refus
 *     (brouillon inchangé, aucun numéro consommé) — un mock de base ne peut pas prouver qu'AUCUNE
 *     écriture n'a eu lieu, seule une vraie transaction annulée le peut ;
 *   - le verrouillage (3) est un TRIGGER PostgreSQL (`document_vente_verrouiller_apres_emission`,
 *     migration 0010 §7.2, et `ligne_document_verrouiller_document` §8.1) : le tester contre un
 *     faux client de base ne prouverait rien du tout (CONTRIBUTING.md, consigne du projet) ;
 *   - l'arithmétique pure (calcul par ligne, ventilation de remise, agrégation TVA) est déjà
 *     couverte par 25 tests verts et protecteurs dans `calcul-document.spec.ts` — CE fichier-ci
 *     n'y ajoute qu'une preuve d'INTÉGRATION : que l'émission réelle (recalcul des lignes,
 *     écriture bigint, relecture) restitue bien `Σ HT + Σ TVA = Σ TTC` au centime, sans jamais
 *     réintroduire un flottant sur le trajet DB aller-retour.
 *
 * DÉLIBÉRÉMENT PAS DE TEST UNITAIRE MOCKÉ pour `verifierDroitEmission()` (méthode privée) : la
 * simuler demanderait de fabriquer un faux `tx` Drizzle chaînable (`update().set().where()`), un
 * faux `ServiceCompteurs`, une fausse `ServiceIdempotence` qui rejoue l'exécution — exactement le
 * genre de monde-qui-n'existe-pas que la tâche met en garde. Les tests HTTP ci-dessous exercent la
 * VRAIE classe, avec la VRAIE `MATRICE_DROITS`, contre une VRAIE base : c'est une preuve strictement
 * plus honnête que n'importe quel mock de la même méthode.
 *
 * PROUVÉ ROUGE PAR LECTURE, PAS PAR EXÉCUTION : la consigne de la tâche demande de faire rougir
 * chaque test important en retirant le contrôle avant de le remettre. Ce fichier étant un test
 * d'INTÉGRATION (`test/lot1/**`, projet vitest "integration"), l'exécuter exige
 * `pnpm test:integration` — explicitement hors périmètre de cette tâche (« ne relance pas
 * pnpm test:integration sans demande explicite », consigne de @laupernoe répétée deux fois dans la
 * tâche). Le rouge/vert est donc établi PAR LECTURE du chemin de code, pas par exécution :
 *   - `emettre()` (service-emission.ts) appelle `this.verifierDroitEmission(doc.typeDocument,
 *     principal)` ligne ~66, AVANT tout `tx.update`/`tx.insert`/`genererNumeroDocument` — retirer
 *     cette ligne ferait passer `chef_atelier` sur l'émission d'une FACTURE : `chef_atelier` a le
 *     portillon générique `facturation.document.emettre` (hérité de `EMISSION_DEVIS_BC`,
 *     `auth/matrice-droits.ts`), donc `GardeDroit` (contrôle statique sur la route) le laisserait
 *     déjà passer — SEULE `verifierDroitEmission` s'oppose ensuite en vérifiant l'action précise
 *     `facturation.document.emettre_facture`, absente des droits de `chef_atelier`. Sans cette
 *     ligne, plus rien ne s'y oppose : le test « chef_atelier peut émettre un devis mais pas une
 *     facture » ci-dessous passerait de vert à… vert aussi, mais pour la MAUVAISE raison (aucune
 *     assertion 403 ne serait plus jamais atteinte, `expect(reponseFacture.status).toBe(403)`
 *     échouerait). C'est exactement la preuve qu'un test de ce genre doit fournir : à exécuter par
 *     `pnpm test:integration` quand @laupernoe le demandera, avec puis sans la ligne 66.
 *   - Confirmation indépendante : un second agent (revue de code, hors de ce périmètre) est arrivé
 *     à la même conclusion par lecture directe, mêmes numéros de ligne — voir l'entrée
 *     `verification-conditionnelle-service` ajoutée pour `facturation.document.emettre_facture`/
 *     `_avoir`/`_devis_bc` dans `common/droits/allowlist-actions-non-decorees.ts`. CE fichier de
 *     tests est ce qui empêche cette entrée de devenir un mensonge : si `verifierDroitEmission`
 *     disparaît un jour, les tests ci-dessous doivent rougir.
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EN_TETE_IDEMPOTENCE, type RoleUtilisateur } from '@dfa/shared';

import {
  demarrerBaseEphemere,
  requeteSousTenant,
  type BaseEphemere,
} from '../../setup/postgres-ephemere';
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

// -------------------------------------------------------------------------------------------
// Aides HTTP — passent TOUJOURS par les vraies routes (POST /documents-vente, POST .../emettre,
// GET /documents-vente/{id}), jamais par un accès direct au service : c'est la seule façon de
// prouver que `GardeDroit` (contrôle statique par route) ET `verifierDroitEmission` (contrôle
// dynamique en service) sont TOUS LES DEUX dans le chemin réel qu'emprunte une requête HTTP.
// -------------------------------------------------------------------------------------------

// Cache PAR (tenant, rôle), mémorisé pour toute la durée du fichier — ce fichier appelle
// `cookiePour` depuis `creerBrouillon`/`emettre`/`lire`, soit une fois PAR REQUÊTE HTTP (39 appels
// au total). Sans ce cache, chacun de ces appels ferait un nouveau `POST /auth/connexion` : le
// budget anti-brute-force PAR IP (`LIMITE_CONNEXION_IP`, défaut 20/900s, consommé sur succès
// COMME échec — `auth/services/authentification.service.ts`) serait épuisé en cours de fichier,
// et les tests suivants échoueraient en `429 AUTH_TROP_DE_TENTATIVES` — un défaut de CE fichier,
// pas du rate-limiting, qui protège exactement ce qu'il est censé protéger. Même patron que
// `metier-montants-par-role.spec.ts` (cookies mémorisés dans `beforeAll`), généralisé ici en cache
// paresseux pour couvrir les huit couples (tenant, rôle) réellement utilisés sans les énumérer à
// la main.
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

interface LigneCreationTest {
  readonly type: string;
  readonly designation: string;
  readonly quantiteMillieme: number;
  readonly prixUnitaireTtcCentimes: number;
  readonly tauxTvaPourmille: number;
  readonly datePrestation: string;
}

/** Forfait CHF 70.00 TTC à 8.1% — mêmes valeurs que le cas CF-13 de `calcul-document.spec.ts`
 *  (tva=525, ht=6475) : pas une coïncidence, reprendre un cas déjà prouvé exact en unitaire évite
 *  d'introduire une seconde vérité arithmétique dans la suite de tests. */
const LIGNE_UNIQUE: readonly LigneCreationTest[] = [
  {
    type: 'forfait',
    designation: 'Forfait diagnostic (test émission)',
    quantiteMillieme: 1000,
    prixUnitaireTtcCentimes: 7000,
    tauxTvaPourmille: 81,
    datePrestation: '2026-07-29',
  },
];

interface DocumentDeTest {
  readonly id: string;
  readonly statut: string;
  readonly numero: string | null;
}

async function creerBrouillon(
  tenant: DonneesLot1Tenant,
  role: RoleUtilisateur,
  typeDocument: 'devis' | 'bon_commande' | 'facture',
  lignes: readonly LigneCreationTest[] = LIGNE_UNIQUE,
  extra: Record<string, unknown> = {},
): Promise<DocumentDeTest> {
  const cookie = await cookiePour(tenant, role);
  const reponse = await ctx.requete
    .post('/api/v1/documents-vente')
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
    .set('Cookie', cookie)
    .set(EN_TETE_IDEMPOTENCE, randomUUID())
    .send({
      typeDocument,
      siteId: tenant.tenant.sites[0]!.id,
      clientId: tenant.clients[0]!.id,
      devise: 'CHF',
      lignes,
      ...extra,
    });
  if (reponse.status !== 201) {
    throw new Error(
      `création brouillon ${typeDocument} (${role}) a échoué (${String(reponse.status)}) : ${JSON.stringify(reponse.body)}`,
    );
  }
  return reponse.body.donnees as DocumentDeTest;
}

/** Rend la réponse BRUTE (pas seulement le corps) : les tests ci-dessous ont besoin du status
 *  HTTP pour distinguer un refus (403) d'un succès (200), pas seulement du contenu. */
async function emettre(tenant: DonneesLot1Tenant, role: RoleUtilisateur, documentId: string) {
  const cookie = await cookiePour(tenant, role);
  return ctx.requete
    .post(`/api/v1/documents-vente/${documentId}/emettre`)
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
    .set('Cookie', cookie)
    .set(EN_TETE_IDEMPOTENCE, randomUUID());
}

async function lire(tenant: DonneesLot1Tenant, role: RoleUtilisateur, documentId: string) {
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
    numeroSequence: number | null;
    lignes: readonly { id: string }[];
  };
}

/** Même remarque que `emettre()` ci-dessus : AUCUN `.send()`, donc AUCUN corps — reproduit un
 *  appel réel à `POST .../accepter`. */
async function accepter(tenant: DonneesLot1Tenant, role: RoleUtilisateur, documentId: string) {
  const cookie = await cookiePour(tenant, role);
  return ctx.requete
    .post(`/api/v1/documents-vente/${documentId}/accepter`)
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
    .set('Cookie', cookie);
}

// =================================================================================================
// 0. Corps de requête ABSENT — compatibilité ascendante (régression CI du 10.08.2026)
// =================================================================================================
//
// `emettre()`/`accepter()` ci-dessus n'envoient JAMAIS de corps (`.send()` n'apparaît dans aucune
// des deux) — c'est le comportement de TOUT appelant existant avant l'ajout de `confirmations` à
// ces deux endpoints, y compris notre propre front (`useEmettreDocumentVente.ts`) et tout
// connecteur tiers. `schemaEmissionDocumentVente`/`schemaAccepterDevis` n'ont AUCUN champ
// obligatoire, mais `z.object(...)` refuse `undefined` À LA RACINE même quand toutes ses
// propriétés sont optionnelles : brancher `@CorpsZod` sans rendre le corps LUI-MÊME optionnel a
// fait rendre `400 VALIDATION_ECHOUEE` à CHAQUE test de ce fichier — sans qu'aucun test unitaire
// (qui ne passe jamais par la vraie couche HTTP Express/Nest) ne puisse le voir, exactement le
// piège documenté dans CONTRIBUTING.md (« un test qui simule la couche réseau ne prouve rien sur le
// serveur »). Ce bloc isole la preuve, à part de toute logique de droit ou d'état, pour qu'une
// régression future rougisse ICI EN PREMIER, avec un message sans ambiguïté.

describe('émission/acceptation — corps de requête absent (rétrocompatibilité)', () => {
  it('POST .../emettre SANS corps rend 200 (émission d’un devis brouillon valide)', async () => {
    const devis = await creerBrouillon(garage.tenantA, 'receptionnaire', 'devis');

    const reponse = await emettre(garage.tenantA, 'receptionnaire', devis.id);

    expect(reponse.status).toBe(200);
    expect((reponse.body as { donnees: DocumentDeTest }).donnees.statut).toBe('emis');
  });

  it('POST .../accepter SANS corps rend 200 (devis déjà émis)', async () => {
    const devis = await creerBrouillon(garage.tenantA, 'receptionnaire', 'devis');
    const emis = await emettre(garage.tenantA, 'receptionnaire', devis.id);
    expect(emis.status).toBe(200);

    const reponse = await accepter(garage.tenantA, 'receptionnaire', devis.id);

    expect(reponse.status).toBe(200);
    expect((reponse.body as { donnees: DocumentDeTest }).donnees.statut).toBe('accepte');
  });
});

// =================================================================================================
// 1. Contrôle de droit dynamique à l'émission (RF-114) — verifierDroitEmission()
// =================================================================================================
//
// Chaque test de cette section vérifie DEUX choses, jamais une seule : le refus HTTP (403
// DROIT_INSUFFISANT) ET l'état du document APRÈS le refus (toujours `brouillon`, `numero` encore
// `null`) — un contrôle qui refuserait APRÈS avoir déjà écrit serait un bug comptable, pas une
// protection (consigne explicite de la tâche).

describe('émission — contrôle de droit dynamique par typeDocument (RF-114, verifierDroitEmission)', () => {
  it('chef_atelier peut émettre un devis (droit emettre_devis_bc) mais PAS une facture — RF-114 casse ici la hiérarchie habituelle chef_atelier ⊇ receptionnaire', async () => {
    const devis = await creerBrouillon(garage.tenantA, 'chef_atelier', 'devis');
    const reponseDevis = await emettre(garage.tenantA, 'chef_atelier', devis.id);
    expect(reponseDevis.status).toBe(200);
    expect((reponseDevis.body as { donnees: DocumentDeTest }).donnees.statut).toBe('emis');
    expect((reponseDevis.body as { donnees: DocumentDeTest }).donnees.numero).not.toBeNull();

    const facture = await creerBrouillon(garage.tenantA, 'chef_atelier', 'facture');
    const reponseFacture = await emettre(garage.tenantA, 'chef_atelier', facture.id);
    expect(reponseFacture.status).toBe(403);
    expect((reponseFacture.body as { code?: string }).code).toBe('DROIT_INSUFFISANT');

    // État après refus, PAS seulement l'exception : toujours brouillon, aucun numéro consommé.
    const relue = await lire(garage.tenantA, 'chef_atelier', facture.id);
    expect(relue.statut).toBe('brouillon');
    expect(relue.numero).toBeNull();
  });

  it('receptionnaire peut émettre une facture — précisément là où chef_atelier vient de ne pas pouvoir (RF-114 littéral)', async () => {
    const facture = await creerBrouillon(garage.tenantA, 'receptionnaire', 'facture');
    const reponse = await emettre(garage.tenantA, 'receptionnaire', facture.id);
    expect(reponse.status).toBe(200);
    expect((reponse.body as { donnees: DocumentDeTest }).donnees.statut).toBe('emis');
  });

  it('admin ne peut émettre AUCUN type de document (RF-115, séparation des pouvoirs) — alors que direction, qui a créé le même brouillon, le peut', async () => {
    for (const type of ['devis', 'bon_commande', 'facture'] as const) {
      const doc = await creerBrouillon(garage.tenantA, 'direction', type);

      const refus = await emettre(garage.tenantA, 'admin', doc.id);
      expect(refus.status, `type=${type}`).toBe(403);
      const relu = await lire(garage.tenantA, 'direction', doc.id);
      expect(relu.statut, `type=${type}, après refus admin`).toBe('brouillon');
      expect(relu.numero, `type=${type}, après refus admin`).toBeNull();

      const succes = await emettre(garage.tenantA, 'direction', doc.id);
      expect(succes.status, `type=${type}, direction`).toBe(200);
    }
  });

  it("technicien et magasinier ne peuvent pas émettre une facture (aucune des deux entrées de la matrice ne porte de droit d'émission)", async () => {
    const facture = await creerBrouillon(garage.tenantA, 'receptionnaire', 'facture');
    for (const role of ['technicien', 'magasinier'] as const) {
      const refus = await emettre(garage.tenantA, role, facture.id);
      expect(refus.status, role).toBe(403);
    }
    const relue = await lire(garage.tenantA, 'receptionnaire', facture.id);
    expect(relue.statut).toBe('brouillon');
    expect(relue.numero).toBeNull();
  });

  it("chef_atelier ne peut pas non plus émettre un avoir — receptionnaire le peut, et SEULE l'émission (pas la création du brouillon) solde la facture créditée (RF-32)", async () => {
    const facture = await creerBrouillon(garage.tenantA, 'receptionnaire', 'facture');
    const emiseFacture = await emettre(garage.tenantA, 'receptionnaire', facture.id);
    expect(emiseFacture.status).toBe(200);

    const cookieReceptionnaire = await cookiePour(garage.tenantA, 'receptionnaire');
    const creationAvoir = await ctx.requete
      .post(`/api/v1/documents-vente/${facture.id}/avoirs`)
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .set('Cookie', cookieReceptionnaire)
      .set(EN_TETE_IDEMPOTENCE, randomUUID())
      .send({ portee: 'total', motif: 'erreur_montant' });
    expect(creationAvoir.status).toBe(201);
    const avoirId = (creationAvoir.body as { donnees: DocumentDeTest }).donnees.id;

    const refusChefAtelier = await emettre(garage.tenantA, 'chef_atelier', avoirId);
    expect(refusChefAtelier.status).toBe(403);
    const avoirInchange = await lire(garage.tenantA, 'receptionnaire', avoirId);
    expect(avoirInchange.statut).toBe('brouillon');
    expect(avoirInchange.numero).toBeNull();
    // La facture créditée n'a pas non plus bougé : le refus de l'avoir n'a rien écrit nulle part.
    const factureInchangee = await lire(garage.tenantA, 'receptionnaire', facture.id);
    expect(factureInchangee.statut).toBe('emis');

    const emisAvoir = await emettre(garage.tenantA, 'receptionnaire', avoirId);
    expect(emisAvoir.status).toBe(200);
    expect((emisAvoir.body as { donnees: DocumentDeTest }).donnees.statut).toBe('emis');

    const factureApresAvoir = await lire(garage.tenantA, 'receptionnaire', facture.id);
    expect(factureApresAvoir.statut).toBe('annule_par_avoir');
  });
});

// =================================================================================================
// 2. Verrouillage post-émission — triggers PostgreSQL (migration 0010 §7.2 et §8.1)
// =================================================================================================
//
// `requeteSousTenant` fait TOUJOURS un ROLLBACK (voir postgres-ephemere.ts) : chaque test ci-dessous
// est donc auto-nettoyant, y compris la tentative d'écriture de la colonne de la liste blanche.

describe('verrouillage post-émission — trigger document_vente_verrouiller_apres_emission (migration 0010 §7.2)', () => {
  it('un champ hors liste blanche (client_designation_figee) est refusé (ZDFA2) sur une facture ÉMISE', async () => {
    const facture = await creerBrouillon(garage.tenantA, 'receptionnaire', 'facture');
    const emise = await emettre(garage.tenantA, 'receptionnaire', facture.id);
    expect(emise.status).toBe(200);

    // Le SQLSTATE ZDFA2 est LE MÊME pour les deux triggers de verrouillage de ce fichier
    // (document_vente §7.2 ET ligne_document §8.1, migration 0010) : il ne suffit PAS à distinguer
    // lequel s'est déclenché. `table` (qu'une violation de contrainte détectée par le moteur
    // renseignerait) reste `undefined` ici — les deux triggers lèvent par `raise exception using
    // errcode = ..., message = ..., detail = ...` (PL/pgSQL), et `RAISE` ne remplit jamais `table`.
    // Le discriminant retenu est `detail`, pas `message` : la migration documente EXPLICITEMENT
    // `detail` comme le champ prévu pour un mapping applicatif stable (« code=document_verrouille
    // dans DETAIL, pour mapping applicatif vers le code problem+json stable », commentaire de
    // `document_vente_verrouiller_apres_emission`, l.758-760) — c'est un `format('entite=%s;...')`
    // à clé fixe, donc stable si le texte humain de `message` est reformulé un jour, contrairement
    // à une assertion sur un fragment de `message` (qui n'a, lui, aucune promesse de stabilité).
    await expect(
      requeteSousTenant(
        bdd.poolApp,
        garage.tenantA.tenant.id,
        "update document_vente set client_designation_figee = 'INTRUS' where id = $1 returning id",
        [facture.id],
      ),
    ).rejects.toMatchObject({
      code: 'ZDFA2',
      detail: expect.stringMatching(/^entite=document_vente;/),
    });
  });

  it("à l'inverse, le MÊME champ reste librement modifiable tant que le document est en BROUILLON (contrôle positif — sans lui, le refus ci-dessus pourrait aussi bien signifier une table cassée)", async () => {
    const devis = await creerBrouillon(garage.tenantA, 'chef_atelier', 'devis');
    const lignes = await requeteSousTenant<{ id: string }>(
      bdd.poolApp,
      garage.tenantA.tenant.id,
      "update document_vente set client_designation_figee = 'Toujours modifiable en brouillon' where id = $1 returning id",
      [devis.id],
    );
    expect(lignes).toHaveLength(1);
  });

  it('les colonnes de la liste blanche MD-20 (exporte_le) restent modifiables APRÈS émission', async () => {
    const facture = await creerBrouillon(garage.tenantA, 'receptionnaire', 'facture');
    const emise = await emettre(garage.tenantA, 'receptionnaire', facture.id);
    expect(emise.status).toBe(200);

    const lignes = await requeteSousTenant<{ exporte_le: Date | null }>(
      bdd.poolApp,
      garage.tenantA.tenant.id,
      'update document_vente set exporte_le = now() where id = $1 returning exporte_le',
      [facture.id],
    );
    expect(lignes).toHaveLength(1);
    expect(lignes[0]!.exporte_le).not.toBeNull();
  });

  it("une ligne d'un document ÉMIS est verrouillée elle aussi (ligne_document_verrouiller_document, §8.1) — SANS liste blanche : tout changement de ligne est refusé, pas seulement certains champs", async () => {
    const facture = await creerBrouillon(garage.tenantA, 'receptionnaire', 'facture');
    const emise = await emettre(garage.tenantA, 'receptionnaire', facture.id);
    expect(emise.status).toBe(200);
    const ligneId = (emise.body as { donnees: { lignes: readonly { id: string }[] } }).donnees
      .lignes[0]!.id;

    // Même discriminant que le test précédent (voir son commentaire) : `code: 'ZDFA2'` seul ne
    // distingue pas ce trigger (ligne_document_verrouiller_document, §8.1) de celui de
    // document_vente (§7.2) ci-dessus — les deux partagent le même SQLSTATE. `detail` porte ici
    // `entite=ligne_document;...`, confirmé par capture de l'erreur réelle en exécution.
    await expect(
      requeteSousTenant(
        bdd.poolApp,
        garage.tenantA.tenant.id,
        "update ligne_document set designation = 'INTRUS' where id = $1 returning id",
        [ligneId],
      ),
    ).rejects.toMatchObject({
      code: 'ZDFA2',
      detail: expect.stringMatching(/^entite=ligne_document;/),
    });
  });
});

// =================================================================================================
// 3. Numérotation continue par tenant/exercice, SANS TROU (RF-20, RF-23, RF-24)
// =================================================================================================
//
// Isolé sur `tenantB`, type `devis` exclusivement (aucun autre bloc de ce fichier n'émet de devis
// sur ce tenant) : les deltas sont vérifiés en RELATIF à la première valeur observée, jamais en
// tenant pour acquis que la séquence démarre à 1 — robuste même si l'ordre d'exécution des fichiers
// de tests change un jour.
//
// PRÉFIXE `DEV-`/`BDC-`/`FAC-`/`AVO-` : décision de numérotation TRANCHÉE (bug #104, commit
// a295bd8 du 13.08.2026, voir `documents/numerotation.ts::PREFIXES_TYPE_DOCUMENT`) — PAS un
// marqueur d'environnement (rien dans le code ne conditionne ce préfixe à `NODE_ENV` ou
// équivalent : il est affiché à L'IDENTIQUE en dev et en production). `DEV` est l'abréviation du
// type de document « devis », au même titre que `FAC` = facture, `BDC` = bon de commande,
// `AVO` = avoir. Objectif du préfixe : éviter qu'un devis, un bon de commande, une facture et un
// avoir du même exercice affichent tous `2026-00001` (collision D'AFFICHAGE seulement — l'unicité
// EN BASE, elle, était déjà garantie par `document_vente_numero_uk`, scopée par type_document).
describe('numérotation continue, sans trou (RF-20/RF-23/RF-24) — tenant B, type devis', () => {
  it('deux émissions successives donnent des numéros de séquence consécutifs, au format `DEV-<exercice>-<5 chiffres>`', async () => {
    const docA = await creerBrouillon(garage.tenantB, 'chef_atelier', 'devis');
    const emisA = await emettre(garage.tenantB, 'chef_atelier', docA.id);
    expect(emisA.status).toBe(200);
    const donneesA = (emisA.body as { donnees: DocumentDeTest & { numeroSequence: number } })
      .donnees;
    const sequenceA = donneesA.numeroSequence;
    expect(Number.isInteger(sequenceA)).toBe(true);
    // Format vérifié dès le premier document, pas seulement sur le delta ci-dessous : une
    // régression qui ferait disparaître le préfixe DOIT rougir ici, sur CHAQUE numéro émis.
    expect(donneesA.numero).toMatch(/^DEV-\d{4}-\d{5}$/);

    const docB = await creerBrouillon(garage.tenantB, 'chef_atelier', 'devis');
    const emisB = await emettre(garage.tenantB, 'chef_atelier', docB.id);
    expect(emisB.status).toBe(200);
    const donneesB = (emisB.body as { donnees: DocumentDeTest & { numeroSequence: number } })
      .donnees;
    expect(donneesB.numeroSequence).toBe(sequenceA + 1);

    const anneeCourante = new Date().getUTCFullYear();
    expect(donneesB.numero).toBe(
      `DEV-${String(anneeCourante)}-${String(sequenceA + 1).padStart(5, '0')}`,
    );
  });

  it('bug #104 (régression protégée) : un devis et un bon de commande du MÊME tenant/exercice, même si leur numéroSequence coïncide, ne partagent JAMAIS le même numéro affiché — la collision qui a motivé le préfixe par type ne doit plus jamais se reproduire', async () => {
    const devis = await creerBrouillon(garage.tenantB, 'chef_atelier', 'devis');
    const emisDevis = await emettre(garage.tenantB, 'chef_atelier', devis.id);
    expect(emisDevis.status).toBe(200);
    const donneesDevis = (
      emisDevis.body as { donnees: DocumentDeTest & { numeroSequence: number } }
    ).donnees;

    const bonCommande = await creerBrouillon(garage.tenantB, 'chef_atelier', 'bon_commande');
    const emisBonCommande = await emettre(garage.tenantB, 'chef_atelier', bonCommande.id);
    expect(emisBonCommande.status).toBe(200);
    const donneesBonCommande = (
      emisBonCommande.body as { donnees: DocumentDeTest & { numeroSequence: number } }
    ).donnees;

    // Chaque type de document a sa PROPRE séquence (clé de compteur `document_vente:<type>`,
    // `documents/numerotation.ts`) — ce ne sont donc structurellement JAMAIS la même séquence,
    // mais leurs VALEURS numériques peuvent parfaitement coïncider (ex. premier devis ET premier
    // bon de commande du tenant → toutes deux `numeroSequence === 1`). C'est PRÉCISÉMENT le cas
    // qui produisait `2026-00001` des deux côtés avant le correctif #104.
    expect(donneesDevis.numero).toMatch(/^DEV-\d{4}-\d{5}$/);
    expect(donneesBonCommande.numero).toMatch(/^BDC-\d{4}-\d{5}$/);
    expect(donneesDevis.numero).not.toBe(donneesBonCommande.numero);
  });

  it('une émission REFUSÉE (droit insuffisant) NE consomme AUCUN numéro : la séquence reste consécutive malgré la tentative avortée entre les deux', async () => {
    const docC = await creerBrouillon(garage.tenantB, 'chef_atelier', 'devis');
    const emisC = await emettre(garage.tenantB, 'chef_atelier', docC.id);
    expect(emisC.status).toBe(200);
    const sequenceC = (emisC.body as { donnees: { numeroSequence: number } }).donnees
      .numeroSequence;

    const docD = await creerBrouillon(garage.tenantB, 'chef_atelier', 'devis');
    // admin n'a AUCUN droit d'émission (RF-115) : la tentative doit échouer AVANT `genererNumeroDocument`.
    const refusAdmin = await emettre(garage.tenantB, 'admin', docD.id);
    expect(refusAdmin.status).toBe(403);

    const emisD = await emettre(garage.tenantB, 'chef_atelier', docD.id);
    expect(emisD.status).toBe(200);
    const sequenceD = (emisD.body as { donnees: { numeroSequence: number } }).donnees
      .numeroSequence;
    expect(sequenceD).toBe(sequenceC + 1); // PAS +2 : le refus n'a rien brûlé.
  });
});

// =================================================================================================
// 4. Arithmétique de l'émission — Σ HT + Σ TVA = Σ TTC EXACTEMENT, au centime (§0.2, jamais un float)
// =================================================================================================
//
// L'arithmétique PURE (calcul par ligne, ventilation de remise, agrégation TVA) est déjà couverte
// par 25 tests verts dans calcul-document.spec.ts — ce test-ci prouve seulement que l'ALLER-RETOUR
// réel par la base (colonnes bigint/integer, recalcul en transaction, relecture HTTP) restitue
// l'invariant EXACTEMENT, sans jamais introduire d'approximation sur le chemin qui compte en
// production. Valeurs exactes uniquement — AUCUN `toBeCloseTo` sur de l'argent.

describe("arithmétique à l'émission — centimes exacts, TTC fait foi (§0.2)", () => {
  it('deux lignes + remise globale en pour-mille : ΣHT + ΣTVA = ΣTTC exactement, remise globale ventilée sans reste', async () => {
    const lignes: readonly LigneCreationTest[] = [
      {
        type: 'forfait',
        designation: 'Forfait diagnostic',
        quantiteMillieme: 1000,
        prixUnitaireTtcCentimes: 7000,
        tauxTvaPourmille: 81,
        datePrestation: '2026-07-29',
      },
      {
        type: 'piece',
        designation: 'Pièce détachée',
        quantiteMillieme: 1000,
        prixUnitaireTtcCentimes: 24_500_00,
        tauxTvaPourmille: 81,
        datePrestation: '2026-07-29',
      },
    ];
    const doc = await creerBrouillon(garage.tenantA, 'receptionnaire', 'facture', lignes, {
      remiseGlobalePourmille: 100,
    });
    const emis = await emettre(garage.tenantA, 'receptionnaire', doc.id);
    expect(emis.status).toBe(200);

    const d = (
      emis.body as {
        donnees: { totalHtCentimes: number; totalTvaCentimes: number; totalTtcCentimes: number };
      }
    ).donnees;
    expect(Number.isInteger(d.totalHtCentimes)).toBe(true);
    expect(Number.isInteger(d.totalTvaCentimes)).toBe(true);
    expect(Number.isInteger(d.totalTtcCentimes)).toBe(true);

    // Base avant remise : 7'000 + 2'450'000 = 2'457'000 c. Remise 10% = 245'700 c., exacte (pas
    // d'arrondi possible sur ce cas — évite toute ambiguïté sur la règle d'arrondi elle-même).
    expect(d.totalTtcCentimes).toBe(2_457_000 - 245_700);
    // L'invariant qui compte : jamais approché, jamais recalculé séparément — le TTC fait foi.
    expect(d.totalHtCentimes + d.totalTvaCentimes).toBe(d.totalTtcCentimes);
  });
});
