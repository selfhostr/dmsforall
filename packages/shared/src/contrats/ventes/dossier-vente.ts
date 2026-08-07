import { z } from 'zod';

import type { ClientResume } from '../atelier/client';
import { UNITES_DISTANCE } from '../atelier/enums';
import {
  schemaDateJour,
  schemaIdentifiant,
  schemaKilometrage,
  schemaMotif,
  schemaTexteCourt,
} from '../atelier/primitives';
import { schemaConfirmations } from '../atelier/avertissement';
import type { DocumentVenteResume } from '../facturation/document';
import { schemaListeQuery } from '../filtres';
import { schemaParametresPage } from '../pagination';
import {
  STATUTS_DOSSIER_VENTE,
  type ActionDossierVente,
  type StatutDossierVente,
  type TypeVehiculeVente,
} from './enums';
import type { FinancementResume } from './financement';
import type { RepriseResume } from './reprise';
import type { VehiculeStockResume } from './vehicule-stock';

/**
 * Le dossier de vente (`RV-29` → `RV-38`, livraison `RV-52` → `RV-58`) — l'objet CENTRAL de ce
 * module (§8.2 de la spécification), exposé sous `/dossiers-vente`.
 *
 * RÈGLE STRUCTURANTE (§8.2, littéral) : « aucune duplication du montant, de la TVA ou du statut de
 * paiement ici ». Ce type ne porte donc AUCUN champ `…Centimes` de prix de vente, d'acompte ou de
 * solde — ces montants vivent exclusivement sur les documents de la chaîne facturation
 * (`contrats/facturation/document.ts`, déjà livrée), reliés par `dossierVenteId` (`MD-70`, posé dès
 * l'étape 2). `documents` ci-dessous les EMBARQUE en lecture (projection déjà légère,
 * `DocumentVenteResume`, pas une resaisie) pour éviter un aller-retour à chaque ouverture d'écran —
 * ce n'est pas une exception à la règle : c'est un accès en lecture à la même source de vérité, pas
 * une copie stockée séparément.
 *
 * GAP CROISÉ SIGNALÉ (hors périmètre d'écriture de ce fichier — `contrats/facturation/document.ts`) :
 * `schemaFiltresDocumentsVente` n'a PAS de filtre `dossierVenteId`, alors que la colonne existe sur
 * la ressource depuis l'étape 2. Sans lui, un client tiers qui voudrait lister les documents d'un
 * dossier sans passer par l'embarquement ci-dessous (dossier à beaucoup de documents,
 * `documentsTronques = true`) n'a AUCUN moyen de le faire. À ajouter par le propriétaire de ce
 * fichier.
 *
 * MACHINE À ÉTATS — **GELÉE** (`enums.ts::STATUTS_DOSSIER_VENTE`, diagramme §6.2) :
 *
 * ```
 *  prospection ──► engage ──► en_preparation ──► pret_a_livrer ──► livre ──► clos
 *       │              │             │                  │
 *       └──────────────┴─────────────┴──────────────────┴──► annule / abandonne
 * ```
 *
 * Transitions gardées côté serveur (table, pas ce type) — un client lit `actionsDisponibles`.
 * `annule`/`abandonne` sont accessibles depuis `prospection`, `engage` ou `en_preparation`, JAMAIS
 * depuis `pret_a_livrer` ou au-delà : `RV-38` verrouille toute correction de prix derrière l'avoir
 * dès la facture émise, et une facture émise implique au minimum `en_preparation` franchi. Un OR de
 * ce point n'est pas expressément numéroté par `RV-xx` — cohérent par construction avec `RV-37`
 * (facture non émise avant `pret_a_livrer`), documenté ici faute d'un `RV` dédié.
 *
 * OBSERVATION SIGNALÉE (diagramme §6.1 de la spécification, pas ce fichier) : un VN commandé
 * SPÉCIFIQUEMENT pour ce dossier (jamais `disponible` pour un autre client) devrait plausiblement
 * pouvoir passer directement `en_commande -> reserve` à la signature du bon de commande, sans
 * transiter par `disponible` — le diagramme `RV-09` ne dessine que la chaîne linéaire. Ni `CV-01`
 * à `CV-10` ni les `RV` ne tranchent ce cas ; ce fichier suppose que le véhicule associé à
 * `engager` peut être `en_commande` OU `disponible`, sans trancher l'ordre exact, et signale le
 * trou de diagramme plutôt que d'inventer une règle.
 */

