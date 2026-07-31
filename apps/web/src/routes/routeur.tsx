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
import { EcranRecherche } from '@/ecrans/recherche/EcranRecherche';
import { EcranPageIntrouvable } from '@/ecrans/systeme/EcranPageIntrouvable';
import { EcranFicheVehicule } from '@/ecrans/vehicules/EcranFicheVehicule';
import { EcranListeVehicules } from '@/ecrans/vehicules/EcranListeVehicules';

import { RouteProtegee } from './RouteProtegee';
import { RoutePublique } from './RoutePublique';

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
    ],
  },
  { path: '*', element: <EcranPageIntrouvable /> },
];

export const routeur = createBrowserRouter(routesConfig);
