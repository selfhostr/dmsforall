import { z } from 'zod';

import { OPERATIONS_CONNECTEUR, type OperationConnecteur } from './enums';
import { schemaExpressionCron } from './primitives';
import { schemaParametresPage } from '../pagination';
import { TYPES_EVENEMENT_METIER, type TypeEvenementMetier } from '../atelier/evenement';

/**
 * Configuration du déclenchement — priorité 3 du brief, exactement les trois formes de
 * `TYPES_DECLENCHEMENT_CONNECTEUR` (`enums.ts`) :
 *  - `manuel` : AUCUNE configuration ici — l'appel direct `POST .../imports`/`.../exports`
 *    (`import.ts`/`export.ts`) suffit, il n'y a rien à déclarer par avance.
 *  - `planifie` : une expression cron + un fuseau (`PC-05` : fréquence de synchronisation,
 *    paramétrable PAR CONNECTEUR).
 *  - `evenement` : un type d'événement métier DÉJÀ catalogué déclenche l'exécution.
 *
 * RÉUTILISATION DÉLIBÉRÉE du catalogue `TYPES_EVENEMENT_METIER`
 * (`contrats/atelier/evenement.ts`), le même que celui des abonnements webhook (`webhook.ts`) :
 * c'est le MÊME fait qui se produit (« véhicule passé à `vendu` », « facture émise ») — seule la
 * LIVRAISON diffère (mise en file interne d'une exécution vs envoi HTTP signé à un tiers). Le
 * exemple canonique de la spécification est `RC-40`/`RC-43` : le passage du véhicule à `reserve`
 * déclenche le retrait PRIORITAIRE de l'annonce (`export.ts::ACTIONS_EXPORT_CONNECTEUR`).
 */

export const schemaCreationDeclencheurPlanifie = z.object({
  type: z.literal('planifie'),
  operation: z.enum(OPERATIONS_CONNECTEUR),
  /** Sous-catégorie (`NatureImportConnecteur` | `NatureExportConnecteur`) — typée `string` ici,
   *  même raison que `ReponseExecutionConnecteur.nature`. */
  nature: z.string().trim().min(1).max(60),
  expressionCron: schemaExpressionCron,
  fuseauHoraire: z.string().trim().min(1).max(64).default('Europe/Zurich'),
});
export type EntreeCreationDeclencheurPlanifie = z.infer<typeof schemaCreationDeclencheurPlanifie>;

export const schemaCreationDeclencheurEvenement = z.object({
  type: z.literal('evenement'),
  operation: z.enum(OPERATIONS_CONNECTEUR),
  nature: z.string().trim().min(1).max(60),
  evenement: z.enum(TYPES_EVENEMENT_METIER),
});
export type EntreeCreationDeclencheurEvenement = z.infer<typeof schemaCreationDeclencheurEvenement>;

/**
 * `POST /connecteurs/activations/{id}/declencheurs` — `Idempotency-Key` OBLIGATOIRE : un rejeu
 * accidentel ne doit jamais enregistrer DEUX déclencheurs planifiés identiques (double exécution
 * silencieuse à chaque battement de cron), même raisonnement que `RC-06` appliqué à toute création
 * sensible.
 */
export const schemaCreationDeclencheurConnecteur = z.discriminatedUnion('type', [
  schemaCreationDeclencheurPlanifie,
  schemaCreationDeclencheurEvenement,
]);
export type EntreeCreationDeclencheurConnecteur = z.infer<typeof schemaCreationDeclencheurConnecteur>;

export interface ReponseDeclencheurConnecteur {
  readonly id: string;
  readonly connecteurActivationId: string;
  readonly type: 'planifie' | 'evenement';
  readonly operation: OperationConnecteur;
  readonly nature: string;
  /** Renseigné UNIQUEMENT si `type = 'planifie'`. */
  readonly expressionCron: string | null;
  readonly fuseauHoraire: string | null;
  /** Renseigné UNIQUEMENT si `type = 'evenement'`. */
  readonly evenement: TypeEvenementMetier | null;
  readonly actif: boolean;
  /** Traçabilité directe vers le journal (`execution.ts`) — la dernière exécution que CE
   *  déclencheur a mise en file, `null` si jamais déclenché. */
  readonly derniereExecutionId: string | null;
  readonly creeLe: string;
}

export const TRIS_DECLENCHEURS_CONNECTEUR = ['creeLe:desc', 'creeLe:asc'] as const;
export const TRI_DEFAUT_DECLENCHEURS_CONNECTEUR = 'creeLe:desc';

export const schemaFiltresDeclencheursConnecteur = schemaParametresPage.extend({
  actif: z.coerce.boolean().optional(),
  tri: z.enum(TRIS_DECLENCHEURS_CONNECTEUR).default(TRI_DEFAUT_DECLENCHEURS_CONNECTEUR),
});
export type FiltresDeclencheursConnecteur = z.infer<typeof schemaFiltresDeclencheursConnecteur>;

/**
 * `POST /connecteurs/activations/{id}/declencheurs/{declencheurId}/activer` /
 * `.../desactiver` — pas d'`Idempotency-Key`, transition gardée par l'état de départ, même patron
 * que les actions de `connecteur.ts`. Désactiver un déclencheur (jamais le supprimer — pas de
 * suppression physique, même doctrine que `article`/`fournisseur`/`vehicule`) reste toujours
 * possible sans condition, `RC-01`.
 */