/**
 * Cocher/décocher un document de la check-list de livraison (`RV-35`) — REPRÉSENTATION
 * DÉLIBÉRÉMENT GÉNÉRIQUE : le contenu EXACT de la check-list est `[À VALIDER, QV-07/PV-03]`,
 * paramétrable par tenant. `code` n'est PAS un enum fermé ici — un enum figerait une liste que la
 * spécification affirme elle-même varier d'un garage à l'autre. La provenance des codes
 * (paramétrage tenant) est hors périmètre de ce fichier (module `parametrage/`, pas encore écrit
 * pour ce domaine — à faire par son propriétaire).
 */
export interface DocumentRequisDossierVente {
  readonly code: string;
  readonly libelle: string;
  readonly fourni: boolean;
  readonly fourniLe: string | null;
}

/**
 * `GET /dossiers-vente/{id}` — le document complet, même doctrine que `ReponseOrdreReparation`
 * (D-10) : un dossier de vente EST un document métier, le retourner entier respecte sa frontière
 * naturelle — reprise, financement et documents en font partie au sens métier, pas un agrégat
 * d'écran assemblé après coup.
 */
export interface ReponseDossierVente {
  readonly id: string;
  readonly siteId: string;
  readonly statut: StatutDossierVente;
  /** DÉRIVÉ, jamais saisi (§8.2) — `null` tant qu'aucun véhicule n'est associé (`RV-30`). Même
   *  inférence que `vehicule-stock.ts::TYPES_VEHICULE_VENTE`, lue depuis le véhicule associé. */
  readonly typeVehicule: TypeVehiculeVente | null;
  /** `null` tant que non associé (`RV-30` : un dossier de vente peut exister avant qu'un véhicule
   *  précis ne lui soit assigné — VN pas encore configuré, client encore en réflexion sur le
   *  modèle). Devient non-modifiable en pratique après `engager` (`RV-32` verrouille le véhicule à
   *  `reserve`) — contrôlé serveur, pas ici. */
  readonly vehicule: VehiculeStockResume | null;
  readonly clientAcheteur: ClientResume;
  /** `RV-40` : destinataire réel de la facture — l'organisme de financement pour un leasing, sinon
   *  TOUJOURS résolu, jamais `null` (défaut serveur = `clientAcheteur` si non précisé à la
   *  création, même doctrine que `TotauxPayeurOr.destinataire` qui ne laisse jamais un groupe
   *  facturé sans destinataire résolu). */
  readonly clientFacture: ClientResume;
  /** `RV-36` : conducteur attitré, distinct de l'acheteur pour un véhicule de fonction. `null` =
   *  le conducteur est l'acheteur (cas normal, immense majorité des dossiers). */
  readonly clientConducteur: ClientResume | null;
  /**
   * `null` = pas de reprise sur ce dossier, POUR UN RÔLE AUTORISÉ (`RV-25`, composante optionnelle).
   * Fiche complète via `GET /dossiers-vente/{id}/reprise`, même patron que `vehicule-stock.ts`.
   *
   * CHAMP ABSENT (clé manquante de la charge utile, PAS `null`) = le rôle appelant n'a pas
   * `ventes.reprise.lire` — omission de l'ENTITÉ ENTIÈRE, pas seulement de ses montants (FAILLE
   * CORRIGÉE, audit sécurité) : `GET /dossiers-vente/{id}` ne vérifiait QUE `ventes.dossier.lire` et
   * exposait TOUJOURS `valeurNegocieeCentimes`/`detteFinancementResiduelleCentimes`/`motifRefus`,
   * quel que soit le rôle — un `chef_atelier` (qui détient `ventes.dossier.lire` mais explicitement
   * PAS `ventes.reprise.lire`, voir `auth/matrice-droits.ts::DROITS_VENTES_PAR_ROLE.chef_atelier`)
   * recevait ces montants dans le corps JSON, simplement non affichés côté écran. `null` et absence
   * NE DOIVENT JAMAIS être confondus côté client : `null` est un FAIT métier (« pas de reprise »),
   * l'absence est un MASQUAGE (« vous n'avez pas le droit de savoir s'il y en a une »).
   */
  readonly reprise?: RepriseResume | null;
  /**
   * Le financement COURANT — voir `financement.ts::FinancementResume`. `null` UNIQUEMENT en
   * `prospection` avant toute proposition de financement, POUR UN RÔLE AUTORISÉ ; dès `engage`,
   * `RV-32`/`RV-33` supposent un mode de paiement choisi (même `comptant`, qui crée un financement
   * `confirme` d'emblée).
   *
   * CHAMP ABSENT (PAS `null`) = le rôle appelant n'a pas `ventes.financement.lire` — même doctrine
   * d'omission complète que `reprise` ci-dessus (FAILLE CORRIGÉE, audit sécurité, même défaut :
   * `montantFinanceCentimes`/`tauxInteretPourmille` exposés à un `chef_atelier` sans
   * `ventes.financement.lire`). Distinct de l'omission `RF-116` déjà posée sur les cinq champs
   * monétaires internes de `FinancementResume` (`roleVoitLesMontants`) : les deux gates sont
   * COMPLÉMENTAIRES, la seconde ne dispense jamais de la première.
   */
  readonly financement?: FinancementResume | null;
  /** Historique COMPLET des tentatives de financement (`CV-03`) — voir la note de doctrine dans
   *  `financement.ts` sur l'absence de pagination par curseur ici. ABSENT (même doctrine que
   *  `financement` ci-dessus) si le rôle appelant n'a pas `ventes.financement.lire`. */
  readonly financements?: readonly FinancementResume[];
  /** ABSENT dans les mêmes conditions que `financements` — un indicateur de troncature sur une
   *  collection elle-même masquée n'a aucun sens à exposer. */
  readonly financementsTronques?: boolean;
  /** Documents de la chaîne facturation liés à ce dossier (`dossierVenteId`, `MD-70`) — voir GAP
   *  CROISÉ SIGNALÉ en tête de fichier pour l'alternative paginée. */
  readonly documents: readonly DocumentVenteResume[];
  readonly documentsTronques: boolean;
  readonly documentsRequis: readonly DocumentRequisDossierVente[];
  /** `RV-34` : la signature du bon de commande n'est valable qu'accompagnée d'une identité
   *  vérifiée. Texte LIBRE plutôt qu'un enum fermé (type de pièce présentée) : la spécification ne
   *  fixe pas la liste exacte des pièces acceptées, question de conformité qui appartient au
   *  terrain/juridique, pas à ce contrat. `null` tant que non vérifiée. */
  readonly identitePieceType: string | null;
  readonly identiteVerifieeLe: string | null;
  readonly dateLivraisonEstimee: string | null;
  readonly dateLivraisonEffective: string | null;
  /** `RV-55` : 0 pour un VN, kilométrage réel constaté pour une VO — renseigné par
   *  `schemaActionLivrer`, jamais saisi avant. */
  readonly kilometrageDepart: number | null;
  readonly prospectionLe: string;
  readonly engageLe: string | null;
  readonly enPreparationLe: string | null;
  readonly pretALivrerLe: string | null;
  readonly livreLe: string | null;
  readonly closLe: string | null;
  readonly annuleLe: string | null;
  readonly abandonneLe: string | null;
  /** Obligatoire et renseigné UNIQUEMENT si `statut ∈ {annule, abandonne}`. */
  readonly motifCloture: string | null;
  readonly actionsDisponibles: readonly ActionDossierVente[];
  readonly version: number;
  readonly creeLe: string;
  readonly modifieLe: string;
  readonly modifiePar: { readonly utilisateurId: string; readonly nomAffiche: string } | null;
}

