import { useRef, useState } from 'react';

import type { CodeConfirmation, EntreeCreationOrdreReparation, ReponseOrdreReparation } from '@dfa/shared';

import { ErreurApi } from '@/api/erreurs';
import { genererCleIdempotence } from '@/api/idempotence';

import { useCreerOrdreReparation } from './useCreerOrdreReparation';

export interface CreationOrdreReparation {
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
   *  CONFIRMATION_REQUISE` (ex. `CLIENT_BLOQUE`, `VEHICULE_DEUX_OR_OUVERTS`, `OR_SANS_RDV`). */
  readonly confirmationsRequises: readonly CodeConfirmation[];
  /** Première tentative — construit sa propre clé d'idempotence. */
  readonly soumettre: (entree: EntreeCreationOrdreReparation, options: { readonly onSuccess: (or: ReponseOrdreReparation) => void }) => void;
  /** Rejeu APRÈS accord explicite de l'utilisateur sur `confirmationsRequises` — régénère la clé
   *  d'idempotence avant d'émettre (§4.4/§5.1 : `confirmations` entre dans l'empreinte, donc
   *  réutiliser la clé transformerait ce rejeu volontaire en `409 IDEMPOTENCE_CONFLIT`). */
  readonly confirmerEtResoumettre: (options: { readonly onSuccess: (or: ReponseOrdreReparation) => void }) => void;
}

/**
 * Orchestration métier de `POST /ordres-reparation` — idempotence (RM-49) + protocole de
 * confirmation en deux temps (§4.4), séparée du JSX (CONTRIBUTING.md : « la logique métier vit dans des
 * hooks testés, pas dans le JSX ») pour rester testable sans monter tout le formulaire.
 *
 * La clé d'idempotence vit dans un `useRef`, PAS dans `useCleIdempotence()` (`api/idempotence.ts`) :
 * ce hook expose sa clé courante comme un ÉTAT React (`cle`), lu à la prochaine RESTITUTION du
 * composant — or `confirmerEtResoumettre` doit régénérer la clé puis émettre la requête confirmée
 * dans le MÊME appel synchrone (le commentaire d'en-tête d'`idempotence.ts` l'exige : « appeler
 * `regenerer()` juste avant d'émettre la requête confirmée »). Lire `idempotence.cle` juste après
 * `idempotence.regenerer()` renverrait encore l'ANCIENNE clé (un `setState` ne se répercute qu'au
 * rendu suivant) : ç'aurait rejoué la création sous la clé de la tentative refusée, empreinte
 * `confirmations[]` différente, `409 IDEMPOTENCE_CONFLIT` assuré. `genererCleIdempotence()` (le
 * générateur pur qu'expose `api/idempotence.ts`, hors cycle de rendu) évite ce piège : le
 * `useRef` est mis à jour et relu de façon synchrone, dans la même fonction.
 */
export function useCreationOrdreReparation(): CreationOrdreReparation {
  const mutation = useCreerOrdreReparation();
  const cleIdempotenceRef = useRef(genererCleIdempotence());
  const [derniereEntree, setDerniereEntree] = useState<EntreeCreationOrdreReparation | null>(null);

  const erreurActive = mutation.error instanceof ErreurApi ? mutation.error : null;
  const confirmationsRequises = erreurActive?.confirmationsRequises ?? [];

  function soumettre(entree: EntreeCreationOrdreReparation, options: { readonly onSuccess: (or: ReponseOrdreReparation) => void }) {
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

  function confirmerEtResoumettre(options: { readonly onSuccess: (or: ReponseOrdreReparation) => void }) {
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
