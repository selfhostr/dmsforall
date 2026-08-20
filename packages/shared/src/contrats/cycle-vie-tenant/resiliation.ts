import { z } from 'zod';

import { schemaMotif } from '../atelier/primitives';
import type { StatutResiliationTenant } from './enums';

/**
 * Ressource `resiliation` (singleton, au plus un dossier par tenant — migration 0062).
 *
 * Racine `/resiliation`, jamais `/tenants/{id}/resiliation` : le tenant est TOUJOURS résolu
 * depuis la session (même doctrine que `/pointages`, `/sites`… — voir CONTRIBUTING.md, « Tenant résolu
 * depuis la session/le jeton, jamais un paramètre de requête »). Il n'y a donc rien à nommer dans
 * l'URL, et une session ne peut structurellement désigner qu'UN SEUL dossier : le sien.
 *
 * Droit MÉTIER ordinaire, rôle `direction` SEUL (arbitrage 20.08.2026) : l'export sort
 * l'intégralité de la base du garage.
 */
export interface ReponseResiliationTenant {
  readonly id: string;
  readonly tenantId: string;
  readonly statut: StatutResiliationTenant;
  readonly motif: string;
  readonly demandeeLe: string;
  readonly demandeeParUtilisateurId: string;
  readonly exportGenereLe: string | null;
  readonly exportNbTables: number | null;
  readonly exportNbLignesTotal: number | null;
  readonly exportTailleOctets: number | null;
  readonly exportErreur: string | null;
  readonly remisLe: string | null;
  readonly remisConfirmeParUtilisateurId: string | null;
  readonly retentionJours: number;
  readonly purgePrevueLe: string | null;
  readonly effaceeLe: string | null;
  readonly creeLe: string;
  readonly modifieLe: string;
}

/**
 * `POST /resiliation` — déclenche la résiliation ET l'export intégral en tâche de fond.
 *
 * `confirmationRaisonSociale` : re-saisie EXACTE de la raison sociale du tenant (affichée par le
 * front avant saisie, jamais à deviner de mémoire) — même doctrine que `docker/postgres/
 * sauvegarde/restaurer.sh` (« Tapez exactement le nom de la base pour confirmer »). Un export
 * intégral déclenché par erreur ou par un clic isolé, c'est toute la base du garage qui sort :
 * un simple bouton ne suffit pas. Comparaison faite CÔTÉ SERVEUR (`ServiceCycleVieResiliation`
 * n'existe pas ici, voir `resiliation-tenant.controller.ts`), jamais côté client seul.
 */
export const schemaDemandeResiliationTenant = z.object({
  motif: schemaMotif,
  confirmationRaisonSociale: z.string().trim().min(1).max(320),
});
export type EntreeDemandeResiliationTenant = z.infer<typeof schemaDemandeResiliationTenant>;

/** Un fichier de l'export produit — chemin RELATIF au répertoire du tenant (opaque, jamais un
 *  chemin absolu du serveur), utilisable tel quel dans `GET /resiliation/fichiers/{chemin}`. */
export interface ReponseFichierExportTenant {
  readonly chemin: string;
  readonly tailleOctets: number;
}

export interface ReponseListeFichiersExportTenant {
  readonly fichiers: readonly ReponseFichierExportTenant[];
}