/** Projection minimale, embarquée dans les listes et la fiche client/véhicule. */
export interface DossierVenteResume {
  readonly id: string;
  readonly statut: StatutDossierVente;
  readonly typeVehicule: TypeVehiculeVente | null;
  readonly vehicule: VehiculeStockResume | null;
  readonly clientAcheteur: ClientResume;
  readonly dateLivraisonEstimee: string | null;
  readonly prospectionLe: string;
}

export const SEUIL_DOCUMENTS_EMBARQUES_DOSSIER_VENTE = 50;

/* ------------------------------------------------------------------ */
/* Lecture — collection (recherche / liste paginée par curseur)        */
/* ------------------------------------------------------------------ */

export const TRIS_DOSSIERS_VENTE = [
  'prospectionLe:desc',
  'prospectionLe:asc',
  'dateLivraisonEstimee:asc',
  'dateLivraisonEstimee:desc',
] as const;
export const TRI_DEFAUT_DOSSIERS_VENTE = 'prospectionLe:desc';

export const schemaFiltresDossiersVente = schemaParametresPage.extend({
  siteId: schemaIdentifiant.optional(),
  statut: schemaListeQuery(z.enum(STATUTS_DOSSIER_VENTE)).optional(),
  clientAcheteurId: schemaIdentifiant.optional(),
  vehiculeId: schemaIdentifiant.optional(),
  /** Porte sur le nom du client acheteur et la plaque/désignation du véhicule associé. */
  q: z.string().trim().min(1).max(120).optional(),
  tri: z.enum(TRIS_DOSSIERS_VENTE).default(TRI_DEFAUT_DOSSIERS_VENTE),
});
export type FiltresDossiersVente = z.infer<typeof schemaFiltresDossiersVente>;

