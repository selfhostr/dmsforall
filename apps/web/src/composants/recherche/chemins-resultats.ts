import type { TypeResultatRecherche } from '@dfa/shared';

import { chemins } from '@/routes/chemins';

/** `chemins.ts` (routes/) n'a pas encore d'entrée Atelier ni Facturation — modules en cours de
 *  câblage par d'autres chantiers (périmètre disjoint). Même sémantique que `construireChemin` :
 *  le site n'est ajouté que s'il est déjà défini, jamais inventé. Route confirmée par
 *  `routes/routeur.tsx` : `ordres-reparation/:id`. */
function cheminOr(id: string, site: string | undefined): string {
  return site
    ? `/ordres-reparation/${id}?site=${encodeURIComponent(site)}`
    : `/ordres-reparation/${id}`;
}

/** Même raison que `cheminOr` ci-dessus. Route confirmée par `routes/routeur.tsx` : `factures/:id`
 *  (`EcranFicheFacture` lit `useParams<{ id: string }>()`, pas `:factureId`). */
function cheminFacture(id: string, site: string | undefined): string {
  return site ? `/factures/${id}?site=${encodeURIComponent(site)}` : `/factures/${id}`;
}

/**
 * Destination d'un résultat sélectionné, par nature — UNIQUE point de vérité, partagé par
 * `RechercheGlobale.tsx` (palette de commande) et `EcranRecherche.tsx` (route dédiée) : les deux
 * portaient auparavant deux copies quasi identiques de ce même `Record`, factorisées ici pour
 * n'avoir plus qu'un seul endroit à corriger la prochaine fois qu'une nature de résultat apparaît.
 *
 * `Record` exhaustif sur `TypeResultatRecherche` (§ enums.ts) : l'ajout d'une nature future casse
 * la compilation ici plutôt que de silencieusement ne rien faire au clic — ne JAMAIS contourner
 * cette exhaustivité avec un `as`, une signature d'index ou un `Partial`.
 *
 * Le site sélectionné (`?site=` de l'URL courante) est propagé vers chaque destination qui accepte
 * un site — perdre le site en sortant de la recherche romprait le même contrat que perdre `?site=`
 * en sortant de la liste clients/véhicules (routes/chemins.ts).
 *
 * `article` -> fiche article (`chemins.pieces.articleDetail`, ressource par tenant, `?site=` en
 * filtre optionnel comme le reste du module pièces).
 *
 * `fournisseur` -> fiche fournisseur (`chemins.pieces.fournisseurs.detail`) — ressource par
 * TENANT, aucun `?site=` dans sa signature (même famille que `commandesFournisseur` dans
 * `chemins.ts`) ; le site courant n'est donc pas transmis, il n'y a rien à y faire.
 *
 * `depot_pneu` -> PAS de fiche individuelle livrée pour un dépôt de pneus (vérifié dans
 * `ecrans/pneus/` et `routes/chemins.ts` : ni chemin dédié, ni paramètre de mise en évidence
 * d'une case précise sur `EcranHangarPneus`). Pointe donc vers l'écran de liste le plus utile,
 * le hangar (`chemins.pneus.hangar`), avec le site courant propagé — SIGNALÉ : un futur
 * `?depotId=` mettant en évidence la case correspondante fermerait cet écart, mais inventer ce
 * paramètre ici (sans qu'`EcranHangarPneus` sache le lire) romprait le clic en silence.
 */
export const CONSTRUCTEURS_CHEMIN_RESULTAT: Record<
  TypeResultatRecherche,
  (id: string, site: string | undefined) => string
> = {
  vehicule: (id, site) => chemins.vehicules.detail(id, site),
  client: (id, site) => chemins.clients.detail(id, site),
  ordre_reparation: (id, site) => cheminOr(id, site),
  document_vente: (id, site) => cheminFacture(id, site),
  article: (id, site) => chemins.pieces.articleDetail(id, site),
  fournisseur: (id) => chemins.pieces.fournisseurs.detail(id),
  depot_pneu: (_id, site) => chemins.pneus.hangar(site),
};
