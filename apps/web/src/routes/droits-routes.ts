import type { RoleUtilisateur } from '@dfa/shared';

/**
 * DEUX NOTIONS DISTINCTES — ne plus jamais les fusionner dans une même liste (arbitrage du
 * coordinateur, lot 2, suite à une consigne initiale trop grossière) :
 *
 * 1. « Qui peut ATTEINDRE la route » — protection RÉELLE, posée via `RouteProtegee.rolesAutorises`
 *    dans `routeur.tsx`. N'a de sens QUE pour un droit que l'API restreint elle-même en LECTURE
 *    (pas seulement en écriture) : sinon la garde de route est un décor — n'importe quel appelant
 *    atteint la même donnée directement par l'API, la garde ne fait que gêner un usage légitime.
 *    `parametrage.referentiel.lire` / `parametrage.atelier.lire` sont accordés à TOUS les rôles
 *    authentifiés (`auth/matrice-droits.ts`, `LECTURE_ETENDUE`) — aucune des routes de paramétrage
 *    atelier/référentiels/sites ne pose donc `rolesAutorises`. `facturation.parametrage.creancier.
 *    lire` EST restreint côté API (direction/comptable) mais `/parametrage/facturation` n'utilise
 *    quand même pas ce mécanisme : l'écran y porte son propre refus dédié pour le cas `admin`
 *    (RF-115), plus explicite qu'`EcranAccesRefuse` — voir le commentaire de tête de
 *    `EcranParametresFacturation.tsx` et celui posé au-dessus de cette route dans `routeur.tsx`.
 *
 * 2. « À qui on PROPOSE l'entrée dans le menu » — ERGONOMIE, PAS SÉCURITÉ. Masquer une entrée à un
 *    rôle qui pourrait légitimement l'atteindre (lecture ouverte à tous) n'est pas une faille à
 *    combler : chaque route reste accessible par son URL, l'écriture reste grisée dans l'écran ET
 *    refusée par le serveur — la seule barrière qui compte. Consommé uniquement par
 *    `BarreLaterale.tsx`, jamais par `routeur.tsx`.
 *
 *    - `ROLES_MENU_PARAMETRAGE_ATELIER` (chef d'atelier, direction, admin) : masque « Paramétrage
 *      atelier » et « Sites » (horaires, capacité, clôture pointage) aux rôles qui n'ont jamais à y
 *      toucher — un technicien n'a rien à faire de ces réglages, les exposer n'est que du bruit.
 *    - AUCUNE liste équivalente pour « Référentiels » (tarifs et prestations) : ce lien est
 *      TOUJOURS visible, à tout rôle authentifié. Le réceptionniste est le rôle qui consulte LE
 *      PLUS ce référentiel — c'est lui qui répond « combien coûte ce service ? » au comptoir et au
 *      téléphone — et il ne fait pourtant pas partie du groupe `ROLES_MENU_PARAMETRAGE_ATELIER`.
 *      Un garage ne peut pas fonctionner si cet outil de comptoir lui est masqué. NE PAS créer de
 *      liste de rôles pour ce lien : l'absence de restriction est la décision, pas un oubli.
 *    - `ROLES_MENU_FINANCIER` (direction, comptable) : masque « Coordonnées bancaires » (bloc
 *      créancier QR-facture) aux autres rôles — reflète ici un droit RÉELLEMENT restreint côté API
 *      (contrairement au groupe atelier ci-dessus), mais reste un confort de menu : la protection
 *      réelle est le `403` que l'API rend et l'écran dédié qui l'explique, pas ce masquage.
 *
 * ATTENTION à qui modifierait ce fichier plus tard : réintroduire une restriction de rôle sur la
 * ROUTE `parametrage/referentiels` (le mécanisme existe, `RouteProtegee.rolesAutorises` est prêt à
 * l'emploi) casserait l'usage comptoir du réceptionniste SANS ajouter de protection réelle
 * (l'API autorise déjà la lecture à tous) — ce n'est pas « corriger un oubli de sécurité », c'est
 * défaire un arbitrage métier déjà tranché. Voir `routeur.spec.tsx`, le test qui prouve que tous
 * les rôles atteignent `/parametrage/referentiels` : il rougit si cette route se referme.
 */
