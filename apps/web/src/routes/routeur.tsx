import { createBrowserRouter, type RouteObject } from 'react-router';

import { AppShell } from '@/composants/layout/AppShell';
import { EcranAccueil } from '@/ecrans/EcranAccueil';
import { EcranConnexion } from '@/ecrans/EcranConnexion';
import { EcranFicheOrdreReparation } from '@/ecrans/atelier/EcranFicheOrdreReparation';
import { EcranListeOrdresReparation } from '@/ecrans/atelier/EcranListeOrdresReparation';
import { EcranNouvelOrdreReparation } from '@/ecrans/atelier/EcranNouvelOrdreReparation';
import { EcranFicheClient } from '@/ecrans/clients/EcranFicheClient';
import { EcranListeClients } from '@/ecrans/clients/EcranListeClients';
import { EcranAvoir } from '@/ecrans/facturation/EcranAvoir';
import { EcranFacturerOrdreReparation } from '@/ecrans/facturation/EcranFacturerOrdreReparation';
import { EcranFicheFacture } from '@/ecrans/facturation/EcranFicheFacture';
import { EcranListeFactures } from '@/ecrans/facturation/EcranListeFactures';
import { EcranDoublonsClients } from '@/ecrans/clients/EcranDoublonsClients';
import { EcranParametrageAtelier } from '@/ecrans/parametrage/EcranParametrageAtelier';
import { EcranParametresFacturation } from '@/ecrans/parametrage/EcranParametresFacturation';
import { EcranReferentiels } from '@/ecrans/parametrage/EcranReferentiels';
import { EcranSites } from '@/ecrans/parametrage/EcranSites';
import { EcranConsignesPieces } from '@/ecrans/pieces/EcranConsignesPieces';
import { EcranFicheArticle } from '@/ecrans/pieces/EcranFicheArticle';
import { EcranFicheCommandeFournisseur } from '@/ecrans/pieces/EcranFicheCommandeFournisseur';
import { EcranFicheFournisseur } from '@/ecrans/pieces/EcranFicheFournisseur';
import { EcranListeArticles } from '@/ecrans/pieces/EcranListeArticles';
import { EcranListeCommandesFournisseur } from '@/ecrans/pieces/EcranListeCommandesFournisseur';
import { EcranListeFournisseurs } from '@/ecrans/pieces/EcranListeFournisseurs';
import { EcranNouvelleCommandeFournisseur } from '@/ecrans/pieces/EcranNouvelleCommandeFournisseur';
import { EcranReapprovisionnement } from '@/ecrans/pieces/EcranReapprovisionnement';
import { EcranRechercheComptoirPieces } from '@/ecrans/pieces/EcranRechercheComptoirPieces';
import { EcranReservationsPieces } from '@/ecrans/pieces/EcranReservationsPieces';
import { EcranCloturePeriodePointage } from '@/ecrans/pointage/EcranCloturePeriodePointage';
import { EcranEquipePointage } from '@/ecrans/pointage/EcranEquipePointage';
import { EcranJournalPointage } from '@/ecrans/pointage/EcranJournalPointage';
import { EcranPointageTechnicien } from '@/ecrans/pointage/EcranPointageTechnicien';
import { ROLES_POINTAGE, ROLES_POINTAGE_ENCADREMENT } from '@/ecrans/pointage/droits';
import { EcranRecherche } from '@/ecrans/recherche/EcranRecherche';
import { EcranPageIntrouvable } from '@/ecrans/systeme/EcranPageIntrouvable';
import { EcranFicheVehicule } from '@/ecrans/vehicules/EcranFicheVehicule';
import { EcranListeVehicules } from '@/ecrans/vehicules/EcranListeVehicules';
import { EcranFicheDossierVente } from '@/ecrans/ventes/dossiers/EcranFicheDossierVente';
import { EcranListeDossiersVente } from '@/ecrans/ventes/dossiers/EcranListeDossiersVente';
import { EcranNouveauDossierVente } from '@/ecrans/ventes/dossiers/EcranNouveauDossierVente';
import { EcranEntreeEnStock } from '@/ecrans/ventes/stock/EcranEntreeEnStock';
import { EcranFicheVehiculeStock } from '@/ecrans/ventes/stock/EcranFicheVehiculeStock';
import { EcranListeVehiculesStock } from '@/ecrans/ventes/stock/EcranListeVehiculesStock';

import { RouteProtegee } from './RouteProtegee';
import { RoutePublique } from './RoutePublique';
import { ROLES_PIECES, ROLES_VENTES } from './droits-routes';

/**
 * Convention structurelle qui fait qu'une route oubliée tombe du côté SÛR (même principe que la
 * garde côté API) : la SEULE route publique de tout le tableau est `/login`, explicitement sous
 * `RoutePublique`. Tout le reste vit comme enfant de l'unique route protégée `/` (sous
 * `RouteProtegee` + `AppShell`) — c'est aussi l'endroit naturel où ajouter un futur écran, à côté
 * de ceux déjà listés ci-dessous, jamais un nouveau frère top-level du tableau : il n'y a tout
 * simplement pas d'autre emplacement « pratique » qui échapperait à l'authentification.
 *
 * Exporté séparément de `routeur` (créé juste en dessous) pour que les tests puissent construire
 * un `createMemoryRouter` avec exactement cette configuration (voir routeur.spec.tsx), plutôt que
 * de la dupliquer.
 */
