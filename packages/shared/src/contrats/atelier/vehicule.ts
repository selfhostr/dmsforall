import { z } from 'zod';

import type { Langue } from '../enums';
import type { Avertissement } from './avertissement';
import {
  MOTIFS_ARCHIVAGE_VEHICULE,
  MOTIFS_FIN_DETENTION,
  MOTIFS_KILOMETRAGE_REGRESSIF,
  RESULTATS_EXPERTISE,
  SOURCES_ECHEANCE_EXPERTISE,
  SOURCES_KILOMETRAGE,
  STATUTS_CAMPAGNE,
  STATUTS_TRAVAIL_REPORTE,
  STATUTS_VEHICULE,
  UNITES_DISTANCE,
  URGENCES_TRAVAIL,
  type MotifArchivageVehicule,
  type ResultatExpertise,
  type SourceEcheanceExpertise,
  type SourceKilometrage,
  type StatutCampagne,
  type StatutClient,
  type StatutTravailReporte,
  type StatutVehicule,
  type UniteDistance,
  type UrgenceTravail,
} from './enums';
import {
  schemaCentimesPositif,
  schemaCodePays,
  schemaDateJour,
  schemaHorodatage,
  schemaIdentifiant,
  schemaKilometrage,
  schemaMotif,
  schemaTexteCourt,
  schemaTexteLong,
} from './primitives';
import { schemaBooleenQuery, schemaListeQuery } from '../filtres';

/**
 * Véhicules (contrats-api-etape-1.md §7.4, §8.1).
 *
 * La recherche par plaque est le point d'entrée n°1 du comptoir : tout ce qui suit est conçu pour
 * qu'un doublon de véhicule ne pollue jamais cet index (d'où l'`Idempotency-Key` à la création).
 *
 * Il n'existe AUCUN `DELETE` : un véhicule s'ARCHIVE (RM-31) ou se fusionne (RM-32).
 */

/* ------------------------------------------------------------------ */
/* Ressource                                                           */
/* ------------------------------------------------------------------ */

/** Origine étrangère du véhicule (RM-27) — structurée plutôt qu'un booléen nu : le pays et la
 *  date d'importation conditionnent la garantie et les périodicités d'expertise. */
export interface ImportationVehicule {
  readonly estImporte: boolean;
  readonly paysOrigine: string | null;
  readonly importeLe: string | null;
}

/** RM-33 : date ET plafond kilométrique. Le réceptionnaire ne doit jamais promettre une garantie
 *  inexistante — c'est pourquoi les deux bornes sont exposées, pas seulement la date. */
export interface GarantieVehicule {
  readonly debutLe: string | null;
  readonly finLe: string | null;
  readonly plafondKm: number | null;
  readonly active: boolean;
}

export interface ReponseVehicule {
  readonly id: string;
  readonly vin: string | null;
  readonly marque: string;
  readonly modele: string;
  readonly version: string | null;
  readonly finition: string | null;
  /** Code type suisse (approbation OFROU), ex. `1ZM431`. */
  readonly codeTypeCh: string | null;
  readonly premiereMiseEnCirculationLe: string | null;
  /** Rendu d'affichage calculé par le serveur (`marque modele version`). */
  readonly designation: string;
  /** Plaque COURANTE. `null` si le véhicule n'en porte aucune aujourd'hui (RM-17). */
  readonly plaque: string | null;
  readonly canton: string | null;
  readonly carburant: string | null;
  readonly cylindreeCm3: number | null;
  readonly puissanceKw: number | null;
  readonly boite: string | null;
  readonly transmission: string | null;
  readonly normeEmission: string | null;
  readonly couleur: string | null;
  readonly codeCouleur: string | null;
  readonly poidsVideKg: number | null;
  readonly poidsTotalKg: number | null;
  readonly places: number | null;
  readonly pneusEte: string | null;
  readonly pneusHiver: string | null;
  readonly pressionPneus: string | null;
  readonly huileType: string | null;
  readonly huileQuantiteDl: number | null;
  readonly batterie: string | null;
  readonly codeRadio: string | null;
  readonly codeCle: string | null;
  readonly intervalleEntretienKm: number | null;
  readonly intervalleEntretienMois: number | null;
  readonly importe: ImportationVehicule;
  readonly garantieConstructeur: GarantieVehicule | null;
  readonly garantieGarage: GarantieVehicule | null;
  /** RM-22 : leasing — le détenteur au permis n'est pas toujours le propriétaire économique. */
  readonly proprietaireEconomiqueClientId: string | null;
  readonly conducteurHabituel: string | null;
  /** RM-16 : VIN absent ou incomplet. Alimente l'avertissement `VEHICULE_IDENTIFICATION_INCOMPLETE`. */
  readonly identificationIncomplete: boolean;
  readonly statut: StatutVehicule;
  readonly motifArchivage: MotifArchivageVehicule | null;
  readonly fusionneVersVehiculeId: string | null;
  /**
   * Plan du parc, Lot C simplifié (migration 0044) : position DÉCLARATIVE du véhicule dans le
   * garage, texte libre (« devant, place 3 », « chez le carrossier »). Aide-mémoire, PAS un
   * inventaire audité : pas de format imposé, vide est normal, aucun trigger générique.
   */
  readonly emplacementLibre: string | null;
  /** Dernier instant où `emplacementLibre` a été touché — PAS `modifieLe` (voir le mapper). */
  readonly emplacementMajLe: string | null;
  readonly creeLe: string;
  readonly modifieLe: string;
}

