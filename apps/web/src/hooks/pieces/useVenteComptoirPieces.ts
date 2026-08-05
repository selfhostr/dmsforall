import { useRef } from 'react';

import type {
  EntreeCreationMouvementRetourClient,
  EntreeCreationMouvementSortieComptoir,
  ReponseMouvementStock,
} from '@dfa/shared';

import { genererCleIdempotence } from '@/api/idempotence';

import {
  useCreerMouvementRetourClient,
  useCreerMouvementSortieComptoir,
} from './useCreerMouvementStock';

export interface VenteComptoir {
  readonly enCours: boolean;
  readonly erreur: unknown;
  readonly vendre: (
    entree: EntreeCreationMouvementSortieComptoir,
    options: { readonly onSuccess: (mouvement: ReponseMouvementStock) => void },
  ) => void;
}

/**
 * Orchestration de `POST /articles/{id}/mouvements/sortie-comptoir` — LE geste n°1 du magasinier
 * une fois la pièce trouvée au comptoir (`EcranRechercheComptoirPieces`) : sortir une pièce SANS
 * document de vente (dépannage, geste commercial délibérément ouvert — voir la note
 * d'intégration en fin de `contrats/pieces/mouvement.ts` pour ce que ce chemin couvre et ne
 * couvre pas, notamment l'absence de facture).
 *
 * Idempotence PORTÉE CÔTÉ CLIENT, une clé par INTENTION — même patron que
 * `hooks/ventes/dossiers/useCreerBonCommandeDossier.ts` et
 * `hooks/atelier/useCreationOrdreReparation.ts` : un `useRef`, régénéré SEULEMENT après un
 * succès. Un double-clic sur le bouton « Sortir » (deux appels avant toute résolution) referme
 * donc sur la MÊME clé aux deux tentatives : le serveur reconnaît un rejeu et ne sort la pièce
 * qu'une seule fois — exactement ce que `Idempotency-Key` doit empêcher. Régénérer la clé à
 * chaque appel de `vendre()` (ex. dans un `useState`, lu au rendu suivant plutôt que dans le même
 * tick) romprait cette garantie : le second appel du double-clic porterait une clé NEUVE, donc
 * une seconde sortie de stock pour un seul geste du magasinier.
 */
export function useVenteComptoir(articleId: string): VenteComptoir {
  const mutation = useCreerMouvementSortieComptoir(articleId);
  const cleIdempotenceRef = useRef(genererCleIdempotence());

  function vendre(
    entree: EntreeCreationMouvementSortieComptoir,
    options: { readonly onSuccess: (mouvement: ReponseMouvementStock) => void },
  ) {
    mutation.mutate(
      { entree, idempotencyKey: cleIdempotenceRef.current },
      {
        onSuccess: (mouvement) => {
          cleIdempotenceRef.current = genererCleIdempotence();
          options.onSuccess(mouvement);
        },
      },
    );
  }

  return { enCours: mutation.isPending, erreur: mutation.error, vendre };
}

export interface RetourClientComptoir {
  readonly enCours: boolean;
  readonly erreur: unknown;
  readonly retourner: (
    entree: EntreeCreationMouvementRetourClient,
    options: { readonly onSuccess: (mouvement: ReponseMouvementStock) => void },
  ) => void;
}

/**
 * Orchestration de `POST /articles/{id}/mouvements/retour-client` — même doctrine d'idempotence
 * qu'`useVenteComptoir` ci-dessus (une clé par INTENTION, `useRef` régénéré au succès seulement).
 */
export function useRetourClientComptoir(articleId: string): RetourClientComptoir {
  const mutation = useCreerMouvementRetourClient(articleId);
  const cleIdempotenceRef = useRef(genererCleIdempotence());

  function retourner(
    entree: EntreeCreationMouvementRetourClient,
    options: { readonly onSuccess: (mouvement: ReponseMouvementStock) => void },
  ) {
    mutation.mutate(
      { entree, idempotencyKey: cleIdempotenceRef.current },
      {
        onSuccess: (mouvement) => {
          cleIdempotenceRef.current = genererCleIdempotence();
          options.onSuccess(mouvement);
        },
      },
    );
  }

  return { enCours: mutation.isPending, erreur: mutation.error, retourner };
}
