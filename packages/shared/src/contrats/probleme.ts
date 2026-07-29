/**
 * Contrat d'erreur unique de l'API DFA : `application/problem+json` (RFC 9457) avec un
 * code métier machine stable en plus des champs standard. Le front n'affiche JAMAIS `title`
 * ni `detail` à l'utilisateur — uniquement `code` (traduit via `erreurs:codes.<CODE>`).
 *
 * ÉTAPE 1 — extension STRICTEMENT ADDITIVE (contrats-api-etape-1.md §3.2, §4.3, §4.4) :
 * 40 codes d'erreur ajoutés EN FIN de `CODES_ERREUR`, trois propriétés facultatives sur
 * `ProblemeDetail`, et trois familles de codes qui ne sont PAS des erreurs
 * (`CodeAvertissement`, `CodeConfirmation`, `CodeActionProposee`).
 * Aucun champ existant n'a été renommé, réordonné ni retiré.
 *
 * TROIS FAMILLES, UN SEUL ESPACE DE TRADUCTION (§4.1) — les codes sont globalement uniques
 * et chaque code appartient à une famille et une seule :
 *   - `CodeErreur`         → `problem+json`, statut ≥ 400          → refus bloquant
 *   - `CodeAvertissement`  → `avertissements[]` d'une réponse 2xx  → encart informatif
 *   - `CodeConfirmation`   → `confirmationsRequises[]` d'un 409    → geste explicite d'un habilité
 */

/**
 * Les 13 codes du socle (étape 0). Ils occupent, dans cet ordre, les 13 premières positions de
 * `CODES_ERREUR` — invariant vérifié à la compilation par `GardePrefixeSocleErreur` ci-dessous
 * et re-vérifié à l'exécution par le test de contrat de L1-15.
 */
export const CODES_ERREUR_SOCLE = [
  'VALIDATION_ECHOUEE',
  'AUTH_IDENTIFIANTS_INVALIDES',
  'AUTH_SESSION_ABSENTE',
  'AUTH_SESSION_EXPIREE',
  'AUTH_COMPTE_SUSPENDU',
  'AUTH_COMPTE_VERROUILLE',
  'AUTH_TENANT_SUSPENDU',
  'AUTH_TROP_DE_TENTATIVES',
  'AUTH_ORIGINE_REFUSEE',
  'DROIT_INSUFFISANT',
  'RESSOURCE_INTROUVABLE',
  'CONFLIT',
  'ERREUR_INTERNE',
] as const;

/**
 * Enum de SORTIE, extensible par nature (§11.2) : un client tiers doit mapper les codes qu'il
 * connaît et se replier sur un comportement générique pour les autres — jamais échouer.
 * `apps/web/src/api/erreurs.ts` applique déjà ce repli (code inconnu → `ERREUR_INTERNE`).
 *
 * ON AJOUTE EN FIN, ON NE RÉORDONNE JAMAIS.
 */
