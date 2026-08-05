/**
 * Enums métier du module Connecteurs — étape 5, `docs/specification-etape-5-connecteurs.md`,
 * repères `RC-xx`.
 *
 * Doctrine reprise à l'identique de `contrats/pieces/enums.ts` : valeurs en **snake_case**,
 * miroir des types PostgreSQL à créer, deux classes de compatibilité :
 *  - **GELÉS** (`x-dfa-enum-extensible: false`) — machines à états qui portent un invariant
 *    inter-domaine (RC-04 : réessais puis bascule en attente d'action humaine) : un client peut
 *    les énumérer exhaustivement.
 *  - **EXTENSIBLES** (`x-dfa-enum-extensible: true`) — tout le reste. Un client tiers doit traiter
 *    une valeur inconnue comme « autre » et ne jamais échouer.
 *
 * CE QUE CE FICHIER NE FAIT JAMAIS — rappelé une fois pour tout le module (`RC-01` à `RC-08`,
 * principe transversal) : **nommer un partenaire** (une plateforme d'annonces, un constructeur,
 * une banque, un fournisseur de pièces précis). L'identité d'un partenaire est une DONNÉE
 * (`ReponseTypeConnecteur.code`, `connecteur.ts`), jamais une valeur de TYPE — exactement le même
 * raisonnement que `TYPES_REFERENCE_ARTICLE` (`contrats/pieces/enums.ts`) pour la valeur
 * `fournisseur` : « un enum ne doit jamais porter de valeurs générées à l'exécution ». Le cœur
 * (`ARCHITECTURE.md` §5) ne connaît que des FAMILLES fonctionnelles et des INTERFACES stables —
 * jamais un adaptateur nommément.
 */

/* ------------------------------------------------------------------ */
/* Socle commun (RC-01 → RC-08)                                        */
/* ------------------------------------------------------------------ */

/**
 * `famille_connecteur` — extensible. Les six familles couvertes par la spécification étape 5
 * (§2 → §7), plus `messagerie` (SMS/e-mail, `docs/specification-relances-automatiques.md` §6.3 —
 * aucun `RC-xx` ne la sourçait encore, la spécification des relances automatiques est la première
 * à exiger un envoi de message au client) : aucune séquence imposée entre elles, une nouvelle
 * famille (ex. un futur type de plateforme) ne casse aucun client qui traite déjà les sept.
 */
export const FAMILLES_CONNECTEUR = [
  'oem', // §2, RC-20 → RC-27
  'plateforme_annonces', // §3, RC-40 → RC-46
  'fiduciaire', // §4, RC-50 → RC-53 (voir aussi docs/exports-fiduciaires.md)
  'banque', // §5, RC-60 → RC-66
  'fournisseur_pieces', // §6, RC-70 → RC-74
  'administration', // §7, RC-80 → RC-82
  'messagerie', // docs/specification-relances-automatiques.md §6.3 — SMS/e-mail au client
] as const;
export type FamilleConnecteur = (typeof FAMILLES_CONNECTEUR)[number];

/**
 * `nom_interface_connecteur` — **GELÉ**. Reprenait LITTÉRALEMENT les cinq interfaces stables
 * nommées par `ARCHITECTURE.md` §5 (schéma « Cœur GarageOS → interfaces stables → adaptateurs ») ;
 * `NotificationSender` est la SIXIÈME, ajoutée par `docs/specification-relances-automatiques.md`
 * §6.3 (« Il manque une sixième interface de connecteur (…) même doctrine — port générique, aucun
 * nom de fournisseur en dur, adaptateur factice pour les tests. Préalable au lot d'envoi. ») : le
 * module de relances ne peut exister sans elle, ce n'est pas un ajout de confort. Rester gelé
 * malgré cet ajout signifie la même chose qu'avant : le cœur ne connaît QUE ces six noms, jamais
 * un partenaire, et une SEPTIÈME resterait un changement d'architecture à motiver au même niveau
 * que celui-ci — pas un ajout de catalogue ordinaire. `AccountingExporter` et `NotificationSender`
 * sont les deux seules interfaces dont la FORME (types de requête/réponse, pas seulement le nom)
 * est déjà posée dans ce paquet (`contrats/facturation/export.ts` ;
 * `contrats/connecteurs/notification-sender.ts`) ; les quatre autres restent `[INCONNU]` côté
 * méthodes (`RC-20`/`RC-40`/`RC-70`, voir le rapport d'accompagnement de l'agent d'origine) — ce
 * module continue de ne PAS inventer leur forme par anticipation.
 */