export const ROLES_MENU_PARAMETRAGE_ATELIER: readonly RoleUtilisateur[] = [
  'chef_atelier',
  'direction',
  'admin',
];

/** RF-115 : `admin` volontairement absent — voir le point 2 ci-dessus. */
export const ROLES_MENU_FINANCIER: readonly RoleUtilisateur[] = ['direction', 'comptable'];

/**
 * Module pièces (étape 3) — CAS DE FIGURE 1 CI-DESSUS (protection RÉELLE de route), pas
 * seulement une ergonomie de menu : `DROITS_PIECES_PAR_ROLE.admin` vaut `[]` littéralement
 * (`apps/api/src/auth/matrice-droits.ts`, RF-115) — la LECTURE elle-même (`pieces.article.lire`,
 * `pieces.stock.lire`, `pieces.reservation.lire`) est fermée à `admin`, contrairement à
 * `parametrage.referentiel.lire` (ouvert à tous, d'où l'absence de `rolesAutorises` sur ces
 * routes-là). Poser `rolesAutorises: ROLES_PIECES` sur chaque route du module reflète donc une
 * restriction que l'API applique déjà, ça ne l'invente pas : un `admin` qui l'atteindrait quand
 * même se heurterait à un `403` sur CHAQUE appel (liste, fiche, recherche comptoir…), un écran
 * cassé de bout en bout plutôt qu'un refus explicite — voir `EcranAccesRefuse.tsx`.
 *
 * Les SEPT rôles opérationnels (tous sauf `admin`) — dérivé de `DROITS_PIECES_PAR_ROLE`, pas
 * une liste choisie séparément : chacun y porte au moins `LECTURE_PIECES`.
 */
export const ROLES_PIECES: readonly RoleUtilisateur[] = [
  'direction',
  'comptable',
  'vendeur',
  'receptionnaire',
  'chef_atelier',
  'magasinier',
  'technicien',
];

/**
 * Paramétrage pièces (`/parametrage/pieces`) — sous-ensemble STRICT de `ROLES_PIECES` ci-dessus,
 * pas une liste indépendante : `pieces.parametrage.lire` (`apps/api/src/auth/matrice-droits.ts`)
 * n'est accordé qu'à `direction`, `chef_atelier` et `magasinier` — `comptable`, `vendeur`,
 * `receptionnaire` et `technicien` ont `pieces.article.lire`/`pieces.stock.lire`/etc. (d'où leur
 * présence dans `ROLES_PIECES`) mais AUCUN droit `pieces.parametrage.*`. Une garde de route
 * distincte reflète cette restriction RÉELLE, plus étroite que le reste du module. L'ÉCRITURE est
 * encore plus restreinte (`direction`/`chef_atelier` seuls, `magasinier` en lecture seule) — gérée
 * dans l'écran (`peutModifierParametragePieces`, `ecrans/pieces/droits.ts`), pas ici.
 */
export const ROLES_PARAMETRAGE_PIECES: readonly RoleUtilisateur[] = [
  'direction',
  'chef_atelier',
  'magasinier',
];

/**
 * Gestion des employés (issue #137) — CAS DE FIGURE 1 (protection RÉELLE de route), même
 * raisonnement que `ROLES_PIECES`/`ROLES_VENTES` : `socle.utilisateur.lire` n'est accordé qu'à
 * `direction` et `admin` côté API (`DROITS_UTILISATEUR_PAR_ROLE`, `auth/matrice-droits.ts`) — tout
 * autre rôle reçoit `403 DROIT_INSUFFISANT` sur `GET /utilisateurs` lui-même, pas seulement sur
 * l'écriture. Poser `rolesAutorises: ROLES_GESTION_UTILISATEURS` sur la route reflète cette
 * restriction déjà réelle, elle ne l'invente pas.
 */
