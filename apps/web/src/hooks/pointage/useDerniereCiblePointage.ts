import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { CibleReprisePointage } from '@dfa/shared';

import { clesPointage } from './cles';
import { obtenirDernierPointageDuJour } from './pointage.api';

/**
 * `GET /pointages/dernier-du-jour` — la cible PRODUCTIVE de reprise, résolue par le SERVEUR (P-34,
 * `docs/proposition-refonte-pointage.md` §1.4/§7) : remplace l'ancien `dernierCible` en `useState`
 * de `EcranPointageTechnicien.tsx` — volatile, perdu au rechargement de page, et CRITIQUE en mode
 * borne où chaque identification PIN recharge intégralement l'écran (aucun état client ne peut y
 * survivre d'une identification à l'autre).
 *
 * TROIS ÉTATS EXPLICITES, à traiter distinctement par l'écran appelant (jamais confondus) :
 *  - en chargement (`isPending`) : `data` vaut `undefined`, aucun bandeau tant que la réponse n'est
 *    pas connue — pas de sursaut de mise en page une fois la vraie valeur arrivée ;
 *  - vide (`data === null`) : aucune cible productive pointée aujourd'hui — cas NORMAL, pas une
 *    erreur, aucun bandeau non plus, mais silencieusement (pas d'`EtatErreur`) ;
 *  - en erreur (`isError`) : `data` reste `undefined` — repli IDENTIQUE au chargement, VOLONTAIRE :
 *    ce complément est purement additif (aide à reprendre plus vite), sa panne ne doit JAMAIS
 *    empêcher l'écran de démarrer un nouveau pointage. Pas de retry dédié, pas de message dédié.
 *
 * `technicienId` : identifiant du technicien concerné (session personnelle OU identification PIN à
 * la borne) — sert de CLÉ DE CACHE dans les deux cas (jamais deux techniciens mélangés dans le même
 * cache) mais n'est envoyé en PARAMÈTRE DE REQUÊTE que si `pourAutrui` (mode borne) : sur l'écran
 * personnel, le serveur infère déjà le bon technicien depuis la session — le lui envoyer quand même
 * exigerait à tort `atelier.pointage.pointer_autrui` (droit d'encadrement qu'un technicien ordinaire
 * n'a pas), voir l'en-tête du contrat `pointage.ts`, § « technicienId en QUERY, OPTIONNEL ».
 */
export function useDerniereCiblePointage(
  technicienId: string | undefined,
  options?: { readonly pourAutrui?: boolean },
): UseQueryResult<CibleReprisePointage | null> {
  const pourAutrui = options?.pourAutrui ?? false;
  return useQuery({
    // Liste/état critique du poste : toujours frais, rechargé au retour sur l'onglet (le défaut du
    // QueryClient — 30 s, sans rechargement au focus — ne s'applique pas ici).
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryKey: clesPointage.derniereCible(technicienId ?? ''),
    queryFn: async () => {
      const reponse = await obtenirDernierPointageDuJour(pourAutrui ? technicienId : undefined);
      return reponse.cible;
    },
    enabled: Boolean(technicienId),
  });
}
