import type {
  AdresseStructureeQr,
  BlocCreancierFige,
  BlocPaiementQrFige,
  DeviseFacturation,
  DocumentVenteTva,
  MontantsLigneDocument,
  ReponseDocumentVente,
  ReponseLigneDocumentVente,
  RoleUtilisateur,
  ValeursFigeesDocument,
} from '@dfa/shared';
import { DEVISES_FACTURATION, SEUIL_LIGNES_EMBARQUEES_DOCUMENT } from '@dfa/shared';

import { ROLES_SANS_MONTANT } from '../../auth/matrice-droits';
import type { LigneDocumentVente, LigneLigneDocument } from '../../db/schema';
import { ErreurMetier } from '../../common/erreurs/erreur-metier';
import { estQrIban } from '../qr';
import { calculerRetardDocument } from './echeance';
import type { ResumeUtilisateur } from './references';

function estDeviseFacturation(valeur: string): valeur is DeviseFacturation {
  return (DEVISES_FACTURATION as readonly string[]).includes(valeur);
}

/**
 * `document_vente.devise` est un `char(3)` en base, désormais contraint par `document_vente_devise_chk
 * check (devise in ('CHF', 'EUR'))` (migration 0015) — borné à CHF/EUR exactement comme `paiement.devise`.
 *
 * La garde runtime reste NÉCESSAIRE malgré cette contrainte base : elle protège le code contre l'état
 * RÉEL de la base (restaurée d'avant migration, migrée manuellement, ou lue par SQL brut), pas l'état
 * espéré. C'est de la défense en profondeur assumée, pas une redondance.
 *
 * Le contrat `ReponseDocumentVente.devise` (RF-58, QR-facture) impose CHF/EUR uniquement — une valeur
 * inattendue doit remonter bruyamment (ErreurMetier), jamais passer silencieusement. Même patron que
 * `facturation/paiements/mappeurs.ts::deviseFacturationDepuisBase` (dupliqué ici : patron partagé
 * entre deux périmètres disjoints, pas une dépendance croisée).
 */
function deviseFacturationDepuisBase(valeur: string, contexte: string): DeviseFacturation {
  if (!estDeviseFacturation(valeur)) {
    throw new ErreurMetier(
      'ERREUR_INTERNE',
      `Devise inattendue en base pour ${contexte} : "${valeur}" — seules CHF et EUR sont admises (contrat RF-58 ; document_vente.devise n'impose que le format en base).`,
    );
  }
  return valeur;
}

/**
 * Filtrage des montants par rôle, PROPRE à la facturation — PAS un simple appel à
 * `!ROLES_SANS_MONTANT.includes(role)` comme `atelier/mappeurs.ts`. Raison, signalée : `RF-116`
 * (`docs/specification-etape-2-facturation.md` §9, tableau `RF-114`) exclut explicitement `admin`
 * de « voir les montants » en facturation — séparation des pouvoirs (`RF-115` : « qui peut créer
 * des comptes ne doit pas pouvoir émettre des factures/voir les montants »). `ROLES_SANS_MONTANT`
 * (`auth/matrice-droits.ts`) est un const PARTAGÉ à tout le produit et ne contient que `'technicien'`
 * — la doctrine étape 1 pose `admin` comme superset de `direction`, EXACTEMENT LE CONTRAIRE de
 * `RF-115`. Étendre `ROLES_SANS_MONTANT` à `admin` changerait aussi l'affichage des montants de
 * l'OR (`atelier/`), hors du périmètre de cette tâche et potentiellement une régression non
 * demandée. Ce module applique donc la règle `RF-116` LOCALEMENT (`admin` en plus de
 * `ROLES_SANS_MONTANT`), sans toucher au const partagé — même tension déjà rencontrée et tranchée
 * de la même façon par l'agent `paiements` (voir `auth/matrice-droits.ts`, section « Facturation —
 * paiements », `DROITS_PAIEMENT_PAR_ROLE.admin = []`, RF-115 « À LA DIFFÉRENCE de la doctrine de
 * l'étape 1 »).
 */
const ROLES_SANS_MONTANT_FACTURATION: ReadonlySet<RoleUtilisateur> = new Set([
  ...ROLES_SANS_MONTANT,
  'admin',
]);

