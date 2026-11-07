import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';

import { AppShell } from '@/composants/layout/AppShell';
import { useSiteCourant } from '@/hooks/site/ContexteSiteCourant';
import { EcranConnexion } from '@/ecrans/EcranConnexion';
// `EcranRendezVous` (routé ci-dessous) est le CONTENEUR réseau ; il rend `EcranAgendaRendezVous`
// (présentation pure, testée séparément par fixtures locales) — l'écran métier existe donc bien
// dans ce fichier, à un niveau d'indirection près (`ecrans/rendez-vous/EcranAgendaRendezVous.tsx`).
import { EcranPageIntrouvable } from '@/ecrans/systeme/EcranPageIntrouvable';

import {
  EcranFicheOrdreReparation,
  EcranListeOrdresReparation,
  EcranNouvelOrdreReparation,
  EcranOrdreDepuisPlaque,
  EcranFicheClient,
  EcranListeClients,
  EcranAvoir,
  EcranFacturerOrdreReparation,
  EcranFicheFacture,
  EcranListeFactures,
  EcranDoublonsClients,
  EcranConsolePlateforme,
  EcranParametragePieces,
  EcranParametrageAtelier,
  EcranExportFiduciaire,
  EcranParametresFacturation,
  EcranReferentiels,
  EcranSites,
  EcranUtilisateurs,
  EcranConsignesPieces,
  EcranDepotFactureFournisseur,
  EcranFactureFournisseur,
  EcranFicheArticle,
  EcranFicheCommandeFournisseur,
  EcranFicheFournisseur,
  EcranListeArticles,
  EcranListeCommandesFournisseur,
  EcranListeFacturesFournisseur,
  EcranListeFournisseurs,
  EcranNouvelleCommandeFournisseur,
  EcranReapprovisionnement,
  EcranRechercheComptoirPieces,
  EcranReservationsPieces,
  EcranHangarPneus,
  EcranBornePointage,
  EcranPointage,
  EcranPointageTechnicien,
  EcranRecherche,
  EcranReglagesRelances,
  EcranRelances,
  EcranReprise,
  EcranScan,
  EcranRendezVous,
  EcranCourtoisie,
  EcranTableauBord,
  EcranFicheVehicule,
  EcranListeVehicules,
  EcranNouveauVehicule,
  EcranFicheDossierVente,
  EcranListeDossiersVente,
  EcranNouveauDossierVente,
  EcranEntreeEnStock,
  EcranFicheVehiculeStock,
  EcranListeVehiculesStock,
  EcranSuiviVentes,
} from './ecransParesseux';
import { ATTERRISSAGE_PAR_ROLE } from './atterrissage';
import { chemins } from './chemins';
import { RouteProtegee } from './RouteProtegee';
import { RoutePublique } from './RoutePublique';
import {
  ROLES_BORNE_POINTAGE,
  ROLES_GESTION_UTILISATEURS,
  ROLES_LECTURE_RENDEZ_VOUS,
  ROLES_PARAMETRAGE_PIECES,
  ROLES_PIECES,
  ROLES_PNEUS,
  ROLES_POINTAGE,
  ROLES_MENU_FINANCIER,
  ROLES_RELANCES,
  ROLES_SCAN,
  ROLES_TABLEAU_BORD_ACTIVITE,
  ROLES_VENTES,
} from './droits-routes';

/**
 * Convention structurelle qui fait qu'une route oubliée tombe du côté SÛR (même principe que la
 * garde côté API) : `/login` est la seule route PUBLIQUE de tout le tableau, explicitement sous
 * `RoutePublique`. Tout écran MÉTIER (garage) vit comme enfant de l'unique route protégée `/`
 * (sous `RouteProtegee` + `AppShell`) — c'est l'endroit naturel où ajouter un futur écran de
 * garage, à côté de ceux déjà listés ci-dessous, jamais un nouveau frère top-level : il n'y a pas
 * d'autre emplacement « pratique » qui échapperait à l'authentification tenant.
 *
 * EXCEPTION UNIQUE, posée au Lot D : `/console` (console d'exploitation plateforme, voir son
 * commentaire dédié ci-dessous). Ce n'est pas un écran de garage — ni tenant, ni `AppShell`, ni
 * menu — et son mécanisme de session est volontairement DISTINCT (`session_exploitant`, pas la
 * session tenant que `RouteProtegee` vérifie). Cette exception ne rouvre pas la règle ci-dessus
 * pour un futur écran métier : elle ne vaut que pour la console, dont le modèle d'accès est par
 * nature hors du tableau tenant.
 *
 * Exporté séparément de `routeur` (créé juste en dessous) pour que les tests puissent construire
 * un `createMemoryRouter` avec exactement cette configuration (voir routeur.spec.tsx), plutôt que
 * de la dupliquer.
 */