export const ROLES_GESTION_UTILISATEURS: readonly RoleUtilisateur[] = ['direction', 'admin'];

/**
 * Module ventes VN/VO (étape 4) — CAS DE FIGURE 1 CI-DESSUS (protection RÉELLE de route), même
 * raisonnement que `ROLES_PIECES` : `admin`, `technicien` et `magasinier` reçoivent `[]`
 * littéralement sur tout le domaine `ventes.*` côté API (RF-115, `DROITS_VENTES_PAR_ROLE`,
 * `apps/api/src/auth/matrice-droits.ts`) — la LECTURE elle-même (`ventes.vehicule_stock.lire`,
 * `ventes.dossier.lire`) leur est fermée. Poser `rolesAutorises: ROLES_VENTES` sur chaque route du
 * module reflète donc une restriction que l'API applique déjà.
 *
 * Les CINQ rôles ci-dessous sont la LECTURE — `ROLES_LECTURE_VEHICULE_STOCK`
 * (`ecrans/ventes/stock/droits.ts`) et `ROLES_LECTURE_DOSSIER_VENTE`
 * (`ecrans/ventes/dossiers/droits.ts`) coïncident exactement (même liste dans les deux
 * sous-domaines) : cette constante DUPLIQUE ces deux listes déjà dupliquées depuis l'API — même
 * chaîne de duplication assumée que `ROLES_PIECES` ci-dessus (frontière tenant/serveur jamais
 * franchie, et `routes/` ne dépend pas non plus d'`ecrans/*` — chaque périmètre porte sa propre
 * copie). L'ÉCRITURE reste plus restrictive dans chaque sous-domaine (voir les deux fichiers
 * `droits.ts` cités) : gérée dans les écrans, pas ici — cette constante ne garde que l'ATTEINTE de
 * la route, pas les actions à l'intérieur.
 */
export const ROLES_VENTES: readonly RoleUtilisateur[] = [
  'direction',
  'comptable',
  'vendeur',
  'receptionnaire',
  'chef_atelier',
];

/**
 * Hangar à pneus (Lot B) — CAS DE FIGURE 1 CI-DESSUS (protection RÉELLE de route), même
 * raisonnement que `ROLES_PIECES`/`ROLES_VENTES` : `pneus.depot.lire`
 * (`apps/api/src/auth/matrice-droits.ts`, `LECTURE_PNEUS`) ferme la LECTURE elle-même à
 * `poste_atelier` (la borne murale de l'atelier n'a aucune utilité au hangar à pneus) — poser
 * `rolesAutorises: ROLES_PNEUS` reflète donc une restriction RÉELLE. Les droits `pneus.depot.*`
 * sont DÉFINITIFS côté API — appliqués par `@ExigerDroit(...)` et `GardeDroit`, vérifié en
 * exécution. `apps/api/src/pneus/droits-provisoires.ts` N'EXISTE PLUS — ne pas y renvoyer dans un
 * futur commentaire.
 *
 * Liste DUPLIQUÉE depuis `ecrans/pneus/droits.ts` (`ROLES_PNEUS`, même chaîne de duplication
 * assumée que `ROLES_PIECES`/`ROLES_VENTES`/`ROLES_TABLEAU_BORD_ACTIVITE` ci-dessus — `routes/` ne
 * dépend pas d'`ecrans/*`).
 */
export const ROLES_PNEUS: readonly RoleUtilisateur[] = [
  'admin',
  'direction',
  'vendeur',
  'receptionnaire',
  'chef_atelier',
  'technicien',
  'magasinier',
  'comptable',
];