export const CODES_ERREUR = [
  // --- Socle (étape 0), positions 0 à 12 — GELÉES ---
  'VALIDATION_ECHOUEE',
  'AUTH_IDENTIFIANTS_INVALIDES',
  'AUTH_SESSION_ABSENTE',
  'AUTH_SESSION_EXPIREE',
  'AUTH_COMPTE_SUSPENDU',
  'AUTH_COMPTE_VERROUILLE',
  'AUTH_TENANT_SUSPENDU',
  'AUTH_TROP_DE_TENTATIVES',
  'AUTH_ORIGINE_REFUSEE',
  'DROIT_INSUFFISANT',
  'RESSOURCE_INTROUVABLE',
  'CONFLIT',
  'ERREUR_INTERNE',
  // --- Étape 1 : ordre de réparation ---
  'OR_TRANSITION_INTERDITE',
  'OR_RECEPTION_REQUISE',
  'OR_KM_ENTREE_REQUIS',
  'OR_LIGNES_A_VALIDER',
  'OR_POINTAGE_OUVERT',
  'OR_LIGNE_NON_REALISEE',
  'OR_CHECKLIST_INCOMPLETE',
  'OR_PLAFOND_DEPASSE',
  'OR_ANNULATION_IMPOSSIBLE',
  'OR_LIGNE_VERROUILLEE',
  'OR_PO_MANQUANT',
  'OR_RESERVE_SECURITE_REQUISE',
  'OR_FACTURATION_AUCUNE_LIGNE',
  // --- Étape 1 : lignes d'OR ---
  'LIGNE_TRANSITION_INTERDITE',
  'LIGNE_SUPPRESSION_IMPOSSIBLE',
  // --- Étape 1 : devis complémentaires ---
  'DEVIS_IMMUABLE',
  'DEVIS_INTERLOCUTEUR_REQUIS',
  // --- Étape 1 : rendez-vous (déclarés au lot 1, émis au lot 4) ---
  'RDV_TRANSITION_INTERDITE',
  'RDV_IDENTIFICATION_INCOMPLETE',
  'RDV_RESSOURCE_CHEVAUCHEMENT',
  'RDV_ANNULATION_IMPOSSIBLE',
  'RDV_HORS_OUVERTURE',
  // --- Étape 1 : pointage (déclarés au lot 1, émis au lot 2) ---
  'POINTAGE_TRANSITION_INTERDITE',
  'POINTAGE_CHEVAUCHEMENT',
  'POINTAGE_OR_NON_MODIFIABLE',
  'POINTAGE_LIGNE_NON_POINTABLE',
  'POINTAGE_PERIODE_VERROUILLEE',
  'POINTAGE_MOTIF_REQUIS',
  'POINTAGE_HORODATAGE_INVALIDE',
  // --- Étape 1 : véhicules ---
  'VEHICULE_KILOMETRAGE_REGRESSIF',
  'VEHICULE_PLAQUE_COLLISION',
  'VEHICULE_VIN_EXISTANT',
  'VEHICULE_ARCHIVAGE_IMPOSSIBLE',
  // --- Étape 1 : clients ---
  'CLIENT_TYPE_IMMUABLE',
  'CLIENT_DESACTIVATION_IMPOSSIBLE',
  // --- Étape 1 : prêts / véhicules de courtoisie (déclarés au lot 1, émis au lot 5) ---
  'PRET_VEHICULE_INDISPONIBLE',
  'PRET_CONDUCTEUR_REQUIS',
  // --- Étape 1 : transverses ---
  'CONFIRMATION_REQUISE',
  'IDEMPOTENCE_CONFLIT',
  'FONCTION_NON_DISPONIBLE',
  // --- Étape 1 : limitation de débit dédiée (finding D-01, audit sécurité) ---
  // Code dédié pour GET /recherche, distinct d'AUTH_TROP_DE_TENTATIVES : même statut 429 et même
  // mécanisme Retry-After, mais un libellé i18n phrasé en secondes (fenêtre courte, 30s par
  // défaut) plutôt qu'en minutes, et qui ne parle pas de « tentatives » (pas une erreur
  // d'identifiants). Voir apps/api/src/common/securite/garde-limitation-recherche.ts.
  'RECHERCHE_TROP_DE_REQUETES',
  // --- Correction du repli 4xx générique (finding audit statuts) ---
  // Un 405 (méthode HTTP non supportée sur une route existante) portait ERREUR_INTERNE/500 par
  // repli faute de code dédié — le statut restait 405 mais le code métier travestissait un cas
  // de fonctionnement normal en panne serveur. Voir apps/api/src/common/erreurs/filtre-probleme.ts.
  'METHODE_NON_AUTORISEE',
] as const;
export type CodeErreur = (typeof CODES_ERREUR)[number];

type Affirme<T extends true> = T;
/**
 * Garde de compilation : `CODES_ERREUR` commence EXACTEMENT par les 13 codes du socle, dans
 * l'ordre. Insérer, retirer ou déplacer un code du socle fait échouer `pnpm typecheck` — c'est
 * ce qui rend « on ajoute en fin, on ne réordonne jamais » mécanique plutôt que déclaratif.
 */
export type GardePrefixeSocleErreur = Affirme<
  typeof CODES_ERREUR extends readonly [...typeof CODES_ERREUR_SOCLE, ...(readonly string[])]
    ? true
    : false
>;

