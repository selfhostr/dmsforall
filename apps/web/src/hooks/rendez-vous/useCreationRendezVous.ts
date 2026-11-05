import { useRef, useState } from 'react';

import type { CodeConfirmation, EntreeCreationRendezVous, ReponseRendezVous } from '@dfa/shared';

import { ErreurApi } from '@/api/erreurs';
import { genererCleIdempotence } from '@/api/idempotence';

import { useCreerRendezVous } from './useCreerRendezVous';

export interface CreationRendezVous {
  readonly enCours: boolean;
  /** Erreur de la dernière tentative — `null` une fois une confirmation en cours de résolution,
   *  pour ne pas superposer l'alerte générique ET le dialogue de confirmation. */
  readonly erreur: unknown;
  readonly erreurActive: ErreurApi | null;
  /** Codes à confirmer explicitement (409 CONFIRMATION_REQUISE) — `PLANNING_CAPACITE_DEPASSEE`
   *  N'Y FIGURE JAMAIS (RV-06, choix produit #1 : le surbooking n'est qu'un avertissement de la
   *  réponse, jamais un blocage à confirmer). */
  readonly confirmationsRequises: readonly CodeConfirmation[];
  readonly soumettre: (
    entree: EntreeCreationRendezVous,
    options: { readonly onSuccess: (rdv: ReponseRendezVous) => void },
  ) => void;
  readonly confirmerEtResoumettre: (options: {
    readonly onSuccess: (rdv: ReponseRendezVous) => void;
  }) => void;
}

/**
 * Orchestration métier de `POST /rendez-vous` — idempotence + protocole de confirmation en deux
 * temps, séparée du JSX (CONTRIBUTING.md : « la logique métier vit dans des hooks testés, pas dans le
 * JSX »). Même patron que `hooks/atelier/useCreationOrdreReparation.ts`, copié plutôt que
 * réinventé — voir son commentaire de tête pour le détail du piège évité (`useRef` plutôt que
 * `useCleIdempotence()`, pour régénérer et émettre dans le même appel synchrone au rejeu confirmé).
 */
export function useCreationRendezVous(): CreationRendezVous {
  const mutation = useCreerRendezVous();
  const cleIdempotenceRef = useRef(genererCleIdempotence());
  const [derniereEntree, setDerniereEntree] = useState<EntreeCreationRendezVous | null>(null);

  const erreurActive = mutation.error instanceof ErreurApi ? mutation.error : null;
  const confirmationsRequises = erreurActive?.confirmationsRequises ?? [];

  function soumettre(
    entree: EntreeCreationRendezVous,
    options: { readonly onSuccess: (rdv: ReponseRendezVous) => void },
  ) {
    setDerniereEntree(entree);
    mutation.mutate(
      { entree, idempotencyKey: cleIdempotenceRef.current },
      {
        onSuccess: (reponse) => {
          cleIdempotenceRef.current = genererCleIdempotence();
          setDerniereEntree(null);
          options.onSuccess(reponse.donnees);
        },
      },
    );
  }

  function confirmerEtResoumettre(options: {
    readonly onSuccess: (rdv: ReponseRendezVous) => void;
  }) {
    if (!derniereEntree) return;
    cleIdempotenceRef.current = genererCleIdempotence();
    soumettre({ ...derniereEntree, confirmations: [...confirmationsRequises] }, options);
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
