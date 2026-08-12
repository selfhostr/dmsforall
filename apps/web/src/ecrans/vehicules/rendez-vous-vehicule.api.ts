import type { PageCurseur, ReponseRendezVous } from '@dfa/shared';

import { requeteApi } from '@/api/client';
import { ajouterJours, versDateIsoLocale } from '@/hooks/rendez-vous/periode-agenda';

/** Même fenêtre que `rendez-vous-client.api.ts` (`ecrans/clients/`) — voir son commentaire. */
const FENETRE_A_VENIR_JOURS = 180;

/**
 * Rendez-vous À VENIR d'un véhicule, pour la fiche véhicule (point d'entrée 3). `schemaFiltresRendezVous`
 * (`packages/shared/src/contrats/rendezvous/rendez-vous.ts`, contrat gelé, hors périmètre
 * d'écriture ici) ne porte AUCUN filtre `vehiculeId` — seuls `siteId`/`statut`/`clientId` existent
 * côté serveur (`apps/api/src/rendezvous/service-rendez-vous.ts`, méthode `lister`). Impossible
 * d'interroger « les rendez-vous de CE véhicule » directement : on interroge donc par le DÉTENTEUR
 * courant (`clientId`, filtre supporté) puis on filtre côté client sur `vehicule.id` pour ne garder
 * que ceux qui désignent précisément ce véhicule — un détenteur peut avoir plusieurs véhicules et
 * plusieurs rendez-vous, l'un pour chacun.
 *
 * BLOQUÉ SANS DÉTENTEUR CONNU (signalé dans le rapport de livraison, pas corrigé — hors périmètre
 * d'écriture, `packages/shared` et `apps/api`) : un véhicule sans détenteur courant n'a aucun
 * `clientId` à interroger, et aucun filtre `vehiculeId` n'existe pour le remplacer. Modification
 * minimale nécessaire côté propriétaire de ces fichiers : ajouter
 * `vehiculeId: schemaIdentifiant.optional()` à `schemaFiltresRendezVous` (rendez-vous.ts:122-129)
 * et `if (filtres.vehiculeId !== undefined) conditions.push(eq(rendezVous.vehiculeId,
 * filtres.vehiculeId));` dans `ServiceRendezVous.lister` (service-rendez-vous.ts, à côté de la
 * condition `clientId` existante, ligne ~212).
 */
export async function listerRendezVousAVenirVehicule(
  clientDetenteurId: string,
  vehiculeId: string,
): Promise<readonly ReponseRendezVous[]> {
  const aujourdhui = new Date();
  const parametres = new URLSearchParams({
    du: versDateIsoLocale(aujourdhui),
    au: versDateIsoLocale(ajouterJours(aujourdhui, FENETRE_A_VENIR_JOURS)),
    clientId: clientDetenteurId,
    statut: 'confirme',
    tri: 'creeLe:desc',
    limite: '50',
  });
  const page = await requeteApi<PageCurseur<ReponseRendezVous>>(
    `/rendez-vous?${parametres.toString()}`,
    { method: 'GET' },
  );
  return (page?.donnees ?? []).filter((rdv) => rdv.vehicule?.id === vehiculeId);
}
