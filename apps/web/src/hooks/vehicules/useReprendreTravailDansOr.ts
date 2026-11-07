import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useRef } from 'react';

import type { ReponseTravailReporte } from '@dfa/shared';

import { clesQuery } from '@/api/cles';
import { genererCleIdempotence } from '@/api/idempotence';
import {
  creerLigneOrdreReparation,
  type EntreeLigneDepuisTravailReporte,
} from '@/hooks/atelier/ordres-reparation.api';

/** Entrée d'ajout de ligne pour un travail reporté : le serveur reprend désignation, estimation,
 *  urgence et sécurité du travail, et le passe à « repris » dans la même transaction. */
export function ligneDepuisTravailReporte(
  travail: ReponseTravailReporte,
): EntreeLigneDepuisTravailReporte {
  return { type: 'forfait', origine: 'commandee', travailReporteId: travail.id };
}

export interface VariablesReprise {
  readonly travail: ReponseTravailReporte;
  readonly orId: string;
}

/**
 * « Reprendre dans cet OR » : UN appel `POST /ordres-reparation/{id}/lignes` avec `travailReporteId`
 * (ligne créée et travail marqué « repris » atomiquement). La clé d'idempotence est conservée par
 * travail jusqu'au succès : un rejeu après coupure ne crée jamais une deuxième ligne.
 */
export function useReprendreTravailDansOr(
  vehiculeId: string,
): UseMutationResult<void, unknown, VariablesReprise> {
  const queryClient = useQueryClient();
  const cles = useRef(new Map<string, string>());

  return useMutation({
    meta: { succes: 'commun:toasts.travailReporteRepris' },
    mutationFn: async ({ travail, orId }: VariablesReprise) => {
      const cleMemo = `${orId}:${travail.id}`;
      let cle = cles.current.get(cleMemo);
      if (!cle) {
        cle = genererCleIdempotence();
        cles.current.set(cleMemo, cle);
      }
      await creerLigneOrdreReparation(orId, ligneDepuisTravailReporte(travail), cle);
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
