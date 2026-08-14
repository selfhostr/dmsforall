import { z } from 'zod';

import type { ClientResume } from './client';
import type { ReponseDevisComplementaire } from './devis';
import type { MontantsLigneOr, ReponseLigneOr } from './ligne';
import type { VehiculeResume } from './vehicule';
import {
  ACTIONS_AUDITEES,
  ATTENTES_ORDRE_REPARATION,
  ENTITES_AUDITEES,
  LOCALISATIONS_VEHICULE,
  MOTIFS_LIEN_OR,
  STATUTS_INITIAUX_ORDRE_REPARATION,
  STATUTS_ORDRE_REPARATION,
  TYPES_ORDRE_REPARATION,
  UNITES_DISTANCE,
  VUES_ORDRE_REPARATION,
  type ActionAuditee,
  type ActionOrdreReparation,
  type AttenteOrdreReparation,
  type EntiteAuditee,
  type EtatAfficheOrdreReparation,
  type LocalisationVehicule,
  type MotifLienOr,
  type PayeurLigneOr,
  type StatutOrdreReparation,
  type TypeOrdreReparation,
} from './enums';
import { schemaConfirmations } from './avertissement';
import {
  schemaCentimesPositif,
  schemaDateJour,
  schemaHorodatage,
  schemaIdentifiant,
  schemaKilometrage,
  schemaListeIdentifiants,
  schemaMotif,
  schemaTexteCourt,
  schemaTexteLong,
} from './primitives';
import { schemaListeQuery } from '../filtres';

/**
 * Ordres de réparation (contrats-api-etape-1.md §7.6, §7.7, §8.3).
 *
 * DÉCISION STRUCTURANTE : **les transitions sont des actions nommées**
 * (`POST /ordres-reparation/{id}/terminer`), pas un `PATCH {"statut": "termine"}`. Chaque
 * transition porte son CORPS propre, son DROIT propre et ses CODES D'ERREUR propres ; aucun des
 * trois n'est exprimable dans un `PATCH` générique, et l'OpenAPI cesserait d'être la
 * documentation de la machine à états.
 *
 * Corollaires (§2.3), opposables en revue :
 *  - aucune action n'accepte de statut cible — la cible est dans le CHEMIN ;
 *  - aucune action n'est un raccourci multi-transitions — chaque franchissement doit être
 *    auditable seul ;
 *  - `statut` est en LECTURE SEULE partout, `PATCH` compris. Les champs dérivés (`etatAffiche`,
 *    `attentes`, `actionsDisponibles`) le sont aussi et ne sont JAMAIS l'entrée d'une décision
 *    serveur.
 */

/* ------------------------------------------------------------------ */
/* Bornes contractuelles                                               */
/* ------------------------------------------------------------------ */

/**
 * Au-delà de ce nombre, `lignes` est tronqué et `lignesTronquees` vaut `true` ; le client pagine
 * alors `GET /ordres-reparation/{id}/lignes`.
 *
 * Le seuil est ACTIF dès le lot 1, avec un test qui le franchit. Un champ toujours faux n'est
 * jamais testé, et sera faux le jour où il devient vrai.
 */
export const SEUIL_LIGNES_EMBARQUEES = 200;

/** `ProblemeDetail.blocages` est borné (§3.5 règle 2) ; au-delà, `donnees.total` porte le compte
 *  réel. Un OR pathologique ne doit pas produire une réponse d'erreur d'un mégaoctet. */
export const MAX_BLOCAGES = 50;

/* ------------------------------------------------------------------ */
/* Ressource                                                           */
/* ------------------------------------------------------------------ */

/**
 * VALEURS FIGÉES à l'ouverture de l'OR (RM-50) — dénormalisation volontaire et non négociable.
 * Un OR imprimé six mois plus tard doit porter l'adresse et les conditions de l'époque, pas
 * celles d'aujourd'hui. Modifier la fiche client n'altère aucun OR existant.
 */
