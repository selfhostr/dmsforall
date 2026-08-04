/**
 * Clés TanStack Query du domaine reprise (étape 4, ventes) — même convention que `clesPieces`
 * (`hooks/pieces/cles.ts`) : tuple plat, tenu ICI plutôt que dans `api/cles.ts` (gelé depuis
 * l'étape 1, hors périmètre de cet agent).
 *
 * Une seule entrée : la reprise est une sous-ressource SINGULIÈRE d'un dossier de vente (au plus
 * une par dossier, `contrats/ventes/reprise.ts`), jamais une collection — pas de clé `liste`.
 */
export const clesVentesReprises = {
  detail: (dossierVenteId: string) => ['ventes', 'reprises', 'detail', dossierVenteId] as const,
};
