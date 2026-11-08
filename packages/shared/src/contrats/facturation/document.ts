import { z } from 'zod';

import {
  MOTIFS_AVOIR,
  NATURES_FACTURE,
  PORTEES_AVOIR,
  STATUTS_DOCUMENT_VENTE,
  STATUTS_REGLEMENT_DOCUMENT,
  TYPES_DOCUMENT_VENTE,
  type DeviseFacturation,
  type MotifAvoir,
  type NatureFacture,
  type OrigineDocument,
  type PorteeAvoir,
  type RegimeTva,
  type StatutDocumentVente,
  type StatutReglementDocument,
  type TypeDocumentVente,
} from './enums';
import { schemaCreationLigneDocument, type ReponseLigneDocumentVente } from './ligne';
import { schemaCentimesTtc, schemaCentimesTtcPositif, schemaDeviseFacturation } from './primitives';
import { schemaConfirmations } from '../atelier/avertissement';
import {
  schemaCodePays,
  schemaDateJour,
  schemaIdentifiant,
  schemaPourmille,
  schemaTexteCourt,
  schemaTexteLong,
} from '../atelier/primitives';
import { schemaBooleenQuery, schemaListeQuery } from '../filtres';

/**
 * Documents de vente (`document_vente`) — chaîne devis → bon de commande → facture → avoir
 * (§1 → §4 du modèle documentaire, `RF-1` → `RF-32`).
 *
 * PAS de `PATCH` générique sur `statut`, même patron que `ordre-reparation.ts` : chaque transition
 * (émettre, accepter, refuser, transformer, annuler, corriger) est une ACTION NOMMÉE, avec son
 * corps propre, son droit propre et ses codes d'erreur propres — voir §7.7 du contrat étape 1 pour
 * la justification complète, transposée ici sans modification.
 *
 * `statut` et les champs dérivés (`statutReglement`, `soldeCentimes`, `montantRegleCentimes`,
 * `relanceNiveau`) sont en LECTURE SEULE partout, `PATCH` de ligne compris.
 */

/** Au-delà, `lignes` est tronqué (`lignesTronquees = true`) ; le client pagine
 *  `GET /documents-vente/{id}/lignes`. Même seuil et même raison que `SEUIL_LIGNES_EMBARQUEES`
 *  de l'étape 1 — nommé différemment pour éviter toute confusion de collection à l'import. */
export const SEUIL_LIGNES_EMBARQUEES_DOCUMENT = 200;

/* ------------------------------------------------------------------ */
/* Blocs figés : adresse structurée, créancier, QR (§5 de la spéc.)    */
/* ------------------------------------------------------------------ */

/**
 * Adresse structurée à cinq champs obligatoires (+ pays), format imposé par le bloc créancier et
 * le bloc débiteur d'une QR-facture (`MD-73`, `RF-56`). PAS le même objet que l'adresse générale
 * d'un client (`ReponseClientAdresse` de l'étape 1, qui porte une `rue` libre) : le standard suisse
 * QR-bill exige la RUE et le NUMÉRO séparés, et cette exigence est propre à la facturation.
 */
export interface AdresseStructureeQr {
  readonly rue: string;
  readonly numero: string | null;
  readonly npa: string;
  readonly localite: string;
  readonly pays: string;
}

export const formeAdresseStructureeQr = z
  .object({
    rue: schemaTexteCourt,
    numero: z.string().trim().max(20).nullish(),
    npa: z.string().trim().max(16),
    localite: z.string().trim().max(35),
    pays: schemaCodePays.default('CH'),
  })
  .strict();

/**
 * `MD-79`, `RF-59`, `RF-60` : le bloc débiteur n'existe QUE si les cinq champs sont présents. Un
 * client de l'API ne doit jamais tenter de composer un bloc partiel — c'est pour cela que
 * `debiteur` est `null` en bloc sur `BlocPaiementQrFige`, jamais un objet à champs `null`.
 */
export interface BlocCreancierFige {
  readonly iban: string;
  readonly estQrIban: boolean;
  readonly nom: string;
  readonly adresse: AdresseStructureeQr;
}

/**
 * Figé octet pour octet à l'émission (`MD-77`) — `qrPayload` et `qrPayloadSha256` sont LA preuve
 * que le PDF détenu par le client correspond à ce que DFA a produit. Absent (`null`) sur un
 * document dont la devise n'est ni `CHF` ni `EUR` (`RF-58`) : la section paiement est alors
 * remplacée par les coordonnées bancaires en clair dans le PDF, hors du périmètre de ce contrat.
 */