/** Projection minimale, embarquée dans les OR, la recherche et le planning. */
export interface VehiculeResume {
  readonly id: string;
  readonly plaque: string | null;
  readonly canton: string | null;
  readonly designation: string;
  readonly vin: string | null;
  readonly premiereMiseEnCirculationLe: string | null;
  readonly identificationIncomplete: boolean;
  /** Colonne plate de `vehicule`, sans jointure supplémentaire (coût quasi nul dans la liste SQL
   *  brute) — présent ici volontairement, à la différence de `creeLe`/`modifieLe` (exclus de cette
   *  projection minimale) : un aide-mémoire de position perd son intérêt s'il faut ouvrir la fiche
   *  pour le lire. `emplacementMajLe` reste réservé à `ReponseVehicule` (fiche complète). */
  readonly emplacementLibre: string | null;
}

/**
 * Plaque HISTORISÉE (RM-17/18/19). Une plaque réattribuée reste attachée à son ancien véhicule
 * avec sa période de validité — c'est ce qui permet à la recherche de dire « ce numéro a porté ce
 * véhicule jusqu'au … » plutôt que de mentir (CT-05).
 */
export interface ReponseVehiculePlaque {
  readonly id: string;
  readonly valeur: string;
  readonly canton: string | null;
  readonly pays: string;
  readonly debutLe: string;
  readonly finLe: string | null;
  /** §6.9 : une plaque interchangeable est portée par DEUX véhicules — la collision est légitime. */
  readonly interchangeable: boolean;
  /** Plaque professionnelle (U). Également exemptée de la contrainte d'unicité. */
  readonly professionnelle: boolean;
}

/** Détention HISTORISÉE (RM-20/21). Un seul détenteur courant, garanti par contrainte d'exclusion
 *  en base — c'est l'invariant que `POST /changer-detenteur` protège en le rendant atomique. */
export interface ReponseVehiculeDetention {
  readonly id: string;
  readonly client: {
    readonly id: string;
    readonly numeroClient: string;
    readonly nomAffiche: string;
  };
  readonly debutLe: string;
  readonly finLe: string | null;
  readonly motifFin: string | null;
}

/**
 * Relevé APPEND-ONLY (RM-23/24/25). Un relevé faux se corrige par un NOUVEAU relevé motivé,
 * jamais par écrasement.
 *
 * `valeurKm` est la valeur convertie par le SERVEUR : c'est elle qui sert la comparaison de
 * régression, et c'est ce qui rend CT-08 (60 000 mi après 90 000 km n'est pas une régression)
 * impossible à contourner depuis un client.
 */
export interface ReponseVehiculeKilometrage {
  readonly id: string;
  readonly valeur: number;
  readonly unite: UniteDistance;
  readonly valeurKm: number;
  readonly releveLe: string;
  readonly source: SourceKilometrage;
  readonly motifRegression: string | null;
  readonly ordreReparationId: string | null;
}

export interface ReponseVehiculeExpertise {
  readonly id: string;
  readonly dateLe: string;
  readonly resultat: ResultatExpertise;
  readonly defauts: string | null;
  readonly delaiContreVisiteLe: string | null;
  readonly dateContreVisiteLe: string | null;
  readonly prochaineEcheanceLe: string | null;
  /** DÉTERMINANT : une `convocation` cantonale prime toujours sur une périodicité `calculee`
   *  (RM-28, CT-10). Sans ce champ, un client afficherait une date fausse avec aplomb. */
  readonly sourceEcheance: SourceEcheanceExpertise;
}

