/**
 * Chaîne documentaire de facturation de démonstration (étape 2) — complète `seed-dev.ts` et
 * `seed-atelier-demo.ts` avec un devis, une facture brouillon et une facture ÉMISE (numérotée,
 * verrouillée) partiellement encaissée. Sans ce fichier, `pnpm db:seed` ne produisait AUCUN
 * document de vente : les écrans de facturation livrés à l'étape 2 étaient invisibles, et
 * personne — @laupernoe compris — ne pouvait parcourir la chaîne OR → facturation → émission →
 * encaissement de bout en bout.
 *
 * Même doctrine que `seed-atelier-demo.ts` (voir sa tête de fichier, non répétée ici) : jamais
 * `NestFactory`, les VRAIS services de `facturation/` (`ServiceDocumentsVente`,
 * `ServiceEmissionDocument`, `ServicePaiement`) sont câblés À LA MAIN avec leurs dépendances
 * réelles, et exécutent exactement le même code métier — machine à états, numérotation continue
 * (`ServiceCompteurs`), invariants de lettrage (MD-51) — que les endpoints HTTP correspondants.
 * `import 'reflect-metadata'` inutile ici : déjà chargé par `seed-atelier-demo.ts`, importé avant
 * ce module dans `seed-dev.ts::principal()`.
 *
 * DÉFAUT CORRIGÉ (constat en base réelle : `document_vente.ordre_reparation_id` était NULL sur
 * les 5 documents de ce jeu de démo — la section « Devis et facture » de toute fiche d'OR restait
 * donc structurellement vide) : `POST /ordres-reparation/{id}/facturer` (RF-81) EST DÉSORMAIS
 * implémenté (`atelier/service-facturation-or.ts`, `ServiceFacturationOr`) — la note qui figurait
 * ici affirmant le contraire datait du lot 1 et n'a jamais été rafraîchie. La facture Master
 * ci-dessous est donc créée en empruntant CE chemin réel (recopie des lignes `realisee` de l'OR
 * « Master / Transports Rhône », `seed-atelier-demo.ts`, en brouillon), pas par une création
 * directe déconnectée de sa source : c'est ce qui pose enfin `document_vente.ordreReparationId`
 * sur au moins un document de ce jeu de données. `ordre_reparation.statut` atteint donc aussi
 * légitimement `'facture'` pour cet OR précis (dernier groupe payeur traité par cet appel, RF-84)
 * — plus une limitation du jeu de démo, un état réellement atteint par le code applicatif.
 *
 * CE QUI RESTE DÉLIBÉRÉMENT SANS OR, ET POURQUOI (chacun vérifié individuellement, pas un défaut
 * répété) :
 *   - le DEVIS Golf/Meier ci-dessous chiffre les travaux REPORTÉS du véhicule
 *     (`vehicule_travail_reporte`, posés par `seed-dev.ts::VEHICULES_DEMO`), pas les lignes d'un
 *     OR précis — aucun OR de ce jeu de démo n'est la source de ce devis, `RF-81` ne produit de
 *     toute façon jamais de `devis` (uniquement des brouillons de `facture`) ;
 *   - la facture Octavia/Dupont reste un BROUILLON créé DIRECTEMENT (vente comptoir), et l'OR
 *     Octavia (`seed-atelier-demo.ts`) reste volontairement `en_cours` (pas `termine` — seul état
 *     qu'accepte `RF-81`) : le faire progresser jusqu'à `termine` aurait changé un état affiché
 *     par ailleurs (l'atelier a besoin d'au moins un OR `en_cours` SANS pointage pour démontrer le
 *     déclenchement manuel `T-04`) sans nécessité pour CETTE tâche ;
 *   - la facture Meier en retard (`seed-relances-demo.ts`) et le bon de commande VN/VO
 *     (`seed-ventes-demo.ts`) sont, par construction métier, des documents SANS OR d'atelier —
 *     vente comptoir directe pour la première, dossier de vente de véhicule pour la seconde (RV-37 :
 *     `document_vente.dossierVenteId`, pas `ordreReparationId`).
 *
 * Rejouable par construction : clés d'idempotence FIXES (même mécanisme que
 * `seed-atelier-demo.ts` — `ServiceIdempotence` mémorise `(statut, corps)`, un rejeu avec la même
 * clé ET le même corps renvoie la réponse déjà mémorisée, jamais un doublon). `creer()`/`facturer()`
 * et `emettre()` sont TOUS idempotents par construction (contrairement aux transitions d'OR type
 * `demarrer`/`terminer`, dépourvues d'idempotence) : aucune relecture de statut n'est donc
 * nécessaire avant de les rejouer, à la différence de `seed-atelier-demo.ts`.
 */
