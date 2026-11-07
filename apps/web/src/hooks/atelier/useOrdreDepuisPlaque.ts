import { useRef, useState } from 'react';

import type {
  CodeConfirmation,
  EntreeCreationOrdreReparation,
  EntreeCreationRapideOrdreReparation,
  ReponseOrdreReparation,
} from '@dfa/shared';

import { ErreurApi } from '@/api/erreurs';
import { genererCleIdempotence } from '@/api/idempotence';
import { afficherToastSucces } from '@/composants/motifs/toast-succes';
import i18n from '@/i18n';

import type { PlanClient, PlanVehicule } from './ordre-depuis-plaque';
import { useCreerOrdreRapide } from './useCreerOrdreRapide';

export interface PlanOrdreDepuisPlaque {
  readonly client: PlanClient;
  readonly vehicule: PlanVehicule;
  readonly ordre: Omit<EntreeCreationOrdreReparation, 'clientId' | 'vehiculeId'>;
}

/** Corps de `POST /ordres-reparation/creation-rapide` pour un plan de l'écran. */
export function corpsCreationRapide(
  plan: PlanOrdreDepuisPlaque,
  confirmations: readonly CodeConfirmation[] = [],
): EntreeCreationRapideOrdreReparation {
  return {
    client:
      plan.client.mode === 'existant' ? { id: plan.client.id } : { nouveau: plan.client.entree },
    vehicule:
      plan.vehicule.mode === 'existant'
        ? { id: plan.vehicule.id }
        : { nouveau: plan.vehicule.entree },
    or:
      confirmations.length > 0 ? { ...plan.ordre, confirmations: [...confirmations] } : plan.ordre,
  };
}

/**
 * « Depuis une plaque » : UN appel `POST /ordres-reparation/creation-rapide`, une transaction et
 * une `Idempotency-Key` — un second clic après coupure réseau rejoue la même clé (ni second client
 * ni second véhicule). La clé change seulement quand le corps change (confirmations ajoutées) et
 * après un succès. Le doublon probable de client (`CLIENT_DOUBLON_PROBABLE`) n'est jamais bloquant :
 * il est signalé par un toast.
 */
export function useOrdreDepuisPlaque() {
  const mutation = useCreerOrdreRapide();
  const cle = useRef(genererCleIdempotence());
  const [dernierPlan, setDernierPlan] = useState<PlanOrdreDepuisPlaque | null>(null);

  const erreurActive = mutation.error instanceof ErreurApi ? mutation.error : null;
  const confirmationsRequises = erreurActive?.confirmationsRequises ?? [];

  function envoyer(
    plan: PlanOrdreDepuisPlaque,
    confirmations: readonly CodeConfirmation[],
    onSuccess: (or: ReponseOrdreReparation) => void,
  ) {
    setDernierPlan(plan);
    mutation.mutate(
      { entree: corpsCreationRapide(plan, confirmations), idempotencyKey: cle.current },
      {
        onSuccess: (reponse) => {
          cle.current = genererCleIdempotence();
          setDernierPlan(null);
          if (reponse.avertissements.some((a) => a.code === 'CLIENT_DOUBLON_PROBABLE')) {
            afficherToastSucces({ message: i18n.t('erreurs:codes.CLIENT_DOUBLON_PROBABLE') });
          }
          onSuccess(reponse.donnees.ordreReparation);
        },
      },
    );
  }

  function lancer(plan: PlanOrdreDepuisPlaque, onSuccess: (or: ReponseOrdreReparation) => void) {
    envoyer(plan, [], onSuccess);
  }

  /** Rejeu après accord explicite : les confirmations entrent dans l'empreinte, donc nouvelle clé. */
  function confirmerEtResoumettre(options: {
    readonly onSuccess: (or: ReponseOrdreReparation) => void;
  }) {
    if (!dernierPlan) return;
    cle.current = genererCleIdempotence();
    envoyer(dernierPlan, confirmationsRequises, options.onSuccess);
  }

  return {
    lancer,
    confirmerEtResoumettre,
    confirmationsRequises,
    erreurActive,
    enCours: mutation.isPending,
    /** Erreur de la dernière tentative, masquée pendant une confirmation à résoudre. */
    erreur: confirmationsRequises.length > 0 ? null : mutation.error,
  };
}
