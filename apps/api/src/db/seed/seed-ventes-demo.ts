/**
 * Cycle de vente VN/VO de démonstration (étape « ventes »).
 *
 * Avant l'enrichissement documenté ci-dessous : un seul dossier de vente, un seul véhicule en
 * stock, aucune reprise, aucun financement. Chaque dimension filtrable
 * (`statut`/`provenance`/`typeVehicule` des collections, `dansJours` de l'écran de suivi) ne
 * portait donc qu'UNE SEULE valeur — un défaut de filtrage ne pouvait être constaté qu'« en creux »
 * (une valeur inexistante rend une liste vide), jamais « en positif » (deux valeurs RÉELLES doivent
 * se distinguer l'une de l'autre). Ce fichier pose maintenant plusieurs dossiers à des statuts
 * différents, plusieurs véhicules en stock de provenances différentes, une reprise et un
 * financement de chacun des trois types (`comptant`/`credit`/`leasing`) à des statuts de
 * confirmation différents — voir le récapitulatif en pied de fichier.
 *
 * Même doctrine que les autres fichiers de ce dossier (voir la tête de `seed-atelier-demo.ts`,
 * non répétée ici) : jamais `NestFactory`, les VRAIS services de `vehicules/`, `ventes/` et
 * `facturation/` sont câblés à la main et exécutent le même code métier que l'API réelle — y
 * compris les machines à états du dossier de vente, du véhicule en stock, de la reprise et du
 * financement. AUCUN `insert` direct sur ces tables : un seed qui écrit à la main produit des
 * données qu'aucun code de production n'aurait produites (cas réel, coûteux, ailleurs dans ce
 * dépôt : un OR de démo sans conditions commerciales figées, faute d'avoir posé
 * `client_condition` — RM-65 — avant l'ouverture de l'OR, a bloqué l'ajout de main-d'œuvre pendant
 * une journée). Le même risque existe ici : les organismes de financement (`CL-000004`/`CL-000005`)
 * ET le compte `vendeur` doivent exister AVANT que ce fichier ne s'exécute — tous deux posés par
 * `seed-dev.ts`, qui appelle ce module en dernier pour cette raison précise.
 *
 * `POST /vehicules` (`ServiceVehicule.creerDansTransaction`) est appelée exactement comme le fait
 * `vehicule.controller.ts::creer` — enveloppée à la main dans `ServiceIdempotence.executer`,
 * puisque l'idempotence de cet endpoint est portée par le CONTRÔLEUR, pas par le service
 * (voir sa docstring : « appelée par le contrôleur À L'INTÉRIEUR de ServiceIdempotence.executer »).
 *
 * RÔLES — chaque appel utilise le compte qui aurait RÉELLEMENT ce droit en production
 * (`DROITS_VENTES_PAR_ROLE`, `auth/matrice-droits.ts`), pas un compte de commodité :
 *   - `direction` pour la mise en stock d'un véhicule (`ventes.vehicule_stock.creer`) — `vendeur`
 *     ne l'a PAS (`[À VALIDER, QV-15]`, traité « non » en attendant) ;
 *   - `vendeur` pour tout le cycle du dossier de vente, la reprise et le financement — c'est
 *     justement le rôle que ce lot de démonstration ajoute (voir la tête de `seed-dev.ts`) ;
 *   - `receptionnaire` pour la création du véhicule lui-même (étape 1, hors droits `ventes.*`) —
 *     inchangé, c'est le rôle du comptoir qui accueille le client et le véhicule.
 *
 * IDEMPOTENT, comme le reste de ce dossier : chaque création porte une clé d'idempotence FIXE
 * (uuid v4 littéral) ; chaque transition qui n'en porte pas (`engager`, `preparer`,
 * `marquerPretALivrer`, `annuler`, `negocier`, `confirmer`/`refuser` un financement) est gardée par
 * une lecture préalable du statut courant, pour qu'un rejeu de `pnpm db:seed` ne tente jamais une
 * transition déjà franchie — même patron que les gardes `if ((await statutCourant()) === ...)`
 * déjà en place ici avant cet enrichissement.
 */
import 'reflect-metadata';

import type {
  EntreeActionAnnulerDossierVente,
  EntreeActionEngager,
  EntreeActionPreparer,
  EntreeActionRefuserFinancement,
  EntreeCreationDocumentVente,
  EntreeCreationFinancement,
  EntreeCreationLigneDocument,
  EntreeCreationReprise,
  EntreeCreationVehicule,
  EntreeMiseEnStock,
} from '@dfa/shared';