/**
 * Tableau de bord — CAS DE FIGURE 1 CI-DESSUS (protection RÉELLE de route) : `GET /tableau-bord/
 * activite` est ouvert à tout rôle de PERSONNE, mais explicitement fermé à `poste_atelier` (la
 * borne murale partagée) — la LECTURE elle-même exclut ce rôle, poser `rolesAutorises` sur la
 * route reflète donc une restriction RÉELLE. Les droits `tableau_bord.activite.*` sont DÉFINITIFS
 * côté API — appliqués par `@ExigerDroit(...)` et `GardeDroit`. `GET /tableau-bord/financier` est
 * ENCORE plus restreint (`direction`/`comptable` seuls, RF-115, `admin` exclu) mais N'A PAS de
 * route dédiée — une garde de route ne peut pas exprimer deux niveaux de droits différents sur la
 * même route. Le bloc financier est donc géré EN PLUS, à l'intérieur de l'écran : depuis le
 * passage à un dashboard PAR RÔLE (`EcranTableauBord.tsx`, choix produit du 10.08.2026), seuls
 * `TableauBordDirection`/`TableauBordComptable` le montent structurellement, vérifié par
 * `EcranTableauBord.spec.tsx` (test F8, non-fuite).
 *
 * Liste DUPLIQUÉE depuis `ecrans/tableau-bord/droits.ts` (même chaîne de duplication assumée que
 * `ROLES_PIECES`/`ROLES_VENTES` ci-dessus, `routes/` ne dépend pas d'`ecrans/*`).
 */
export const ROLES_TABLEAU_BORD_ACTIVITE: readonly RoleUtilisateur[] = [
  'technicien',
  'magasinier',
  'vendeur',
  'receptionnaire',
  'chef_atelier',
  'comptable',
  'direction',
  'admin',
];

/**
 * Relances automatiques (rappels de facture impayée, lot 1) — CAS DE FIGURE 1 CI-DESSUS
 * (protection RÉELLE de route), même raisonnement que `ROLES_PIECES`/`ROLES_VENTES`/`ROLES_PNEUS` :
 * `relances.facturation.regle.lire` n'est accordé qu'à `direction`/`comptable`
 * (`apps/api/src/relances/relances.controller.ts`) — la LECTURE elle-même de la configuration est
 * fermée à tous les autres rôles, pas seulement son écriture. Même LIRE la règle d'un rappel
 * expose une politique de recouvrement (paliers, canaux, préréglage appliqué) qu'un garage peut
 * légitimement vouloir garder à la gouvernance/comptabilité — un `chef_atelier` ou un `vendeur` ne
 * doit pas atteindre cet écran, contrairement à `parametrage/referentiels` plus haut où la lecture
 * est ouverte à tous. Poser `rolesAutorises: ROLES_RELANCES` reflète donc une restriction que
 * l'API applique déjà, ça ne l'invente pas.
 */
export const ROLES_RELANCES: readonly RoleUtilisateur[] = ['direction', 'comptable'];

/**
 * Module pointage (lot 2) — listes DUPLIQUÉES depuis `ecrans/pointage/droits.ts`
 * (`ROLES_LECTURE_POINTAGE` / `ROLES_GOUVERNANCE_POINTAGE`, elles-mêmes dupliquées depuis
 * `DROITS_POINTAGE_PAR_ROLE` côté API), même chaîne de duplication assumée que `ROLES_PIECES`/
 * `ROLES_VENTES`/`ROLES_PNEUS` ci-dessus : `routes/` ne dépend pas d'`ecrans/*`.
 *
 * Lot D (menu à six entrées) : `routeur.tsx` et `BarreLaterale.tsx` importaient auparavant ces
 * deux listes depuis `@/ecrans/pointage/droits` — une dépendance de `routes/` et de
 * `composants/layout/` vers un répertoire d'écran, seule de son espèce dans le fichier de routes.
 * Elles vivent désormais ici, à côté des huit autres listes de gouvernance de route, ce qui rend
 * `routes/` et `composants/layout/` autonomes.
 *
 * CAS DE FIGURE 1 (protection RÉELLE de route) : `atelier.pointage.lire` est fermé à
 * `comptable`/`receptionnaire`/`vendeur`/`poste_atelier` côté API — la LECTURE elle-même, pas
 * seulement l'écriture.
 */