export const NOMS_INTERFACE_CONNECTEUR = [
  'PartsCatalogProvider',
  'VehicleReferenceProvider',
  'OrderProvider',
  'ListingPublisher',
  'AccountingExporter',
  'NotificationSender',
] as const;
export type NomInterfaceConnecteur = (typeof NOMS_INTERFACE_CONNECTEUR)[number];

/**
 * `capacite_connecteur` — extensible. `RC-70` distingue explicitement TROIS usages à ne pas
 * fusionner pour les fournisseurs de pièces (consultation catalogue, consultation disponibilité,
 * transmission de commande) ; `import`/`export` sont les deux formes du mécanisme générique de
 * masse (priorité 2 du brief, `import.ts`/`export.ts`). `transmission` couvre tout envoi sortant
 * lié à un OBJET métier unique plutôt qu'à un lot (commande fournisseur `RC-73`, déclaration de
 * garantie/campagne `RC-21`/`RC-22`) — distinct d'`export`, qui est un envoi de masse répété
 * (catalogue de véhicules en vente, écritures comptables).
 */
export const CAPACITES_CONNECTEUR = ['import', 'export', 'consultation', 'transmission'] as const;
export type CapaciteConnecteur = (typeof CAPACITES_CONNECTEUR)[number];

/**
 * `statut_activation_connecteur` — extensible. Cycle réversible (`inactif` ↔ `actif`), pas de
 * machine à états au sens strict — même doctrine que `STATUTS_ARTICLE`/`STATUTS_FOURNISSEUR`
 * (`contrats/pieces/enums.ts`). `PC-02` : aucun connecteur actif par défaut, activation explicite
 * par tenant.
 */
export const STATUTS_ACTIVATION_CONNECTEUR = ['inactif', 'actif'] as const;
export type StatutActivationConnecteur = (typeof STATUTS_ACTIVATION_CONNECTEUR)[number];

/**
 * `statut_sante_connecteur` — **GELÉ**. Littéralement `RC-03` : « configuré ou non, dernier
 * échange réussi et quand, en échec et depuis quand ». Gelé pour la même raison que
 * `STATUTS_RESERVATION_PIECE` : c'est l'objet qui pilote un bandeau d'alerte vu par un magasinier
 * ou un vendeur (jamais un informaticien, `RC-03`) — un statut inconnu affiché sans traduction
 * serait exactement le défaut que `RC-03` existe pour éviter.
 */
export const STATUTS_SANTE_CONNECTEUR = [
  'non_configure',
  'operationnel',
  'en_echec',
  'necessite_action',
] as const;
export type StatutSanteConnecteur = (typeof STATUTS_SANTE_CONNECTEUR)[number];

/**
 * `statut_execution_connecteur` — **GELÉ**. Machine à états portant directement l'invariant
 * `RC-04` : réessayé avec un espacement croissant (`echec_reprogramme`), puis bascule en attente
 * d'action humaine (`necessite_action`) — jamais un échec silencieux en boucle, jamais une alerte
 * dès le premier raté. `annulee` : geste explicite (`execution.ts::schemaAnnulationExecution`),
 * distinct d'un échec.
 */
export const STATUTS_EXECUTION_CONNECTEUR = [
  'en_attente',
  'en_cours',
  'reussie',
  'echec_reprogramme',
  'necessite_action',
  'annulee',
] as const;
export type StatutExecutionConnecteur = (typeof STATUTS_EXECUTION_CONNECTEUR)[number];

/**
 * `type_declenchement_connecteur` — **GELÉ**, exactement les trois formes listées par la
 * priorité 3 du brief : `manuel`, `planifie`, `evenement`. Structurel plutôt qu'un fait métier
 * observé : détermine quel champ optionnel de `execution.ts`/`declenchement.ts` est renseigné
 * (`evenementDeclencheur` vs `planification`), donc gelé comme `OPERATIONS_CONNECTEUR` ne l'est
 * pas (voir plus bas).
 */
export const TYPES_DECLENCHEMENT_CONNECTEUR = ['manuel', 'planifie', 'evenement'] as const;
export type TypeDeclenchementConnecteur = (typeof TYPES_DECLENCHEMENT_CONNECTEUR)[number];

/**
 * `operation_connecteur` — extensible. « Import et export comme deux formes du même mécanisme »
 * (brief, priorité 2). Extensible et non gelé : contrairement à `TYPES_DECLENCHEMENT_CONNECTEUR`,
 * ce n'est pas un fait structurel figé par l'architecture — une troisième forme (ex. une
 * synchronisation bidirectionnelle de statut) resterait un ajout de catalogue, pas une rupture.
 */
