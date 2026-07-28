import { z } from 'zod';

import type { Langue } from '../enums';
import {
  ARRONDIS_POINTAGE,
  CANAUX_RAPPEL,
  ENTITES_A_TRANSITIONS,
  MODES_PRODUITS_ATELIER,
  POLITIQUES_CONTROLE_QUALITE,
  POLITIQUES_DEMONTAGE_REFUSE,
  POLITIQUES_DEUX_OR_MEME_VEHICULE,
  POLITIQUES_LANGUE_DOCUMENT,
  POLITIQUES_MENTION_SECURITE,
  POLITIQUES_SIGNATURE_RECEPTION,
  PORTEES_NUMEROTATION,
  TYPES_LIGNE_OR,
  UNITES_TEMPS,
  VISIBILITES_HISTORIQUE_VEHICULE,
  type ArrondiPointage,
  type CanalRappel,
  type ModeProduitsAtelier,
  type PolitiqueControleQualite,
  type PolitiqueDemontageRefuse,
  type PolitiqueDeuxOrMemeVehicule,
  type PolitiqueLangueDocument,
  type PolitiqueMentionSecurite,
  type PolitiqueSignatureReception,
  type PorteeNumerotation,
  type TypeLigneOr,
  type UniteTemps,
  type VisibiliteHistoriqueVehicule,
} from './enums';
import {
  schemaCentimesPositif,
  schemaCentiemes,
  schemaDateJour,
  schemaPourmille,
  schemaTexteCourt,
} from './primitives';

/**
 * Paramétrage et référentiels (contrats-api-etape-1.md §8.2, §7.12).
 *
 * NOTE DE PÉRIMÈTRE : ce fichier n'est pas dans la liste nominale de `plan-lot1-execution.md`
 * §6.1, qui ne cite que `enums, avertissement, client, vehicule, ordre-reparation, ligne, devis,
 * evenement, index`. Il est AJOUTÉ (ce qui est additif, donc sans rupture) parce que L1-07 et
 * L1-11 ont besoin de ces contrats et que `packages/shared` est GELÉ à la livraison de L1-01 —
 * les laisser hors du paquet aurait obligé un autre expert à les inventer dans `apps/api`, où
 * le front ne peut pas les lire.
 */

/* ------------------------------------------------------------------ */
/* `GET /parametres-atelier` — singleton du tenant (§8.2)              */
/* ------------------------------------------------------------------ */

/**
 * Lisible par TOUT utilisateur authentifié (l'UI en dépend à chaque écran), modifiable par
 * `admin`. Servi avec `ETag` + `Cache-Control: private, must-revalidate`.
 *
 * DEUX DÉCISIONS À NE PAS PERDRE DE VUE :
 *
 *  1. **Regroupement par domaine, pas liste plate de `P-xx`.** Les numéros `P-xx` sont un artefact
 *     de rédaction de la spécification ; un connecteur ne doit jamais avoir à connaître `P-19`
 *     pour lire un arrondi. La correspondance est documentée en annexe de l'OpenAPI.
 *  2. **`fonctionnalites` est le DRAPEAU D'ÉTAPE.** Il permet à un client de découvrir que la
 *     facturation n'existe pas encore sans coder « étape 2 » en dur, et il deviendra `true` sans
 *     aucun changement de contrat. C'est ce qui remplace la publication d'un `/facturer` qui
 *     répondrait 501 — un connecteur coderait contre une telle route.
 */
export interface ReponseParametresAtelier {
  readonly or: {
    readonly prefixe: string;
    readonly porteeNumerotation: PorteeNumerotation;
    readonly resetAnnuel: boolean;
    /** P-22 : l'état `planifie` est-il utilisé par ce garage ? */
    readonly etatPlanifieActif: boolean;
    /** P-21 : un OR sans RDV est-il autorisé ? Sinon, confirmation `OR_SANS_RDV`. */
    readonly sansRdvAutorise: boolean;
    readonly rdvRetroactifAuto: boolean;
    /** P-29 : `avertir` -> confirmation `VEHICULE_DEUX_OR_OUVERTS`. */
    readonly deuxOrMemeVehicule: PolitiqueDeuxOrMemeVehicule;
  };
  readonly reception: {
    readonly kmEntreeObligatoire: boolean;
    readonly kmSortieObligatoire: boolean;
    readonly signature: PolitiqueSignatureReception;
    readonly plafondDefautCentimes: number;
  };
  readonly travaux: {
    readonly uniteTemps: UniteTemps;
    readonly arrondiPointage: ArrondiPointage;
    readonly chevauchementPointageAutorise: boolean;
    readonly pointageObligatoirePourTerminer: boolean;
    readonly controleQualite: PolitiqueControleQualite;
    readonly dureeMaxPointageHeures: number;
  };
  readonly facturation: {
    readonly multiPayeursAutorise: boolean;
    readonly restitutionAvantPaiement: boolean;
    readonly piecesClientAutorisees: boolean;
    readonly politiqueDemontageRefuse: PolitiqueDemontageRefuse;
    readonly seuilDemontageCentimes: number | null;
    readonly produitsAtelier: {
      readonly mode: ModeProduitsAtelier;
      readonly pourmille: number | null;
      readonly plafondCentimes: number | null;
    };
  };
  readonly documents: {
    readonly langue: PolitiqueLangueDocument;
    readonly mentionSecurite: PolitiqueMentionSecurite;
  };
  readonly vehicule: {
    readonly expertiseAlerteMois: number;
    readonly visibiliteHistoriqueNouveauDetenteur: VisibiliteHistoriqueVehicule;
  };
  readonly planning: {
    readonly noShowSeuilAlerte: number;
    readonly tamponPretMinutes: number;
    readonly rappel: { readonly canal: CanalRappel; readonly joursAvant: number };
  };
  readonly fonctionnalites: {
    readonly facturation: boolean;
    readonly stockPieces: boolean;
    readonly depotPneus: boolean;
    readonly prets: boolean;
  };
  /** Sert l'`ETag` et le contrôle de concurrence du `PATCH`. */
  readonly version: number;
}

