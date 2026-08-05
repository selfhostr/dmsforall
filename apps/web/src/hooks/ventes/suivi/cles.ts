import type { FiltresSuiviVente } from '@dfa/shared';

/**
 * Clés TanStack Query du sous-domaine « suivi financement/garantie » — même convention que
 * `hooks/ventes/dossiers/cles.ts` : tuple plat, l'objet de filtres COMPLET envoyé au serveur sert
 * de clé (pas de forme réduite), tenu ici plutôt que dans `api/cles.ts` (gelé depuis l'étape 1).
 */
export const clesVentesSuivi = {
  liste: (filtres: FiltresSuiviVente) => ['ventes', 'suivi', 'liste', filtres] as const,
} as const;