export const OPERATIONS_CONNECTEUR = ['import', 'export'] as const;
export type OperationConnecteur = (typeof OPERATIONS_CONNECTEUR)[number];

/* ------------------------------------------------------------------ */
/* Import / export génériques (RC-20, RC-40 → RC-46, RC-60, RC-70)     */
/* ------------------------------------------------------------------ */

/**
 * `nature_import_connecteur` — extensible. Catégories d'import directement issues du texte de la
 * spécification, jamais un format précis :
 *  - `catalogue_pieces` : `RC-20` (pièces d'origine constructeur) et `RC-70` (catalogue
 *    fournisseur générique) — même catégorie fonctionnelle, deux familles de connecteur.
 *  - `tarifs_fournisseur` : `RC-70`/`RC-71` — prix INDICATIF seulement, jamais l'arbitre
 *    (`RC-71` : le prix reçu à réception reste l'arbitre, pas le prix catalogue importé).
 *  - `referentiel_constructeur` : `RC-22`/`RC-23` — campagnes ouvertes et forfaits/temps barémés,
 *    référentiels VERSIONNÉS dans le temps (`RC-23`).
 *  - `releve_bancaire` : `RC-60` → `RC-69`. **Portée volontairement limitée au TRANSPORT** (un
 *    fichier arrive, une exécution d'import s'ouvre) — ce module ne modélise PAS le rapprochement
 *    lui-même (correspondance avec une facture, reconnaissance d'un escompte `RC-63`) : c'est un
 *    traitement du domaine facturation (`paiement.source = 'camt054'`, déjà modélisé), pas un
 *    format de transport. Voir le rapport d'accompagnement.
 */
export const NATURES_IMPORT_CONNECTEUR = [
  'catalogue_pieces',
  'tarifs_fournisseur',
  'referentiel_constructeur',
  'releve_bancaire',
] as const;
export type NatureImportConnecteur = (typeof NATURES_IMPORT_CONNECTEUR)[number];

/**
 * `nature_export_connecteur` — extensible.
 *  - `annonce_vehicule` : `RC-40` → `RC-46`, la seule forme d'export dont le déclenchement métier
 *    est déjà entièrement spécifié (statut commercial du véhicule pilote la publication/le
 *    retrait).
 *  - `immatriculation` : `RC-24`, marqué **[À VALIDER — `QC-08`]** dans la spécification : conservé
 *    dans le catalogue pour ne pas bloquer un futur usage, mais aucun déclenchement automatique ne
 *    doit s'appuyer dessus tant que `QC-08` n'est pas tranchée.
 *
 * N'INCLUT PAS l'export comptable (`AccountingExporter`, `contrats/facturation/export.ts`) —
 * `RC-51` : ne pas dupliquer un mécanisme déjà livré, seulement l'adaptateur de sérialisation
 * change d'une cible à l'autre.
 */
export const NATURES_EXPORT_CONNECTEUR = ['annonce_vehicule', 'immatriculation'] as const;
export type NatureExportConnecteur = (typeof NATURES_EXPORT_CONNECTEUR)[number];

/**
 * `action_export_connecteur` — extensible. Les trois gestes de `RC-40`/`RC-43` sur une annonce :
 * publier, mettre à jour (prix, statut), retirer. Le retrait est le geste PRIORITAIRE de toute
 * cette famille (`RC-43` : « le cas le plus coûteux n'est pas l'annonce absente, c'est l'annonce
 * présente pour un véhicule déjà vendu »).
 */
export const ACTIONS_EXPORT_CONNECTEUR = ['publier', 'mettre_a_jour', 'retirer'] as const;
export type ActionExportConnecteur = (typeof ACTIONS_EXPORT_CONNECTEUR)[number];

/* ------------------------------------------------------------------ */
/* Abonnements webhook sortants (voir webhook.ts pour la justification */
/* de périmètre — pas un RC-xx sourcé)                                 */
/* ------------------------------------------------------------------ */

/**
 * `statut_abonnement_webhook` — **GELÉ**. `quarantaine` est atteint AUTOMATIQUEMENT après
 * `MAX_TENTATIVES_LIVRAISON_WEBHOOK` échecs consécutifs (`contrats/atelier/evenement.ts`) — c'est
 * un invariant de la machine de livraison, pas un choix de tenant, donc gelé comme
 * `STATUTS_SANTE_CONNECTEUR`.
 */