export interface ReponseVehiculeCampagne {
  readonly id: string;
  readonly code: string;
  readonly description: string;
  readonly obligatoire: boolean;
  readonly statut: StatutCampagne;
  readonly closeLe: string | null;
  readonly ordreReparationId: string | null;
}

/**
 * Travail reporté (RM-73) — MATÉRIALISÉ, pas calculé. La spécification exige qu'il soit éditable
 * (le réceptionnaire écarte celui que le client refuse deux fois) et « éteignable ». Une vue sur
 * les lignes `refusee` ne permettrait ni l'un ni l'autre, et perdrait le montant de l'époque
 * quand le tarif change.
 */
export interface ReponseTravailReporte {
  readonly id: string;
  readonly designation: string;
  readonly urgence: UrgenceTravail;
  /** ABSENT pour un rôle sans droit aux montants (`ROLES_SANS_MONTANT`) — filtrage serveur. */
  readonly montantEstimeCentimes?: number | null;
  readonly kilometrageAlors: number | null;
  readonly constateLe: string;
  readonly securite: boolean;
  readonly statut: StatutTravailReporte;
  readonly ordreReparationOrigineId: string | null;
  readonly ligneOrOrigineId: string | null;
  readonly ordreReparationRepriseId: string | null;
  /**
   * Raison d'une correction ou d'un abandon ULTÉRIEUR du travail (colonne `motif_modification`,
   * migration 0033) — DISTINCTE de `motif_refus` (raison du refus initial au devis, non exposée
   * par cette interface). Toujours présent (jamais filtré par rôle, à la différence de
   * `montantEstimeCentimes`) : ce n'est pas un montant, et c'est l'information que le
   * réceptionnaire vient relire au retour du véhicule — la masquer à un rôle qui voit déjà le
   * reste du travail reporté (désignation, statut, urgence) n'aurait aucun fondement dans la
   * matrice de droits existante (`ROLES_SANS_MONTANT` ne porte que sur les montants).
   */
  readonly motifModification: string | null;
  /** Explication libre saisie avec le travail (« courroie à prévoir », migration 0082). */
  readonly detail: string | null;
}

/* ------------------------------------------------------------------ */
/* Projection `GET /vehicules/{vehiculeId}/contexte-atelier` (§8.1)    */
/* ------------------------------------------------------------------ */

/**
 * D-01, RM-36, CT-13 — consommée au même instant à la prise de RDV ET à la réception du matin.
 *
 * C'est un AGRÉGAT assumé, sous quatre règles qui le maintiennent cacheable plutôt que parallèle :
 *  1. aucun champ n'existe UNIQUEMENT ici — chaque section projette une ressource accessible
 *     seule (`/travaux-reportes`, `/campagnes`, `/expertises`, `/kilometrages`, `/notes`) ;
 *  2. additif uniquement : on ajoute une section, on n'en retire ni n'en renomme jamais ;
 *  3. `GET` seul, aucun effet de bord — rejouable et cacheable ;
 *  4. chaque section est BORNÉE et porte son compteur total.
 *
 * Nom retenu : `contexte-atelier`, **sans alias**. Un alias créé le premier jour est une dette de
 * compatibilité qu'on porte pour toujours et que personne n'ose retirer.
 */