export const ROLES_POINTAGE: readonly RoleUtilisateur[] = [
  'chef_atelier',
  'direction',
  'admin',
  'technicien',
  'magasinier',
];

/** `corriger_autrui`, `verrouiller_periode`, `deverrouiller_periode` — encadrement SEUL
 *  (vue équipe et clôture de période). Sous-ensemble strict de `ROLES_POINTAGE` ci-dessus. */
export const ROLES_POINTAGE_ENCADREMENT: readonly RoleUtilisateur[] = [
  'chef_atelier',
  'direction',
  'admin',
];

/**
 * Borne d'atelier (`/pointage/borne`) — TROIS rôles, pour DEUX usages qui ne se confondent pas :
 *
 *  - `poste_atelier` : l'USAGE réel. C'est le compte de service de la tablette murale, seul
 *    détenteur de `atelier.pointage.identifier` (`DROITS_POINTAGE_PAR_ROLE`, côté API) — donc le
 *    seul pour qui l'identification par PIN aboutit.
 *  - `chef_atelier` / `admin` : la CONFIGURATION. Ce sont eux qui installent la tablette au mur,
 *    et ils doivent pouvoir ouvrir l'écran depuis le menu pour vérifier l'URL à mettre en favori
 *    et le rendu sur l'appareil. Jusqu'au Lot D, `/pointage/borne` n'était atteignable qu'en
 *    tapant l'URL à la main pour eux (`rolesAutorises={['poste_atelier']}` seul), ce qui rendait
 *    la mise en service de la borne indocumentable au téléphone.
 *
 * LIMITE ASSUMÉE, à connaître avant de s'en étonner : un `chef_atelier`/`admin` qui SAISIT un PIN
 * sur cet écran reçoit un `403 DROIT_INSUFFISANT` de `POST /pointage/identifier` — il n'a pas
 * `atelier.pointage.identifier`, et c'est correct (seule la borne identifie des techniciens).
 * L'écran affiche alors son message d'erreur générique. L'accès accordé ici est un accès de mise
 * en service, pas un accès d'usage — `EcranBornePointage` gagnerait à porter un état dédié pour ce
 * cas (hors du périmètre d'écriture du Lot D, signalé à la session).
 */
export const ROLES_BORNE_POINTAGE: readonly RoleUtilisateur[] = [
  'poste_atelier',
  'chef_atelier',
  'admin',
];

/**
 * Entrée « Facturation » du menu — CAS DE FIGURE 2 (ERGONOMIE, PAS SÉCURITÉ), à ne surtout pas
 * transformer en `rolesAutorises` sur la route `/factures` : `facturation.document.lire` EST
 * accordé à `admin` côté API (`DROITS_DOCUMENT_VENTE_PAR_ROLE.admin = [...LECTURE_DOCUMENT]`,
 * `apps/api/src/auth/matrice-droits.ts`). Une garde de route inventerait donc une restriction que
 * le serveur n'applique pas — exactement ce que l'en-tête de ce fichier interdit.
 *
 * DÉCISION DU LOT D (RF-115) : `admin` est retiré de l'ENTRÉE DE MENU. Motif — `admin` est un rôle
 * technique sans aucun droit financier : `EcranListeFactures` retire structurellement les colonnes
 * « montant », « statut » et « retard » pour lui (le serveur ne renvoie même pas les champs), et
 * l'écran d'encaissement comme le bloc créancier lui sont fermés. Lui proposer une entrée qui
 * ouvre une liste sans un seul montant est PIRE que de ne pas la lui proposer : elle annonce
 * l'existence d'un contenu qu'il ne verra jamais. Jusqu'ici le `NavLink /factures` ne portait
 * AUCUNE garde de rôle — seule entrée du menu dans ce cas, incohérence corrigée ici.
 *
 * `poste_atelier` est exclu pour une raison différente et plus dure : `[]` littéralement sur tout
 * le domaine `facturation.*` côté API (compte de service, aucun droit financier par construction).
 *
 * Les SEPT autres rôles portent tous `facturation.document.lire`, `technicien` compris (il consulte
 * la facture rattachée à l'OR qu'il vient de terminer) — la liste ci-dessous est dérivée de la
 * matrice, pas choisie séparément.
 */
