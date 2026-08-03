/**
 * Constructeurs de chemins typés pour le lot 1 (Clients + Véhicules). Le site sélectionné est
 * **un paramètre de requête** (`?site=`), jamais un état global : deux onglets ouverts sur deux
 * sites différents ne doivent pas se contredire (plan frontend §9.3). Un chemin construit ici
 * conserve donc le site courant plutôt que de le perdre à la navigation.
 */

function construireChemin(base: string, parametres: Record<string, string | undefined> = {}): string {
  const recherche = new URLSearchParams();
  for (const [cle, valeur] of Object.entries(parametres)) {
    if (valeur !== undefined && valeur !== '') {
      recherche.set(cle, valeur);
    }
  }
  const chaineRecherche = recherche.toString();
  return chaineRecherche === '' ? base : `${base}?${chaineRecherche}`;
}

export const chemins = {
  /** Absent avant cet ajout alors que `GET /recherche` existe déjà côté API et que l'écran est en
   *  cours d'écriture (agent dédié) — même forme que `clients`/`vehicules` ci-dessous. */
  recherche: {
    globale: (site?: string) => construireChemin('/recherche', { site }),
  },
  clients: {
    liste: (site?: string) => construireChemin('/clients', { site }),
    nouveau: (site?: string) => construireChemin('/clients/nouveau', { site }),
    detail: (id: string, site?: string) => construireChemin(`/clients/${id}`, { site }),
    fusion: (id: string, site?: string) => construireChemin(`/clients/${id}/fusion`, { site }),
    /** `GET /doublons-clients` (RM-05) n'accepte aucun paramètre `site` — c'est une recherche par
     *  critères (nom, NPA, email, téléphone, IDE) saisis dans l'écran, pas un listing scopé par
     *  site comme `liste` ci-dessus (voir `schemaParametresDoublonsClients`,
     *  `packages/shared/src/contrats/atelier/client.ts`). Chemin littéral `/clients/doublons`, PAS
     *  à la racine comme l'API (`/doublons-clients`) : côté web, React Router (v6) classe toujours
     *  un segment statique (`doublons`) avant un segment dynamique (`:id`) quelle que soit l'ordre
     *  de déclaration des routes — la contrainte qui a placé l'endpoint API à la racine ne
     *  s'applique pas ici, et `/clients/doublons` reste l'URL la plus lisible pour un outil
     *  contextuel à la gestion des clients.
     */
    doublons: () => '/clients/doublons',
  },
  vehicules: {
    liste: (site?: string) => construireChemin('/vehicules', { site }),
    nouveau: (site?: string) => construireChemin('/vehicules/nouveau', { site }),
    detail: (id: string, site?: string) => construireChemin(`/vehicules/${id}`, { site }),
  },
  /** Paramétrage — singletons par TENANT (facturation, référentiels, atelier), jamais par site :
   *  pas de `?site=` à conserver pour ceux-là (contrairement à `clients`/`vehicules` ci-dessus).
   *  `sites` est la seule exception du groupe : `GET|PATCH /sites/{siteId}/parametres-atelier`
   *  (capacité, heures d'ouverture, clôture du pointage) est réellement scopé par site — l'écran
   *  y sélectionne le site à paramétrer via `?site=`, même mécanisme que `clients`/`vehicules`.
   */
  parametrage: {
    facturation: () => '/parametrage/facturation',
    referentiels: () => '/parametrage/referentiels',
    atelier: () => '/parametrage/atelier',
    sites: (site?: string) => construireChemin('/parametrage/sites', { site }),
  },
  /** Module pièces (étape 3). Même mécanique `?site=` que `clients`/`vehicules` : la recherche
   *  comptoir et le réapprovisionnement sont scopés par site (RP-03/RP-12), la fiche et la liste
   *  d'articles comme les réservations restent des ressources par TENANT (le site n'y est qu'un
   *  filtre optionnel). */
  pieces: {
    rechercheComptoir: (site?: string) => construireChemin('/pieces/recherche-comptoir', { site }),
    articles: (site?: string) => construireChemin('/pieces/articles', { site }),
    articleDetail: (id: string, site?: string) => construireChemin(`/pieces/articles/${id}`, { site }),
    reservations: (site?: string) => construireChemin('/pieces/reservations', { site }),
    reapprovisionnement: (site?: string) => construireChemin('/pieces/reapprovisionnement', { site }),
    /** Commandes fournisseur — ressources par TENANT (pas de `?site=` : ni la liste ni la fiche
     *  d'une commande fournisseur ne se filtrent par site dans les écrans livrés). */
    commandesFournisseur: {
      liste: () => '/pieces/commandes-fournisseur',
      nouvelle: () => '/pieces/commandes-fournisseur/nouvelle',
      detail: (id: string) => `/pieces/commandes-fournisseur/${id}`,
    },
    fournisseurs: {
      liste: () => '/pieces/fournisseurs',
      detail: (id: string) => `/pieces/fournisseurs/${id}`,
    },
    consignes: () => '/pieces/consignes',
  },
  /** Module pointage (lot 2). Ressources par TENANT, jamais de `?site=` dans les écrans livrés —
   *  contrairement à `pieces`/`clients`/`vehicules`, le pointage se filtre par technicien et par
   *  période, pas par site. */
  pointage: {
    saisie: () => '/pointage',
    jour: () => '/pointage/jour',
    equipe: () => '/pointage/equipe',
    cloture: () => '/pointage/cloture',
  },
} as const;