export interface ReponseContexteAtelier {
  readonly vehicule: {
    readonly id: string;
    readonly plaque: string | null;
    readonly canton: string | null;
    readonly designation: string;
    readonly premiereMiseEnCirculationLe: string | null;
    readonly vin: string | null;
    readonly codeTypeCh: string | null;
    readonly importe: ImportationVehicule;
    readonly identificationIncomplete: boolean;
  };
  readonly detenteurCourant: {
    readonly clientId: string;
    readonly numeroClient: string;
    readonly nom: string;
    readonly langueCorrespondance: Langue;
    readonly statut: StatutClient;
    readonly depuisLe: string;
    readonly poObligatoire: boolean;
  } | null;
  readonly dernierKilometrage: {
    readonly valeurKm: number;
    readonly unite: UniteDistance;
    readonly releveLe: string;
    readonly source: SourceKilometrage;
  } | null;
  readonly expertise: {
    readonly derniereLe: string | null;
    readonly prochaineLe: string | null;
    readonly source: SourceEcheanceExpertise;
    readonly echue: boolean;
    readonly joursDepuisEcheance: number | null;
  } | null;
  readonly garantie: {
    readonly constructeur: GarantieVehicule | null;
    readonly garage: GarantieVehicule | null;
  };
  readonly campagnesOuvertes: readonly {
    readonly id: string;
    readonly code: string;
    readonly description: string;
    readonly obligatoire: boolean;
  }[];
  /** `elements` borné à `MAX_TRAVAUX_REPORTES_CONTEXTE` ; `total` donne le compte réel. */
  readonly travauxReportes: {
    readonly total: number;
    readonly elements: readonly ReponseTravailReporte[];
  };
  readonly alertesClient: readonly {
    readonly id: string;
    readonly nature: 'alerte';
    readonly texte: string;
  }[];
  /** Alimente la confirmation `VEHICULE_DEUX_OR_OUVERTS` (P-29). */
  readonly ordresReparationOuverts: readonly {
    readonly id: string;
    readonly numero: string;
    readonly statut: string;
  }[];
  /**
   * PRÉSENT et `null` en étape 1 : le champ réserve la place de l'hôtel à pneus sans engager
   * d'implémentation. Le déclarer maintenant coûte une ligne ; l'ajouter dans trois ans coûte une
   * revue de tous les clients.
   */
  readonly depotPneus: null;
  readonly avertissements: readonly Avertissement[];
}

/** Borne de la section `travauxReportes` du contexte-atelier (§8.1). */
export const MAX_TRAVAUX_REPORTES_CONTEXTE = 10;

/* ------------------------------------------------------------------ */
/* Filtres et tris (§6.2)                                              */
/* ------------------------------------------------------------------ */

export const TRIS_VEHICULES = [
  'plaque:asc',
  'plaque:desc',
  'creeLe:desc',
  'prochaineExpertiseLe:asc',
] as const;
export const TRI_DEFAUT_VEHICULES = 'plaque:asc';

export const TRIS_KILOMETRAGES = ['releveLe:desc', 'releveLe:asc'] as const;
export const TRI_DEFAUT_KILOMETRAGES = 'releveLe:desc';

export const TRIS_TRAVAUX_REPORTES = ['constateLe:desc', 'constateLe:asc'] as const;
export const TRI_DEFAUT_TRAVAUX_REPORTES = 'constateLe:desc';

export const schemaFiltresVehicules = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  detenteurId: schemaIdentifiant.optional(),
  statut: schemaListeQuery(z.enum(STATUTS_VEHICULE)).optional(),
  marque: z.string().trim().max(60).optional(),
  importe: schemaBooleenQuery().optional(),
  /** Sert la liste de relance d'expertise (RM-29) : « échéance au plus tard le … ». */
  prochaineExpertiseAu: schemaDateJour.optional(),
  siteId: schemaIdentifiant.optional(),
  tri: z.enum(TRIS_VEHICULES).default(TRI_DEFAUT_VEHICULES),
});

export const schemaFiltresKilometrages = z.object({
  du: schemaDateJour.optional(),
  au: schemaDateJour.optional(),
  tri: z.enum(TRIS_KILOMETRAGES).default(TRI_DEFAUT_KILOMETRAGES),
});

export const schemaFiltresTravauxReportes = z.object({
  statut: schemaListeQuery(z.enum(STATUTS_TRAVAIL_REPORTE)).optional(),
  urgence: schemaListeQuery(z.enum(URGENCES_TRAVAIL)).optional(),
  tri: z.enum(TRIS_TRAVAUX_REPORTES).default(TRI_DEFAUT_TRAVAUX_REPORTES),
});

/* ------------------------------------------------------------------ */
/* Entrées d'écriture                                                  */
/* ------------------------------------------------------------------ */

/**
 * `POST /vehicules` — `Idempotency-Key` OBLIGATOIRE : un doublon de véhicule pollue la recherche
 * par plaque, l'entrée n°1 du produit.
 *
 * Un VIN de moins de 17 caractères est ACCEPTÉ (RM-15) avec l'avertissement `VEHICULE_VIN_COURT` :
 * les véhicules anciens et certains imports n'ont pas de VIN normalisé, et refuser la saisie
 * enverrait le garagiste dans un tableur.
 */
