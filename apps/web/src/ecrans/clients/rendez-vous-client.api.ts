import type { PageCurseur, ReponseRendezVous } from '@dfa/shared';

import { requeteApi } from '@/api/client';
import { ajouterJours, versDateIsoLocale } from '@/hooks/rendez-vous/periode-agenda';

/** Fenêtre « à venir » côté fiche client/véhicule — aucune borne documentée par le contrat pour
 *  cette liste précise (contrairement à l'agenda, bornée par la période affichée à l'écran) :
 *  simplification assumée, signalée dans le rapport de livraison. */
const FENETRE_A_VENIR_JOURS = 180;

/**
 * `GET /rendez-vous?du=&au=&clientId=&statut=confirme` — rendez-vous À VENIR d'un client, pour la
 * fiche client (point d'entrée 2, constat terrain : « seul l'agenda est câblé »). `listerRendezVous`
 * (`hooks/rendez-vous/rendez-vous.api.ts`, hors périmètre d'écriture ici) ne sérialise que
 * `du`/`au`/`siteId` (`FiltresPeriodeRendezVous`) — `clientId` y serait silencieusement ignoré côté
 * client bien que `schemaFiltresRendezVous` (contrat serveur, `packages/shared`) le supporte.
 * Requête construite ICI, même doctrine que `EcranFicheVehicule.tsx` (« l'OR précédent ») :
 * `siteId` est OMIS volontairement (contrairement à l'agenda, RV-06 — capacité scopée à un site) —
 * un client peut avoir un rendez-vous à venir sur n'importe quel site du tenant, la fiche n'est
 * jamais limitée à un seul.
 */
export async function listerRendezVousAVenirClient(
  clientId: string,
): Promise<readonly ReponseRendezVous[]> {
  const aujourdhui = new Date();
  const parametres = new URLSearchParams({
    du: versDateIsoLocale(aujourdhui),
    au: versDateIsoLocale(ajouterJours(aujourdhui, FENETRE_A_VENIR_JOURS)),
    clientId,
    statut: 'confirme',
    tri: 'creeLe:desc',
    limite: '20',
  });
  const page = await requeteApi<PageCurseur<ReponseRendezVous>>(
    `/rendez-vous?${parametres.toString()}`,
    { method: 'GET' },
  );
  return page?.donnees ?? [];
}