/* ------------------------------------------------------------------ */
/* Entrées d'écriture — ressource                                      */
/* ------------------------------------------------------------------ */

/**
 * `POST /dossiers-vente` — `Idempotency-Key` OBLIGATOIRE (création sensible, même doctrine que
 * `POST /ordres-reparation` : un double-clic comptoir ne doit jamais ouvrir deux dossiers pour la
 * même intention commerciale).
 *
 * `statut` initial toujours `prospection`, jamais entrant. `vehiculeId` optionnel dès la création
 * (`RV-30`).
 */
export const schemaCreationDossierVente = z
  .object({
    siteId: schemaIdentifiant,
    clientAcheteurId: schemaIdentifiant,
    /** `null`/absent = identique à `clientAcheteurId` (défaut serveur, `RV-40`). */
    clientFactureId: schemaIdentifiant.nullish(),
    clientConducteurId: schemaIdentifiant.nullish(),
    vehiculeId: schemaIdentifiant.nullish(),
    dateLivraisonEstimee: schemaDateJour.nullish(),
  })
  .extend(schemaConfirmations.shape);
export type EntreeCreationDossierVente = z.infer<typeof schemaCreationDossierVente>;

/** `PATCH /dossiers-vente/{id}` — `If-Match` OBLIGATOIRE (§9, même règle que
 *  `ordre-reparation.ts` : deux vendeurs éditant le même dossier en parallèle sont un cas réel,
 *  `§7.1`). Champs LIBRES uniquement, jamais un statut. */
export const schemaModificationDossierVente = z
  .object({
    clientFactureId: schemaIdentifiant.nullish(),
    clientConducteurId: schemaIdentifiant.nullish(),
    /** Associer/réassigner le véhicule (`RV-30`) — refusé serveur (`409
     *  VENTE_DOSSIER_TRANSITION_INTERDITE`) au-delà de `prospection` : `engager` verrouille le
     *  véhicule (`RV-32`), le réassigner après romprait la réservation. */
    vehiculeId: schemaIdentifiant.nullish(),
    dateLivraisonEstimee: schemaDateJour.nullish(),
  })
  .extend(schemaConfirmations.shape);
