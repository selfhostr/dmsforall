import { z } from 'zod';

import { DEVISES_FACTURATION } from './enums';

/**
 * Primitives PROPRES à la facturation. Les primitives génériques déjà posées par l'étape 1
 * (`schemaCentimes`, `schemaIdentifiant`, `schemaDateJour`, `schemaHorodatage`, `schemaTexteCourt`,
 * `schemaTexteLong`, `schemaMotif`, `schemaPourmille`, `schemaListeIdentifiants`…) sont RÉUTILISÉES
 * par import direct depuis `../atelier/primitives` dans les fichiers qui en ont besoin — jamais
 * redéfinies ici, et jamais réexportées depuis ce module : un `export *` dupliquerait leur nom dans
 * le barrel `@dfa/shared` et rendrait l'export ambigu (silencieusement omis par TypeScript).
 */

/** Prix ou montant de ligne, TOUJOURS TVA comprise (décision de conception, non rouverte — voir
 *  `ModeCalculTva` dans `enums.ts`). Signé : une ligne `repartition` ou `acompte_deduit` porte un
 *  montant négatif. Jamais de flottant — `CONTRIBUTING.md`. */
export const schemaCentimesTtc = z.number().int();

/** Montant de ligne, TTC, positif ou nul — prix affiché, quantité positive. */
export const schemaCentimesTtcPositif = z.number().int().min(0);

/** Exercice comptable — année réelle de `date_document` (`MD-27`), distincte de `annee` du
 *  compteur qui peut valoir `0` (numérotation pluriannuelle, `P-01`). */
export const schemaExercice = z.number().int().min(2000).max(2100);

export const schemaDeviseFacturation = z.enum(DEVISES_FACTURATION).default('CHF');

/**
 * Quantité en millièmes d'unité (suffixe `…Millieme`), identique à `schemaQuantiteMillieme` de
 * l'étape 1 mais bornée à `1` minimum : une ligne de document ne porte jamais de quantité nulle ou
 * négative — un montant négatif (avoir, répartition) passe par le PRIX signé, pas par la quantité.
 */
export const schemaQuantiteLigneDocument = z.number().int().min(1);
