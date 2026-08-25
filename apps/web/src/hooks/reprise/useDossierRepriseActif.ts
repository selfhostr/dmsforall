import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { STATUTS_DOSSIER_REPRISE_TERMINAUX, type ReponseDossierReprise } from '@dfa/shared';

import { clesReprise } from './cles';
import { listerDossiers } from './reprise.api';

/** `null` = aucun dossier de reprise n'existe encore (premier usage, état vide légitime — jamais
 *  une erreur). Jamais `undefined` : TanStack Query rejette une donnée de requête `undefined`
 *  (`Query data cannot be undefined`), et la doctrine du dépôt distingue de toute façon
 *  explicitement « pas encore chargé » (`undefined`/`isPending`) d'« absence confirmée » (`null`) —
 *  ce ne sont jamais le même état. */
async function recupererDossierActif(): Promise<ReponseDossierReprise | null> {
  const page = await listerDossiers(1);
  return page.donnees[0] ?? null;
}

function estTerminal(statut: ReponseDossierReprise['statut'] | undefined): boolean {
  return statut !== undefined && STATUTS_DOSSIER_REPRISE_TERMINAUX.includes(statut);
}

/** Intervalle de sondage du dossier actif — extrait en fonction pure testable indépendamment du
 *  cycle de vie TanStack Query. `false` = sondage arrêté : soit AUCUN dossier n'existe (rien à
 *  observer, premier usage), soit le dossier a atteint un statut TERMINAL
 *  (`import_termine`/`annule`, `STATUTS_DOSSIER_REPRISE_TERMINAUX`). Sondé uniquement quand un
 *  dossier existe ET progresse encore. */
export function calculerIntervalleSondageDossier(
  dossier: ReponseDossierReprise | null | undefined,
): number | false {
  if (dossier == null) return false;
  return estTerminal(dossier.statut) ? false : 4_000;
}

/**
 * Le dossier de reprise « actif » — le plus récent (`GET /reprise/dossiers?tri=creeLe:desc`,
 * `limite=1`). Le contrat n'expose AUCUN `GET /reprise/dossiers/{id}` (voir `reprise.api.ts`),
 * cette collection est donc la SEULE source de vérité pour l'état du dossier, y compris pendant
 * les transitions automatiques (`depot_receptionne -> analyse_en_cours`,
 * `analyse_terminee -> plan_propose`, `plan_valide -> import_en_cours`) qu'aucune action de
 * l'écran ne déclenche : c'est ce sondage qui les révèle.
 *
 * Sondage arrêté dès que le dossier atteint un statut TERMINAL
 * (`STATUTS_DOSSIER_REPRISE_TERMINAUX` : `import_termine`/`annule`) — jamais de requête en boucle
 * indéfinie sur un dossier dont plus rien ne bougera côté serveur.
 */
export function useDossierRepriseActif(): UseQueryResult<ReponseDossierReprise | null> {
  return useQuery({
    queryKey: clesReprise.dossiers.liste(),
    queryFn: recupererDossierActif,
    refetchInterval: (requete) => calculerIntervalleSondageDossier(requete.state.data),
  });
}