export interface ValeursFigeesOr {
  readonly clientDesignation: string;
  readonly adresseFacturation: Readonly<Record<string, unknown>> | null;
  /** Rabais et conditions applicables, capturés tels quels. Absentes pour un rôle sans montants. */
  readonly conditions?: Readonly<Record<string, unknown>> | null;
  readonly plaque: string | null;
  readonly detenteurClientId: string | null;
}

/** Drapeaux d'attente, ORTHOGONAUX au statut (A-03) : ce ne sont PAS des statuts, et c'est
 *  exactement ce qui permet de geler `statut_ordre_reparation`. */
export type AttentesOr = Readonly<Record<AttenteOrdreReparation, boolean>>;

export interface ReponseOrdreReparationDemande {
  readonly id: string;
  readonly ordre: number;
  /** VERBATIM du client (RM-52). Il n'existe **aucun `PATCH`** : un verbatim est un FAIT, pas un
   *  champ éditable. La base ne concède même pas le privilège `UPDATE` sur cette table. */
  readonly verbatim: string;
  readonly saisiLe: string;
  readonly saisiPar: { readonly utilisateurId: string; readonly nomAffiche: string } | null;
}

export interface ReponseControleQualiteOr {
  readonly controleurId: string;
  readonly controleLe: string;
  readonly conforme: boolean;
  readonly motifNonConformite: string | null;
  readonly pointsControles: readonly {
    readonly code: string;
    readonly libelle: string;
    readonly conforme: boolean | null;
  }[];
}

export interface ReponseSignatureOr {
  readonly id: string;
  readonly type: 'reception' | 'restitution' | 'reserve_securite';
  readonly signataireNom: string;
  readonly signeLe: string;
  readonly appareil: string | null;
}

/** Cumuls de pointage rapportés sur l'OR. Lot 1 : toujours vides (le module pointage arrive au
 *  lot 2), mais le champ EXISTE — l'ajouter plus tard serait ignoré par les clients déployés. */
export interface CumulsPointageOr {
  readonly totalCentiemes: number;
  readonly parTechnicien: readonly {
    readonly technicienId: string;
    readonly nomAffiche: string;
    readonly centiemes: number;
  }[];
  readonly pointagesOuverts: number;
}

/** Ventilation TVA d'un groupe de payeur. HT, TVA et TTC sont tous les trois présents DÈS
 *  l'étape 1, même si l'atelier ne raisonne qu'en TTC : les ajouter plus tard serait additif,
 *  mais les CALCULER plus tard obligerait à revalider l'arithmétique sur des OR existants. */
export interface TotauxPayeurOr extends MontantsLigneOr {
  readonly payeur: PayeurLigneOr;
  /**
   * Clé de regroupement, DEUXIÈME MOITIÉ (`MD-62` : le regroupement est `(payeur, payeurClientId)`,
   * jamais `payeur` seul). `null` pour `payeur = 'client'` (destinataire = l'OR lui-même, jamais
   * ambigu) et pour `payeur = 'garage'` (`RF-92`, fusionné dans le groupe `'client'` — ce groupe
   * `'garage'` séparé n'apparaît donc JAMAIS dans ce tableau). Deux éléments `payeur = 'assurance'`
   * avec des `payeurClientId` différents sont deux groupes DISTINCTS : deux assureurs sur un même
   * OR ne fusionnent jamais sous prétexte qu'ils partagent le même `payeur`.
   *
   * INFÉRENCE liée à `ReponseLigneOr.payeurClientId` — même avertissement : la colonne source
   * n'existe pas encore en base (`AC-08`).
   */
  readonly payeurClientId: string | null;
  /** Projection minimale du destinataire réel de ce groupe (`RF-87`) — évite à l'écran de
   *  facturation (`design-etape-2-facturation.md` §3.2, « Groupe payeur « Assurance — Zurich
   *  Assurances » ») de recharger la fiche client seulement pour afficher son nom. `null`
   *  UNIQUEMENT quand `payeur = 'garage'` (personne, `RF-92`) — pour `'client'`, c'est le client de
   *  l'OR ; pour les autres payeurs, c'est la fiche désignée par `payeurClientId`, toujours résolue
   *  (un groupe sans destinataire résolu n'apparaît pas dans ce tableau). */
  readonly destinataire: { readonly clientId: string; readonly nomAffiche: string } | null;
  readonly tva: readonly {
    readonly tauxPourmille: number;
    readonly baseHtCentimes: number;
    readonly montantCentimes: number;
  }[];
}

