import type { PageCurseur, ReponseOrdreReparation, StatutOrdreReparation } from '@dfa/shared';

import { requeteApi } from '@/api/client';

/**
 * `GET /ordres-reparation?technicienId=&statut[]=` — « Mes OR du jour » (écran de pointage du
 * technicien). Transport DÉDIÉ, PAS une réutilisation de `hooks/atelier/ordres-reparation.api.ts` :
 * ce fichier — hors périmètre d'écriture de cet agent — expose `FiltresListeOrdresReparation` sans
 * `technicienId` ET avec `statut` en mono-sélection, alors que le contrat serveur
 * (`schemaFiltresOrdresReparation`, `contrats/atelier/ordre-reparation.ts`) accepte bel et bien les
 * deux : `statut` y est un TABLEAU. Étendre le hook partagé serait la solution la plus propre à
 * terme (signalé au rapport de livraison de ce module plutôt que fait ici, par respect du
 * périmètre disjoint) ; en attendant, ce petit transport local suffit à ce seul besoin, sans
 * dupliquer ni contourner le hook existant pour les écrans qui, eux, n'ont pas besoin de filtrer
 * par technicien.
 *
 * CORRECTIF (bug carte/détail incohérente, OR-2026-15) — deux constats vérifiés en relisant
 * `apps/api/src/atelier/service-or.ts` (`ServiceOr.lister`), qui restent hors périmètre d'écriture
 * de cet agent (`apps/api/**` interdit) et sont donc SIGNALÉS ici plutôt que corrigés :
 * 1. `technicienId` est bien accepté par `schemaFiltresOrdresReparation` (validation OK), mais
 *    `ServiceOr.lister` ne l'ajoute PAS à ses conditions SQL (`conditions = [tenantId, siteId,
 *    clientId, vehiculeId, statut]` — `technicienId` en est absent). Le paramètre est donc envoyé
 *    en vain : la liste renvoyée par ce transport n'est PAS filtrée par technicien côté serveur, à
 *    la différence de ce qu'affirmait le commentaire précédent (« vérifié » — ça ne l'était pas).
 * 2. `ServiceOr.lister` construit sa page via `assemblerDocument`, qui renvoie le DOCUMENT COMPLET
 *    (`ReponseOrdreReparation`, `lignes` incluses) pour chaque OR — pas la projection légère
 *    `OrdreReparationResume` (celle-là vient d'un calcul SQL différent, `nombreLignes` y comptant
 *    TOUTES les lignes non annulées sans distinction de technicien, voir
 *    `clients/service-client-ordres-reparation.ts`). Ce fichier typait la réponse en
 *    `OrdreReparationResume` par erreur — un type plus étroit que ce que le serveur renvoie
 *    réellement pour cet endpoint (`PageOrdreReparationDto` = page de `ReponseOrdreReparationDto`,
 *    voir `ordre-reparation.controller.ts`). Corrigé en `ReponseOrdreReparation` : c'est ce qui
 *    permet à l'écran de compter les lignes RÉELLEMENT assignées (`lignes-assignees.ts`) au lieu du
 *    total serveur.
 */
export interface FiltresMesOrdresAssignes {
  readonly technicienId: string;
  readonly statut: readonly StatutOrdreReparation[];
  readonly tri: string;
}

function construireParametres(filtres: FiltresMesOrdresAssignes, limite: number): string {
  const parametres = new URLSearchParams();
  parametres.set('technicienId', filtres.technicienId);
  for (const valeur of filtres.statut) parametres.append('statut', valeur);
  parametres.set('tri', filtres.tri);
  parametres.set('limite', String(limite));
  return parametres.toString();
}

export async function listerMesOrdresAssignes(
  filtres: FiltresMesOrdresAssignes,
  limite: number,
): Promise<PageCurseur<ReponseOrdreReparation>> {
  const page = await requeteApi<PageCurseur<ReponseOrdreReparation>>(
    `/ordres-reparation?${construireParametres(filtres, limite)}`,
    { method: 'GET' },
  );
  return page ?? { donnees: [], curseurSuivant: null, limite };
}