import type { Config } from '../../config/charger-config';
import { ServiceAuditImpl } from '../../common/audit';
import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';
import { Horloge } from '../../common/horloge/horloge';
import { ServiceIdempotenceImpl } from '../../common/idempotence';
import { ServiceDocumentsVente } from '../../facturation/documents/service-documents';
import { ServiceMouvement } from '../../pieces/service-mouvement';
import { ServiceReservation } from '../../pieces/service-reservation';
import { ServiceDossierVente } from '../../ventes/service-dossier-vente';
import { ServiceFinancement } from '../../ventes/service-financement';
import { ServiceReprise } from '../../ventes/service-reprise';
import { ServiceVehiculeStock } from '../../ventes/service-vehicule-stock';
import { ServiceVehicule } from '../../vehicules/service-vehicule';
import { ServiceAccesBase } from '../acces-base.service';
import type { ContexteTenant } from '../index';

export interface OptionsSeedVentes {
  readonly config: Config;
  readonly tenantId: string;
  readonly idsSitesParCode: ReadonlyMap<string, string>;
  readonly idsClientsParNumero: ReadonlyMap<string, string>;
  readonly idsUtilisateursParRole: ReadonlyMap<string, string>;
  readonly journaliser?: (message: string) => void;
}

/** Clés d'idempotence FIXES (uuid v4 littéraux) — même doctrine que les autres fichiers de ce
 *  dossier. Groupées par « dossier » commercial plutôt que par type d'objet, pour que le lien avec
 *  le récapitulatif en pied de fichier reste lisible. */
const CLE_VEHICULE_AUDI_A4 = 'e2113efb-a5c0-41da-b2ac-a2d8eaa38d33';
const CLE_MISE_EN_STOCK_AUDI_A4 = '8cce7158-8c8f-4b97-9d05-9714e0cba820';
const CLE_BON_COMMANDE_AUDI_A4 = 'ca0dcffa-fcf0-47a1-89f3-501342f8df12';
const CLE_DOSSIER_VENTE_AUDI_A4 = '56dd63c4-13b3-40c1-a5e7-7834c69fd896';
const CLE_FINANCEMENT_AUDI_A4 = '5eed0000-0000-4000-8000-000000000001';

const CLE_VEHICULE_KODIAQ = '5eed0000-0000-4000-8000-000000000002';
const CLE_MISE_EN_STOCK_KODIAQ = '5eed0000-0000-4000-8000-000000000003';
const CLE_DOSSIER_VENTE_KODIAQ = '5eed0000-0000-4000-8000-000000000004';
const CLE_FINANCEMENT_KODIAQ = '5eed0000-0000-4000-8000-000000000005';

const CLE_VEHICULE_CLIO = '5eed0000-0000-4000-8000-000000000006';
const CLE_MISE_EN_STOCK_CLIO = '5eed0000-0000-4000-8000-000000000007';

const CLE_VEHICULE_PEUGEOT_308 = '5eed0000-0000-4000-8000-000000000008';
const CLE_MISE_EN_STOCK_PEUGEOT_308 = '5eed0000-0000-4000-8000-000000000009';

const CLE_VEHICULE_TIGUAN = '5eed0000-0000-4000-8000-00000000000a';
const CLE_MISE_EN_STOCK_TIGUAN = '5eed0000-0000-4000-8000-00000000000b';
const CLE_VEHICULE_IVECO_DAILY = '5eed0000-0000-4000-8000-00000000000c';
const CLE_DOSSIER_VENTE_TIGUAN = '5eed0000-0000-4000-8000-00000000000d';
const CLE_REPRISE_TIGUAN = '5eed0000-0000-4000-8000-00000000000e';
const CLE_FINANCEMENT_TIGUAN = '5eed0000-0000-4000-8000-00000000000f';
const CLE_BON_COMMANDE_TIGUAN = '5eed0000-0000-4000-8000-000000000010';

const CLE_VEHICULE_DUSTER = '5eed0000-0000-4000-8000-000000000011';
const CLE_MISE_EN_STOCK_DUSTER = '5eed0000-0000-4000-8000-000000000012';
const CLE_DOSSIER_VENTE_DUSTER = '5eed0000-0000-4000-8000-000000000013';
const CLE_FINANCEMENT_DUSTER = '5eed0000-0000-4000-8000-000000000014';

const VIN_AUDI_A4 = 'WAUZZZ8K9KA123459';
const PRIX_ACHAT_AUDI_A4_CENTIMES = 1_650_000; // 16'500.—, reprise/achat direct.
const PRIX_VENTE_AUDI_A4_CENTIMES = 2_190_000; // 21'900.— affiché.

const VIN_KODIAQ = 'TMBJF7NS5L1123460';
const PRIX_ACHAT_KODIAQ_CENTIMES = 4_150_000; // 41'500.— coût constructeur.
const PRIX_VENTE_KODIAQ_CENTIMES = 4_890_000; // 48'900.— affiché.

const PRIX_ACHAT_CLIO_CENTIMES = 1_950_000; // 19'500.— coût constructeur.
const PRIX_VENTE_CLIO_CENTIMES = 2_290_000; // 22'900.— affiché.

