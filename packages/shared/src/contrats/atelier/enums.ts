/**
 * Enums métier de l'étape 1 — SOURCE UNIQUE, partagée API <-> web <-> connecteurs.
 *
 * Forme identique au socle : `as const` + type dérivé, valeurs en **snake_case**, miroir exact
 * des types PostgreSQL de `plan-etape-1-backend.md` §2.3 (eux-mêmes dérivés d'ici en `pgEnum`).
 * Les enums des modules hors lot 1 (rendez-vous, pointage, planning, courtoisie) sont déclarés
 * DÈS MAINTENANT : un type déclaré non utilisé ne coûte rien, un type inventé deux fois coûte
 * une migration.
 *
 * COMPATIBILITÉ ASCENDANTE (contrats-api-etape-1.md §11.2) — deux classes d'enums :
 *
 *  - **GELÉS** (`x-dfa-enum-extensible: false`) : `statut_ordre_reparation`, `statut_ligne_or`,
 *    `statut_rendez_vous`, `statut_pointage`, `payeur_ligne_or`, `origine_ligne_or`. Aucune
 *    valeur ne sera ajoutée en v1 — un client peut les énumérer exhaustivement sans risque.
 *    `facture` et `facturee` existent DÉJÀ : l'étape 2 ne les ajoutera pas, elle les rendra
 *    atteignables.
 *  - **EXTENSIBLES** (`x-dfa-enum-extensible: true`) : tous les autres. Un client tiers doit
 *    traiter une valeur inconnue comme « autre » et ne jamais échouer.
 *
 * Chaque enum porte ci-dessous sa classe en commentaire — c'est ce que l'OpenAPI doit publier.
 */

/* ------------------------------------------------------------------ */
/* Clients                                                             */
/* ------------------------------------------------------------------ */

/** `type_client` — extensible. Immuable après création (RM-01, `CLIENT_TYPE_IMMUABLE`). */
export const TYPES_CLIENT = ['particulier', 'entreprise'] as const;
export type TypeClient = (typeof TYPES_CLIENT)[number];

/** `statut_client` — extensible. `bloque` = impayés (RM-08, confirmation `CLIENT_BLOQUE`). */
export const STATUTS_CLIENT = ['actif', 'inactif', 'bloque'] as const;
export type StatutClient = (typeof STATUTS_CLIENT)[number];

/** `type_adresse` — extensible. Une seule `principale` par client (RM-03). */
export const TYPES_ADRESSE = ['principale', 'facturation', 'livraison'] as const;
export type TypeAdresse = (typeof TYPES_ADRESSE)[number];

/** `role_contact` — extensible. Rôles CUMULABLES sur un même contact (RM-04). */
export const ROLES_CONTACT = [
  'conducteur',
  'gestionnaire_flotte',
  'signataire',
  'comptabilite',
] as const;
export type RoleContact = (typeof ROLES_CONTACT)[number];

/** `type_consentement` — extensible (RM-09, nLPD). */
export const TYPES_CONSENTEMENT = ['marketing_email', 'marketing_sms', 'marketing_appel'] as const;
export type TypeConsentement = (typeof TYPES_CONSENTEMENT)[number];

/** `nature_note` — extensible. `alerte` remonte dans le contexte-atelier (RM-13, RM-36). */
export const NATURES_NOTE = ['interne', 'alerte'] as const;
export type NatureNote = (typeof NATURES_NOTE)[number];

/**
 * Critère ayant déclenché une suggestion de doublon (`GET /doublons-clients`, RM-05).
 * Extensible : de nouveaux critères de rapprochement viendront.
 */
export const CRITERES_DOUBLON_CLIENT = ['nom_npa', 'email', 'telephone', 'ide'] as const;
export type CritereDoublonClient = (typeof CRITERES_DOUBLON_CLIENT)[number];

/* ------------------------------------------------------------------ */
/* Véhicules                                                           */
/* ------------------------------------------------------------------ */

