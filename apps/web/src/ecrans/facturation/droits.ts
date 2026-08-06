import type { RoleUtilisateur } from '@dfa/shared';

/**
 * Gouvernance de la visibilité des montants en facturation — miroir CÔTÉ FRONT de
 * `ROLES_SANS_MONTANT_FACTURATION` (`apps/api/src/facturation/documents/mappeurs.ts`, RF-115/
 * RF-116) : `ROLES_SANS_MONTANT` partagé (`technicien`, `poste_atelier`,
 * `apps/api/src/auth/matrice-droits.ts`) PLUS `admin` — exclusion DÉLIBÉRÉE et PROPRE À LA
 * FACTURATION (séparation des pouvoirs : qui peut créer des comptes ne doit pas voir les
 * montants), à la différence de la doctrine générale de l'étape 1 où `admin` est un superset de
 * `direction`. PAS un oubli, jamais à combler par copier-coller d'un autre rôle — même tension déjà
 * tranchée ainsi par le module paiements (voir le commentaire de `mappeurs.ts`).
 *
 * Même doctrine que `ecrans/tableau-bord/droits.ts`/`ecrans/pieces/droits.ts` : un défensif
 * d'ERGONOMIE, pas la seule ligne de défense. Le serveur masque déjà `dateEcheance`/`enRetard`/
 * `joursRetard`/`totalTtcCentimes`/etc. (champs `?:` absents, jamais `null`/`0`) — un rôle sans
 * droit qui lirait quand même la réponse verrait ces champs `undefined`, quoi qu'il arrive. Cette
 * garde sert uniquement à ne pas construire une colonne "Retard" structurellement vide (en-tête
 * compris) à l'écran, pas à protéger une donnée qui ne l'est déjà pas.
 */
const ROLES_SANS_MONTANT_FACTURATION: ReadonlySet<RoleUtilisateur> = new Set([
  'technicien',
  'poste_atelier',
  'admin',
]);

export function peutVoirMontantsFacturation(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && !ROLES_SANS_MONTANT_FACTURATION.has(role);
}

/**
 * Gouvernance des TROIS gestes financiers de `EcranFicheFacture` (émettre, encaisser, créer un
 * avoir) — DUPLIQUÉE ici depuis `apps/api/src/auth/matrice-droits.ts` (bloc facturation —
 * documents, ~ligne 950), JAMAIS importée depuis `apps/api` (même frontière tenant/serveur que
 * `peutVoirMontantsFacturation` ci-dessus et `ecrans/ventes/stock/droits.ts`). Un défensif
 * d'ERGONOMIE, pas la seule ligne de défense : le serveur reste l'arbitre final
 * (`ServiceEmissionDocument.emettre()` re-vérifie le droit avant tout effet de bord). Doctrine du
 * dépôt, non négociable : un rôle sans droit ne voit pas un bouton grisé, il ne voit pas de
 * bouton — ces trois fonctions gouvernent donc la VISIBILITÉ, pas seulement l'activation.
 *
 * Trois ensembles DISTINCTS, PAS de superset chef_atelier ⊇ receptionnaire (la matrice financière
 * ne suit délibérément pas la hiérarchie atelier — voir le commentaire de tête de
 * `DROITS_DOCUMENT_PAR_ROLE`/`DROITS_PAIEMENT_PAR_ROLE` côté serveur) :
 *
 * - Émettre une facture (`EMISSION_FACTURE`, `facturation.document.emettre_facture`) : direction,
 *   comptable, vendeur, réceptionnaire — PAS chef_atelier, PAS magasinier, PAS technicien, PAS
 *   admin (RF-115).
 * - Encaisser (`ENCAISSEMENT_PAIEMENT`, `facturation.paiement.creer`/`.imputer`) : direction,
 *   comptable, vendeur, réceptionnaire, magasinier — PAS chef_atelier (❌ littéral côté serveur),
 *   PAS technicien, PAS admin (RF-115).
 * - Créer un avoir (`EMISSION_AVOIR`, `facturation.document.emettre_avoir` — le menu ⋯ navigue
 *   vers `EcranAvoir`, qui crée PUIS émet le brouillon en un seul geste utilisateur, donc le droit
 *   qui gouverne l'accès au menu est celui de l'ÉMISSION, plus restrictif que `facturation.
 *   avoir.creer` seul) : direction, comptable, réceptionnaire — PAS vendeur, PAS chef_atelier, PAS
 *   magasinier, PAS technicien, PAS admin.
 */
const ROLES_EMISSION_FACTURE: ReadonlySet<RoleUtilisateur> = new Set([
  'direction',
  'comptable',
  'vendeur',
  'receptionnaire',
]);

const ROLES_ENCAISSEMENT: ReadonlySet<RoleUtilisateur> = new Set([
  'direction',
  'comptable',
  'vendeur',
  'receptionnaire',
  'magasinier',
]);

const ROLES_EMISSION_AVOIR: ReadonlySet<RoleUtilisateur> = new Set([
  'direction',
  'comptable',
  'receptionnaire',
]);

export function peutEmettreFacture(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_EMISSION_FACTURE.has(role);
}

export function peutEncaisser(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_ENCAISSEMENT.has(role);
}

export function peutEmettreAvoir(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_EMISSION_AVOIR.has(role);
}