/**
 * Statut HTTP de chaque code — table §4.3, partie CONTRACTUELLE de l'API : un tiers doit savoir
 * qu'un `OR_PLAFOND_DEPASSE` arrive en 409 et un `OR_KM_ENTREE_REQUIS` en 400.
 *
 * Vit ici plutôt que dans `apps/api/src/common/erreurs/` pour une raison mécanique : typée
 * `Record<CodeErreur, number>`, elle rend IMPOSSIBLE l'ajout d'un code sans statut. Le mapping
 * côté API (`STATUT_PAR_CODE_ERREUR`) doit RÉ-EXPORTER cette table, jamais la dupliquer.
 */
export const STATUT_HTTP_PAR_CODE_ERREUR: Readonly<Record<CodeErreur, number>> = {
  VALIDATION_ECHOUEE: 400,
  AUTH_IDENTIFIANTS_INVALIDES: 401,
  AUTH_SESSION_ABSENTE: 401,
  AUTH_SESSION_EXPIREE: 401,
  AUTH_COMPTE_SUSPENDU: 403,
  AUTH_COMPTE_VERROUILLE: 423,
  AUTH_TENANT_SUSPENDU: 403,
  AUTH_TROP_DE_TENTATIVES: 429,
  AUTH_ORIGINE_REFUSEE: 403,
  DROIT_INSUFFISANT: 403,
  RESSOURCE_INTROUVABLE: 404,
  CONFLIT: 409,
  ERREUR_INTERNE: 500,
  OR_TRANSITION_INTERDITE: 409,
  OR_RECEPTION_REQUISE: 409,
  OR_KM_ENTREE_REQUIS: 400,
  OR_LIGNES_A_VALIDER: 409,
  OR_POINTAGE_OUVERT: 409,
  OR_LIGNE_NON_REALISEE: 409,
  OR_CHECKLIST_INCOMPLETE: 409,
  OR_PLAFOND_DEPASSE: 409,
  OR_ANNULATION_IMPOSSIBLE: 409,
  OR_LIGNE_VERROUILLEE: 409,
  OR_PO_MANQUANT: 409,
  OR_RESERVE_SECURITE_REQUISE: 409,
  OR_FACTURATION_AUCUNE_LIGNE: 409,
  LIGNE_TRANSITION_INTERDITE: 409,
  LIGNE_SUPPRESSION_IMPOSSIBLE: 409,
  DEVIS_IMMUABLE: 409,
  DEVIS_INTERLOCUTEUR_REQUIS: 400,
  RDV_TRANSITION_INTERDITE: 409,
  RDV_IDENTIFICATION_INCOMPLETE: 409,
  RDV_RESSOURCE_CHEVAUCHEMENT: 409,
  RDV_ANNULATION_IMPOSSIBLE: 409,
  RDV_HORS_OUVERTURE: 409,
  POINTAGE_TRANSITION_INTERDITE: 409,
  POINTAGE_CHEVAUCHEMENT: 409,
  POINTAGE_OR_NON_MODIFIABLE: 409,
  POINTAGE_LIGNE_NON_POINTABLE: 409,
  POINTAGE_PERIODE_VERROUILLEE: 409,
  POINTAGE_MOTIF_REQUIS: 400,
  POINTAGE_HORODATAGE_INVALIDE: 400,
  VEHICULE_KILOMETRAGE_REGRESSIF: 409,
  VEHICULE_PLAQUE_COLLISION: 409,
  VEHICULE_VIN_EXISTANT: 409,
  VEHICULE_ARCHIVAGE_IMPOSSIBLE: 409,
  CLIENT_TYPE_IMMUABLE: 409,
  CLIENT_DESACTIVATION_IMPOSSIBLE: 409,
  PRET_VEHICULE_INDISPONIBLE: 409,
  PRET_CONDUCTEUR_REQUIS: 400,
  CONFIRMATION_REQUISE: 409,
  IDEMPOTENCE_CONFLIT: 409,
  FONCTION_NON_DISPONIBLE: 501,
  RECHERCHE_TROP_DE_REQUETES: 429,
  METHODE_NON_AUTORISEE: 405,
};

/**
 * `ProblemeDetail.title` — libellé FR STABLE au sens RFC 9457 (« SHOULD NOT change from
 * occurrence to occurrence »). Il est donc contractuel, et pas une chaîne d'implémentation :
 * il sert au support, aux logs et à la lecture d'un corps brut. Le front ne l'affiche JAMAIS.
 * Les 13 libellés du socle sont repris à l'identique de `filtre-probleme.ts` (aucune
 * modification de comportement à la reprise).
 */
