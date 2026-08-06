/**
 * Clés TanStack Query du domaine relances — même convention que `clesPneus`/`clesPieces` : tuple
 * plat, tenu ICI plutôt que dans `api/cles.ts` (gelé depuis l'étape 1, hors périmètre de cet
 * agent). Une seule liste pour l'instant (`GET /relances/regles`) : les rappels de facture sont
 * bornés par construction (au plus 9 types par tenant, `contrats/relances/enums.ts`), aucune
 * pagination — les déclenchements `planifier`/`envoyer` sont des mutations, pas des ressources en
 * cache.
 */
export const clesRelances = {
  regles: () => ['relances', 'regles'] as const,
} as const;
