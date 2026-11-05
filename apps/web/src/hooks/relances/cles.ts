/**
 * Clés TanStack Query du domaine relances — même convention que `clesPneus`/`clesPieces` : tuple
 * plat, tenu ICI plutôt que dans `api/cles.ts` (gelé depuis l'étape 1, hors périmètre de cet
 * lot). `regles` (`GET /relances/regles`) : au plus 9 types par tenant, aucune pagination — les
 * déclenchements `planifier`/`envoyer` sont des mutations, pas des ressources en cache.
 *
 * `historique` (issue #136, `GET /relances/facturation/historique`) : paginée par curseur,
 * `factureId` fait partie de la clé — deux vues (« tout le tenant » vs « une facture ») ne
 * doivent jamais partager le même cache.
 */
export const clesRelances = {
  regles: () => ['relances', 'regles'] as const,
  historique: (factureId?: string) => ['relances', 'historique', factureId ?? ''] as const,
} as const;