export const TITRE_FR_PAR_CODE_ERREUR: Readonly<Record<CodeErreur, string>> = {
  VALIDATION_ECHOUEE: 'Validation échouée',
  AUTH_IDENTIFIANTS_INVALIDES: 'Identifiants invalides',
  AUTH_SESSION_ABSENTE: 'Session absente',
  AUTH_SESSION_EXPIREE: 'Session expirée',
  AUTH_COMPTE_SUSPENDU: 'Compte suspendu',
  AUTH_COMPTE_VERROUILLE: 'Compte verrouillé',
  AUTH_TENANT_SUSPENDU: 'Tenant suspendu',
  AUTH_TROP_DE_TENTATIVES: 'Trop de tentatives',
  AUTH_ORIGINE_REFUSEE: 'Origine refusée',
  DROIT_INSUFFISANT: 'Droit insuffisant',
  RESSOURCE_INTROUVABLE: 'Ressource introuvable',
  CONFLIT: 'Conflit',
  ERREUR_INTERNE: 'Erreur interne',
  OR_TRANSITION_INTERDITE: 'Transition interdite pour cet ordre de réparation',
  OR_RECEPTION_REQUISE: 'Le véhicule doit être réceptionné',
  OR_KM_ENTREE_REQUIS: "Kilométrage d'entrée requis",
  OR_LIGNES_A_VALIDER: 'Des lignes attendent encore une décision',
  OR_POINTAGE_OUVERT: 'Des pointages sont encore en cours',
  OR_LIGNE_NON_REALISEE: "Des lignes validées n'ont pas été réalisées",
  OR_CHECKLIST_INCOMPLETE: 'Contrôle qualité incomplet',
  OR_PLAFOND_DEPASSE: 'Le plafond autorisé serait dépassé',
  OR_ANNULATION_IMPOSSIBLE: "Annulation impossible pour cet ordre de réparation",
  OR_LIGNE_VERROUILLEE: 'Ligne verrouillée',
  OR_PO_MANQUANT: 'Numéro de commande client manquant',
  OR_RESERVE_SECURITE_REQUISE: 'Réserve de sécurité à signer',
  OR_FACTURATION_AUCUNE_LIGNE: 'Aucune ligne facturable pour ce payeur',
  LIGNE_TRANSITION_INTERDITE: 'Transition interdite pour cette ligne',
  LIGNE_SUPPRESSION_IMPOSSIBLE: 'Suppression de ligne impossible',
  DEVIS_IMMUABLE: 'Devis immuable',
  DEVIS_INTERLOCUTEUR_REQUIS: 'Interlocuteur requis',
  RDV_TRANSITION_INTERDITE: 'Transition interdite pour ce rendez-vous',
  RDV_IDENTIFICATION_INCOMPLETE: 'Identification du rendez-vous incomplète',
  RDV_RESSOURCE_CHEVAUCHEMENT: 'Chevauchement de ressource',
  RDV_ANNULATION_IMPOSSIBLE: 'Annulation de rendez-vous impossible',
  RDV_HORS_OUVERTURE: "Horaire hors des heures d'ouverture",
  POINTAGE_TRANSITION_INTERDITE: 'Transition interdite pour ce pointage',
  POINTAGE_CHEVAUCHEMENT: 'Chevauchement de pointage',
  POINTAGE_OR_NON_MODIFIABLE: "Ordre de réparation non pointable",
  POINTAGE_LIGNE_NON_POINTABLE: 'Ligne non pointable',
  POINTAGE_PERIODE_VERROUILLEE: 'Période de pointage verrouillée',
  POINTAGE_MOTIF_REQUIS: 'Motif requis',
  POINTAGE_HORODATAGE_INVALIDE: 'Horodatage de pointage invalide',
  VEHICULE_KILOMETRAGE_REGRESSIF: 'Kilométrage régressif',
  VEHICULE_PLAQUE_COLLISION: 'Plaque déjà attribuée',
  VEHICULE_VIN_EXISTANT: 'VIN déjà enregistré',
  VEHICULE_ARCHIVAGE_IMPOSSIBLE: 'Archivage de véhicule impossible',
  CLIENT_TYPE_IMMUABLE: 'Type de client immuable',
  CLIENT_DESACTIVATION_IMPOSSIBLE: 'Désactivation de client impossible',
  PRET_VEHICULE_INDISPONIBLE: 'Véhicule de prêt indisponible',
  PRET_CONDUCTEUR_REQUIS: 'Conducteur requis',
  CONFIRMATION_REQUISE: 'Confirmation requise',
  IDEMPOTENCE_CONFLIT: "Conflit de clé d'idempotence",
  FONCTION_NON_DISPONIBLE: 'Fonctionnalité non disponible',
  RECHERCHE_TROP_DE_REQUETES: 'Trop de requêtes de recherche',
  METHODE_NON_AUTORISEE: 'Méthode HTTP non supportée',
};

