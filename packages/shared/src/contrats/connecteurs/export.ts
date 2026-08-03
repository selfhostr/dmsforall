import { z } from 'zod';

import { ACTIONS_EXPORT_CONNECTEUR, NATURES_EXPORT_CONNECTEUR } from './enums';
import { schemaIdentifiant } from '../atelier/primitives';
import type { ReponseExecutionConnecteur } from './execution';

/**
 * Mécanisme GÉNÉRIQUE d'export — priorité 2 du brief, deuxième forme du même mécanisme que
 * `import.ts`.
 *
 * PAS l'export fiduciaire (`POST /exports-fiduciaires`, déjà livré, `contrats/facturation/
 * export.ts`, `AccountingExporter`) — `RC-51` : ne pas dupliquer le principe d'écriture neutre déjà
 * acquis, seul l'adaptateur de sérialisation change d'une cible à l'autre. Ce fichier couvre
 * l'AUTRE export déjà pleinement spécifié : les annonces véhicules (`RC-40` → `RC-46`).
 */

/**
 * `POST /connecteurs/activations/{id}/exports` — `Idempotency-Key` OBLIGATOIRE (`RC-46` :
 * « publier deux fois la même annonce ne doit jamais produire un doublon visible »).
 *
 * IDEMPOTENCE DE FOND, au-delà de l'en-tête (`CC-04`) : la DERNIÈRE valeur pour un
 * `(connecteurActivationId, objetId)` donné doit gagner, et une seule mise à jour doit
 * effectivement partir vers le tiers — pas une par appel intermédiaire. Ce contrat pose l'action
 * demandée ; le REGROUPEMENT d'exécutions `en_attente` concurrentes sur le même objet
 * (annuler/remplacer plutôt qu'empiler) est un détail d'ORDONNANCEMENT hors du périmètre de ce
 * fichier — à porter par expert-nestjs (file BullMQ avec clé de regroupement
 * `(connecteurActivationId, objetType, objetId)`).
 */
export const schemaLancerExportConnecteur = z.object({
  nature: z.enum(NATURES_EXPORT_CONNECTEUR),
  action: z.enum(ACTIONS_EXPORT_CONNECTEUR),
  /** L'objet métier concerné (ex. l'identifiant d'un véhicule en stock, `RV-05`/`RV-09`) — jamais
   *  son contenu : le worker relit l'objet à jour au moment de l'envoi, ce contrat ne transporte
   *  aucune donnée métier dupliquée qui pourrait devenir périmée entre la mise en file et
   *  l'exécution (`RC-40` : DFA reste la source de vérité). */
  objetId: schemaIdentifiant,
});
export type EntreeLancerExportConnecteur = z.infer<typeof schemaLancerExportConnecteur>;

export interface ReponseLancerExportConnecteur {
  readonly execution: ReponseExecutionConnecteur;
}

/**
 * Descripteur minimal que tout adaptateur `ListingPublisher` (`ARCHITECTURE.md` §5,
 * `NOMS_INTERFACE_CONNECTEUR`) déclare — même rôle que `CapacitesExport`/`AccountingExporter`
 * (`contrats/facturation/export.ts`) pour les exports comptables : ce que le cœur peut demander à
 * cet adaptateur sans connaître sa forme exacte, pour désactiver côté écran ce qu'une cible ne sait
 * pas faire plutôt que d'échouer à l'envoi.
 */
export interface CapacitesListingPublisher {
  /** L'adaptateur sait transmettre les photos du véhicule (`RC-44`) en plus des champs texte. */
  readonly photos: boolean;
  /** L'adaptateur traite le retrait en PRIORITÉ, hors de la file d'attente standard (`RC-43`) —
   *  `false` signale à l'écran qu'un retrait peut prendre le même délai qu'une publication, ce qui
   *  est le cas dangereux à surveiller (`CC-03`). */
  readonly retraitPrioritaire: boolean;
}

export interface DeclarationListingPublisher {
  readonly typeConnecteurCode: string;
  readonly capacites: CapacitesListingPublisher;
}
