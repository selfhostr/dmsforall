import { useRef, useState } from 'react';

import type { EntreeCreationOrdreReparation, ReponseOrdreReparation } from '@dfa/shared';

import { genererCleIdempotence } from '@/api/idempotence';
import { useCreerClient } from '@/hooks/clients/useCreerClient';
import { useCreerVehicule } from '@/hooks/vehicules/useCreerVehicule';

import {
  EchecEtapeCreation,
  preparerClientEtVehicule,
  type EtapeCreation,
  type PlanClient,
  type PlanVehicule,
  type ProgressionCreation,
} from './ordre-depuis-plaque';
import { useCreationOrdreReparation } from './useCreationOrdreReparation';

export interface PlanOrdreDepuisPlaque {
  readonly client: PlanClient;
  readonly vehicule: PlanVehicule;
  readonly ordre: Omit<EntreeCreationOrdreReparation, 'clientId' | 'vehiculeId'>;
}

export interface EchecCreation {
  readonly etape: EtapeCreation;
  readonly erreur: unknown;
}

/**
 * Orchestration client -> véhicule -> OR du parcours « depuis une plaque ». Les trois appels
 * existants sont réutilisés tels quels (chacun garde son toast de succès et son invalidation de
 * cache) ; ce hook ajoute seulement l'enchaînement, la reprise et les clés d'idempotence stables
 * d'un essai à l'autre — un second clic après coupure réseau ne crée ni second client ni second
 * véhicule.
 */
export function useOrdreDepuisPlaque() {
  const creerClient = useCreerClient();
  const creerVehicule = useCreerVehicule();
  const creationOr = useCreationOrdreReparation();
  const progression = useRef<ProgressionCreation>({});
  const cles = useRef({ client: genererCleIdempotence(), vehicule: genererCleIdempotence() });
  const [etape, setEtape] = useState<EtapeCreation | null>(null);
  const [echecPrealable, setEchecPrealable] = useState<EchecCreation | null>(null);
  // Miroir de `progression` pour le rendu (un ref ne déclenche pas de rendu).
  const [faits, setFaits] = useState<ProgressionCreation>({});

  async function lancer(
    plan: PlanOrdreDepuisPlaque,
    onSuccess: (or: ReponseOrdreReparation) => void,
  ) {
    setEchecPrealable(null);
    try {
      const { clientId, vehiculeId } = await preparerClientEtVehicule(plan, progression.current, {
        surEtape: setEtape,
        creerClient: async (entree) => {
          const reponse = await creerClient.mutateAsync({
            entree,
            idempotencyKey: cles.current.client,
          });
          cles.current.client = genererCleIdempotence();
          setFaits({ ...progression.current, clientId: reponse.donnees.id });
          return reponse.donnees;
        },
        creerVehicule: async (entree) => {
          const reponse = await creerVehicule.mutateAsync({
            entree,
            idempotencyKey: cles.current.vehicule,
          });
          cles.current.vehicule = genererCleIdempotence();
          setFaits({ ...progression.current, vehiculeId: reponse.donnees.id });
          return reponse.donnees;
        },
      });
      setFaits({ ...progression.current });
      setEtape('or');
      creationOr.soumettre({ ...plan.ordre, clientId, vehiculeId }, { onSuccess });
    } catch (erreur) {
      setFaits({ ...progression.current });
      if (erreur instanceof EchecEtapeCreation) {
        setEchecPrealable({ etape: erreur.etape, erreur: erreur.erreur });
      } else {
        setEchecPrealable({ etape: 'client', erreur });
      }
    } finally {
      // `soumettre` est lancé sans attente : l'état « OR en cours » vient de `creationOr.enCours`.
      setEtape(null);
    }
  }

  const echec: EchecCreation | null =
    echecPrealable ??
    (creationOr.erreur !== null && creationOr.erreur !== undefined
      ? { etape: 'or', erreur: creationOr.erreur }
      : null);

  return {
    lancer,
    confirmerEtResoumettre: creationOr.confirmerEtResoumettre,
    confirmationsRequises: creationOr.confirmationsRequises,
    erreurActive: creationOr.erreurActive,
    /** Création en vol (client, véhicule ou OR). */
    enCours: etape !== null || creationOr.enCours,
    echec,
    /** Ce qui est déjà en base : l'écran verrouille les sections correspondantes. */
    faits,
  };
}