/** `unite_distance` — extensible. La conversion mi -> km est faite PAR LE SERVEUR (CT-08). */
export const UNITES_DISTANCE = ['km', 'mi'] as const;
export type UniteDistance = (typeof UNITES_DISTANCE)[number];

/** `source_kilometrage` — extensible (§11.2). */
export const SOURCES_KILOMETRAGE = [
  'reception',
  'ordre_reparation',
  'expertise',
  'vente',
  'declaratif',
  'import',
] as const;
export type SourceKilometrage = (typeof SOURCES_KILOMETRAGE)[number];

/**
 * `motif_kilometrage_regressif` — extensible. Valeurs renvoyées telles quelles dans
 * `actionsProposees[].parametres.motifsAcceptes` d'un `409 VEHICULE_KILOMETRAGE_REGRESSIF`.
 */
export const MOTIFS_KILOMETRAGE_REGRESSIF = [
  'compteur_remplace',
  'erreur_saisie',
  'changement_unite',
  'correction',
] as const;
export type MotifKilometrageRegressif = (typeof MOTIFS_KILOMETRAGE_REGRESSIF)[number];

/** `motif_fin_detention` — extensible (§11.2). */
export const MOTIFS_FIN_DETENTION = ['vente', 'reprise', 'deces', 'correction', 'export'] as const;
export type MotifFinDetention = (typeof MOTIFS_FIN_DETENTION)[number];

/** `resultat_expertise` — extensible. Expertise = MFK / contrôle technique cantonal. */
export const RESULTATS_EXPERTISE = ['accepte', 'accepte_avec_defauts', 'refuse'] as const;
export type ResultatExpertise = (typeof RESULTATS_EXPERTISE)[number];

/**
 * `source_echeance_expertise` — extensible. Contractuellement DÉTERMINANT : une `convocation`
 * cantonale prime TOUJOURS sur une périodicité `calculee` (RM-28, CT-10). Sans ce champ, un
 * client afficherait une date fausse avec aplomb.
 */
export const SOURCES_ECHEANCE_EXPERTISE = ['calculee', 'convocation'] as const;
export type SourceEcheanceExpertise = (typeof SOURCES_ECHEANCE_EXPERTISE)[number];

/** `statut_campagne` — extensible. Campagne = rappel constructeur (RM-30). */
export const STATUTS_CAMPAGNE = ['ouverte', 'close'] as const;
export type StatutCampagne = (typeof STATUTS_CAMPAGNE)[number];

/** `statut_vehicule` — extensible. Il n'existe AUCUN `DELETE` : on archive (RM-31). */
export const STATUTS_VEHICULE = ['actif', 'archive'] as const;
export type StatutVehicule = (typeof STATUTS_VEHICULE)[number];

/** `motif_archivage_vehicule` — extensible (RM-31). */
export const MOTIFS_ARCHIVAGE_VEHICULE = [
  'detruit',
  'exporte',
  'vendu_hors_clientele',
  'doublon',
] as const;
export type MotifArchivageVehicule = (typeof MOTIFS_ARCHIVAGE_VEHICULE)[number];

/** `urgence_travail` — extensible (RM-73). */
export const URGENCES_TRAVAIL = ['urgent', 'a_faire', 'a_surveiller'] as const;
export type UrgenceTravail = (typeof URGENCES_TRAVAIL)[number];

/** `statut_travail_reporte` — extensible (RM-73). */
export const STATUTS_TRAVAIL_REPORTE = ['ouvert', 'repris', 'abandonne'] as const;
export type StatutTravailReporte = (typeof STATUTS_TRAVAIL_REPORTE)[number];

/* ------------------------------------------------------------------ */
/* Ordres de réparation                                                */
/* ------------------------------------------------------------------ */

