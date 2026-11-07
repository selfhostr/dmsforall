import type { ModuleApp, TypeResultatRecherche } from '@dfa/shared';
import { TYPES_RESULTAT_RECHERCHE } from '@dfa/shared';

import { peut, type ActionCitee, type ActionsSession } from '@/droits';

/**
 * Portillons de droit propres à CHAQUE nature de `GET /recherche` — dupliqués depuis
 * `apps/api/src/auth/matrice-droits.ts` (lus par `ServiceRecherche.rechercher`,
 * `apps/api/src/recherche/service-recherche.ts`), même chaîne de duplication assumée que
 * `ecrans/pieces/droits.ts` / `routes/droits-routes.ts` (frontière tenant/serveur jamais
 * franchie, le serveur reste l'arbitre final — un rôle sans le droit ne voit JAMAIS le résultat
 * correspondant, quoi que ce fichier calcule).
 *
 * RAISON D'ÊTRE, DISTINCTE des autres `droits.ts` du dépôt : ceux-là gardent une ACTION ou
 * l'ATTEINTE d'une route. Celui-ci ne garde rien — `GET /recherche` reste appelé pour tout rôle
 * authentifié, exactement comme avant. Il sert uniquement à ce que `PanneauResultatsRecherche`
 * puisse dire honnêtement « je n'ai pas cherché partout » plutôt que d'afficher un « aucun
 * résultat » qui laisserait croire que la donnée n'existe pas (défaut constaté : `admin` cherche
 * une référence d'article réellement présente au jeu de démo, `pieces.article.lire` lui est fermé
 * — RF-115 — et « Aucun résultat » sonne comme une absence de donnée alors que c'est une absence
 * de recherche à cet endroit).
 *
 * `vehicule`, `client`, `ordre_reparation` n'ont AUCUN portillon côté serveur (voir le corps de
 * `ServiceRecherche.rechercher` : seuls `document_vente`/`article`/`fournisseur`/`depot_pneu`
 * portent un portillon de droit SUPPLÉMENTAIRE, indépendant de `recherche.executer` déjà vérifié
 * pour les sept natures au niveau route) — toujours interrogées, quel que soit le rôle.
 */
const NATURES_TOUJOURS_CHERCHEES: ReadonlySet<TypeResultatRecherche> = new Set([
  'vehicule',
  'client',
  'ordre_reparation',
]);

/**
 * `facturation.document.lire` — fermé au seul `poste_atelier` (compte de service, `[]` littéral
 * sur tout le domaine facturation). Ouvert à `admin` : la note de tête de
 * `apps/api/src/recherche/service-recherche.ts` (§RF-116) le qualifie explicitement de « no-op
 * fonctionnel » aujourd'hui — accordé à TOUS les rôles de personne, `admin` compris.
 */
/** Nature « à portillon » -> action de lecture qui l'ouvre (lue dans `session.actions`). */
const PORTILLONS_PAR_NATURE: Partial<Record<TypeResultatRecherche, ActionCitee>> = {
  document_vente: 'facturation.document.lire',
  article: 'pieces.article.lire',
  fournisseur: 'pieces.fournisseur.lire',
  depot_pneu: 'pneus.depot.lire',
};

export function naturesRechercheesPourRole(
  actions: ActionsSession,
): readonly TypeResultatRecherche[] {
  return TYPES_RESULTAT_RECHERCHE.filter((nature) => {
    if (NATURES_TOUJOURS_CHERCHEES.has(nature)) return true;
    const portillon = PORTILLONS_PAR_NATURE[nature];
    return portillon !== undefined && peut(actions, portillon);
  });
}

export function recherchePerimetreRestreint(actions: ActionsSession): boolean {
  if (actions === undefined) return false;
  return naturesRechercheesPourRole(actions).length < TYPES_RESULTAT_RECHERCHE.length;
}

/**
 * Module du garage qui porte chaque nature de résultat (Réglages > Modules). Un module retiré
 * n'apparaît plus dans la recherche (Ctrl K comprise) ; absent : socle (clients, véhicules,
 * documents de vente), jamais retiré. Exhaustif sur `TypeResultatRecherche` : une nouvelle nature
 * oblige à dire de quel module elle dépend.
 */
export const MODULE_PAR_NATURE: Readonly<Record<TypeResultatRecherche, ModuleApp | undefined>> = {
  vehicule: undefined,
  client: undefined,
  ordre_reparation: 'atelier',
  document_vente: undefined,
  article: 'pieces',
  fournisseur: 'pieces',
  depot_pneu: 'pneus',
};
