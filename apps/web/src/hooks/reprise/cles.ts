/**
 * Clés TanStack Query du domaine reprise de données — même convention que `hooks/pieces/cles.ts`/
 * `hooks/ventes/reprises/cles.ts` : tuple plat, tenu ICI plutôt que dans `api/cles.ts` (gelé
 * depuis l'étape 1, hors périmètre de ce lot).
 *
 * `dossiers.liste()` est LA clé racine : le contrat `reprise.ts` n'expose aucun `GET
 * /reprise/dossiers/{id}` (seulement la collection) — l'état du dossier « actif » vient donc
 * TOUJOURS de la collection triée `creeLe:desc`, jamais d'une clé `detail(id)` séparée. Elle
 * existe quand même ci-dessous pour les sous-ressources qui, elles, sont bien adressées par id de
 * dossier (`analyse`, `plan`, `import`, `rapport`, `tranches`).
 */
export const clesReprise = {
  dossiers: {
    liste: () => ['reprise', 'dossiers', 'liste'] as const,
  },
  tranches: (dossierId: string) => ['reprise', 'dossiers', dossierId, 'tranches'] as const,
  analyse: (dossierId: string) => ['reprise', 'dossiers', dossierId, 'analyse'] as const,
  plan: (dossierId: string) => ['reprise', 'dossiers', dossierId, 'plan'] as const,
  import: (dossierId: string) => ['reprise', 'dossiers', dossierId, 'import'] as const,
  rapport: (dossierId: string) => ['reprise', 'dossiers', dossierId, 'rapport'] as const,
};