export interface BlocPaiementQrFige {
  readonly qrPayload: string;
  readonly qrPayloadSha256: string;
  readonly typeReferenceQr: 'qrr' | 'scor' | 'non';
  /** `null` si `typeReferenceQr = 'non'`. */
  readonly qrReference: string | null;
  readonly qrMontantCentimes: number;
  readonly qrDevise: DeviseFacturation;
  readonly qrLangue: string;
  readonly creancier: BlocCreancierFige;
  /** `null` quand l'adresse du débiteur était incomplète à l'émission (`RF-59`) — jamais un objet
   *  partiellement rempli. Corrigé (signalement `fact-documents`, `service-emission.ts::debiteurQr`
   *  déjà typé `DebiteurQr | null` en implémentation, colonne `qr_debiteur_present`) : le type
   *  contredisait ce commentaire depuis sa rédaction, ELARGISSEMENT DE TYPE DE RÉPONSE vers
   *  `| null` — un client qui supposait la valeur toujours présente doit désormais la garder. Le
   *  serveur pouvait déjà rendre `null` ; seul le type mentait, ce n'est pas un changement de
   *  contrat serveur. */
  readonly debiteur: (AdresseStructureeQr & { readonly nom: string }) | null;
}

/**
 * Valeurs figées à l'émission (`MD-24`, `MD-25`) — même principe que `ValeursFigeesOr` de
 * l'étape 1 : un document émis ne va rien chercher ailleurs pour s'afficher. Les FK (`clientId`,
 * `vehiculeId`) restent pour la navigation, jamais pour le rendu.
 */
export interface ValeursFigeesDocument {
  readonly clientDesignation: string;
  readonly clientIde: string | null;
  readonly clientLangue: string;
  readonly adresseFacturation: AdresseStructureeQr | null;
  /** Conditions de paiement au moment de l'émission (délai, escompte le cas échéant — `PF-04`).
   *  Absentes pour un rôle sans droit aux montants. */
  readonly conditionsPaiement?: Readonly<Record<string, unknown>> | null;
  readonly plaque: string | null;
}

/* ------------------------------------------------------------------ */
/* Ventilation TVA (MD-44, MD-45)                                      */
/* ------------------------------------------------------------------ */

/** Une ligne par couple `(regimeTva, tauxTvaPourmille)` présent sur le document — figée à
 *  l'émission comme le reste, alimente le récapitulatif TVA du PDF, l'information Swico du QR
 *  (§5.3) et l'export fiduciaire. `baseCentimes = Σ montantHtCentimes` des lignes du couple ;
 *  `tvaCentimes = Σ montantTvaCentimes` — jamais recalculée sur la base agrégée (`MD-44`). */
export interface DocumentVenteTva {
  readonly regimeTva: RegimeTva;
  readonly tauxTvaPourmille: number;
  readonly baseCentimes: number;
  readonly tvaCentimes: number;
}

/* ------------------------------------------------------------------ */
/* Ressource                                                           */
/* ------------------------------------------------------------------ */