export const schemaCreationVehicule = z
  .object({
    vin: z.string().trim().min(5).max(17).toUpperCase().nullish(),
    marque: schemaTexteCourt,
    modele: schemaTexteCourt,
    version: schemaTexteCourt.nullish(),
    finition: schemaTexteCourt.nullish(),
    codeTypeCh: z.string().trim().max(20).nullish(),
    premiereMiseEnCirculationLe: schemaDateJour.nullish(),
    plaque: z.string().trim().max(20).nullish(),
    canton: z.string().trim().length(2).toUpperCase().nullish(),
    detenteurId: schemaIdentifiant.nullish(),
    importe: z.boolean().default(false),
    paysOrigine: schemaCodePays.nullish(),
    importeLe: schemaDateJour.nullish(),
    carburant: z.string().trim().max(40).nullish(),
    cylindreeCm3: z.number().int().min(0).max(20_000).nullish(),
    puissanceKw: z.number().int().min(0).max(2000).nullish(),
    boite: z.string().trim().max(40).nullish(),
    transmission: z.string().trim().max(40).nullish(),
    couleur: z.string().trim().max(40).nullish(),
    conducteurHabituel: schemaTexteCourt.nullish(),
    proprietaireEconomiqueClientId: schemaIdentifiant.nullish(),
  })
  .strict();

/** `PATCH /vehicules/{vehiculeId}` — données d'atelier (RM-26) et garanties (RM-33).
 *  `statut`, `plaque` et le détenteur ne sont PAS modifiables ici : chacun a son endpoint dédié,
 *  parce que chacun est historisé et audité. */
export const schemaModificationVehicule = schemaCreationVehicule
  .omit({ plaque: true, canton: true, detenteurId: true })
  .partial()
  .extend({
    pneusEte: z.string().trim().max(60).nullish(),
    pneusHiver: z.string().trim().max(60).nullish(),
    pressionPneus: z.string().trim().max(60).nullish(),
    huileType: z.string().trim().max(60).nullish(),
    huileQuantiteDl: z.number().int().min(0).max(500).nullish(),
    batterie: z.string().trim().max(60).nullish(),
    codeRadio: z.string().trim().max(40).nullish(),
    codeCle: z.string().trim().max(40).nullish(),
    intervalleEntretienKm: z.number().int().min(0).max(200_000).nullish(),
    intervalleEntretienMois: z.number().int().min(0).max(120).nullish(),
    /** Migration 0044 : position dans le garage, texte libre — borne applicative de longueur
     *  seulement, même doctrine que `pneusEte`/`batterie` ci-dessus, PAS de champ obligatoire ni
     *  de format imposé (ce n'est pas un inventaire audité). */
    emplacementLibre: z.string().trim().max(60).nullish(),
    garantieDebutLe: schemaDateJour.nullish(),
    garantieMois: z.number().int().min(0).max(240).nullish(),
    garantieKm: z.number().int().min(0).max(1_000_000).nullish(),
  });

/** `POST /vehicules/{vehiculeId}/archiver` (RM-31). Refusé s'il reste des OR ouverts
 *  (`409 VEHICULE_ARCHIVAGE_IMPOSSIBLE`, `blocages` = les OR concernés). */
export const schemaArchivageVehicule = z
  .object({
    motifArchivage: z.enum(MOTIFS_ARCHIVAGE_VEHICULE),
    motif: schemaMotif,
  })
  .strict();

export const schemaFusionVehicule = z
  .object({
    vehiculeSourceId: schemaIdentifiant,
    /** Garde saisie, comme `confirmationNom` sur la fusion de clients. */
    confirmationVin: z.string().trim().min(5).max(17).toUpperCase(),
  })
  .strict();

export const schemaPlaqueVehicule = z
  .object({
    valeur: z.string().trim().min(2).max(20),
    canton: z.string().trim().length(2).toUpperCase().nullish(),
    pays: schemaCodePays.default('CH'),
    debutLe: schemaDateJour,
    interchangeable: z.boolean().default(false),
    professionnelle: z.boolean().default(false),
  })
  .strict();

export const schemaCloturePlaque = z.object({ finLe: schemaDateJour }).strict();

/** Correction d'historique et import UNIQUEMENT. Le geste métier normal est
 *  `POST /changer-detenteur`, atomique. */
export const schemaDetentionVehicule = z
  .object({
    clientId: schemaIdentifiant,
    debutLe: schemaDateJour,
  })
  .strict();

export const schemaClotureDetention = z
  .object({
    finLe: schemaDateJour,
    motifFin: z.enum(MOTIFS_FIN_DETENTION),
  })
  .strict();

