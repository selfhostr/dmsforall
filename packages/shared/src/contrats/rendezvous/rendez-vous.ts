import { z } from 'zod';

import type { ClientResume } from '../atelier/client';
import {
  UNITES_DISTANCE,
  TYPES_ORDRE_REPARATION,
  type TypeOrdreReparation,
} from '../atelier/enums';
import { schemaConfirmations, type ReponseAvecAvertissements } from '../atelier/avertissement';
import {
  schemaDateJour,
  schemaIdentifiant,
  schemaKilometrage,
  schemaMotif,
  schemaTexteCourt,
  schemaTexteLong,
} from '../atelier/primitives';
import type { VehiculeResume } from '../atelier/vehicule';
import { schemaParametresPage } from '../pagination';
import {
  MOMENTS_RENDEZ_VOUS,
  STATUTS_RDV,
  type EtatCapaciteRendezVous,
  type MomentRendezVous,
  type OrigineRdv,
  type StatutRdv,
} from './enums';

/**
 * Contrat du domaine rendez-vous d'atelier (lot RDV-1, `docs/conception-rendez-vous-metier.md` /
 * `docs/conception-rendez-vous-donnees.md`). GELÉ par l'orchestrateur pour les sept endpoints
 * ci-dessous — l'agent front s'appuie dessus, aucun écart sans le signaler.
 *
 * DÉCISION STRUCTURANTE reprise du domaine `atelier` : les changements d'état (arrivée, absence,
 * annulation) sont des ACTIONS NOMMÉES (`POST .../arrivee`), jamais un `PATCH {"statut": ...}` —
 * chaque geste porte son propre droit et ses propres codes d'erreur (`RDV_TRANSITION_INTERDITE`,
 * `RDV_ANNULATION_IMPOSSIBLE`, déjà déclarés dans `contrats/probleme.ts`).
 */

/* ------------------------------------------------------------------ */
/* Motif de rendez-vous (référentiel `motif_rendez_vous`, déjà en base) */
/* ------------------------------------------------------------------ */

/**
 * `GET /motifs-rendez-vous` — catalogue paramétrable par garage (RV-01/RV-02) : porte la durée
 * standard qui fixe si le motif consomme de la capacité du jour (`heuresAtelierDefautCentiemes`,
 * cas par défaut) ou réserve un vrai créneau (`dureeDefautMinutes`, motifs contraints par un
 * tiers — expertise MFK, essai routier, remorquage). Les deux durées sont mutuellement
 * informatives, jamais combinées par le client : c'est le serveur qui choisit laquelle utiliser
 * pour amorcer une estimation (voir `EntreeCreationRendezVous.dureeEstimeeMinutes`).
 */
export interface ReponseMotifRendezVous {
  readonly id: string;
  readonly code: string;
  readonly libelleFr: string;
  readonly libelleDe: string | null;
  readonly libelleIt: string | null;
  /** RV-02 : non nul seulement pour un motif à créneau réel. */
  readonly dureeDefautMinutes: number | null;
  /** RV-01 : non nul seulement pour un motif qui consomme de la capacité de journée. */
  readonly heuresAtelierDefautCentiemes: number | null;
  readonly actif: boolean;
}

/* ------------------------------------------------------------------ */
/* Ressource rendez-vous                                               */
/* ------------------------------------------------------------------ */

/**
 * `GET /rendez-vous/{id}` et enveloppe de toute écriture — document complet, même doctrine que
 * `ReponseOrdreReparation` (§ atelier) : après une action, l'appelant relit le rendez-vous entier
 * dans l'enveloppe, jamais un second aller-retour.
 */