export interface ReponseDocumentVente {
  readonly id: string;
  readonly typeDocument: TypeDocumentVente;
  /** `null` sauf `typeDocument = 'facture'` (`MD-12`). */
  readonly natureFacture: NatureFacture | null;
  readonly origine: OrigineDocument;
  /** Numéro AFFICHÉ, `null` tant que le document est en `brouillon` (`MD-03`, `MD-19`). */
  readonly numero: string | null;
  /** Rang dans la séquence DFA — porte la continuité légale (`RF-20`). `null` sur un document
   *  `origine = 'reprise'` (`MD-03`) ou en `brouillon`. */
  readonly numeroSequence: number | null;
  /** Numéro source verbatim (`MD-04`) — `null` sauf `origine = 'reprise'`. */
  readonly numeroOrigine: string | null;
  /** Exercice comptable de `dateDocument` (`MD-27`) — distinct de l'`annee` du compteur. */
  readonly exercice: number | null;
  readonly statut: StatutDocumentVente;
  /** Colonne DÉRIVÉE (`MD-16`), orthogonale à `statut` — voir la note de conception sur
   *  `StatutReglementDocument` dans `enums.ts`. `null` pour un `devis` ou un `bon_commande` : le
   *  règlement ne concerne que `facture` et `avoir`. Absent pour un rôle sans droit aux montants. */
  readonly statutReglement?: StatutReglementDocument | null;
  readonly siteId: string;
  readonly clientId: string;
  readonly vehiculeId: string | null;
  /** `AC-06`, `MD-65` : présent dès qu'une facture provient de l'action serveur de facturation
   *  d'un OR. `null` pour une vente comptoir sans OR. */
  readonly ordreReparationId: string | null;
  /** `MD-70`/RV-37 : accroche à un dossier de vente (étape 4, VN/VO), posée à la création d'un
   *  `bon_commande` ou d'une `facture` (voir `dossierVenteId` de `schemaCreationDocumentVente`
   *  ci-dessous). `null` pour un document sans lien à une vente de véhicule. */
  readonly dossierVenteId: string | null;
  /** `devis → bon_commande → facture` (`MD-14`). `null` pour un document créé directement. */
  readonly documentSourceId: string | null;
  /** Obligatoire et UNIQUEMENT si `typeDocument = 'avoir'` (`MD-14`). */
  readonly factureAnnuleeId: string | null;
  /** Pointeur inverse — présent sur une `facture` dont `statut = 'annule_par_avoir'` (`RF-32`,
   *  liste blanche `MD-20`). */
  readonly annuleParAvoirId: string | null;
  /** `devis` v1 ← `devis` v2 (`MD-14`). */
  readonly remplaceId: string | null;
  /** Issue #156 : posé UNIQUEMENT sur une facture de REMPLACEMENT (`ServiceCorrectionFacture.corriger`)
   *  — pointe vers la facture ORIGINALE qu'elle corrige. `null` sur tout document qui ne provient pas
   *  d'une correction. Distinct de `documentSourceId` (MD-14, chaîne devis→bon_commande→facture) et
   *  de `remplaceId` (RF-8, réservé aux devis) — voir migration `0063_report_reglement_correction.sql`
   *  §2 pour le raisonnement complet. */
  readonly factureCorrigeeId?: string | null;
  readonly figees: ValeursFigeesDocument;
  /**
   * Date MÉTIER/LÉGALE du document (`MD-27`/`MD-33`), jamais un horodatage serveur — à distinguer
   * de `emisLe` ci-dessous. Éditable tant que le document est `brouillon` (défaut = date du jour
   * côté serveur à la création, `schemaCreationDocumentVente.dateDocument`) ; contrôlée ≥ à la date
   * du dernier document émis de la même série UNIQUEMENT à l'ÉMISSION (`MD-33`), jamais à la saisie
   * du brouillon. C'est la date qui apparaît sur le document imprimé/PDF et qui sert de base à la
   * numérotation par exercice (`exercice` ci-dessus). Peut donc précéder `emisLe` de plusieurs
   * semaines (ex. une facture émise le 03.08 pour une prestation datée du 05.07) — les deux champs
   * ne sont PAS interchangeables et ne doivent pas partager le même libellé côté écran.
   */
  readonly dateDocument: string;
  readonly devise: DeviseFacturation;
  /** `MD-07` : `true` uniquement sur un document repris dont la source ne donnait qu'un montant de
   *  TVA global — `ventilationTva` est alors vide et `tauxTvaPourmilleDocument` porte le taux
   *  d'époque déduit de la date d'émission (`MD-09`). Toujours `false` sur un document `dfa`. */
  readonly tvaNonVentilee: boolean;
  /** `MD-09` : réservé aux documents repris à TVA non ventilée. `null` sur un document `dfa`. */
  readonly tauxTvaPourmilleDocument: number | null;
  /** `MD-69` : à `true`, aucun taux ni montant de TVA n'est imprimé (imposition de la marge,
   *  documents repris antérieurs au 01.01.2018 — `MD-68`). */
  readonly mentionTvaInterdite: boolean;
  /**
   * Échéance de paiement (`RF-04`/`PF-04`, `MD-94`) — FIGÉE à l'émission (`service-emission.ts`),
   * jamais recalculée ensuite (verrouillage `MD-20`, comme `numero`/`totalTtcCentimes`). `null` :
   *  - sur `devis`/`bon_commande`/`avoir` (aucune échéance de paiement ne les concerne — un devis
   *    n'est jamais dû, un avoir crédite le client au lieu de se faire payer) ;
   *  - sur une `facture` en `brouillon` (rien n'est figé avant émission, `MD-19`) ;
   *  - sur une `facture` ÉMISE dont le client n'avait AUCUN délai de paiement structuré en vigueur
   *    au moment de la création du document (`figees.conditionsPaiement.delaiPaiementJours` absent
   *    ou non numérique) — DFA ne fabrique jamais une échéance plausible à partir d'un délai par
   *    défaut codé en dur (aucun paramètre tenant `PF-04` n'existe à ce jour, voir `echeance.ts`).
   * Absent pour un rôle sans droit aux montants (`RF-114` → `RF-116`) — même masquage que le reste
   * de ce bloc, l'échéance étant une donnée financière au même titre qu'un montant.
   */
  readonly dateEcheance?: string | null;
  /**
   * Dérivés de `dateEcheance`/`soldeCentimes` à l'INSTANT de la réponse, jamais stockés : `true`
   * ⟺ `dateEcheance` non nulle, strictement dépassée, et `soldeCentimes > 0` (créance encore due,
   * `RF-67`). Un document non modifié peut légitimement basculer `enRetard: true` d'une lecture à
   * l'autre, sans qu'aucune colonne n'ait bougé — ce n'est PAS un bug de cache. `joursRetard` est
   * un entier strictement positif quand `enRetard`, sinon toujours `null` (jamais `0`). Absents
   * pour un rôle sans droit aux montants, même masquage que `dateEcheance` dont ils dérivent.
   */
  readonly enRetard?: boolean;
  readonly joursRetard?: number | null;
  /** Absents pour un rôle sans droit aux montants (`RF-114` → `RF-116`). */
  readonly totalHtCentimes?: number;
  readonly totalTvaCentimes?: number;
  /** `MD-08` : écart entre la somme des lignes et le total stocké d'un document repris. Toujours
   *  `0` sur un document `dfa` (contrainte en base). */
  readonly ecartRepriseCentimes?: number;
  readonly totalTtcCentimes?: number;
  /** Vide si `tvaNonVentilee`. Absent pour un rôle sans droit aux montants. */
  readonly ventilationTva?: readonly DocumentVenteTva[];
  /** Exclusifs (`MD-41`, même règle que la ligne). Saisis une fois, ventilés sur les lignes
   *  (`remiseGlobaleRepartieCentimes` de chaque ligne, `MD-59`). */
  readonly remiseGlobaleSaisieCentimes: number | null;
  readonly remiseGlobalePourmille: number | null;
  /** Dérivés par trigger depuis `imputation_paiement` (`MD-53`). Absents pour un rôle sans droit
   *  aux montants. */
  readonly montantRegleCentimes?: number;
  /** Jamais négatif (`RF-67`) : le trop-perçu vit sur le paiement, pas sur le document. */
  readonly soldeCentimes?: number;
  readonly relanceNiveau: number;
  readonly relanceLe: string | null;
  /** Obligatoire et UNIQUEMENT si `typeDocument = 'avoir'` (`RF-15`). */
  readonly motifAvoir: MotifAvoir | null;
  /** Texte libre — présent uniquement quand `motifAvoir = 'autre'`. */
  readonly motifAvoirAutre: string | null;
  readonly porteeAvoir: PorteeAvoir | null;
  /** `null` avant émission, ou si `devise` n'est ni `CHF` ni `EUR` (`RF-58`). */
  readonly qr: BlocPaiementQrFige | null;
  readonly pdfCle: string | null;
  readonly pdfSha256: string | null;
  readonly exporteLe: string | null;
  readonly exportId: string | null;
  readonly contentieux: boolean;
  readonly lignes: readonly ReponseLigneDocumentVente[];
  readonly nombreLignes: number;
  /** Voir `SEUIL_LIGNES_EMBARQUEES_DOCUMENT`. */
  readonly lignesTronquees: boolean;
  /** Entier monotone, incrémenté en base tant que le document est `brouillon`. Rendu aussi en
   *  en-tête `ETag: W/"<version>"` — un document émis ne change plus jamais de version au sens
   *  métier (seules les colonnes de la liste blanche `MD-20` bougent). */
  readonly version: number;
  /**
   * Horodatage SERVEUR (`timestamptz`, précision seconde après sérialisation ISO) du geste
   * d'émission effectif — à distinguer de `dateDocument` ci-dessus, qui est la date métier/légale
   * portée par le document. `null` tant que le document est `brouillon` : `emisLe` est écrit une
   * seule fois, dans la même transaction que l'attribution du numéro (`service-emission.ts`), et ne
   * change plus jamais ensuite (même règle d'immuabilité que `numero`). Ne PAS afficher sous le même
   * libellé que `dateDocument` : les deux peuvent diverger de plusieurs semaines (voir le
   * commentaire de `dateDocument`).
   */
  readonly emisLe: string | null;
  readonly emisPar: { readonly utilisateurId: string; readonly nomAffiche: string } | null;
  readonly creeLe: string;
  readonly modifieLe: string;
  readonly modifiePar: { readonly utilisateurId: string; readonly nomAffiche: string } | null;
}