/**
 * `POST /vehicules/{vehiculeId}/changer-detenteur` — UN appel, UNE transaction, UNE entrée
 * d'audit (RM-20/21, CT-47).
 *
 * Le geste existe parce que la version en deux appels (`POST /detentions` puis
 * `POST /detentions/{id}/cloturer`) laisse, si elle est interrompue, un véhicule SANS détenteur
 * courant ou avec DEUX — précisément l'invariant que la contrainte d'exclusion protège en base,
 * et qu'on ne doit pas pouvoir violer temporairement depuis l'API. Les deux endpoints atomiques
 * restent exposés pour les corrections d'historique et les imports.
 */
export const schemaChangementDetenteur = z
  .object({
    nouveauClientId: schemaIdentifiant,
    changementLe: schemaDateJour,
    motifFin: z.enum(MOTIFS_FIN_DETENTION),
    nouvellePlaque: schemaPlaqueVehicule.omit({ debutLe: true }).optional(),
  })
  .strict();

/**
 * `POST /vehicules/{vehiculeId}/kilometrages`.
 *
 * Sans `motifRegression`, un relevé inférieur au dernier connu produit
 * `409 VEHICULE_KILOMETRAGE_REGRESSIF` avec `blocages` = dernier relevé connu et
 * `actionsProposees: [{ code: 'FOURNIR_MOTIF', parametres: { motifsAcceptes: [...] } }]`.
 * La conversion mi -> km est faite PAR LE SERVEUR avant comparaison (CT-08).
 */
export const schemaKilometrageVehicule = z
  .object({
    valeur: schemaKilometrage,
    unite: z.enum(UNITES_DISTANCE).default('km'),
    releveLe: schemaHorodatage,
    source: z.enum(SOURCES_KILOMETRAGE),
    motifRegression: z.enum(MOTIFS_KILOMETRAGE_REGRESSIF).nullish(),
    ordreReparationId: schemaIdentifiant.nullish(),
  })
  .strict();

export const schemaExpertiseVehicule = z
  .object({
    dateLe: schemaDateJour,
    resultat: z.enum(RESULTATS_EXPERTISE),
    defauts: schemaTexteLong.nullish(),
    delaiContreVisiteLe: schemaDateJour.nullish(),
    dateContreVisiteLe: schemaDateJour.nullish(),
    prochaineEcheanceLe: schemaDateJour.nullish(),
    sourceEcheance: z.enum(SOURCES_ECHEANCE_EXPERTISE),
  })
  .strict();

export const schemaCampagneVehicule = z
  .object({
    code: z.string().trim().min(1).max(40),
    description: schemaTexteCourt,
    obligatoire: z.boolean().default(false),
  })
  .strict();

export const schemaModificationCampagneVehicule = z
  .object({
    description: schemaTexteCourt.optional(),
    obligatoire: z.boolean().optional(),
    statut: z.enum(STATUTS_CAMPAGNE).optional(),
  })
  .strict();

/** RM-73 : un travail reporté s'écarte (`abandonne`) ou se corrige, il ne se supprime pas. */
export const schemaModificationTravailReporte = z
  .object({
    designation: schemaTexteCourt.optional(),
    urgence: z.enum(URGENCES_TRAVAIL).optional(),
    montantEstimeCentimes: schemaCentimesPositif.nullish(),
    statut: z.enum(STATUTS_TRAVAIL_REPORTE).optional(),
    motif: schemaMotif.optional(),
  })
  .strict();

export type EntreeCreationVehicule = z.infer<typeof schemaCreationVehicule>;
export type EntreeModificationVehicule = z.infer<typeof schemaModificationVehicule>;
export type EntreeArchivageVehicule = z.infer<typeof schemaArchivageVehicule>;
export type EntreeFusionVehicule = z.infer<typeof schemaFusionVehicule>;
export type EntreePlaqueVehicule = z.infer<typeof schemaPlaqueVehicule>;
export type EntreeDetentionVehicule = z.infer<typeof schemaDetentionVehicule>;
export type EntreeChangementDetenteur = z.infer<typeof schemaChangementDetenteur>;
export type EntreeKilometrageVehicule = z.infer<typeof schemaKilometrageVehicule>;
export type EntreeExpertiseVehicule = z.infer<typeof schemaExpertiseVehicule>;
export type EntreeCampagneVehicule = z.infer<typeof schemaCampagneVehicule>;
export type EntreeModificationTravailReporte = z.infer<typeof schemaModificationTravailReporte>;
export type FiltresVehicules = z.infer<typeof schemaFiltresVehicules>;
