import type { OrdreReparationResume, PageCurseur } from '@dfa/shared';
import { STATUTS_OR_TABLEAU_BORD } from '@dfa/shared';

import { requeteApi } from '@/api/client';

/**
 * Couche transport DÉDIÉE à la carte « OR en attente de pièces » du chef d'atelier (issue #74) —
 * même raison que `hooks/accueil/echeances-or.api.ts` : `GET /ordres-reparation` appartient au
 * domaine atelier (chantier en vol au moment d'écrire ce widget), et ce fichier ne touche aucun
 * fichier de `apps/api/src/atelier/**`/`apps/web/src/ecrans/atelier/**`.
 *
 * POURQUOI compter côté client plutôt que demander `?attente=pieces` au serveur : vérifié en
 * exécution le 12.08.2026, ce filtre n'est PAS câblé — `ServiceOr.lister`
 * (`apps/api/src/atelier/service-or.ts`) le documente lui-même (« SIMPLIFICATION SIGNALÉE : `vue`,
 * `attente`, ... ne sont pas câblés dans cette passe »). `?attente=pieces` renvoie donc la liste
 * complète, non filtrée. On demande à la place les OR encore actifs (les six statuts de
 * `STATUTS_OR_TABLEAU_BORD` — SEUL filtre de cette liste réellement câblé côté serveur) et on
 * compte côté client ceux dont `etatAffiche === 'attente_pieces'`.
 *
 * `etatAffiche`, pas `statut` : « attente pièces » n'est PAS un statut de la machine à états, c'est
 * un drapeau ORTHOGONAL (A-03, `contrats/atelier/enums.ts`) — un OR `en_cours` peut être
 * simultanément bloqué faute de pièce. `etatAffiche` est le champ dérivé, calculé UNE FOIS côté
 * serveur, qui retient le plus bloquant des trois drapeaux (`accord > pieces > externe`) : un OR à
 * la fois `attente_accord` ET `attente_pieces` compte donc comme « accord » ici (léger sous-compte
 * assumé, jamais un sur-compte).
 *
 * Deux limites assumées, à lever le jour où `ServiceTableauBordActivite` expose un vrai snapshot
 * agrégé (SQL scalaire, comme `lignesEnAttenteValidation` — voir
 * `apps/api/src/tableau-bord/service-tableau-bord-activite.ts`) : le champ manquerait alors à
 * `ReponseActiviteTableauBord` (`packages/shared/**`, hors périmètre d'écriture de ce lot) et ce
 * fichier disparaîtrait au profit d'une simple lecture de ce champ.
 *  - la priorité `accord > pieces > externe` sous-compte les OR doublement bloqués (ci-dessus) ;
 *  - plafonné à `LIMITE` OR actifs : au-delà, sous-compte silencieux pour un tenant très chargé.
 */
export interface FiltresOrAttentePieces {
  readonly siteId?: string;
}

const LIMITE = 200;

function construireParametres(filtres: FiltresOrAttentePieces): string {
  const parametres = new URLSearchParams();
  for (const statut of STATUTS_OR_TABLEAU_BORD) parametres.append('statut', statut);
  if (filtres.siteId) parametres.set('siteId', filtres.siteId);
  parametres.set('limite', String(LIMITE));
  return parametres.toString();
}

/** Nombre d'OR actifs dont `etatAffiche === 'attente_pieces'` — voir la doc de tête pour la
 *  méthode et ses limites assumées. */
export async function compterOrEnAttentePieces(filtres: FiltresOrAttentePieces): Promise<number> {
  const page = await requeteApi<PageCurseur<OrdreReparationResume>>(
    `/ordres-reparation?${construireParametres(filtres)}`,
    { method: 'GET' },
  );
  const donnees = page?.donnees ?? [];
  return donnees.filter((or) => or.etatAffiche === 'attente_pieces').length;
}