const VIN_PEUGEOT_308 = 'VF3LCYHZTGS123461';
const PRIX_ACHAT_PEUGEOT_308_CENTIMES = 950_000; // 9'500.— rachat direct.
const PRIX_VENTE_PEUGEOT_308_CENTIMES = 1_390_000; // 13'900.— affiché.

const VIN_TIGUAN = 'WVGZZZ5NZKW123462';
const PRIX_ACHAT_TIGUAN_CENTIMES = 3_650_000; // 36'500.— valeur de reprise interne (ex-démonstrateur).
const PRIX_VENTE_TIGUAN_CENTIMES = 4_190_000; // 41'900.— affiché.

const VIN_IVECO_DAILY = 'ZCFC35A0005123463';

const VIN_DUSTER = 'UU1DHZH6663123464';
const PRIX_ACHAT_DUSTER_CENTIMES = 1_290_000; // 12'900.— racheté à l'organisme de leasing.
const PRIX_VENTE_DUSTER_CENTIMES = 1_690_000; // 16'900.— affiché.

export async function semerVentesDemo(options: OptionsSeedVentes): Promise<void> {
  const journaliser = options.journaliser ?? ((m: string) => process.stdout.write(`${m}\n`));

  if (options.config.NODE_ENV === 'production') {
    throw new Error(
      `Le seed de démonstration ventes est interdit en production : il crée des véhicules, des fiches stock et des dossiers de vente factices.`,
    );
  }

  const idMartigny = options.idsSitesParCode.get('MARTIGNY');
  const idSion = options.idsSitesParCode.get('SION');
  const idClientMeier = options.idsClientsParNumero.get('CL-000001');
  const idClientDupont = options.idsClientsParNumero.get('CL-000002');
  const idClientTransportsRhone = options.idsClientsParNumero.get('CL-000003');
  const idOrganismeCredit = options.idsClientsParNumero.get('CL-000004');
  const idOrganismeLeasing = options.idsClientsParNumero.get('CL-000005');
  const idReceptionnaire = options.idsUtilisateursParRole.get('receptionnaire');
  const idDirection = options.idsUtilisateursParRole.get('direction');
  const idVendeur = options.idsUtilisateursParRole.get('vendeur');
  if (
    !idMartigny ||
    !idSion ||
    !idClientMeier ||
    !idClientDupont ||
    !idClientTransportsRhone ||
    !idOrganismeCredit ||
    !idOrganismeLeasing ||
    !idReceptionnaire ||
    !idDirection ||
    !idVendeur
  ) {
    throw new Error(
      `seed-ventes-demo : site, client, organisme de financement ou compte utilisateur introuvable — vérifier l'ordre d'exécution de seed-dev.ts.`,
    );
  }

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
    // `ServiceReservation` (0047) : dépendance de la cascade de libération forcée, câblage manuel
    // requis au même titre que les autres services de ce seed, jamais exercée ici.
    const mouvements = new ServiceMouvement(acces, idempotence, new ServiceReservation(acces));
    const documents = new ServiceDocumentsVente(acces, idempotence, audit, horloge, mouvements);
    const serviceVehicule = new ServiceVehicule(acces, horloge);
    const vehiculeStock = new ServiceVehiculeStock(acces, idempotence, audit, horloge);
    const dossierVente = new ServiceDossierVente(acces, idempotence, audit, horloge);
    const reprise = new ServiceReprise(acces, idempotence, audit, horloge);
    const financement = new ServiceFinancement(acces, idempotence, horloge);

    // Pas de `PrincipalAuthentifie` distinct pour la réception : `creerVehiculeDemo` n'a besoin
    // que du `ContexteTenant` (`ServiceVehicule.creerDansTransaction` ne prend pas de principal).
    const ctxReceptionnaire: ContexteTenant = {
      tenantId: options.tenantId,
      utilisateurId: idReceptionnaire,
      requeteId: null,
    };
    const ctxDirection: ContexteTenant = {
      tenantId: options.tenantId,
      utilisateurId: idDirection,
      requeteId: null,
    };
    const direction: PrincipalAuthentifie = {
      sessionId: 'seed-ventes-demo-direction',
      tenantId: options.tenantId,
      utilisateurId: idDirection,
      role: 'direction',
      langue: 'fr',
    };
    const ctxVendeur: ContexteTenant = {
      tenantId: options.tenantId,
      utilisateurId: idVendeur,
      requeteId: null,
    };
    const vendeur: PrincipalAuthentifie = {
      sessionId: 'seed-ventes-demo-vendeur',
      tenantId: options.tenantId,
      utilisateurId: idVendeur,
      role: 'vendeur',
      langue: 'fr',
    };

    /** Étape 1 (`POST /vehicules`) — même patron d'idempotence manuelle pour chaque véhicule créé
     *  par ce fichier, voir la docstring de tête. */
    const creerVehiculeDemo = async (
      cleIdempotence: string,
      entree: EntreeCreationVehicule,
    ): Promise<string> => {
      const resultat = await idempotence.executer(
        ctxReceptionnaire,
        { methode: 'POST', chemin: '/vehicules', cle: cleIdempotence, corps: entree },
        async (tx) => {
          const { donnees, avertissements } = await serviceVehicule.creerDansTransaction(
            tx,
            ctxReceptionnaire,
            entree,
          );
          return { statutHttp: 201, corps: avertissements.envelopper(donnees) };
        },
      );
      return resultat.reponse.corps.donnees.id;
    };

    /** Relit le statut RÉEL d'un dossier (jamais une réponse mémorisée par l'idempotence, figée à
     *  l'état de création) — `engager`/`preparer`/`marquerPretALivrer`/`annuler` ne sont PAS
     *  idempotentes par construction (transitions de machine à états, même doctrine que
     *  `ServiceTransitions` en atelier). */
    const statutDossier = async (dossierVenteId: string): Promise<string> => {
      const document = await dossierVente.obtenirComplet(ctxVendeur, vendeur.role, dossierVenteId);
      return document.statut;
    };

    // =============================================================================================
    // Dossier 1 — Audi A4 Avant / Mme Dupont (CL-000002) / MARTIGNY
    // Statut cible : « pret_a_livrer ». Financement crédit CONFIRMÉ (CarCrédit Suisse SA).
    // =============================================================================================

    const vehiculeAudiId = await creerVehiculeDemo(CLE_VEHICULE_AUDI_A4, {
      vin: VIN_AUDI_A4,
      marque: 'Audi',
      modele: 'A4 Avant',
      version: '2.0 TDI 150 quattro',
      premiereMiseEnCirculationLe: '2019-05-14',
      carburant: 'diesel',
      couleur: 'gris',
      importe: false,
    });
    journaliser(`  véhicule Audi A4 Avant (VIN ${VIN_AUDI_A4}) créé`);

    // Mise en stock : `direction` (`ventes.vehicule_stock.creer`, `vendeur` ne l'a pas encore).
    const entreeMiseEnStockAudi: EntreeMiseEnStock = {
      siteId: idMartigny,
      provenance: 'achat_particulier',
      dateEntreeStock: '2026-06-01',
      prixAchatCentimes: PRIX_ACHAT_AUDI_A4_CENTIMES,
      prixVenteAfficheCentimes: PRIX_VENTE_AUDI_A4_CENTIMES,
      vendeurPrecedentAssujetti: false,
    };
    await vehiculeStock.mettreEnStock(
      ctxDirection,
      direction,
      vehiculeAudiId,
      entreeMiseEnStockAudi,
      CLE_MISE_EN_STOCK_AUDI_A4,
    );
    journaliser(
      `  Audi A4 Avant — en stock à MARTIGNY (21'900.— affiché, provenance achat_particulier)`,
    );

    const resultatDossierAudi = await dossierVente.creer(
      ctxVendeur,
      vendeur,
      {
        siteId: idMartigny,
        vehiculeId: vehiculeAudiId,
        clientAcheteurId: idClientDupont,
        dateLivraisonEstimee: null,
      },
      CLE_DOSSIER_VENTE_AUDI_A4,
    );
    const dossierAudiId = resultatDossierAudi.reponse.corps.donnees.id;
    journaliser(`  dossier de vente Audi A4 / Dupont — créé (prospection)`);

    if ((await statutDossier(dossierAudiId)) === 'prospection') {
      const entreeBonCommande: EntreeCreationDocumentVente = {
        typeDocument: 'bon_commande',
        siteId: idMartigny,
        clientId: idClientDupont,
        vehiculeId: vehiculeAudiId,
        dossierVenteId: dossierAudiId,
        dateDocument: '2026-07-20',
        devise: 'CHF',
        lignes: [
          ligneDocument(
            'forfait',
            `Véhicule d'occasion — Audi A4 Avant 2.0 TDI 150 quattro (VIN ${VIN_AUDI_A4})`,
            PRIX_VENTE_AUDI_A4_CENTIMES,
            '2026-07-20',
          ),
        ],
      };
      const resultatBonCommande = await documents.creer(
        ctxVendeur,
        vendeur,
        entreeBonCommande,
        CLE_BON_COMMANDE_AUDI_A4,
      );
      const bonCommandeId = resultatBonCommande.reponse.corps.donnees.id;

      const entreeEngager: EntreeActionEngager = {
        bonCommandeDocumentId: bonCommandeId,
        identitePieceType: 'carte_identite',
      };
      await dossierVente.engager(ctxVendeur, vendeur.role, dossierAudiId, entreeEngager);
      journaliser(`  dossier de vente Audi A4 / Dupont — engagé (véhicule réservé)`);
    }

    if ((await statutDossier(dossierAudiId)) === 'engage') {
      const entreePreparer: EntreeActionPreparer = {};
      await dossierVente.preparer(ctxVendeur, vendeur.role, dossierAudiId, entreePreparer);
      journaliser(`  dossier de vente Audi A4 / Dupont — en préparation`);
    }

    // Financement crédit — CONFIRMÉ. `dureeMois: 6` délibérément COURT pour un crédit auto (un vrai
    // contrat dure plutôt 36-60 mois) : c'est le SEUL moyen que l'échéance calculée
    // (`confirmeLe + dureeMois`, `suivi-mappers.ts::calculerEcheanceFinancement`) tombe dans un
    // horizon RÉELLEMENT testable de l'écran de suivi (`GET /ventes/suivi?dansJours=30|90|180`) —
    // avec une durée réaliste, aucun onglet de démonstration n'afficherait jamais rien. Signalé ici
    // plutôt que caché : un vendeur qui lirait cette fiche verrait un crédit court terme inhabituel
    // pour ce montant, à raison.
    const montantFinanceAudi = PRIX_VENTE_AUDI_A4_CENTIMES - 690_000;
    const entreeFinancementAudi: EntreeCreationFinancement = {
      type: 'credit',
      organismeId: idOrganismeCredit,
      referenceContrat: 'CC-2026-0188',
      montantFinanceCentimes: montantFinanceAudi,
      acompteCentimes: 690_000,
      mensualiteCentimes: 254_000,
      tauxInteretPourmille: 69,
      dureeMois: 6,
    };
    const resultatFinancementAudi = await financement.creer(
      ctxVendeur,
      vendeur,
      dossierAudiId,
      entreeFinancementAudi,
      CLE_FINANCEMENT_AUDI_A4,
    );
    const financementAudiId = resultatFinancementAudi.reponse.corps.donnees.id;
    // `confirmer()` n'a pas de garde de statut côté serveur (voir sa docstring : un rejeu réécrit la
    // même valeur, non-événement pour le trigger générique de machine à états) — sûr à rejouer.
    await financement.confirmer(ctxVendeur, vendeur.role, dossierAudiId, financementAudiId, {});
    journaliser(`  financement crédit Audi/Dupont (CarCrédit Suisse SA) — confirmé`);

    if ((await statutDossier(dossierAudiId)) === 'en_preparation') {
      await dossierVente.marquerPretALivrer(ctxVendeur, vendeur.role, dossierAudiId, {});
      journaliser(`  dossier de vente Audi A4 / Dupont — prêt à livrer`);
    }

    // =============================================================================================
    // Véhicules en stock supplémentaires — provenances et statuts commerciaux distincts
    // =============================================================================================

    // Škoda Kodiaq (VN, provenance neuf_constructeur, VIN déjà connu -> `disponible` d'emblée).
    const vehiculeKodiaqId = await creerVehiculeDemo(CLE_VEHICULE_KODIAQ, {
      vin: VIN_KODIAQ,
      marque: 'Skoda',
      modele: 'Kodiaq',
      version: '2.0 TDI 200 DSG 4x4',
      carburant: 'diesel',
      couleur: 'blanc',
      importe: false,
    });
    await vehiculeStock.mettreEnStock(
      ctxDirection,
      direction,
      vehiculeKodiaqId,
      {
        siteId: idSion,
        provenance: 'neuf_constructeur',
        dateEntreeStock: '2026-07-10',
        prixAchatCentimes: PRIX_ACHAT_KODIAQ_CENTIMES,
        prixVenteAfficheCentimes: PRIX_VENTE_KODIAQ_CENTIMES,
      },
      CLE_MISE_EN_STOCK_KODIAQ,
    );
    journaliser(
      `  Skoda Kodiaq — en stock à SION (statut disponible, provenance neuf_constructeur)`,
    );

    // Renault Clio (VN, provenance neuf_constructeur, PAS de VIN connu -> `en_commande`). Volontairement
    // sans dossier attaché : c'est l'exemple qui prouve que `statutCommercial=en_commande` existe
    // et se filtre, sans lui la valeur n'apparaissait dans AUCUN jeu de démonstration.
    const vehiculeClioId = await creerVehiculeDemo(CLE_VEHICULE_CLIO, {
      vin: null,
      marque: 'Renault',
      modele: 'Clio',
      version: 'V TCe 100 Business',
      carburant: 'essence',
      couleur: 'gris',
      importe: false,
    });
    await vehiculeStock.mettreEnStock(
      ctxDirection,
      direction,
      vehiculeClioId,
      {
        siteId: idSion,
        provenance: 'neuf_constructeur',
        dateEntreeStock: '2026-08-01',
        prixAchatCentimes: PRIX_ACHAT_CLIO_CENTIMES,
        prixVenteAfficheCentimes: PRIX_VENTE_CLIO_CENTIMES,
      },
      CLE_MISE_EN_STOCK_CLIO,
    );
    journaliser(
      `  Renault Clio — commandée pour SION (statut en_commande, provenance neuf_constructeur)`,
    );

    // Peugeot 308 (VO, provenance reprise — rachat direct à un particulier, INDÉPENDANT de tout
    // dossier de vente en cours : un garage rachète aussi des véhicules sans vente concurrente).
    const vehiculePeugeot308Id = await creerVehiculeDemo(CLE_VEHICULE_PEUGEOT_308, {
      vin: VIN_PEUGEOT_308,
      marque: 'Peugeot',
      modele: '308',
      version: '1.2 PureTech 130',
      premiereMiseEnCirculationLe: '2019-03-10',
      carburant: 'essence',
      couleur: 'rouge',
      importe: false,
    });
    await vehiculeStock.mettreEnStock(
      ctxDirection,
      direction,
      vehiculePeugeot308Id,
      {
        siteId: idMartigny,
        provenance: 'reprise',
        dateEntreeStock: '2026-06-20',
        prixAchatCentimes: PRIX_ACHAT_PEUGEOT_308_CENTIMES,
        prixVenteAfficheCentimes: PRIX_VENTE_PEUGEOT_308_CENTIMES,
        vendeurPrecedentAssujetti: false,
      },
      CLE_MISE_EN_STOCK_PEUGEOT_308,
    );
    journaliser(`  Peugeot 308 — en stock à MARTIGNY (statut disponible, provenance reprise)`);

    // Volkswagen Tiguan (VO, provenance demonstrateur) — c'est le véhicule VENDU dans le dossier 3
    // ci-dessous, avec reprise du fourgon Iveco Daily du client.
    const vehiculeTiguanId = await creerVehiculeDemo(CLE_VEHICULE_TIGUAN, {
      vin: VIN_TIGUAN,
      marque: 'Volkswagen',
      modele: 'Tiguan',
      version: '2.0 TDI 150 Life',
      premiereMiseEnCirculationLe: '2025-11-05',
      carburant: 'diesel',
      couleur: 'bleu',
      importe: false,
    });
    await vehiculeStock.mettreEnStock(
      ctxDirection,
      direction,
      vehiculeTiguanId,
      {
        siteId: idSion,
        provenance: 'demonstrateur',
        dateEntreeStock: '2026-05-15',
        prixAchatCentimes: PRIX_ACHAT_TIGUAN_CENTIMES,
        prixVenteAfficheCentimes: PRIX_VENTE_TIGUAN_CENTIMES,
      },
      CLE_MISE_EN_STOCK_TIGUAN,
    );
    journaliser(
      `  Volkswagen Tiguan — en stock à SION (statut disponible, provenance demonstrateur)`,
    );

    // Dacia Duster (VO, provenance retour_leasing — rachat de la valeur résiduelle à l'organisme de
    // leasing en fin de contrat, RV-02 : liste de provenances extensible mais ce cas y figure déjà).
    const vehiculeDusterId = await creerVehiculeDemo(CLE_VEHICULE_DUSTER, {
      vin: VIN_DUSTER,
      marque: 'Dacia',
      modele: 'Duster',
      version: '1.3 TCe 130 4x2',
      premiereMiseEnCirculationLe: '2023-09-01',
      carburant: 'essence',
      couleur: 'orange',
      importe: false,
    });
    await vehiculeStock.mettreEnStock(
      ctxDirection,
      direction,
      vehiculeDusterId,
      {
        siteId: idMartigny,
        provenance: 'retour_leasing',
        dateEntreeStock: '2026-07-05',
        prixAchatCentimes: PRIX_ACHAT_DUSTER_CENTIMES,
        prixVenteAfficheCentimes: PRIX_VENTE_DUSTER_CENTIMES,
        vendeurPrecedentAssujetti: true,
      },
      CLE_MISE_EN_STOCK_DUSTER,
    );
    journaliser(
      `  Dacia Duster — en stock à MARTIGNY (statut disponible, provenance retour_leasing)`,
    );

    // =============================================================================================
    // Dossier 2 — Škoda Kodiaq / M. Meier (CL-000001) / SION
    // Statut cible : « prospection » (encore au stade du devis, aucun bon de commande signé).
    // Financement comptant — `confirme` d'emblée (RV-44 : aucune confirmation tierce n'a de sens).
    // =============================================================================================

    const resultatDossierKodiaq = await dossierVente.creer(
      ctxVendeur,
      vendeur,
      {
        siteId: idSion,
        vehiculeId: vehiculeKodiaqId,
        clientAcheteurId: idClientMeier,
        dateLivraisonEstimee: '2026-09-01',
      },
      CLE_DOSSIER_VENTE_KODIAQ,
    );
    const dossierKodiaqId = resultatDossierKodiaq.reponse.corps.donnees.id;
    journaliser(`  dossier de vente Kodiaq / Meier — créé (prospection)`);

    const entreeFinancementKodiaq: EntreeCreationFinancement = {
      type: 'comptant',
      referenceContrat: 'Paiement comptant à la commande',
    };
    await financement.creer(
      ctxVendeur,
      vendeur,
      dossierKodiaqId,
      entreeFinancementKodiaq,
      CLE_FINANCEMENT_KODIAQ,
    );
    journaliser(`  financement comptant Kodiaq/Meier — confirmé (dérivé, RV-44)`);

    // =============================================================================================
    // Dossier 3 — Volkswagen Tiguan / Transports Rhône Sàrl (CL-000003) / SION
    // Reprise du fourgon Iveco Daily (négociée puis CONFIRMÉE à la signature, RV-19/RV-27).
    // Financement leasing (AlpiLeasing SA) laissé EN ATTENTE (organisme pas encore revenu vers
    // nous) : le dossier ne peut donc PAS aller plus loin que « en_preparation »
    // (`marquerPretALivrer` exige un financement `confirme`, RV-37) — c'est un cas réel, pas un
    // dossier laissé à moitié fait.
    // =============================================================================================

    const vehiculeIvecoDailyId = await creerVehiculeDemo(CLE_VEHICULE_IVECO_DAILY, {
      vin: VIN_IVECO_DAILY,
      marque: 'Iveco',
      modele: 'Daily',
      version: '35C15 Fourgon L3H2',
      premiereMiseEnCirculationLe: '2016-04-01',
      carburant: 'diesel',
      couleur: 'blanc',
      importe: false,
    });
    journaliser(`  véhicule Iveco Daily (reprise de Transports Rhône Sàrl) créé`);

    const resultatDossierTiguan = await dossierVente.creer(
      ctxVendeur,
      vendeur,
      {
        siteId: idSion,
        vehiculeId: vehiculeTiguanId,
        clientAcheteurId: idClientTransportsRhone,
        // RV-40/RV-41 : en leasing, le DESTINATAIRE de la facture est l'organisme, pas le client —
        // décision de facturation distincte du `type` porté par le financement, jamais fusionnée.
        clientFactureId: idOrganismeLeasing,
        dateLivraisonEstimee: '2026-08-25',
      },
      CLE_DOSSIER_VENTE_TIGUAN,
    );
    const dossierTiguanId = resultatDossierTiguan.reponse.corps.donnees.id;
    journaliser(`  dossier de vente Tiguan / Transports Rhône Sàrl — créé (prospection)`);

    const entreeFinancementTiguan: EntreeCreationFinancement = {
      type: 'leasing',
      organismeId: idOrganismeLeasing,
      referenceContrat: 'AL-2026-0093',
      montantFinanceCentimes: PRIX_VENTE_TIGUAN_CENTIMES,
      mensualiteCentimes: 99_000,
      tauxInteretPourmille: 39,
      dureeMois: 48,
    };
    await financement.creer(
      ctxVendeur,
      vendeur,
      dossierTiguanId,
      entreeFinancementTiguan,
      CLE_FINANCEMENT_TIGUAN,
    );
    journaliser(`  financement leasing Tiguan (AlpiLeasing SA) — en attente de confirmation`);

    if ((await statutDossier(dossierTiguanId)) === 'prospection') {
      const entreeReprise: EntreeCreationReprise = {
        vehiculeReprisId: vehiculeIvecoDailyId,
        valeurEstimeeCentimes: 850_000,
        detteFinancementResiduelleCentimes: 300_000,
        detteFinancementOrganismeNom:
          "Solde de crédit constructeur auprès d'un organisme tiers, non enregistré comme client DFA (CV-02)",
      };
      await reprise.creer(ctxVendeur, vendeur, dossierTiguanId, entreeReprise, CLE_REPRISE_TIGUAN);
      // `negocier()` est explicitement rejouable tant que statut != confirmee/refusee (voir sa
      // docstring) — sûr même si cette section était déjà partiellement exécutée.
      await reprise.negocier(ctxVendeur, vendeur.role, dossierTiguanId, {
        valeurNegocieeCentimes: 750_000,
      });
      journaliser(`  reprise Iveco Daily — négociée à 7'500.— (estimée à 8'500.—)`);

      const entreeBonCommandeTiguan: EntreeCreationDocumentVente = {
        typeDocument: 'bon_commande',
        siteId: idSion,
        clientId: idClientTransportsRhone,
        vehiculeId: vehiculeTiguanId,
        dossierVenteId: dossierTiguanId,
        dateDocument: '2026-08-05',
        devise: 'CHF',
        lignes: [
          ligneDocument(
            'forfait',
            `Véhicule d'occasion — Volkswagen Tiguan 2.0 TDI 150 Life (VIN ${VIN_TIGUAN})`,
            PRIX_VENTE_TIGUAN_CENTIMES,
            '2026-08-05',
          ),
        ],
      };
      const resultatBonCommandeTiguan = await documents.creer(
        ctxVendeur,
        vendeur,
        entreeBonCommandeTiguan,
        CLE_BON_COMMANDE_TIGUAN,
      );
      const bonCommandeTiguanId = resultatBonCommandeTiguan.reponse.corps.donnees.id;

      // La reprise passe automatiquement `negociee -> confirmee` À L'INTÉRIEUR de `engager()`
      // (RV-19/RV-27) : pas d'appel direct à `reprise.confirmer()` ici, même patron que l'API réelle.
      await dossierVente.engager(ctxVendeur, vendeur.role, dossierTiguanId, {
        bonCommandeDocumentId: bonCommandeTiguanId,
        identitePieceType: 'carte_identite',
      });
      journaliser(`  dossier de vente Tiguan / Transports Rhône Sàrl — engagé (reprise confirmée)`);
    }

    if ((await statutDossier(dossierTiguanId)) === 'engage') {
      await dossierVente.preparer(ctxVendeur, vendeur.role, dossierTiguanId, {});
      journaliser(`  dossier de vente Tiguan / Transports Rhône Sàrl — en préparation`);
    }

    // =============================================================================================
    // Dossier 4 — Dacia Duster / M. Meier (CL-000001) / MARTIGNY
    // Financement crédit REFUSÉ par l'organisme -> dossier ANNULÉ depuis « prospection » (le refus
    // arrive le plus souvent AVANT tout bon de commande signé, jamais après — pas de bon de commande
    // ni d'engagement ici, contrairement aux autres dossiers).
    // =============================================================================================

    const resultatDossierDuster = await dossierVente.creer(
      ctxVendeur,
      vendeur,
      {
        siteId: idMartigny,
        vehiculeId: vehiculeDusterId,
        clientAcheteurId: idClientMeier,
        dateLivraisonEstimee: null,
      },
      CLE_DOSSIER_VENTE_DUSTER,
    );
    const dossierDusterId = resultatDossierDuster.reponse.corps.donnees.id;
    journaliser(`  dossier de vente Duster / Meier — créé (prospection)`);

    const montantFinanceDuster = PRIX_VENTE_DUSTER_CENTIMES - 690_000;
    const entreeFinancementDuster: EntreeCreationFinancement = {
      type: 'credit',
      organismeId: idOrganismeCredit,
      referenceContrat: 'CC-2026-0512',
      montantFinanceCentimes: montantFinanceDuster,
      acompteCentimes: 690_000,
      mensualiteCentimes: 32_000,
      tauxInteretPourmille: 89,
      dureeMois: 36,
    };
    const resultatFinancementDuster = await financement.creer(
      ctxVendeur,
      vendeur,
      dossierDusterId,
      entreeFinancementDuster,
      CLE_FINANCEMENT_DUSTER,
    );
    const financementDusterId = resultatFinancementDuster.reponse.corps.donnees.id;
    const entreeRefuserFinancement: EntreeActionRefuserFinancement = {
      motif:
        "Dossier de financement refusé par l'organisme : taux d'endettement du client jugé insuffisant.",
    };
    // `refuser()` n'a pas non plus de garde de statut côté serveur — sûr à rejouer tant qu'on ne
    // l'appelle jamais après un `confirmer()` sur le MÊME financement (ce n'est pas le cas ici).
    await financement.refuser(
      ctxVendeur,
      vendeur.role,
      dossierDusterId,
      financementDusterId,
      entreeRefuserFinancement,
    );
    journaliser(`  financement crédit Duster/Meier (CarCrédit Suisse SA) — refusé`);

    if (
      ['prospection', 'engage', 'en_preparation'].includes(await statutDossier(dossierDusterId))
    ) {
      const entreeAnnuler: EntreeActionAnnulerDossierVente = {
        motif:
          "Financement refusé par l'organisme, le client renonce à l'achat faute d'alternative de paiement.",
      };
      await dossierVente.annuler(ctxVendeur, vendeur.role, dossierDusterId, entreeAnnuler);
      journaliser(`  dossier de vente Duster / Meier — annulé`);
    }

    // =============================================================================================
    // Récapitulatif — chaque dimension filtrable porte désormais AU MOINS deux valeurs distinctes :
    //   - dossier_vente.statut    : pret_a_livrer (Audi), prospection (Kodiaq), en_preparation
    //                               (Tiguan), annule (Duster) — 4 valeurs ;
    //   - vehicule_stock.provenance : achat_particulier, neuf_constructeur (x2), reprise,
    //                               demonstrateur, retour_leasing — 5 valeurs ;
    //   - vehicule_stock.statutCommercial : reserve (Audi, Tiguan), disponible (Kodiaq, Peugeot 308,
    //                               Duster), en_commande (Clio) — 3 valeurs ;
    //   - typeVehicule (dérivé)   : vn (Kodiaq, Clio), vo (les quatre autres) — 2 valeurs ;
    //   - reprise                : une (Iveco Daily / Tiguan, confirmee) ;
    //   - financement.type       : comptant (Kodiaq), credit (Audi, Duster), leasing (Tiguan) —
    //                               les trois valeurs ;
    //   - financement.statutConfirmation : confirme (Audi, Kodiaq), en_attente (Tiguan), refuse
    //                               (Duster) — les trois valeurs.
    // =============================================================================================
  } finally {
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
