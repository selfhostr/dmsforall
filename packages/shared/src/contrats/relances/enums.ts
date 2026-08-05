/**
 * Enums métier des relances automatiques (`docs/specification-relances-automatiques.md`).
 * Lot 1 (facturation, rappel #2) — les neuf types du catalogue (§2) et les six types d'objet
 * (§5) sont posés dès ce lot pour que les lots 2→4 n'aient qu'à ajouter leur logique métier,
 * jamais une migration d'enum supplémentaire.
 *
 * Même doctrine que `contrats/pneus/enums.ts` : valeurs en **snake_case**, miroir exact des
 * types PostgreSQL créés par `apps/api/src/db/migrations/0045_relances_socle.sql`.
 */

/**
 * `type_relance` — les 9 rappels retenus par la spécification (§2, table "Retenus"), PAS les 13
 * évoqués initialement : 3 écartés (bruit relationnel, §2 "Écartés"), 1 reporté (révision
 * périodique, donnée manquante, §2 "Reporté"). Extensible dans l'esprit (un futur type peut
 * s'ajouter), mais chaque valeur engage une décision métier documentée dans la spec — pas un
 * enum ouvert au sens `x-dfa-enum-extensible`.
 *
 * Seul `facture_echue` a une implémentation de service dans ce lot (`apps/api/src/relances/`) ;
 * les huit autres existent dans le type dès maintenant pour que `regle_relance`/
 * `relance_planifiee` n'aient pas besoin d'une migration `ALTER TYPE` par lot suivant.
 */
export const TYPES_RELANCE = [
  /** #1 — devis émis, sans réponse (Famille A). Lot 4. */
  'devis_sans_reponse',
  /** #2 — facture échue, rappel puis sommation (Famille A). Lot 1 — CE LOT. */
  'facture_echue',
  /** #3 — devis complémentaire en attente, mi-travaux (Famille A). Lot 4. */
  'devis_complementaire_attente',
  /** #4 — véhicule prêt, non restitué (Famille A). Lot 4. */
  'vehicule_pret_non_restitue',
  /** #5 — pneus en dépôt oubliés (Famille A). Lot 4. */
  'depot_pneu_oublie',
  /** #6 — travail reporté urgent/sécurité non repris (Famille A). Lot 4. */
  'travail_reporte_urgent',
  /** #7 — pneus saisonniers à remonter (Famille B). Lot 2. */
  'pneus_saisonniers',
  /** #8 — échéance MFK qui approche (Famille B). Lot 3. */
  'expertise_mfk',
  /** #9 — campagne constructeur sécurité (Famille A si `obligatoire=true`, sinon B). Lot 3. */
  'campagne_constructeur',
] as const;
export type TypeRelance = (typeof TYPES_RELANCE)[number];

/**
 * `objet_type_relance` — nature de l'objet métier à l'origine du rappel (§5,
 * `relance_planifiee.objet_type`). Polymorphe par construction (comme `entite_auditee`,
 * `audit_atelier.entite_id`) : `objet_id` n'a donc PAS de contrainte FK unique en base, seule
 * cette valeur dit dans quelle table chercher.
 */
export const OBJETS_TYPE_RELANCE = [
  'document_vente',
  'ordre_reparation',
  'vehicule',
  'depot_pneu',
  'vehicule_campagne',
  'vehicule_travail_reporte',
] as const;
export type ObjetTypeRelance = (typeof OBJETS_TYPE_RELANCE)[number];

/**
 * `statut_relance_planifiee` — machine à états (§8 de la spec). `envoyee`, `annulee` et
 * `echouee` (après épuisement des tentatives) sont TERMINAUX : une correction se fait par une
 * nouvelle occasion (nouveau palier), jamais par réédition d'une ligne déjà tranchée — même
 * doctrine que la chaîne documentaire facturation.
 *
 * `echouee` sert BOTH un état transitoire (retenté, avant retour à `prete`) ET l'état définitif
 * après épuisement des tentatives : la spec (§8) ne distingue pas les deux par une valeur d'enum
 * séparée (« echouee ─(retry)→ prete » et « echouee (définitif) » partagent le même mot). La
 * distinction vit dans `relance_envoi` (compter les tentatives déjà tracées pour ce
 * `relance_planifiee_id`), jamais dans une valeur d'enum supplémentaire qui dupliquerait cette
 * information.
 */
export const STATUTS_RELANCE_PLANIFIEE = [
  'a_planifier',
  'prete',
  'en_cours_envoi',
  'envoyee',
  'annulee',
  'echouee',
] as const;
export type StatutRelancePlanifiee = (typeof STATUTS_RELANCE_PLANIFIEE)[number];

/**
 * `raison_annulation_relance` — obligatoire quand `statut = 'annulee'` (§5 :
 * `relance_planifiee.annule_raison`), jamais renseigné sinon (voir la contrainte CHECK en base).
 * Une valeur par mécanisme d'arrêt automatique de la spec : `objet_traite` (RA-08/RA-09),
 * `consentement_revoque` (RA-02), `contact_absent` (RA-03, découvert entre planification et
 * envoi), `client_ne_plus_contacter` (RA-14), `vehicule_cede` (RA-07).
 */
export const RAISONS_ANNULATION_RELANCE = [
  'objet_traite',
  'consentement_revoque',
  'contact_absent',
  'client_ne_plus_contacter',
  'vehicule_cede',
] as const;
export type RaisonAnnulationRelance = (typeof RAISONS_ANNULATION_RELANCE)[number];

/**
 * `statut_envoi_relance` — issue d'UNE tentative d'envoi tracée dans `relance_envoi` (append-only,
 * §5). Délibérément distinct de `StatutEnvoiMessageClient` (`contrats/connecteurs/enums.ts`,
 * `accepte`/`rejete`) : celui-ci est la réponse SYNCHRONE du prestataire à l'instant de l'appel,
 * celui-là est le verdict que ce module retient pour la ligne de trace après avoir combiné cette
 * réponse avec ses propres règles (ex. un rejet `raison: 'destinataire_invalide'` devient ici
 * `echoue`, jamais retenté). Aucun état « livré » : voir `notification-sender.ts` décision 1.
 */
export const STATUTS_ENVOI_RELANCE = ['envoye', 'echoue'] as const;
export type StatutEnvoiRelance = (typeof STATUTS_ENVOI_RELANCE)[number];