/**
 * `statut_ordre_reparation` — **GELÉ** (`x-dfa-enum-extensible: false`).
 *
 * C'est la machine à états : y ajouter une valeur, c'est changer le cycle de vie, ce qui est une
 * rupture métier bien avant d'être une rupture technique. `facture` est présent dès la v1 mais
 * n'est atteignable qu'à l'étape 2 (T-16, action `/facturer` non publiée).
 *
 * `attente_accord` / `attente_pieces` / `attente_externe` ne sont PAS des statuts (A-03 du plan
 * backend) : ce sont des drapeaux orthogonaux — voir `ATTENTES_ORDRE_REPARATION` et
 * `ETATS_AFFICHES_ORDRE_REPARATION`. C'est précisément ce qui permet de geler cet enum.
 */
export const STATUTS_ORDRE_REPARATION = [
  'planifie',
  'ouvert',
  'en_cours',
  'controle',
  'termine',
  'facture',
  'restitue',
  'cloture',
  'annule',
] as const;
export type StatutOrdreReparation = (typeof STATUTS_ORDRE_REPARATION)[number];

/**
 * Drapeaux d'attente, ORTHOGONAUX au statut (A-03). Alimentent l'objet `attentes` de l'OR, le
 * filtre `?attente=` et les vues `attente_*`.
 */
export const ATTENTES_ORDRE_REPARATION = ['accord', 'pieces', 'externe'] as const;
export type AttenteOrdreReparation = (typeof ATTENTES_ORDRE_REPARATION)[number];

/**
 * Valeurs possibles du champ dérivé `etatAffiche` (§8.3) : le statut, OU le drapeau d'attente le
 * plus bloquant s'il y en a un (priorité `accord > pieces > externe`), calculé UNE FOIS côté
 * serveur. Sans lui, chaque client réimplémenterait la priorité et deux clients finiraient par
 * afficher deux états différents pour le même OR.
 *
 * ATTENTION — c'est CE type, et non `StatutOrdreReparation`, que consomme le composant
 * `BadgeStatutOr` du front : `docs/design-etape-1-atelier.md` §5.2 décrit 12 pastilles, soit les
 * 9 statuts PLUS les 3 états d'attente. Un badge câblé sur `ordreReparation.statut` n'afficherait
 * JAMAIS les trois états d'attente, qui sont pourtant l'information la plus utile au comptoir.
 *
 * Lecture seule, JAMAIS entrant (§2.3 : les champs dérivés ne sont jamais l'entrée d'une décision
 * serveur).
 */
export const ETATS_AFFICHES_ORDRE_REPARATION = [
  'planifie',
  'ouvert',
  'en_cours',
  'attente_accord',
  'attente_pieces',
  'attente_externe',
  'controle',
  'termine',
  'facture',
  'restitue',
  'cloture',
  'annule',
] as const;
export type EtatAfficheOrdreReparation = (typeof ETATS_AFFICHES_ORDRE_REPARATION)[number];

/** `type_ordre_reparation` — extensible (§11.2). */
export const TYPES_ORDRE_REPARATION = [
  'service',
  'reparation',
  'diagnostic',
  'expertise',
  'pneus',
  'carrosserie',
  'retouche',
  'interne',
] as const;
export type TypeOrdreReparation = (typeof TYPES_ORDRE_REPARATION)[number];

/** `localisation_vehicule` — extensible. Où est physiquement le véhicule pendant l'OR. */
export const LOCALISATIONS_VEHICULE = [
  'parc',
  'atelier',
  'sous_traitant',
  'essai_routier',
  'lavage',
  'pret_au_retrait',
  'sorti_provisoirement',
  'restitue',
] as const;
export type LocalisationVehicule = (typeof LOCALISATIONS_VEHICULE)[number];

/** `motif_lien_or` — extensible. Lien entre deux OR (retouche : I-02 / `CREER_OR_RETOUCHE`). */
export const MOTIFS_LIEN_OR = ['retouche', 'suite'] as const;
export type MotifLienOr = (typeof MOTIFS_LIEN_OR)[number];