export const STATUTS_ABONNEMENT_WEBHOOK = ['actif', 'suspendu', 'quarantaine'] as const;
export type StatutAbonnementWebhook = (typeof STATUTS_ABONNEMENT_WEBHOOK)[number];

/**
 * `statut_livraison_webhook` — **GELÉ**. Une ligne de journal par tentative de livraison
 * (`contrats/atelier/evenement.ts::MAX_TENTATIVES_LIVRAISON_WEBHOOK` = 5, backoff 1 min → 2 h).
 * `abandonnee` : la dernière tentative a épuisé le nombre max sans succès, l'abonnement bascule en
 * `quarantaine`.
 */
export const STATUTS_LIVRAISON_WEBHOOK = [
  'en_attente',
  'reussie',
  'echouee',
  'abandonnee',
] as const;
export type StatutLivraisonWebhook = (typeof STATUTS_LIVRAISON_WEBHOOK)[number];

/* ------------------------------------------------------------------ */
/* Envoi de message client — `NotificationSender` (voir                */
/* notification-sender.ts pour la justification de périmètre ;         */
/* docs/specification-relances-automatiques.md §5, §6.3, RA-05, RA-11,  */
/* RA-12 — pas un `RC-xx` sourcé)                                       */
/* ------------------------------------------------------------------ */

/**
 * `canal_message_client` — extensible. Les deux seuls canaux exigés par
 * `docs/specification-relances-automatiques.md` §5 (`regle_relance.canaux`, « sous-ensemble
 * email/sms ») : aucun autre canal n'y est mentionné. Un appel téléphonique
 * (`marketing_appel` dans `client_consentement`) reste un geste humain du garagiste, jamais un
 * envoi automatisé par ce connecteur — ne pas confondre un TYPE DE CONSENTEMENT avec un CANAL
 * D'ENVOI. Extensible : un futur canal (notification push, courrier) est un ajout de membre
 * d'union dans `ContenuMessageClient` (`notification-sender.ts`), jamais une réécriture des deux
 * existants.
 */
export const CANAUX_MESSAGE_CLIENT = ['sms', 'email'] as const;
export type CanalMessageClient = (typeof CANAUX_MESSAGE_CLIENT)[number];

/**
 * `statut_envoi_message_client` — extensible, et délibérément DISTINCT de
 * `STATUTS_EXECUTION_CONNECTEUR` (voir l'en-tête de `notification-sender.ts` pour la
 * justification complète du non-réemploi). Couvre UNIQUEMENT ce que
 * `docs/specification-relances-automatiques.md` exige aujourd'hui : l'ACCEPTATION synchrone par
 * le prestataire (« le prestataire accepte le message, la remise arrive plus tard »), jamais la
 * confirmation de remise finale — `relance_envoi.statut_envoi` (§5) ne connaît lui-même que
 * `envoye`/`echoue`, aucun état « livré » n'existe dans le modèle de données appelant. Extensible
 * pour qu'un futur mécanisme de réconciliation (webhook entrant, sondage — non modélisé ici,
 * volontairement, voir le rapport d'accompagnement) puisse ajouter une valeur de remise confirmée
 * sans rupture pour un client qui ne connaît que ces deux-là.
 */
export const STATUTS_ENVOI_MESSAGE_CLIENT = ['accepte', 'rejete'] as const;
export type StatutEnvoiMessageClient = (typeof STATUTS_ENVOI_MESSAGE_CLIENT)[number];

/**
 * `raison_rejet_message_client` — extensible. Un REJET (`ReponseEnvoiMessageClient` avec
 * `statut: 'rejete'`) est un RÉSULTAT normal rendu par la promesse, jamais une exception : il
 * distingue un échec DÉFINITIF (destinataire invalide, contenu refusé…), que le socle de
 * résilience existant (`apps/api/src/connecteurs/resilience/`) ne doit jamais réessayer en
 * boucle, d'un échec TRANSITOIRE (réseau, délai dépassé), qui reste porté par un rejet de
 * promesse et absorbé par ce même socle. Voir l'en-tête de `notification-sender.ts`.
 */
export const RAISONS_REJET_MESSAGE_CLIENT = [
  'destinataire_invalide',
  'canal_non_supporte',
  'contenu_refuse',
  'quota_depasse',
] as const;
export type RaisonRejetMessageClient = (typeof RAISONS_REJET_MESSAGE_CLIENT)[number];