/** Projection minimale, embarquée dans les listes et la fiche client. PAS de `ClientResume`
 *  imbriqué (couplage évité, `figees.clientDesignation` suffit à l'affichage d'une liste — un
 *  document liste sa propre identité figée, pas celle vivante du client). */
export interface DocumentVenteResume {
  readonly id: string;
  readonly typeDocument: TypeDocumentVente;
  readonly natureFacture: NatureFacture | null;
  readonly numero: string | null;
  readonly statut: StatutDocumentVente;
  readonly statutReglement?: StatutReglementDocument | null;
  readonly clientId: string;
  readonly clientDesignation: string;
  readonly dateDocument: string;
  readonly devise: DeviseFacturation;
  readonly totalTtcCentimes?: number;
  readonly soldeCentimes?: number;
  /** Même champ, même masquage, même règle de calcul que `ReponseDocumentVente.dateEcheance` — le
   *  serveur rend en réalité `ReponseDocumentVente` complet sur `GET /documents-vente` (voir
   *  `document-vente.controller.ts::lister`), cette projection n'est qu'un TYPE plus étroit côté
   *  client ; l'ajouter ici suffit à le rendre lisible depuis la liste sans changer la route. */
  readonly dateEcheance?: string | null;
  readonly enRetard?: boolean;
  readonly joursRetard?: number | null;
}

