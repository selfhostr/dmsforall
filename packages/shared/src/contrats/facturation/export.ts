import { z } from 'zod';

import { CIBLES_EXPORT, MODES_GRANULARITE_EXPORT, type CibleExport } from './enums';
import { schemaDateJour, schemaIdentifiant } from '../atelier/primitives';

/**
 * Export fiduciaire (§6 du modèle documentaire, `RF-101` → `RF-113`) : le cœur produit des
 * écritures, les adaptateurs les sérialisent (`MD-84`). Les interfaces `LigneEcriture` / `Ecriture`
 * / `AccountingExporter` sont reprises ICI, dans le contrat partagé, et non dans un module
 * `apps/api` : c'est la couche connecteurs (`ARCHITECTURE §5`) — un futur adaptateur externe (ou un
 * test de contrat comme `CF-04`) doit pouvoir les importer sans dépendre du backend NestJS.
 *
 * Ce fichier pose les TYPES. Il ne fixe pas encore le contrat HTTP complet de déclenchement d'un
 * export (mapping comptable, bascule de fiduciaire) — hors du périmètre demandé pour ce lot ; les
 * codes d'erreur qui s'y rattachent (`EXPORT_*`) sont déclarés par avance dans `CODES_ERREUR`, même
 * patron que `RDV_*` déclarés au lot 1 et émis au lot 4.
 */

/** Une ligne d'écriture comptable. `montantCentimes` est toujours positif — c'est `sens` qui porte
 *  le signe (`MD-84`). Aucun adaptateur ne recalcule ce montant. */
export interface LigneEcritureExport {
  /** Compte du plan comptable DU TENANT, résolu par le mapping (`MD-86`) — jamais un compte en dur. */
  readonly compte: string;
  readonly sens: 'debit' | 'credit';
  readonly montantCentimes: number;
  /** Code TVA DE LA CIBLE (`mapping_code_tva`, `MD-86`), jamais un taux brut. `null` si la ligne ne
   *  porte pas de TVA. */
  readonly codeTva: string | null;
  readonly tauxPourmille: number | null;
  readonly baseTvaCentimes: number | null;
  readonly libelle: string;
}

/** Une écriture équilibrée (`Σ débits = Σ crédits`, vérifié en `bigint` avant l'appel à
 *  l'adaptateur — `MD-85`). `reference` est le numéro AFFICHÉ du document ou l'identifiant du
 *  paiement : c'est ce que la fiduciaire tape pour retrouver la pièce en trente secondes (`RF-108`). */
export interface EcritureExport {
  readonly reference: string;
  readonly date: string;
  readonly libelle: string;
  /** Code du site — `null` si le tenant n'utilise pas de centre de charge. */
  readonly centreDeCharge: string | null;
  readonly lignes: readonly LigneEcritureExport[];
  /** Traçabilité retour vers DFA — `null` pour une écriture qui ne provient pas d'un document
   *  (rare : correction manuelle exceptionnelle, tracée par ailleurs). */
  readonly documentId: string | null;
}

/** Capacités déclarées par un adaptateur — permet à l'écran d'export de désactiver ce qu'une
 *  cible ne sait pas faire plutôt que d'échouer à l'envoi. */
export interface CapacitesExport {
  readonly multiDevise: boolean;
  readonly centresDeCharge: boolean;
  readonly codesTva: boolean;
  readonly granularite: readonly ('detaille' | 'agrege')[];
}

/**
 * Contrat que TOUT adaptateur de cible implémente (`MD-84`). Les quatre — trois pour le pilote,
 * `winbiz` / `ireach` / `csv` (voir l'écart signalé sur `CIBLES_EXPORT`) — reçoivent la MÊME liste
 * d'écritures, au format de sérialisation près (`CF-04`).
 */
export interface AccountingExporter {
  readonly cible: CibleExport;
  readonly capacites: CapacitesExport;
}

/* ------------------------------------------------------------------ */
/* Déclenchement (forme minimale — le contrat HTTP complet reste à     */
/* concevoir avec l'équipe API au moment de l'implémentation)            */
/* ------------------------------------------------------------------ */

/**
 * `POST /exports-fiduciaires` — `Idempotency-Key` recommandée (pas encore qualifiée « obligatoire
 * » : un export n'est pas une création facturable au sens de la consigne produit, mais un rejeu
 * accidentel ne doit pas produire un second lot). La continuité de numérotation est vérifiée AVANT
 * l'appel à l'adaptateur, de façon bloquante (`RF-28`, `RF-105`) : un trou ne part jamais chez la
 * fiduciaire — voir `EXPORT_TROU_NUMEROTATION`.
 */
export const schemaLancerExport = z
  .object({
    cible: z.enum(CIBLES_EXPORT),
    granularite: z.enum(MODES_GRANULARITE_EXPORT).optional(),
    periodeDu: schemaDateJour,
    periodeAu: schemaDateJour,
    siteId: schemaIdentifiant.optional(),
  })
  .strict();
export type EntreeLancerExport = z.infer<typeof schemaLancerExport>;