/**
 * Nature d'un élément qui bloque une action (§3.2). Enum EXTENSIBLE
 * (`x-dfa-enum-extensible: true`, §11.2) : un client doit rendre un type inconnu de façon
 * générique, jamais échouer.
 *
 * Miroir exact des clés `erreurs:blocages.<type>` des fichiers
 * `apps/web/src/i18n/locales/<langue>/erreurs.json`.
 */
export const TYPES_ELEMENT_BLOQUANT = [
  'ligne_or',
  'pointage',
  'technicien',
  'point_controle',
  'devis_complementaire',
  'signature',
  'travail_reporte',
  'ressource_planning',
  'ordre_reparation',
  'champ',
] as const;
export type TypeElementBloquant = (typeof TYPES_ELEMENT_BLOQUANT)[number];

/**
 * Ce qui bloque, nommément. Borné à 50 éléments (§3.5 règle 2) ; au-delà, `donnees.total`
 * porte le compte réel.
 */
export interface ElementBloquant {
  readonly type: TypeElementBloquant;
  /** uuid de l'élément ; nom du champ quand `type = 'champ'`. */
  readonly id: string;
  /**
   * Libellé FR stable, destiné au support, aux logs et à la lecture du corps brut.
   * JAMAIS affiché par le front : celui-ci rend l'élément depuis `type`, `id` et `donnees`,
   * avec ses propres composants et sa propre langue.
   */
  readonly libelle: string;
  /**
   * Attributs d'affichage minimaux. Additif : on ajoute des clés, on n'en retire jamais.
   * Ne porte JAMAIS une donnée non autorisée à l'appelant — le filtrage par rôle se fait
   * côté serveur, à la construction (§3.5 règle 4 : aucun montant pour un technicien).
   */
  readonly donnees?: Readonly<Record<string, unknown>>;
}

/**
 * Codes d'action proposée (§3.3). Enum EXTENSIBLE.
 * Miroir exact des clés `erreurs:actions.<CODE>`.
 */
export const CODES_ACTION_PROPOSEE = [
  'CREER_DEVIS_COMPLEMENTAIRE',
  'VALIDER_LIGNES',
  'ARRETER_POINTAGES',
  'MARQUER_LIGNES_REALISEES',
  'COMPLETER_CONTROLE_QUALITE',
  'CREER_OR_RETOUCHE',
  'CREER_NOUVEL_OR',
  'RENSEIGNER_PO',
  'SIGNER_RESERVE_SECURITE',
  'FOURNIR_MOTIF',
  'REJOUER_AVEC_CONFIRMATION',
  'DEMANDER_HABILITATION',
  'RECEPTIONNER_VEHICULE',
  'RAFRAICHIR',
] as const;
export type CodeActionProposee = (typeof CODES_ACTION_PROPOSEE)[number];

/** Le chemin de sortie proposé à l'utilisateur après un refus (invariant frontend n°8). */
export interface ActionProposee {
  readonly code: CodeActionProposee;
  /** Indice d'appel, facultatif. Le client peut l'ignorer : tout est dans l'OpenAPI. */
  readonly methode?: 'POST' | 'PATCH' | 'GET';
  readonly chemin?: string;
  readonly parametres?: Readonly<Record<string, unknown>>;
}