/* ------------------------------------------------------------------ */
/* Filtres, tris (même mécanisme de pagination que le reste de l'API — */
/* voir `contrats/pagination.ts`, non réinventé ici)                   */
/* ------------------------------------------------------------------ */

export const TRIS_DOCUMENTS_VENTE = [
  'dateDocument:desc',
  'dateDocument:asc',
  'numeroSequence:desc',
  'numeroSequence:asc',
  'soldeCentimes:desc',
  'relanceLe:asc',
] as const;
export const TRI_DEFAUT_DOCUMENTS_VENTE = 'dateDocument:desc';

export const schemaFiltresDocumentsVente = z.object({
  siteId: schemaIdentifiant.optional(),
  typeDocument: schemaListeQuery(z.enum(TYPES_DOCUMENT_VENTE)).optional(),
  natureFacture: z.enum(NATURES_FACTURE).optional(),
  statut: schemaListeQuery(z.enum(STATUTS_DOCUMENT_VENTE)).optional(),
  statutReglement: schemaListeQuery(z.enum(STATUTS_REGLEMENT_DOCUMENT)).optional(),
  clientId: schemaIdentifiant.optional(),
  vehiculeId: schemaIdentifiant.optional(),
  ordreReparationId: schemaIdentifiant.optional(),
  /** Bornes INCLUSES, convention `xDu` / `xAu` de toute l'API. */
  dateDocumentDu: schemaDateJour.optional(),
  dateDocumentAu: schemaDateJour.optional(),
  /**
   * `true` ⟺ MÊME définition que `ReponseDocumentVente.enRetard` ci-dessus (`calculerRetardDocument`,
   * `facturation/documents/echeance.ts`, redit ici pour qu'un lecteur du contrat n'ait pas à sauter de
   * fichier) : une FACTURE `statut = 'emis'` dont `dateEcheance` est strictement dépassée ET dont
   * `soldeCentimes > 0`. Un `devis`/`bon_commande`/`avoir` n'a jamais `dateEcheance` renseignée, donc
   * n'est jamais retenu. Une facture `statut = 'annule_par_avoir'` n'est PAS retenue même si `dateEcheance`
   * (figée, jamais nettoyée à l'annulation) et `soldeCentimes` (jamais recrédité automatiquement par
   * l'annulation — RF-32 ne touche ni `statutReglement` ni `soldeCentimes`) restent, en base, ceux
   * d'avant l'annulation : même garde que `relances/regles-planification.ts::factureEligibleRelance`,
   * qui exige `statut === 'emis'` pour la même raison (« un dossier annulé ne doit pas rester
   * indéfiniment éligible pour un montant qui n'est plus dû »). `false`/absent : aucun filtre de
   * retard n'est appliqué (même convention que les autres booléens de filtre de cette API, voir
   * `nonImputeUniquement` de `facturation/paiement.ts` — seul `true` a un effet, `false` ne exclut
   * PAS les factures en retard).
   */
  enRetard: schemaBooleenQuery().optional(),
  /**
   * Filtre à ÉGALITÉ STRICTE sur `document_vente.relance_niveau` (colonne réelle, `smallint not null
   * default 0`, migration `0010_facturation.sql` — déjà exposée en lecture par
   * `ReponseDocumentVente.relanceNiveau`, incrémentée par `relances/service-relances-facture.ts` via
   * `greatest(relance_niveau, palier)` à CHAQUE envoi réussi). `relanceNiveau: 0` sélectionne les
   * documents jamais relancés (y compris hors de tout retard) ; une valeur `> 0` sélectionne ceux
   * ayant atteint EXACTEMENT ce palier.
   *
   * AMBIGUÏTÉ SIGNALÉE (non tranchée ici, hors périmètre de ce lot) : l'onglet écran « À relancer »
   * n'est pas forcément une égalité stricte sur un palier — il pourrait vouloir « en retard ET
   * `relanceNiveau` en dessous du plafond configuré par le tenant » (`regle_relance.delaisJours`,
   * variable par tenant, non lisible depuis un schéma de filtre). Ce champ expose la seule primitive
   * qui repose sur une colonne réelle (`relance_niveau`) ; composer `enRetard=true&relanceNiveau=0`
   * couvre déjà le cas usuel « en retard, jamais relancée » mais PAS « en retard, relancée une fois,
   * palier suivant pas encore atteint » — à trancher côté l'équipe métier/l'équipe API avant de câbler
   * l'onglet, plutôt que d'inventer ici une sémantique de seuil.
   */
  relanceNiveau: z.coerce.number().int().min(0).optional(),
  /** Porte sur le numéro affiché et la désignation client figée. */
  q: z.string().trim().min(1).max(120).optional(),
  tri: z.enum(TRIS_DOCUMENTS_VENTE).default(TRI_DEFAUT_DOCUMENTS_VENTE),
});
export type FiltresDocumentsVente = z.infer<typeof schemaFiltresDocumentsVente>;

