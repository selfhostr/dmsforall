import type { StatutOrdreReparation } from '@dfa/shared';

/**
 * Statuts d'OR sur lesquels il reste légitime de pointer — MIROIR du prédicat serveur
 * `estOrPointable` (`apps/api/src/pointage/regles-pointage.ts`, RM-92 : « pas de pointage sur un OR
 * terminé/facturé/restitué/clôturé/annulé », `planifie` restant pointable). Dupliqué ici plutôt
 * qu'importé : ce module backend n'est pas exposé à `@dfa/shared` et ce fichier appartient au
 * périmètre front — voir `SelecteurOrOuvert.tsx` pour l'unique appelant.
 *
 * CORRECTIF (test manuel 14.08.2026) : « Toutes les OR ouvertes » ne filtrait QUE `statut=ouvert`
 * côté requête (`FiltresListeOrdresReparation.statut` mono-sélection, hors périmètre d'écriture de
 * ce module — voir `apps/web/src/hooks/atelier/ordres-reparation.api.ts`), rendant un OR `en_cours`
 * — précisément la cible la plus probable d'un technicien qui cherche à pointer — introuvable par ce
 * chemin. Ce fichier fournit le filtre CÔTÉ CLIENT appliqué après une liste NON filtrée par statut
 * (`SelecteurOrOuvert` omet désormais `statut` de sa requête), pour couvrir tous les statuts
 * pointables sans dupliquer une liste en dur divergente du serveur.
 *
 * SIGNALÉ, hors périmètre : la solution serveur idéale serait d'étendre
 * `FiltresListeOrdresReparation.statut` à un tableau (le contrat `schemaFiltresOrdresReparation`
 * l'accepte déjà via `schemaListeQuery`, seul le type front est mono-valeur) pour filtrer côté SQL
 * plutôt qu'après pagination — voir le rapport de livraison.
 */
const STATUTS_OR_NON_POINTABLES: ReadonlySet<StatutOrdreReparation> = new Set([
  'termine',
  'facture',
  'restitue',
  'cloture',
  'annule',
]);

export function statutOrPointable(statut: StatutOrdreReparation): boolean {
  return !STATUTS_OR_NON_POINTABLES.has(statut);
}
