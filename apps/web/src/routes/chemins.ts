/**
 * Constructeurs de chemins typés pour le lot 1 (Clients + Véhicules). Le site sélectionné est
 * **un paramètre de requête** (`?site=`), jamais un état global : deux onglets ouverts sur deux
 * sites différents ne doivent pas se contredire (plan frontend §9.3). Un chemin construit ici
 * conserve donc le site courant plutôt que de le perdre à la navigation.
 */

function construireChemin(
  base: string,
  parametres: Record<string, string | undefined> = {},
): string {
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
  /** Tableau de bord — ressource par TENANT, `?site=` OPTIONNEL (contrairement à
   *  `clients`/`vehicules` ci-dessous, un site absent est un état légitime qui agrège tous les
   *  sites du tenant, `ReponseActiviteTableauBord.siteId: string | null`) mais conservé au même
   *  titre pour rester cohérent avec le reste de l'app (deux onglets sur deux sites différents ne
   *  doivent pas se contredire). */
  tableauBord: (site?: string) => construireChemin('/tableau-bord', { site }),
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
  /** Ordres de réparation (lot 1, atelier) — même mécanique `?site=` que `clients`/`vehicules`
   *  ci-dessus (`EcranListeOrdresReparation` lit `site` depuis l'URL, jamais depuis la session).
   *  Chemin littéral `/ordres-reparation` (pas `/atelier/ordres-reparation`) : c'est le préfixe déjà
   *  posé dans `routeur.tsx` pour la liste et la fiche (`ordres-reparation/:orId`) — seule la route
   *  de création vit sous `atelier/ordres-reparation/nouveau` (repris tel quel du design), non
   *  reproduite ici car aucun lien de menu n'y pointe.
   */
  atelier: {
    ordresReparation: {
      liste: (site?: string) => construireChemin('/ordres-reparation', { site }),
      detail: (id: string, site?: string) => construireChemin(`/ordres-reparation/${id}`, { site }),
    },
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
    /** Singleton par TENANT (`GET|PATCH /parametrage/pieces`), même famille que `atelier`/
     *  `referentiels` ci-dessus — pas de `?site=`. À la différence de ces deux-là, la route est
     *  gardée par `rolesAutorises={ROLES_PARAMETRAGE_PIECES}` (`routeur.tsx`) : la lecture elle-même
     *  est restreinte côté API (`pieces.parametrage.lire`), pas seulement l'écriture. */
    pieces: () => '/parametrage/pieces',
  },
  /** Module pièces (étape 3). Même mécanique `?site=` que `clients`/`vehicules` : la recherche
   *  comptoir et le réapprovisionnement sont scopés par site (RP-03/RP-12), la fiche et la liste
   *  d'articles comme les réservations restent des ressources par TENANT (le site n'y est qu'un
   *  filtre optionnel). */
  pieces: {
    rechercheComptoir: (site?: string) => construireChemin('/pieces/recherche-comptoir', { site }),
    articles: (site?: string) => construireChemin('/pieces/articles', { site }),
    articleDetail: (id: string, site?: string) =>
      construireChemin(`/pieces/articles/${id}`, { site }),
    reservations: (site?: string) => construireChemin('/pieces/reservations', { site }),
    reapprovisionnement: (site?: string) =>
      construireChemin('/pieces/reapprovisionnement', { site }),
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
    /** Borne d'atelier (mode « borne partagée », identification par PIN) — route distincte de
     *  `saisie` ci-dessus, réservée au compte de service `poste_atelier`
     *  (`RouteProtegee.rolesAutorises` dans `routeur.tsx`) : un technicien avec sa propre session
     *  utilise `saisie`, la borne murale partagée utilise `borne`. */
    borne: () => '/pointage/borne',
  },
  /** Hangar à pneus (Lot B, `docs/specification-parc-et-hangar-pneus.md`). `hangar` suit la même
   *  mécanique `?site=` que `clients`/`vehicules`/`pieces` ci-dessus — `GET
   *  /sites/{siteId}/hangar-pneus` est scopé par site, le site sélectionné vient de l'URL, jamais
   *  d'un état global. `aRelancer` n'IMPOSE pas de site (`GET /depots-pneus/a-relancer` accepte un
   *  `siteId` optionnel, défaut tenant entier, RPP-04) mais le conserve quand même s'il est déjà
   *  connu, même raisonnement que `tableauBord` ci-dessus. */
  pneus: {
    hangar: (site?: string) => construireChemin('/pneus', { site }),
    aRelancer: (site?: string) => construireChemin('/pneus/a-relancer', { site }),
  },
  /** Module ventes VN/VO (étape 4). Repris À L'IDENTIQUE des chemins locaux posés par les agents
   *  qui ont livré les écrans — `ecrans/ventes/stock/_composants/chemins-locaux.ts`
   *  (`cheminsStockVentes`) et `ecrans/ventes/dossiers/chemins-dossiers.ts`, tous deux marqués
   *  « provisoire, à fusionner ici » par leurs auteurs. Ces deux fichiers restent en place pour
   *  l'instant (hors périmètre de ce câblage) : à supprimer dans un passage ultérieur au profit du
   *  bloc ci-dessous, une fois que les écrans qui les importent encore auront été repointés ici.
   *
   *  `stock` suit la même mécanique `?site=` que `pieces`/`clients`/`vehicules` ci-dessus (le site
   *  sélectionné est un paramètre de requête, jamais un état global). `dossiers.nouveau` accepte en
   *  plus `?clientId=`/`?vehiculeId=` — un dossier peut s'ouvrir pré-rempli depuis la fiche d'un
   *  client ou celle d'un véhicule en stock. Reprise et Financement N'ONT PAS de chemin : ce sont
   *  des cartes intégrées à la fiche dossier (design gelé §8-9), pas des écrans autonomes.
   */
  ventes: {
    stock: {
      liste: (site?: string) => construireChemin('/ventes/stock', { site }),
      nouveau: (site?: string) => construireChemin('/ventes/stock/nouveau', { site }),
      detail: (id: string, site?: string) => construireChemin(`/ventes/stock/${id}`, { site }),
    },
    dossiers: {
      liste: (site?: string) => construireChemin('/ventes/dossiers', { site }),
      nouveau: (site?: string, clientId?: string, vehiculeId?: string) =>
        construireChemin('/ventes/dossiers/nouveau', { site, clientId, vehiculeId }),
      detail: (id: string, site?: string) => construireChemin(`/ventes/dossiers/${id}`, { site }),
    },
    /** Suivi financement & garantie — vue dérivée des dossiers de vente (`GET /ventes/suivi`, même
     *  droit `ventes.dossier.lire` que `dossiers` ci-dessus). Même mécanique `?site=`. */
    suivi: (site?: string) => construireChemin('/ventes/suivi', { site }),
  },
} as const;
