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

/**
 * Correction totale d'une facture émise (`POST /documents-vente/{id}/corriger`, geste unique
 * `RF-12` → `RF-14` : un avoir total + une facture de remplacement en une transaction) — QUATRIÈME
 * geste financier de `EcranFicheFacture`, DÉFAUT CORRIGÉ (relevé au test manuel du 14.08.2026) :
 * `proposeCorriger` ne dépendait avant ce correctif QUE de l'état du document
 * (`peutGererFacture`), JAMAIS du rôle — un chef d'atelier ou le compte technique `admin`
 * voyaient donc « Corriger cette facture » au menu ⋯ ET le lien « Corriger par un avoir → » sous
 * les lignes, le dialogue s'ouvrait, son bouton de validation était actif. Même doctrine que les
 * trois fonctions ci-dessus : un rôle sans droit ne voit pas de bouton.
 *
 * **MESURÉ CÔTÉ SERVEUR avant ce correctif (pas supposé)** : `POST /documents-vente/{id}/corriger`
 * N'EXISTE PAS dans `apps/api/src/facturation/documents/` — aucun `@Post(':id/corriger')`, aucune
 * méthode `corriger`/`corrigerFacture` dans `DocumentVenteController`/
 * `DocumentVenteTransitionsController`, aucun service, zéro test (recherche exhaustive du
 * répertoire, confirmée par grep ET par `codegraph_explore`). Le contrat (`schemaCorrectionFacture`,
 * `packages/shared/src/contrats/facturation/document.ts`) et le hook front
 * (`hooks/facturation/useCorrigerFacture.ts`) sont posés, mais AUCUNE route ne les sert : toute
 * requête, de N'IMPORTE QUEL rôle (y compris `direction`/`comptable`), reçoit aujourd'hui un `404`
 * générique de Nest (route non montée), PAS un `403 DROIT_INSUFFISANT` — ce n'est donc pas un refus
 * par rôle, c'est une fonctionnalité absente. Voir `document-vente-corriger-absent.spec.ts`
 * (verrouille cette absence) et le rapport de livraison de ce lot pour le détail.
 *
 * Ce défensif front reste posé MAINTENANT, par anticipation (même doctrine que
 * `atelier.pointage.identifier`/`gerer_pin` côté serveur, posés avant leur route) : le jour où
 * l'endpoint existera, ce fichier n'aura rien à changer, et l'écran n'aura jamais laissé un rôle
 * non autorisé ouvrir le dialogue entre-temps.
 *
 * Rôles EXACTEMENT `direction` + `comptable` — PAS `réceptionnaire` (contrairement à
 * `ROLES_EMISSION_AVOIR` ci-dessus, dont ce geste n'est PAS un simple alias : corriger annule ET
 * recrée une facture en un seul geste, structurellement plus engageant qu'émettre un avoir
 * ordinaire). Action de droit à créer côté `apps/api/src/auth/matrice-droits.ts` le jour où la
 * route existe : `facturation.document.corriger`, accordée à `direction`/`comptable` SEULS —
 * aucune action existante n'a cette sémantique ET ce périmètre exact (`facturation.document.
 * emettre_avoir`/`facturation.avoir.creer` incluent à tort `receptionnaire` pour ce geste-ci).
 */
const ROLES_CORRECTION_FACTURE: ReadonlySet<RoleUtilisateur> = new Set(['direction', 'comptable']);

export function peutCorrigerFacture(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_CORRECTION_FACTURE.has(role);
}

/**
 * `facturation.document.creer` (`ECRITURE_BROUILLON`, RF-114) : direction, comptable, vendeur,
 * réceptionnaire, chef d'atelier, magasinier — PAS technicien, PAS admin, PAS poste_atelier.
 * Défensif d'ergonomie (entrée « Nouveau devis ») : le serveur reste l'arbitre.
 */
const ROLES_CREATION_DEVIS: ReadonlySet<RoleUtilisateur> = new Set([
  'direction',
  'comptable',
  'vendeur',
  'receptionnaire',
  'chef_atelier',
  'magasinier',
]);

export function peutCreerDevis(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_CREATION_DEVIS.has(role);
}

/**
 * Accord du client sur un devis (`POST .../accepter`, droit `facturation.document.transitionner`,
 * `ECRITURE_BROUILLON` côté serveur) : mêmes rôles que la création d'un devis. Défensif
 * d'ergonomie, le serveur reste l'arbitre.
 */
export function peutAccepterDevis(role: RoleUtilisateur | undefined): boolean {
  return peutCreerDevis(role);
}

/**
 * Envoyer (émettre) un devis : `facturation.document.emettre_devis_bc` (`EMISSION_DEVIS_BC`) —
 * direction, comptable, vendeur, réceptionnaire, chef d'atelier. Distinct de l'émission d'une
 * facture, qui exclut le chef d'atelier.
 */
const ROLES_EMISSION_DEVIS: ReadonlySet<RoleUtilisateur> = new Set([
  'direction',
  'comptable',
  'vendeur',
  'receptionnaire',
  'chef_atelier',
]);

export function peutEmettreDevis(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_EMISSION_DEVIS.has(role);
}
