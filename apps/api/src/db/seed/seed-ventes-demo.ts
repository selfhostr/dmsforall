/**
 * Cycle de vente VN/VO de démonstration (étape « ventes ») — complète `seed-dev.ts` avec un
 * véhicule d'occasion mis en stock et un dossier de vente poussé à un statut INTERMÉDIAIRE
 * (`en_preparation`), pour que l'écran « dossiers de vente » ait quelque chose à montrer sans
 * qu'il faille d'abord construire tout le cycle à la main.
 *
 * Avant ce fichier : `select count(*) from public.vehicule_stock` et
 * `select count(*) from public.dossier_vente` rendaient 0 après `pnpm db:seed` (issue #20,
 * commentaire de suivi) — le module ventes, livré à l'étape 4, était entièrement inexplorable.
 *
 * Même doctrine que les autres fichiers de ce dossier (voir la tête de `seed-atelier-demo.ts`,
 * non répétée ici) : jamais `NestFactory`, les VRAIS services de `vehicules/`, `ventes/` et
 * `facturation/` sont câblés à la main et exécutent le même code métier que l'API réelle — y
 * compris la machine à états du dossier de vente (`prospection -> engage -> en_preparation`,
 * RV-32).
 *
 * `POST /vehicules` (`ServiceVehicule.creerDansTransaction`) est appelée exactement comme le fait
 * `vehicule.controller.ts::creer` — enveloppée à la main dans `ServiceIdempotence.executer`,
 * puisque l'idempotence de cet endpoint est portée par le CONTRÔLEUR, pas par le service
 * (voir sa docstring : « appelée par le contrôleur À L'INTÉRIEUR de ServiceIdempotence.executer »).
 */
import 'reflect-metadata';