/**
 * Statut initial admis à la création d'un OR (§7.6). `planifie` n'est proposable que si
 * `parametresAtelier.or.etatPlanifieActif` (P-22).
 */
export const STATUTS_INITIAUX_ORDRE_REPARATION = ['planifie', 'ouvert'] as const;
export type StatutInitialOrdreReparation = (typeof STATUTS_INITIAUX_ORDRE_REPARATION)[number];

/**
 * Segments d'action de la machine à états de l'OR (§7.7), en **kebab-case** : ce sont les
 * segments d'URL eux-mêmes (`POST /ordres-reparation/{id}/passer-en-controle`), et c'est ce
 * vocabulaire exact que porte le champ dérivé `actionsDisponibles`.
 *
 * Verbes à l'INFINITIF, jamais de substantif (arbitrage D-a) : un segment verbe implique `POST`
 * seul, jamais de `GET`. `facturer` est volontairement ABSENT : le nom est réservé pour l'étape 2
 * mais la route n'est pas publiée — un connecteur ne doit pas pouvoir coder contre elle.
 *
 * Extensible. `actionsDisponibles` est calculé pour l'appelant courant (statut + droits +
 * paramètres) ; il ne remplace pas la vérification serveur, il évite au client de la rejouer.
 * Une action listée peut néanmoins être refusée — le refus porte alors `blocages` et
 * `actionsProposees` (les gardes coûteuses ne sont pas rejouées à chaque lecture d'OR).
 */
export const ACTIONS_ORDRE_REPARATION = [
  'receptionner',
  'demarrer',
  'reprendre-travaux',
  'passer-en-controle',
  'refuser-controle',
  'valider-controle',
  'terminer',
  'rouvrir',
  'restituer',
  'cloturer',
  'annuler',
  'valider-lignes',
  'refuser-lignes',
  'annuler-lignes',
  'soumettre-lignes-a-devis',
] as const;
export type ActionOrdreReparation = (typeof ACTIONS_ORDRE_REPARATION)[number];

/**
 * Vues d'exception de `GET /ordres-reparation?vue=` (§6.3). SUCRE, jamais une sémantique cachée :
 * chaque vue est EXACTEMENT équivalente à une combinaison de filtres primitifs documentés, qu'un
 * développeur tiers peut reproduire. Cumulable avec les filtres primitifs ; en cas de
 * contradiction, le filtre explicite l'emporte.
 *
 * `pointages_anormaux` n'est pas ici : elle porte sur `GET /pointages?anomalie=true`.
 */
export const VUES_ORDRE_REPARATION = [
  'en_cours',
  'attente_accord',
  'attente_pieces',
  'attente_externe',
  'prets_au_retrait',
  'restitution_aujourdhui',
] as const;
export type VueOrdreReparation = (typeof VUES_ORDRE_REPARATION)[number];

/* ------------------------------------------------------------------ */
/* Lignes d'OR                                                         */
/* ------------------------------------------------------------------ */

/** `type_ligne_or` — extensible (§11.2). */
export const TYPES_LIGNE_OR = [
  'main_oeuvre_bareme',
  'main_oeuvre_temps_reel',
  'forfait',
  'piece',
  'fourniture',
  'sous_traitance',
  'produit_atelier',
  'taxe',
  'remise',
  'texte',
] as const;
export type TypeLigneOr = (typeof TYPES_LIGNE_OR)[number];

/** `origine_ligne_or` — **GELÉ**. `constatee` = constat technicien, déclenche l'événement. */
export const ORIGINES_LIGNE_OR = [
  'commandee',
  'constatee',
  'campagne',
  'garantie',
  'retouche',
  'interne',
] as const;
export type OrigineLigneOr = (typeof ORIGINES_LIGNE_OR)[number];

