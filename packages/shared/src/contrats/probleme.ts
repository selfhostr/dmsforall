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
  // Droit à l'effacement nLPD (migration 0061) : geste irréversible, un seul par client.
  'CLIENT_DEJA_ANONYMISE',
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
  // --- Étape 2 : chaîne documentaire (devis → bon de commande → facture → avoir) ---
  // `document_verrouille` est le code STABLE cité verbatim par la spécification métier
  // (docs/specification-etape-2-facturation.md, RF-11, CF-16) : un UPDATE sur un document émis
  // — y compris un caractère d'adresse, y compris à la seconde qui suit l'émission — est refusé
  // sans exception (MD-20, MD-21). Nom conservé au plus près du texte source.
  'DOCUMENT_VERROUILLE',
  // Transition hors de `transition_document_autorisee` (MD-17) — même patron qu'OR_TRANSITION_INTERDITE.
  'DOCUMENT_TRANSITION_INTERDITE',
  // RF-8 : un devis accepté donne un bon de commande OU une facture, jamais les deux.
  'DOCUMENT_SOURCE_DEJA_TRANSFORME',
  // MD-34 : aucune émission dans une période comptable close.
  'DOCUMENT_PERIODE_CLOSE',
  // MD-29 : le PDF est généré après le COMMIT (job asynchrone) ; un duplicata ou un envoi demandé
  // avant la fin du job reçoit ce code plutôt qu'un 404 trompeur.
  'DOCUMENT_PDF_INDISPONIBLE',
  // --- Étape 2 : facturation d'un OR ---
  // RF-85, RF-86 : émission refusée tant qu'une ligne d'OR est dans un état indécis
  // (proposee | a_valider | validee | en_cours) — `blocages` liste les lignes concernées.
  'FACTURATION_LIGNES_INDECISES',
  // --- Étape 2 : QR-facture ---
  // RF-54, PF-03 : le bloc créancier du tenant est incomplet, l'émission est refusée en nommant
  // le champ manquant plutôt que de laisser partir une facture sans section paiement.
  'QR_CREANCIER_INCOMPLET',
  // --- Étape 2 : avoir ---
  // MD-23 : Σ avoirs sur une facture, par taux de TVA, ne peut jamais dépasser son total en
  // valeur absolue — protège aussi contre un second avoir sur une ligne déjà créditée (CF-25).
  'AVOIR_MONTANT_EXCEDENTAIRE',
  // RF-117 : émission d'avoir par un réceptionnaire plafonnée en montant ; au-delà, la direction
  // ou le comptable prend le relais.
  'AVOIR_PLAFOND_DEPASSE',
  // --- Étape 2 : remises ---
  // RF-118, MD-61 : plafond de remise par rôle contrôlé À L'ÉMISSION sur le montant effectivement
  // remisé (ligne + part de remise globale), jamais à la saisie du brouillon.
  'REMISE_PLAFOND_DEPASSE',
  // --- Étape 2 : paiements et imputations ---
  // MD-51 (a) et (b) : Σ imputations d'un document ≤ son total, et Σ imputations 'reglement'
  // d'un paiement ≤ son montant. Un seul code pour les deux faces du même invariant.
  'IMPUTATION_MONTANT_EXCEDENTAIRE',
  // MD-56 : un acompte facturé ne peut être déduit qu'une fois, sur une seule facture finale.
  'ACOMPTE_DEJA_DEDUIT',
  // --- Étape 2 : export fiduciaire (déclarés par avance, même patron que RDV_*/POINTAGE_* au
  // lot 1 — émis par le module d'export dont le contrat HTTP complet reste à concevoir) ---
  // RF-28, RF-105 : la continuité de numérotation est vérifiée de façon BLOQUANTE avant tout
  // export ; un trou détecté ne part jamais chez la fiduciaire.
  'EXPORT_TROU_NUMEROTATION',
  // RF-104, MD-85 : une écriture déséquilibrée fait échouer le lot entier — on ne transmet jamais
  // un journal partiellement faux.
  'EXPORT_ECRITURES_DESEQUILIBREES',
  // RF-112, MD-86 : le mapping comptable (compte ou code TVA) est incomplet pour la cible et la
  // période demandées — nomme ce qui manque, à remplir avec la fiduciaire.
  'EXPORT_MAPPING_INCOMPLET',
  // RF-109, MD-92 : un document déjà exporté ne repart pas dans un autre lot sans une action
  // d'exploitation explicite et tracée — évite le double comptage découvert au bouclement.
  'EXPORT_DEJA_TRANSMIS',
  // L'adaptateur WinBIZ refuse une écriture qu'il ne sait pas sérialiser fidèlement (compte trop
  // long, date ou montant invalide, écriture non décomposable…) : 422, le `detail` dit laquelle.
  'EXPORT_WINBIZ_INVALIDE',
  // RF-112, RF-113 : changement de cible, de granularité ou de mapping refusé hors d'une
  // frontière de période comptable — jamais en cours de mois.
  'BASCULE_FIDUCIAIRE_HORS_FRONTIERE',
  // --- Étape 3 : pièces — référentiel article (docs/specification-etape-3-pieces.md, RP-xx) ---
  // RP-02, RP-03 : une référence (principale ou alternative) déjà portée par un AUTRE article —
  // jamais un doublon d'article créé par référence.
  'ARTICLE_REFERENCE_COLLISION',
  // RP-04 : marquage obsolète sans `referenceRemplacementId` alors qu'une référence
  // `remplace_par` est déjà connue pour cet article — contrôle d'état, pas de format (400, même
  // famille que POINTAGE_MOTIF_REQUIS/PRET_CONDUCTEUR_REQUIS).
  'ARTICLE_REMPLACANT_REQUIS',
  // RP-07, §6.1 : désactivation refusée tant qu'une réservation `active` porte sur l'article.
  'ARTICLE_DESACTIVATION_IMPOSSIBLE',
  // --- Étape 3 : pièces — stock et mouvements ---
  // RP-15 : une sortie (casse, perte, transfert, ajustement à la baisse) dépasserait le stock
  // disponible ; le forçage explicite reste un point de droit non tranché (voir le rapport
  // d'accompagnement du lot l'équipe API sur `PP-02`).
  'STOCK_INSUFFISANT',
  // RP-17 : motif obligatoire pour `casse`/`perte`/`ajustement_inventaire` — conditionnel au
  // type de mouvement, donc un code dédié plutôt qu'une contrainte `min()` uniforme sur `motif`.
  'MOUVEMENT_MOTIF_REQUIS',
  // --- Étape 3 : pièces — réservation (RP-19 → RP-25, le cœur du sujet) ---
  // Transition hors machine (`satisfaire`/`liberer` sur une réservation qui n'est plus `active`)
  // — même patron que LIGNE_TRANSITION_INTERDITE/DOCUMENT_TRANSITION_INTERDITE.
  'RESERVATION_TRANSITION_INTERDITE',
  // RP-22 : une réservation ne se satisfait que sur le site de l'OR, ou après transfert tracé.
  'RESERVATION_SITE_INCOHERENT',
  // --- Étape 3 : pièces — commande fournisseur (RP-26 → RP-31, §6.2) ---
  'COMMANDE_FOURNISSEUR_TRANSITION_INTERDITE',
  // RP-28 : annulation d'un reliquat déjà soldé (livré en totalité OU déjà annulé).
  'COMMANDE_FOURNISSEUR_RELIQUAT_DEJA_SOLDE',
  // §7.4 : réception déclarant une référence différente de celle commandée sans que ce soit une
  // référence `equivalente` connue de l'article commandé — refuse de forcer une correspondance
  // fausse plutôt que d'accepter silencieusement.
  'RECEPTION_REFERENCE_NON_EQUIVALENTE',
  // --- Étape 3 : pièces — consigne d'échange standard (RP-37 → RP-42, §6.4) ---
  'CONSIGNE_TRANSITION_INTERDITE',
  // --- Étape 1 (lot 2) : pointage — identification par code PIN, RM-113 → RM-115 ---
  // `docs/specification-pointage.md` : le PIN attribue un pointage à un technicien, il n'ouvre
  // aucune session et ne protège aucun droit — voir `contrats/pointage/identification.ts` pour la
  // justification complète, y compris pourquoi ce n'est délibérément PAS un code `AUTH_*` malgré
  // un statut HTTP partagé (401 / 423).
  'POINTAGE_PIN_INVALIDE',
  // RM-114 : ralentissement anti-brute-force sur un espace de PIN volontairement petit. Nombre
  // d'essais et durée de blocage restent des paramètres de sécurité, non fixés par ce code.
  'POINTAGE_PIN_VERROUILLE',
  'POINTAGE_SITE_AUTRE',
  // --- Étape 4 : ventes (VN/VO et reprises) ---
  'VENTE_VEHICULE_STOCK_DEJA_EXISTANT',
  'VENTE_DOSSIER_TRANSITION_INTERDITE',
  'VENTE_REPRISE_TRANSITION_INTERDITE',
  'VENTE_FINANCEMENT_TRANSITION_INTERDITE',
  'VENTE_VEHICULE_INDISPONIBLE',
  'VENTE_VEHICULE_MANQUANT',
  'VENTE_FINANCEMENT_NON_CONFIRME',
  'VENTE_LIVRAISON_EXPERTISE_REQUISE',
  // RV-37 : la livraison exige que la FACTURE DE VENTE soit déjà émise (le véhicule passe
  // `reserve -> vendu` comme effet de bord de l'émission). Code DÉDIÉ, ajouté après constat en
  // navigateur : `livrer()` refusait ce cas sous `VENTE_VEHICULE_INDISPONIBLE`, partagé avec
  // `engager()` (« un autre dossier a réservé le véhicule entre-temps »). Or le front ne rend
  // JAMAIS `ProblemeDetail.detail` — `messageErreur`/`RefusBloquant` (apps/web/src/api/erreurs.ts,
  // composants/motifs/RefusBloquant.tsx) affichent uniquement `erreurs:codes.<CODE>`. Un code
  // partagé par deux causes ne peut donc produire qu'un message vague (« Ce véhicule n'est pas
  // disponible actuellement ») qui ne dit pas le geste attendu. Séparer le code est le SEUL moyen
  // de dire « émettez d'abord la facture ». Frère exact de `VENTE_LIVRAISON_EXPERTISE_REQUISE`,
  // même forme de nom, même statut 409.
  'VENTE_LIVRAISON_FACTURE_REQUISE',
  'VENTE_LIVRAISON_INCOMPLETE',
  'VENTE_DOSSIER_ANNULATION_IMPOSSIBLE',
  'VENTE_REPRISE_VALEUR_NEGOCIEE_REQUISE',
  'VENTE_REPRISE_DEJA_EXISTANTE',
  // --- Accroche facturation ↔ ventes (RV-37, MD-70) : émis par `facturation/documents/` à la
  // création d'un document rattaché à un dossier de vente (`document_vente.dossier_vente_id`),
  // jamais par `ventes/`. Distinct de `VENTE_DOSSIER_TRANSITION_INTERDITE` : on ne transitionne
  // pas le dossier ici, on refuse d'y ATTACHER un nouveau document tant qu'il est dans un état
  // fermé (`clos`/`annule`/`abandonne`).
  'DOCUMENT_DOSSIER_VENTE_RATTACHEMENT_REFUSE',
  // Recette #64 : bon de commande/facture créé sans ligne depuis un dossier dont le véhicule est
  // absent ou sans prix de vente — 422, jamais un document à 0.00.
  'DOCUMENT_DOSSIER_VENTE_PRIX_REQUIS',
  // --- Étape 5 : connecteurs (déclarés, émis après étape 4) ---
  'CONNECTEUR_TYPE_INDISPONIBLE',
  'CONNECTEUR_IDENTIFIANTS_MANQUANTS',
  'CONNECTEUR_ACTIVATION_TRANSITION_INTERDITE',
  'CONNECTEUR_EXECUTION_TRANSITION_INTERDITE',
  'ABONNEMENT_WEBHOOK_TRANSITION_INTERDITE',
  // --- Pont pièces ↔ facturation (RP-43/RP-46, vente comptoir) ---
  // Une ligne de document de vente (`type = 'piece'`) qui a déclenché un mouvement de stock
  // (`mouvement_stock.document_vente_ligne_id`) devient IMMUABLE au même titre qu'une ligne
  // recopiée depuis un OR — RP-18 (le mouvement lui-même est immuable) se propage à la ligne qui
  // l'a fait naître : la modifier ou la supprimer désynchroniserait la quantité facturée de la
  // quantité réellement sortie du stock. `service-documents.ts::modifierLigne`/`supprimerLigne`.
  'LIGNE_DOCUMENT_STOCK_LIEE',
  // --- Étape 2 : paiements et imputations — correctif devise (défaut latent signalé par un lot
  // front, 2026-08-05) : un `paiement` porte UNE SEULE devise (MD-50, `DEVISES_FACTURATION`),
  // vérifiée par l'appelant plutôt que devinée par le serveur — voir
  // `apps/api/src/facturation/paiements/imputations.ts`. Imputer (ou compenser une avance) sur un
  // `document_vente` dont la devise diffère de celle du paiement écrirait un montant dans la
  // mauvaise devise avec la même valeur numérique (ex. un règlement CHF sur une facture EUR) —
  // une erreur comptable silencieuse jusqu'ici possible faute de contrôle. Refusé explicitement,
  // jamais laissé passer ni corrigé en silence en réécrivant une devise à la place de l'appelant.
  'IMPUTATION_DEVISE_INCOHERENTE',
  // --- Étape 2 : paiements et imputations — correctif « facture soldée par avoir encore
  // encaissable » (parcours navigateur prouvé jusqu'en base, 2026-08-10) : ni le trigger
  // `imputation_paiement_verifier_invariants` (MD-51, il ne vérifie QUE des montants) ni
  // `statut_reglement` (RF-68 : colonne délibérément INDÉPENDANTE de `statut`, jamais fusionnée —
  // voir `STATUTS_REGLEMENT_DOCUMENT` ci-dessus) ne s'opposaient à une imputation sur un document
  // dont le `statut` ne permet plus de règlement (typiquement `annule_par_avoir`, RF-32 : la
  // facture créditée garde un `solde_centimes`/`statut_reglement` d'AVANT son annulation, ni l'un
  // ni l'autre n'étant nettoyé). Même doctrine que `relances/regles-planification.ts::
  // factureEligibleRelance` et `facturation/documents/echeance.ts::calculerRetardDocument` : c'est
  // au CONSOMMATEUR de recombiner `statut` et `statut_reglement`, jamais à `statut_reglement` de
  // porter l'information d'annulation.
  'IMPUTATION_DOCUMENT_NON_REGLABLE',
  // --- Cycle de vie de sortie du garage (offboarding tenant, 20.08.2026, migration 0062) ---
  // Dossier de résiliation absent pour ce tenant (ex. tentative de consulter un statut d'export
  // avant toute demande de résiliation).
  'RESILIATION_TENANT_INTROUVABLE',
  // Miroir applicatif du SQLSTATE ZDFA1 posé par le trigger
  // `verifier_transition_resiliation_tenant()` (0062) — machine à états LOCALE à cette migration,
  // pas le dispositif partagé `transition_autorisee` (voir son en-tête, §A, pour pourquoi).
  'RESILIATION_TENANT_TRANSITION_INTERDITE',
  // Au plus UN dossier de résiliation par tenant (contrainte `resiliation_tenant_tenant_uk`,
  // 0062) : une seconde demande sur un tenant déjà engagé dans le cycle est un conflit, jamais un
  // second dossier silencieusement créé.
  'RESILIATION_TENANT_DEJA_EN_COURS',
  // L'export n'est pas encore au statut `export_pret`/`export_remis` — rien à remettre ou à
  // télécharger pour l'instant.
  'RESILIATION_TENANT_EXPORT_INDISPONIBLE',
  // `purger_donnees_tenant` (0062) a refusé : statut différent de `en_conservation`, ou
  // `purge_prevue_le` pas encore atteinte. Miroir applicatif de son SQLSTATE ZDFA1.
  'RESILIATION_TENANT_PURGE_PREMATUREE',
  // La re-saisie de confirmation (raison sociale du tenant) ne correspond pas — geste PAS assez
  // sans ambiguïté pour déclencher un export intégral de toute la base du garage (arbitrage
  // 20.08.2026, sur le modèle de `docker/backup/restaurer.sh`).
  'RESILIATION_TENANT_CONFIRMATION_INVALIDE',
  // --- Reprise de données par dépôt d'archive (contrats/reprise.ts, migration 0067) ---
  // Même patron qu'OR_TRANSITION_INTERDITE : transition hors de la machine à états gelée
  // (STATUTS_DOSSIER_REPRISE, commentaire de tête de contrats/reprise.ts).
  'REPRISE_DOSSIER_TRANSITION_INTERDITE',
  // `POST .../finaliser` appelé avant réception de toutes les tranches déclarées
  // (octetsRecus < tailleOctetsAnnoncee) — le dossier reste depot_en_cours.
  'REPRISE_ARCHIVE_INCOMPLETE',
  // L'empreinte SHA-256 assemblée par le serveur ne correspond pas à celle annoncée à
  // POST /reprise/dossiers — archive corrompue en transit, redépôt requis.
  'REPRISE_EMPREINTE_INVALIDE',
  // Numéro de tranche hors des bornes déclarées par schemaNumeroTranche.
  'REPRISE_TRANCHE_HORS_SEQUENCE',
  // Validation tentée hors de l'état `propose` du plan (immuable dès `valide`).
  'REPRISE_PLAN_NON_VALIDABLE',
  // `elementId` d'un ajustement (PATCH .../plan) absent du plan courant.
  'REPRISE_AJUSTEMENT_ELEMENT_INCONNU',
  // --- Réinitialisation de mot de passe en libre-service (auth/, task « socle sécurité ») ---
  // Un seul code, pour TOUTE issue négative de POST /auth/mot-de-passe/reinitialisation : email
  // inconnu, jeton inconnu/expiré/déjà utilisé, ou compte/tenant non actif — jamais distingué
  // (anti-énumération, même doctrine qu'AUTH_IDENTIFIANTS_INVALIDES). Un code AUTH_* dédié plutôt
  // que la réutilisation d'AUTH_IDENTIFIANTS_INVALIDES : le front a besoin d'un message distinct
  // (« ce lien n'est plus valide, redemandez-en un ») de celui d'un mauvais mot de passe de
  // connexion, malgré le même statut 400.
  'AUTH_JETON_REINITIALISATION_INVALIDE',
  // --- Envoi de facture par courriel (POST /documents-vente/{id}/envoyer-courriel) ---
  // Le client n'a aucune adresse courriel enregistrée (`client.email` NULL) — l'action ne peut
  // structurellement pas aboutir, message clair plutôt qu'un envoi silencieux sans destinataire.
  'FACTURE_DESTINATAIRE_COURRIEL_ABSENT',
  // --- Assujettissement à la TVA (tenant.assujetti_tva, migration 0090) ---
  // Garage NON assujetti : une ligne porte un taux de TVA > 0 à l'émission (art. 27 LTVA : un
  // non-assujetti qui facture de la TVA la doit). `erreurs[]` nomme les lignes.
  'TVA_NON_ASSUJETTI_TAUX_INTERDIT',
  // Garage assujetti : son n° TVA n'est pas saisi, une facture ne peut pas être émise
  // (art. 26 LTVA). Se règle dans Réglages > Mon garage.
  'TVA_NUMERO_REQUIS',
  // --- Correction de facture en brouillon (POST /documents-vente/{id}/corriger, mode 'brouillon') ---
  // La facture a déjà été annulée par un avoir (donc déjà corrigée ou créditée) : `blocages[]`
  // pointe le brouillon/la facture de remplacement quand il existe.
  'FACTURE_DEJA_CORRIGEE',
  // La facture porte déjà un règlement (partiel ou total) : refaire un brouillon libre détacherait
  // l'encaissement de sa facture. À traiter d'abord (annuler/rembourser le paiement).
  'FACTURE_CORRECTION_REGLEMENT_EXISTANT',
  // --- Modules activables (migration 0092) : écriture sur un module que le garage a retiré ---
  'MODULE_DESACTIVE',
  // --- Envoi des e-mails du garage (migration 0098) ---
  'COURRIEL_NON_CONFIGURE',
  'COURRIEL_CLE_CHIFFREMENT_ABSENTE',
  'COURRIEL_AUTHENTIFICATION_ECHEC',
  'COURRIEL_CONNEXION_ECHEC',
  'COURRIEL_TLS_ECHEC',
  'COURRIEL_ENVOI_ECHEC',
  // --- Changement de mot de passe obligatoire (issue #58) ---
  // Mot de passe temporaire jamais remplacé : toute route métier est refusée (403) jusqu'au
  // changement via POST /auth/mot-de-passe/changement.
  'AUTH_CHANGEMENT_MOT_DE_PASSE_REQUIS',
  // --- Scan de permis (issue #64) : le service de lecture (OCR) ne répond pas — 503, ce n'est pas
  // une panne de l'application ; le front propose la saisie manuelle. ---
  'SERVICE_LECTURE_INDISPONIBLE',
  // --- Installation d'une instance neuve : création du premier garage depuis le navigateur ---
  // Code d'installation absent, faux ou périmé (403) ; un garage existe déjà (409).
  'INSTALLATION_CODE_INVALIDE',
  'INSTALLATION_DEJA_FAITE',
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
  CLIENT_DEJA_ANONYMISE: 409,
  PRET_VEHICULE_INDISPONIBLE: 409,
  PRET_CONDUCTEUR_REQUIS: 400,
  CONFIRMATION_REQUISE: 409,
  IDEMPOTENCE_CONFLIT: 409,
  FONCTION_NON_DISPONIBLE: 501,
  RECHERCHE_TROP_DE_REQUETES: 429,
  METHODE_NON_AUTORISEE: 405,
  DOCUMENT_VERROUILLE: 409,
  DOCUMENT_TRANSITION_INTERDITE: 409,
  DOCUMENT_SOURCE_DEJA_TRANSFORME: 409,
  DOCUMENT_PERIODE_CLOSE: 409,
  DOCUMENT_PDF_INDISPONIBLE: 409,
  FACTURATION_LIGNES_INDECISES: 409,
  QR_CREANCIER_INCOMPLET: 409,
  AVOIR_MONTANT_EXCEDENTAIRE: 409,
  AVOIR_PLAFOND_DEPASSE: 409,
  REMISE_PLAFOND_DEPASSE: 409,
  IMPUTATION_MONTANT_EXCEDENTAIRE: 409,
  ACOMPTE_DEJA_DEDUIT: 409,
  EXPORT_TROU_NUMEROTATION: 409,
  EXPORT_ECRITURES_DESEQUILIBREES: 409,
  EXPORT_MAPPING_INCOMPLET: 409,
  EXPORT_DEJA_TRANSMIS: 409,
  EXPORT_WINBIZ_INVALIDE: 422,
  BASCULE_FIDUCIAIRE_HORS_FRONTIERE: 409,
  ARTICLE_REFERENCE_COLLISION: 409,
  ARTICLE_REMPLACANT_REQUIS: 400,
  ARTICLE_DESACTIVATION_IMPOSSIBLE: 409,
  STOCK_INSUFFISANT: 409,
  MOUVEMENT_MOTIF_REQUIS: 400,
  RESERVATION_TRANSITION_INTERDITE: 409,
  RESERVATION_SITE_INCOHERENT: 409,
  COMMANDE_FOURNISSEUR_TRANSITION_INTERDITE: 409,
  COMMANDE_FOURNISSEUR_RELIQUAT_DEJA_SOLDE: 409,
  RECEPTION_REFERENCE_NON_EQUIVALENTE: 409,
  CONSIGNE_TRANSITION_INTERDITE: 409,
  POINTAGE_PIN_INVALIDE: 401,
  POINTAGE_PIN_VERROUILLE: 423,
  POINTAGE_SITE_AUTRE: 403,
  VENTE_VEHICULE_STOCK_DEJA_EXISTANT: 409,
  VENTE_DOSSIER_TRANSITION_INTERDITE: 409,
  VENTE_REPRISE_TRANSITION_INTERDITE: 409,
  VENTE_FINANCEMENT_TRANSITION_INTERDITE: 409,
  VENTE_VEHICULE_INDISPONIBLE: 409,
  VENTE_VEHICULE_MANQUANT: 409,
  VENTE_FINANCEMENT_NON_CONFIRME: 409,
  VENTE_LIVRAISON_EXPERTISE_REQUISE: 409,
  VENTE_LIVRAISON_FACTURE_REQUISE: 409,
  VENTE_LIVRAISON_INCOMPLETE: 409,
  VENTE_DOSSIER_ANNULATION_IMPOSSIBLE: 409,
  VENTE_REPRISE_VALEUR_NEGOCIEE_REQUISE: 409,
  VENTE_REPRISE_DEJA_EXISTANTE: 409,
  DOCUMENT_DOSSIER_VENTE_RATTACHEMENT_REFUSE: 409,
  DOCUMENT_DOSSIER_VENTE_PRIX_REQUIS: 422,
  CONNECTEUR_TYPE_INDISPONIBLE: 409,
  CONNECTEUR_IDENTIFIANTS_MANQUANTS: 409,
  CONNECTEUR_ACTIVATION_TRANSITION_INTERDITE: 409,
  CONNECTEUR_EXECUTION_TRANSITION_INTERDITE: 409,
  ABONNEMENT_WEBHOOK_TRANSITION_INTERDITE: 409,
  LIGNE_DOCUMENT_STOCK_LIEE: 409,
  IMPUTATION_DEVISE_INCOHERENTE: 409,
  IMPUTATION_DOCUMENT_NON_REGLABLE: 409,
  RESILIATION_TENANT_INTROUVABLE: 404,
  RESILIATION_TENANT_TRANSITION_INTERDITE: 409,
  RESILIATION_TENANT_DEJA_EN_COURS: 409,
  RESILIATION_TENANT_EXPORT_INDISPONIBLE: 409,
  RESILIATION_TENANT_PURGE_PREMATUREE: 409,
  RESILIATION_TENANT_CONFIRMATION_INVALIDE: 400,
  REPRISE_DOSSIER_TRANSITION_INTERDITE: 409,
  REPRISE_ARCHIVE_INCOMPLETE: 409,
  REPRISE_EMPREINTE_INVALIDE: 409,
  REPRISE_TRANCHE_HORS_SEQUENCE: 400,
  REPRISE_PLAN_NON_VALIDABLE: 409,
  REPRISE_AJUSTEMENT_ELEMENT_INCONNU: 400,
  AUTH_JETON_REINITIALISATION_INVALIDE: 400,
  AUTH_CHANGEMENT_MOT_DE_PASSE_REQUIS: 403,
  FACTURE_DESTINATAIRE_COURRIEL_ABSENT: 409,
  TVA_NON_ASSUJETTI_TAUX_INTERDIT: 409,
  TVA_NUMERO_REQUIS: 409,
  FACTURE_DEJA_CORRIGEE: 409,
  FACTURE_CORRECTION_REGLEMENT_EXISTANT: 409,
  MODULE_DESACTIVE: 403,
  COURRIEL_NON_CONFIGURE: 409,
  COURRIEL_CLE_CHIFFREMENT_ABSENTE: 409,
  COURRIEL_AUTHENTIFICATION_ECHEC: 422,
  COURRIEL_CONNEXION_ECHEC: 422,
  COURRIEL_TLS_ECHEC: 422,
  COURRIEL_ENVOI_ECHEC: 422,
  SERVICE_LECTURE_INDISPONIBLE: 503,
  INSTALLATION_CODE_INVALIDE: 403,
  INSTALLATION_DEJA_FAITE: 409,
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
  OR_ANNULATION_IMPOSSIBLE: 'Annulation impossible pour cet ordre de réparation',
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
  POINTAGE_OR_NON_MODIFIABLE: 'Ordre de réparation non pointable',
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
  CLIENT_DEJA_ANONYMISE: 'Client déjà anonymisé',
  PRET_VEHICULE_INDISPONIBLE: 'Véhicule de prêt indisponible',
  PRET_CONDUCTEUR_REQUIS: 'Conducteur requis',
  CONFIRMATION_REQUISE: 'Confirmation requise',
  IDEMPOTENCE_CONFLIT: "Conflit de clé d'idempotence",
  FONCTION_NON_DISPONIBLE: 'Fonctionnalité non disponible',
  RECHERCHE_TROP_DE_REQUETES: 'Trop de requêtes de recherche',
  METHODE_NON_AUTORISEE: 'Méthode HTTP non supportée',
  DOCUMENT_VERROUILLE: 'Document verrouillé',
  DOCUMENT_TRANSITION_INTERDITE: 'Transition interdite pour ce document',
  DOCUMENT_SOURCE_DEJA_TRANSFORME: 'Document source déjà transformé',
  DOCUMENT_PERIODE_CLOSE: 'Période comptable close',
  DOCUMENT_PDF_INDISPONIBLE: 'Document PDF pas encore disponible',
  FACTURATION_LIGNES_INDECISES: 'Des lignes attendent encore une décision avant facturation',
  QR_CREANCIER_INCOMPLET: 'Bloc créancier QR incomplet',
  AVOIR_MONTANT_EXCEDENTAIRE: "Montant d'avoir excédentaire",
  AVOIR_PLAFOND_DEPASSE: "Plafond d'avoir dépassé pour ce rôle",
  REMISE_PLAFOND_DEPASSE: 'Plafond de remise dépassé pour ce rôle',
  IMPUTATION_MONTANT_EXCEDENTAIRE: "Montant d'imputation excédentaire",
  ACOMPTE_DEJA_DEDUIT: 'Acompte déjà déduit',
  EXPORT_TROU_NUMEROTATION: 'Trou de numérotation détecté avant export',
  EXPORT_ECRITURES_DESEQUILIBREES: 'Écritures comptables déséquilibrées',
  EXPORT_MAPPING_INCOMPLET: 'Mapping comptable incomplet',
  EXPORT_DEJA_TRANSMIS: 'Document déjà transmis à la fiduciaire',
  EXPORT_WINBIZ_INVALIDE: 'Écriture refusée par le format WinBIZ',
  BASCULE_FIDUCIAIRE_HORS_FRONTIERE: 'Bascule de fiduciaire hors frontière de période',
  ARTICLE_REFERENCE_COLLISION: 'Référence déjà portée par un autre article',
  ARTICLE_REMPLACANT_REQUIS: 'Référence de remplacement requise',
  ARTICLE_DESACTIVATION_IMPOSSIBLE: "Désactivation d'article impossible",
  STOCK_INSUFFISANT: 'Stock disponible insuffisant',
  MOUVEMENT_MOTIF_REQUIS: 'Motif de mouvement requis',
  RESERVATION_TRANSITION_INTERDITE: 'Transition interdite pour cette réservation',
  RESERVATION_SITE_INCOHERENT: 'Réservation incohérente avec le site',
  COMMANDE_FOURNISSEUR_TRANSITION_INTERDITE: 'Transition interdite pour cette commande fournisseur',
  COMMANDE_FOURNISSEUR_RELIQUAT_DEJA_SOLDE: 'Reliquat déjà soldé',
  RECEPTION_REFERENCE_NON_EQUIVALENTE: 'Référence reçue non reconnue comme équivalente',
  CONSIGNE_TRANSITION_INTERDITE: 'Transition interdite pour cette consigne',
  POINTAGE_PIN_INVALIDE: 'Code PIN non reconnu',
  POINTAGE_PIN_VERROUILLE: 'Sélecteur de code PIN temporairement verrouillé',
  POINTAGE_SITE_AUTRE: 'Pointage depuis la borne d’un autre site',
  VENTE_VEHICULE_STOCK_DEJA_EXISTANT: 'Véhicule déjà au stock',
  VENTE_DOSSIER_TRANSITION_INTERDITE: 'Transition interdite pour ce dossier de vente',
  VENTE_REPRISE_TRANSITION_INTERDITE: 'Transition interdite pour cette reprise',
  VENTE_FINANCEMENT_TRANSITION_INTERDITE: 'Transition interdite pour ce financement',
  VENTE_VEHICULE_INDISPONIBLE: 'Véhicule indisponible',
  VENTE_VEHICULE_MANQUANT: 'Véhicule introuvable',
  VENTE_FINANCEMENT_NON_CONFIRME: 'Financement non confirmé',
  VENTE_LIVRAISON_EXPERTISE_REQUISE: 'Expertise requise avant livraison',
  VENTE_LIVRAISON_FACTURE_REQUISE: 'Facture requise avant livraison',
  VENTE_LIVRAISON_INCOMPLETE: 'Livraison incomplète',
  VENTE_DOSSIER_ANNULATION_IMPOSSIBLE: 'Annulation impossible pour ce dossier de vente',
  VENTE_REPRISE_VALEUR_NEGOCIEE_REQUISE: 'Valeur de reprise requise',
  VENTE_REPRISE_DEJA_EXISTANTE: 'Reprise déjà existante',
  DOCUMENT_DOSSIER_VENTE_RATTACHEMENT_REFUSE: 'Rattachement au dossier de vente refusé',
  DOCUMENT_DOSSIER_VENTE_PRIX_REQUIS: 'Prix du véhicule requis',
  CONNECTEUR_TYPE_INDISPONIBLE: 'Type de connecteur indisponible',
  CONNECTEUR_IDENTIFIANTS_MANQUANTS: 'Identifiants du connecteur manquants',
  CONNECTEUR_ACTIVATION_TRANSITION_INTERDITE: 'Activation du connecteur impossible',
  CONNECTEUR_EXECUTION_TRANSITION_INTERDITE: 'Utilisation du connecteur impossible',
  ABONNEMENT_WEBHOOK_TRANSITION_INTERDITE: 'Transition interdite pour cet abonnement webhook',
  LIGNE_DOCUMENT_STOCK_LIEE: 'Ligne liée à un mouvement de stock, immuable',
  IMPUTATION_DEVISE_INCOHERENTE: 'Devise incohérente entre le paiement et le document',
  IMPUTATION_DOCUMENT_NON_REGLABLE: 'Document non réglable',
  RESILIATION_TENANT_INTROUVABLE: 'Dossier de résiliation introuvable',
  RESILIATION_TENANT_TRANSITION_INTERDITE: 'Transition interdite pour ce dossier de résiliation',
  RESILIATION_TENANT_DEJA_EN_COURS: 'Résiliation déjà en cours pour ce garage',
  RESILIATION_TENANT_EXPORT_INDISPONIBLE: 'Export pas encore disponible',
  RESILIATION_TENANT_PURGE_PREMATUREE: 'Période de conservation non écoulée',
  RESILIATION_TENANT_CONFIRMATION_INVALIDE: 'Confirmation invalide',
  REPRISE_DOSSIER_TRANSITION_INTERDITE: 'Transition interdite pour ce dossier de reprise',
  REPRISE_ARCHIVE_INCOMPLETE: 'Archive incomplète',
  REPRISE_EMPREINTE_INVALIDE: "Empreinte de l'archive invalide",
  REPRISE_TRANCHE_HORS_SEQUENCE: 'Numéro de tranche hors séquence',
  REPRISE_PLAN_NON_VALIDABLE: 'Plan de reprise non validable',
  REPRISE_AJUSTEMENT_ELEMENT_INCONNU: 'Élément de plan inconnu',
  AUTH_JETON_REINITIALISATION_INVALIDE: 'Jeton de réinitialisation invalide',
  AUTH_CHANGEMENT_MOT_DE_PASSE_REQUIS: 'Changement de mot de passe requis',
  FACTURE_DESTINATAIRE_COURRIEL_ABSENT: "Le client n'a pas d'adresse courriel enregistrée",
  TVA_NON_ASSUJETTI_TAUX_INTERDIT: 'TVA interdite pour un garage non assujetti',
  TVA_NUMERO_REQUIS: 'Numéro de TVA requis pour émettre',
  FACTURE_DEJA_CORRIGEE: 'Facture déjà corrigée',
  FACTURE_CORRECTION_REGLEMENT_EXISTANT: 'Facture déjà réglée en tout ou partie',
  MODULE_DESACTIVE: 'Module désactivé pour ce garage',
  COURRIEL_NON_CONFIGURE: 'Envoi des e-mails non configuré',
  COURRIEL_CLE_CHIFFREMENT_ABSENTE: 'Clé de chiffrement des secrets absente',
  COURRIEL_AUTHENTIFICATION_ECHEC: "Authentification refusée par le serveur d'envoi",
  COURRIEL_CONNEXION_ECHEC: "Serveur d'envoi injoignable",
  COURRIEL_TLS_ECHEC: "Connexion sécurisée impossible avec le serveur d'envoi",
  COURRIEL_ENVOI_ECHEC: "Échec d'envoi de l'e-mail",
  SERVICE_LECTURE_INDISPONIBLE: 'Service de lecture indisponible',
  INSTALLATION_CODE_INVALIDE: "Code d'installation invalide",
  INSTALLATION_DEJA_FAITE: 'Installation déjà faite',
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
  // Étape 2 (facturation) : blocages émis par `facturation/documents/` (émission/avoir sur un
  // document verrouillé, ligne déjà facturée...). Miroir i18n requis : clés
  // `erreurs:blocages.document_vente` / `erreurs:blocages.ligne_document` dans
  // `apps/web/src/i18n/locales/<langue>/erreurs.json` (FR/DE/IT) — hors périmètre de ce fichier,
  // à vérifier séparément.
  'document_vente',
  'ligne_document',
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
  // Étape 3 (pièces, docs/specification-etape-3-pieces.md) :
  // RP-24, CP-02 — une ligne d'OR pièce ne peut PAS obtenir de réservation faute de disponibilité
  // (dernier exemplaire déjà réservé par un autre OR). SUCCÈS avec réserve : la ligne se crée
  // quand même, `blocage = 'pieces'` (RP-24) — ce n'est délibérément PAS un CodeErreur, exactement
  // pour la même raison que POINTAGE_CLOTURE_AUTOMATIQUE ci-dessus. `donnees` porte la forme
  // `DonneesAvertissementReservationIndisponible` (`contrats/pieces/stock.ts`) : de quoi dire au
  // réceptionnaire « cette pièce est déjà réservée pour l'OR de M. Dupont ».
  'PIECE_RESERVATION_INDISPONIBLE',
  // §7.4 — réception d'une quantité supérieure au reliquat restant (erreur de préparation
  // fournisseur, ou substitution acceptée par lot). Jamais bloquant (RP-27 ne fixe aucune limite
  // haute) : le mouvement d'entrée porte la quantité réellement livrée.
  'RECEPTION_EXCEDENT_RELIQUAT',
  // RP-23, troisième cas — le magasinier libère une réservation dont l'OR n'est ni `annule` ni
  // refusé : un geste volontaire, pas une anomalie, mais qui mérite d'être vu.
  'RESERVATION_LIBEREE_OR_ACTIF',
  // §7.6, PP-05 — ajustement d'inventaire dont l'écart de valeur dépasse le seuil paramétré :
  // remonte à la direction sans jamais bloquer la saisie du magasinier (§7.6 : « pas absorbée
  // silencieusement par l'ajustement »).
  'INVENTAIRE_ECART_SIGNIFICATIF',
  // RV-37/MD-70 — l'émission d'une facture rattachée à un dossier de vente tente de marquer son
  // véhicule `vendu` (`ServiceVehiculeStock.marquerVendu`, effet de bord APRÈS le commit de la
  // facture, jamais avant : ne JAMAIS produire "véhicule vendu sans facture émise"). La facture,
  // elle, est déjà émise et verrouillée quoi qu'il arrive à ce marquage — un échec ici n'est donc
  // jamais bloquant, seulement signalé pour une correction manuelle
  // (`POST /vehicules/{id}/stock/marquer-vendu`, `ventes.vehicule_stock.corriger`).
  'VENTE_VEHICULE_MARQUAGE_VENDU_ECHOUE',
  // RPP-06 (docs/specification-parc-et-hangar-pneus.md) — la vente d'un véhicule ne transfère
  // JAMAIS automatiquement au nouveau propriétaire un éventuel dépôt de pneus qui lui est
  // rattaché : c'est un choix commercial (le vendeur peut les inclure ou les reprendre), jamais un
  // geste automatique sur un bien qui appartient au client. `ServiceVehiculeStock.marquerVendu`
  // (`reserve -> vendu`) signale — SANS jamais bloquer la vente — tout dépôt encore ACTIF
  // (`en_depot`/`monte`/`a_relancer`, tout sauf le statut terminal `sorti`) lié au véhicule, pour
  // que le vendeur statue explicitement (garder, rendre, transférer). `donnees` porte
  // `{ depotsOuverts: { id, saison, statut }[] }`.
  'VEHICULE_DEPOTS_PNEUS_OUVERTS',
  // RP-46 — un avoir crédite PARTIELLEMENT (montant < TTC original) une ligne `piece` qui avait
  // déclenché un mouvement `sortie_comptoir` : un montant partiel n'a pas de traduction fiable en
  // quantité physique réellement rendue (un tiers du prix ne veut pas dire un tiers de la pièce),
  // donc AUCUN mouvement `retour_client` n'est créé automatiquement — jamais bloquant (l'avoir
  // financier reste émis), seulement signalé pour que le magasinier enregistre le retour physique
  // à la main s'il a réellement eu lieu (`POST /articles/{id}/mouvements/retour-client`).
  'AVOIR_RETOUR_STOCK_NON_DECLENCHE',
  // Facture émise sans bloc créancier complet (IBAN, adresse) : elle est valable et verrouillée,
  // mais ne porte pas de QR-facture. `donnees.documentId` : la facture concernée. Voie de sortie :
  // renseigner le bloc créancier (`PATCH /parametres-facturation/creancier`) pour les suivantes.
  'FACTURE_SANS_QR',
  // `POST /ordres-reparation/{orId}/facturer-et-encaisser` : la facture est créée ET émise (acquise,
  // verrouillée), mais l'encaissement demandé a échoué (montant excédentaire, moyen refusé…). Le
  // geste n'est PAS annulé : la facture reste émise, son solde est intact, l'encaissement se
  // refait par `POST /paiements`. `donnees` : `{ factureId, codeErreur }`.
  'ENCAISSEMENT_ECHOUE',
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