/**
 * Paramètres de NIVEAU SITE — greffés sur `/sites/{siteId}` du socle plutôt que dans une famille
 * `/parametrage/sites/{id}` parallèle, qui donnerait deux chemins pour un même site.
 */
export interface ReponseParametresSite {
  readonly siteId: string;
  readonly heureOuverture: string | null;
  readonly heureFermeture: string | null;
  /** P-31 : heure de clôture automatique des pointages ouverts. */
  readonly heureCloturePointage: string | null;
  /**
   * P-20. Vaut **`null`**, jamais `0`, quand la capacité n'est pas saisie : une barre de charge à
   * « — » est honnête, une barre à zéro est un mensonge.
   */
  readonly capaciteHeuresJourCentiemes: number | null;
  readonly joursFermeture: readonly string[];
  readonly version: number;
}

/* ------------------------------------------------------------------ */
/* Référentiels (§7.12)                                                */
/* ------------------------------------------------------------------ */

/** Taux horaire DATÉ. La base interdit deux périodes de validité qui se chevauchent pour un même
 *  code — c'est ce qui rend le taux figé sur une ligne d'OR reproductible (RM-65). */
export interface ReponseTauxHoraire {
  readonly id: string;
  readonly code: string;
  readonly libelle: string;
  readonly montantCentimes: number;
  readonly valideDuLe: string;
  readonly valideAuLe: string | null;
}

/** Prestation du catalogue de forfaits. Les prix sont FIGÉS sur la ligne à sa création (§7.8). */
export interface ReponsePrestation {
  readonly id: string;
  readonly code: string;
  readonly designation: Readonly<Record<Langue, string>>;
  readonly typeLigne: TypeLigneOr;
  readonly tempsBaremeCentiemes: number | null;
  readonly tauxHoraireCode: string | null;
  readonly tauxTvaPourmille: number;
  readonly prixCentimes: number | null;
  readonly actif: boolean;
}

/**
 * `GET /referentiels/transitions?entite=` — LA MACHINE À ÉTATS COMME DONNÉE (§2.2).
 *
 * Corollaire INDISPENSABLE des actions nommées : sans cet endpoint, un client coderait la machine
 * à états en dur et se désynchroniserait au premier changement de paramètre. Le front s'en sert
 * pour griser un bouton, le connecteur pour ne pas tenter l'impossible, l'équipe comme table de
 * vérité unique avec la base.
 */
export interface ReponseTransition {
  readonly entite: string;
  readonly statutDepart: string;
  readonly statutArrivee: string;
  /** Segment d'URL de l'action (`passer-en-controle`), à l'infinitif. */
  readonly action: string;
  /** Droit requis, nomenclature `<module>.<ressource>.<verbe>`. */
  readonly droitRequis: string;
  /** Champs de corps obligatoires pour cette transition. */
  readonly champsObligatoires: readonly string[];
  /** Codes d'erreur métier que cette transition peut renvoyer. */
  readonly codesErreurPossibles: readonly string[];
}

export interface ReponseTransitions {
  readonly transitions: readonly ReponseTransition[];
}

/* ------------------------------------------------------------------ */
/* Entrées d'écriture                                                  */
/* ------------------------------------------------------------------ */

/**
 * `PATCH /parametres-atelier` — modification PARTIELLE et par domaine. `version` et
 * `fonctionnalites` ne sont jamais entrants : le premier est géré par le serveur, le second est
 * un drapeau d'étape, pas un réglage de garage.
 */
