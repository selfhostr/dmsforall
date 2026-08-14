/**
 * Gouvernance de l'attribution des rôles — issue #137, arbitrage @laupernoe (13.08.2026).
 *
 * Distincte de `matrice-droits.ts` (qui gouverne les ACTIONS qu'un rôle peut exercer) : ce
 * fichier gouverne un cas particulier, la capacité d'un rôle à ATTRIBUER un autre rôle à
 * quelqu'un — la garde qui empêche un utilisateur de s'octroyer, ou d'octroyer à un tiers, plus
 * de pouvoir qu'il n'en détient lui-même.
 *
 * UNE SEULE RÈGLE existe à ce jour (@laupernoe, explicitement, pour ne pas construire un classement
 * complet et non demandé des neuf rôles) : `admin` est le compte technique de l'intégrateur —
 * personne d'autre que lui-même ne peut créer ou promouvoir un compte `admin`. `direction` (le
 * patron du garage) peut créer et gérer tous les rôles MÉTIER, jamais `admin` — un patron de
 * garage ne distribue jamais un accès d'intégrateur.
 *
 * Cette garde vit CÔTÉ SERVEUR, dans le service (`ServiceUtilisateur`), jamais seulement dans
 * l'écran : un contrôle d'écran se contourne par un appel direct à l'API.
 */
import type { RoleUtilisateur } from '@dfa/shared';

import { ErreurMetier } from '../common/erreurs';

/** Seul rôle qu'un acteur ne peut jamais attribuer à autrui sans le détenir lui-même. */
export const ROLE_RESERVE_A_LUI_MEME: RoleUtilisateur = 'admin';

/**
 * Lève `403 DROIT_INSUFFISANT` si `acteurRole` tente d'attribuer `roleCible` sans le droit de le
 * faire — c'est-à-dire si `roleCible` est `admin` et que `acteurRole` ne l'est pas. N'importe
 * quel autre rôle métier reste librement attribuable par `direction` comme par `admin` (les deux
 * seuls rôles à détenir `socle.utilisateur.creer`/`.modifier`, voir `matrice-droits.ts`) : c'est
 * la matrice, pas cette fonction, qui a déjà vérifié que l'acteur a le droit de créer/modifier
 * QUELQU'UN — cette fonction vérifie seulement QUEL rôle il a le droit de lui donner.
 */
export function verifierAttributionRoleAutorisee(
  acteurRole: RoleUtilisateur,
  roleCible: RoleUtilisateur,
): void {
  if (roleCible === ROLE_RESERVE_A_LUI_MEME && acteurRole !== ROLE_RESERVE_A_LUI_MEME) {
    throw new ErreurMetier(
      'DROIT_INSUFFISANT',
      'Seul un compte admin peut créer ou promouvoir un autre compte admin — un patron de garage ' +
        "(direction) gère tous les rôles métier de ses employés, jamais l'accès d'intégrateur.",
      {
        erreurs: [
          {
            champ: 'role',
            code: 'role_reserve_admin',
            message: "Le rôle 'admin' ne peut être attribué que par un compte admin.",
          },
        ],
      },
    );
  }
}
