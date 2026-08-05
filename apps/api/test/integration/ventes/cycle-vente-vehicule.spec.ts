/**
 * Cycle de vente d'un véhicule, de bout en bout, sur vraie base PostgreSQL (testcontainers), vraie
 * app NestJS, vraies requêtes HTTP (`supertest`) — `dossier-vente.controller.ts`,
 * `vehicule-stock.controller.ts`, `financement.controller.ts`,
 * `facturation/documents/document-vente.controller.ts`. Voir `fixtures-cycle-vente.ts` pour le
 * détail des aides et la preuve de l'arithmétique de la ligne primitive réutilisée ici.
 *
 * CONTEXTE (brief de cette tâche) : la colonne qui relie un document de vente à son dossier
 * (`document_vente.dossier_vente_id`, `MD-70`) n'était jamais écrite il y a deux jours — ce cycle
 * était ALORS totalement inatteignable (`engager` ne pouvait jamais recevoir de bon de commande
 * valide, `livrer` restait bloqué à jamais faute d'un chemin qui marque le véhicule `vendu`, voir
 * `service-vehicule-stock.ts::marquerVendu`, section « TROU COMBLÉ »). Corrigé et vérifié à la
 * main ; ce fichier est la preuve AUTOMATISÉE, exécutée contre une vraie base, que la régression ne
 * repasse pas inaperçue.
 *
 * DISCIPLINE ANTI-COLLISION (piège déjà rencontré sur ce dépôt — une période de détention partagée
 * entre deux scénarios avait fait échouer une livraison, un test d'encours dépendait d'une facture
 * créée par un test voisin) : CHAQUE `it` sème son PROPRE véhicule (via `POST /vehicules`, jamais
 * un véhicule de `garage.tenantA.vehicules`, potentiellement réutilisé ailleurs) et son PROPRE
 * dossier de vente. Aucun test de ce fichier ne dépend d'un état laissé par un autre — l'ordre
 * d'exécution ne doit rien changer au résultat.
 *
 * Périmètre d'écriture : `apps/api/test/**` uniquement (CONTRIBUTING.md, brief de cette tâche).
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { demarrerBaseEphemere, type BaseEphemere } from '../../setup/postgres-ephemere';
import {
  creerAppTest,
  demarrerRedisEphemere,
  type AppTest,
  type RedisEphemere,
} from '../../setup/app-test';
import { semerGarageDemoLot1, type GarageDemoLot1Fixture } from '../../lot1/fixtures/garage-demo-lot1';
import { creerDepotPneusPourTest } from '../../lot2/fixtures/garage-demo-lot2';
import {
  amenerDossierJusquAPretALivrer,
  cloturer,
  construireCookiePour,
  creerDocumentVente,
  creerDossier,
  creerFinancementComptant,
  creerVehicule,
  emettreDocument,
  engager,
  getDossier,
  getVehiculeStock,
  livrer,
  marquerPretALivrer,
  marquerVenduDirect,
  mettreEnStock,
  preparer,
  PRIMITIVE_HT,
  PRIMITIVE_TTC,
  PRIMITIVE_TVA,
  remettreDisponible,
} from './fixtures-cycle-vente';

let bdd: BaseEphemere;
let garage: GarageDemoLot1Fixture;
let redis: RedisEphemere;
let ctx: AppTest;
let cookiePour: ReturnType<typeof construireCookiePour>;

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  garage = await semerGarageDemoLot1(bdd);
  redis = await demarrerRedisEphemere();
  ctx = await creerAppTest(bdd, redis.url);
  cookiePour = construireCookiePour(ctx);
}, 180_000);

afterAll(async () => {
  await ctx?.fermer();
  await redis?.fermer();
  await bdd?.fermer();
});

const SITE_A = () => garage.tenantA.tenant.sites[0]!.id;
const CLIENT_A = () => garage.tenantA.clients[0]!.id;

// =================================================================================================
// 1. Cycle nominal — chaque transition rend le statut attendu, jusqu'à `clos`.
// =================================================================================================

describe('cycle nominal : créer un dossier → bon de commande → engager → préparer → prêt à livrer → livrer → clôturer', () => {
  it("chaque étape avance le dossier au statut attendu, et l'émission de la facture marque le véhicule vendu avant la livraison", async () => {
    const cookie = await cookiePour(garage.tenantA, 'direction');
    const site = SITE_A();
    const client = CLIENT_A();

    // 1. Véhicule + extension stock — `disponible` d'emblée (VIN connu, provenance non VN).
    const vehicule = await creerVehicule(ctx, cookie, randomUUID());
    expect(vehicule.status, JSON.stringify(vehicule.body)).toBe(201);
    const vehiculeId = (vehicule.body.donnees as { id: string }).id;

    const stock = await mettreEnStock(ctx, cookie, vehiculeId, site);
    expect(stock.status, JSON.stringify(stock.body)).toBe(201);
    expect((stock.body.donnees as { statutCommercial: string }).statutCommercial).toBe('disponible');

    // 2. Dossier de vente — `prospection`, véhicule déjà associé (RV-30 l'autorise dès la création).
    const dossier = await creerDossier(ctx, cookie, {
      siteId: site,
      clientAcheteurId: client,
      vehiculeId,
    });
    expect(dossier.status, JSON.stringify(dossier.body)).toBe(201);
    const dossierId = (dossier.body.donnees as { id: string }).id;
    expect((dossier.body.donnees as { statut: string }).statut).toBe('prospection');
    expect((dossier.body.donnees as { vehicule: { id: string } | null }).vehicule?.id).toBe(vehiculeId);

    // 3. Bon de commande rattaché (`dossierVenteId`, MD-70) — créé PUIS émis (numéro légal).
    const bonCommandeBrouillon = await creerDocumentVente(ctx, cookie, {
      typeDocument: 'bon_commande',
      siteId: site,
      clientId: client,
      dateDocument: '2026-01-10',
      dossierVenteId: dossierId,
      vehiculeId,
      nombreLignesPrimitives: 1,
    });
    expect(bonCommandeBrouillon.status, JSON.stringify(bonCommandeBrouillon.body)).toBe(201);
    const bonCommandeEmis = await emettreDocument(
      ctx,
      cookie,
      (bonCommandeBrouillon.body.donnees as { id: string }).id,
    );
    expect(bonCommandeEmis.status, JSON.stringify(bonCommandeEmis.body)).toBe(200);
    const bonCommandeId = (bonCommandeEmis.body.donnees as { id: string; numero: string }).id;
    expect((bonCommandeEmis.body.donnees as { numero: string | null }).numero).not.toBeNull();

    // 4. `engager` — `prospection -> engage` (RV-32), véhicule associé -> `reserve`.
    const engagement = await engager(ctx, cookie, dossierId, bonCommandeId, 'carte_identite');
    expect(engagement.status, JSON.stringify(engagement.body)).toBeLessThan(300);
    expect((engagement.body.donnees as { statut: string }).statut).toBe('engage');
    expect((engagement.body.donnees as { identitePieceType: string | null }).identitePieceType).toBe(
      'carte_identite',
    );
    expect((engagement.body.donnees as { engageLe: string | null }).engageLe).not.toBeNull();

    const stockApresEngagement = await getVehiculeStock(ctx, cookie, vehiculeId);
    expect(stockApresEngagement.status).toBe(200);
    expect((stockApresEngagement.body as { statutCommercial: string }).statutCommercial).toBe('reserve');

    // 5. `preparer` — `engage -> en_preparation`.
    const preparation = await preparer(ctx, cookie, dossierId);
    expect(preparation.status, JSON.stringify(preparation.body)).toBeLessThan(300);
    expect((preparation.body.donnees as { statut: string }).statut).toBe('en_preparation');
    expect((preparation.body.donnees as { enPreparationLe: string | null }).enPreparationLe).not.toBeNull();

    // 6. Financement `comptant` — confirmé d'emblée (RV-44), condition de `marquer-pret-a-livrer` (RV-37).
    const financement = await creerFinancementComptant(ctx, cookie, dossierId);
    expect(financement.status, JSON.stringify(financement.body)).toBe(201);
    expect((financement.body.donnees as { statutConfirmation: string }).statutConfirmation).toBe(
      'confirme',
    );

    // 7. `marquer-pret-a-livrer` — `en_preparation -> pret_a_livrer`.
    const pret = await marquerPretALivrer(ctx, cookie, dossierId);
    expect(pret.status, JSON.stringify(pret.body)).toBeLessThan(300);
    expect((pret.body.donnees as { statut: string }).statut).toBe('pret_a_livrer');
    expect((pret.body.donnees as { pretALivrerLe: string | null }).pretALivrerLe).not.toBeNull();

    // 8. Facture rattachée au dossier — l'ÉMISSION marque le véhicule `vendu` (RV-37), effet de bord
    //    PROGRAMMATIQUE hors de la transaction SQL de l'émission elle-même (voir la fixture n°3
    //    ci-dessous pour la preuve directe de cette désynchronisation) : ici on vérifie seulement
    //    que dans le cas NOMINAL (rien ne perturbe le marquage), le résultat visible est cohérent —
    //    aucun avertissement, véhicule bien `vendu` avant que `livrer` ne soit appelé.
    const factureBrouillon = await creerDocumentVente(ctx, cookie, {
      typeDocument: 'facture',
      siteId: site,
      clientId: client,
      dateDocument: '2026-01-15',
      dossierVenteId: dossierId,
      vehiculeId,
      nombreLignesPrimitives: 2,
    });
    expect(factureBrouillon.status, JSON.stringify(factureBrouillon.body)).toBe(201);
    const factureEmise = await emettreDocument(
      ctx,
      cookie,
      (factureBrouillon.body.donnees as { id: string }).id,
    );
    expect(factureEmise.status, JSON.stringify(factureEmise.body)).toBe(200);
    expect(factureEmise.body.avertissements).toEqual([]);
    const factureDonnees = factureEmise.body.donnees as {
      numero: string | null;
      totalHtCentimes: number;
      totalTvaCentimes: number;
      totalTtcCentimes: number;
    };
    expect(factureDonnees.numero).not.toBeNull();
    // Arithmétique exacte, jamais approximative — 2 copies de la ligne primitive (voir la preuve du
    // calcul en tête de `fixtures-cycle-vente.ts`).
    expect(factureDonnees.totalHtCentimes).toBe(2 * PRIMITIVE_HT);
    expect(factureDonnees.totalTvaCentimes).toBe(2 * PRIMITIVE_TVA);
    expect(factureDonnees.totalTtcCentimes).toBe(2 * PRIMITIVE_TTC);

    const stockApresFacture = await getVehiculeStock(ctx, cookie, vehiculeId);
    expect(stockApresFacture.status).toBe(200);
    expect((stockApresFacture.body as { statutCommercial: string }).statutCommercial).toBe('vendu');
    expect((stockApresFacture.body as { venduLe: string | null }).venduLe).not.toBeNull();

    // 9. `livrer` — `pret_a_livrer -> livre` (RV-52/RV-53), désormais possible : le véhicule est `vendu`.
    const livraison = await livrer(ctx, cookie, dossierId, '2026-01-20', 15_000);
    expect(livraison.status, JSON.stringify(livraison.body)).toBeLessThan(300);
    expect((livraison.body.donnees as { statut: string }).statut).toBe('livre');
    expect((livraison.body.donnees as { livreLe: string | null }).livreLe).not.toBeNull();
    expect(
      (livraison.body.donnees as { dateLivraisonEffective: string | null }).dateLivraisonEffective,
    ).toBe('2026-01-20');

    const stockApresLivraison = await getVehiculeStock(ctx, cookie, vehiculeId);
    expect((stockApresLivraison.body as { statutCommercial: string }).statutCommercial).toBe('livre');
    expect((stockApresLivraison.body as { livreLe: string | null }).livreLe).not.toBeNull();

    // 10. `cloturer` — `livre -> clos`, dernière étape purement administrative.
    const cloture = await cloturer(ctx, cookie, dossierId);
    expect(cloture.status, JSON.stringify(cloture.body)).toBeLessThan(300);
    expect((cloture.body.donnees as { statut: string }).statut).toBe('clos');
    expect((cloture.body.donnees as { closLe: string | null }).closLe).not.toBeNull();

    // Relecture finale — la fiche complète reflète l'état terminal, indépendamment des réponses
    // intermédiaires déjà vérifiées ci-dessus.
    const releture = await getDossier(ctx, cookie, dossierId);
    expect(releture.status).toBe(200);
    expect((releture.body as { statut: string }).statut).toBe('clos');
    expect((releture.body as { documents: readonly { typeDocument: string }[] }).documents.map(
      (d) => d.typeDocument,
    )).toEqual(expect.arrayContaining(['bon_commande', 'facture']));
  });
});

// =================================================================================================
// 2. Transitions interdites — refusées avec un code métier stable, jamais une erreur serveur.
// =================================================================================================

describe('transitions interdites — code métier stable (409/404), jamais 500', () => {
  it('engager un dossier SANS véhicule associé est refusé (409 VENTE_VEHICULE_MANQUANT)', async () => {
    const cookie = await cookiePour(garage.tenantA, 'direction');
    const dossier = await creerDossier(ctx, cookie, {
      siteId: SITE_A(),
      clientAcheteurId: CLIENT_A(),
    });
    expect(dossier.status, JSON.stringify(dossier.body)).toBe(201);
    const dossierId = (dossier.body.donnees as { id: string }).id;

    const engagement = await engager(ctx, cookie, dossierId, randomUUID());
    expect(engagement.status, JSON.stringify(engagement.body)).toBe(409);
    expect(engagement.body.code).toBe('VENTE_VEHICULE_MANQUANT');

    // Le dossier n'a PAS bougé — toujours `prospection`.
    const releture = await getDossier(ctx, cookie, dossierId);
    expect((releture.body as { statut: string }).statut).toBe('prospection');
  });

  it("engager avec un bonCommandeDocumentId qui n'existe pas est refusé (404 RESSOURCE_INTROUVABLE), le véhicule reste disponible", async () => {
    const cookie = await cookiePour(garage.tenantA, 'direction');
    const site = SITE_A();
    const vehicule = await creerVehicule(ctx, cookie, randomUUID());
    const vehiculeId = (vehicule.body.donnees as { id: string }).id;
    await mettreEnStock(ctx, cookie, vehiculeId, site);

    const dossier = await creerDossier(ctx, cookie, {
      siteId: site,
      clientAcheteurId: CLIENT_A(),
      vehiculeId,
    });
    const dossierId = (dossier.body.donnees as { id: string }).id;

    const engagement = await engager(ctx, cookie, dossierId, randomUUID());
    expect(engagement.status, JSON.stringify(engagement.body)).toBe(404);
    expect(engagement.body.code).toBe('RESSOURCE_INTROUVABLE');

    const stock = await getVehiculeStock(ctx, cookie, vehiculeId);
    expect((stock.body as { statutCommercial: string }).statutCommercial).toBe('disponible');
  });

  it(
    'livrer un dossier prêt à livrer dont le véhicule n’est PAS encore vendu (facture jamais émise) ' +
      'est refusé (409 VENTE_VEHICULE_INDISPONIBLE) — LA non-régression principale de cette tâche : ce ' +
      'cycle était inatteignable avant que `document_vente.dossier_vente_id` ne soit correctement écrit',
    async () => {
      const cookie = await cookiePour(garage.tenantA, 'direction');
      const { dossierVenteId, vehiculeId } = await amenerDossierJusquAPretALivrer(
        ctx,
        cookie,
        SITE_A(),
        CLIENT_A(),
        randomUUID(),
      );

      // Aucune facture émise : le véhicule est encore `reserve`, jamais `vendu`.
      const stockAvant = await getVehiculeStock(ctx, cookie, vehiculeId);
      expect((stockAvant.body as { statutCommercial: string }).statutCommercial).toBe('reserve');

      const livraison = await livrer(ctx, cookie, dossierVenteId, '2026-02-01', 0);
      expect(livraison.status, JSON.stringify(livraison.body)).toBe(409);
      expect(livraison.body.code).toBe('VENTE_VEHICULE_INDISPONIBLE');

      // Ni le dossier ni le véhicule n'ont bougé.
      const releture = await getDossier(ctx, cookie, dossierVenteId);
      expect((releture.body as { statut: string }).statut).toBe('pret_a_livrer');
      const stockApres = await getVehiculeStock(ctx, cookie, vehiculeId);
      expect((stockApres.body as { statutCommercial: string }).statutCommercial).toBe('reserve');
    },
  );

  it('sauter une étape (clôturer un dossier encore en `prospection`) est refusé (409 VENTE_DOSSIER_TRANSITION_INTERDITE)', async () => {
    const cookie = await cookiePour(garage.tenantA, 'direction');
    const dossier = await creerDossier(ctx, cookie, {
      siteId: SITE_A(),
      clientAcheteurId: CLIENT_A(),
    });
    const dossierId = (dossier.body.donnees as { id: string }).id;

    const cloture = await cloturer(ctx, cookie, dossierId);
    expect(cloture.status, JSON.stringify(cloture.body)).toBe(409);
    expect(cloture.body.code).toBe('VENTE_DOSSIER_TRANSITION_INTERDITE');

    const releture = await getDossier(ctx, cookie, dossierId);
    expect((releture.body as { statut: string }).statut).toBe('prospection');
  });

  it(
    'rejouer une transition déjà faite (`engager` une seconde fois sur un dossier déjà `engage`) est ' +
      'refusé (409 VENTE_VEHICULE_INDISPONIBLE — le véhicule n’est plus `disponible`, il est déjà ' +
      '`reserve` par le premier engagement) — PAS `VENTE_DOSSIER_TRANSITION_INTERDITE` : le trigger SQL ' +
      "générique (`verifier_transition()`, `db/migrations/0003_prealables_etape1.sql`) traite une " +
      "écriture qui ne CHANGE PAS le statut (« engage » -> « engage ») comme un non-événement et " +
      "laisserait passer un second `engager()` sans la garde applicative explicite sur le véhicule — " +
      "constaté en exécution réelle : `preparer`/`marquer-pret-a-livrer`/`cloturer` n'ont PAS cette " +
      'garde et acceptent silencieusement un second appel identique (seul le champ horodatage change) ; ' +
      "`engager`/`livrer` en ont une (véhicule), c'est elle qui rend le rejeu réellement impossible ici.",
    async () => {
      const cookie = await cookiePour(garage.tenantA, 'direction');
      const site = SITE_A();
      const vehicule = await creerVehicule(ctx, cookie, randomUUID());
      const vehiculeId = (vehicule.body.donnees as { id: string }).id;
      await mettreEnStock(ctx, cookie, vehiculeId, site);
      const dossier = await creerDossier(ctx, cookie, {
        siteId: site,
        clientAcheteurId: CLIENT_A(),
        vehiculeId,
      });
      const dossierId = (dossier.body.donnees as { id: string }).id;

      const bonCommandeBrouillon = await creerDocumentVente(ctx, cookie, {
        typeDocument: 'bon_commande',
        siteId: site,
        clientId: CLIENT_A(),
        dateDocument: '2026-01-10',
        dossierVenteId: dossierId,
        vehiculeId,
        nombreLignesPrimitives: 1,
      });
      const bonCommandeEmis = await emettreDocument(
        ctx,
        cookie,
        (bonCommandeBrouillon.body.donnees as { id: string }).id,
      );
      const bonCommandeId = (bonCommandeEmis.body.donnees as { id: string }).id;

      const premierEngagement = await engager(ctx, cookie, dossierId, bonCommandeId);
      expect(premierEngagement.status, JSON.stringify(premierEngagement.body)).toBeLessThan(300);
      expect((premierEngagement.body.donnees as { statut: string }).statut).toBe('engage');

      const secondEngagement = await engager(ctx, cookie, dossierId, bonCommandeId);
      expect(secondEngagement.status, JSON.stringify(secondEngagement.body)).toBe(409);
      expect(secondEngagement.body.code).toBe('VENTE_VEHICULE_INDISPONIBLE');

      // Le statut reste EXACTEMENT celui posé par le PREMIER engagement, pas altéré par le second.
      const releture = await getDossier(ctx, cookie, dossierId);
      expect((releture.body as { statut: string }).statut).toBe('engage');
    },
  );

  it('un rôle sans le droit `ventes.dossier.engager` (réceptionnaire) est refusé 403, jamais 500', async () => {
    const cookieReceptionnaire = await cookiePour(garage.tenantA, 'receptionnaire');
    const cookieDirection = await cookiePour(garage.tenantA, 'direction');
    const dossier = await creerDossier(ctx, cookieDirection, {
      siteId: SITE_A(),
      clientAcheteurId: CLIENT_A(),
    });
    const dossierId = (dossier.body.donnees as { id: string }).id;

    const engagement = await engager(ctx, cookieReceptionnaire, dossierId, randomUUID());
    expect(engagement.status, JSON.stringify(engagement.body)).toBe(403);
    expect(engagement.body.code).toBe('DROIT_INSUFFISANT');
  });
});

// =================================================================================================
// 3. Émission d'une facture rattachée : marque le véhicule vendu (RV-37) — jamais une facture NON
//    rattachée. Le marquage n'est PAS dans la même transaction SQL que l'émission
//    (`service-emission.ts::marquerVehiculeVenduSiApplicable`) : ordre choisi pour rendre
//    IMPOSSIBLE le cas dangereux « véhicule vendu sans facture », prouvé directement ci-dessous en
//    provoquant un échec RÉEL du marquage (vraie base, aucun mock) après une émission qui, elle,
//    réussit et reste acquise.
// =================================================================================================

describe('émission de facture rattachée à un dossier de vente : marquage vendu (RV-37/MD-70)', () => {
  it('facture NON rattachée (aucun dossierVenteId) : le véhicule associé en ligne reste totalement inchangé', async () => {
    const cookie = await cookiePour(garage.tenantA, 'direction');
    const site = SITE_A();
    const client = CLIENT_A();
    const vehicule = await creerVehicule(ctx, cookie, randomUUID());
    const vehiculeId = (vehicule.body.donnees as { id: string }).id;
    await mettreEnStock(ctx, cookie, vehiculeId, site);

    const factureBrouillon = await creerDocumentVente(ctx, cookie, {
      typeDocument: 'facture',
      siteId: site,
      clientId: client,
      dateDocument: '2026-01-12',
      vehiculeId, // porté par la ligne du document, mais SANS dossierVenteId
      nombreLignesPrimitives: 1,
    });
    expect(factureBrouillon.status, JSON.stringify(factureBrouillon.body)).toBe(201);
    const factureEmise = await emettreDocument(
      ctx,
      cookie,
      (factureBrouillon.body.donnees as { id: string }).id,
    );
    expect(factureEmise.status, JSON.stringify(factureEmise.body)).toBe(200);
    expect(factureEmise.body.avertissements).toEqual([]);

    const stock = await getVehiculeStock(ctx, cookie, vehiculeId);
    expect(stock.status).toBe(200);
    // Comportement INCHANGÉ depuis l'étape 2 (non-régression explicite, même nom de test que
    // `service-emission-marquage-vendu.spec.ts`) : sans `dossierVenteId`, `ServiceVehiculeStock.
    // marquerVendu` n'est jamais invoqué, le véhicule reste `disponible`.
    expect((stock.body as { statutCommercial: string }).statutCommercial).toBe('disponible');
    expect((stock.body as { venduLe: string | null }).venduLe).toBeNull();
  });

  it(
    "le marquage vendu ÉCHOUE après l'émission (véhicule remis disponible entre-temps, vraie base — " +
      'aucun mock) : la facture reste ÉMISE (numéro consommé, jamais annulée) et un avertissement ' +
      'VENTE_VEHICULE_MARQUAGE_VENDU_ECHOUE porte le détail — preuve directe que « véhicule vendu sans ' +
      "facture » ne peut PAS arriver par ce chemin : la facture est déjà commise avant la tentative de " +
      'marquage, jamais l’inverse',
    async () => {
      const cookie = await cookiePour(garage.tenantA, 'direction');
      const site = SITE_A();
      const client = CLIENT_A();
      const { dossierVenteId, vehiculeId } = await amenerDossierJusquAPretALivrer(
        ctx,
        cookie,
        site,
        client,
        randomUUID(),
      );

      // Le véhicule est `reserve` (posé par `engager`) — on le remet `disponible` manuellement,
      // exactement le scénario « véhicule déjà repris entre-temps » anticipé par la docstring de
      // `ServiceVehiculeStock.marquerVendu`. `marquerVendu` exige `reserve` : ce retour en arrière
      // le fera échouer PLUS TARD, une fois la facture déjà émise.
      const remise = await remettreDisponible(ctx, cookie, vehiculeId);
      expect(remise.status, JSON.stringify(remise.body)).toBeLessThan(300);
      expect((remise.body.donnees as { statutCommercial: string }).statutCommercial).toBe('disponible');

      const factureBrouillon = await creerDocumentVente(ctx, cookie, {
        typeDocument: 'facture',
        siteId: site,
        clientId: client,
        dateDocument: '2026-01-18',
        dossierVenteId,
        vehiculeId,
        nombreLignesPrimitives: 1,
      });
      expect(factureBrouillon.status, JSON.stringify(factureBrouillon.body)).toBe(201);
      const factureEmise = await emettreDocument(
        ctx,
        cookie,
        (factureBrouillon.body.donnees as { id: string }).id,
      );

      // La facture est ÉMISE malgré tout : 200, numéro consommé — JAMAIS annulée par un échec du
      // marquage (MD-20/MD-21 : seul un avoir corrige un document émis, pas un rollback silencieux).
      expect(factureEmise.status, JSON.stringify(factureEmise.body)).toBe(200);
      const factureDonnees = factureEmise.body.donnees as { id: string; numero: string | null };
      expect(factureDonnees.numero).not.toBeNull();

      expect(factureEmise.body.avertissements).toHaveLength(1);
      expect(factureEmise.body.avertissements).toEqual([
        expect.objectContaining({
          code: 'VENTE_VEHICULE_MARQUAGE_VENDU_ECHOUE',
          donnees: expect.objectContaining({
            documentId: factureDonnees.id,
            dossierVenteId,
            vehiculeId,
          }) as unknown,
        }) as unknown,
      ]);

      // Le véhicule n'a PAS été marqué vendu : la désynchronisation transactionnelle est bien
      // réelle, pas seulement documentée en commentaire — état dégradé mais recouvrable PAR
      // CONCEPTION (`POST /vehicules/{id}/stock/marquer-vendu`, correction manuelle).
      const stock = await getVehiculeStock(ctx, cookie, vehiculeId);
      expect((stock.body as { statutCommercial: string }).statutCommercial).toBe('disponible');
    },
  );
});

// =================================================================================================
// 4. RPP-06 : vendre un véhicule signale ses dépôts de pneus encore ouverts, sans jamais bloquer la
//    vente ni rien transférer (les pneus appartiennent au client, les inclure est une décision
//    commerciale). Exercé directement par `POST /vehicules/{id}/stock/marquer-vendu` — le chemin
//    qui rend RÉELLEMENT ce signalement à l'appelant (voir le test documenté en fin de section pour
//    la limite constatée du chemin automatique via l'émission de facture).
// =================================================================================================

describe('RPP-06 — dépôts de pneus ouverts signalés à la vente, jamais bloquants', () => {
  it('un véhicule vendu AVEC un dépôt de pneus encore ouvert porte l’avertissement VEHICULE_DEPOTS_PNEUS_OUVERTS, la vente aboutit quand même', async () => {
    const cookie = await cookiePour(garage.tenantA, 'direction');
    const site = SITE_A();
    const vehicule = await creerVehicule(ctx, cookie, randomUUID());
    const vehiculeId = (vehicule.body.donnees as { id: string }).id;
    const stock = await mettreEnStock(ctx, cookie, vehiculeId, site);
    // `marquerVendu` exige `reserve` — on y engage le véhicule (dossier minimal, sans passer par
    // tout le cycle : seul l'état `reserve` du véhicule compte ici).
    const dossier = await creerDossier(ctx, cookie, {
      siteId: site,
      clientAcheteurId: CLIENT_A(),
      vehiculeId,
    });
    const dossierId = (dossier.body.donnees as { id: string }).id;
    const bonCommandeBrouillon = await creerDocumentVente(ctx, cookie, {
      typeDocument: 'bon_commande',
      siteId: site,
      clientId: CLIENT_A(),
      dateDocument: '2026-01-08',
      dossierVenteId: dossierId,
      vehiculeId,
      nombreLignesPrimitives: 1,
    });
    const bonCommandeEmis = await emettreDocument(
      ctx,
      cookie,
      (bonCommandeBrouillon.body.donnees as { id: string }).id,
    );
    await engager(ctx, cookie, dossierId, (bonCommandeEmis.body.donnees as { id: string }).id);
    expect((stock.body.donnees as { statutCommercial: string }).statutCommercial).toBe('disponible');

    await creerDepotPneusPourTest(bdd, garage.tenantA.tenant, vehiculeId, site, {
      saison: 'hiver',
      statut: 'en_depot',
    });

    const marquage = await marquerVenduDirect(ctx, cookie, vehiculeId);
    expect(marquage.status, JSON.stringify(marquage.body)).toBeLessThan(300);
    expect((marquage.body.donnees as { statutCommercial: string }).statutCommercial).toBe('vendu');
    expect(marquage.body.avertissements).toHaveLength(1);
    expect(marquage.body.avertissements).toEqual([
      expect.objectContaining({ code: 'VEHICULE_DEPOTS_PNEUS_OUVERTS' }) as unknown,
    ]);
  });

  it('un véhicule vendu SANS aucun dépôt de pneus ne porte aucun avertissement', async () => {
    const cookie = await cookiePour(garage.tenantA, 'direction');
    const site = SITE_A();
    const vehicule = await creerVehicule(ctx, cookie, randomUUID());
    const vehiculeId = (vehicule.body.donnees as { id: string }).id;
    await mettreEnStock(ctx, cookie, vehiculeId, site);
    const dossier = await creerDossier(ctx, cookie, {
      siteId: site,
      clientAcheteurId: CLIENT_A(),
      vehiculeId,
    });
    const dossierId = (dossier.body.donnees as { id: string }).id;
    const bonCommandeBrouillon = await creerDocumentVente(ctx, cookie, {
      typeDocument: 'bon_commande',
      siteId: site,
      clientId: CLIENT_A(),
      dateDocument: '2026-01-08',
      dossierVenteId: dossierId,
      vehiculeId,
      nombreLignesPrimitives: 1,
    });
    const bonCommandeEmis = await emettreDocument(
      ctx,
      cookie,
      (bonCommandeBrouillon.body.donnees as { id: string }).id,
    );
    await engager(ctx, cookie, dossierId, (bonCommandeEmis.body.donnees as { id: string }).id);

    const marquage = await marquerVenduDirect(ctx, cookie, vehiculeId);
    expect(marquage.status, JSON.stringify(marquage.body)).toBeLessThan(300);
    expect((marquage.body.donnees as { statutCommercial: string }).statutCommercial).toBe('vendu');
    expect(marquage.body.avertissements).toEqual([]);
  });

  it(
    'DÉFAUT CONSTATÉ (documenté, pas corrigé — hors périmètre `apps/api/test/**`) : quand le marquage ' +
      "vendu est déclenché AUTOMATIQUEMENT par l'émission d'une facture (le chemin normal d'une vente " +
      "réelle), l'avertissement RPP-06 est PERDU EN SILENCE — `ServiceEmissionDocument." +
      "marquerVehiculeVenduSiApplicable` (`facturation/documents/service-emission.ts`, ~L502-506) " +
      'appelle `this.vehiculeStock.marquerVendu(...)` et retourne `null` inconditionnellement quand ' +
      "l'appel réussit, sans jamais lire les `avertissements` que `marquerVendu` a pourtant produits. " +
      'Conséquence réelle : un vendeur qui facture un véhicule dont un client a encore un train de ' +
      'pneus en dépôt ne reçoit JAMAIS ce signal — seul `POST /vehicules/{id}/stock/marquer-vendu` ' +
      '(correction manuelle, voir les deux tests ci-dessus) le rend. Ce test documente le comportement ' +
      'attendu (le signal devrait survivre au chemin automatique) et reste ROUGE tant que ce n’est pas ' +
      'le cas — CONTRIBUTING.md : « un test qui documente un vrai défaut est un bon test ».',
    async () => {
      const cookie = await cookiePour(garage.tenantA, 'direction');
      const site = SITE_A();
      const client = CLIENT_A();
      const { dossierVenteId, vehiculeId } = await amenerDossierJusquAPretALivrer(
        ctx,
        cookie,
        site,
        client,
        randomUUID(),
      );
      await creerDepotPneusPourTest(bdd, garage.tenantA.tenant, vehiculeId, site, {
        saison: 'ete',
        statut: 'en_depot',
      });

      const factureBrouillon = await creerDocumentVente(ctx, cookie, {
        typeDocument: 'facture',
        siteId: site,
        clientId: client,
        dateDocument: '2026-01-22',
        dossierVenteId,
        vehiculeId,
        nombreLignesPrimitives: 1,
      });
      const factureEmise = await emettreDocument(
        ctx,
        cookie,
        (factureBrouillon.body.donnees as { id: string }).id,
      );
      expect(factureEmise.status, JSON.stringify(factureEmise.body)).toBe(200);

      const stock = await getVehiculeStock(ctx, cookie, vehiculeId);
      expect((stock.body as { statutCommercial: string }).statutCommercial).toBe('vendu');

      // ATTENDU (et actuellement FAUX, voir le titre du test) : le signalement RPP-06 devrait
      // apparaître dans la réponse d'émission au même titre que via `marquer-vendu` direct.
      expect(factureEmise.body.avertissements).toEqual([
        expect.objectContaining({ code: 'VEHICULE_DEPOTS_PNEUS_OUVERTS' }) as unknown,
      ]);
    },
  );
});

// =================================================================================================
// 5. Isolation inter-tenant — le dossier de vente et le véhicule en stock d'un tenant sont
//    invisibles et non manipulables depuis l'autre, même par une référence croisée explicite.
// =================================================================================================

describe('isolation inter-tenant', () => {
  it('tenant B ne peut pas lire le dossier de vente de tenant A (404, jamais les données d’un autre tenant)', async () => {
    const cookieA = await cookiePour(garage.tenantA, 'direction');
    const cookieB = await cookiePour(garage.tenantB, 'direction');
    const dossier = await creerDossier(ctx, cookieA, {
      siteId: SITE_A(),
      clientAcheteurId: CLIENT_A(),
    });
    const dossierId = (dossier.body.donnees as { id: string }).id;

    const lectureCroisee = await getDossier(ctx, cookieB, dossierId);
    expect(lectureCroisee.status, JSON.stringify(lectureCroisee.body)).toBe(404);
    expect(lectureCroisee.body.code).toBe('RESSOURCE_INTROUVABLE');
  });

  it('tenant B ne peut pas lire la fiche stock du véhicule de tenant A (404)', async () => {
    const cookieA = await cookiePour(garage.tenantA, 'direction');
    const cookieB = await cookiePour(garage.tenantB, 'direction');
    const vehicule = await creerVehicule(ctx, cookieA, randomUUID());
    const vehiculeId = (vehicule.body.donnees as { id: string }).id;
    await mettreEnStock(ctx, cookieA, vehiculeId, SITE_A());

    const lectureCroisee = await getVehiculeStock(ctx, cookieB, vehiculeId);
    expect(lectureCroisee.status, JSON.stringify(lectureCroisee.body)).toBe(404);
  });

  it('tenant B ne peut pas engager le dossier de tenant A (404, pas 403 : la ressource n’existe simplement pas pour lui)', async () => {
    const cookieA = await cookiePour(garage.tenantA, 'direction');
    const cookieB = await cookiePour(garage.tenantB, 'direction');
    const site = SITE_A();
    const vehicule = await creerVehicule(ctx, cookieA, randomUUID());
    const vehiculeId = (vehicule.body.donnees as { id: string }).id;
    await mettreEnStock(ctx, cookieA, vehiculeId, site);
    const dossier = await creerDossier(ctx, cookieA, {
      siteId: site,
      clientAcheteurId: CLIENT_A(),
      vehiculeId,
    });
    const dossierId = (dossier.body.donnees as { id: string }).id;

    const engagementCroise = await engager(ctx, cookieB, dossierId, randomUUID());
    expect(engagementCroise.status, JSON.stringify(engagementCroise.body)).toBe(404);

    // Le dossier tenant A n'a pas bougé.
    const releture = await getDossier(ctx, cookieA, dossierId);
    expect((releture.body as { statut: string }).statut).toBe('prospection');
  });

  it("référencer, en engageant un dossier de tenant A, un bon de commande qui appartient à tenant B est refusé (404 RESSOURCE_INTROUVABLE) — jamais rattaché à travers la frontière tenant", async () => {
    const cookieA = await cookiePour(garage.tenantA, 'direction');
    const cookieB = await cookiePour(garage.tenantB, 'direction');
    const siteA = SITE_A();
    const siteB = garage.tenantB.tenant.sites[0]!.id;

    // Un document ÉMIS chez tenant B (bon de commande), id valide, tenant DIFFÉRENT.
    const documentB = await creerDocumentVente(ctx, cookieB, {
      typeDocument: 'bon_commande',
      siteId: siteB,
      clientId: garage.tenantB.clients[0]!.id,
      dateDocument: '2026-01-10',
      nombreLignesPrimitives: 1,
    });
    expect(documentB.status, JSON.stringify(documentB.body)).toBe(201);
    const documentBEmis = await emettreDocument(
      ctx,
      cookieB,
      (documentB.body.donnees as { id: string }).id,
    );
    expect(documentBEmis.status).toBe(200);
    const documentBId = (documentBEmis.body.donnees as { id: string }).id;

    const vehiculeA = await creerVehicule(ctx, cookieA, randomUUID());
    const vehiculeAId = (vehiculeA.body.donnees as { id: string }).id;
    await mettreEnStock(ctx, cookieA, vehiculeAId, siteA);
    const dossierA = await creerDossier(ctx, cookieA, {
      siteId: siteA,
      clientAcheteurId: CLIENT_A(),
      vehiculeId: vehiculeAId,
    });
    const dossierAId = (dossierA.body.donnees as { id: string }).id;

    const engagement = await engager(ctx, cookieA, dossierAId, documentBId);
    expect(engagement.status, JSON.stringify(engagement.body)).toBe(404);
    expect(engagement.body.code).toBe('RESSOURCE_INTROUVABLE');

    // Le véhicule tenant A n'est pas passé `reserve` : l'engagement a échoué avant tout effet de bord.
    const stockA = await getVehiculeStock(ctx, cookieA, vehiculeAId);
    expect((stockA.body as { statutCommercial: string }).statutCommercial).toBe('disponible');
  });
});