import type {
  EntreeActionEngager,
  EntreeActionPreparer,
  EntreeCreationDocumentVente,
  EntreeCreationDossierVente,
  EntreeCreationLigneDocument,
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
import { ServiceDossierVente } from '../../ventes/service-dossier-vente';
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
 *  dossier. */
const CLE_VEHICULE_AUDI_A4 = 'e2113efb-a5c0-41da-b2ac-a2d8eaa38d33';
const CLE_MISE_EN_STOCK_AUDI_A4 = '8cce7158-8c8f-4b97-9d05-9714e0cba820';
const CLE_BON_COMMANDE_AUDI_A4 = 'ca0dcffa-fcf0-47a1-89f3-501342f8df12';
const CLE_DOSSIER_VENTE_AUDI_A4 = '56dd63c4-13b3-40c1-a5e7-7834c69fd896';

const VIN_AUDI_A4 = 'WAUZZZ8K9KA123459';
const PRIX_ACHAT_AUDI_A4_CENTIMES = 1_650_000; // 16'500.—, reprise/achat direct.
const PRIX_VENTE_AUDI_A4_CENTIMES = 2_190_000; // 21'900.— affiché.

export async function semerVentesDemo(options: OptionsSeedVentes): Promise<void> {
  const journaliser = options.journaliser ?? ((m: string) => process.stdout.write(`${m}\n`));

  if (options.config.NODE_ENV === 'production') {
    throw new Error(
      `Le seed de démonstration ventes est interdit en production : il crée un véhicule, une fiche stock et un dossier de vente factices.`,
    );
  }

  const idMartigny = options.idsSitesParCode.get('MARTIGNY');
  const idClientDupont = options.idsClientsParNumero.get('CL-0002');
  const idReceptionnaire = options.idsUtilisateursParRole.get('receptionnaire');
  if (!idMartigny || !idClientDupont || !idReceptionnaire) {
    throw new Error(
      `seed-ventes-demo : site MARTIGNY, client CL-0002 ou compte réceptionnaire introuvable — vérifier l'ordre d'exécution de seed-dev.ts.`,
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
    const mouvements = new ServiceMouvement(acces, idempotence);
    const documents = new ServiceDocumentsVente(acces, idempotence, audit, horloge, mouvements);
    const serviceVehicule = new ServiceVehicule(acces, horloge);
    const vehiculeStock = new ServiceVehiculeStock(acces, idempotence, audit, horloge);
    const dossierVente = new ServiceDossierVente(acces, idempotence, audit, horloge);

    const ctx: ContexteTenant = {
      tenantId: options.tenantId,
      utilisateurId: idReceptionnaire,
      requeteId: null,
    };
    const receptionnaire: PrincipalAuthentifie = {
      sessionId: 'seed-ventes-demo',
      tenantId: options.tenantId,
      utilisateurId: idReceptionnaire,
      role: 'receptionnaire',
      langue: 'fr',
    };

    // --- Véhicule d'occasion (VO) — garage propriétaire, pas encore de client -------------------
    // `premiereMiseEnCirculationLe` renseignée : c'est ce qui fait dériver `typeVehicule = 'vo'`
    // côté `ServiceVehiculeStock` (voir `calculerTypeVehicule`), jamais saisi directement.
    const entreeVehicule: EntreeCreationVehicule = {
      vin: VIN_AUDI_A4,
      marque: 'Audi',
      modele: 'A4 Avant',
      version: '2.0 TDI 150 quattro',
      premiereMiseEnCirculationLe: '2019-05-14',
      carburant: 'diesel',
      couleur: 'gris',
      importe: false,
    };
    const resultatVehicule = await idempotence.executer(
      ctx,
      { methode: 'POST', chemin: '/vehicules', cle: CLE_VEHICULE_AUDI_A4, corps: entreeVehicule },
      async (tx) => {
        const { donnees, avertissements } = await serviceVehicule.creerDansTransaction(
          tx,
          ctx,
          entreeVehicule,
        );
        return { statutHttp: 201, corps: avertissements.envelopper(donnees) };
      },
    );
    const vehiculeId = resultatVehicule.reponse.corps.donnees.id;
    journaliser(`  véhicule Audi A4 Avant (VIN ${VIN_AUDI_A4}) créé`);

    // --- Mise en stock (RV-01→RV-03) — provenance achat direct auprès d'un particulier ----------
    const entreeMiseEnStock: EntreeMiseEnStock = {
      siteId: idMartigny,
      provenance: 'achat_particulier',
      dateEntreeStock: '2026-06-01',
      prixAchatCentimes: PRIX_ACHAT_AUDI_A4_CENTIMES,
      prixVenteAfficheCentimes: PRIX_VENTE_AUDI_A4_CENTIMES,
      vendeurPrecedentAssujetti: false,
    };
    await vehiculeStock.mettreEnStock(
      ctx,
      receptionnaire,
      vehiculeId,
      entreeMiseEnStock,
      CLE_MISE_EN_STOCK_AUDI_A4,
    );
    journaliser(`  Audi A4 Avant — en stock à MARTIGNY (21'900.— affiché)`);

    // --- Dossier de vente (RV-29→RV-38) — un seul dossier de démo, statut cible « en_preparation » --
    // `Idempotency-Key` FIXE (voir la tête de fichier) : un rejeu renvoie la réponse mémorisée,
    // jamais un second dossier pour le même véhicule — même patron que `creerOr` dans
    // `seed-atelier-demo.ts`, pas de vérification d'existence manuelle nécessaire en amont.
    const entreeDossier: EntreeCreationDossierVente = {
      siteId: idMartigny,
      vehiculeId,
      clientAcheteurId: idClientDupont,
      dateLivraisonEstimee: null,
    };
    const resultatDossier = await dossierVente.creer(
      ctx,
      receptionnaire,
      entreeDossier,
      CLE_DOSSIER_VENTE_AUDI_A4,
    );
    const dossierVenteId = resultatDossier.reponse.corps.donnees.id;
    journaliser(`  dossier de vente Audi A4 / Dupont — créé (prospection)`);

    /** Relit le statut RÉEL du dossier (jamais une réponse mémorisée par l'idempotence, figée à
     *  l'état de création) — `engager`/`preparer` ne sont PAS idempotentes par construction
     *  (transitions de machine à états, même doctrine que `ServiceTransitions` en atelier). */
    const statutCourant = async (): Promise<string> => {
      const document = await dossierVente.obtenirComplet(ctx, receptionnaire.role, dossierVenteId);
      return document.statut;
    };

    if ((await statutCourant()) === 'prospection') {
      // Le « bon de commande » (RV-32/RV-37) rattaché au dossier — condition de `engager()`.
      const entreeBonCommande: EntreeCreationDocumentVente = {
        typeDocument: 'bon_commande',
        siteId: idMartigny,
        clientId: idClientDupont,
        vehiculeId,
        dossierVenteId,
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
        ctx,
        receptionnaire,
        entreeBonCommande,
        CLE_BON_COMMANDE_AUDI_A4,
      );
      const bonCommandeId = resultatBonCommande.reponse.corps.donnees.id;

      const entreeEngager: EntreeActionEngager = {
        bonCommandeDocumentId: bonCommandeId,
        identitePieceType: 'carte_identite',
      };
      await dossierVente.engager(ctx, receptionnaire.role, dossierVenteId, entreeEngager);
      journaliser(`  dossier de vente Audi A4 / Dupont — engagé (véhicule réservé)`);
    }

    if ((await statutCourant()) === 'engage') {
      const entreePreparer: EntreeActionPreparer = {};
      await dossierVente.preparer(ctx, receptionnaire.role, dossierVenteId, entreePreparer);
      journaliser(`  dossier de vente Audi A4 / Dupont — en préparation`);
    }
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