/**
 * `statut_ligne_or` — **GELÉ**. `facturee` existe dès la v1, atteignable à l'étape 2.
 * `refusee` ne devient JAMAIS `realisee` (RM-72, CT-28 → `LIGNE_TRANSITION_INTERDITE`).
 * `annulee` reste VISIBLE : il n'existe aucun `DELETE` de ligne (RM-71, CT-27).
 */
export const STATUTS_LIGNE_OR = [
  'proposee',
  'a_valider',
  'validee',
  'en_cours',
  'realisee',
  'facturee',
  'refusee',
  'annulee',
] as const;
export type StatutLigneOr = (typeof STATUTS_LIGNE_OR)[number];

/** `payeur_ligne_or` — **GELÉ**. Les lignes `garage` sont valorisées à 0.00 (RM-70). */
export const PAYEURS_LIGNE_OR = ['client', 'constructeur', 'assurance', 'tiers', 'garage'] as const;
export type PayeurLigneOr = (typeof PAYEURS_LIGNE_OR)[number];

/** `blocage_ligne_or` — extensible. Ce qui remonte dans les drapeaux `attentes` de l'OR. */
export const BLOCAGES_LIGNE_OR = ['aucun', 'accord', 'pieces', 'externe'] as const;
export type BlocageLigneOr = (typeof BLOCAGES_LIGNE_OR)[number];

/* ------------------------------------------------------------------ */
/* Devis complémentaires                                               */
/* ------------------------------------------------------------------ */

/** `canal_devis` — extensible (§11.2). */
export const CANAUX_DEVIS = ['telephone', 'sms', 'email', 'comptoir', 'lien'] as const;
export type CanalDevis = (typeof CANAUX_DEVIS)[number];

/** `decision_devis` — extensible. `partiel` : chaque ligne prend sa propre décision (CT-33). */
export const DECISIONS_DEVIS = ['accepte', 'refuse', 'partiel'] as const;
export type DecisionDevis = (typeof DECISIONS_DEVIS)[number];

/* ------------------------------------------------------------------ */
/* Rendez-vous et planning — déclarés au lot 1, servis au lot 4        */
/* ------------------------------------------------------------------ */

/** `statut_rendez_vous` — **GELÉ**. */
export const STATUTS_RENDEZ_VOUS = [
  'demande',
  'planifie',
  'honore',
  'absent',
  'annule_client',
  'annule_garage',
  'reporte',
] as const;
export type StatutRendezVous = (typeof STATUTS_RENDEZ_VOUS)[number];

/** `mode_attente_rdv` — extensible. Le client attend-il sur place, dépose-t-il, etc. */
export const MODES_ATTENTE_RDV = [
  'attend_sur_place',
  'depose',
  'depose_la_veille',
  'navette',
  'prise_en_charge',
] as const;
export type ModeAttenteRdv = (typeof MODES_ATTENTE_RDV)[number];

/** `origine_rendez_vous` — extensible (§11.2). */
export const ORIGINES_RENDEZ_VOUS = [
  'telephone',
  'comptoir',
  'email',
  'formulaire_web',
  'importe',
  'rappel_automatique',
] as const;
export type OrigineRendezVous = (typeof ORIGINES_RENDEZ_VOUS)[number];

/** `type_ressource_planning` — extensible. */
export const TYPES_RESSOURCE_PLANNING = [
  'technicien',
  'poste_travail',
  'vehicule_courtoisie',
] as const;
export type TypeRessourcePlanning = (typeof TYPES_RESSOURCE_PLANNING)[number];

/* ------------------------------------------------------------------ */
/* Pointage — déclaré au lot 1, servi au lot 2                          */
/* ------------------------------------------------------------------ */

/**
 * `statut_pointage` — **GELÉ**. `en_cours` remplace un endpoint `/pointages/ouverts`
 * (arbitrage D-f : un filtre, pas une route).
 */
export const STATUTS_POINTAGE = ['en_cours', 'termine', 'valide', 'verrouille'] as const;
export type StatutPointage = (typeof STATUTS_POINTAGE)[number];