/* ------------------------------------------------------------------ */
/* Entrées d'écriture — création de brouillon                         */
/* ------------------------------------------------------------------ */

/**
 * `POST /documents-vente` — `Idempotency-Key` OBLIGATOIRE (en-tête `EN_TETE_IDEMPOTENCE`,
 * `atelier/avertissement.ts` — mécanisme réutilisé tel quel, pas de second champ `idempotencyKey`
 * dans le corps). Un brouillon ne consomme aucun numéro (`RF-9`), mais la création reste
 * idempotente pour le même geste comptoir que `POST /ordres-reparation` : un double-clic au
 * comptoir ne doit jamais produire deux brouillons.
 *
 * UNIQUEMENT pour `devis`, `bon_commande` et `facture` créés directement (vente comptoir sans OR,
 * ou chaîne commerciale devis → bon de commande → facture). Une facture issue d'un OR est produite
 * par `POST /ordres-reparation/{id}/facturer` (`RF-81`), qui ne prend AUCUNE ligne en entrée —
 * elle recopie. Un `avoir` a son propre schéma (`schemaCreationAvoir`) : son contenu dérive
 * toujours d'une facture existante, jamais d'une saisie libre.
 */
export const schemaCreationDocumentVente = z
  .object({
    typeDocument: z.enum(['devis', 'bon_commande', 'facture']),
    /** Uniquement si `typeDocument = 'facture'` (`MD-12`). */
    natureFacture: z.enum(NATURES_FACTURE).optional(),
    siteId: schemaIdentifiant,
    clientId: schemaIdentifiant,
    vehiculeId: schemaIdentifiant.nullish(),
    /** `document_vente.dossier_vente_id` (migration `0032_ventes.sql` §8, MD-70) : accroche à un
     *  dossier de vente VN/VO (étape 4, RV-37). Uniquement pour `bon_commande` (rattaché à
     *  l'engagement du dossier, `POST /dossiers-vente/{id}/engager`) et `facture` (l'émission
     *  marque le véhicule du dossier `vendu`, effet de bord programmatique côté serveur) — un
     *  `devis` ou un `avoir` n'a jamais de raison de porter cette accroche. Le dossier doit
     *  appartenir au même tenant et être dans un état qui accepte un rattachement (contrôlé
     *  côté serveur, `DOCUMENT_DOSSIER_VENTE_RATTACHEMENT_REFUSE`) — non vérifiable ici, un
     *  schéma zod n'a pas accès à la base. */
    dossierVenteId: schemaIdentifiant.nullish(),
    /** `devis → bon_commande → facture` (`MD-14`, `RF-8`) : un document source ne peut être
     *  transformé qu'une fois — contrôlé côté serveur (`DOCUMENT_SOURCE_DEJA_TRANSFORME`). */
    documentSourceId: schemaIdentifiant.nullish(),
    /** Défaut = date du jour côté serveur. Doit être ≥ à la date du dernier document émis de la
     *  même série (`MD-33`) — contrôlé à l'ÉMISSION, pas à la création du brouillon. */
    dateDocument: schemaDateJour.optional(),
    devise: schemaDeviseFacturation,
    remiseGlobaleSaisieCentimes: schemaCentimesTtc.optional(),
    remiseGlobalePourmille: schemaPourmille.optional(),
    lignes: z.array(schemaCreationLigneDocument).max(200).default([]),
  })
  .extend(schemaConfirmations.shape)
  .strict()
  .refine((v) => !(v.remiseGlobaleSaisieCentimes != null && v.remiseGlobalePourmille != null), {
    message: 'Remise globale en montant et en pour mille sont exclusives (MD-41).',
    path: ['remiseGlobalePourmille'],
  })
  .refine((v) => v.typeDocument === 'facture' || v.natureFacture == null, {
    message: "`natureFacture` n'existe que pour `typeDocument = 'facture'` (MD-12).",
    path: ['natureFacture'],
  })
  .refine(
    (v) =>
      v.dossierVenteId == null || v.typeDocument === 'bon_commande' || v.typeDocument === 'facture',
    {
      message: "`dossierVenteId` n'est accepté que pour un bon de commande ou une facture (RV-37).",
      path: ['dossierVenteId'],
    },
  );

export type EntreeCreationDocumentVente = z.infer<typeof schemaCreationDocumentVente>;

/** `PATCH /documents-vente/{id}` — uniquement sur un `brouillon` (`MD-19`, `RF-9`). `statut` reste
 *  en lecture seule, comme partout dans cette API. */
export const schemaModificationDocumentVente = z
  .object({
    clientId: schemaIdentifiant.optional(),
    vehiculeId: schemaIdentifiant.nullish(),
    dateDocument: schemaDateJour.optional(),
    remiseGlobaleSaisieCentimes: schemaCentimesTtc.nullish(),
    remiseGlobalePourmille: schemaPourmille.nullish(),
  })
  .strict()
  .refine((v) => !(v.remiseGlobaleSaisieCentimes != null && v.remiseGlobalePourmille != null), {
    message: 'Remise globale en montant et en pour mille sont exclusives (MD-41).',
    path: ['remiseGlobalePourmille'],
  });
