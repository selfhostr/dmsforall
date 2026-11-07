import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useRef } from 'react';

import { schemaCreationLigneOr, type ReponseTravailReporte } from '@dfa/shared';

import { clesQuery } from '@/api/cles';
import { genererCleIdempotence } from '@/api/idempotence';
import { creerLigneOrdreReparation } from '@/hooks/atelier/ordres-reparation.api';
import { modifierTravailReporteVehicule } from '@/ecrans/vehicules/travauxReportes.api';

/** Entrée d'ajout de ligne correspondant à un travail reporté. Le contrat de création de ligne
 *  (`schemaCreationLigneOr`) ne porte pas `ordreReparationRepriseId` : le lien travail -> OR est
 *  posé par le passage du travail à « repris » (étape 2) ; ici on copie la désignation, l'urgence,
 *  la sécurité et l'estimation. Le prix n'est repris que s'il est connu (rôle avec montants). */
export function ligneDepuisTravailReporte(travail: ReponseTravailReporte) {
  return schemaCreationLigneOr.parse({
    type: 'forfait',
    origine: 'commandee',
    designation: travail.designation,
    urgence: travail.urgence,
    securite: travail.securite,
    prixUnitaireCentimes: travail.montantEstimeCentimes ?? undefined,
  });
}

export interface VariablesReprise {
  readonly travail: ReponseTravailReporte;
  readonly orId: string;
}

/**
 * « Reprendre dans cet OR » : crée une ligne sur l'OR à partir du travail reporté, puis le marque
 * « repris ». Deux appels, donc reprise propre : la clé d'idempotence de la ligne est conservée par
 * travail, un rejeu après un échec du second appel ne crée JAMAIS une deuxième ligne.
 */
export function useReprendreTravailDansOr(
  vehiculeId: string,
): UseMutationResult<void, unknown, VariablesReprise> {
  const queryClient = useQueryClient();
  const cles = useRef(new Map<string, string>());

  return useMutation({
    mutationFn: async ({ travail, orId }: VariablesReprise) => {
      const cleMemo = `${orId}:${travail.id}`;
      let cle = cles.current.get(cleMemo);
      if (!cle) {
        cle = genererCleIdempotence();
        cles.current.set(cleMemo, cle);
      }
      await creerLigneOrdreReparation(orId, ligneDepuisTravailReporte(travail), cle);
      await modifierTravailReporteVehicule(vehiculeId, travail.id, { statut: 'repris' });
      cles.current.delete(cleMemo);
    },
    onSettled: async (_donnees, _erreur, { orId }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: clesQuery.or.detail(orId) }),
        queryClient.invalidateQueries({
          queryKey: clesQuery.vehicules.travauxReportes(vehiculeId),
        }),
        queryClient.invalidateQueries({
          queryKey: clesQuery.vehicules.contexteAtelier(vehiculeId),
        }),
      ]);
    },
  });
}
