/**
 * Relances de facturation de démonstration (étape « relances automatiques ») — complète
 * `seed-dev.ts`/`seed-facturation-demo.ts` avec ce qu'il faut pour que
 * `POST /relances/facturation/planifier` produise autre chose que `{"creees":0,"ignorees":0}` :
 * une règle de relance ACTIVE, et une facture ÉMISE dont l'échéance est dépassée.
 *
 * Piège documenté par l'issue #17, réellement contourné ici (pas seulement évité par chance) :
 * une facture n'a de `dateEcheance` que si le CLIENT a un `delaiPaiementJours` dans ses conditions
 * commerciales AU MOMENT où le document est créé (`facturation/documents/service-documents.ts`,
 * `conditions_paiement_figees`) — ces conditions sont facultatives à la création d'un client
 * (`FormulaireNouveauClient` ne les envoie jamais) et AUCUN des trois clients de
 * `seed-dev.ts::CLIENTS_DEMO` n'en a. Ce fichier pose donc explicitement une condition sur
 * M. Meier (CL-0001) AVANT de créer la facture en retard ci-dessous — sans cet ordre précis,
 * `dateEcheance` resterait `null` et cette facture serait invisible aux relances, exactement le
 * symptôme décrit par #17.
 *
 * Même doctrine que les autres fichiers de ce dossier (voir la tête de `seed-atelier-demo.ts`,
 * non répétée ici) : jamais `NestFactory`, les VRAIS services (`clients/`, `facturation/`,
 * `relances/`) sont câblés à la main et exécutent le même code métier que l'API réelle.
 */
import 'reflect-metadata';

import { and, eq } from 'drizzle-orm';
import type {
  EntreeConditionClient,
  EntreeCreationDocumentVente,
  EntreeCreationLigneDocument,
  EntreeUpsertRegleRelance,
} from '@dfa/shared';

import type { Config } from '../../config/charger-config';
import { clientCondition } from '../schema';
import { ServiceAuditImpl } from '../../common/audit';
import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';
import { ServiceEvenementsImpl } from '../../common/evenements';
import { Horloge } from '../../common/horloge/horloge';
import { ServiceIdempotenceImpl } from '../../common/idempotence';
import { ServiceJournal } from '../../common/journal';
import { ServiceClientSousCollections } from '../../clients/service-client-sous-collections';
import { ServiceDocumentsVente } from '../../facturation/documents/service-documents';
import { ServiceEmissionDocument } from '../../facturation/documents/service-emission';
import { ServiceCompteursImpl } from '../../parametrage/compteurs/service-compteurs';
import { ServiceMouvement } from '../../pieces/service-mouvement';
import { ServiceReservation } from '../../pieces/service-reservation';
import { ServiceRegleRelance } from '../../relances/service-regle-relance';
import { ServiceVehiculeStock } from '../../ventes/service-vehicule-stock';
import { ServiceAccesBase } from '../acces-base.service';
import type { ContexteTenant } from '../index';

export interface OptionsSeedRelances {
  readonly config: Config;
  readonly tenantId: string;
  readonly idsSitesParCode: ReadonlyMap<string, string>;
  readonly idsClientsParNumero: ReadonlyMap<string, string>;
  readonly idsVehiculesParCle: ReadonlyMap<string, string>;
  readonly idsUtilisateursParRole: ReadonlyMap<string, string>;
  readonly journaliser?: (message: string) => void;
}

/** Clés d'idempotence FIXES (uuid v4 littéraux) — même doctrine que les autres fichiers de ce
 *  dossier : un rejeu à corps identique renvoie la réponse mémorisée, jamais un doublon. */
const CLE_FACTURE_MEIER_RETARD_CREATION = 'abb2fda6-62df-46d3-ba9a-9eb9f77595e6';
const CLE_FACTURE_MEIER_RETARD_EMISSION = '58c2370c-6cec-4127-aee0-6a86e175c190';

/** `valide_du` de la condition posée sur Meier — antérieure à TOUT document de démo existant
 *  (dont le devis Golf de `seed-facturation-demo.ts`, daté du 2026-07-10), pour ne modifier le
 *  comportement d'aucun scénario déjà posé ailleurs. */
const CONDITION_MEIER_VALIDE_DU = '2020-01-01';
const CONDITION_MEIER_DELAI_PAIEMENT_JOURS = 30;

/** Facture en retard : datée assez loin dans le passé pour rester en retard longtemps après le
 *  jour où ce seed est rejoué (échéance = date document + 30 jours, ici 2026-02-14), jamais
 *  réglée. */
const DATE_FACTURE_MEIER_RETARD = '2026-01-15';