export type EntreeModificationDocumentVente = z.infer<typeof schemaModificationDocumentVente>;

/* ------------------------------------------------------------------ */
/* Entrées d'écriture — transitions (actions nommées, §7.7 étendu)     */
/* ------------------------------------------------------------------ */

/**
 * `POST /documents-vente/{id}/emettre` — `Idempotency-Key` OBLIGATOIRE (`RF-25`) : rejouer la même
 * requête avec la même clé rend le MÊME document, avec le MÊME numéro. C'est le point de
 * non-retour (`MD-18`) : aucun endpoint, aucun droit, aucun rôle ne permet de revenir en arrière
 * (`RF-10`).
 */
export const schemaEmissionDocumentVente = z.object({}).extend(schemaConfirmations.shape).strict();
export type EntreeEmissionDocumentVente = z.infer<typeof schemaEmissionDocumentVente>;

/** `POST /documents-vente/{id}/accepter` — devis uniquement. */
export const schemaAccepterDevis = z.object({}).extend(schemaConfirmations.shape).strict();
/** `POST /documents-vente/{id}/annuler-accord` — devis uniquement ; aucun champ. */
export const schemaAnnulerAccordDevis = z.object({}).strict();
/** `POST /documents-vente/{id}/refuser` — devis ou bon de commande. */
export const schemaRefuserDocument = z.object({ motif: schemaTexteLong.optional() }).strict();
/** `POST /documents-vente/{id}/annuler` — bon de commande uniquement ; motif OBLIGATOIRE, même
 *  raison que `schemaActionAnnuler` de l'étape 1 : une annulation sans motif détruit la traçabilité. */
export const schemaAnnulerDocument = z.object({ motif: schemaTexteLong }).strict();

export type EntreeAccepterDevis = z.infer<typeof schemaAccepterDevis>;
export type EntreeAnnulerAccordDevis = z.infer<typeof schemaAnnulerAccordDevis>;
export type EntreeRefuserDocument = z.infer<typeof schemaRefuserDocument>;
export type EntreeAnnulerDocument = z.infer<typeof schemaAnnulerDocument>;

/* ------------------------------------------------------------------ */
/* Entrées d'écriture — avoir (RF-11 → RF-19)                          */
/* ------------------------------------------------------------------ */

/**
 * `POST /documents-vente/{factureId}/avoirs` — `Idempotency-Key` OBLIGATOIRE. Crée un `avoir` en
 * BROUILLON (`RF-9`) : il est émis séparément via `schemaEmissionDocumentVente`, comme tout
 * document.
 *
 * Un avoir ne reçoit JAMAIS de prix : `montantTtcCentimes` par ligne sélectionne combien de la
 * ligne d'origine est crédité, mais le TAUX, le RÉGIME et le MODE DE CALCUL sont hérités de la
 * facture (`MD-23`) — jamais saisis, jamais recalculés au taux courant (`CF-09`).
 */
export const schemaCreationAvoir = z
  .object({
    portee: z.enum(PORTEES_AVOIR),
    motif: z.enum(MOTIFS_AVOIR),
    /** Obligatoire et non vide UNIQUEMENT si `motif = 'autre'` (`RF-15`). */
    motifAutre: schemaTexteLong.optional(),
    /**
     * Vide et IGNORÉ si `portee = 'total'` (l'avoir reprend alors toutes les lignes facturables de
     * la facture). Obligatoire, au moins une entrée, si `portee = 'partiel'` (`RF-18`) : un avoir
     * partiel reprend des lignes EXISTANTES, il n'invente jamais un montant (`RF-18`).
     */
    lignes: z
      .array(
        z
          .object({
            ligneDocumentId: schemaIdentifiant,
            /** TTC, positif — plafonné côté serveur au solde restant de la ligne d'origine
             *  (`MD-23` : Σ avoirs ≤ facture, par taux). */
            montantTtcCentimes: schemaCentimesTtcPositif,
          })
          .strict(),
      )
      .max(200)
      .default([]),
  })
  .extend(schemaConfirmations.shape)
  .strict()
  .refine((v) => v.motif !== 'autre' || Boolean(v.motifAutre?.trim()), {
    message: "Un motif 'autre' exige un texte libre (RF-15).",
    path: ['motifAutre'],
  })
  .refine((v) => v.portee !== 'partiel' || v.lignes.length > 0, {
    message: 'Un avoir partiel exige au moins une ligne (RF-18).',
    path: ['lignes'],
  })
  .refine((v) => v.portee !== 'total' || v.lignes.length === 0, {
    message: 'Un avoir total ne prend aucune ligne en entrée — il reprend tout (MD-23).',
    path: ['lignes'],
  });

