import type { RoleUtilisateur } from '@dfa/shared';

/**
 * Gouvernance du sous-domaine « suivi financement/garantie » — même droit que la lecture des
 * dossiers de vente (`ventes.dossier.lire`, voir l'en-tête de `SuiviVenteController` : « cette vue
 * ne fait qu'agréger et filtrer des données déjà accessibles par ce droit »). Liste DUPLIQUÉE
 * depuis `apps/api/src/auth/matrice-droits.ts` (même doctrine que `ecrans/ventes/dossiers/droits.ts`,
 * jamais importée depuis `apps/api` — frontière tenant/serveur jamais franchie). Défensif
 * d'ERGONOMIE seulement : le serveur reste l'arbitre final (`403 DROIT_INSUFFISANT`).
 *
 * Le masquage des montants de financement (RF-116) n'est PAS géré ici : il n'est jamais dérivé du
 * rôle côté client, seulement de la PRÉSENCE des clés `dureeMois`/`echeanceLe` dans la réponse
 * serveur (le serveur est l'unique source de vérité sur qui voit quoi) — voir
 * `ecrans/ventes/suivi/financement.ts`.
 */
const ROLES_LECTURE_SUIVI_VENTE: ReadonlySet<RoleUtilisateur> = new Set([
  'direction',
  'comptable',
  'vendeur',
  'receptionnaire',
  'chef_atelier',
]);

export function peutLireSuiviVente(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_LECTURE_SUIVI_VENTE.has(role);
}