import type {
  EntreeCreationDocumentVente,
  EntreeCreationImputation,
  EntreeCreationLigneDocument,
  EntreeCreationPaiement,
  EntreeFacturationOrdreReparation,
} from '@dfa/shared';

import { LecturePointageVide } from '../../atelier/atelier.jetons';
import { ServiceFacturationOr } from '../../atelier/service-facturation-or';
import { ServiceOr } from '../../atelier/service-or';
import { ServiceSnapshotOr } from '../../atelier/service-snapshot-or';
import { ServiceAuditImpl } from '../../common/audit';
import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';
import { ServiceEvenementsImpl } from '../../common/evenements';
import { Horloge } from '../../common/horloge/horloge';
import { ServiceIdempotenceImpl } from '../../common/idempotence';
import { ServiceDocumentsVente } from '../../facturation/documents/service-documents';
import { ServiceEmissionDocument } from '../../facturation/documents/service-emission';
import { ServicePaiement } from '../../facturation/paiements/service-paiement';
import { ServiceCompteursImpl } from '../../parametrage/compteurs/service-compteurs';
import { ServiceMouvement } from '../../pieces/service-mouvement';
import { ServiceReservation } from '../../pieces/service-reservation';
import { ServiceVehiculeStock } from '../../ventes/service-vehicule-stock';
import { ServiceAccesBase } from '../acces-base.service';
import type { ConfigBase, ContexteTenant } from '../index';

export interface OptionsSeedFacturation {
  readonly config: ConfigBase;
  readonly tenantId: string;
  readonly idsSitesParCode: ReadonlyMap<string, string>;
  readonly idsClientsParNumero: ReadonlyMap<string, string>;
  readonly idsVehiculesParCle: ReadonlyMap<string, string>;
  readonly idsUtilisateursParRole: ReadonlyMap<string, string>;
  /** Clé = celles rendues par `seed-atelier-demo.ts::ResultatSeedAtelier` (`'golf'`, `'octavia'`,
   *  `'master'`, `'bmw'`) — seule `'master'` est consommée ici, pour facturer réellement cet OR via
   *  RF-81 (voir la tête de fichier). */
  readonly idsOrdresReparationParCle: ReadonlyMap<string, string>;
  readonly journaliser?: (message: string) => void;
}

/** Clés d'idempotence FIXES (uuid v4 littéraux) — voir la note de tête sur la rejouabilité. */
const CLE_DEVIS_GOLF_CREATION = '965bdd61-1abf-40d1-8e49-d3b66ed14774';
const CLE_DEVIS_GOLF_EMISSION = 'd66041a1-4a7d-43f7-bd46-8449aa65d858';
const CLE_FACTURE_OCTAVIA_CREATION = '45512f0d-fc25-4b02-9f61-ceb55f6328e9';
/** `POST /ordres-reparation/{orId}/facturer` (RF-81) — remplace l'ancienne
 *  `CLE_FACTURE_MASTER_CREATION` (création directe, sans lien à l'OR). */
const CLE_FACTURATION_OR_MASTER = '0c078ff4-dd23-4507-b98d-8bd0a3bffbd5';
const CLE_FACTURE_MASTER_EMISSION = 'c0cd060b-fec6-4a8f-a903-38719d11baf9';
const CLE_PAIEMENT_MASTER = '0484cda5-5649-4f46-8d49-91f5fff82f63';

