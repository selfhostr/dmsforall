import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { RapportImportReprise, StatutImportReprise } from '@dfa/shared';

import { clesReprise } from './cles';
import { recupererRapport } from './reprise.api';

/** `false` = sondage arrêté. Actif UNIQUEMENT tant que l'import tourne réellement (`en_cours`) —
 *  ni `en_attente` (rien n'a encore été écrit), ni un statut terminal (plus rien ne bougera côté
 *  serveur ; `EtapeImport` force un dernier rafraîchissement à l'arrivée sur ce palier, voir son
 *  en-tête, pour ne pas dépendre du timing du dernier tick de ce sondage). */
export function calculerIntervalleSondageRapport(
  statutImport: StatutImportReprise | undefined,
): number | false {
  return statutImport === 'en_cours' ? 3_000 : false;
}

/**
 * `GET /reprise/dossiers/{id}/rapport` — lisible dès que l'import a démarré (`statut !==
 *  'en_attente'`), pas seulement une fois terminé (montre ce qui a déjà été écrit même en cas
 *  d'échec en cours de route).
 *
 * DÉFAUT CORRIGÉ : ce hook ne portait auparavant aucun sondage propre — un commentaire affirmait
 * que `EtapeImport` le « relisait à chaque statut reçu du sondage de `useImportReprise` », mais
 * rien ne déclenchait réellement ce rechargement (`enabled` qui reste `true` ne redéclenche rien
 * côté TanStack Query) : le bilan restait figé sur son tout premier instantané pendant toute la
 * durée de l'import, y compris une fois `termine` — l'inverse de ce que documente l'en-tête de
 * `RapportImport` (« LA pièce qui rassure le garagiste que rien ne s'est perdu »). Sondé désormais
 * tant que l'import est `en_cours`, même cadence que `useImportReprise`. */
export function useRapportReprise(
  dossierId: string | undefined,
  rapportDisponible: boolean,
  statutImport?: StatutImportReprise,
): UseQueryResult<RapportImportReprise> {
  return useQuery({
    queryKey: clesReprise.rapport(dossierId ?? ''),
    queryFn: () => recupererRapport(dossierId as string),
    enabled: dossierId !== undefined && rapportDisponible,
    refetchInterval: calculerIntervalleSondageRapport(statutImport),
  });
}