export function roleVoitLesMontants(role: RoleUtilisateur): boolean {
  return !ROLES_SANS_MONTANT_FACTURATION.has(role);
}

export function mapperLigneDocument(
  ligne: LigneLigneDocument,
  role: RoleUtilisateur,
): ReponseLigneDocumentVente {
  const voitMontants = roleVoitLesMontants(role);
  const montants: MontantsLigneDocument = {
    montantHtCentimes: ligne.htCentimes,
    montantTvaCentimes: ligne.tvaCentimes,
    montantTtcCentimes: ligne.ttcCentimes,
    // MD-66/AC-07 : distinction garage/facturable non applicable à une ligne saisie directement en
    // facturation (aucune ligne « payeur = garage » ne provient de ce module — seule une ligne
    // recopiée depuis un OR le porterait, hors périmètre de cette tâche, voir facturation.module.ts).
    montantFacturableCentimes: ligne.ttcCentimes,
    montantValoriseCentimes: ligne.montantValoriseCentimes ?? ligne.ttcCentimes,
  };

  return {
    id: ligne.id,
    documentId: ligne.documentId,
    numeroOrdre: ligne.numeroOrdre,
    type: ligne.typeLigne,
    ligneOrId: ligne.ligneOrId,
    documentAcompteId: ligne.documentAcompteId,
    designation: ligne.designation,
    referenceTexte: ligne.referenceTexte,
    articleId: null, // Accroche étape 3 (stock pièces) — toujours null tant que le module n'existe pas.
    quantiteMillieme: ligne.quantiteMillieme,
    modeCalculTva: ligne.modeCalculTva,
    regimeTva: ligne.regimeTva,
    tauxTvaPourmille: ligne.tauxTvaPourmille,
    datePrestation: ligne.datePrestation,
    // `remisePourmille` est un TAUX (aucun montant en clair) — toujours exposé.
    remisePourmille: ligne.remisePourmille,
    // DÉFAUT AUDIT (RF-115/RF-116) : tous les champs MONÉTAIRES de ligne — prix unitaire, remise en
    // montant, part de remise globale ventilée ET l'agrégat `montants` — reçoivent le MÊME traitement
    // (absents, jamais mis à `null`) pour un rôle sans droit aux montants. Exposés, `prixUnitaire ×
    // quantite` reconstituerait ligne à ligne le montant que `montants` masque déjà.
    ...(voitMontants
      ? {
          prixUnitaireTtcCentimes: ligne.prixUnitaireCentimes,
          remiseMontantCentimes: ligne.remiseMontantCentimes,
          remiseGlobaleRepartieCentimes: ligne.remiseGlobaleRepartieCentimes,
          montants,
        }
      : {}),
    creeLe: ligne.creeLe.toISOString(),
    modifieLe: ligne.modifieLe.toISOString(),
  };
}

export interface VentilationTvaLigne {
  readonly regimeTva: string;
  readonly tauxTvaPourmille: number;
  readonly baseCentimes: number;
  readonly tvaCentimes: number;
}

export interface TotauxDocumentMappes {
  readonly totalHtCentimes: number;
  readonly totalTvaCentimes: number;
  readonly totalTtcCentimes: number;
  readonly ecartRepriseCentimes: number;
}

