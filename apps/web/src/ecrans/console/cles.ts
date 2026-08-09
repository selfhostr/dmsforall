/**
 * Clés TanStack Query de la console d'exploitation — même convention que `hooks/relances/cles.ts`
 * (tuple plat, tenu ici plutôt que dans `api/cles.ts`, gelé depuis l'étape 1). Une seule ressource
 * pour l'instant : la vue plateforme (palier 1), pas de pagination donc pas de filtres à encoder
 * dans la clé (le filtrage est intégralement côté client, voir `EcranConsolePlateforme`).
 */
export const clesConsole = {
  vuePlateforme: () => ['console', 'plateforme'] as const,
} as const;