/** `source_pointage` — extensible. */
export const SOURCES_POINTAGE = ['ecran_atelier', 'badge', 'mobile', 'saisie'] as const;
export type SourcePointage = (typeof SOURCES_POINTAGE)[number];

/** `nature_activite_pointage` — extensible (§11.2). */
export const NATURES_ACTIVITE_POINTAGE = ['productif_ligne', 'productif_or', 'indirect'] as const;
export type NatureActivitePointage = (typeof NATURES_ACTIVITE_POINTAGE)[number];

/** `statut_periode_pointage` — extensible (RM-95). */
export const STATUTS_PERIODE_POINTAGE = ['ouverte', 'verrouillee'] as const;
export type StatutPeriodePointage = (typeof STATUTS_PERIODE_POINTAGE)[number];

/* ------------------------------------------------------------------ */
/* Véhicules de courtoisie — déclarés au lot 1, servis au lot 5        */
/* ------------------------------------------------------------------ */

/** `etat_vehicule_courtoisie` — extensible. */
export const ETATS_VEHICULE_COURTOISIE = [
  'disponible',
  'prete',
  'en_entretien',
  'hors_service',
] as const;
export type EtatVehiculeCourtoisie = (typeof ETATS_VEHICULE_COURTOISIE)[number];

/** `statut_pret_courtoisie` — extensible. */
export const STATUTS_PRET_COURTOISIE = [
  'reserve',
  'en_cours',
  'retourne',
  'cloture',
  'annule',
] as const;
export type StatutPretCourtoisie = (typeof STATUTS_PRET_COURTOISIE)[number];

/* ------------------------------------------------------------------ */
/* Audit et référentiels transverses                                   */
/* ------------------------------------------------------------------ */

/** `entite_auditee` — extensible. Filtre `entite` de `GET /ordres-reparation/{id}/journal`. */
export const ENTITES_AUDITEES = [
  'ordre_reparation',
  'ligne_or',
  'devis_complementaire',
  'pointage',
  'vehicule_detention',
  'vehicule_kilometrage',
  'client',
  'rendez_vous',
  'pret_courtoisie',
] as const;
export type EntiteAuditee = (typeof ENTITES_AUDITEES)[number];

/** `action_auditee` — extensible. Filtre `action` du journal. */
export const ACTIONS_AUDITEES = [
  'creation',
  'modification',
  'transition',
  'annulation',
  'fusion',
] as const;
export type ActionAuditee = (typeof ACTIONS_AUDITEES)[number];

/**
 * Entités dont `GET /referentiels/transitions?entite=` publie la machine à états (§2.2).
 * Rendre la machine à états LISIBLE est le corollaire obligatoire des actions nommées : sans
 * elle, chaque client la coderait en dur et se désynchroniserait au premier changement de
 * paramètre. Extensible.
 */
export const ENTITES_A_TRANSITIONS = [
  'ordre_reparation',
  'ligne_or',
  'rendez_vous',
  'pointage',
  'pret_courtoisie',
] as const;
export type EntiteATransitions = (typeof ENTITES_A_TRANSITIONS)[number];

/** Types de ressource renvoyés par `GET /recherche` (§7.5). Extensible. */
export const TYPES_RESULTAT_RECHERCHE = ['vehicule', 'client', 'ordre_reparation'] as const;
export type TypeResultatRecherche = (typeof TYPES_RESULTAT_RECHERCHE)[number];

/* ------------------------------------------------------------------ */
/* Paramètres d'atelier (§8.2) — valeurs des réglages P-xx             */
/* ------------------------------------------------------------------ */

/**
 * Les numéros `P-xx` de la spécification sont un ARTEFACT DE RÉDACTION : ils n'apparaissent
 * jamais dans un nom de champ ni dans une valeur. Un connecteur ne doit pas avoir à connaître
 * `P-19` pour lire un arrondi. La correspondance P-xx <-> champ est documentée en annexe de
 * l'OpenAPI. Tous ces enums sont extensibles.
 */