export const routesConfig: RouteObject[] = [
  {
    path: '/login',
    element: (
      <RoutePublique>
        <EcranConnexion />
      </RoutePublique>
    ),
  },
  {
    path: '/',
    element: (
      <RouteProtegee>
        <AppShell />
      </RouteProtegee>
    ),
    children: [
      { index: true, element: <EcranAccueil /> },
      { path: 'recherche', element: <EcranRecherche /> },
      { path: 'clients', element: <EcranListeClients /> },
      { path: 'clients/:id', element: <EcranFicheClient /> },
      { path: 'vehicules', element: <EcranListeVehicules /> },
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
      // Même paramètre `orId` que la fiche d'OR ci-dessus (`EcranFacturerOrdreReparation` lit
      // `useParams<{ orId: string }>()`) et même préfixe `ordres-reparation/` que le reste de la
      // ressource — le commentaire en tête d'`EcranFacturerOrdreReparation.tsx` documente
      // `/or/:orId/facturer` (calque du design), mais rien dans le dépôt ne navigue déjà vers cette
      // URL : `/or/` n'existe nulle part ailleurs dans le routeur, alors que `ordres-reparation/`
      // est le préfixe déjà en place pour cette même ressource (liste, fiche). Choisi pour
      // cohérence avec les routes existantes plutôt que pour coller littéralement au commentaire.
      { path: 'ordres-reparation/:orId/facturer', element: <EcranFacturerOrdreReparation /> },
      { path: 'factures', element: <EcranListeFactures /> },
      // `:id` (pas `:orId` ni `:factureId`) — `EcranFicheFacture` lit `useParams<{ id: string }>()`.
      { path: 'factures/:id', element: <EcranFicheFacture /> },
      // Même remarque : `EcranAvoir` lit aussi `useParams<{ id: string }>()` — `id` y désigne la
      // facture d'origine à partir de laquelle l'avoir est émis, pas l'avoir lui-même (qui n'existe
      // pas encore au moment où cet écran s'ouvre). Chemin construit par les écrans appelants via
      // `` `/factures/${document.id}/avoir` `` (EcranFicheFacture, DialogueCorrectionFacture) — pas
      // de constructeur dans `chemins.ts` pour cette route, les écrans de facturation naviguent en
      // gabarit littéral plutôt que via `chemins.*`.
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
      // `EcranAccesRefuse` — une régression UX pour un cas explicitement soigné par un autre agent,
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
      // `GET /doublons-clients` (RM-05) n'exige que `client.lire`, ouvert à tous les rôles
      // authentifiés (`LECTURE_ETENDUE` dans `auth/matrice-droits.ts`) — AUCUNE restriction de rôle
      // ici, à la différence des trois routes `parametrage/*` ci-dessus. Placé après `clients/:id`
      // dans ce tableau par lisibilité seulement : React Router (v6) classe toujours un segment
      // statique (`doublons`) avant un segment dynamique (`:id`), l'ordre de déclaration ne change
      // rien à la résolution.
      { path: 'clients/doublons', element: <EcranDoublonsClients /> },
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
      // `EcranFicheCommandeFournisseur` lit `useParams<{ id: string }>()`.
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
      // `EcranFicheFournisseur` lit `useParams<{ id: string }>()`.
      {
        path: 'pieces/fournisseurs/:id',
        element: (
          <RouteProtegee rolesAutorises={ROLES_PIECES}>
            <EcranFicheFournisseur />
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
      // Module pointage (lot 2) — DEUX gardes distinctes selon le rôle requis, reflétant la même
      // restriction RÉELLE que celle documentée dans `ecrans/pointage/droits.ts`
      // (`DROITS_POINTAGE_PAR_ROLE` côté API) : `ROLES_POINTAGE` pour les écrans ouverts à tout
      // rôle qui pointe (y compris `technicien`/`magasinier`), `ROLES_POINTAGE_ENCADREMENT` pour
      // les écrans réservés à l'encadrement (vue équipe, corrections, clôture de période).
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
            <EcranJournalPointage />
          </RouteProtegee>
        ),
      },
      {
        path: 'pointage/equipe',
        element: (
          <RouteProtegee rolesAutorises={ROLES_POINTAGE_ENCADREMENT}>
            <EcranEquipePointage />
          </RouteProtegee>
        ),
      },
      {
        path: 'pointage/cloture',
        element: (
          <RouteProtegee rolesAutorises={ROLES_POINTAGE_ENCADREMENT}>
            <EcranCloturePeriodePointage />
          </RouteProtegee>
        ),
      },
      // Module ventes VN/VO (étape 4) — SIX routes, TOUTES sous `rolesAutorises={ROLES_VENTES}`
      // (`droits-routes.ts`) : `ventes.vehicule_stock.lire` et `ventes.dossier.lire` ferment tous
      // deux la LECTURE elle-même à `admin`/`technicien`/`magasinier` (RF-115, voir
      // `ecrans/ventes/stock/droits.ts` et `ecrans/ventes/dossiers/droits.ts`) — même raisonnement
      // que `ROLES_PIECES` ci-dessus, cette garde reflète une restriction RÉELLE de l'API. Reprise
      // et Financement N'ONT PAS de route dédiée : ce sont des cartes intégrées à la fiche dossier
      // (design gelé §8-9), pas des écrans autonomes.
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
      // `EcranFicheVehiculeStock` lit `useParams<{ id: string }>()`.
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
      {
        path: 'ventes/dossiers/nouveau',
        element: (
          <RouteProtegee rolesAutorises={ROLES_VENTES}>
            <EcranNouveauDossierVente />
          </RouteProtegee>
        ),
      },
      // `EcranFicheDossierVente` lit `useParams<{ id: string }>()`.
      {
        path: 'ventes/dossiers/:id',
        element: (
          <RouteProtegee rolesAutorises={ROLES_VENTES}>
            <EcranFicheDossierVente />
          </RouteProtegee>
        ),
      },
    ],
  },
  { path: '*', element: <EcranPageIntrouvable /> },
];

export const routeur = createBrowserRouter(routesConfig);