export interface EntreeMapperDocument {
  readonly doc: LigneDocumentVente;
  readonly lignesToutes: readonly LigneLigneDocument[];
  readonly ventilationTva: readonly VentilationTvaLigne[];
  readonly role: RoleUtilisateur;
  readonly figeesAdresse: AdresseStructureeQr | null;
  readonly figeesPlaque: string | null;
  readonly emisPar: ResumeUtilisateur | null;
  readonly modifiePar: ResumeUtilisateur | null;
  /**
   * Totaux à afficher. Source DIFFÉRENTE selon le statut, choisie par l'appelant (`service-
   * documents.ts::assemblerDocument`) :
   *  - `brouillon` : recalculés EN DIRECT depuis `lignesToutes` (`Σ ht/tva/ttc` déjà stockés par
   *    ligne — la remise globale n'est pas encore ventilée, `MD-59` : « ventilée À L'ÉMISSION »,
   *    donc un brouillon affiche des totaux qui ne la reflètent pas encore, cohérent avec `MD-61` :
   *    « un brouillon peut tout contenir, c'est l'émission qui engage ») ;
   *  - `emis` (et au-delà) : lus tels quels sur `document_vente.total_*` (figés à l'émission,
   *    `MD-45`, jamais recalculés).
   * Ce module ne choisit pas la source — il se contente d'afficher ce qu'on lui donne, pour rester
   * un pur mappeur sans accès base.
   */
  readonly totaux: TotauxDocumentMappes;
  /** Version optimiste — voir `document-vente.etag.ts` : `document_vente` n'a pas de colonne
   *  `version` dédiée (contrairement à `ordre_reparation`), substituée par `modifie_le` en
   *  millisecondes epoch. Signalé dans `document-vente.etag.ts`. */
  readonly version: number;
  /** Instant de LECTURE (injecté par l'appelant, jamais lu ici — même doctrine que `Horloge`
   *  partout ailleurs) : sert uniquement à dériver `enRetard`/`joursRetard` (`echeance.ts`), qui ne
   *  sont JAMAIS stockés — un document qui n'a pas changé peut légitimement passer « en retard »
   *  d'une lecture à l'autre, sans qu'aucune colonne bouge. */
  readonly maintenant: Date;
}

/**
 * Une colonne `qr_*`/`creancier_*` manquante alors que `qr_payload` est renseigné est une
 * incohérence de données, jamais un cas métier normal : `qr-emission.ts::emettre()` les écrit
 * TOUTES ensemble, dans la même transaction que l'attribution du numéro (voir `service-
 * emission.ts`). Remonte bruyamment plutôt que de fabriquer un bulletin partiel — même doctrine
 * que `deviseFacturationDepuisBase` ci-dessus.
 */
function valeurQrRequise<T>(valeur: T | null, champ: string, documentId: string): T {
  if (valeur == null) {
    throw new ErreurMetier(
      'ERREUR_INTERNE',
      `Bloc QR figé incomplet pour le document ${documentId} : colonne "${champ}" vide alors que ` +
        `qr_payload est renseigné — incohérence entre colonnes figées à l'émission (qr-emission.ts ` +
        `les écrit toutes ensemble, dans la même transaction que le numéro).`,
    );
  }
  return valeur;
}

function construireCreancierQrFige(doc: LigneDocumentVente): BlocCreancierFige {
  const iban = valeurQrRequise(doc.qrIban, 'qr_iban', doc.id);
  return {
    iban,
    // Dérivé de l'IBAN FIGÉ lui-même (classification IID 30000-31999, `qr/iban.ts::estQrIban`),
    // jamais recalculé depuis `tenant_bloc_creancier` courant — l'IBAN stocké ne change plus une
    // fois la facture émise, donc cette classification est stable, pas un recalcul du bulletin.
    estQrIban: estQrIban(iban),
    nom: valeurQrRequise(doc.creancierNom, 'creancier_nom', doc.id),
    adresse: {
      rue: valeurQrRequise(doc.creancierRue, 'creancier_rue', doc.id),
      numero: doc.creancierNumero,
      npa: valeurQrRequise(doc.creancierNpa, 'creancier_npa', doc.id),
      localite: valeurQrRequise(doc.creancierLocalite, 'creancier_localite', doc.id),
      pays: valeurQrRequise(doc.creancierPays, 'creancier_pays', doc.id),
    },
  };
}

/**
 * Le débiteur QR n'est PAS stocké séparément sur `document_vente` — seul `qr_debiteur_present`
 * (booléen) l'est. `service-emission.ts::debiteurQr` le construit à l'émission depuis
 * `adresse_facturation_figee` + `client_designation_figee` : EXACTEMENT la même source que
 * `figeesAdresse`/`figees.clientDesignation` déjà exposés par ce mappeur (voir `adresseDepuisJsonb`
 * dans `service-documents.ts`). Relire cette même donnée figée n'est pas « recalculer le QR » —
 * c'est afficher, sous une deuxième porte, une valeur déjà figée et déjà exposée par ailleurs dans
 * la même réponse (`figees.adresseFacturation`, `figees.clientDesignation`).
 */