/** P-01 — portée de la numérotation des OR. */
export const PORTEES_NUMEROTATION = ['tenant', 'site'] as const;
export type PorteeNumerotation = (typeof PORTEES_NUMEROTATION)[number];

/** P-29 — deux OR ouverts sur le même véhicule. `avertir` -> confirmation `VEHICULE_DEUX_OR_OUVERTS`. */
export const POLITIQUES_DEUX_OR_MEME_VEHICULE = ['bloquer', 'avertir', 'autoriser'] as const;
export type PolitiqueDeuxOrMemeVehicule = (typeof POLITIQUES_DEUX_OR_MEME_VEHICULE)[number];

/** P-09 — signature client à la réception. */
export const POLITIQUES_SIGNATURE_RECEPTION = ['obligatoire', 'recommandee', 'desactivee'] as const;
export type PolitiqueSignatureReception = (typeof POLITIQUES_SIGNATURE_RECEPTION)[number];

/** P-03 — unité de temps de travail. */
export const UNITES_TEMPS = ['heures_decimales', 'unites_constructeur'] as const;
export type UniteTemps = (typeof UNITES_TEMPS)[number];

/** P-19 — arrondi du temps pointé : minute, 1/10 h, 1/4 h. */
export const ARRONDIS_POINTAGE = ['minute', 'dixieme', 'quart'] as const;
export type ArrondiPointage = (typeof ARRONDIS_POINTAGE)[number];

/** P-08 — contrôle qualité obligatoire. */
export const POLITIQUES_CONTROLE_QUALITE = [
  'jamais',
  'toujours',
  'selon_type',
  'au_dela_montant',
] as const;
export type PolitiqueControleQualite = (typeof POLITIQUES_CONTROLE_QUALITE)[number];

/** P-24 — démontage après refus de devis : facturer / offrir / facturer au-delà d'un seuil. */
export const POLITIQUES_DEMONTAGE_REFUSE = ['facturer', 'offrir', 'au_dela_seuil'] as const;
export type PolitiqueDemontageRefuse = (typeof POLITIQUES_DEMONTAGE_REFUSE)[number];

/** P-04 — mode de calcul des produits d'atelier. */
export const MODES_PRODUITS_ATELIER = [
  'pourcentage_plafonne',
  'forfait',
  'lignes_reelles',
  'desactive',
] as const;
export type ModeProduitsAtelier = (typeof MODES_PRODUITS_ATELIER)[number];

/** P-23 — langue des documents imprimés : celle du client ou celle du site. */
export const POLITIQUES_LANGUE_DOCUMENT = ['client', 'site'] as const;
export type PolitiqueLangueDocument = (typeof POLITIQUES_LANGUE_DOCUMENT)[number];

/**
 * P-28 — mention de restitution sous réserve pour un défaut de sécurité refusé.
 * INTERPRÉTÉ : la spécification ne donne que la valeur par défaut (« obligatoire ») sans
 * énumérer les autres. Modélisé en binaire, faute de source. À confirmer avec expert-metier
 * avant le lot 2 ; l'ajout d'une troisième valeur resterait additif (enum extensible).
 */
export const POLITIQUES_MENTION_SECURITE = ['obligatoire', 'desactivee'] as const;
export type PolitiqueMentionSecurite = (typeof POLITIQUES_MENTION_SECURITE)[number];

/** P-25 — ce qu'un nouveau détenteur voit de l'historique du véhicule. */
export const VISIBILITES_HISTORIQUE_VEHICULE = ['tout', 'technique', 'rien'] as const;
export type VisibiliteHistoriqueVehicule = (typeof VISIBILITES_HISTORIQUE_VEHICULE)[number];

/** P-16 — canal de rappel de rendez-vous. */
export const CANAUX_RAPPEL = ['sms', 'email', 'aucun'] as const;
export type CanalRappel = (typeof CANAUX_RAPPEL)[number];