export interface ReponseRendezVous {
  readonly id: string;
  readonly siteId: string;
  readonly client: ClientResume;
  /** Souvent connu, pas toujours (§3 conception données) — obligatoire avant de devenir un OR. */
  readonly vehicule: VehiculeResume | null;
  readonly type: TypeOrdreReparation;
  /**
   * Renvoi au référentiel `motif_rendez_vous`, JAMAIS un texte libre (arbitrage @laupernoe #2,
   * `migrations/0052` §B.2) : c'est lui qui porte la durée par défaut, donc la capacité
   * consommée. Embarqué en résumé (comme `client`/`vehicule`) pour éviter un aller-retour
   * supplémentaire vers `GET /motifs-rendez-vous` à chaque affichage d'un rendez-vous.
   */
  readonly motif: ReponseMotifRendezVous;
  /** Verbatim SECONDAIRE, optionnel, jamais un substitut au motif catalogué (§B.2). */
  readonly commentaire: string | null;
  readonly dateLe: string;
  readonly moment: MomentRendezVous;
  /** `null` = moment respecté, heure non fixée — jamais confondu avec `toute_journee`. */
  readonly heureSouhaitee: string | null;
  /** Figée à la création depuis le motif choisi, modifiable ensuite (§B.2) — jamais `null` : la
   *  capacité affichée ne doit jamais rencontrer de trou. */
  readonly dureeEstimeeMinutes: number;
  readonly statut: StatutRdv;
  readonly motifAnnulation: string | null;
  readonly origine: OrigineRdv;
  readonly confirmeLe: string;
  readonly honoreLe: string | null;
  /** Arbitrage @laupernoe : le statut terminal se nomme `absent` (pas `no_show`), l'horodatage suit. */
  readonly absentConstateLe: string | null;
  readonly annuleLe: string | null;
  /** L'OR déjà créé par ce RDV (mode « OR anticipé », RV-10) — `null` tant qu'aucun n'existe.
   *  Résolu par requête inverse (`ordre_reparation.rendez_vous_id`), jamais une colonne stockée
   *  ici : la conception données fixe le sens unique de la relation, RDV → OR jamais l'inverse. */
  readonly ordreReparationId: string | null;
  readonly creeParId: string | null;
  readonly creeLe: string;
  readonly modifieLe: string;
}

/* ------------------------------------------------------------------ */
/* Filtres, tris                                                       */
/* ------------------------------------------------------------------ */

export const TRIS_RENDEZ_VOUS = ['creeLe:desc', 'creeLe:asc'] as const;
export const TRI_DEFAUT_RENDEZ_VOUS = 'creeLe:desc';

/** `GET /rendez-vous?du=&au=&siteId=` — bornes de date INCLUSES, convention `xDu`/`xAu` de l'API. */
export const schemaFiltresRendezVous = z.object({
  du: schemaDateJour,
  au: schemaDateJour,
  siteId: schemaIdentifiant.optional(),
  statut: z.enum(STATUTS_RDV).optional(),
  clientId: schemaIdentifiant.optional(),
  /** Rendez-vous d'un véhicule précis — ex. fiche véhicule (« prochains rendez-vous de CE
   *  véhicule »), indépendant du détenteur courant (véhicule sans détenteur, ou détenteur avec
   *  plusieurs véhicules). */
  vehiculeId: schemaIdentifiant.optional(),
  tri: z.enum(TRIS_RENDEZ_VOUS).default(TRI_DEFAUT_RENDEZ_VOUS),
});
export type FiltresRendezVous = z.infer<typeof schemaFiltresRendezVous>;

export const schemaParametresPageRendezVous = schemaParametresPage;

/* ------------------------------------------------------------------ */
/* Capacité — `GET /rendez-vous/capacite`                              */
/* ------------------------------------------------------------------ */

/** `?du=&au=&siteId=` — mêmes bornes que la liste, `siteId` OBLIGATOIRE ici (RV-06 : la capacité
 *  se calcule site par site, jamais agrégée tenant). */
export const schemaFiltresCapaciteRendezVous = z.object({
  du: schemaDateJour,
  au: schemaDateJour,
  siteId: schemaIdentifiant,
});
export type FiltresCapaciteRendezVous = z.infer<typeof schemaFiltresCapaciteRendezVous>;

/**
 * Une entrée par (date, moment) de la période demandée. RV-08 : `capaciteMinutes` est `null` sur
 * un site qui n'a jamais paramétré `parametreSite.capaciteHeuresJourCentiemes` — rendu comme
 * `etat: 'non_definie'`, JAMAIS `0` ni `'disponible'`. Absence de capacité connue ≠ capacité nulle
 * ≠ capacité disponible : trois rendus distincts, jamais partagés (règle maison, quatre défauts
 * produits cette semaine par leur confusion).
 */
export interface CapaciteJourRendezVous {
  readonly dateLe: string;
  readonly moment: MomentRendezVous;
  readonly minutesOccupees: number;
  readonly capaciteMinutes: number | null;
  readonly etat: EtatCapaciteRendezVous;
}

export interface ReponseCapaciteRendezVous {
  readonly siteId: string;
  readonly jours: readonly CapaciteJourRendezVous[];
}

/* ------------------------------------------------------------------ */
/* Écritures — création, déplacement                                   */
/* ------------------------------------------------------------------ */

/**
 * `POST /rendez-vous` — `Idempotency-Key` OBLIGATOIRE (même doctrine que `POST
 * /ordres-reparation`, RM-49 : un rejeu ne doit rien créer deux fois).
 *
 * `motifId` est OBLIGATOIRE (arbitrage @laupernoe #2, `migrations/0052` §B.2) : renvoi au référentiel
 * `motif_rendez_vous`, jamais un texte libre — c'est lui qui porte la durée estimée par défaut,
 * donc la capacité consommée (RV-01/RV-02). `dureeEstimeeMinutes` permet au réceptionniste
 * d'ajuster l'estimation du motif pour CE rendez-vous précis (« on bloque 45 minutes », §1
 * conception données) ; absent, le serveur retombe sur la durée par défaut du motif — jamais
 * `null` en base (`rendez_vous.duree_estimee_minutes` est `NOT NULL`).
 */
