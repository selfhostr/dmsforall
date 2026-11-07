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
   *  cours d'écriture (lot dédié) — même forme que `clients`/`vehicules` ci-dessous. */
  recherche: {
    globale: (site?: string) => construireChemin('/recherche', { site }),
  },
  clients: {
    liste: (site?: string) => construireChemin('/clients', { site }),
    /** PAS de constructeur `nouveau` ici : la création d'un client n'est PAS une route distincte
     *  (`/clients/nouveau` n'existe pas dans `routeur.tsx`, seuls `clients` et `clients/:id` y sont
     *  déclarés) — c'est un panneau latéral (`Sheet`) monté par `EcranListeClients`
     *  (`FormulaireNouveauClient`), qui reste sur `/clients`. Un ancien constructeur `nouveau`
     *  pointait vers cette route inexistante ; retiré au nettoyage de la refonte de navigation
     *  faute d'appelant réel (seule `routes/chemins.spec.ts` le référençait — un test du chemin
     *  lui-même, pas un écran qui y naviguerait).
     */
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
      /** Création d'un OR — SEULE route de la ressource qui ne vit pas sous `/ordres-reparation`
       *  (préfixe `/atelier/`, repris tel quel du design, cf. `routeur.tsx`). Constructeur ajouté
       *  au Lot D pour que le modèle de navigation puisse rattacher cette URL à l'onglet
       *  « Ordres de réparation » d'Atelier : sans lui, l'écran de création serait le seul écran
       *  d'atelier sans onglet actif. `clientId` pré-remplit le client (l'écran lit les deux en
       *  paramètres de requête, jamais en paramètre de chemin). */
      nouveau: (site?: string, clientId?: string) =>
        construireChemin('/atelier/ordres-reparation/nouveau', { site, clientId }),
      /** Facturation d'un OR (`/ordres-reparation/:orId/facturer`) — passerelle atelier ->
       *  facturation, rattachée à l'onglet « Ordres de réparation » par son préfixe. */
      facturer: (id: string, site?: string) =>
        construireChemin(`/ordres-reparation/${id}/facturer`, { site }),
    },
    /** Agenda des rendez-vous (Lot RDV-1, `docs/conception-rendez-vous-ecrans.md`) — chemin
     *  littéral `/rendez-vous` (pas `/atelier/rendez-vous`) : même convention que
     *  `ordresReparation.liste`/`detail` ci-dessus, c'est le préfixe que lit `routeur.tsx`. Un
     *  agenda reste TOUJOURS scopé à un seul site (RV-06) — `?site=` conservé au même titre que le
     *  reste de l'app. */
    rendezVous: {
      agenda: (site?: string) => construireChemin('/rendez-vous', { site }),
    },
    courtoisie: (site?: string) => construireChemin('/courtoisie', { site }),
  },
  /** Facturation (étape 2) — ces chemins n'avaient AUCUN constructeur avant le Lot D : la barre
   *  latérale pointait `/factures` en chaîne brute et les écrans de facturation naviguaient en
   *  gabarit littéral (`` `/factures/${id}/avoir` ``). Le menu à six entrées a besoin de cibles
   *  typées, et le `?site=` conservé ici corrige au passage une perte de contexte réelle : cliquer
   *  « Facturation » abandonnait le site courant de l'URL, et l'en-tête retombait sur « Tous les
   *  sites » alors que l'utilisateur n'avait pas changé de site. `EcranListeFactures` ignore ce
   *  paramètre (il ne filtre pas par site aujourd'hui) — il n'est là que pour la continuité du
   *  contexte affiché, exactement comme `tableauBord` ci-dessus. */
  facturation: {
    liste: (site?: string) => construireChemin('/factures', { site }),
    detail: (id: string, site?: string) => construireChemin(`/factures/${id}`, { site }),
    /** `id` est la facture D'ORIGINE à partir de laquelle l'avoir est émis, pas l'avoir lui-même
     *  (qui n'existe pas encore quand cet écran s'ouvre) — voir `routeur.tsx`. */
    avoir: (id: string, site?: string) => construireChemin(`/factures/${id}/avoir`, { site }),
  },
  /** Paramétrage — singletons par TENANT (facturation, référentiels, atelier), jamais par site :
   *  pas de `?site=` à conserver pour ceux-là (contrairement à `clients`/`vehicules` ci-dessus).
   *  `sites` est la seule exception du groupe : `GET|PATCH /sites/{siteId}/parametres-atelier`
   *  (capacité, heures d'ouverture, clôture du pointage) est réellement scopé par site — l'écran
   *  y sélectionne le site à paramétrer via `?site=`, même mécanisme que `clients`/`vehicules`.
   *
   *  Lot D : les trois singletons acceptent désormais un `site` OPTIONNEL, comme `tableauBord` et
   *  `facturation` ci-dessus. Les écrans continuent de l'ignorer (ce sont bien des réglages par
   *  tenant) ; le paramètre n'existe que pour ne pas perdre le site affiché dans l'en-tête en
   *  passant par un onglet de Réglages. Appelés sans argument, ils rendent exactement la même
   *  chaîne qu'avant — aucun appelant existant n'est affecté.
   */
  parametrage: {
    facturation: (site?: string) => construireChemin('/parametrage/facturation', { site }),
    referentiels: (site?: string) => construireChemin('/parametrage/referentiels', { site }),
    atelier: (site?: string) => construireChemin('/parametrage/atelier', { site }),
    sites: (site?: string) => construireChemin('/parametrage/sites', { site }),
    /** Singleton par TENANT (`GET|PATCH /parametrage/pieces`), même famille que `atelier`/
     *  `referentiels` ci-dessus — pas de `?site=`. À la différence de ces deux-là, la route est
     *  gardée par `rolesAutorises={ROLES_PARAMETRAGE_PIECES}` (`routeur.tsx`) : la lecture elle-même
     *  est restreinte côté API (`pieces.parametrage.lire`), pas seulement l'écriture. */
    pieces: (site?: string) => construireChemin('/parametrage/pieces', { site }),
    /** Gestion des employés (issue #137) — jamais scopé par site (le rôle vaut sur tout le
     *  tenant), `site` reçu pour la seule cohérence de sélecteur avec les autres onglets. */
    utilisateurs: (site?: string) => construireChemin('/parametrage/utilisateurs', { site }),
    /** Paliers de relance (scission de l'ancien `EcranRelances`, §4.5 : « paliers -> Réglages »).
     *  Singleton par TENANT comme `facturation`/`atelier` ci-dessus (`regle_relance` n'est jamais
     *  scopée par site) : `?site=` conservé uniquement pour la continuité du site affiché dans
     *  l'en-tête en passant par cet onglet, même mécanique que ses voisins. Gardée par
     *  `rolesAutorises={ROLES_RELANCES}` (`routes/droits-routes.ts`), comme `relances` ci-dessous :
     *  la lecture de la règle est restreinte à `direction`/`comptable` côté API. */
    relances: (site?: string) => construireChemin('/parametrage/relances', { site }),
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
      liste: (site?: string) => construireChemin('/pieces/commandes-fournisseur', { site }),
      nouvelle: (site?: string) =>
        construireChemin('/pieces/commandes-fournisseur/nouvelle', { site }),
      detail: (id: string, site?: string) =>
        construireChemin(`/pieces/commandes-fournisseur/${id}`, { site }),
    },
    fournisseurs: {
      liste: (site?: string) => construireChemin('/pieces/fournisseurs', { site }),
      detail: (id: string, site?: string) =>
        construireChemin(`/pieces/fournisseurs/${id}`, { site }),
    },
    /** Factures fournisseur (dépôt/rapprochement) — même famille que `commandesFournisseur`
     *  ci-dessus : ressource par TENANT, pas de filtrage par site dans les écrans livrés
     *  (`EcranListeFacturesFournisseur` ne lit aucun `site`), `?site=` conservé uniquement pour la
     *  continuité du site affiché dans l'en-tête en passant par cet onglet. Chemins littéraux
     *  (`/pieces/factures-fournisseur`, `.../deposer`, `.../:id`) déjà consommés tels quels par les
     *  trois écrans (`navigate`/`Link` en dur, voir leurs specs) — repris ici à l'identique plutôt
     *  qu'inventés, pour que `navigation-modele.ts` ait un constructeur typé sans rien changer aux
     *  écrans (hors périmètre). Segment statique `deposer` déclaré séparément de `:id`, même
     *  convention que `commandes-fournisseur/nouvelle` ci-dessus. */
    facturesFournisseur: {
      liste: (site?: string) => construireChemin('/pieces/factures-fournisseur', { site }),
      deposer: (site?: string) =>
        construireChemin('/pieces/factures-fournisseur/deposer', { site }),
      detail: (id: string, site?: string) =>
        construireChemin(`/pieces/factures-fournisseur/${id}`, { site }),
    },
    consignes: (site?: string) => construireChemin('/pieces/consignes', { site }),
  },
  /** Module pointage (lot 2). Ressources par TENANT, jamais de `?site=` dans les écrans livrés —
   *  contrairement à `pieces`/`clients`/`vehicules`, le pointage se filtre par technicien et par
   *  période, pas par site. */
  pointage: {
    saisie: (site?: string) => construireChemin('/pointage', { site }),
    jour: (site?: string) => construireChemin('/pointage/jour', { site }),
    equipe: (site?: string) => construireChemin('/pointage/equipe', { site }),
    /** CONSERVÉ délibérément malgré la fusion Lot D (`ecrans/pointage/EcranPointage.tsx`, dont le
     *  commentaire de tête suggérait de le retirer) : `composants/layout/navigation-modele.ts`
     *  (hors périmètre d'écriture de `routes/`) construit encore sa vue « Clôture » avec ce
     *  constructeur, et `routes/atteignabilite.spec.ts` verrouille explicitement que
     *  `/pointage/cloture` résout sur cette vue. Le retirer casserait la compilation d'un fichier
     *  hors périmètre et ferait rougir un test qu'il ne faut pas affaiblir — voir le commentaire de
     *  la route `pointage/cloture` dans `routeur.tsx` pour le signalement complet. La route rend
     *  aujourd'hui `EcranPointage`, comme `jour`/`equipe` ci-dessus — le geste de clôture lui-même
     *  vit désormais dans `DialogueCloturePeriode`, monté par l'onglet Équipe. */
    cloture: (site?: string) => construireChemin('/pointage/cloture', { site }),
    /** Borne d'atelier (mode « borne partagée », identification par PIN) — route distincte de
     *  `saisie` ci-dessus, réservée au compte de service `poste_atelier`
     *  (`RouteProtegee.rolesAutorises` dans `routeur.tsx`) : un technicien avec sa propre session
     *  utilise `saisie`, la borne murale partagée utilise `borne`. */
    borne: () => '/pointage/borne',
  },
  /** Hangar à pneus (Lot B, `docs/specification-parc-et-hangar-pneus.md` ; fusion Lot D). `hangar`
   *  suit la même mécanique `?site=` que `clients`/`vehicules`/`pieces` ci-dessus — `GET
   *  /sites/{siteId}/hangar-pneus` est scopé par site, le site sélectionné vient de l'URL, jamais
   *  d'un état global.
   *
   *  `aRelancer` ne pointe PLUS vers une route séparée depuis le Lot D : l'ancien écran
   *  `EcranJeuxARelancer` est supprimé, fusionné dans `EcranHangarPneus` comme onglet
   *  (`TabsContent value="a_relancer"`, lu depuis `?onglet=`, voir le commentaire de tête
   *  d'`EcranHangarPneus.tsx`). Un lien externe (menu, futur bloc « Aujourd'hui ») doit continuer à
   *  atterrir directement sur cet onglet — d'où `onglet: 'a_relancer'` conservé ici plutôt qu'un
   *  chemin `/pneus/a-relancer` qui n'a plus d'écran à monter (la route correspondante a été
   *  retirée de `routeur.tsx`). `site` reste optionnel et conservé quand connu, même raisonnement
   *  que `tableauBord` ci-dessus — `GET /depots-pneus/a-relancer` accepte un `siteId` optionnel
   *  (défaut tenant entier, RPP-04). */
  pneus: {
    hangar: (site?: string) => construireChemin('/pneus', { site }),
    aRelancer: (site?: string) => construireChemin('/pneus', { onglet: 'a_relancer', site }),
  },
  /** Module ventes VN/VO (étape 4). Les chemins locaux posés provisoirement par les lots qui ont
   *  livré les écrans (`ecrans/ventes/stock/_composants/chemins-locaux.ts`,
   *  `ecrans/ventes/dossiers/chemins-dossiers.ts`) ont été fusionnés ici au commit `4dbdca2` ; ces
   *  deux fichiers n'existent plus dans le dépôt.
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
  /** Relances automatiques (rappels de facture impayée, lot 1) — singleton par TENANT, comme
   *  `parametrage.facturation` ci-dessus : `regle_relance` n'est jamais scopée par site, donc
   *  aucun `?site=` à conserver ici. Gardée par `rolesAutorises={ROLES_RELANCES}`
   *  (`routes/droits-routes.ts`) : la lecture elle-même est restreinte à `direction`/`comptable`
   *  côté API. */
  relances: (site?: string) => construireChemin('/relances', { site }),
  /** Scanner de permis de circulation (mobile) — même mécanique `?site=` que `clients`/
   *  `vehicules` ci-dessus : le client/véhicule créé depuis le scan hérite du site courant du
   *  comptoir. Gardée par `rolesAutorises={ROLES_SCAN}` (`routes/droits-routes.ts`) : seuls les
   *  rôles qui peuvent réellement créer un client ET un véhicule (`client.creer`/`vehicule.creer`
   *  côté API) atteignent cette route, sinon l'écran serait un cul-de-sac (formulaire prérempli
   *  qu'aucune soumission ne peut jamais faire aboutir). Voir aussi `composants/layout/
   *  useModeScanMobile.ts` : sur téléphone, ces mêmes rôles y sont redirigés automatiquement. */
  scan: (site?: string) => construireChemin('/scan', { site }),
  /** Reprise de données (dépôt de l'archive d'un ancien logiciel, `packages/shared/src/contrats/
   *  reprise.ts`) — PAS de `?site=`, à la différence de tout ce qui précède : `DossierReprise`
   *  n'a aucune notion de site dans le contrat (`ReponseDossierReprise` ne porte aucun champ
   *  `siteId`), c'est une opération globale au TENANT entier, comme `parametrage.facturation`/
   *  `relances` ci-dessus. Hors du menu (`routes/atteignabilite.spec.ts`, `HORS_MENU`) : geste
   *  d'onboarding exceptionnel, pas un usage quotidien de garage. */
  reprise: {
    accueil: () => '/reprise-donnees',
  },
} as const;