/**
 * Avertissements (§4.4) — un succès AVEC RÉSERVE, transporté dans `avertissements[]` d'une
 * réponse 2xx, jamais dans un `problem+json`. Enum EXTENSIBLE.
 *
 * `POINTAGE_CLOTURE_AUTOMATIQUE` est l'exemple canonique : CT-37 attend que le démarrage d'un
 * pointage RÉUSSISSE tout en signalant la clôture du précédent. Le modéliser en erreur casserait
 * la file hors ligne, qui ne doit jamais traiter un succès dans un `catch`.
 */
export const CODES_AVERTISSEMENT = [
  'CLIENT_DOUBLON_PROBABLE',
  'VEHICULE_VIN_COURT',
  'VEHICULE_IDENTIFICATION_INCOMPLETE',
  'VEHICULE_KILOMETRAGE_ABERRANT',
  'VEHICULE_EXPERTISE_ECHUE',
  'PLANNING_CAPACITE_DEPASSEE',
  'POINTAGE_CLOTURE_AUTOMATIQUE',
  'PRET_CASCADE_RESTITUTION',
  'OR_MULTI_PAYEURS_DESACTIVE',
] as const;
export type CodeAvertissement = (typeof CODES_AVERTISSEMENT)[number];

/**
 * Confirmations (§4.4) — le geste explicite d'un rôle habilité, tracé. Liste FERMÉE : chaque
 * entrée a un droit associé dans `DROIT_PAR_CONFIRMATION` (`apps/api/src/auth/matrice-droits.ts`),
 * et un code de confirmation sans droit ne compile pas.
 *
 * Protocole (§4.4), jamais un `?force=true` :
 *  1. requête sans `confirmations` ;
 *  2. si l'appelant A le droit → `409 CONFIRMATION_REQUISE` + `confirmationsRequises[]` +
 *     `actionsProposees: [{ code: 'REJOUER_AVEC_CONFIRMATION' }]` ;
 *     sinon → `409` portant le CodeErreur spécifique de la condition la plus bloquante,
 *     SANS `confirmationsRequises`, avec `actionsProposees: [{ code: 'DEMANDER_HABILITATION' }]` ;
 *  3. le client rejoue la MÊME requête avec `confirmations: [...]` dans le CORPS (jamais un
 *     en-tête ni une query : il entre dans l'empreinte d'idempotence).
 *
 * Une confirmation envoyée pour une condition qui n'existe plus est ignorée sans erreur.
 */
export const CODES_CONFIRMATION = [
  'CLIENT_BLOQUE',
  'VEHICULE_DEUX_OR_OUVERTS',
  'RDV_RESSOURCE_CHEVAUCHEMENT',
  'RDV_HORS_OUVERTURE',
  'PRET_VEHICULE_INDISPONIBLE',
  'OR_SANS_RDV',
] as const;
export type CodeConfirmation = (typeof CODES_CONFIRMATION)[number];

export interface ErreurChamp {
  readonly champ: string;
  readonly code: string;
  readonly message: string;
}

export interface ProblemeDetail {
  /** `https://docs.dmsforall.example/erreurs/${code}` */
  readonly type: string;
  /** Libellé FR stable, JAMAIS affiché par le front. */
  readonly title: string;
  readonly status: number;
  /** Le contrat machine, seul champ que le front doit lire pour décider quoi afficher. */
  readonly code: CodeErreur;
  readonly detail?: string;
  /** = requeteId, aussi renvoyé en en-tête X-Requete-Id. */
  readonly instance: string;
  /**
   * RÉSERVÉ À LA VALIDATION DE SAISIE (§3.5 règle 5). Un blocage métier n'y figure jamais :
   * il va dans `blocages`.
   */
  readonly erreurs?: ReadonlyArray<ErreurChamp>;
  /**
   * Ce qui bloque, nommément. Présent sur TOUT refus de transition dès qu'il existe un élément
   * nommable (§3.5 règle 1) : un `409 OR_LIGNES_A_VALIDER` sans `blocages` est un bug.
   */
  readonly blocages?: readonly ElementBloquant[];
  /** Codes à renvoyer dans `confirmations[]` du corps pour rejouer la requête (§4.4). */
  readonly confirmationsRequises?: readonly CodeConfirmation[];
  /**
   * Le chemin de sortie. Vide UNIQUEMENT quand aucune sortie n'existe (état terminal `annule`,
   * `cloture`) — invariant frontend n°8.
   */
  readonly actionsProposees?: readonly ActionProposee[];
}
