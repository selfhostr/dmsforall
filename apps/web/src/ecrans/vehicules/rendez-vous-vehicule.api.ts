import type { PageCurseur, ReponseRendezVous } from '@dfa/shared';

import { requeteApi } from '@/api/client';
import { ajouterJours, versDateIsoLocale } from '@/hooks/rendez-vous/periode-agenda';

/** Même fenêtre que `rendez-vous-client.api.ts` (`ecrans/clients/`) — voir son commentaire. */
const FENETRE_A_VENIR_JOURS = 180;

/**
 * Rendez-vous À VENIR d'un véhicule, pour la fiche véhicule (point d'entrée 3). Filtre serveur
 * `vehiculeId` (`schemaFiltresRendezVous`, `packages/shared/src/contrats/rendezvous/rendez-vous.ts:131`,
 * appliqué au SQL dans `ServiceRendezVous.lister`, `apps/api/src/rendezvous/service-rendez-vous.ts:214-215`
 * — un identifiant existant rend les rendez-vous du véhicule, un identifiant inexistant rend une
 * liste vide, prouvé en appels réels et couvert par 27 tests côté service).
 *
 * CORRIGE issue #97 : l'ancienne implémentation interrogeait par le DÉTENTEUR courant
 * (`clientId`) faute de filtre `vehiculeId` côté serveur, puis filtrait côté client sur
 * `vehicule.id` — deux conséquences fausses, toutes deux corrigées par ce filtre direct :
 *  - un véhicule SANS détenteur courant n'affichait RIEN (aucun `clientId` à interroger) ;
 *  - un détenteur possédant plusieurs véhicules voyait aussi les rendez-vous de ses AUTRES
 *    véhicules avant le filtrage client (fenêtre de correction visible le temps du re-render).
 */
export async function listerRendezVousAVenirVehicule(
  vehiculeId: string,
): Promise<readonly ReponseRendezVous[]> {
  const aujourdhui = new Date();
  const parametres = new URLSearchParams({
    du: versDateIsoLocale(aujourdhui),
    au: versDateIsoLocale(ajouterJours(aujourdhui, FENETRE_A_VENIR_JOURS)),
    vehiculeId,
    statut: 'confirme',
    tri: 'creeLe:desc',
    limite: '50',
  });
  const page = await requeteApi<PageCurseur<ReponseRendezVous>>(
    `/rendez-vous?${parametres.toString()}`,
    { method: 'GET' },
  );
  return page?.donnees ?? [];
}
