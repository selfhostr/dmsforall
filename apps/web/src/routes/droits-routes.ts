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
