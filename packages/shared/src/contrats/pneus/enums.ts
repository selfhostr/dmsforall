/**
 * Enums métier du hangar à pneus (`docs/specification-parc-et-hangar-pneus.md`, repères
 * `RPP-xx`). Lot A de la spec — `depot_pneus` uniquement (§4.3), pas le plan du parc (§4.1,
 * conditionnel, Lot D différé).
 *
 * Même doctrine que `contrats/pieces/enums.ts` : valeurs en **snake_case**, miroir exact des
 * types PostgreSQL créés par `apps/api/src/db/migrations/0043_pneus_depot_pneus.sql`, deux
 * classes de compatibilité :
 *  - **GELÉS** (`x-dfa-enum-extensible: false`) — un client ne doit jamais rencontrer de valeur
 *    hors de la liste fermée, parce qu'un invariant structurel de la base en dépend exactement.
 *  - **EXTENSIBLES** (`x-dfa-enum-extensible: true`) — tout le reste ; un client tiers doit
 *    traiter une valeur inconnue comme « autre » et ne jamais échouer.
 */

/**
 * `saison_pneu` — **GELÉ**. Deux saisons, jamais une troisième en Suisse (RPP-02) : c'est
 * littéralement l'axe sur lequel repose l'index unique partiel `depot_pneus_actif_uk`
 * (`(tenant_id, vehicule_id, saison) WHERE statut IN ('en_depot', 'monte')`, RPP-02) et
 * l'inversion `changer-saison` (RPP-03, « inverse les statuts des DEUX jeux »). Un client qui
 * suppose exactement deux valeurs pour construire un sélecteur été/hiver ne doit jamais être
 * mis en défaut.
 */
export const SAISONS_PNEU = ['ete', 'hiver'] as const;
export type SaisonPneu = (typeof SAISONS_PNEU)[number];

/**
 * `statut_depot_pneus` — **GELÉ**. Machine à états à quatre valeurs (RPP-02, RPP-04, RPP-05) :
 * `en_depot`/`monte` sont les deux états ACTIFS que protège l'unicité partielle
 * (RPP-02 : « à un instant T, un véhicule a au plus un jeu `en_depot` par saison ») ; `a_relancer`
 * est atteint automatiquement après un délai sans mouvement (RPP-04) ; `sorti` est TERMINAL,
 * atteint uniquement par une action explicite avec motif obligatoire (RPP-05), jamais par
 * suppression de ligne. Gelé par la même raison que `STATUTS_RESERVATION_PIECE` (contrats/pieces)
 * : un client qui lit `statut` pour décider si un jeu compte comme « en dépôt actif » doit pouvoir
 * énumérer ces quatre valeurs sans repli sur « valeur inconnue ».
 */
export const STATUTS_DEPOT_PNEUS = ['en_depot', 'monte', 'a_relancer', 'sorti'] as const;
export type StatutDepotPneus = (typeof STATUTS_DEPOT_PNEUS)[number];

/**
 * `motif_sortie_depot_pneus` — extensible. Catégorise un événement déjà survenu (RPP-05, quatre
 * cas littéraux de la spec) — ne pilote aucune transition au-delà du CHECK « obligatoire quand
 * `statut = 'sorti'` », donc pas de raison de le geler. Même doctrine que
 * `MOTIFS_LIBERATION_RESERVATION` (contrats/pieces/enums.ts).
 */
export const MOTIFS_SORTIE_DEPOT_PNEUS = [
  'rendu_au_client',
  'vehicule_vendu',
  'mis_au_rebut',
  'autre',
] as const;
export type MotifSortieDepotPneus = (typeof MOTIFS_SORTIE_DEPOT_PNEUS)[number];