/**
 * `GET /ordres-reparation/{orId}` — LE DOCUMENT COMPLET (D-10).
 *
 * Ce n'est PAS un agrégat d'écran : un OR *est* un document, et lignes, devis, signatures et
 * cumuls de pointage en font partie au sens métier. Le retourner entier respecte sa frontière
 * naturelle. Cette distinction est ce qui permettra de refuser un futur
 * `/tableau-de-bord-comptoir` sans se contredire.
 *
 * TOUTES les actions de §7.7 renvoient cette même représentation dans l'enveloppe : après une
 * transition, l'écran d'OR n'a pas à relire — c'est l'écran le plus rafraîchi du produit.
 */
export interface ReponseOrdreReparation {
  readonly id: string;
  /** Numéro CONTINU (RM-49), brûlé dans la transaction métier : un rollback le rend. */
  readonly numero: string;
  readonly siteId: string;
  readonly type: TypeOrdreReparation;
  readonly statut: StatutOrdreReparation;
  readonly client: ClientResume;
  readonly vehicule: VehiculeResume;
  readonly figees: ValeursFigeesOr;
  readonly conducteurPresentNom: string | null;
  readonly kilometrageEntree: number | null;
  readonly kilometrageSortie: number | null;
  /** Absents pour un rôle sans droit aux montants (`ROLES_SANS_MONTANT`). */
  readonly plafondCentimes?: number;
  readonly plafondAutorisePar?: string | null;
  /** Dérivé, maintenu par trigger : sert RM-54 sans recompter les lignes à chaque validation. */
  readonly totalValideCentimes?: number;
  /**
   * Somme des `montantTtcCentimes` des lignes non `annulee`/`refusee` (§76) — même calcul que
   * `OrdreReparationResume.totalTtcCentimes`, qui porte déjà ce champ ; il manquait ici, sur le
   * DOCUMENT COMPLET, alors que `GET /ordres-reparation` (liste) rend cette forme-ci (voir
   * `ServiceOr.lister` → `assemblerDocument`) — la colonne « Total TTC » de la liste des OR était
   * vide pour cette raison précise. Même garde que `totalValideCentimes` : absent pour un rôle sans
   * droit aux montants, jamais `0` (qui mentirait sur « aucun montant »).
   */
  readonly totalTtcCentimes?: number;
  readonly restitutionPromiseLe: string | null;
  /** RM-56 : la promesse INITIALE, conservée pour que le report soit visible et motivé. */
  readonly restitutionInitialeLe: string | null;
  /**
   * Calculé UNE SEULE FOIS côté serveur, ici et nulle part ailleurs (constat du testeur : deux
   * tableaux de bord lisant chacun leur propre notion de « en retard » se sont contredits — l'un
   * voyait cinq sorties du jour, l'autre aucune). `true` uniquement si `restitutionPromiseLe` est
   * renseigné, que l'OR n'est pas encore restitué (`restitue`/`cloture`/`annule` exclus) et que
   * l'instant courant dépasse la promesse. **Une date promise absente n'est JAMAIS un retard** —
   * `null` et « en retard » ne partagent jamais le même rendu. Voir
   * `apps/api/src/atelier/restitution-retard.ts`.
   *
   * FACULTATIF dans le TYPE (le serveur le peuple TOUJOURS, sans exception) : rendre le champ
   * obligatoire casserait la compilation des très nombreuses fixtures `ReponseOrdreReparation`
   * déjà écrites dans `apps/web/**.spec.tsx` par l'agent front parallèle (périmètre disjoint,
   * hors de portée d'écriture ici) — même arbitrage que `OrdreReparationResume.enRetard?`
   * ci-dessous, additif pur, jamais une rupture de compatibilité (§11.1).
   */
  readonly enRetard?: boolean;
  readonly localisation: LocalisationVehicule;
  readonly sousTraitantNom: string | null;
  readonly ordreReparationParentId: string | null;
  readonly motifLien: MotifLienOr | null;
  readonly rendezVousId: string | null;
  /** RM-14 : la « PO » du client entreprise. Son absence bloque `OR_PO_MANQUANT`. */
  readonly numeroCommandeInterne: string | null;
  readonly receptionnaireId: string | null;
  readonly retentionInvoqueeLe: string | null;
  readonly litigeOuvertLe: string | null;
  readonly ouvertLe: string | null;
  readonly termineLe: string | null;
  readonly factureLe: string | null;
  readonly restitueLe: string | null;
  readonly clotureLe: string | null;
  readonly annuleLe: string | null;
  readonly motifAnnulation: string | null;
  readonly demandes: readonly ReponseOrdreReparationDemande[];
  readonly lignes: readonly ReponseLigneOr[];
  readonly nombreLignes: number;
  /** Voir `SEUIL_LIGNES_EMBARQUEES`. */
  readonly lignesTronquees: boolean;
  /**
   * Quelques désignations de lignes (§82), BORNÉES côté serveur — de quoi dire en une phrase ce qui
   * a été fait, sans obliger l'appelant à ouvrir l'OR (constat terrain : « pour répondre au client,
   * je dois ouvrir chaque ordre un par un »). Voir `SEUIL_DESIGNATIONS_APERCU`
   * (`apps/api/src/atelier/service-or.ts`, actuellement 3) — jamais la liste complète, qui reste
   * `lignes`/`nombreLignes`. Exclut les lignes `annulee`/`refusee` (jamais faites) et les
   * désignations vides. Tableau VIDE, jamais absent : un OR sans ligne facturable n'est pas une
   * absence de donnée, c'est un fait (rien à montrer).
   */
  readonly designationsApercu?: readonly string[];
  readonly devisComplementaires: readonly ReponseDevisComplementaire[];
  readonly controleQualite: ReponseControleQualiteOr | null;
  readonly signatures: readonly ReponseSignatureOr[];
  /** Prêt de véhicule de courtoisie lié. Toujours `null` au lot 1 (module lot 5). */
  readonly pret: Readonly<Record<string, unknown>> | null;
  readonly cumulsPointage: CumulsPointageOr;
  /** Absents pour un rôle sans droit aux montants. */
  readonly totauxParPayeur?: readonly TotauxPayeurOr[];
  /**
   * Démontage/remontage facturable pour un devis complémentaire refusé (`RF-90`, `RF-91`, `P-24`),
   * calculé par le serveur À LA LECTURE et JAMAIS matérialisé en `ligne_or` tant que
   * `POST /ordres-reparation/{orId}/facturer` n'a pas reçu `inclureDemontageRefuse: true`
   * (`facturer-or.ts`) — RF-91 : « la ligne de démontage est proposée, jamais créée en silence ».
   * `null` si aucun démontage facturable n'a été détecté, si l'OR n'est pas `termine`, ou si `P-24`
   * (`docs/design-etape-2-facturation.md` §3.3) vaut `offrir`. Absent pour un rôle sans droit aux
   * montants.
   *
   * INFÉRENCE : requis pour que l'écran de facturation (§3.2 du design, encart « Un démontage a
   * été réalisé… ») sache QUOI afficher avant même d'appeler `/facturer` — sans ce champ, rien dans
   * l'OR ne porte cette information (elle n'existe délibérément pas en tant que ligne), et le front
   * n'a aucun moyen de la lire.
   */
  readonly demontageFacturablePropose?: { readonly montantTtcCentimes: number } | null;
  readonly attentes: AttentesOr;
  /**
   * Le plus bloquant des trois drapeaux (`accord > pieces > externe`), sinon le statut. Calculé
   * UNE FOIS côté serveur : sans lui, chaque client réimplémenterait la priorité et deux clients
   * finiraient par afficher deux états différents pour le même OR.
   */
  readonly etatAffiche: EtatAfficheOrdreReparation;
  /**
   * Actions possibles MAINTENANT pour l'appelant courant (statut + droits + paramètres).
   *
   * Ne remplace pas la vérification serveur : il évite au client de la rejouer. Une action listée
   * peut néanmoins être REFUSÉE — les gardes coûteuses (pointages ouverts, lignes à valider,
   * plafond) ne sont pas évaluées à chaque lecture d'OR. Le refus porte alors `blocages` et
   * `actionsProposees`, ce qui rend cette approximation acceptable.
   */
  readonly actionsDisponibles: readonly ActionOrdreReparation[];
  /** Entier monotone par OR, incrémenté en base. Rendu aussi en en-tête `ETag: W/"<version>"`. */
  readonly version: number;
  readonly creeLe: string;
  readonly modifieLe: string;
  readonly modifiePar: { readonly utilisateurId: string; readonly nomAffiche: string } | null;
}