export const schemaModificationParametresAtelier = z.object({
  or: z
    .object({
      prefixe: z.string().trim().min(1).max(10).optional(),
      porteeNumerotation: z.enum(PORTEES_NUMEROTATION).optional(),
      resetAnnuel: z.boolean().optional(),
      etatPlanifieActif: z.boolean().optional(),
      sansRdvAutorise: z.boolean().optional(),
      rdvRetroactifAuto: z.boolean().optional(),
      deuxOrMemeVehicule: z.enum(POLITIQUES_DEUX_OR_MEME_VEHICULE).optional(),
    })
    .optional(),
  reception: z
    .object({
      kmEntreeObligatoire: z.boolean().optional(),
      kmSortieObligatoire: z.boolean().optional(),
      signature: z.enum(POLITIQUES_SIGNATURE_RECEPTION).optional(),
      plafondDefautCentimes: schemaCentimesPositif.optional(),
    })
    .optional(),
  travaux: z
    .object({
      uniteTemps: z.enum(UNITES_TEMPS).optional(),
      arrondiPointage: z.enum(ARRONDIS_POINTAGE).optional(),
      chevauchementPointageAutorise: z.boolean().optional(),
      pointageObligatoirePourTerminer: z.boolean().optional(),
      controleQualite: z.enum(POLITIQUES_CONTROLE_QUALITE).optional(),
      dureeMaxPointageHeures: z.number().int().min(1).max(24).optional(),
    })
    .optional(),
  facturation: z
    .object({
      multiPayeursAutorise: z.boolean().optional(),
      restitutionAvantPaiement: z.boolean().optional(),
      piecesClientAutorisees: z.boolean().optional(),
      politiqueDemontageRefuse: z.enum(POLITIQUES_DEMONTAGE_REFUSE).optional(),
      seuilDemontageCentimes: schemaCentimesPositif.nullish(),
      produitsAtelier: z
        .object({
          mode: z.enum(MODES_PRODUITS_ATELIER),
          pourmille: schemaPourmille.nullish(),
          plafondCentimes: schemaCentimesPositif.nullish(),
        })
        .optional(),
    })
    .optional(),
  documents: z
    .object({
      langue: z.enum(POLITIQUES_LANGUE_DOCUMENT).optional(),
      mentionSecurite: z.enum(POLITIQUES_MENTION_SECURITE).optional(),
    })
    .optional(),
  vehicule: z
    .object({
      expertiseAlerteMois: z.number().int().min(0).max(24).optional(),
      visibiliteHistoriqueNouveauDetenteur: z.enum(VISIBILITES_HISTORIQUE_VEHICULE).optional(),
    })
    .optional(),
  planning: z
    .object({
      noShowSeuilAlerte: z.number().int().min(0).max(20).optional(),
      tamponPretMinutes: z.number().int().min(0).max(1440).optional(),
      rappel: z
        .object({
          canal: z.enum(CANAUX_RAPPEL),
          joursAvant: z.number().int().min(0).max(30),
        })
        .optional(),
    })
    .optional(),
});

export const schemaModificationParametresSite = z.object({
  heureOuverture: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  heureFermeture: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  heureCloturePointage: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  /** `null` = non saisie. Ne jamais confondre avec `0` (voir `ReponseParametresSite`). */
  capaciteHeuresJourCentiemes: schemaCentiemes.nullish(),
  joursFermeture: z.array(schemaDateJour).max(400).optional(),
});

export const schemaCreationTauxHoraire = z.object({
  code: z.string().trim().min(1).max(40),
  libelle: schemaTexteCourt,
  montantCentimes: schemaCentimesPositif,
  valideDuLe: schemaDateJour,
  valideAuLe: schemaDateJour.nullish(),
});

export const schemaModificationTauxHoraire = schemaCreationTauxHoraire.partial().omit({ code: true });

export const schemaCreationPrestation = z.object({
  code: z.string().trim().min(1).max(40),
  designationFr: schemaTexteCourt,
  designationDe: schemaTexteCourt.nullish(),
  designationIt: schemaTexteCourt.nullish(),
  typeLigne: z.enum(TYPES_LIGNE_OR),
  tempsBaremeCentiemes: schemaCentiemes.nullish(),
  tauxHoraireCode: z.string().trim().max(40).nullish(),
  tauxTvaPourmille: schemaPourmille.default(81),
  prixCentimes: schemaCentimesPositif.nullish(),
});

export const schemaModificationPrestation = schemaCreationPrestation
  .partial()
  .omit({ code: true })
  .extend({ actif: z.boolean().optional() });

export const schemaParametresTransitions = z.object({
  entite: z.enum(ENTITES_A_TRANSITIONS),
});

export type EntreeModificationParametresAtelier = z.infer<typeof schemaModificationParametresAtelier>;
export type EntreeModificationParametresSite = z.infer<typeof schemaModificationParametresSite>;
export type EntreeCreationTauxHoraire = z.infer<typeof schemaCreationTauxHoraire>;
export type EntreeCreationPrestation = z.infer<typeof schemaCreationPrestation>;
export type ParametresTransitions = z.infer<typeof schemaParametresTransitions>;
