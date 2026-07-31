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
export const ROLES_MENU_PARAMETRAGE_ATELIER: readonly RoleUtilisateur[] = ['chef_atelier', 'direction', 'admin'];

/** RF-115 : `admin` volontairement absent — voir le point 2 ci-dessus. */
export const ROLES_MENU_FINANCIER: readonly RoleUtilisateur[] = ['direction', 'comptable'];