export type EntreeCreationAvoir = z.infer<typeof schemaCreationAvoir>;

/**
 * `POST /documents-vente/{factureId}/corriger` — LE GESTE UNIQUE de `RF-12` → `RF-14`. Exécute en
 * UNE SEULE TRANSACTION : un avoir total référençant la facture, une nouvelle facture reprenant
 * toutes les lignes avec les champs corrigés, le lettrage automatique de l'avoir sur la facture
 * annulée, et — si `corrigerFicheClient` — la mise à jour de la fiche client. `Idempotency-Key`
 * OBLIGATOIRE : c'est une création de facture, donc une création sensible.
 *
 * **Ce n'est pas une exception au modèle** (`RF-12`) : le serveur produit trois documents
 * immuables, exactement comme un avoir puis une facture créés séparément. C'est une commodité
 * d'écran, exposée comme telle par un endpoint dédié plutôt que comme un cas spécial de `PATCH`.
 */
export const MODES_CORRECTION_FACTURE = ['remplacement', 'brouillon'] as const;
export type ModeCorrectionFacture = (typeof MODES_CORRECTION_FACTURE)[number];

export const schemaCorrectionFacture = z
  .object({
    /** `remplacement` (défaut, comportement historique) : avoir total + facture de remplacement
     *  ÉMISE, en-tête corrigé via `champsCorriges` (obligatoire dans ce mode).
     *  `brouillon` : avoir total émis + NOUVEAU BROUILLON de facture (mêmes lignes, recalculées au
     *  régime TVA ACTUEL du garage), laissé modifiable puis émis par l'utilisateur. Dans ce mode
     *  `champsCorriges` et `corrigerFicheClient` n'ont pas de sens : le brouillon se corrige
     *  ensuite par les routes ordinaires de modification d'un brouillon. */
    mode: z.enum(MODES_CORRECTION_FACTURE).default('remplacement'),
    motif: z.enum(MOTIFS_AVOIR),
    motifAutre: schemaTexteLong.optional(),
    /** Coché par défaut (`RF-14`) : sans correction de la fiche, l'erreur revient à la facture
     *  suivante. Reste décochable — corriger le document et corriger la donnée sont deux actions
     *  distinctes, et la seconde n'est pas toujours souhaitée (ex. le client donne une adresse
     *  de facturation ponctuelle, différente de sa fiche). Ignoré en mode `brouillon`. */
    corrigerFicheClient: z.boolean().default(true),
    /** Overlay PARTIEL des valeurs figées : seuls les champs fournis sont corrigés sur la
     *  nouvelle facture (et, si `corrigerFicheClient`, reportés sur la fiche). Les champs omis
     *  sont recopiés tels quels depuis la facture d'origine. OBLIGATOIRE en mode `remplacement`,
     *  INTERDIT en mode `brouillon`. */
    champsCorriges: z
      .object({
        clientDesignation: schemaTexteCourt.optional(),
        adresseFacturation: formeAdresseStructureeQr.optional(),
      })
      .strict()
      .refine((v) => Object.keys(v).length > 0, {
        message: 'Au moins un champ à corriger est requis.',
      })
      .optional(),
  })
  .extend(schemaConfirmations.shape)
  .strict()
  .refine((v) => v.motif !== 'autre' || Boolean(v.motifAutre?.trim()), {
    message: "Un motif 'autre' exige un texte libre (RF-15).",
    path: ['motifAutre'],
  })
  .refine((v) => v.mode !== 'remplacement' || v.champsCorriges !== undefined, {
    message: 'Au moins un champ à corriger est requis.',
    path: ['champsCorriges'],
  })
  .refine((v) => v.mode !== 'brouillon' || v.champsCorriges === undefined, {
    message: "Le mode 'brouillon' ne prend aucun champ corrigé : le brouillon se modifie ensuite.",
    path: ['champsCorriges'],
  });

export type EntreeCorrectionFacture = z.infer<typeof schemaCorrectionFacture>;

/** Réponse de `POST /documents-vente/{factureId}/corriger` — les trois numéros consommés
 *  (`RF-13`) sont ceux de `avoir.numero` et `factureRemplacement.numero` ; la facture d'origine,
 *  inchangée sauf pour les colonnes de la liste blanche (`MD-20`), n'est pas renvoyée ici — un
 *  `GET /documents-vente/{factureId}` séparé la montre `statut = 'annule_par_avoir'`. */
export interface ReponseCorrectionFacture {
  readonly mode: ModeCorrectionFacture;
  readonly avoir: ReponseDocumentVente;
  /** Mode `remplacement` : facture émise. Mode `brouillon` : document `statut = 'brouillon'`
   *  (sans numéro), dont `id` est celui à ouvrir pour le modifier puis l'émettre ; relié à
   *  l'originale par `factureCorrigeeId` (côté base). */
  readonly factureRemplacement: ReponseDocumentVente;
}
