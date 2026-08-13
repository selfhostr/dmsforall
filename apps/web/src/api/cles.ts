/**
 * Fabrique de clés TanStack Query — l'intégralité de l'étape 1 (lots 1 à 5), posée une fois en
 * vague 0 puis **gelée** (plan-etape-1-frontend.md §5.1) : c'est le fichier le plus exposé aux
 * conflits de fusion, personne d'autre n'y touche ensuite. Un seul endroit pour éviter les clés
 * incohérentes entre les hooks qui lisent et ceux qui invalident/purgent le cache.
 *
 * Convention : chaque clé est un tuple plat `[domaine, sous-ressource, ...paramètres]`, jamais de
 * concaténation de chaîne. Les sous-ressources sont volontairement des frères (pas nichées sous
 * `detail`) pour que l'invalidation d'une clé précise (ex. `or.detail(id)`) ne balaie jamais par
 * accident une sous-ressource lourde et rarement ouverte (ex. `or.journal(id)`) — voir la table
 * d'invalidation §5.3, qui les liste toujours séparément.
 *
 * Les types des filtres et des DTO restent dans les hooks de domaine (`src/hooks/<domaine>/`),
 * pas ici : `src/api/` est la couche transport, rien d'autre. Les filtres sont donc typés en
 * structure ouverte — seule leur présence dans la clé (pour la dérivation du cache) compte ici.
 */

/** Filtres de liste : forme ouverte, le hook de domaine connaît la forme réelle (générée depuis
 *  l'OpenAPI). Seules des valeurs primitives sérialisables doivent y figurer. */
type FiltresListe = Record<string, string | number | boolean | undefined>;

export const clesQuery = {
  session: () => ['auth', 'me'] as const,

  /** Absent de la vague 0 (gelée) alors que `GET /sante` existe déjà côté API — ajout additif
   *  pour `useVersionApplication` (hooks/useVersionApplication.ts), même patron que
   *  `parametres.site` ci-dessous. */
  sante: {
    version: () => ['sante', 'version'] as const,
  },

  recherche: {
    globale: (terme: string) => ['recherche', 'globale', terme] as const,
  },

  parametres: {
    atelier: () => ['parametres', 'atelier'] as const,
    /** Absent de la vague 0 (gelée) alors que `GET /sites/{id}/parametres-atelier` existe déjà
     *  côté API — ajout additif pour `useParametresSite` (hooks/parametres/), même forme que les
     *  autres clés paramétrées par ressource ci-dessous. */
    site: (siteId: string) => ['parametres', 'site', siteId] as const,
  },

  referentiels: {
    prestations: (q?: string) => ['referentiels', 'prestations', q ?? ''] as const,
    techniciens: (site: string) => ['referentiels', 'techniciens', site] as const,
    motifsRdv: () => ['referentiels', 'motifsRdv'] as const,
    checklists: () => ['referentiels', 'checklists'] as const,
  },

  clients: {
    liste: (filtres: FiltresListe = {}) => ['clients', 'liste', filtres] as const,
    detail: (id: string) => ['clients', 'detail', id] as const,
    vehicules: (id: string) => ['clients', 'vehicules', id] as const,
    ordres: (id: string) => ['clients', 'ordres', id] as const,
    doublons: (critere: string) => ['clients', 'doublons', critere] as const,
    // Sous-collections de la fiche (onglets) — ajoutées lors du câblage des écrans liste/fiche
    // (L1-16) : `ServiceClientSousCollections` (apps/api/src/clients/) les expose séparément de
    // `GET /clients/{id}`, contrairement aux notes d'ALERTE, embarquées dans `ReponseClient` via
    // `notesAlerte` (RM-13) — donc pas de clé dédiée pour celles-ci, elles vivent sous `detail`.
    contacts: (id: string) => ['clients', 'contacts', id] as const,
    adresses: (id: string) => ['clients', 'adresses', id] as const,
    conditions: (id: string) => ['clients', 'conditions', id] as const,
    consentements: (id: string) => ['clients', 'consentements', id] as const,
    notes: (id: string) => ['clients', 'notes', id] as const,
  },

  vehicules: {
    liste: (filtres: FiltresListe = {}) => ['vehicules', 'liste', filtres] as const,
    detail: (id: string) => ['vehicules', 'detail', id] as const,
    contexteAtelier: (id: string) => ['vehicules', 'contexteAtelier', id] as const,
    travauxReportes: (id: string) => ['vehicules', 'travauxReportes', id] as const,
    kilometrages: (id: string) => ['vehicules', 'kilometrages', id] as const,
  },

  rdv: {
    plage: (site: string, du: string, au: string) => ['rdv', 'plage', site, du, au] as const,
    detail: (id: string) => ['rdv', 'detail', id] as const,
    charge: (site: string, du: string, au: string) => ['rdv', 'charge', site, du, au] as const,
  },

  or: {
    liste: (filtres: FiltresListe = {}) => ['or', 'liste', filtres] as const,
    vue: (nomVue: string, site: string) => ['or', 'vue', nomVue, site] as const,
    detail: (id: string) => ['or', 'detail', id] as const,
    journal: (id: string) => ['or', 'journal', id] as const,
    documents: (id: string) => ['or', 'documents', id] as const,
  },

  pointages: {
    ouverts: (site: string) => ['pointages', 'ouverts', site] as const,
    technicienJour: (technicienId: string, date: string) =>
      ['pointages', 'technicienJour', technicienId, date] as const,
    anomalies: (site: string) => ['pointages', 'anomalies', site] as const,
  },

  prets: {
    liste: (site: string) => ['prets', 'liste', site] as const,
    detail: (id: string) => ['prets', 'detail', id] as const,
  },

  /** Absent de la vague 0 (gelée) — ajout additif pour la gestion des employés (issue #137),
   *  même patron que `parametres.site` ci-dessus : un domaine neuf, pas une modification d'une
   *  clé existante. */
  utilisateurs: {
    liste: () => ['utilisateurs', 'liste'] as const,
  },
} as const;