function construireDebiteurQrFige(
  doc: LigneDocumentVente,
  figeesAdresse: AdresseStructureeQr | null,
): (AdresseStructureeQr & { readonly nom: string }) | null {
  if (!doc.qrDebiteurPresent) {
    return null;
  }
  if (!figeesAdresse) {
    throw new ErreurMetier(
      'ERREUR_INTERNE',
      `Bloc QR figé incomplet pour le document ${doc.id} : qr_debiteur_present=true mais adresse_facturation_figee est absente.`,
    );
  }
  return { ...figeesAdresse, nom: doc.clientDesignationFigee };
}

/**
 * `null` est le cas NORMAL, pas une erreur : seule une `facture` porte un bulletin QR (`RF-54 ` —
 * un devis, un bon de commande ou un avoir n'en ont jamais, un avoir crédite le client au lieu de
 * se faire payer) et seule une facture ÉMISE en porte un (`qr_payload` reste `null` en `brouillon`,
 * le bloc n'étant construit qu'à l'émission, `qr-emission.ts`).
 *
 * Ne recompose RIEN depuis `tenant_bloc_creancier` : lit tel quel ce que `qr-emission.ts` a figé
 * dans la même transaction que l'attribution du numéro — recalculer romprait `MD-77` (un
 * déménagement ou un changement d'IBAN postérieur à l'émission ne doit jamais changer le bulletin
 * d'une facture déjà émise/envoyée).
 */
function construireBlocQrFige(
  doc: LigneDocumentVente,
  figeesAdresse: AdresseStructureeQr | null,
): BlocPaiementQrFige | null {
  if (doc.typeDocument !== 'facture' || doc.qrPayload == null) {
    return null;
  }

  return {
    qrPayload: doc.qrPayload,
    qrPayloadSha256: valeurQrRequise(doc.qrPayloadSha256, 'qr_payload_sha256', doc.id),
    typeReferenceQr: valeurQrRequise(doc.typeReferenceQr, 'type_reference_qr', doc.id),
    qrReference: doc.qrReference,
    qrMontantCentimes: Number(
      valeurQrRequise(doc.qrMontantCentimes, 'qr_montant_centimes', doc.id),
    ),
    qrDevise: deviseFacturationDepuisBase(
      valeurQrRequise(doc.qrDevise, 'qr_devise', doc.id),
      `QR du document ${doc.id}`,
    ),
    qrLangue: valeurQrRequise(doc.qrLangue, 'qr_langue', doc.id),
    creancier: construireCreancierQrFige(doc),
    debiteur: construireDebiteurQrFige(doc, figeesAdresse),
  };
}