/** Projection minimale d'un OR, embarquée dans les listes, la recherche et le contexte-atelier. */
export interface OrdreReparationResume {
  readonly id: string;
  readonly numero: string;
  readonly statut: StatutOrdreReparation;
  readonly etatAffiche: EtatAfficheOrdreReparation;
  readonly type: TypeOrdreReparation;
  readonly localisation: LocalisationVehicule;
  readonly ouvertLe: string | null;
  readonly restitutionPromiseLe: string | null;
  /**
   * Même calcul, même garde qu'`ReponseOrdreReparation.enRetard` — voir ce champ. FACULTATIF ici
   * (contrairement au document complet) : ce résumé est aussi assemblé par `clients/` (périmètre
   * disjoint de l'agent rendez-vous), qui ne le peuple pas encore — absent, jamais `false` par
   * défaut trompeur, pour ne pas laisser croire « jamais en retard » à un consommateur qui lirait
   * cette projection.
   */
  readonly enRetard?: boolean;
  readonly vehicule: VehiculeResume;
  readonly client: ClientResume;
  readonly nombreLignes: number;
  /** Absent pour un rôle sans droit aux montants. */
  readonly totalTtcCentimes?: number;
  /**
   * Même champ, même bornage (`SEUIL_DESIGNATIONS_APERCU`) que
   * `ReponseOrdreReparation.designationsApercu` (§82) — voir ce champ. FACULTATIF ici comme
   * `enRetard` ci-dessus : ce résumé est aussi assemblé par `clients/` (périmètre disjoint), qui ne
   * le peuple pas encore — absent, jamais un tableau vide qui laisserait croire « rien de fait ».
   */
  readonly designationsApercu?: readonly string[];
}

