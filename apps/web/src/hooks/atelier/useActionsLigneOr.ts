import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type {
  EntreeAnnulationLignes,
  EntreeCreationLigneOr,
  EntreeRefusLignes,
  EntreeValidationLignes,
  ReponseAvecAvertissements,
  ReponseLigneOr,
  ReponseOrdreReparation,
} from '@dfa/shared';

import { clesQuery } from '@/api/cles';

import {
  annulerLignesOrdreReparation,
  creerLigneOrdreReparation,
  marquerLigneOrRealisee,
  refuserLignesOrdreReparation,
  validerLignesOrdreReparation,
} from './ordres-reparation.api';
import { useActionOrdreReparation } from './useTransitionsOrdreReparation';

interface VariablesCreationLigneOr {
  readonly entree: EntreeCreationLigneOr;
  /** Une clé par ligne (RM-49 : la saisie se fait en rafale) — voir le commentaire d'en-tête de
   *  `api/idempotence.ts`. Générée par l'appelant à l'instant du clic, jamais mémorisée. */
  readonly idempotencyKey: string;
}

/**
 * `POST /ordres-reparation/{orId}/lignes` (§7.8, `atelier.ligne.creer` — voir
 * `ecrans/atelier/droits.ts`) — couche TanStack Query pure, consommée par
 * `DialogueAjoutLigneOr.tsx`.
 *
 * À la différence des transitions et des actions groupées ci-dessous, la réponse ne porte que la
 * LIGNE créée (`EnveloppeLigneOrDto`), jamais le document OR complet : `nombreLignes`,
 * `totauxParPayeur`, `attentes` et `actionsDisponibles` ne peuvent être reconstruits sans le
 * serveur. Le document est donc INVALIDÉ (relecture), pas posé directement en cache.
 */
export function useCreerLigneOr(
  orId: string,
): UseMutationResult<ReponseAvecAvertissements<ReponseLigneOr>, unknown, VariablesCreationLigneOr> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ entree, idempotencyKey }: VariablesCreationLigneOr) =>
      creerLigneOrdreReparation(orId, entree, idempotencyKey),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clesQuery.or.detail(orId) });
    },
  });
}

/** §10 L967 — Action groupée ATOMIQUE : `proposee|a_valider -> validee`. Droit
 *  `atelier.ligne.valider` (réceptionnaire, chef d'atelier, direction, admin). */
export function useValiderLignesOr(orId: string) {
  return useActionOrdreReparation<EntreeValidationLignes>(orId, validerLignesOrdreReparation);
}

/** `a_valider -> refusee` (CT-33), motif optionnel. Droit `atelier.ligne.refuser`. */
export function useRefuserLignesOr(orId: string) {
  return useActionOrdreReparation<EntreeRefusLignes>(orId, refuserLignesOrdreReparation);
}

/** Annulation avec motif OBLIGATOIRE (RM-71) — toute ligne non facturée. Droit
 *  `atelier.ligne.annuler`. */
export function useAnnulerLignesOr(orId: string) {
  return useActionOrdreReparation<EntreeAnnulationLignes>(orId, annulerLignesOrdreReparation);
}

/** Statuts déjà au-delà de « réalisée » : rien à renvoyer (idempotence côté client). */
const STATUTS_DEJA_REALISES: ReadonlySet<ReponseLigneOr['statut']> = new Set([
  'realisee',
  'facturee',
]);

/**
 * « Marquer les lignes comme réalisées » (action proposée `MARQUER_LIGNES_REALISEES`, I-10) :
 * `POST .../lignes/{ligneId}/marquer-realisee` pour CHAQUE ligne, une à la fois (pas d'endpoint
 * groupé). S'arrête à la première erreur et la relance telle quelle (`ErreurApi`, message
 * `problem+json` intact) ; les lignes déjà passées sont reportées dans le cache pour qu'un nouvel
 * essai ne les renvoie pas. Une ligne que le cache connaît déjà « réalisée » n'est jamais envoyée.
 * Dans tous les cas (succès ou échec partiel) le document OR est invalidé (relecture serveur).
 */
export function useMarquerLignesRealisees(
  orId: string,
): UseMutationResult<number, unknown, readonly string[]> {
  const queryClient = useQueryClient();
  const cleOr = clesQuery.or.detail(orId);

  return useMutation({
    mutationFn: async (ligneIds: readonly string[]) => {
      let envoyees = 0;
      for (const ligneId of new Set(ligneIds)) {
        const connue = queryClient
          .getQueryData<ReponseOrdreReparation>(cleOr)
          ?.lignes.find((ligne) => ligne.id === ligneId);
        if (connue && STATUTS_DEJA_REALISES.has(connue.statut)) continue;
        const reponse = await marquerLigneOrRealisee(orId, ligneId);
        envoyees += 1;
        queryClient.setQueryData<ReponseOrdreReparation>(cleOr, (or) =>
          or
            ? {
                ...or,
                lignes: or.lignes.map((ligne) =>
                  ligne.id === ligneId ? { ...ligne, statut: reponse.donnees.statut } : ligne,
                ),
              }
            : or,
        );
      }
      return envoyees;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: cleOr });
      void queryClient.invalidateQueries({ queryKey: ['or', 'liste'] });
    },
  });
}