export const ROLES_MENU_FACTURATION: readonly RoleUtilisateur[] = [
  'direction',
  'comptable',
  'vendeur',
  'receptionnaire',
  'chef_atelier',
  'magasinier',
  'technicien',
];

/**
 * Agenda de rendez-vous (Lot RDV-1) — CAS DE FIGURE 1 CI-DESSUS (protection RÉELLE de route) :
 * `rendez_vous.lire` (`apps/api/src/auth/matrice-droits.ts`, `DROITS_RENDEZ_VOUS_PAR_ROLE`) ferme
 * la LECTURE elle-même à `vendeur`/`magasinier`/`comptable`/`poste_atelier` — poser
 * `rolesAutorises={ROLES_LECTURE_RENDEZ_VOUS}` reflète donc une restriction réelle, elle ne
 * l'invente pas. Même liste que `ecrans/rendez-vous/droits.ts` (duplication assumée, même chaîne
 * que `ROLES_PIECES`/`ROLES_VENTES` ci-dessus). CRÉATION (`rendez_vous.creer`, réceptionniste/
 * direction/admin seuls) et CYCLE DE VIE (modifier/arrivée/absence/annulation, sans `technicien`)
 * sont plus étroits que la simple lecture — gérés DANS l'écran, jamais par une garde de route.
 */
export const ROLES_LECTURE_RENDEZ_VOUS: readonly RoleUtilisateur[] = [
  'receptionnaire',
  'chef_atelier',
  'direction',
  'admin',
  'technicien',
];

/**
 * Scanner de permis de circulation (mobile) — CAS DE FIGURE 1 CI-DESSUS (protection RÉELLE de
 * route) : le scan ne fait qu'ouvrir un formulaire prérempli de création client/véhicule, il ne
 * réussit donc que pour un rôle qui détient LES DEUX `client.creer` ET `vehicule.creer` côté API
 * (`L958_CLIENT_ECRITURE`/`L960_VEHICULE_ECRITURE`, `apps/api/src/auth/matrice-droits.ts`) — sans
 * quoi la soumission finale échoue systématiquement en `403`, un cul-de-sac après une photo prise
 * et une saisie corrigée. MÊME LISTE, littéralement, que `ROLES_ECRITURE_VEHICULE`
 * (`ecrans/vehicules/droits.ts`) : les deux droits sont accordés exactement aux mêmes cinq rôles
 * dans la matrice API (`receptionnaire`/`chef_atelier`/`magasinier` explicitement, `direction`/
 * `admin` par héritage de `chef_atelier`) — `technicien`, `comptable`, `vendeur` et `poste_atelier`
 * n'ont NI l'un NI l'autre, jamais un seul des deux isolément dans ce dépôt.
 *
 * Consommée aussi par `composants/layout/useModeScanMobile.ts` (restriction mobile au scan seul,
 * `composants/layout/` ne dépend pas d'`ecrans/*`, même doctrine que `ROLES_POINTAGE` ci-dessus) et
 * par `navigation-modele.ts` pour l'onglet « Scanner » de l'entrée Clients & véhicules.
 */
export const ROLES_SCAN: readonly RoleUtilisateur[] = [
  'admin',
  'direction',
  'receptionnaire',
  'chef_atelier',
  'magasinier',
];