export function mapperDocument(e: EntreeMapperDocument): ReponseDocumentVente {
  const { doc } = e;
  const voitMontants = roleVoitLesMontants(e.role);

  const figees: ValeursFigeesDocument = {
    clientDesignation: doc.clientDesignationFigee,
    clientIde: doc.clientIdeFige,
    clientLangue: doc.langueFigee,
    adresseFacturation: e.figeesAdresse,
    ...(voitMontants
      ? {
          conditionsPaiement:
            (doc.conditionsPaiementFigees as Record<string, unknown> | null) ?? null,
        }
      : {}),
    plaque: e.figeesPlaque,
  };

  const lignesTronquees = e.lignesToutes.length > SEUIL_LIGNES_EMBARQUEES_DOCUMENT;
  const lignesEmbarquees = lignesTronquees
    ? e.lignesToutes.slice(0, SEUIL_LIGNES_EMBARQUEES_DOCUMENT)
    : e.lignesToutes;

  const ventilationTva: readonly DocumentVenteTva[] = e.ventilationTva.map((v) => ({
    regimeTva: v.regimeTva as DocumentVenteTva['regimeTva'],
    tauxTvaPourmille: v.tauxTvaPourmille,
    baseCentimes: v.baseCentimes,
    tvaCentimes: v.tvaCentimes,
  }));

  return {
    id: doc.id,
    typeDocument: doc.typeDocument,
    natureFacture: doc.typeDocument === 'facture' ? doc.natureFacture : null,
    origine: doc.origine,
    numero: doc.numero,
    numeroSequence: doc.numeroSequence,
    numeroOrigine: doc.numeroOrigine,
    exercice: doc.exercice,
    statut: doc.statut,
    ...(voitMontants ? { statutReglement: doc.statutReglement } : {}),
    siteId: doc.siteId,
    clientId: doc.clientId,
    vehiculeId: doc.vehiculeId,
    ordreReparationId: doc.ordreReparationId,
    dossierVenteId: doc.dossierVenteId,
    documentSourceId: doc.documentSourceId,
    factureAnnuleeId: doc.factureAnnuleeId,
    annuleParAvoirId: doc.annuleParAvoirId,
    remplaceId: doc.remplaceId,
    figees,
    dateDocument: doc.dateDocument ?? '',
    devise: deviseFacturationDepuisBase(doc.devise, `document ${doc.id}`),
    tvaNonVentilee: doc.tvaNonVentilee,
    tauxTvaPourmilleDocument: doc.tauxTvaPourmille,
    mentionTvaInterdite: doc.mentionTvaInterdite,
    ...(voitMontants
      ? {
          totalHtCentimes: e.totaux.totalHtCentimes,
          totalTvaCentimes: e.totaux.totalTvaCentimes,
          ecartRepriseCentimes: e.totaux.ecartRepriseCentimes,
          totalTtcCentimes: e.totaux.totalTtcCentimes,
          ventilationTva: doc.tvaNonVentilee ? [] : ventilationTva,
          // MD-53 : dérivés de `imputation_paiement`, propriété du sous-module `paiements/` (livré
          // séparément — voir la note de coordination dans `facturation.module.ts`). Lus tels
          // quels sur la colonne (0 par défaut tant qu'aucun paiement n'est imputé) : ce module
          // n'écrit jamais ces deux colonnes.
          montantRegleCentimes: Number(doc.montantRegleCentimes),
          soldeCentimes: Number(doc.soldeCentimes),
          // RF-04/PF-04/MD-94 : échéance figée à l'émission (`service-emission.ts`) — `null` sur un
          // devis/bon de commande/avoir (jamais calculée pour ces types), ou sur une facture dont le
          // client n'avait aucun délai de paiement structuré en vigueur à sa création (`echeance.ts`
          // pour le raisonnement complet). `enRetard`/`joursRetard` sont DÉRIVÉS à CETTE lecture,
          // jamais stockés (`calculerRetardDocument`) : un document non modifié peut légitimement
          // basculer « en retard » d'une lecture à l'autre, sans qu'aucune colonne ne bouge.
          dateEcheance: doc.dateEcheance,
          ...calculerRetardDocument({
            dateEcheance: doc.dateEcheance,
            soldeCentimes: Number(doc.soldeCentimes),
            maintenant: e.maintenant,
          }),
        }
      : {}),
    remiseGlobaleSaisieCentimes:
      doc.remiseGlobaleSaisieCentimes != null ? Number(doc.remiseGlobaleSaisieCentimes) : null,
    remiseGlobalePourmille: doc.remiseGlobalePourmille,
    relanceNiveau: doc.relanceNiveau,
    relanceLe: doc.relanceLe ? doc.relanceLe.toISOString() : null,
    motifAvoir: doc.motifAvoir,
    motifAvoirAutre: doc.motifAvoirLibre,
    porteeAvoir: doc.porteeAvoir,
    // QR figé à l'émission (`construireBlocQrFige` ci-dessus) — lu tel quel sur les colonnes
    // `qr_*`/`creancier_*`, jamais recomposé. `RF-116` : le `qrPayload` contient le montant en
    // clair, donc masqué (comme le reste des montants) pour un rôle sans droit d'y accéder.
    qr: voitMontants ? construireBlocQrFige(doc, e.figeesAdresse) : null,
    pdfCle: doc.pdfCle,
    pdfSha256: doc.pdfSha256,
    exporteLe: doc.exporteLe ? doc.exporteLe.toISOString() : null,
    exportId: doc.exportId,
    contentieux: doc.contentieux,
    lignes: lignesEmbarquees.map((l) => mapperLigneDocument(l, e.role)),
    nombreLignes: e.lignesToutes.length,
    lignesTronquees,
    version: e.version,
    emisLe: doc.emisLe ? doc.emisLe.toISOString() : null,
    emisPar: e.emisPar,
    creeLe: doc.creeLe.toISOString(),
    modifieLe: doc.modifieLe.toISOString(),
    modifiePar: e.modifiePar,
  };
}
