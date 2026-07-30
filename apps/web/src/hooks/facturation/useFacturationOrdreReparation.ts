import { useRef, useState } from 'react';

import type { CodeConfirmation, EntreeFacturationOrdreReparation, ReponseFacturationOrdreReparation } from '@dfa/shared';

import { ErreurApi } from '@/api/erreurs';
import { genererCleIdempotence } from '@/api/idempotence';

import { useFacturerOrdreReparation } from './useFacturerOrdreReparation';

export interface FacturationOrdreReparation {
  /** `true` tant que la mutation est en vol (première tentative ou rejeu confirmé). */
  readonly enCours: boolean;
  /** Erreur de la dernière tentative — `null` une fois une confirmation en cours de résolution
   *  (`confirmationsRequises.length > 0`), pour ne pas superposer l'alerte générique ET le
   *  dialogue de confirmation. */
  readonly erreur: unknown;
  /** Même erreur, mais TYPÉE et non masquée par une confirmation en cours — pour construire le
   *  texte du dialogue `AvertissementConfirmable` (`messageErreur` exige une `ErreurApi`). */
  readonly erreurActive: ErreurApi | null;
  /** Codes à confirmer explicitement (§4.4) — non vide seulement après un `409
   *  CONFIRMATION_REQUISE` (`CLIENT_BLOQUE`, RM-08 : payeur ou client de l'OR bloqué). */
  readonly confirmationsRequises: readonly CodeConfirmation[];
  /** Première tentative — construit sa propre clé d'idempotence. */
  readonly soumettre: (
    orId: string,
    entree: EntreeFacturationOrdreReparation,
    options: { readonly onSuccess: (reponse: ReponseFacturationOrdreReparation) => void },
  ) => void;
  /** Rejeu APRÈS accord explicite de l'utilisateur sur `confirmationsRequises` — régénère la clé
   *  d'idempotence avant d'émettre (`confirmations` entre dans l'empreinte, §5.1 du contrat de
   *  facturer-or : réutiliser la clé transformerait ce rejeu volontaire en `409
   *  IDEMPOTENCE_CONFLIT`). */
  readonly confirmerEtResoumettre: (options: { readonly onSuccess: (reponse: ReponseFacturationOrdreReparation) => void }) => void;
}

/**
 * Orchestration métier de `POST /ordres-reparation/{orId}/facturer` (`RF-81`) — idempotence +
 * protocole de confirmation en deux temps (§4.4), séparée du JSX (CONTRIBUTING.md : « la logique métier
 * vit dans des hooks testés, pas dans le JSX »). Même patron, à l'identique, que
 * `hooks/atelier/useCreationOrdreReparation.ts` : voir son commentaire d'en-tête pour la
 * justification du `useRef` (la clé régénérée doit être relue de façon SYNCHRONE dans
 * `confirmerEtResoumettre`, pas via un `useState` qui ne se répercute qu'au rendu suivant).
 */
export function useFacturationOrdreReparation(): FacturationOrdreReparation {
  const mutation = useFacturerOrdreReparation();
  const cleIdempotenceRef = useRef(genererCleIdempotence());
  const [derniereEntree, setDerniereEntree] = useState<{
    readonly orId: string;
    readonly entree: EntreeFacturationOrdreReparation;
  } | null>(null);

  const erreurActive = mutation.error instanceof ErreurApi ? mutation.error : null;
  const confirmationsRequises = erreurActive?.confirmationsRequises ?? [];

  function soumettre(
    orId: string,
    entree: EntreeFacturationOrdreReparation,
    options: { readonly onSuccess: (reponse: ReponseFacturationOrdreReparation) => void },
  ) {
    setDerniereEntree({ orId, entree });
    mutation.mutate(
      { orId, entree, idempotencyKey: cleIdempotenceRef.current },
      {
        onSuccess: (reponse) => {
          cleIdempotenceRef.current = genererCleIdempotence();
          setDerniereEntree(null);
          options.onSuccess(reponse.donnees);
        },
      },
    );
  }

  function confirmerEtResoumettre(options: { readonly onSuccess: (reponse: ReponseFacturationOrdreReparation) => void }) {
    if (!derniereEntree) return;
    cleIdempotenceRef.current = genererCleIdempotence();
    soumettre(derniereEntree.orId, { ...derniereEntree.entree, confirmations: [...confirmationsRequises] }, options);
  }

  return {
    enCours: mutation.isPending,
    erreur: confirmationsRequises.length > 0 ? null : mutation.error,
    erreurActive,
    confirmationsRequises,
    soumettre,
    confirmerEtResoumettre,
  };
}
