import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useRef } from 'react';

import type { CanalDevis } from '@dfa/shared';

import { clesQuery } from '@/api/cles';
import { genererCleIdempotence } from '@/api/idempotence';

import { creerDevisComplementaire, repondreDevisComplementaire } from './ordres-reparation.api';

/** Comment le client a donné son accord — vocabulaire du comptoir, projeté sur `CanalDevis`. */
export const MODES_ACCORD_CLIENT = ['telephone', 'surPlace', 'email'] as const;
export type ModeAccordClient = (typeof MODES_ACCORD_CLIENT)[number];

const CANAL_PAR_MODE: Readonly<Record<ModeAccordClient, CanalDevis>> = {
  telephone: 'telephone',
  surPlace: 'comptoir',
  email: 'email',
};

export interface VariablesAccordClient {
  readonly ligneIds: readonly string[];
  /** Nom de la personne qui a donné l'accord — obligatoire (RM-81), texte libre. */
  readonly interlocuteurNom: string;
  readonly mode: ModeAccordClient;
  /** Plafond de l'OR inchangé : le devis le porte (`nouveauPlafondCentimes`, requis par le
   *  contrat) mais ne le reporte PAS sur l'OR. `0` quand l'OR n'a pas de plafond ou que le rôle ne
   *  le voit pas. */
  readonly plafondCentimes: number;
}

/**
 * « Accord obtenu : nom + comment » en UN geste. Le contrat n'offre pas de champ « accord » sur
 * `valider-lignes` (`{ ligneIds }` seul) ; la seule pièce probante qui enregistre QUI a répondu et
 * QUAND est le devis complémentaire (RM-79/RM-81). Ce hook enchaîne donc ses deux appels —
 * `POST .../devis-complementaires` puis `POST .../repondre` (`accepte`, horodaté maintenant) — ce
 * qui valide les lignes côté serveur, avec la trace complète (nom, canal, heure, devis numéroté).
 *
 * Reprise sur échec : si la création a réussi et la réponse échoue, un nouvel essai ne recrée PAS
 * un second devis — l'identifiant du devis déjà créé est mémorisé (pour les mêmes lignes) et seul
 * l'appel `repondre` est rejoué.
 */
export function useAccordClientLignes(
  orId: string,
): UseMutationResult<void, unknown, VariablesAccordClient> {
  const queryClient = useQueryClient();
  const devisCree = useRef<{ cleLignes: string; devisId: string } | null>(null);

  return useMutation({
    mutationFn: async (variables: VariablesAccordClient) => {
      const canal = CANAL_PAR_MODE[variables.mode];
      const cleLignes = [...variables.ligneIds].sort().join(',');
      let devisId = devisCree.current?.cleLignes === cleLignes ? devisCree.current.devisId : null;
      if (devisId === null) {
        const creation = await creerDevisComplementaire(
          orId,
          {
            ligneIds: [...variables.ligneIds],
            nouveauPlafondCentimes: variables.plafondCentimes,
            canal,
          },
          genererCleIdempotence(),
        );
        devisId = creation.donnees.id;
        devisCree.current = { cleLignes, devisId };
      }
      await repondreDevisComplementaire(
        orId,
        devisId,
        {
          decision: 'accepte',
          canal,
          interlocuteurNom: variables.interlocuteurNom.trim(),
          repondueLe: new Date().toISOString(),
        },
        genererCleIdempotence(),
      );
      devisCree.current = null;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: clesQuery.or.detail(orId) });
      void queryClient.invalidateQueries({ queryKey: ['or', 'liste'] });
    },
  });
}
