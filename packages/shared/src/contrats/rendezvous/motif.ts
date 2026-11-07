import { z } from 'zod';

import { schemaTexteCourt } from '../atelier/primitives';

/**
 * Écriture du référentiel des motifs de rendez-vous (`POST /motifs-rendez-vous`,
 * `PATCH /motifs-rendez-vous/{id}`). La lecture (`ReponseMotifRendezVous`) vit dans
 * `rendez-vous.ts`.
 *
 * Pas de suppression : un motif référencé par un rendez-vous ne peut pas disparaître (clé
 * étrangère `rendez_vous_fk_motif`, et `dfa_app` n'a aucun `DELETE` sur la table). Le garage
 * désactive le motif (`actif: false`) : il disparaît des nouvelles prises de rendez-vous mais
 * reste lisible sur l'historique.
 */

/** Code technique stable : majuscules, chiffres, `-` et `_` (ex. `EXPERTISE-MFK`). */
export const schemaCodeMotifRendezVous = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{0,39}$/, 'Code de 1 à 40 caractères : A-Z, 0-9, « - » et « _ ».');

const schemaDureeMinutes = z.number().int().min(1).max(1440);
const schemaHeuresCentiemes = z.number().int().min(0).max(100000);
const schemaLibelleTraduit = z.string().trim().min(1).max(200).nullable();

export const schemaCreationMotifRendezVous = z.object({
  code: schemaCodeMotifRendezVous,
  libelleFr: schemaTexteCourt,
  libelleDe: schemaLibelleTraduit.optional(),
  libelleIt: schemaLibelleTraduit.optional(),
  /** RV-02 : créneau réel (minutes). */
  dureeDefautMinutes: schemaDureeMinutes.nullable().optional(),
  /** RV-01 : capacité de journée (centièmes d'heure). */
  heuresAtelierDefautCentiemes: schemaHeuresCentiemes.nullable().optional(),
  actif: z.boolean().optional(),
});

/** Le `code` est immuable (il est cité dans les documents et les statistiques). */
export const schemaModificationMotifRendezVous = z.object({
  libelleFr: schemaTexteCourt.optional(),
  libelleDe: schemaLibelleTraduit.optional(),
  libelleIt: schemaLibelleTraduit.optional(),
  dureeDefautMinutes: schemaDureeMinutes.nullable().optional(),
  heuresAtelierDefautCentiemes: schemaHeuresCentiemes.nullable().optional(),
  actif: z.boolean().optional(),
});

export type EntreeCreationMotifRendezVous = z.infer<typeof schemaCreationMotifRendezVous>;
export type EntreeModificationMotifRendezVous = z.infer<typeof schemaModificationMotifRendezVous>;