/** Entrée du journal d'audit (`GET /ordres-reparation/{orId}/journal`, RM-59, RM-111). */
export interface ReponseEntreeJournal {
  readonly id: string;
  readonly entite: EntiteAuditee;
  readonly entiteId: string;
  readonly action: ActionAuditee;
  readonly survenuLe: string;
  readonly auteur: { readonly utilisateurId: string; readonly nomAffiche: string } | null;
  /** Avant/après, restreints aux champs réellement modifiés. Montants filtrés par rôle. */
  readonly avant: Readonly<Record<string, unknown>> | null;
  readonly apres: Readonly<Record<string, unknown>> | null;
  readonly motif: string | null;
  /** Confirmations données lors du geste (§4.4) — un forçage se trace. */
  readonly confirmations: readonly string[];
}

/* ------------------------------------------------------------------ */
/* Filtres, vues et tris (§6.2, §6.3)                                  */
/* ------------------------------------------------------------------ */

/**
 * `numeroSequence:asc/desc` VOLONTAIREMENT ABSENT (arbitrage @laupernoe, 12.08.2026) — retiré, pas
 * seulement jamais câblé. `ordre_reparation.numero` est un `text` libre (`OR-2026-9`), aucune
 * colonne numérique de séquence n'existe en base : un tri TEXTE trierait `OR-2026-10` avant
 * `OR-2026-9`, ce qui est faux et pire que l'absence de tri. Deux façons de le rendre honnête ont
 * été écartées : extraire le suffixe numérique à la volée en SQL (balayage complet à chaque page,
 * fragile si un format de numéro futur ne se termine plus par des chiffres) ou ajouter une colonne
 * de séquence dédiée (migration hors périmètre pour l'instant). Le tri `ouvertLe` donne
 * pratiquement le même ordre, les numéros étant attribués chronologiquement — on cesse de proposer
 * un tri qu'on ne sait pas honorer plutôt que d'en garder un décoratif.
 *
 * À RÉOUVRIR uniquement si une vraie colonne de séquence numérique apparaît sur
 * `ordre_reparation` (migration dédiée) — pas avant, et pas par extraction SQL à la volée.
 */
