import { useRef, useState } from 'react';

import type {
  CodeConfirmation,
  EntreeCreationDossierVente,
  ReponseDossierVente,
} from '@dfa/shared';

import { ErreurApi } from '@/api/erreurs';
import { genererCleIdempotence } from '@/api/idempotence';

import { useCreerDossierVente } from './useCreerDossierVente';

export interface CreationDossierVente {
  readonly enCours: boolean;
  readonly erreur: unknown;
  readonly erreurActive: ErreurApi | null;
  readonly confirmationsRequises: readonly CodeConfirmation[];
  readonly soumettre: (
    entree: EntreeCreationDossierVente,
    options: { readonly onSuccess: (dossier: ReponseDossierVente) => void },
  ) => void;
  readonly confirmerEtResoumettre: (options: {
    readonly onSuccess: (dossier: ReponseDossierVente) => void;
  }) => void;
}

/**
 * Orchestration de `POST /dossiers-vente` — idempotence (RV-29) + protocole de confirmation en
 * deux temps (§4.4), séparée du JSX (CONTRIBUTING.md : « la logique métier vit dans des hooks testés,
 * pas dans le JSX »). Copie conforme de `useCreationOrdreReparation` (`hooks/atelier/`) — même
 * doctrine sur le `useRef` pour la clé d'idempotence (voir son commentaire d'en-tête pour le piège
 * évité : lire `idempotence.cle` juste après régénération renverrait encore l'ancienne clé).
 */
export function useCreationDossierVente(): CreationDossierVente {
  const mutation = useCreerDossierVente();
  const cleIdempotenceRef = useRef(genererCleIdempotence());
  const [derniereEntree, setDerniereEntree] = useState<EntreeCreationDossierVente | null>(null);

  const erreurActive = mutation.error instanceof ErreurApi ? mutation.error : null;
  const confirmationsRequises = erreurActive?.confirmationsRequises ?? [];

  function soumettre(
    entree: EntreeCreationDossierVente,
    options: { readonly onSuccess: (dossier: ReponseDossierVente) => void },
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
    readonly onSuccess: (dossier: ReponseDossierVente) => void;
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
