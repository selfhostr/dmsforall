import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type {
  EntreeDemarragePointage,
  ReponseAvecAvertissements,
  ReponsePointage,
  SessionCourante,
} from '@dfa/shared';

import { clesQuery } from '@/api/cles';

import { clesPointage } from './cles';
import { demarrerPointage } from './pointage.api';

interface VariablesDemarragePointage {
  readonly entree: EntreeDemarragePointage;
  /** Une clé neuve par tentative — RM-87 : démarrer est un ÉVÉNEMENT, pas un formulaire persistant
   *  (voir `api/idempotence.ts`, `genererCleIdempotence()` appelée par l'écran au moment du geste,
   *  jamais réutilisée d'un pointage à l'autre). */
  readonly idempotencyKey: string;
}

interface ContexteOptimiste {
  readonly precedent: ReponsePointage | null | undefined;
}

/**
 * `POST /pointages` — optimiste (CONTRIBUTING.md : « optimistic updates sur les actions fréquentes comme
 * le pointage »). Le technicien doit voir son chrono démarrer À L'INSTANT du tap, pas après un
 * aller-retour réseau : `onMutate` pose immédiatement un pointage provisoire dans le cache
 * `ouvertTechnicien`, `onError` le retire, `onSuccess` le remplace par la réponse RÉELLE du serveur
 * (qui peut porter `avertissements`, ex. `POINTAGE_CLOTURE_AUTOMATIQUE` — RM-89, un précédent
 * pointage ouvert vient d'être refermé de force par ce démarrage).
 *
 * Le pointage provisoire ne porte AUCUN champ dérivé serveur (`dureeBruteSecondes`,
 * `dureeArrondieCentiemes` restent `null`, cohérent avec un pointage encore `en_cours`) — seul ce
 * qui est nécessaire à l'affichage immédiat du chrono (`debutLe`, la cible) est déjà connu côté
 * client au moment du geste.
 *
 * `technicienNomAffiche` (RM voir `pointage.ts` — « Prénom Nom », jamais construit côté client
 * pour la réponse RÉELLE du serveur) : cette contrainte vise la ressource canonique, pas ce
 * provisoire jetable. Le seul appelant actuel (`EcranPointageTechnicien`) pointe TOUJOURS pour
 * l'utilisateur de la session courante (jamais un paramètre de route) : on relit donc la session
 * déjà en cache TanStack Query (`clesQuery.session()`, sans y souscrire) et on ne l'utilise que si
 * elle correspond au `technicienId` de cette entrée précise — sinon chaîne vide, remplacée dès
 * `onSuccess` par la valeur réelle du serveur. Jamais de valeur trompeuse affichée, même une
 * fraction de seconde.
 */
export function useDemarrerPointage(): UseMutationResult<
  ReponseAvecAvertissements<ReponsePointage>,
  unknown,
  VariablesDemarragePointage,
  ContexteOptimiste
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ entree, idempotencyKey }: VariablesDemarragePointage) =>
      demarrerPointage(entree, idempotencyKey),

    onMutate: async ({ entree }) => {
      const cle = clesPointage.ouvertTechnicien(entree.technicienId);
      await queryClient.cancelQueries({ queryKey: cle });
      const precedent = queryClient.getQueryData<ReponsePointage | null>(cle);

      const session = queryClient.getQueryData<SessionCourante | null>(clesQuery.session());
      const technicienNomAffiche =
        session?.utilisateur.id === entree.technicienId
          ? `${session.utilisateur.prenom} ${session.utilisateur.nom}`
          : '';

      const provisoire: ReponsePointage = {
        id: entree.id,
        siteId: entree.siteId,
        technicienId: entree.technicienId,
        technicienNomAffiche,
        statut: 'en_cours',
        nature: entree.nature,
        ordreReparationId: 'ordreReparationId' in entree ? entree.ordreReparationId : null,
        ligneOrId: 'ligneOrId' in entree ? entree.ligneOrId : null,
        activiteIndirecte: 'activiteIndirecte' in entree ? entree.activiteIndirecte : null,
        source: entree.source ?? 'ecran_atelier',
        appareilId: entree.appareilId ?? null,
        debutLe: entree.debutLe,
        finLe: null,
        dureeBruteSecondes: null,
        dureeArrondieCentiemes: null,
        clotureAutomatique: false,
        anomalie: null,
        derniereCorrection: null,
        creeLe: entree.debutLe,
        modifieLe: entree.debutLe,
      };
      queryClient.setQueryData(cle, provisoire);

      return { precedent };
    },

    onError: (_erreur, { entree }, contexte) => {
      queryClient.setQueryData(
        clesPointage.ouvertTechnicien(entree.technicienId),
        contexte?.precedent ?? null,
      );
    },

    onSuccess: (reponse, { entree }) => {
      queryClient.setQueryData(clesPointage.ouvertTechnicien(entree.technicienId), reponse.donnees);
      queryClient.setQueryData(clesPointage.detail(reponse.donnees.id), reponse.donnees);
    },

    onSettled: (_reponse, _erreur, { entree }) => {
      // Balaie par PRÉFIXE toute variante de filtre/tri déjà en cache (même patron que
      // `useCreerOrdreReparation`) — la liste jour/semaine et la vue équipe doivent refléter le
      // nouveau pointage dès que le serveur a tranché, succès ou échec.
      void queryClient.invalidateQueries({ queryKey: ['pointages', 'liste'] });
      // Préfixe à 3 éléments (sans la date) : balaie TOUTES les journées déjà mises en cache pour
      // ce technicien, pas seulement celle d'aujourd'hui — `clesQuery.pointages.technicienJour`
      // pose la date en 4ᵉ position de la clé, l'omettre ici la rend englobante.
      void queryClient.invalidateQueries({
        queryKey: ['pointages', 'technicienJour', entree.technicienId],
      });
      void queryClient.invalidateQueries({ queryKey: clesPointage.ouvertsSite(entree.siteId) });
    },
  });
}