export async function semerRelancesDemo(options: OptionsSeedRelances): Promise<void> {
  const journaliser = options.journaliser ?? ((m: string) => process.stdout.write(`${m}\n`));

  if (options.config.NODE_ENV === 'production') {
    throw new Error(
      `Le seed de démonstration relances est interdit en production : il crée des conditions client, une facture et une règle de relance factices.`,
    );
  }

  const idSion = options.idsSitesParCode.get('SION');
  const idClientMeier = options.idsClientsParNumero.get('CL-0001');
  const idGolf = options.idsVehiculesParCle.get('WVWZZZ1KZAW123456');
  const idReceptionnaire = options.idsUtilisateursParRole.get('receptionnaire');
  if (!idSion || !idClientMeier || !idGolf || !idReceptionnaire) {
    throw new Error(
      `seed-relances-demo : site SION, client CL-0001, véhicule Golf ou compte réceptionnaire introuvable — vérifier l'ordre d'exécution de seed-dev.ts.`,
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
    const evenements = new ServiceEvenementsImpl(horloge);
    const compteurs = new ServiceCompteursImpl();
    const journal = new ServiceJournal(options.config);
    // `ServiceReservation` (0047) : dépendance de la cascade de libération forcée, câblage manuel
    // requis au même titre que les autres services de ce seed, jamais exercée ici.
    const mouvements = new ServiceMouvement(acces, idempotence, new ServiceReservation(acces));
    const documents = new ServiceDocumentsVente(acces, idempotence, audit, horloge, mouvements);
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
    const clientsSousCollections = new ServiceClientSousCollections(acces, journal);
    const regles = new ServiceRegleRelance(acces);

    const ctx: ContexteTenant = {
      tenantId: options.tenantId,
      utilisateurId: idReceptionnaire,
      requeteId: null,
    };
    const receptionnaire: PrincipalAuthentifie = {
      sessionId: 'seed-relances-demo',
      tenantId: options.tenantId,
      utilisateurId: idReceptionnaire,
      role: 'receptionnaire',
      langue: 'fr',
    };

    // --- Condition commerciale de M. Meier (RM-07/CT-03) — sans elle, `delaiPaiementJours` reste
    // introuvable et la facture ci-dessous n'aurait JAMAIS d'échéance (issue #17). Pas
    // d'`Idempotency-Key` sur `creerCondition` (§7.3, ce n'est pas une création idempotente côté
    // contrat) : on vérifie donc nous-mêmes l'absence d'une condition à la même date de début
    // avant d'écrire, seule façon de rejouer ce script sans heurter l'EXCLUDE de périodes (RM-07).
    const conditionExistante = await acces.enTenant(ctx, (tx) =>
      tx
        .select({ id: clientCondition.id })
        .from(clientCondition)
        .where(
          and(
            eq(clientCondition.tenantId, options.tenantId),
            eq(clientCondition.clientId, idClientMeier),
            eq(clientCondition.valideDu, CONDITION_MEIER_VALIDE_DU),
          ),
        ),
    );
    if (conditionExistante.length === 0) {
      const entreeCondition: EntreeConditionClient = {
        rabaisMoPourmille: 0,
        rabaisPiecesPourmille: 0,
        rabaisPneusPourmille: 0,
        tauxHoraireCode: 'ATELIER',
        delaiPaiementJours: CONDITION_MEIER_DELAI_PAIEMENT_JOURS,
        modePaiement: 'facture',
        plafondCentimes: null,
        valideDuLe: CONDITION_MEIER_VALIDE_DU,
        valideAuLe: null,
      };
      await clientsSousCollections.creerCondition(ctx, idClientMeier, entreeCondition);
    }
    journaliser(
      `  condition commerciale Meier — délai de paiement ${String(CONDITION_MEIER_DELAI_PAIEMENT_JOURS)} jours (dès ${CONDITION_MEIER_VALIDE_DU})`,
    );

    // --- Facture émise, en retard — datée du ${DATE_FACTURE_MEIER_RETARD}, échéance donc le
    // 2026-02-14 (30 jours), jamais réglée : c'est la cible que `POST /relances/facturation/
    // planifier` doit trouver. Vente comptoir directe (petit contrôle), sans lien à un OR — même
    // doctrine que la facture Master de `seed-facturation-demo.ts`.
    const entreeFacture: EntreeCreationDocumentVente = {
      typeDocument: 'facture',
      natureFacture: 'ordinaire',
      siteId: idSion,
      clientId: idClientMeier,
      vehiculeId: idGolf,
      dateDocument: DATE_FACTURE_MEIER_RETARD,
      devise: 'CHF',
      lignes: [
        ligneDocument(
          'forfait',
          'Contrôle et appoint des niveaux',
          6_000,
          DATE_FACTURE_MEIER_RETARD,
        ),
      ],
    };
    const resultatFacture = await documents.creer(
      ctx,
      receptionnaire,
      entreeFacture,
      CLE_FACTURE_MEIER_RETARD_CREATION,
    );
    const factureId = resultatFacture.reponse.corps.donnees.id;
    await emission.emettre(ctx, receptionnaire, factureId, CLE_FACTURE_MEIER_RETARD_EMISSION);
    journaliser(
      `  facture Meier ${DATE_FACTURE_MEIER_RETARD} — ÉMISE, échéance dépassée, jamais réglée (60.00 CHF TTC)`,
    );

    // --- Règle de relance « facture échue » (RA-03/RA-05) — seul type du catalogue avec une
    // implémentation de service à ce lot (`relances/service-relances-facture.ts`). Deux paliers
    // (J+10, J+30 après l'échéance) tous deux DÉJÀ dus vu la date de la facture ci-dessus : un
    // premier appel à `POST /relances/facturation/planifier` doit donc créer deux lignes
    // `relance_planifiee`, pas zéro. `sms` en tête : Meier n'a qu'un téléphone dans
    // `seed-dev.ts::CLIENTS_DEMO` (pas d'email), `email` reste en second choix documentaire.
    const entreeRegle: EntreeUpsertRegleRelance = {
      actif: true,
      delaisJours: [10, 30],
      canaux: ['sms', 'email'],
    };
    await regles.upserter(ctx, 'facture_echue', entreeRegle);
    journaliser(`  règle de relance « facture_echue » — active, paliers J+10/J+30, sms puis email`);
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
