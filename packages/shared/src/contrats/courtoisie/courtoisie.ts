import { z } from 'zod';

import {
  schemaHorodatage,
  schemaIdentifiant,
  schemaKilometrage,
  schemaTexteCourt,
  schemaTexteLong,
} from '../atelier/primitives';

/**
 * Véhicules de courtoisie (prêt) — parc du garage + prêts aux clients.
 *
 * Tables : `vehicule_courtoisie`, `pret_courtoisie` (migration 0081). Les enums Postgres
 * `etat_vehicule_courtoisie` et `statut_pret_courtoisie` existent depuis 0005 ; seules les valeurs
 * ci-dessous sont utilisées.
 */

/** Indisponibilité ADMINISTRATIVE d'un véhicule du parc. « Prêté » se déduit des prêts. */
export const ETATS_STOCKES_VEHICULE_COURTOISIE = [
  'disponible',
  'en_entretien',
  'hors_service',
] as const;
export type EtatStockeVehiculeCourtoisie = (typeof ETATS_STOCKES_VEHICULE_COURTOISIE)[number];

/** Statuts de prêt effectivement utilisés : à venir, prêté, rendu, annulé. */
export const STATUTS_PRET_COURTOISIE_UTILISES = [
  'reserve',
  'en_cours',
  'retourne',
  'annule',
] as const;
export type StatutPretCourtoisieUtilise = (typeof STATUTS_PRET_COURTOISIE_UTILISES)[number];

/** Disponibilité d'un véhicule sur la période demandée. */
export const DISPONIBILITES_COURTOISIE = ['libre', 'occupe', 'indisponible'] as const;
export type DisponibiliteCourtoisie = (typeof DISPONIBILITES_COURTOISIE)[number];

/* ------------------------------ entrées ------------------------------ */

export const schemaCreationVehiculeCourtoisie = z
  .object({
    designation: schemaTexteCourt,
    plaque: schemaTexteCourt.optional(),
    kilometrage: schemaKilometrage.optional(),
    note: schemaTexteLong.optional(),
  })
  .strict();

export const schemaModificationVehiculeCourtoisie = z
  .object({
    designation: schemaTexteCourt.optional(),
    plaque: schemaTexteCourt.nullish(),
    kilometrage: schemaKilometrage.nullish(),
    etat: z.enum(ETATS_STOCKES_VEHICULE_COURTOISIE).optional(),
    note: schemaTexteLong.nullish(),
  })
  .strict();

/** `GET /courtoisie/vehicules?du=&au=` — période testée (défaut : maintenant, une minute). */
export const schemaFiltresVehiculesCourtoisie = z
  .object({
    du: schemaHorodatage.optional(),
    au: schemaHorodatage.optional(),
  })
  .strict();

export const schemaCreationPretCourtoisie = z
  .object({
    vehiculeCourtoisieId: schemaIdentifiant,
    clientId: schemaIdentifiant,
    ordreReparationId: schemaIdentifiant.optional(),
    rendezVousId: schemaIdentifiant.optional(),
    debutLe: schemaHorodatage,
    finPrevueLe: schemaHorodatage,
    kmDepart: schemaKilometrage.optional(),
    note: schemaTexteLong.optional(),
  })
  .strict();

export const schemaRetourPretCourtoisie = z
  .object({
    kmRetour: schemaKilometrage.optional(),
    renduLe: schemaHorodatage.optional(),
  })
  .strict();

export const schemaFiltresPretsCourtoisie = z
  .object({
    clientId: schemaIdentifiant.optional(),
    ordreReparationId: schemaIdentifiant.optional(),
    vehiculeCourtoisieId: schemaIdentifiant.optional(),
    statut: z.enum(STATUTS_PRET_COURTOISIE_UTILISES).optional(),
  })
  .strict();

export type EntreeCreationVehiculeCourtoisie = z.infer<typeof schemaCreationVehiculeCourtoisie>;
export type EntreeModificationVehiculeCourtoisie = z.infer<
  typeof schemaModificationVehiculeCourtoisie
>;
export type FiltresVehiculesCourtoisie = z.infer<typeof schemaFiltresVehiculesCourtoisie>;
export type EntreeCreationPretCourtoisie = z.infer<typeof schemaCreationPretCourtoisie>;
export type EntreeRetourPretCourtoisie = z.infer<typeof schemaRetourPretCourtoisie>;
export type FiltresPretsCourtoisie = z.infer<typeof schemaFiltresPretsCourtoisie>;

/* ------------------------------ réponses ------------------------------ */

export interface ReponsePretCourtoisie {
  readonly id: string;
  readonly vehiculeCourtoisieId: string;
  readonly vehiculeDesignation: string;
  readonly vehiculePlaque: string | null;
  readonly clientId: string;
  readonly clientNom: string;
  readonly ordreReparationId: string | null;
  readonly rendezVousId: string | null;
  readonly debutLe: string;
  readonly finPrevueLe: string;
  readonly renduLe: string | null;
  readonly kmDepart: number | null;
  readonly kmRetour: number | null;
  readonly statut: StatutPretCourtoisieUtilise;
  /** Prêt `en_cours` dont la fin prévue est dépassée : la voiture n'est pas revenue. */
  readonly enRetard: boolean;
  readonly note: string | null;
  readonly creeLe: string;
}

export interface ReponseVehiculeCourtoisie {
  readonly id: string;
  readonly designation: string;
  readonly plaque: string | null;
  readonly kilometrage: number | null;
  readonly etat: EtatStockeVehiculeCourtoisie;
  readonly note: string | null;
  /** Disponibilité sur la période demandée (`du`/`au`). */
  readonly disponibilite: DisponibiliteCourtoisie;
  /** Prêt qui occupe le véhicule sur la période (null si libre ou indisponible). */
  readonly pretSurPeriode: ReponsePretCourtoisie | null;
}

export interface ReponseListeVehiculesCourtoisie {
  readonly du: string;
  readonly au: string;
  readonly vehicules: readonly ReponseVehiculeCourtoisie[];
}