/**
 * Atterrissage des rôles de PILOTAGE (`ATTERRISSAGE_PAR_ROLE` ne les redirige pas, voir
 * `atterrissage.ts`) — CORRECTIF issue #91 (« le logiciel me redemande sans arrêt un site »). Avant
 * ce correctif, cette route rendait littéralement `<Navigate to="/tableau-bord" replace />` : un
 * utilisateur qui travaille toujours au même site atterrissait pourtant sur « aucun site » à
 * CHAQUE connexion, devant re-choisir un site qu'il avait déjà choisi la veille. Cette route lit
 * la préférence mémorisée (`hooks/site/ContexteSiteCourant.tsx`, posée par `SelecteurSiteEntete`
 * dès qu'un site est choisi une fois) et la propage dans l'URL d'atterrissage — `undefined` la
 * laisse simplement absente, comportement identique à avant pour un poste qui n'a encore jamais
 * choisi de site.
 */
function AtterrissageTableauBord() {
  const { preferenceSiteId } = useSiteCourant();
  return <Navigate to={chemins.tableauBord(preferenceSiteId)} replace />;
}

export const routesConfig: RouteObject[] = [
  {
    path: '/login',
    element: (
      <RoutePublique>
        <EcranConnexion />
      </RoutePublique>
    ),
  },
  // Console d'exploitation (palier 1, `docs/conception-console-exploitation-ecrans.md` §2 ;
  // modèle d'accès : `docs/conception-console-exploitation-acces.md`) — HORS de l'arborescence
  // métier, comme `/login` ci-dessus : ni `RouteProtegee`, ni `AppShell` (pas de barre latérale,
  // §2 de la conception des écrans). C'est un poste d'exploitation DFA, pas un écran de garage.
  //
  // PROTECTION — choix délibéré à faire valider, SIGNALÉ plutôt qu'inventé : la console a son
  // PROPRE mécanisme de session (`session_exploitant`, cookie et table distincts de la session
  // tenant — `apps/api/src/exploitation/service-session-exploitant.ts`,
  // `docs/conception-console-exploitation-acces.md` §4 point « noms de cookie distincts, gardes
  // distinctes »). Aucun hook frontend (`useSessionExploitant` ou équivalent) ni composant de garde
  // dédié n'existe encore dans ce dépôt à la date de ce lot. Envelopper cette route dans
  // `RouteProtegee` (qui appelle `useSession()`, LA session TENANT) serait donc doublement faux :
  // ça n'ouvrirait rien à un exploitant réel (il n'a pas de session tenant) et ça n'empêcherait pas
  // un employé de garage connecté sous n'importe quel rôle métier d'atteindre le shell de la page
  // (`RoleUtilisateur` ne modélise pas « personnel DFA » — en inventer un ici serait la sécurité de
  // façade que ce fichier interdit ailleurs, voir `droits-routes.ts`). La barrière réelle reste donc
  // côté serveur : `recupererSantePlateformeConsole` (`ecrans/console/console.api.ts`) appelle
  // `GET /exploitation/v1/garages`, qui exige `session_exploitant` et répond 401/403 sans elle —
  // `EcranConsolePlateforme` gère déjà cet échec proprement (`requete.isError`, `EtatErreur`,
  // aucune donnée de garage n'est jamais rendue sans réponse serveur valide). À CONSTRUIRE avant
  // mise en service réelle : un hook de session exploitant + un composant de garde dédié
  // (`RouteExploitantProtegee` ou équivalent), remplaçant ce commentaire par une vraie garde
  // frontend — périmètre l'équipe authentification/l'équipe frontend, hors de celui de ce lot (`routes/` sait
  // désormais monter l'écran, mais la décision d'accès reste ouverte).
  {
    path: '/console',
    element: <EcranConsolePlateforme />,
  },
  {
    path: '/',
    element: (
      <RouteProtegee>
        <AppShell />
      </RouteProtegee>
    ),
    children: [
      // Route index — le POINT D'ATTERRISSAGE de toute l'application. Le Lot 0 y avait posé
      // `redirectionParRole` pour le seul `poste_atelier` (borne murale) ; le Lot D l'a étendu aux
      // quatre rôles d'EXÉCUTION qui ont un plan de travail propre, en lisant la table de
      // l'arbitrage telle qu'elle est écrite dans `atterrissage.ts` — table complète et commentée
      // rôle par rôle là-bas, JAMAIS recopiée ici (deux copies divergeraient au premier ajout de
      // rôle).
      //
      // Ce n'est pas une restriction : chacun de ces rôles a le droit de voir `/`, on choisit de ne
      // pas le lui montrer parce qu'un lanceur générique n'est utile à personne qui sait déjà où il
      // va.
      //
      // FUSION Accueil/Tableau de bord (10.08.2026, `docs/design-tableau-bord-par-role.md`) :
      // `EcranAccueil` a disparu, plus de contenu propre à `/` — tout rôle qui n'est PAS redirigé
      // par `ATTERRISSAGE_PAR_ROLE` (les cinq rôles de PILOTAGE : direction, comptable,
      // chef_atelier, receptionnaire, admin) traverse `/` sans jamais y rester affiché, `<Navigate>`
      // vers `/tableau-bord` (route juste en dessous, SEULE désormais à porter un écran réel). Un
      // simple relais plutôt qu'un doublon : `/tableau-bord` reste la SEULE URL canonique du
      // tableau de bord (motif attendu par `composants/layout/navigation-modele.ts` pour
      // surligner l'onglet « Aujourd'hui » — un `/` qui rendrait directement `EcranTableauBord`
      // sans redirection laisserait cet onglet éteint pour qui y atterrit).
      {
        index: true,
        element: (
          <RouteProtegee redirectionParRole={ATTERRISSAGE_PAR_ROLE}>
            <AtterrissageTableauBord />
          </RouteProtegee>
        ),
      },
      // Tableau de bord fusionné (Accueil + Tableau de bord, `EcranTableauBord.tsx`) — restriction
      // RÉELLE côté API (`GET /tableau-bord/activite` ferme `poste_atelier`, voir `droits-routes.ts`
      // pour le détail complet et la distinction avec le bloc financier, géré EN PLUS à l'intérieur
      // de l'écran par rôle, pas ici).
      {
        path: 'tableau-bord',
        element: (
          <RouteProtegee rolesAutorises={ROLES_TABLEAU_BORD_ACTIVITE}>
            <EcranTableauBord />
          </RouteProtegee>
        ),
      },
      { path: 'recherche', element: <EcranRecherche /> },
      { path: 'clients', element: <EcranListeClients /> },
      { path: 'clients/:id', element: <EcranFicheClient /> },
      { path: 'vehicules', element: <EcranListeVehicules /> },
      // Segment statique `nouveau` déclaré AVANT `:vehiculeId` (même convention que
      // `clients/doublons` et `pieces/articles/nouvelle` ci-dessous) : React Router (v6) résout
      // sans ambiguïté quel que soit l'ordre, mais un ordre `nouveau` avant `:vehiculeId` évite le
      // piège qui a produit le bug initial (`GET /vehicules/nouveau` traité comme un identifiant).
      // Pas de `rolesAutorises` ici, à l'identique de `clients`/`clients/:id` juste au-dessus :
      // `vehicule.lire` est ouvert à tout rôle authentifié (`LECTURE_ETENDUE`,
      // `apps/api/src/auth/matrice-droits.ts`), la restriction réelle porte sur l'ÉCRITURE
      // (`vehicule.creer`, fermée à `technicien`/`comptable`/`vendeur`) — gérée par le `403` de
      // l'API et l'alerte générique de l'écran, jamais par une garde de route (voir
      // `droits-routes.ts`, cas de figure 1 : une garde de route n'a de sens que si la LECTURE
      // elle-même est restreinte, ce qui n'est pas le cas ici).
      { path: 'vehicules/nouveau', element: <EcranNouveauVehicule /> },
      { path: 'vehicules/:vehiculeId', element: <EcranFicheVehicule /> },
      { path: 'ordres-reparation', element: <EcranListeOrdresReparation /> },
      // Le paramètre s'appelle `orId` (pas `id`) pour matcher exactement ce que
      // `EcranFicheOrdreReparation` lit via `useParams<{ orId: string }>()` — sinon `orId` est
      // `undefined`, `useOrdreReparation` reste `enabled: false`, et la fiche reste bloquée en
      // chargement infini sans la moindre erreur. Sans risque pour les liens déjà posés (fiche
      // client, recherche) : ils construisent l'URL en chaîne (`/ordres-reparation/${id}`), le nom
      // du paramètre de route ne joue aucun rôle dans cette construction.
      { path: 'ordres-reparation/:orId', element: <EcranFicheOrdreReparation /> },
      // L'écran lit `?site=` et `?clientId=` en paramètres de requête (jamais de paramètre de
      // chemin ici) — voir EcranNouvelOrdreReparation.tsx pour le détail des deux repos honnêtes
      // affichés quand l'un des deux manque.
      { path: 'atelier/ordres-reparation/nouveau', element: <EcranNouvelOrdreReparation /> },
      // Parcours « depuis une plaque » : un seul écran (véhicule, client, OR). Lit `?plaque=`,
      // `?vehiculeId=`, `?clientId=` et `?site=` pour arriver prérempli depuis l'accueil, la
      // recherche, la liste des OR et les fiches client/véhicule.
      { path: 'atelier/ordres-reparation/depuis-plaque', element: <EcranOrdreDepuisPlaque /> },
      { path: 'ordres-reparation/:orId/facturer', element: <EcranFacturerOrdreReparation /> },
      // Agenda de rendez-vous (Lot RDV-1) — `rendez_vous.lire` ferme la LECTURE elle-même à
      // `vendeur`/`magasinier`/`comptable`/`poste_atelier` côté API (`droits-routes.ts`), cette
      // garde reflète donc une restriction RÉELLE, comme `ROLES_PIECES`/`ROLES_PNEUS` plus bas.
      {
        path: 'rendez-vous',
        element: (
          <RouteProtegee rolesAutorises={ROLES_LECTURE_RENDEZ_VOUS}>
            <EcranRendezVous />
          </RouteProtegee>
        ),
      },
      // Véhicules de courtoisie — `courtoisie.lire` a la même population que `rendez_vous.lire`.
      {
        path: 'courtoisie',
        element: (
          <RouteProtegee rolesAutorises={ROLES_LECTURE_RENDEZ_VOUS}>
            <EcranCourtoisie />
          </RouteProtegee>
        ),
      },
      { path: 'factures', element: <EcranListeFactures /> },
      // `:id` (pas `:orId` ni `:factureId`) — `EcranFicheFacture` lit `useParams<{ id: string }>()`.
      { path: 'factures/:id', element: <EcranFicheFacture /> },
      // Même remarque : `EcranAvoir` lit aussi `useParams<{ id: string }>()` — `id` y désigne la
      // facture d'origine à partir de laquelle l'avoir est émis, pas l'avoir lui-même (qui n'existe
      // pas encore au moment où cet écran s'ouvre). Chemin construit par les écrans appelants via
      // `` `/factures/${document.id}/avoir` `` (EcranFicheFacture, DialogueCorrectionFacture) ; le
      // Lot D a ajouté `chemins.facturation.avoir(id)` pour les mêmes cibles — les écrans de
      // facturation peuvent y passer, ils n'y sont pas obligés (leur répertoire n'est pas dans le
      // périmètre d'écriture du Lot D).
      { path: 'factures/:id/avoir', element: <EcranAvoir /> },
      // Singleton par tenant (bloc créancier du QR-facture) — jamais de paramètre de chemin,
      // voir `chemins.parametrage.facturation` et le commentaire de tête d'`EcranParametresFacturation`.
      //
      // PAS de `rolesAutorises` ici, À LA DIFFÉRENCE d'aucune route de ce fichier (voir plus bas) —
      // décision délibérée, pas un oubli : `GET /parametres-facturation/creancier` restreint DÉJÀ
      // la LECTURE (pas seulement l'écriture) à `direction`/`comptable`
      // (`DROITS_PARAMETRAGE_CREANCIER_PAR_ROLE`, `admin` explicitement exclu par RF-115).
      // `EcranParametresFacturation.tsx` documente en tête un état dédié, volontairement conçu pour
      // le `403` qu'`admin` y rencontre (« le 403 DROIT_INSUFFISANT qu'un admin rencontre en se
      // connectant ici est ATTENDU et CORRECT — il reçoit donc un état dédié qui l'explique en ces
      // termes ... que @laupernoe rencontrera en premier s'il se connecte avec le compte admin »). Ajouter
      // `rolesAutorises` ici court-circuiterait cet écran dédié au profit du refus générique de
      // `EcranAccesRefuse` — une régression UX pour un cas explicitement soigné par un autre lot,
      // sans gain de sécurité (le `403` serveur protège déjà la donnée réelle). Le masquage du lien
      // dans `BarreLaterale` (`ROLES_MENU_FINANCIER`) reste néanmoins posé, par confort.
      { path: 'parametrage/facturation', element: <EcranParametresFacturation /> },
      // Les trois routes ci-dessous (référentiels, atelier, sites) N'ONT PAS de `rolesAutorises` —
      // arbitrage du coordinateur (lot 2), qui a corrigé sa propre consigne initiale après lecture
      // de ce fichier : `parametrage.referentiel.lire`/`parametrage.atelier.lire` sont accordés à
      // TOUS les rôles authentifiés côté API (`auth/matrice-droits.ts`, `LECTURE_ETENDUE`). Une
      // garde de route qui interdirait ce que l'API autorise ne protégerait rien — n'importe quel
      // rôle atteint la même donnée en appelant l'API directement — et casserait un usage métier
      // réel : le RÉCEPTIONNISTE est le rôle qui consulte LE PLUS ce référentiel (« combien coûte
      // ce service ? » au comptoir et au téléphone), et il n'appartient pourtant à aucun groupe de
      // gouvernance. Seule l'ÉCRITURE reste gouvernée — grisée dans chaque écran (voir
      // `peutModifierParametrage`, `ecrans/parametrage/droits.ts`) ET refusée par le serveur, la
      // seule barrière qui compte. Voir `droits-routes.ts` pour le détail de cet arbitrage et pour
      // la distinction « qui peut atteindre la route » (rien ici) / « à qui on propose le lien dans
      // le menu » (`ROLES_MENU_PARAMETRAGE_ATELIER`, ergonomie pure, dans `BarreLaterale.tsx`).
      // `routeur.spec.tsx` verrouille cette décision : un test rougit si quelqu'un réintroduit
      // `rolesAutorises` ici en croyant « rétablir la sécurité ».
      { path: 'parametrage/referentiels', element: <EcranReferentiels /> },
      { path: 'parametrage/atelier', element: <EcranParametrageAtelier /> },
      // `EcranSites` lit `?site=` pour choisir le site à paramétrer (voir `chemins.parametrage.sites`) —
      // même mécanisme que `clients`/`vehicules`, à la différence des deux routes précédentes (singletons
      // par tenant). L'écran gère lui-même l'absence de `?site=` (repli honnête), pas un paramètre de
      // chemin ici : cohérent avec `EcranNouvelOrdreReparation` plus haut.
      { path: 'parametrage/sites', element: <EcranSites /> },
      // Gestion des employés (issue #137) — `rolesAutorises={ROLES_GESTION_UTILISATEURS}` REFLÈTE
      // une restriction RÉELLE côté API (`socle.utilisateur.lire` : direction/admin seuls,
      // `auth/matrice-droits.ts`), même raisonnement que `ROLES_PIECES`/`ROLES_VENTES` — la garde
      // ne fait qu'anticiper le 403 que tout autre rôle recevrait de toute façon.
      {
        path: 'parametrage/utilisateurs',
        element: (
          <RouteProtegee rolesAutorises={ROLES_GESTION_UTILISATEURS}>
            <EcranUtilisateurs />
          </RouteProtegee>
        ),
      },
      // `GET /doublons-clients` (RM-05) n'exige que `client.lire`, ouvert à tous les rôles
      // authentifiés (`LECTURE_ETENDUE` dans `auth/matrice-droits.ts`) — AUCUNE restriction de rôle
      // ici, à la différence des trois routes `parametrage/*` ci-dessus. Placé après `clients/:id`
      // dans ce tableau par lisibilité seulement : React Router (v6) classe toujours un segment
      // statique (`doublons`) avant un segment dynamique (`:id`), l'ordre de déclaration ne change
      // rien à la résolution.
      { path: 'clients/doublons', element: <EcranDoublonsClients /> },
      // Scanner de permis de circulation (mobile) — `rolesAutorises={ROLES_SCAN}` REFLÈTE une
      // restriction RÉELLE, même raisonnement que `ROLES_PIECES`/`ROLES_VENTES` ci-dessus : sans
      // `client.creer` ET `vehicule.creer` à la fois, la soumission du formulaire prérempli par
      // l'OCR échoue systématiquement en `403` — voir `droits-routes.ts` pour le détail complet.
      // Rattachée au menu comme TROISIÈME onglet de Clients & véhicules
      // (`composants/layout/navigation-modele.ts`) ; sur téléphone, `AppShell.tsx`
      // (`useModeScanMobile`) y redirige automatiquement les mêmes rôles sans passer par ce menu.
      {
        path: 'scan',
        element: (
          <RouteProtegee rolesAutorises={ROLES_SCAN}>
            <EcranScan />
          </RouteProtegee>
        ),
      },
      // Module pièces (étape 3) — CINQ routes, TOUTES sous `rolesAutorises={ROLES_PIECES}`
      // (`droits-routes.ts`) : `DROITS_PIECES_PAR_ROLE.admin` vaut `[]` littéralement côté API
      // (RF-115), la lecture elle-même est fermée à `admin` — contrairement à
      // `parametrage/referentiels` ci-dessus, cette garde reflète une restriction RÉELLE, elle ne
      // l'invente pas. `RouteProtegee` imbriquée dans celle, déjà posée plus haut, qui protège
      // `AppShell` : la session est déjà résolue à ce niveau (pas de second aller-retour réseau),
      // seule la vérification de rôle s'ajoute.
      {
        path: 'pieces/recherche-comptoir',
        element: (
          <RouteProtegee rolesAutorises={ROLES_PIECES}>
            <EcranRechercheComptoirPieces />
          </RouteProtegee>
        ),
      },
      {
        path: 'pieces/articles',
        element: (
          <RouteProtegee rolesAutorises={ROLES_PIECES}>
            <EcranListeArticles />
          </RouteProtegee>
        ),
      },
      // `EcranFicheArticle` lit `useParams<{ id: string }>()` — segment statique `articles`
      // avant le dynamique `:id`, React Router (v6) le résout sans ambiguïté quel que soit l'ordre
      // de déclaration (même remarque que `clients/doublons` ci-dessus).
      {
        path: 'pieces/articles/:id',
        element: (
          <RouteProtegee rolesAutorises={ROLES_PIECES}>
            <EcranFicheArticle />
          </RouteProtegee>
        ),
      },
      {
        path: 'pieces/reservations',
        element: (
          <RouteProtegee rolesAutorises={ROLES_PIECES}>
            <EcranReservationsPieces />
          </RouteProtegee>
        ),
      },
      {
        path: 'pieces/reapprovisionnement',
        element: (
          <RouteProtegee rolesAutorises={ROLES_PIECES}>
            <EcranReapprovisionnement />
          </RouteProtegee>
        ),
      },
      // Commandes fournisseur + fournisseurs + consignes (étape 3, complément) — même garde
      // `ROLES_PIECES` que le reste du module (restriction RÉELLE, `admin` exclu, voir plus haut).
      {
        path: 'pieces/commandes-fournisseur',
        element: (
          <RouteProtegee rolesAutorises={ROLES_PIECES}>
            <EcranListeCommandesFournisseur />
          </RouteProtegee>
        ),
      },
      // Segment statique `nouvelle` déclaré AVANT `:id` : même logique que `pieces/articles/:id`
      // ci-dessus (React Router v6 résout sans ambiguïté quel que soit l'ordre, mais la lisibilité
      // du fichier suit la convention déjà en place ici).
      {
        path: 'pieces/commandes-fournisseur/nouvelle',
        element: (
          <RouteProtegee rolesAutorises={ROLES_PIECES}>
            <EcranNouvelleCommandeFournisseur />
          </RouteProtegee>
        ),
      },
      {
        path: 'pieces/commandes-fournisseur/:id',
        element: (
          <RouteProtegee rolesAutorises={ROLES_PIECES}>
            <EcranFicheCommandeFournisseur />
          </RouteProtegee>
        ),
      },
      {
        path: 'pieces/fournisseurs',
        element: (
          <RouteProtegee rolesAutorises={ROLES_PIECES}>
            <EcranListeFournisseurs />
          </RouteProtegee>
        ),
      },
      {
        path: 'pieces/fournisseurs/:id',
        element: (
          <RouteProtegee rolesAutorises={ROLES_PIECES}>
            <EcranFicheFournisseur />
          </RouteProtegee>
        ),
      },
      // Factures fournisseur (dépôt/rapprochement) — même garde `ROLES_PIECES` (7 rôles) que
      // `commandes-fournisseur`/`fournisseurs` ci-dessus : le droit fin (`peutLireFactureFournisseur`,
      // `ecrans/pieces/droits.ts`, direction/chef_atelier/magasinier/comptable) est vérifié DANS
      // chaque écran, pas ici — même raisonnement que ces deux routes (voir leurs commentaires).
      // Segment statique `deposer` déclaré AVANT `:id`, même convention que
      // `pieces/commandes-fournisseur/nouvelle` plus haut.
      {
        path: 'pieces/factures-fournisseur',
        element: (
          <RouteProtegee rolesAutorises={ROLES_PIECES}>
            <EcranListeFacturesFournisseur />
          </RouteProtegee>
        ),
      },
      {
        path: 'pieces/factures-fournisseur/deposer',
        element: (
          <RouteProtegee rolesAutorises={ROLES_PIECES}>
            <EcranDepotFactureFournisseur />
          </RouteProtegee>
        ),
      },
      {
        path: 'pieces/factures-fournisseur/:id',
        element: (
          <RouteProtegee rolesAutorises={ROLES_PIECES}>
            <EcranFactureFournisseur />
          </RouteProtegee>
        ),
      },
      {
        path: 'pieces/consignes',
        element: (
          <RouteProtegee rolesAutorises={ROLES_PIECES}>
            <EcranConsignesPieces />
          </RouteProtegee>
        ),
      },
      // Paramétrage pièces (`GET|PATCH /parametrage/pieces`, §10) — garde DISTINCTE de
      // `ROLES_PIECES` ci-dessus : `pieces.parametrage.lire` restreint la LECTURE elle-même à
      // `direction`/`chef_atelier`/`magasinier` (voir `droits-routes.ts`,
      // `ROLES_PARAMETRAGE_PIECES`), un sous-ensemble strict des sept rôles opérationnels du
      // module. Chemin littéral `parametrage/pieces` (pas `pieces/parametrage`) : même famille que
      // `parametrage/atelier`/`parametrage/sites`/`parametrage/facturation` plus haut, cohérent
      // avec `chemins.parametrage.pieces`.
      {
        path: 'parametrage/pieces',
        element: (
          <RouteProtegee rolesAutorises={ROLES_PARAMETRAGE_PIECES}>
            <EcranParametragePieces />
          </RouteProtegee>
        ),
      },
      // Paliers de relance (scission de l'ancien `EcranRelances`, §4.5 : « paliers -> Réglages ») —
      // `rolesAutorises={ROLES_RELANCES}` reflète la même restriction RÉELLE que `relances`
      // ci-dessous (`relances.facturation.regle.lire`, direction/comptable seuls côté API) : lire
      // la règle expose une politique de recouvrement, réservée à la gouvernance/comptabilité.
      // Chemin littéral `parametrage/relances`, même famille que `parametrage/pieces` ci-dessus.
      {
        path: 'parametrage/relances',
        element: (
          <RouteProtegee rolesAutorises={ROLES_RELANCES}>
            <EcranReglagesRelances />
          </RouteProtegee>
        ),
      },
      // Module pointage (lot 2, fusion Lot D) — `/pointage` reste l'écran individuel
      // (« Mon travail », `EcranPointageTechnicien`, inchangé). `pointage/jour`, `pointage/equipe`
      // ET `pointage/cloture` pointent maintenant TOUS les trois sur le même écran fusionné
      // `EcranPointage` (voir son commentaire de tête, `ecrans/pointage/EcranPointage.tsx`) :
      // l'ancien Journal et l'ancienne Équipe sont devenus ses deux onglets internes
      // (`?vue=journal|equipe`), et l'ancienne Clôture de période (`EcranCloturePeriodePointage`,
      // écran supprimé) est devenue une action de l'onglet Équipe (`DialogueCloturePeriode`).
      //
      // GARDE UNIQUE `ROLES_POINTAGE` (la plus large des deux gardes qui existaient avant la
      // fusion) sur les trois : `EcranPointage` gère lui-même la restriction interne de l'onglet
      // Équipe (`peutVoirEquipePointage`) — absent du DOM pour qui n'y a pas droit, jamais grisé —
      // donc une garde de route plus étroite que `ROLES_POINTAGE` bloquerait `technicien`/
      // `magasinier` avant même d'atteindre l'onglet Journal, qui leur reste pourtant ouvert.
      {
        path: 'pointage',
        element: (
          <RouteProtegee rolesAutorises={ROLES_POINTAGE}>
            <EcranPointageTechnicien />
          </RouteProtegee>
        ),
      },
      {
        path: 'pointage/jour',
        element: (
          <RouteProtegee rolesAutorises={ROLES_POINTAGE}>
            <EcranPointage />
          </RouteProtegee>
        ),
      },
      {
        path: 'pointage/equipe',
        element: (
          <RouteProtegee rolesAutorises={ROLES_POINTAGE}>
            <EcranPointage />
          </RouteProtegee>
        ),
      },
      // `chemins.pointage.cloture()` N'A PAS été retiré de `chemins.ts`, à la différence de ce que
      // suggérait le mandat initial de ce lot : `composants/layout/navigation-modele.ts` (hors
      // périmètre d'écriture de ce lot — `composants/layout/`) porte encore une vue « Clôture »
      // dédiée (`chemin: (site) => chemins.pointage.cloture(site)`) et `routes/atteignabilite.spec.ts`
      // verrouille explicitement `trouverCorrespondance('/pointage/cloture')?.vue?.id === 'cloture'`.
      // Retirer le constructeur aurait cassé la compilation de ce fichier et fait rougir ce test —
      // aucun des deux n'est dans le périmètre d'écriture de ce lot. SIGNALÉ au coordinateur :
      // la vue « Clôture » de `navigation-modele.ts` (et son JSDoc, qui suppose encore
      // `EcranCloturePeriodePointage` en écran autonome) est désormais périmée et gagnerait à être
      // retirée ou fusionnée dans la vue « Équipe », maintenant que le geste vit dans
      // `DialogueCloturePeriode`. La route ci-dessous continue néanmoins de rendre un écran réel.
      {
        path: 'pointage/cloture',
        element: (
          <RouteProtegee rolesAutorises={ROLES_POINTAGE}>
            <EcranPointage />
          </RouteProtegee>
        ),
      },
      // Borne d'atelier (mode « borne partagée », identification par PIN) — TROISIÈME garde du
      // module pointage, distincte des deux précédentes. Elle valait `['poste_atelier']` seul
      // jusqu'au Lot D, ce qui rendait la borne inatteignable depuis l'interface pour ceux qui
      // l'INSTALLENT : un `chef_atelier` qui accroche la tablette au mur doit pouvoir ouvrir
      // l'écran, relever l'URL à mettre en favori et vérifier le rendu. `ROLES_BORNE_POINTAGE`
      // (`droits-routes.ts`) ajoute donc `chef_atelier`/`admin`, et documente la limite assumée :
      // l'identification par PIN leur répond `403` (seul `poste_atelier` détient
      // `atelier.pointage.identifier`), c'est un accès de mise en service, pas d'usage.
      //
      // `poste_atelier` y ARRIVE désormais tout seul : la table d'atterrissage l'y redirige depuis
      // la route index (voir plus haut). L'entrée de menu vit dans Atelier › Pointage › Borne
      // d'atelier, réservée aux deux rôles d'installation.
      {
        path: 'pointage/borne',
        element: (
          <RouteProtegee rolesAutorises={ROLES_BORNE_POINTAGE}>
            <EcranBornePointage />
          </RouteProtegee>
        ),
      },
      // Hangar à pneus (Lot B, fusion Lot D) — UNE SEULE route désormais, sous
      // `rolesAutorises={ROLES_PNEUS}` (`droits-routes.ts`) : `ROLES_PNEUS_DEPOT_LECTURE` ferme la
      // lecture elle-même à `poste_atelier` côté API (voir `apps/api/src/pneus/droits-provisoires.ts`)
      // — même raisonnement que `ROLES_PIECES`/`ROLES_VENTES` ci-dessus, cette garde reflète une
      // restriction RÉELLE (bien que PROVISOIRE côté matrice de droits).
      //
      // `pneus/a-relancer` a été RETIRÉE (l'ancien écran `EcranJeuxARelancer` est supprimé, fusionné
      // dans `EcranHangarPneus` comme onglet `TabsContent value="a_relancer"`, lu depuis `?onglet=`
      // — voir le commentaire de tête d'`EcranHangarPneus.tsx`, section « ROUTES SIGNALÉ »).
      // `chemins.pneus.aRelancer(site)` construit désormais directement `/pneus?onglet=a_relancer`
      // (voir `chemins.ts`) : un lien externe (menu, futur bloc « Aujourd'hui ») atterrit donc sur
      // le bon onglet sans hop de redirection.
      {
        path: 'pneus',
        element: (
          <RouteProtegee rolesAutorises={ROLES_PNEUS}>
            <EcranHangarPneus />
          </RouteProtegee>
        ),
      },
      // Module ventes VN/VO (étape 4) — SEPT routes, TOUTES sous `rolesAutorises={ROLES_VENTES}`
      // (`droits-routes.ts`) : `ventes.vehicule_stock.lire` et `ventes.dossier.lire` ferment tous
      // deux la LECTURE elle-même à `admin`/`technicien`/`magasinier` (RF-115, voir
      // `ecrans/ventes/stock/droits.ts` et `ecrans/ventes/dossiers/droits.ts`) — même raisonnement
      // que `ROLES_PIECES` ci-dessus, cette garde reflète une restriction RÉELLE de l'API. Reprise
      // et Financement N'ONT PAS de route dédiée : ce sont des cartes intégrées à la fiche dossier
      // (design gelé §8-9), pas des écrans autonomes. `ventes/suivi` (suivi financement & garantie,
      // `GET /ventes/suivi`) est gardé par le MÊME droit `ventes.dossier.lire` que `ventes/dossiers`
      // ci-dessous (`suivi-vente.controller.ts`), donc le même `ROLES_VENTES` suffit — aucune
      // nouvelle liste de rôles n'est nécessaire.
      //
      // Segment statique `nouveau` déclaré AVANT `:id` dans chacun des deux sous-groupes, même
      // convention que `pieces/articles/:id` plus haut (React Router v6 résout sans ambiguïté quel
      // que soit l'ordre, mais la lisibilité du fichier suit la convention déjà en place ici).
      {
        path: 'ventes/stock',
        element: (
          <RouteProtegee rolesAutorises={ROLES_VENTES}>
            <EcranListeVehiculesStock />
          </RouteProtegee>
        ),
      },
      {
        path: 'ventes/stock/nouveau',
        element: (
          <RouteProtegee rolesAutorises={ROLES_VENTES}>
            <EcranEntreeEnStock />
          </RouteProtegee>
        ),
      },
      {
        path: 'ventes/stock/:id',
        element: (
          <RouteProtegee rolesAutorises={ROLES_VENTES}>
            <EcranFicheVehiculeStock />
          </RouteProtegee>
        ),
      },
      {
        path: 'ventes/dossiers',
        element: (
          <RouteProtegee rolesAutorises={ROLES_VENTES}>
            <EcranListeDossiersVente />
          </RouteProtegee>
        ),
      },
      // Segment statique distinct de `dossiers` ci-dessus — aucune ambiguïté de matching React
      // Router. Vue dérivée des dossiers de vente (échéances de financement/garantie à venir).
      {
        path: 'ventes/suivi',
        element: (
          <RouteProtegee rolesAutorises={ROLES_VENTES}>
            <EcranSuiviVentes />
          </RouteProtegee>
        ),
      },
      {
        path: 'ventes/dossiers/nouveau',
        element: (
          <RouteProtegee rolesAutorises={ROLES_VENTES}>
            <EcranNouveauDossierVente />
          </RouteProtegee>
        ),
      },
      {
        path: 'ventes/dossiers/:id',
        element: (
          <RouteProtegee rolesAutorises={ROLES_VENTES}>
            <EcranFicheDossierVente />
          </RouteProtegee>
        ),
      },
      // Déclenchement des relances automatiques (rappels de facture impayée) — écran opérationnel
      // (planifier/envoyer/historique), sous Facturation depuis la scission de l'ancien
      // `EcranRelances` (§4.5, voir `parametrage/relances` ci-dessus pour le pendant réglage des
      // paliers, passé sous Réglages). `rolesAutorises={ROLES_RELANCES}` (`droits-routes.ts`)
      // reflète une restriction RÉELLE, même raisonnement que `ROLES_PIECES`/`ROLES_VENTES`/
      // `ROLES_PNEUS` plus haut : `relances.facturation.planifier`/`.envoyer`/`.regle.lire`
      // (historique) ferment ces trois opérations à tout rôle hors `direction`/`comptable`
      // (`apps/api/src/relances/relances.controller.ts`) — cette garde ne l'invente pas.
      // Export fiduciaire : `facturation.export.creer` = direction/comptable (`ROLES_MENU_FINANCIER`).
      {
        path: 'export-fiduciaire',
        element: (
          <RouteProtegee rolesAutorises={ROLES_MENU_FINANCIER}>
            <EcranExportFiduciaire />
          </RouteProtegee>
        ),
      },
      {
        path: 'relances',
        element: (
          <RouteProtegee rolesAutorises={ROLES_RELANCES}>
            <EcranRelances />
          </RouteProtegee>
        ),
      },
      // Reprise de données (dépôt de l'archive d'un ancien logiciel, `packages/shared/src/
      // contrats/reprise.ts`) — geste d'onboarding exceptionnel, hors du menu au même titre que
      // `/console` (`routes/atteignabilite.spec.ts`, `HORS_MENU`), mais routée normalement sous
      // la coquille métier (`RouteProtegee` + `AppShell`), contrairement à `/console` : c'est un
      // écran de GARAGE (données du tenant), pas un poste d'exploitation plateforme.
      //
      // PAS de `rolesAutorises` ici — SIGNALÉ plutôt qu'inventé : le module API correspondant est
      // écrit en parallèle par un autre lot et le contrat ne documente aucune restriction de
      // rôle sur ce domaine. Poser une garde de route sans preuve qu'elle reflète une restriction
      // RÉELLE côté API serait exactement la « sécurité de façade » que ce fichier interdit
      // ailleurs (voir `droits-routes.ts`, cas de figure 1). À revisiter (l'équipe authentification/frontend)
      // une fois le module API fusionné et sa matrice de droits connue.
      {
        path: 'reprise-donnees',
        element: (
          <RouteProtegee>
            <EcranReprise />
          </RouteProtegee>
        ),
      },
    ],
  },
  { path: '*', element: <EcranPageIntrouvable /> },
];

export const routeur = createBrowserRouter(routesConfig);
