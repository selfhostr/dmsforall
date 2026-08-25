import {
  Boxes,
  CarFront,
  Receipt,
  Settings,
  Sunrise,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

import type { RoleUtilisateur } from '@dfa/shared';

import { chemins } from '@/routes/chemins';
import {
  ROLES_BORNE_POINTAGE,
  ROLES_LECTURE_RENDEZ_VOUS,
  ROLES_MENU_FACTURATION,
  ROLES_GESTION_UTILISATEURS,
  ROLES_MENU_FINANCIER,
  ROLES_MENU_PARAMETRAGE_ATELIER,
  ROLES_PARAMETRAGE_PIECES,
  ROLES_PIECES,
  ROLES_PNEUS,
  ROLES_POINTAGE,
  ROLES_POINTAGE_ENCADREMENT,
  ROLES_RELANCES,
  ROLES_SCAN,
  ROLES_TABLEAU_BORD_ACTIVITE,
  ROLES_VENTES,
} from '@/routes/droits-routes';

/**
 * MODÈLE DE NAVIGATION — Lot D de la refonte (`docs/refonte-navigation.md` §4.2,
 * `docs/plan-refonte-navigation.md`, « Lot D — Le menu à six entrées »).
 *
 * SOURCE DE VÉRITÉ UNIQUE de l'arborescence : la barre latérale (`BarreLaterale.tsx`) et la barre
 * d'onglets (`OngletsDomaine.tsx`) LISENT toutes les deux ce fichier, aucune des deux ne redéclare
 * sa propre liste. C'est ce qui garantit qu'une entrée de menu et l'onglet correspondant ne
 * peuvent pas diverger — le défaut classique quand deux composants portent chacun leur copie.
 *
 * TROIS NIVEAUX, et pas un de plus (§4.1, « la règle de rangement ») :
 *
 *  1. ENTRÉE — un plan de travail qu'on ouvre sans savoir quel objet on va manipuler. SIX, plus
 *     Réglages en pied. Le menu ne se déplie JAMAIS et ne défile JAMAIS : c'est tout l'objet du
 *     lot. Ajouter une septième entrée n'est pas une décision d'implémentation.
 *  2. ONGLET — le second niveau, qui vit DANS l'écran, jamais dans le menu. Un accordéon à six
 *     groupes ne réduit pas la charge, il la déplace et ajoute un état à gérer (« quel groupe est
 *     ouvert ? »).
 *  3. VUE — le troisième niveau, optionnel, pour les onglets qui portent réellement plusieurs
 *     angles sur la même matière (les sous-vues en italique du tableau §4.2, ex. Pointage
 *     « Mon travail · Journal · Équipe »). Dépôt pneus n'en porte plus depuis la fusion de
 *     `EcranJeuxARelancer` dans `EcranHangarPneus` : la distinction « au dépôt · à relancer » vit
 *     désormais en onglet INTERNE de cet écran, pas dans ce modèle (voir `ONGLETS_ATELIER`).
 *
 * OÙ RANGER UN ÉCRAN FUTUR : Destination -> une VUE ou un ONGLET d'une entrée existante. Objet
 * (un client, un OR, une facture) -> la recherche et les liens de fiche, JAMAIS le menu. Réglage
 * -> un onglet de Réglages. Ces trois classes couvrent tout ; si un écran n'entre dans aucune,
 * c'est le rangement qu'il faut interroger, pas le menu qu'il faut rallonger.
 *
 * L'ORDRE DES ENTRÉES SUIT LA JOURNÉE, pas la fréquence : le matin (Aujourd'hui), la journée
 * (Atelier), le téléphone (Clients & véhicules), la pièce qu'on va chercher (Pièces), le soir
 * (Facturation), le rythme mensuel (Ventes). Il est IDENTIQUE POUR TOUS LES RÔLES — un ordre
 * variable détruirait la mémoire spatiale et le support téléphonique (« troisième entrée, sous
 * Atelier » doit être vrai pour l'interlocuteur quel que soit son compte). Les droits FILTRENT ce
 * tableau, ils ne le RÉORDONNENT jamais.
 */

/** Rôles autorisés, ou `undefined` pour « aucune restriction » — voir `estAutorise`. */
type Roles = readonly RoleUtilisateur[] | undefined;

export interface VueDomaine {
  readonly id: string;
  /** Clé i18n complète, namespace compris (`navigation:onglets.*`). */
  readonly cleLibelle: string;
  readonly chemin: (site?: string) => string;
  /** Préfixes d'URL qui activent cette vue — voir `cheminCorrespond`. */
  readonly motifs: readonly string[];
  readonly roles?: Roles;
}

export interface OngletDomaine {
  readonly id: string;
  readonly cleLibelle: string;
  readonly chemin: (site?: string) => string;
  /**
   * Préfixes d'URL qui activent cet onglet. DOIT couvrir les motifs de toutes ses vues, sinon une
   * URL de vue activerait l'onglet voisin (la correspondance descend onglet -> vue, jamais
   * l'inverse).
   */
  readonly motifs: readonly string[];
  readonly roles?: Roles;
  readonly vues?: readonly VueDomaine[];
}

export interface EntreeMenu {
  readonly id: string;
  readonly cleLibelle: string;
  readonly icone: LucideIcon;
  readonly onglets: readonly OngletDomaine[];
}

// =================================================================================================
// Le tableau
// =================================================================================================

const ONGLETS_AUJOURDHUI: readonly OngletDomaine[] = [
  /**
   * `/` (`EcranAccueil`) et `/tableau-bord` (`EcranTableauBord`) ont été FUSIONNÉS (Lot F) :
   * `EcranAccueil` est supprimé, `/` n'est plus qu'un relais vers `/tableau-bord`. Un seul onglet
   * subsiste donc ici — deux onglets pour un seul écran auraient fait rebondir « Accueil » sur son
   * voisin. `roles` reprend ceux du tableau de bord (`ROLES_TABLEAU_BORD_ACTIVITE`), plus large que
   * les quatre rôles dont l'ancien atterrissage était `/` : tout rôle qui lit l'activité du garage y
   * a sa place, plus de restriction héritée du relais.
   *
   * `motifs` porte AUSSI `/` : la route index n'a pas disparu, elle est devenue un simple relais
   * vers `/tableau-bord` (redirection immédiate, `routes/routeur.tsx`). Sans ce motif, la fenêtre
   * entre le montage de `/` et la redirection effective n'activerait aucun onglet, et
   * `routes/atteignabilite.spec.ts` refuse justement qu'une route du menu reste sans motif ni
   * exception documentée en `HORS_MENU`.
   */
  {
    id: 'tableauBord',
    cleLibelle: 'navigation:onglets.aujourdhuiTableauBord',
    chemin: (site) => chemins.tableauBord(site),
    motifs: ['/', '/tableau-bord'],
    roles: ROLES_TABLEAU_BORD_ACTIVITE,
  },
];

/**
 * `EcranPointage` choisit son onglet interne (Journal/Équipe) exclusivement via `?vue=`
 * (`ecrans/pointage/EcranPointage.tsx`) et retombe sur Journal quand ce paramètre est absent —
 * y compris sur les URL `/pointage/equipe` et `/pointage/cloture` elles-mêmes, puisque
 * `trouverCorrespondance` matche par PATHNAME (voir plus bas) alors que l'écran, lui, ne regarde
 * jamais le pathname. Sans ce paramètre explicite, cliquer « Équipe » ou « Clôture » depuis le
 * menu atterrirait donc sur Journal. `chemins.pointage.*` (hors périmètre d'écriture de ce
 * fichier, `routes/chemins.ts`) ne pose pas ce paramètre — on l'ajoute ici, côté modèle.
 */
function avecVueEquipe(chemin: string): string {
  return `${chemin}${chemin.includes('?') ? '&' : '?'}vue=equipe`;
}

/**
 * Lecture de l'OR (`atelier.or.lire`, `apps/api/src/auth/matrice-droits.ts` — constante `LECTURE_OR`,
 * DISTINCTE de `LECTURE_ETENDUE` qui ne couvre que paramétrage/clients/véhicules/recherche) :
 * accordée à tous les rôles opérationnels de l'atelier, SAUF `vendeur` — seul des huit rôles de
 * personne à ne pas l'avoir (`DROITS_VENDEUR`, hors flux du lot 1). `poste_atelier` la reçoit aussi
 * (`DROITS_POSTE_ATELIER`), sans effet pratique ici : la borne murale ne rend de toute façon aucun
 * onglet (`estCompteAppareil`, plus bas dans ce fichier) — mais la liste reste fidèle au droit réel
 * plutôt que de l'omettre par convention de menu.
 *
 * CORRECTIF issue #46 : cet onglet ne portait aucune restriction, avec un commentaire qui confondait
 * `LECTURE_OR` et `LECTURE_ETENDUE` (deux constantes distinctes de la matrice) et n'avait pas
 * remarqué l'exclusion explicite de `vendeur` trois lignes plus haut dans le même fichier qu'il
 * citait. Un `vendeur` connecté voyait donc l'onglet, cliquait, et l'écran martelait
 * `GET /ordres-reparation` en 403 quatre fois en dix secondes avant de se stabiliser sur un message
 * de refus — voir aussi `useListeOrdresReparation.ts` pour le second correctif (arrêt du réessai).
 */
const ROLES_LECTURE_OR: readonly RoleUtilisateur[] = [
  'admin',
  'direction',
  'receptionnaire',
  'chef_atelier',
  'technicien',
  'magasinier',
  'comptable',
  'poste_atelier',
];

const ONGLETS_ATELIER: readonly OngletDomaine[] = [
  /**
   * Restreint à `ROLES_LECTURE_OR` ci-dessus (issue #46) — `vendeur` n'a pas `atelier.or.lire`.
   * Trois motifs — la ressource vit sous `/ordres-reparation` SAUF sa route de création, restée
   * sous `/atelier/ordres-reparation/nouveau` (repris du design, cf. `routeur.tsx`) : sans ce
   * second motif, l'écran de création serait le seul écran d'atelier sans onglet actif.
   */
  {
    id: 'ordresReparation',
    cleLibelle: 'navigation:onglets.atelierOrdresReparation',
    chemin: (site) => chemins.atelier.ordresReparation.liste(site),
    motifs: ['/ordres-reparation', '/atelier/ordres-reparation'],
    roles: ROLES_LECTURE_OR,
  },
  /**
   * Rendez-vous (Lot RDV-1) — activation du slot réservé au Lot D (§4.2 : « DEUXIÈME onglet
   * d'Atelier, entre Ordres de réparation et Pointage »), retiré d'`EMPLACEMENTS_RESERVES`
   * ci-dessous. `ROLES_LECTURE_RENDEZ_VOUS` reflète `rendez_vous.lire` (`droits-routes.ts`) : ferme
   * la lecture elle-même à `vendeur`/`magasinier`/`comptable`/`poste_atelier`.
   */
  {
    id: 'rendezVous',
    cleLibelle: 'navigation:onglets.atelierPlanning',
    chemin: (site) => chemins.atelier.rendezVous.agenda(site),
    motifs: ['/rendez-vous'],
    roles: ROLES_LECTURE_RENDEZ_VOUS,
  },
  /**
   * Pointage — CINQ vues, dont la borne. « Clôture de période » N'EST PLUS un écran autonome
   * depuis la fusion Lot E (`ecrans/pointage/EcranPointage.tsx`, commentaire de tête) :
   * `EcranCloturePeriodePointage` a été supprimé, et le geste de clôture (§4.5, « on clôture ce
   * qu'on regarde ») est devenu une action de la vue Équipe (`DialogueCloturePeriode`, montée par
   * `VueEquipePointage.tsx`).
   *
   * La vue `cloture` reste néanmoins déclarée ci-dessous, RATTACHÉE à Équipe plutôt que retirée :
   * `routes/routeur.tsx` monte encore une route réelle `/pointage/cloture` (qui rend
   * `EcranPointage`, comme `jour`/`equipe`), volontairement conservée par l'agent `routes/` parce
   * que `routes/atteignabilite.spec.ts` verrouille `trouverCorrespondance('/pointage/cloture')
   * ?.vue?.id === 'cloture'` — un test hors du périmètre d'écriture de ce fichier. La retirer
   * ferait rougir ce test sans pouvoir le corriger ici. Son `chemin` pointe donc explicitement sur
   * `?vue=equipe` (voir `avecVueEquipe` ci-dessus) : cliquer « Clôture » depuis le menu amène sur
   * l'onglet Équipe, là où vit désormais le dialogue de clôture — pas sur Journal, l'onglet par
   * défaut de `EcranPointage` en l'absence de ce paramètre. Le même correctif est appliqué à la
   * vue « Équipe » ci-dessous, qui souffrait du même défaut (son `chemin` ne portait pas non plus
   * `?vue=equipe`, donc atterrissait lui aussi sur Journal malgré son nom).
   *
   * « Borne d'atelier » : la borne est un APPAREIL, pas un poste de travail — §2 la met hors de
   * l'arborescence et `poste_atelier` y atterrit directement au login. Elle figure quand même ici
   * pour `chef_atelier`/`admin`, qui installent la tablette et ont besoin d'ouvrir l'écran pour
   * relever l'URL à mettre en favori. Voir `ROLES_BORNE_POINTAGE` (`routes/droits-routes.ts`) pour
   * la limite assumée de cet accès (l'identification par PIN y répond `403` pour ces deux rôles).
   */
  {
    id: 'pointage',
    cleLibelle: 'navigation:onglets.atelierPointage',
    chemin: (site) => chemins.pointage.saisie(site),
    motifs: ['/pointage'],
    roles: ROLES_POINTAGE,
    vues: [
      {
        id: 'monTravail',
        cleLibelle: 'navigation:onglets.pointageMonTravail',
        chemin: (site) => chemins.pointage.saisie(site),
        motifs: ['/pointage'],
        roles: ROLES_POINTAGE,
      },
      {
        id: 'journal',
        cleLibelle: 'navigation:onglets.pointageJournal',
        chemin: (site) => chemins.pointage.jour(site),
        motifs: ['/pointage/jour'],
        roles: ROLES_POINTAGE,
      },
      {
        id: 'equipe',
        cleLibelle: 'navigation:onglets.pointageEquipe',
        chemin: (site) => avecVueEquipe(chemins.pointage.equipe(site)),
        motifs: ['/pointage/equipe'],
        roles: ROLES_POINTAGE_ENCADREMENT,
      },
      {
        id: 'cloture',
        cleLibelle: 'navigation:onglets.pointageCloture',
        chemin: (site) => avecVueEquipe(chemins.pointage.cloture(site)),
        motifs: ['/pointage/cloture'],
        roles: ROLES_POINTAGE_ENCADREMENT,
      },
      {
        id: 'borne',
        cleLibelle: 'navigation:onglets.pointageBorne',
        chemin: () => chemins.pointage.borne(),
        motifs: ['/pointage/borne'],
        roles: ROLES_BORNE_POINTAGE,
      },
    ],
  },
  /**
   * Dépôt pneus sous ATELIER, pas sous Pièces (§4.4) : le test comptable tranche — un dépôt de
   * tiers ne se range pas dans le même écran que l'inventaire valorisé, sous peine d'être compté
   * un jour dans les actifs.
   *
   * AUCUNE vue ici, à la différence de la version d'origine du Lot D : « Au dépôt » et
   * « À relancer » étaient alors deux écrans réels (`EcranHangarPneus` et `EcranJeuxARelancer`),
   * depuis fusionnés en un seul écran à onglets INTERNES (`EcranHangarPneus.tsx`,
   * `TabsContent value="a_relancer"`, piloté par `?onglet=`, lequel n'apparaît jamais dans le
   * pathname). `trouverCorrespondance` résout par PATHNAME, pas par query (`cheminCorrespond`,
   * plus bas dans ce fichier) : `chemins.pneus.aRelancer()` (`routes/chemins.ts`) construit
   * désormais `/pneus?onglet=a_relancer`, un pathname identique à celui de « Au dépôt ». Une vue
   * « À relancer » motifée sur l'ancienne route `/pneus/a-relancer` ne matcherait donc plus jamais
   * rien — cette route a d'ailleurs été retirée de `routeur.tsx`. Complexifier
   * `trouverCorrespondance` pour lire la query, au bénéfice d'un seul onglet d'un seul écran, n'en
   * vaut pas la peine : l'onglet interne de l'écran assure déjà la distinction visuelle, et le
   * menu n'a besoin de surligner que « Dépôt pneus » dans son ensemble.
   */
  {
    id: 'depotPneus',
    cleLibelle: 'navigation:onglets.atelierDepotPneus',
    chemin: (site) => chemins.pneus.hangar(site),
    motifs: ['/pneus'],
    roles: ROLES_PNEUS,
  },
];

const ONGLETS_CLIENTS_VEHICULES: readonly OngletDomaine[] = [
  /**
   * « Doublons » en VUE et non en entrée de menu (§4.5) : une entrée de menu attend qu'on pense à
   * cliquer. Le rangement cible est un bandeau DANS l'écran Clients (« 12 fiches probablement en
   * double ») plus une détection à la frappe dans le formulaire de création — un doublon se crée
   * là, c'est là qu'il faut l'empêcher. Ce bandeau appartient à `ecrans/clients/` (hors périmètre
   * d'écriture du Lot D) ; la vue ci-dessous garde `EcranDoublonsClients` atteignable en attendant,
   * et disparaîtra quand le bandeau sera posé.
   */
  {
    id: 'clients',
    cleLibelle: 'navigation:onglets.clients',
    chemin: (site) => chemins.clients.liste(site),
    motifs: ['/clients'],
    vues: [
      {
        id: 'tous',
        cleLibelle: 'navigation:onglets.clientsTous',
        chemin: (site) => chemins.clients.liste(site),
        motifs: ['/clients'],
      },
      {
        id: 'doublons',
        cleLibelle: 'navigation:onglets.clientsDoublons',
        chemin: () => chemins.clients.doublons(),
        motifs: ['/clients/doublons'],
      },
    ],
  },
  {
    id: 'vehicules',
    cleLibelle: 'navigation:onglets.vehicules',
    chemin: (site) => chemins.vehicules.liste(site),
    motifs: ['/vehicules'],
  },
  /**
   * Scanner de permis de circulation — TROISIÈME onglet de Clients & véhicules (nouveau chantier
   * mobile). Rangement choisi ici, pas une septième entrée de menu (§4.1, « la règle de
   * rangement ») : le scan est une DESTINATION (« créer client + véhicule depuis un permis »), pas
   * un objet, et il crée exactement ce que ces deux onglets voisins listent — même famille que
   * §4.1 le prescrit. `roles: ROLES_SCAN` (`routes/droits-routes.ts`) : seuls les rôles qui
   * détiennent `client.creer` ET `vehicule.creer` voient l'onglet, faute de quoi la soumission du
   * formulaire échouerait systématiquement en `403` pour eux.
   *
   * C'est aussi l'ancrage DESKTOP de l'écran (mise en service, vérification du rendu) — sur
   * téléphone, `composants/layout/useModeScanMobile.ts` y redirige automatiquement les mêmes
   * rôles, sans passer par ce menu (voir sa doc de tête).
   */
  {
    id: 'scan',
    cleLibelle: 'navigation:onglets.scan',
    chemin: (site) => chemins.scan(site),
    motifs: ['/scan'],
    roles: ROLES_SCAN,
  },
];

/**
 * Lecture fournisseur/commande fournisseur (`pieces.fournisseur.lire`,
 * `pieces.commande_fournisseur.lire`, `apps/api/src/auth/matrice-droits.ts`,
 * `DROITS_PIECES_PAR_ROLE`) : `direction`, `chef_atelier`, `magasinier` SEULS — PAS `comptable`,
 * `vendeur`, `receptionnaire`, `technicien` (qui n'ont que la lecture générale `pieces.article.lire`/
 * `pieces.stock.lire`). Mêmes trois rôles, MÊMES VALEURS littérales que la constante privée
 * `ROLES_LECTURE_FOURNISSEUR` d'`apps/web/src/ecrans/pieces/droits.ts` — reprise ici plutôt
 * qu'importée (`routes/` et `composants/layout/` ne dépendent jamais d'`ecrans/*`, voir l'en-tête
 * de `routes/droits-routes.ts` : « Lot D... rend routes/ et composants/layout/ autonomes »), même
 * chaîne de duplication assumée que `ROLES_PIECES`/`ROLES_PARAMETRAGE_PIECES` ci-dessous
 * (`routes/droits-routes.ts`). CORRECTIF issue #44 : ces deux vues portaient à tort `ROLES_PIECES`
 * (les sept rôles), un menu affichant un onglet que le serveur refuse en 403 à quatre d'entre eux.
 */
const ROLES_LECTURE_FOURNISSEUR_PIECES: readonly RoleUtilisateur[] = [
  'direction',
  'chef_atelier',
  'magasinier',
];

/**
 * Lecture consigne (`pieces.consigne.lire`, `DROITS_PIECES_PAR_ROLE`) : `direction`, `chef_atelier`,
 * `magasinier`, ET `comptable` (donnée financière — « une consigne jamais rendue est une créance
 * qui dort ») — PAS `vendeur`, `receptionnaire`, `technicien`. Mêmes valeurs que la constante privée
 * `ROLES_LECTURE_CONSIGNE` d'`ecrans/pieces/droits.ts`, même raisonnement de duplication que
 * `ROLES_LECTURE_FOURNISSEUR_PIECES` ci-dessus. CORRECTIF issue #44, second cas trouvé en vérifiant
 * systématiquement les autres onglets du fichier après le rapport du chasseur : l'onglet Consignes
 * portait le même défaut (`ROLES_PIECES`) et n'avait pas été testé par lui.
 */
/**
 * Lecture facture fournisseur (`pieces.facture_fournisseur.lire`, INFÉRÉ — pas encore de
 * `matrice-droits.ts` côté serveur pour ce sous-domaine au moment où cette vue est câblée, voir
 * `hooks/pieces/factures-fournisseur.temporaire.ts`) : `direction`, `chef_atelier`, `magasinier`,
 * ET `comptable` — mêmes valeurs, MÊME raisonnement (« une créance/dépense qui dort ») que
 * `ROLES_LECTURE_CONSIGNE_PIECES` ci-dessous, mais gardée SÉPARÉE plutôt que réutilisée : les deux
 * droits sont distincts côté API (consigne vs facture fournisseur), une coïncidence de valeurs
 * aujourd'hui ne garantit rien pour demain. Mêmes valeurs littérales que la constante privée
 * `ROLES_LECTURE_FACTURE_FOURNISSEUR` d'`apps/web/src/ecrans/pieces/droits.ts` — même chaîne de
 * duplication assumée que `ROLES_LECTURE_FOURNISSEUR_PIECES` ci-dessus (`routes/` et
 * `composants/layout/` ne dépendent jamais d'`ecrans/*`).
 */
const ROLES_LECTURE_FACTURE_FOURNISSEUR_PIECES: readonly RoleUtilisateur[] = [
  'direction',
  'chef_atelier',
  'magasinier',
  'comptable',
];

const ROLES_LECTURE_CONSIGNE_PIECES: readonly RoleUtilisateur[] = [
  'direction',
  'chef_atelier',
  'magasinier',
  'comptable',
];

const ONGLETS_PIECES: readonly OngletDomaine[] = [
  /**
   * `DROITS_PIECES_PAR_ROLE.admin` vaut `[]` littéralement côté API (RF-115), la LECTURE elle-même
   * est fermée à `admin` — l'entrée Pièces entière disparaît donc pour lui, comme aujourd'hui.
   * Comptoir et Articles portent `ROLES_PIECES` (les sept rôles, `pieces.article.lire`/
   * `pieces.stock.lire`/`pieces.reservation.lire` ouverts à tous) ; Approvisionnement et Consignes
   * sont plus étroits à l'intérieur — voir leurs commentaires respectifs.
   *
   * « Comptoir » est le PREMIER onglet, donc l'onglet par défaut de l'entrée : c'est
   * l'atterrissage du magasinier (§2), qui ne doit pas tomber sur l'inventaire.
   */
  {
    id: 'comptoir',
    cleLibelle: 'navigation:onglets.piecesComptoir',
    chemin: (site) => chemins.pieces.rechercheComptoir(site),
    motifs: ['/pieces/recherche-comptoir'],
    roles: ROLES_PIECES,
  },
  /**
   * §4.5 range « Réservations » comme un FILTRE d'Articles. `EcranReservationsPieces` est
   * aujourd'hui un écran autonome vérifié comme NE FUSIONNANT PAS avec la liste d'articles
   * (avertissement explicite de l'arbitrage : « un onglet n'est pas une fusion, c'est un
   * rangement ») — il devient donc une VUE de l'onglet Articles, pas un onglet de plus.
   */
  {
    id: 'articles',
    cleLibelle: 'navigation:onglets.piecesArticles',
    chemin: (site) => chemins.pieces.articles(site),
    motifs: ['/pieces/articles', '/pieces/reservations'],
    roles: ROLES_PIECES,
    vues: [
      {
        id: 'tous',
        cleLibelle: 'navigation:onglets.piecesArticlesTous',
        chemin: (site) => chemins.pieces.articles(site),
        motifs: ['/pieces/articles'],
        roles: ROLES_PIECES,
      },
      {
        id: 'reservations',
        cleLibelle: 'navigation:onglets.piecesReservations',
        chemin: (site) => chemins.pieces.reservations(site),
        motifs: ['/pieces/reservations'],
        roles: ROLES_PIECES,
      },
    ],
  },
  /**
   * Approvisionnement rassemble les trois entrées de menu qui décrivaient la même chaîne :
   * « À commander » (le réapprovisionnement pré-rempli), « Commandes » (les commandes fournisseur)
   * et « Fournisseurs ». Un fournisseur se consulte depuis une commande, jamais dans l'absolu —
   * d'où sa place en troisième vue et non en onglet.
   *
   * L'ONGLET porte `ROLES_PIECES` (les sept rôles) parce que sa vue par défaut, « À commander »
   * (`pieces.stock.lire`), leur est ouverte à tous. SES DEUX AUTRES VUES sont plus étroites :
   * « Commandes » et « Fournisseurs » portent `ROLES_LECTURE_FOURNISSEUR_PIECES` (trois rôles),
   * pas `ROLES_PIECES` — voir sa définition ci-dessus. Avant correctif (issue #44), les deux
   * portaient `ROLES_PIECES` : un `vendeur`/`comptable`/`receptionnaire`/`technicien` voyait ces
   * deux vues, cliquait, et recevait un `403` de l'API suivi d'un écran d'erreur sans retour
   * possible — l'onglet mentait sur ce qu'il proposait.
   */
  {
    id: 'approvisionnement',
    cleLibelle: 'navigation:onglets.piecesApprovisionnement',
    chemin: (site) => chemins.pieces.reapprovisionnement(site),
    motifs: [
      '/pieces/reapprovisionnement',
      '/pieces/commandes-fournisseur',
      '/pieces/fournisseurs',
      '/pieces/factures-fournisseur',
    ],
    roles: ROLES_PIECES,
    vues: [
      {
        id: 'aCommander',
        cleLibelle: 'navigation:onglets.piecesACommander',
        chemin: (site) => chemins.pieces.reapprovisionnement(site),
        motifs: ['/pieces/reapprovisionnement'],
        roles: ROLES_PIECES,
      },
      {
        id: 'commandes',
        cleLibelle: 'navigation:onglets.piecesCommandes',
        chemin: (site) => chemins.pieces.commandesFournisseur.liste(site),
        motifs: ['/pieces/commandes-fournisseur'],
        roles: ROLES_LECTURE_FOURNISSEUR_PIECES,
      },
      {
        id: 'fournisseurs',
        cleLibelle: 'navigation:onglets.piecesFournisseurs',
        chemin: (site) => chemins.pieces.fournisseurs.liste(site),
        motifs: ['/pieces/fournisseurs'],
        roles: ROLES_LECTURE_FOURNISSEUR_PIECES,
      },
      /**
       * Factures fournisseurs (dépôt, rapprochement, décision) — dernière vue du groupe, même
       * famille que Commandes/Fournisseurs ci-dessus (workflow fournisseur), rôles ÉLARGIS à
       * `comptable` (voir `ROLES_LECTURE_FACTURE_FOURNISSEUR_PIECES`, pièce comptable) —
       * `vendeur`/`receptionnaire`/`technicien` n'y ont aucun droit, comme pour Commandes et
       * Fournisseurs. Motif couvre les trois routes (`liste`, `deposer`, `:id`) : correspondance
       * par segment (`cheminCorrespond`), un seul préfixe suffit.
       */
      {
        id: 'facturesFournisseur',
        cleLibelle: 'navigation:onglets.piecesFacturesFournisseur',
        chemin: (site) => chemins.pieces.facturesFournisseur.liste(site),
        motifs: ['/pieces/factures-fournisseur'],
        roles: ROLES_LECTURE_FACTURE_FOURNISSEUR_PIECES,
      },
    ],
  },
  /**
   * `pieces.consigne.lire` est fermé à `vendeur`/`receptionnaire`/`technicien` (voir
   * `ROLES_LECTURE_CONSIGNE_PIECES` ci-dessus) — DEUXIÈME cas du même défaut qu'Approvisionnement,
   * trouvé en vérifiant systématiquement ce fichier après le rapport de l'issue #44 (le chasseur
   * n'avait testé que Commandes/Fournisseurs). Portait `ROLES_PIECES` avant correctif.
   */
  {
    id: 'consignes',
    cleLibelle: 'navigation:onglets.piecesConsignes',
    chemin: (site) => chemins.pieces.consignes(site),
    motifs: ['/pieces/consignes'],
    roles: ROLES_LECTURE_CONSIGNE_PIECES,
  },
];

const ONGLETS_FACTURATION: readonly OngletDomaine[] = [
  /**
   * PAS de vues « toutes · impayées · à relancer » ici, contrairement à ce que suggère le tableau
   * §4.2 : `EcranListeFactures` porte DÉJÀ ces trois onglets, en état local (« Non réglées » par
   * défaut, §7.1 de la spécification de facturation). Les redoubler d'une rangée de vues qui ne
   * pilote rien produirait deux jeux d'onglets contradictoires sur le même écran. Le jour où ces
   * filtres passeront dans l'URL (ce qu'ils devraient — un filtre se partage par lien), ils
   * viendront ici en vues, et la rangée locale disparaîtra.
   */
  {
    id: 'factures',
    cleLibelle: 'navigation:onglets.facturationFactures',
    chemin: (site) => chemins.facturation.liste(site),
    motifs: ['/factures'],
    roles: ROLES_MENU_FACTURATION,
  },
  /**
   * Déclenchement des relances sous FACTURATION, pas sous Réglages (§4.5 : « déclenchement ->
   * Factures »). Scindé de l'ancien `EcranRelances` (qui portait AUSSI les paliers) : voir l'onglet
   * `relances` d'`ONGLETS_REGLAGES` ci-dessous pour le réglage des paliers, désormais séparé. Ce qui
   * reste ici (planifier/envoyer/historique) n'est pas un réglage qu'on pose une fois puis qu'on
   * oublie, c'est un écran actionné régulièrement — et le `comptable`, dont c'est l'outil, atterrit
   * précisément sur Facturation.
   */
  {
    id: 'relances',
    cleLibelle: 'navigation:onglets.facturationRelances',
    chemin: (site) => chemins.relances(site),
    motifs: ['/relances'],
    roles: ROLES_RELANCES,
  },
];

const ONGLETS_VENTES: readonly OngletDomaine[] = [
  /**
   * « Dossiers » en PREMIER, donc onglet par défaut : c'est l'atterrissage du vendeur (§2). Les
   * trois onglets portent `ROLES_VENTES` — `ventes.*` est `[]` pour `admin`/`technicien`/
   * `magasinier` côté API (RF-115), l'entrée entière disparaît pour eux.
   *
   * « Véhicules en parc » et non « Stock » (§4.3) : lève l'homonymie avec Pièces, et dit ce que
   * c'est plutôt que d'où ça vient.
   */
  {
    id: 'dossiers',
    cleLibelle: 'navigation:onglets.ventesDossiers',
    chemin: (site) => chemins.ventes.dossiers.liste(site),
    motifs: ['/ventes/dossiers'],
    roles: ROLES_VENTES,
  },
  {
    id: 'parc',
    cleLibelle: 'navigation:onglets.ventesParc',
    chemin: (site) => chemins.ventes.stock.liste(site),
    motifs: ['/ventes/stock'],
    roles: ROLES_VENTES,
  },
  {
    id: 'suivi',
    cleLibelle: 'navigation:onglets.ventesSuivi',
    chemin: (site) => chemins.ventes.suivi(site),
    motifs: ['/ventes/suivi'],
    roles: ROLES_VENTES,
  },
];

const ONGLETS_REGLAGES: readonly OngletDomaine[] = [
  /**
   * ORDRE REPRIS DE §4.2 tel quel (Atelier · Sites · Facturation · Tarifs · Pièces). Conséquence
   * assumée : l'onglet par défaut de Réglages dépend du rôle, puisque c'est le PREMIER ONGLET
   * VISIBLE qui fait défaut (`cheminEntree`). Un `receptionnaire` n'a accès qu'à « Tarifs et
   * prestations » — Réglages l'ouvre donc directement dessus, sans jamais lui montrer un onglet
   * refusé.
   *
   * « Tarifs et prestations » n'a VOLONTAIREMENT aucune restriction de rôle : c'est un outil de
   * comptoir (« combien coûte ce service ? »), et le réceptionniste est celui qui le consulte le
   * plus alors qu'il n'appartient à aucun groupe de gouvernance. L'absence de restriction est la
   * décision, pas un oubli — voir `droits-routes.ts`.
   */
  {
    id: 'atelier',
    cleLibelle: 'navigation:onglets.reglagesAtelier',
    chemin: (site) => chemins.parametrage.atelier(site),
    motifs: ['/parametrage/atelier'],
    roles: ROLES_MENU_PARAMETRAGE_ATELIER,
  },
  {
    id: 'sites',
    cleLibelle: 'navigation:onglets.reglagesSites',
    chemin: (site) => chemins.parametrage.sites(site),
    motifs: ['/parametrage/sites'],
    roles: ROLES_MENU_PARAMETRAGE_ATELIER,
  },
  {
    id: 'facturation',
    cleLibelle: 'navigation:onglets.reglagesFacturation',
    chemin: (site) => chemins.parametrage.facturation(site),
    motifs: ['/parametrage/facturation'],
    roles: ROLES_MENU_FINANCIER,
  },
  {
    id: 'tarifs',
    cleLibelle: 'navigation:onglets.reglagesTarifs',
    chemin: (site) => chemins.parametrage.referentiels(site),
    motifs: ['/parametrage/referentiels'],
  },
  {
    id: 'pieces',
    cleLibelle: 'navigation:onglets.reglagesPieces',
    chemin: (site) => chemins.parametrage.pieces(site),
    motifs: ['/parametrage/pieces'],
    roles: ROLES_PARAMETRAGE_PIECES,
  },
  /** Gestion des employés (issue #137) — dernier onglet de Réglages : « le patron d'un garage ne
   *  peut pas gérer ses employés » (brief). Visible SEULEMENT à `direction`/`admin`, même groupe
   *  que la garde de route (`ROLES_GESTION_UTILISATEURS`, `droits-routes.ts`) — reflet direct de
   *  `socle.utilisateur.lire` côté API, pas une restriction inventée par ce menu. */
  {
    id: 'utilisateurs',
    cleLibelle: 'navigation:onglets.reglagesUtilisateurs',
    chemin: (site) => chemins.parametrage.utilisateurs(site),
    motifs: ['/parametrage/utilisateurs'],
    roles: ROLES_GESTION_UTILISATEURS,
  },
  /**
   * Paliers de relance (scission de l'ancien `EcranRelances`, §4.5 : « paliers -> Réglages »).
   * DERNIER onglet de Réglages — l'emplacement était RÉSERVÉ ici depuis le lot D
   * (voir l'historique d'`EMPLACEMENTS_RESERVES` ci-dessous), le temps que l'écran mixte se scinde.
   * `roles: ROLES_RELANCES` reflète la même restriction RÉELLE que l'onglet `relances` de
   * Facturation ci-dessus : `relances.facturation.regle.lire` ferme la LECTURE elle-même à tout
   * rôle hors `direction`/`comptable` côté API.
   */
  {
    id: 'relances',
    cleLibelle: 'navigation:onglets.reglagesRelances',
    chemin: (site) => chemins.parametrage.relances(site),
    motifs: ['/parametrage/relances'],
    roles: ROLES_RELANCES,
  },
];

/** Les SIX entrées, dans l'ordre de la journée. Réglages n'en fait pas partie : il vit en pied. */
export const ENTREES_MENU: readonly EntreeMenu[] = [
  {
    id: 'aujourdhui',
    cleLibelle: 'navigation:entrees.aujourdhui',
    icone: Sunrise,
    onglets: ONGLETS_AUJOURDHUI,
  },
  {
    id: 'atelier',
    cleLibelle: 'navigation:entrees.atelier',
    icone: Wrench,
    onglets: ONGLETS_ATELIER,
  },
  {
    id: 'clientsVehicules',
    cleLibelle: 'navigation:entrees.clientsVehicules',
    icone: Users,
    onglets: ONGLETS_CLIENTS_VEHICULES,
  },
  {
    id: 'pieces',
    cleLibelle: 'navigation:entrees.pieces',
    icone: Boxes,
    onglets: ONGLETS_PIECES,
  },
  {
    id: 'facturation',
    cleLibelle: 'navigation:entrees.facturation',
    icone: Receipt,
    onglets: ONGLETS_FACTURATION,
  },
  {
    id: 'ventes',
    cleLibelle: 'navigation:entrees.ventes',
    icone: CarFront,
    onglets: ONGLETS_VENTES,
  },
];

/** Réglages — séparé des six par un filet, en pied de barre (§4.2). Une seule porte pour tout ce
 *  qui se configure rarement et jamais dans le flux de travail. */
export const ENTREE_REGLAGES: EntreeMenu = {
  id: 'reglages',
  cleLibelle: 'navigation:entrees.reglages',
  icone: Settings,
  onglets: ONGLETS_REGLAGES,
};

/** Toutes les entrées, six + Réglages — pour la résolution d'URL, qui ne distingue pas le pied. */
export const TOUTES_ENTREES: readonly EntreeMenu[] = [...ENTREES_MENU, ENTREE_REGLAGES];

// =================================================================================================
// Emplacements réservés
// =================================================================================================

/**
 * PLACES TENUES pour des écrans qui n'existent pas encore, afin que leur arrivée n'ait pas à
 * ROUVRIR le menu (le lot D est le lot qui referme l'arborescence : la rouvrir six mois plus tard
 * pour caser un écran, c'est refaire le débat à chaque livraison).
 *
 * Elles ne sont PAS rendues. Ce dépôt s'interdit les entrées grisées « à venir » depuis l'étape 0
 * (voir l'en-tête historique de `BarreLaterale.tsx` : « aucun élément grisé à venir — chaque lien
 * pointe vers un écran réellement atteignable ») : un onglet mort annonce un contenu qui n'existe
 * pas et se fait cliquer trois fois avant d'être compris. Ce que « réserver » veut dire ici, c'est
 * que le RANGEMENT est décidé et écrit — l'entrée d'accueil, le libellé, le voisinage — de sorte
 * que livrer l'écran se réduise à déplacer une ligne d'ici vers le tableau ci-dessus.
 */
export const EMPLACEMENTS_RESERVES: readonly {
  readonly entree: string;
  readonly onglet: string;
  readonly cleLibelle: string;
  readonly motif: string;
}[] = [
  {
    entree: 'facturation',
    onglet: 'exportFiduciaire',
    cleLibelle: 'navigation:onglets.facturationExportFiduciaire',
    motif:
      "Export vers la fiduciaire (WinBIZ, Bexio, Abacus, Banana). L'API expose déjà " +
      "`facturation.export.creer` (direction/comptable seuls, `admin: []`) ; il manque l'écran. " +
      'Va en TROISIÈME onglet de Facturation, après Relances — un export se déclenche depuis le ' +
      "domaine dont il exporte les documents, jamais depuis Réglages (ce n'est pas un paramètre, " +
      "c'est une opération datée qu'on rejoue chaque fin de mois).",
  },
  {
    entree: 'facturation',
    onglet: 'encaissements',
    cleLibelle: 'navigation:onglets.facturationEncaissements',
    motif:
      "§4.2 prévoit « Factures · Encaissements » ; les opérations d'encaissement et de lettrage " +
      "existent côté API (étape 2) mais n'ont aucun écran de liste autonome — elles se pratiquent " +
      'depuis la fiche facture. Emplacement tenu en DEUXIÈME onglet de Facturation.',
  },
];

// =================================================================================================
// Résolution : URL -> entrée / onglet / vue, et filtrage par rôle
// =================================================================================================

/**
 * Correspondance par SEGMENT, jamais par simple préfixe de chaîne : `/pneus` ne doit pas activer
 * l'onglet Dépôt pneus sur une hypothétique URL `/pneusomatic`. `/` est traité à part — préfixe de
 * tout, il n'activerait jamais rien d'autre que lui-même.
 */
export function cheminCorrespond(pathname: string, motif: string): boolean {
  if (motif === '/') return pathname === '/';
  return pathname === motif || pathname.startsWith(`${motif}/`);
}

/** Longueur du motif le plus spécifique qui matche, ou `undefined` si aucun. Le plus long gagne :
 *  `/pointage/jour` bat `/pointage`. */
function scoreCorrespondance(pathname: string, motifs: readonly string[]): number | undefined {
  let meilleur: number | undefined;
  for (const motif of motifs) {
    if (cheminCorrespond(pathname, motif) && (meilleur === undefined || motif.length > meilleur)) {
      meilleur = motif.length;
    }
  }
  return meilleur;
}

/** `undefined` sur `roles` = aucune restriction, visible même session non encore résolue (le menu
 *  ne doit pas clignoter au chargement). Une restriction posée + rôle inconnu = masqué : on ne
 *  montre jamais une entrée gouvernée « au cas où ». */
export function estAutorise(roles: Roles, role: RoleUtilisateur | undefined): boolean {
  if (roles === undefined) return true;
  return role !== undefined && roles.includes(role);
}

/**
 * `poste_atelier` est un APPAREIL, pas un employé (§2, décision « on n'y revient pas ») : la borne
 * murale n'a ni menu, ni onglets, ni recherche — un seul geste, le pavé numérique. Filtrer entrée
 * par entrée laisserait passer celles qui n'ont aucune restriction (Clients & véhicules, Ordres de
 * réparation), ce qui remettrait un menu sur une tablette qui n'en veut pas.
 */
function estCompteAppareil(role: RoleUtilisateur | undefined): boolean {
  return role === 'poste_atelier';
}

export function vuesVisibles(
  onglet: OngletDomaine,
  role: RoleUtilisateur | undefined,
): readonly VueDomaine[] {
  // Même garde que `ongletsVisibles` : la borne murale ne rend aucun niveau de navigation. Sans
  // elle, `poste_atelier` verrait la rangée de vues du pointage — précisément ce que §2 exclut.
  if (estCompteAppareil(role)) return [];
  return (onglet.vues ?? []).filter((vue) => estAutorise(vue.roles, role));
}

export function ongletsVisibles(
  entree: EntreeMenu,
  role: RoleUtilisateur | undefined,
): readonly OngletDomaine[] {
  if (estCompteAppareil(role)) return [];
  return entree.onglets.filter((onglet) => estAutorise(onglet.roles, role));
}

/** Une entrée existe pour un rôle si et seulement si au moins un de ses onglets lui est ouvert —
 *  aucune liste de rôles séparée au niveau de l'entrée, donc aucune divergence possible entre
 *  « l'entrée est visible » et « son contenu est vide ». */
export function entreesVisibles(role: RoleUtilisateur | undefined): readonly EntreeMenu[] {
  return ENTREES_MENU.filter((entree) => ongletsVisibles(entree, role).length > 0);
}

export function reglagesVisibles(role: RoleUtilisateur | undefined): boolean {
  return ongletsVisibles(ENTREE_REGLAGES, role).length > 0;
}

/**
 * ONGLET PAR DÉFAUT PAR RÔLE (§2, « l'onglet par défaut d'une entrée varie par rôle »). Par
 * construction, le défaut est le PREMIER ONGLET VISIBLE — ce qui suffit déjà pour le magasinier
 * (Pièces -> Comptoir, premier onglet) et pour Réglages (dont le premier onglet visible dépend
 * mécaniquement des droits). Ce tableau ne porte que les exceptions RÉELLES, celles où l'ordre de
 * lecture du domaine et l'usage d'un rôle divergent.
 */
type DefautsOngletParEntree = Readonly<Record<string, string>>;

const ONGLET_DEFAUT_PAR_ROLE: Partial<Record<RoleUtilisateur, DefautsOngletParEntree>> = {
  /** Le technicien qui ouvre Atelier vient pointer, pas lire la liste des OR du garage — « Mon
   *  travail » est sa page, § 2 (« il n'a jamais à traverser quoi que ce soit pour y arriver »). */
  technicien: { atelier: 'pointage' },
  /** Même raison pour le magasinier : il pointe aussi (`atelier.pointage.lire` lui est ouvert) et
   *  n'a rien à faire dans la liste des OR quand il ouvre Atelier. */
  magasinier: { atelier: 'pointage' },
};

/** L'onglet sur lequel une entrée s'ouvre pour ce rôle. `undefined` si l'entrée entière lui est
 *  fermée. */
export function ongletDefaut(
  entree: EntreeMenu,
  role: RoleUtilisateur | undefined,
): OngletDomaine | undefined {
  const visibles = ongletsVisibles(entree, role);
  if (visibles.length === 0) return undefined;
  const idSouhaite = role === undefined ? undefined : ONGLET_DEFAUT_PAR_ROLE[role]?.[entree.id];
  return visibles.find((onglet) => onglet.id === idSouhaite) ?? visibles[0];
}

/** La cible du lien de menu : le chemin de l'onglet par défaut, site courant conservé. */
export function cheminEntree(
  entree: EntreeMenu,
  role: RoleUtilisateur | undefined,
  site: string | undefined,
): string | undefined {
  return ongletDefaut(entree, role)?.chemin(site);
}

export interface CorrespondanceNavigation {
  readonly entree: EntreeMenu;
  readonly onglet: OngletDomaine;
  /** Vue active, si l'onglet en porte et que l'URL en désigne une. */
  readonly vue?: VueDomaine;
}

/**
 * Où suis-je dans l'arborescence ? Résolu depuis l'URL SEULE — jamais depuis un état de
 * composant : une fiche (`/clients/42`, `/ordres-reparation/…`) doit surligner l'onglet de son
 * domaine, c'est là que le garagiste lit « je suis dans Clients », et c'est aussi ce qui rend le
 * bouton Précédent et un lien partagé cohérents avec ce que montre l'écran.
 *
 * `undefined` pour une URL hors arborescence (`/login`, `/recherche`, une 404) — l'appelant
 * n'affiche alors simplement aucun onglet.
 */
export function trouverCorrespondance(pathname: string): CorrespondanceNavigation | undefined {
  let meilleur: { entree: EntreeMenu; onglet: OngletDomaine; score: number } | undefined;
  for (const entree of TOUTES_ENTREES) {
    for (const onglet of entree.onglets) {
      const score = scoreCorrespondance(pathname, onglet.motifs);
      if (score !== undefined && (meilleur === undefined || score > meilleur.score)) {
        meilleur = { entree, onglet, score };
      }
    }
  }
  if (meilleur === undefined) return undefined;

  let vue: VueDomaine | undefined;
  let scoreVue = -1;
  for (const candidate of meilleur.onglet.vues ?? []) {
    const score = scoreCorrespondance(pathname, candidate.motifs);
    if (score !== undefined && score > scoreVue) {
      vue = candidate;
      scoreVue = score;
    }
  }
  return { entree: meilleur.entree, onglet: meilleur.onglet, vue };
}