export async function semerFacturationDemo(options: OptionsSeedFacturation): Promise<void> {
  const journaliser = options.journaliser ?? ((m: string) => process.stdout.write(`${m}\n`));

  // Même garde-fou que `semerDev`/`semerAtelierDemo` : documents et paiements factices sous des
  // comptes dont le mot de passe est public.
  if (options.config.NODE_ENV === 'production') {
    throw new Error(
      `Le seed de démonstration facturation est interdit en production : il crée des documents de vente et des paiements factices sous des comptes dont le mot de passe est publié dans le dépôt.`,
    );
  }

  const idSion = options.idsSitesParCode.get('SION');
  const idMartigny = options.idsSitesParCode.get('MARTIGNY');
  const idClientMeier = options.idsClientsParNumero.get('CL-000001');
  const idClientDupont = options.idsClientsParNumero.get('CL-000002');
  const idClientRhone = options.idsClientsParNumero.get('CL-000003');
  const idGolf = options.idsVehiculesParCle.get('WVWZZZ1KZAW123456');
  const idOctavia = options.idsVehiculesParCle.get('TMBJJ7NE1M0123457');
  const idMaster = options.idsVehiculesParCle.get('Renault::Master::Fourgon L2H2');
  const idReceptionnaire = options.idsUtilisateursParRole.get('receptionnaire');
  const idComptable = options.idsUtilisateursParRole.get('comptable');
  const idOrMaster = options.idsOrdresReparationParCle.get('master');

  if (
    !idSion ||
    !idMartigny ||
    !idClientMeier ||
    !idClientDupont ||
    !idClientRhone ||
    !idGolf ||
    !idOctavia ||
    !idMaster ||
    !idReceptionnaire ||
    !idComptable ||
    !idOrMaster
  ) {
    throw new Error(
      `seed-facturation-demo : une clé attendue de seed-dev.ts ou de seed-atelier-demo.ts est absente ` +
        `(site, client, véhicule, utilisateur ou OR). Les fichiers ont dérivé l'un de l'autre — vérifier ` +
        `que les codes/numéros/VIN/rôles utilisés ici correspondent encore à SITES_DEMO / CLIENTS_DEMO / ` +
        `VEHICULES_DEMO / UTILISATEURS_DEMO de seed-dev.ts, et que seed-atelier-demo.ts tourne bien AVANT ` +
        `seed-facturation-demo.ts dans seed-dev.ts::principal() (l'OR « master » doit exister, réalisé, ` +
        `avant d'être facturé ici).`,
    );
  }

  // --- Câblage manuel des services (voir la note de tête : jamais NestFactory sous tsx) ----------
  const acces = new ServiceAccesBase({
    NODE_ENV: options.config.NODE_ENV,
    DATABASE_URL: options.config.DATABASE_URL,
    DATABASE_POOL_MAX: options.config.DATABASE_POOL_MAX,
    DATABASE_POOL_MIN: options.config.DATABASE_POOL_MIN,
    DATABASE_TIMEOUT_REQUETE_MS: options.config.DATABASE_TIMEOUT_REQUETE_MS,
    DATABASE_TIMEOUT_CONNEXION_MS: options.config.DATABASE_TIMEOUT_CONNEXION_MS,
    DATABASE_TIMEOUT_IDLE_MS: options.config.DATABASE_TIMEOUT_IDLE_MS,
  });

  try {
    const horloge = new Horloge();
    const idempotence = new ServiceIdempotenceImpl(acces, horloge);
    const audit = new ServiceAuditImpl(acces);
    const evenements = new ServiceEvenementsImpl(horloge);
    const compteurs = new ServiceCompteursImpl();
    // `ServiceMouvement` (RP-43) : pont vente comptoir — ce seed ne pose aucune ligne `piece` avec
    // `articleId`/`siteId` (aucune vente comptoir peuplée), donc jamais exercé ici, mais le câblage
    // manuel doit rester compilable au même titre que `vehiculeStock` ci-dessous. `ServiceReservation`
    // (0047) : dépendance de la cascade de libération forcée, jamais exercée ici pour la même raison.
    const mouvements = new ServiceMouvement(acces, idempotence, new ServiceReservation(acces));
    const documents = new ServiceDocumentsVente(acces, idempotence, audit, horloge, mouvements);
    // `ServiceEmissionDocument` (RV-37) marque le véhicule d'un dossier de vente `vendu` à
    // l'émission d'une facture rattachée — ce seed ne peuple aucun dossier de vente
    // (`seed-facturation-demo.ts` reste antérieur à l'étape 4), donc jamais exercé ici, mais le
    // câblage manuel doit rester compilable au même titre que le reste de ce fichier.
    const vehiculeStock = new ServiceVehiculeStock(acces, idempotence, audit, horloge);
    const emission = new ServiceEmissionDocument(
      acces,
      idempotence,
      evenements,
      compteurs,
      horloge,
      documents,
      vehiculeStock,
    );
    const paiements = new ServicePaiement(acces, idempotence, horloge);
    // RF-81 : pont OR -> facturation (`POST /ordres-reparation/{orId}/facturer`). `ServiceOr` est
    // requis par `ServiceFacturationOr` pour relire l'OR/assembler le document OR à jour dans sa
    // réponse — même câblage minimal (lecture de pointage inerte, snapshot) que
    // `seed-atelier-demo.ts`, ce fichier n'a pas besoin de `ServiceTransitions`/`ServiceLigneOr`
    // (l'OR Master est déjà `termine`, ses lignes déjà `realisee`, avant d'arriver ici).
    const pointageInerte = new LecturePointageVide();
    const snapshot = new ServiceSnapshotOr(horloge);
    const serviceOr = new ServiceOr(
      acces,
      idempotence,
      evenements,
      audit,
      compteurs,
      pointageInerte,
      snapshot,
      horloge,
    );
    const facturationOr = new ServiceFacturationOr(
      acces,
      idempotence,
      horloge,
      serviceOr,
      documents,
    );

    // Front de comptoir (RF-114 : créer/émettre devis et factures) et back-office comptable
    // (encaissement) — deux comptes distincts, exactement comme sur le terrain, et ça peuple
    // l'audit trail (`creePar`/`emisPar`) de deux identités différentes plutôt qu'une seule.
    const ctxReceptionnaire: ContexteTenant = {
      tenantId: options.tenantId,
      utilisateurId: idReceptionnaire,
      requeteId: null,
    };
    const receptionnaire: PrincipalAuthentifie = {
      sessionId: 'seed-facturation-demo',
      tenantId: options.tenantId,
      utilisateurId: idReceptionnaire,
      role: 'receptionnaire',
      langue: 'fr',
    };
    const ctxComptable: ContexteTenant = {
      tenantId: options.tenantId,
      utilisateurId: idComptable,
      requeteId: null,
    };

    // === Devis — Golf / Meier — émis, reprend les deux travaux reportés constatés en atelier ===
    // (VEHICULES_DEMO.travauxReportes de seed-dev.ts : mêmes désignations, mêmes montants estimés
    // — le devis chiffre exactement ce que le comptoir avait déjà repéré).
    const entreeDevis: EntreeCreationDocumentVente = {
      typeDocument: 'devis',
      siteId: idSion,
      clientId: idClientMeier,
      vehiculeId: idGolf,
      dateDocument: '2026-07-10',
      devise: 'CHF',
      lignes: [
        ligneDocument('piece', 'Remplacement plaquettes de frein avant', 45_000, '2026-07-10'),
        ligneDocument('piece', 'Remplacement ampoule de feu de position', 3_500, '2026-07-10'),
      ],
    };
    const resultatDevis = await documents.creer(
      ctxReceptionnaire,
      receptionnaire,
      entreeDevis,
      CLE_DEVIS_GOLF_CREATION,
    );
    const devisId = resultatDevis.reponse.corps.donnees.id;
    await emission.emettre(ctxReceptionnaire, receptionnaire, devisId, CLE_DEVIS_GOLF_EMISSION);
    journaliser(`  devis Golf/Meier — émis, 2 lignes (48'500 c. TTC)`);

    // === Facture brouillon — Octavia / Dupont, reprend le contenu de l'OR en_cours ================
    const entreeFactureOctavia: EntreeCreationDocumentVente = {
      typeDocument: 'facture',
      natureFacture: 'ordinaire',
      siteId: idMartigny,
      clientId: idClientDupont,
      vehiculeId: idOctavia,
      dateDocument: '2026-07-18',
      devise: 'CHF',
      lignes: [
        ligneDocument('forfait', 'Diagnostic électronique OBD', 12_000, '2026-07-18'),
        ligneDocument('forfait', 'Changement de pneus (4 roues)', 32_000, '2026-07-18'),
      ],
    };
    await documents.creer(
      ctxReceptionnaire,
      receptionnaire,
      entreeFactureOctavia,
      CLE_FACTURE_OCTAVIA_CREATION,
    );
    journaliser(`  facture Octavia/Dupont — brouillon, 2 lignes (44'000 c. TTC)`);

    // === Facture émise — Master / Transports Rhône, RÉELLEMENT facturée depuis l'OR terminé =======
    // via `POST /ordres-reparation/{orId}/facturer` (RF-81, `ServiceFacturationOr`) — l'OR
    // « Master » (`seed-atelier-demo.ts`) porte deux lignes `realisee`, toutes deux `payeur:
    // 'client'` : un seul groupe à traiter, donc un seul brouillon créé et l'OR passe directement
    // à `'facture'` (RF-84, dernier groupe traité). Montants ISSUS DU CALCUL RÉEL (RM-65, prix
    // unitaires HT + TVA 8.1%, voir le commentaire de ces lignes dans `seed-atelier-demo.ts`), plus
    // « ronds » que l'ancienne saisie manuelle TTC — c'est attendu : ce sont maintenant deux
    // représentations différentes (atelier HT-ancré, facturation TTC-ancré, §0.2) du MÊME travail,
    // pas une resaisie arbitraire.
    //   - « Préparation à l'expertise MFK » : 150.00 HT -> 16'215 c. TTC (12.15 c. de TVA/centime
    //     déjà arrondis à la ligne, RM-65).
    //   - « Vidange huile + filtre » : 90.00 HT -> 9'729 c. TTC.
    //   - Total facture : 25'944 c. TTC (259.44 CHF).
    // + paiement partiel (150.00 CHF sur 259.44 CHF dus) — statutReglement passe à 'partiel',
    // soldeCentimes à 10'944 (109.44 CHF), exactement ce qu'exige la preuve n°4 de la tâche
    // (arithmétique de la facture émise vérifiable par l'API).
    const entreeFacturationOrMaster: EntreeFacturationOrdreReparation = {
      groupes: [{ payeur: 'client' }],
      motifsReport: [],
    };
    const resultatFacturationOrMaster = await facturationOr.facturer(
      ctxReceptionnaire,
      receptionnaire,
      idOrMaster,
      entreeFacturationOrMaster,
      CLE_FACTURATION_OR_MASTER,
    );
    const [factureMasterBrouillon] =
      resultatFacturationOrMaster.reponse.corps.donnees.facturesCreees;
    if (!factureMasterBrouillon) {
      throw new Error(
        `seed-facturation-demo : POST /ordres-reparation/${idOrMaster}/facturer n'a rendu aucun ` +
          `brouillon de facture — vérifier que l'OR « master » (seed-atelier-demo.ts) a bien deux ` +
          `lignes « realisee » avant d'être terminé.`,
      );
    }
    const factureMasterId = factureMasterBrouillon.id;
    await emission.emettre(
      ctxReceptionnaire,
      receptionnaire,
      factureMasterId,
      CLE_FACTURE_MASTER_EMISSION,
    );
    journaliser(
      `  facture Master/Transports Rhône — ÉMISE via RF-81 depuis l'OR, 2 lignes (25'944 c. TTC), OR -> 'facture'`,
    );

    const imputation: EntreeCreationImputation = {
      documentId: factureMasterId,
      montantCentimes: 15_000,
      nature: 'reglement',
    };
    const entreePaiement: EntreeCreationPaiement = {
      siteId: idSion,
      dateValeur: '2026-07-12',
      moyen: 'virement',
      montantCentimes: 15_000,
      devise: 'CHF',
      payeurClientId: idClientRhone,
      payeurLibelle: 'Transports Rhône Sàrl',
      imputations: [imputation],
    };
    await paiements.creer(ctxComptable, entreePaiement, CLE_PAIEMENT_MASTER);
    journaliser(
      `  paiement Transports Rhône — 150.00 CHF (virement), imputé partiel sur la facture Master (solde 109.44 CHF)`,
    );
  } finally {
    // Même raison que `seed-atelier-demo.ts` : pas de conteneur Nest ici pour appeler
    // `onModuleDestroy` automatiquement, donc à ce script de refermer le pool lui-même.
    await acces.onModuleDestroy();
  }
}

function ligneDocument(
  type: EntreeCreationLigneDocument['type'],
  designation: string,
  prixUnitaireTtcCentimes: number,
  datePrestation: string,
): EntreeCreationLigneDocument {
  return {
    type,
    designation,
    referenceTexte: null,
    quantiteMillieme: 1_000,
    prixUnitaireTtcCentimes,
    regimeTva: 'normal',
    tauxTvaPourmille: 81,
    datePrestation,
  };
}
