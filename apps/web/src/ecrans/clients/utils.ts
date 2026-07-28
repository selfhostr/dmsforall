import type { RoleContact } from '@dfa/shared';

/**
 * `role_contact` (`@dfa/shared`) est en snake_case ; `clients:contacts.roles.*` (i18n) est en
 * camelCase — même motif que `BadgeStatutOr` (`or_cle` -> `clé i18n`) : mapping exhaustif et
 * type-safe, ajouter une valeur à `ROLES_CONTACT` fait échouer `tsc` avant d'atteindre l'écran.
 */
const CLES_ROLE_CONTACT: Readonly<Record<RoleContact, string>> = {
  conducteur: 'conducteur',
  gestionnaire_flotte: 'gestionnaireFl',
  signataire: 'signataire',
  comptabilite: 'comptabilite',
};

export function cleRoleContact(role: RoleContact): string {
  return CLES_ROLE_CONTACT[role];
}

/**
 * Affichage neutre d'une valeur absente — jamais `undefined`/`null` bruts, jamais un tiret qui
 * ressemble à une erreur de rendu (un client sans adresse/véhicule est un cas NORMAL au comptoir,
 * pas une anomalie, arbitrage main L1-16). Le tiret cadratin `—` est déjà la convention du
 * produit pour « non renseigné » (voir `Plaque`, `@/composants/identite`).
 */
export function texteOuVide(valeur: string | number | null | undefined): string {
  return valeur === null || valeur === undefined || valeur === '' ? '—' : String(valeur);
}
