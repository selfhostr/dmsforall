import type { RoleUtilisateur } from '@dfa/shared';

/**
 * Miroir front de `atelier.ligne.photo.ajouter` (`apps/api/src/auth/matrice-droits.ts`) : mêmes
 * titulaires que `atelier.ligne.creer`. La borne (`poste_atelier`, compte de service sans identité
 * de personne) et vendeur/comptable n'ajoutent pas de photo. Ergonomie seulement : le serveur
 * reste l'arbitre.
 */
const ROLES_AJOUT_PHOTO: ReadonlySet<RoleUtilisateur> = new Set([
  'admin',
  'direction',
  'receptionnaire',
  'chef_atelier',
  'technicien',
  'magasinier',
]);

export function peutAjouterPhoto(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_AJOUT_PHOTO.has(role);
}
