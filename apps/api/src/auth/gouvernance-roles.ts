/**
 * Gouvernance de l'attribution des rôles — issue #137, choix produit (13.08.2026).
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
import {
  PREREGLAGES,
  depassementsDeGrille,
  type GrilleCapacites,
  type IdPrereglage,
  type RolePersonne,
  type RoleUtilisateur,
} from '@dfa/shared';

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

// =================================================================================================
// Gouvernance de la grille de capacités (phase 1 des rôles = préréglages)
// =================================================================================================
//
// Généralise la règle ci-dessus à la grille : « on ne coche pas une case qu'on n'a pas soi-même ».
// Toutes ces gardes vivent côté serveur (`ServiceUtilisateur`), en plus du droit
// `socle.utilisateur.*` (« Employés & réglages ») que la garde de route a déjà vérifié.

/** Acteur d'un geste de gestion de compte : son rôle, et sa grille réelle quand elle est connue. */
export type ActeurGouvernance =
  RoleUtilisateur | { readonly role: RoleUtilisateur; readonly capacites?: GrilleCapacites };

export function normaliserActeur(acteur: ActeurGouvernance): {
  readonly role: RoleUtilisateur;
  readonly grille: GrilleCapacites;
} {
  const role = typeof acteur === 'string' ? acteur : acteur.role;
  const grille =
    typeof acteur === 'string' || acteur.capacites === undefined
      ? PREREGLAGES[role as RolePersonne]?.grille
      : acteur.capacites;
  if (grille === undefined) {
    // Compte de service ou rôle inconnu : ne gère aucun employé. Fail-closed.
    throw refusDroits('Cet acteur ne peut pas gérer les droits des employés.', []);
  }
  return { role, grille };
}

function refusDroits(message: string, champs: readonly string[]): ErreurMetier {
  return new ErreurMetier('DROIT_INSUFFISANT', message, {
    erreurs: champs.map((champ) => ({
      champ,
      code: 'depasse_vos_droits',
      message: `Vous ne pouvez pas accorder « ${champ} » : vous ne l'avez pas vous-même.`,
    })),
  });
}

/** Personne ne modifie ses propres droits ni son propre rôle (pas d'auto-élévation). */
export function verifierPasAutoModification(acteurId: string | null, cibleId: string): void {
  if (acteurId !== null && acteurId === cibleId) {
    throw refusDroits('Vous ne pouvez pas modifier vos propres droits.', []);
  }
}

/**
 * La grille `cible` doit tenir dans celle de l'acteur. Exception unique : le compte technique
 * `admin` (l'intégrateur) provisionne n'importe quel PRÉRÉGLAGE métier — c'est son rôle de créer le
 * premier patron d'un garage, bien qu'il n'ait lui-même aucun droit financier (RF-115).
 */
export function verifierGrilleAttribuable(
  acteur: ActeurGouvernance,
  cible: GrilleCapacites,
  opts: { readonly prereglage: boolean },
): void {
  const { role, grille } = normaliserActeur(acteur);
  if (opts.prereglage && role === ROLE_RESERVE_A_LUI_MEME) return;
  const depassements = depassementsDeGrille(grille, cible);
  if (depassements.length > 0) {
    throw refusDroits(
      'Cette grille dépasse vos propres droits : on ne peut accorder que ce que l’on a soi-même.',
      depassements,
    );
  }
}

/**
 * Une personne ne peut pas être modifiée par un acteur moins puissant qu'elle (un patron réduit ne
 * touche pas à un patron complet), ni un compte `admin` par un non-admin.
 */
export function verifierCibleModifiable(
  acteur: ActeurGouvernance,
  cibleRole: RoleUtilisateur,
  cibleGrille: GrilleCapacites,
): void {
  const { role, grille } = normaliserActeur(acteur);
  if (cibleRole === ROLE_RESERVE_A_LUI_MEME && role !== ROLE_RESERVE_A_LUI_MEME) {
    throw refusDroits("Seul un compte admin peut modifier les droits d'un compte admin.", ['role']);
  }
  if (role === ROLE_RESERVE_A_LUI_MEME) return;
  const depassements = depassementsDeGrille(grille, cibleGrille);
  if (depassements.length > 0) {
    throw refusDroits(
      'Cette personne a des droits que vous n’avez pas : vous ne pouvez pas les modifier.',
      depassements,
    );
  }
}

/** Valide la cohérence `role` / `prereglage` d'une entrée et rend le préréglage à appliquer. */
export function resoudrePrereglage(
  role: RolePersonne | undefined,
  prereglage: IdPrereglage | undefined,
): { readonly role: RolePersonne; readonly id: IdPrereglage } | null {
  if (role === undefined && prereglage === undefined) return null;
  const id: IdPrereglage = prereglage ?? (role as RolePersonne);
  const origine = PREREGLAGES[id].roleOrigine;
  if (role !== undefined && role !== origine) {
    throw new ErreurMetier('VALIDATION_ECHOUEE', 'Préréglage incompatible avec le rôle demandé.', {
      erreurs: [
        {
          champ: 'prereglage',
          code: 'prereglage_incompatible',
          message: `Le préréglage « ${id} » s'applique au rôle « ${origine} », pas « ${role} ».`,
        },
      ],
    });
  }
  return { role: origine, id };
}
