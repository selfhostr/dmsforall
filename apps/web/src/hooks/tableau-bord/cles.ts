import type { FiltreTableauBord } from '@dfa/shared';

/**
 * Clés TanStack Query du tableau de bord — même convention que `clesPieces`
 * (`hooks/pieces/cles.ts`) : tuple plat, tenue ICI plutôt que fusionnée dans `api/cles.ts` (gelé
 * depuis l'étape 1, hors périmètre de cet agent). Le filtre COMPLET (`siteId`/`du`/`au`) entre
 * dans la clé — deux périodes/sites différents ne doivent jamais partager un cache.
 *
 * Deux entrées distinctes (`activite`/`financier`), à l'image des deux endpoints séparés
 * (`activite.controller.ts`/`financier.controller.ts`) : deux requêtes qui réussissent/échouent
 * indépendamment, jamais fusionnées dans une même clé.
 */
export const clesTableauBord = {
  activite: (filtre: FiltreTableauBord) => ['tableauBord', 'activite', filtre] as const,
  financier: (filtre: FiltreTableauBord) => ['tableauBord', 'financier', filtre] as const,
  /** Voir `or-attente-pieces.api.ts` — clé distincte de `activite` : source différente
   *  (`GET /ordres-reparation`, pas `GET /tableau-bord/activite`), échoue/réussit indépendamment. */
  orEnAttentePieces: (siteId: string | undefined) =>
    ['tableauBord', 'orEnAttentePieces', siteId] as const,
} as const;