export const TRIS_ORDRES_REPARATION = [
  'ouvertLe:desc',
  'ouvertLe:asc',
  'restitutionPromiseLe:asc',
  'restitutionPromiseLe:desc',
  'joursAttenteRetrait:desc',
] as const;
export const TRI_DEFAUT_ORDRES_REPARATION = 'ouvertLe:desc';

export const TRIS_JOURNAL = ['survenuLe:desc', 'survenuLe:asc'] as const;
export const TRI_DEFAUT_JOURNAL = 'survenuLe:desc';

/**
 * `vue` est du SUCRE : chaque valeur est exactement équivalente à une combinaison de filtres
 * primitifs documentés, reproductible par un tiers. `vue` et les filtres primitifs sont
 * CUMULABLES ; en cas de contradiction, le filtre explicite l'emporte.
 *
 * Une vue ne fait jamais rien qu'un développeur tiers ne puisse reproduire — sans quoi elle
 * devient une sémantique privée, non testable et impossible à faire évoluer.
 */
export const schemaFiltresOrdresReparation = z.object({
  siteId: schemaIdentifiant.optional(),
  statut: schemaListeQuery(z.enum(STATUTS_ORDRE_REPARATION)).optional(),
  vue: z.enum(VUES_ORDRE_REPARATION).optional(),
  clientId: schemaIdentifiant.optional(),
  vehiculeId: schemaIdentifiant.optional(),
  technicienId: schemaIdentifiant.optional(),
  localisation: schemaListeQuery(z.enum(LOCALISATIONS_VEHICULE)).optional(),
  attente: schemaListeQuery(z.enum(ATTENTES_ORDRE_REPARATION)).optional(),
  /** Bornes INCLUSES, convention `xDu` / `xAu` de toute l'API. */
  restitutionPromiseDu: schemaDateJour.optional(),
  restitutionPromiseAu: schemaDateJour.optional(),
  ouvertDu: schemaDateJour.optional(),
  ouvertAu: schemaDateJour.optional(),
  /** Porte sur le n° d'OR, la plaque et le nom du client. */
  q: z.string().trim().min(1).max(120).optional(),
  tri: z.enum(TRIS_ORDRES_REPARATION).default(TRI_DEFAUT_ORDRES_REPARATION),
});

export const schemaFiltresJournal = z.object({
  entite: z.enum(ENTITES_AUDITEES).optional(),
  action: z.enum(ACTIONS_AUDITEES).optional(),
  du: schemaHorodatage.optional(),
  au: schemaHorodatage.optional(),
  tri: z.enum(TRIS_JOURNAL).default(TRI_DEFAUT_JOURNAL),
});

/* ------------------------------------------------------------------ */
/* Entrées d'écriture — ressource                                      */
/* ------------------------------------------------------------------ */

/**
 * `POST /ordres-reparation` — `Idempotency-Key` OBLIGATOIRE. **Le cas critique** : un rejeu ne
 * doit jamais brûler un numéro d'OR (RM-49), qui doit rester continu.
 *
 * `confirmations` couvre `CLIENT_BLOQUE` (RM-08), `VEHICULE_DEUX_OR_OUVERTS` (P-29) et
 * `OR_SANS_RDV` (P-21) : toutes les conditions confirmables sont évaluées EN UNE PASSE, il n'y a
 * jamais deux allers-retours.
 */
