/**
 * Enums de l'étape 4 — Ventes de véhicules neufs et d'occasion (VN/VO), reprise, financement,
 * frais annexes, livraison.
 *
 * Référence : `docs/specification-etape-4-ventes.md` (`RV-xx`, `CV-xx`, `QV-xx`). Chaque
 * constante cite sa règle d'origine.
 *
 * Domaine SÉPARÉ de `contrats/atelier` et `contrats/facturation` — ce module se RACCORDE à
 * `vehicule` (statut commercial en extension, jamais en remplacement de `statut_vehicule`, `RV-09`)
 * et à `document_vente` (via `dossierVenteId`, déjà posé côté facturation) sans redéfinir leurs
 * enums propres.
 */

/* ------------------------------------------------------------------ */
/* Véhicule en stock (RV-01 → RV-14)                                   */
/* ------------------------------------------------------------------ */

/**
 * `provenance_vehicule_stock` — **extensible** (`RV-02` : « cette liste est extensible » — texte
 * source, pas une inférence). Détermine le traitement fiscal (`RV-60`) et la fiche de coût du
 * véhicule.
 */
export const PROVENANCES_VEHICULE_STOCK = [
  'neuf_constructeur',
  'reprise',
  'achat_particulier',
  'achat_professionnel',
  'retour_leasing',
  'demonstrateur',
] as const;
export type ProvenanceVehiculeStock = (typeof PROVENANCES_VEHICULE_STOCK)[number];

/**
 * Type PG **`statut_vehicule_stock`** (CORRIGÉ — la table qui porte ce statut est
 * `vehicule_stock`, et le dispositif générique de machine à états exige `statut_<table>` ;
 * `statut_commercial_vehicule`, écrit ici dans une version antérieure, ne correspond à aucune
 * table réelle et cassait `apps/api/src/db/schema/ventes/enums.ts`, signalé par l'agent schéma
 * binôme lors de l'écriture de `migrations/0032_ventes.sql`) — **GELÉ** (même patron que
 * `statut_ordre_reparation`, `RV-09`) : machine à états à cinq positions, diagramme §6.1 de la
 * spécification. **Les transitions vivent dans une table côté serveur, pas dans ce type** — un
 * client lit `actionsDisponibles` sur `ReponseVehiculeStock`, il ne déduit rien de cet enum seul.
 *
 * Distinct de `statut_vehicule` (`actif`/`archive`, étape 1) : ce statut est propre à la vente,
 * il ne le remplace pas (`RV-09`, dernière phrase).
 */
export const STATUTS_COMMERCIAUX_VEHICULE = [
  'en_commande',
  'disponible',
  'reserve',
  'vendu',
  'livre',
] as const;
export type StatutCommercialVehicule = (typeof STATUTS_COMMERCIAUX_VEHICULE)[number];

/** Action possible MAINTENANT sur `ReponseVehiculeStock.actionsDisponibles` — même principe que
 *  `ActionOrdreReparation` : approximation utile au client, jamais la seule garde. */
export const ACTIONS_VEHICULE_STOCK = [
  'mettre_a_jour',
  'receptionner',
  'remettre_disponible',
] as const;
export type ActionVehiculeStock = (typeof ACTIONS_VEHICULE_STOCK)[number];

/**
 * `type_vehicule_vente` (VN/VO) — champ **DÉRIVÉ**, jamais saisi (§8.2 de la spécification :
 * « dérivé de la provenance et du statut du véhicule associé plutôt qu'une donnée saisie
 * séparément »). Inférence documentée ici faute d'arbitrage `expert-database` encore rendu :
 * `vn` tant que `provenance = 'neuf_constructeur'` ET que le véhicule n'a jamais été immatriculé
 * (`vehicule.date1reCirculation` nulle) ; `vo` dans tous les autres cas, y compris un VN annulé
 * requalifié après réception (`RV-18`, `CV-06` — kilométrage zéro mais provenance déjà
 * `neuf_constructeur`, donc ce n'est PAS une simple relecture de `provenance`).
 */
export const TYPES_VEHICULE_VENTE = ['vn', 'vo'] as const;
export type TypeVehiculeVente = (typeof TYPES_VEHICULE_VENTE)[number];

/* ------------------------------------------------------------------ */
/* Dossier de vente (RV-29 → RV-38)                                    */
/* ------------------------------------------------------------------ */

/**
 * `statut_dossier_vente` — **GELÉ**, diagramme §6.2. Transitions en table côté serveur, même
 * patron que `StatutOrdreReparation` — un client lit `actionsDisponibles`, jamais cet enum seul.
 */
export const STATUTS_DOSSIER_VENTE = [
  'prospection',
  'engage',
  'en_preparation',
  'pret_a_livrer',
  'livre',
  'clos',
  'annule',
  'abandonne',
] as const;
export type StatutDossierVente = (typeof STATUTS_DOSSIER_VENTE)[number];

export const ACTIONS_DOSSIER_VENTE = [
  'modifier',
  'engager',
  'preparer',
  'marquer_pret_a_livrer',
  'livrer',
  'cloturer',
  'annuler',
  'abandonner',
] as const;
export type ActionDossierVente = (typeof ACTIONS_DOSSIER_VENTE)[number];

/* ------------------------------------------------------------------ */
/* Reprise (RV-19 → RV-28)                                             */
/* ------------------------------------------------------------------ */

/** `statut_reprise` — **GELÉ**, diagramme §6.3. `confirmee` se produit à la signature du bon de
 *  commande (`RV-19`, `RV-27`) ; `refusee` n'interrompt pas le reste du dossier (`RV-25`). */
export const STATUTS_REPRISE = ['estimee', 'negociee', 'confirmee', 'refusee'] as const;
export type StatutReprise = (typeof STATUTS_REPRISE)[number];

export const ACTIONS_REPRISE = ['modifier', 'negocier', 'confirmer', 'refuser'] as const;
export type ActionReprise = (typeof ACTIONS_REPRISE)[number];

/* ------------------------------------------------------------------ */
/* Financement / leasing (RV-39 → RV-45)                               */
/* ------------------------------------------------------------------ */

/**
 * `type_financement_vente` — **extensible**. `leasing` : vente du garage à l'organisme, pas au
 * client (`RV-39`). `credit` : crédit bancaire classique, la vente reste au client (`RV-44`).
 * `comptant` : aucune confirmation tierce requise (`RV-44`).
 */
export const TYPES_FINANCEMENT_VENTE = ['comptant', 'credit', 'leasing'] as const;
export type TypeFinancementVente = (typeof TYPES_FINANCEMENT_VENTE)[number];

/**
 * Type PG **`statut_financement_vente`** (CORRIGÉ — la table est `financement_vente`, même
 * raison qu'au-dessus pour `STATUTS_COMMERCIAUX_VEHICULE` ; `statut_confirmation_financement` ne
 * correspond à aucune table réelle) — **GELÉ** (`CV-03`). `comptant` est créé directement
 * `confirme` (aucune confirmation tierce n'a de sens, `RV-44`) ; `credit`/`leasing` démarrent
 * `en_attente`.
 */
export const STATUTS_CONFIRMATION_FINANCEMENT = ['en_attente', 'confirme', 'refuse'] as const;
export type StatutConfirmationFinancement = (typeof STATUTS_CONFIRMATION_FINANCEMENT)[number];

export const ACTIONS_FINANCEMENT = ['confirmer', 'refuser'] as const;
export type ActionFinancement = (typeof ACTIONS_FINANCEMENT)[number];