export const schemaCreationRendezVous = z
  .object({
    siteId: schemaIdentifiant,
    clientId: schemaIdentifiant,
    vehiculeId: schemaIdentifiant.nullish(),
    motifId: schemaIdentifiant,
    type: z.enum(TYPES_ORDRE_REPARATION),
    /** Verbatim SECONDAIRE du client au téléphone (§2 métier), jamais un substitut au motif. */
    commentaire: schemaTexteLong.nullish(),
    dateLe: schemaDateJour,
    moment: z.enum(MOMENTS_RENDEZ_VOUS),
    heureSouhaitee: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
      .nullish(),
    dureeEstimeeMinutes: z.number().int().min(1).max(1440).nullish(),
  })
  .extend(schemaConfirmations.shape);
export type EntreeCreationRendezVous = z.infer<typeof schemaCreationRendezVous>;

/**
 * `PATCH /rendez-vous/{id}` — déplacer (date/moment/heure) ou corriger un rendez-vous encore
 * `confirme`. RV-16 : un déplacement n'est jamais un changement d'état — le `statut` reste
 * `confirme`, l'avant/après est journalisé (`audit_atelier`), jamais un champ dédié.
 */
export const schemaModificationRendezVous = z
  .object({
    dateLe: schemaDateJour.optional(),
    moment: z.enum(MOMENTS_RENDEZ_VOUS).optional(),
    heureSouhaitee: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
      .nullish(),
    dureeEstimeeMinutes: z.number().int().min(1).max(1440).optional(),
    vehiculeId: schemaIdentifiant.nullish(),
    commentaire: schemaTexteLong.nullish(),
  })
  .extend(schemaConfirmations.shape);
export type EntreeModificationRendezVous = z.infer<typeof schemaModificationRendezVous>;

/* ------------------------------------------------------------------ */
/* Écritures — actions de transition (§7 métier)                       */
/* ------------------------------------------------------------------ */

/**
 * `POST /rendez-vous/{id}/arrivee` — RV-18 : `honore` n'est JAMAIS déclaré manuellement, c'est un
 * effet de bord de la création/réception de l'OR lié. Réutilise le geste métier déjà câblé côté
 * atelier (T-03, kilométrage d'entrée) : même corps que `EntreeActionReceptionner`, dupliqué ici
 * pour que ce contrat reste autonome (le domaine rendez-vous ne dépend pas du gel du domaine
 * atelier pour ses propres évolutions).
 *
 * `vehiculeId` : couvre RV-28 (véhicule annoncé au RDV ≠ véhicule présenté) — le RDV garde son
 * véhicule d'origine dans son historique, l'OR porte la réalité du jour.
 */
export const schemaActionArriveeRendezVous = z
  .object({
    kilometrageEntree: schemaKilometrage,
    unite: z.enum(UNITES_DISTANCE).default('km'),
    vehiculeId: schemaIdentifiant.nullish(),
    conducteurPresentNom: schemaTexteCourt.nullish(),
    signatureDifferee: z.boolean().default(false),
    motifDifferee: schemaMotif.optional(),
  })
  .extend(schemaConfirmations.shape)
  .refine((v) => !v.signatureDifferee || Boolean(v.motifDifferee), {
    message: 'Une signature différée exige un motif.',
    path: ['motifDifferee'],
  });
export type EntreeActionArriveeRendezVous = z.infer<typeof schemaActionArriveeRendezVous>;

/** `POST /rendez-vous/{id}/absence` — RV-24 : constat manuel qu'un client ne s'est pas présenté.
 *  Pas de motif : un no-show n'a par définition aucune explication connue du garage. */
export const schemaActionAbsenceRendezVous = z.object({}).extend(schemaConfirmations.shape);
export type EntreeActionAbsenceRendezVous = z.infer<typeof schemaActionAbsenceRendezVous>;

/** `POST /rendez-vous/{id}/annuler` — motif OBLIGATOIRE (§7 : « action explicite, jamais
 *  silencieuse »). */
export const schemaActionAnnulerRendezVous = z.object({ motif: schemaMotif });
export type EntreeActionAnnulerRendezVous = z.infer<typeof schemaActionAnnulerRendezVous>;

/* ------------------------------------------------------------------ */
/* Enveloppes                                                           */
/* ------------------------------------------------------------------ */

export type ReponseRendezVousAvecAvertissements = ReponseAvecAvertissements<ReponseRendezVous>;