export const schemaCreationOrdreReparation = z
  .object({
    siteId: schemaIdentifiant,
    vehiculeId: schemaIdentifiant,
    clientId: schemaIdentifiant,
    type: z.enum(TYPES_ORDRE_REPARATION),
    rendezVousId: schemaIdentifiant.nullish(),
    /** Obligatoire si P-10 l'exige, sinon `409 OR_KM_ENTREE_REQUIS` à la réception (RM-51). */
    kilometrageEntree: schemaKilometrage.nullish(),
    uniteKilometrage: z.enum(UNITES_DISTANCE).default('km'),
    /** Verbatims du client (RM-52), dans l'ordre de saisie. */
    demandes: z
      .array(z.object({ verbatim: schemaTexteLong }).strict())
      .max(50)
      .default([]),
    plafondCentimes: schemaCentimesPositif.optional(),
    plafondAutorisePar: schemaTexteCourt.nullish(),
    restitutionPromiseLe: schemaHorodatage.nullish(),
    conducteurPresentNom: schemaTexteCourt.nullish(),
    numeroCommandeInterne: z.string().trim().max(60).nullish(),
    ordreReparationParentId: schemaIdentifiant.nullish(),
    motifLien: z.enum(MOTIFS_LIEN_OR).nullish(),
    /** `planifie` n'est proposable que si `parametresAtelier.or.etatPlanifieActif` (P-22). */
    statutInitial: z.enum(STATUTS_INITIAUX_ORDRE_REPARATION).default('ouvert'),
  })
  .extend(schemaConfirmations.shape)
  .strict();

/**
 * `PATCH /ordres-reparation/{orId}` — `If-Match` OBLIGATOIRE (§9), champs LIBRES uniquement,
 * jamais un statut.
 *
 * Un report de restitution exige `motifReport` (RM-56) : le refuser est une règle MÉTIER, pas une
 * validation de forme — `400 VALIDATION_ECHOUEE` avec `erreurs[0].champ = "motifReport"`.
 */
export const schemaModificationOrdreReparation = z
  .object({
    localisation: z.enum(LOCALISATIONS_VEHICULE).optional(),
    sousTraitantNom: schemaTexteCourt.nullish(),
    restitutionPromiseLe: schemaHorodatage.nullish(),
    motifReport: schemaMotif.optional(),
    plafondCentimes: schemaCentimesPositif.optional(),
    plafondAutorisePar: schemaTexteCourt.nullish(),
    numeroCommandeInterne: z.string().trim().max(60).nullish(),
    conducteurPresentNom: schemaTexteCourt.nullish(),
  })
  .extend(schemaConfirmations.shape)
  .strict();

export const schemaDemandeOrdreReparation = z.object({ verbatim: schemaTexteLong }).strict();

/* ------------------------------------------------------------------ */
/* Entrées d'écriture — actions de transition (§7.7)                   */
/* ------------------------------------------------------------------ */

/** T-03 `planifie -> ouvert`. Le kilométrage d'entrée est le geste métier, pas un détail. */
export const schemaActionReceptionner = z
  .object({
    kilometrageEntree: schemaKilometrage,
    unite: z.enum(UNITES_DISTANCE).default('km'),
    /** RM-51 / §6.12 : la signature peut être différée, mais alors le motif est exigé. */
    signatureDifferee: z.boolean().default(false),
    motifDifferee: schemaMotif.optional(),
  })
  .extend(schemaConfirmations.shape)
  .strict()
  .refine((v) => !v.signatureDifferee || Boolean(v.motifDifferee), {
    message: 'Une signature différée exige un motif.',
    path: ['motifDifferee'],
  });

/** T-04 `ouvert -> en_cours`. Corps vide, mais l'objet existe : lui ajouter un champ un jour
 *  restera additif, alors que passer d'aucun corps à un corps ne l'est pas. */
export const schemaActionDemarrer = z.object({}).extend(schemaConfirmations.shape).strict();