export type EntreeModificationDossierVente = z.infer<typeof schemaModificationDossierVente>;

/** `POST /dossiers-vente/{id}/documents-requis/marquer` — coche/décoche un item de la check-list
 *  de livraison (`RV-35`). Pas d'`Idempotency-Key` : rejouer avec le même `fourni` est un no-op
 *  idempotent par nature (même valeur écrite deux fois), pas une création. */
export const schemaMarquerDocumentRequis = z.object({
  code: schemaTexteCourt,
  fourni: z.boolean(),
});
export type EntreeMarquerDocumentRequis = z.infer<typeof schemaMarquerDocumentRequis>;

/* ------------------------------------------------------------------ */
/* Entrées d'écriture — actions de transition (§6.2)                   */
/* ------------------------------------------------------------------ */

/**
 * `POST /dossiers-vente/{id}/engager` — `prospection -> engage` (`RV-32`).
 *
 * Refusé (`409 VENTE_VEHICULE_MANQUANT`) si aucun véhicule associé ; refusé
 * (`409 VENTE_VEHICULE_INDISPONIBLE`) si le véhicule associé n'est plus `disponible`/`en_commande`
 * (`CV-01` : un autre dossier l'a réservé entre-temps).
 *
 * EFFETS DE BORD (documentés ici, pas réimplémentés) :
 *  - véhicule associé → `reserve` (`RV-32`, `vehicule-stock.ts`) ;
 *  - reprise associée, si présente et `negociee` → `confirmee`
 *    (`reprise.ts::schemaActionConfirmerReprise`, `RV-19`/`RV-27`) ; refusé
 *    (`409 VENTE_REPRISE_VALEUR_NEGOCIEE_REQUISE`) si la reprise est encore `estimee` — `RV-27`
 *    interdit de contractualiser sur une simple estimation, il faut renégocier avant de signer.
 *
 * `identitePieceType`/`bonCommandeDocumentId` OBLIGATOIRES : `RV-34` (identité vérifiée) et le fait
 * que la CRÉATION du document `bon_commande` lui-même appartient à `contrats/facturation/document.ts`
 * (transformation `devis -> bon_commande` ou création directe, hors périmètre de ce fichier) — le
 * front appelle facturation d'abord, puis cette action pour faire suivre le dossier de vente et
 * déclencher les effets de bord métier ci-dessus. `PV-02` (acompte par défaut) est un paramètre de
 * facturation, pas de ce contrat.
 */
export const schemaActionEngager = z
  .object({
    bonCommandeDocumentId: schemaIdentifiant,
    identitePieceType: schemaTexteCourt,
  })
  .extend(schemaConfirmations.shape);
export type EntreeActionEngager = z.infer<typeof schemaActionEngager>;

/** `POST /dossiers-vente/{id}/preparer` — `engage -> en_preparation`. Corps vide : la transition
 *  elle-même ne porte aucune donnée, la préparation (remise en état, immatriculation) se pilote par
 *  ailleurs (atelier pour la VO, connecteur constructeur pour le VN — hors périmètre). */
export const schemaActionPreparer = z.object({}).extend(schemaConfirmations.shape);
export type EntreeActionPreparer = z.infer<typeof schemaActionPreparer>;

/**
 * `POST /dossiers-vente/{id}/marquer-pret-a-livrer` — `en_preparation -> pret_a_livrer`.
 *
 * Refusé (`409 VENTE_FINANCEMENT_NON_CONFIRME`) si le financement courant n'est pas `confirme`
 * (`RV-37`). Refusé (`409 VENTE_LIVRAISON_EXPERTISE_REQUISE`) si une expertise MFK requise est en
 * statut `refuse` non résolu (`RV-56`, `CV-07` — vérifié contre `vehicule_expertise`, atelier, pas
 * dupliqué ici). Refusé (`409 VENTE_LIVRAISON_INCOMPLETE`) pour tout autre élément de `RV-52`
 * (plaques, immatriculation) non réuni côté paramétrage tenant (`PV-03`).
 */
