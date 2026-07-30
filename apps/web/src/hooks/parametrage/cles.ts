/**
 * Clés TanStack Query du domaine paramétrage — même convention que `clesFacturation`
 * (`hooks/facturation/cles.ts`) : tuple plat, tenue ICI plutôt que fusionnée dans `api/cles.ts`
 * (hors périmètre de cet agent). Un seul singleton à ce jour (bloc créancier) ; d'autres écrans
 * de paramétrage viendront s'ajouter à côté.
 */
export const clesParametrage = {
  /** Singleton par tenant, aucun paramètre — voir `hooks/parametrage/bloc-creancier.api.ts`. */
  creancier: () => ['parametrage', 'creancier'] as const,
} as const;