/** T-06 / T-08 / T-10 — lève les blocages d'attente sur tout ou partie des lignes. */
export const schemaActionReprendreTravaux = z
  .object({
    ligneIds: schemaListeIdentifiants.optional(),
    motif: schemaMotif.optional(),
  })
  .strict();

/** T-11 `en_cours -> controle`. */
export const schemaActionPasserEnControle = z.object({}).extend(schemaConfirmations.shape).strict();

/** T-12 `controle -> en_cours` — motif OBLIGATOIRE : un refus de contrôle sans motif est
 *  inexploitable par le technicien qui doit reprendre. */
export const schemaActionRefuserControle = z.object({ motif: schemaMotif }).strict();

/** T-13 `controle -> termine`. */
export const schemaActionValiderControle = z
  .object({
    controleurId: schemaIdentifiant,
    pointsControles: z
      .array(z.object({ code: z.string().trim().min(1).max(40), conforme: z.boolean() }).strict())
      .max(100)
      .default([]),
  })
  .strict();

/** T-14 `en_cours -> termine` (interdite si P-08 impose le contrôle qualité). */
export const schemaActionTerminer = z
  .object({
    kilometrageSortie: schemaKilometrage.nullish(),
    unite: z.enum(UNITES_DISTANCE).default('km'),
  })
  .extend(schemaConfirmations.shape)
  .strict();

/** T-15 `termine -> en_cours` — motif OBLIGATOIRE. Depuis `facture` (I-02), la transition est
 *  refusée et l'issue est `CREER_OR_RETOUCHE`, jamais une réouverture. */
export const schemaActionRouvrir = z.object({ motif: schemaMotif }).strict();

/** T-17 / T-18. */
export const schemaActionRestituer = z
  .object({
    kilometrageSortie: schemaKilometrage.nullish(),
    unite: z.enum(UNITES_DISTANCE).default('km'),
    /** RM-78 : pièces remplacées effectivement remises au client. */
    piecesRestituees: z.array(schemaIdentifiant).max(200).optional(),
    paiementRecu: z.boolean().optional(),
  })
  .extend(schemaConfirmations.shape)
  .strict();

/** T-19. */
export const schemaActionCloturer = z.object({}).extend(schemaConfirmations.shape).strict();

/** T-20 — motif OBLIGATOIRE (RM-62). Refusée s'il existe des pointages, des pièces engagées ou
 *  une facture (`409 OR_ANNULATION_IMPOSSIBLE`, `blocages` nommant chacun). */
export const schemaActionAnnuler = z.object({ motif: schemaMotif }).strict();

/** §6.5 — droit `direction` seul. La rétention est un acte juridique, pas un statut d'atelier. */
export const schemaActionRetention = z
  .object({
    motif: schemaMotif,
    montantContesteCentimes: schemaCentimesPositif.optional(),
  })
  .strict();

export type EntreeCreationOrdreReparation = z.infer<typeof schemaCreationOrdreReparation>;
export type EntreeModificationOrdreReparation = z.infer<typeof schemaModificationOrdreReparation>;
export type EntreeDemandeOrdreReparation = z.infer<typeof schemaDemandeOrdreReparation>;
export type EntreeActionReceptionner = z.infer<typeof schemaActionReceptionner>;
export type EntreeActionReprendreTravaux = z.infer<typeof schemaActionReprendreTravaux>;
export type EntreeActionRefuserControle = z.infer<typeof schemaActionRefuserControle>;
export type EntreeActionValiderControle = z.infer<typeof schemaActionValiderControle>;
export type EntreeActionTerminer = z.infer<typeof schemaActionTerminer>;
export type EntreeActionRouvrir = z.infer<typeof schemaActionRouvrir>;
export type EntreeActionRestituer = z.infer<typeof schemaActionRestituer>;
export type EntreeActionAnnuler = z.infer<typeof schemaActionAnnuler>;
export type EntreeActionRetention = z.infer<typeof schemaActionRetention>;
export type FiltresOrdresReparation = z.infer<typeof schemaFiltresOrdresReparation>;
export type FiltresJournal = z.infer<typeof schemaFiltresJournal>;