export const schemaActionMarquerPretALivrer = z.object({}).extend(schemaConfirmations.shape);
export type EntreeActionMarquerPretALivrer = z.infer<typeof schemaActionMarquerPretALivrer>;

/**
 * `POST /dossiers-vente/{id}/livrer` — `pret_a_livrer -> livre` (`RV-52`/`RV-53`).
 *
 * EFFETS DE BORD (documentés, pas réimplémentés) :
 *  - détention du véhicule vendu : clôture côté garage/ancien propriétaire (motif `vente`),
 *    ouverture au nom du client conducteur (`RV-53`, `RV-57`) — PAS de l'organisme de financement
 *    même en leasing (`CV-08`, `RV-40` dernier paragraphe) ;
 *  - VN : début de garantie constructeur au véhicule (`garantieDebut`, `RV-54`) ;
 *  - reprise confirmée, si présente : ENTRE EN STOCK à `valeurNegocieeCentimes` (`RV-24`,
 *    `vehicule-stock.ts::EntreeMiseEnStock`), détention client repris clôturée motif `reprise`
 *    (`RV-23`) — détenteur cible `[À VALIDER, QV-01]`, cette action ne le tranche pas.
 */
export const schemaActionLivrer = z
  .object({
    dateLivraisonEffective: schemaDateJour,
    kilometrageDepart: schemaKilometrage,
    uniteKilometrage: z.enum(UNITES_DISTANCE).default('km'),
  })
  .extend(schemaConfirmations.shape);
export type EntreeActionLivrer = z.infer<typeof schemaActionLivrer>;

/** `POST /dossiers-vente/{id}/cloturer` — `livre -> clos`. État purement administratif (§6.2 :
 *  « toute la paperasse… complète »), pas un second contrôle métier — corps vide. */
export const schemaActionCloturerDossierVente = z.object({}).extend(schemaConfirmations.shape);
export type EntreeActionCloturerDossierVente = z.infer<typeof schemaActionCloturerDossierVente>;

/** `POST /dossiers-vente/{id}/annuler` — depuis `prospection`/`engage`/`en_preparation`
 *  UNIQUEMENT, AVANT facture émise (`RV-38`, §6.2) — `409 VENTE_DOSSIER_ANNULATION_IMPOSSIBLE`
 *  au-delà. Motif OBLIGATOIRE (même doctrine que `ordre-reparation.ts::schemaActionAnnuler`).
 *  EFFET DE BORD : véhicule associé, si `reserve` → `disponible` (`CV-01`, jamais bloqué
 *  indéfiniment). */
export const schemaActionAnnulerDossierVente = z.object({ motif: schemaMotif });
export type EntreeActionAnnulerDossierVente = z.infer<typeof schemaActionAnnulerDossierVente>;

/** `POST /dossiers-vente/{id}/abandonner` — même garde et même effet de bord que `annuler`
 *  (`409 VENTE_DOSSIER_ANNULATION_IMPOSSIBLE` au-delà de `en_preparation`), sémantique distincte
 *  pour le reporting : rupture volontaire (`annule`) contre client qui ne répond plus (`abandonne`,
 *  §6.2, même logique que l'OR abandonné côté atelier). Motif OBLIGATOIRE. */
export const schemaActionAbandonnerDossierVente = z.object({ motif: schemaMotif });
export type EntreeActionAbandonnerDossierVente = z.infer<typeof schemaActionAbandonnerDossierVente>;

/* Rappel : `ACTIONS_DOSSIER_VENTE` (`enums.ts`) inclut `'modifier'` pour signaler que `PATCH` est
 * disponible MAINTENANT (même principe que `ACTIONS_VEHICULE_STOCK`) — il ne correspond à aucun
 * schéma d'action ci-dessus, volontairement : `schemaModificationDossierVente` le couvre déjà. */
