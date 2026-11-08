/**
 * MATRICE HISTORIQUE rôle × action — état AVANT la grille de capacités par personne.
 *
 * Ce fichier n'est PAS lu par le produit : il ne sert qu'aux tests. Il fige les droits que chaque
 * rôle détenait quand les rôles étaient exclusifs, pour prouver deux choses sans les croire sur
 * parole :
 *   1. `matrice-droits.spec.ts` : le préréglage de chaque rôle (grille + table
 *      `capacites-actions.ts`) donne AU MOINS les droits historiques — aucune personne ne perd un
 *      droit à la migration ;
 *   2. `matrice-droits-historique.spec.ts` : les arbitrages métier d'origine (RF-115, issue #21,
 *      PR #14, PR #31…) restent documentés par des assertions exactes.
 *
 * Les commentaires ci-dessous racontent POURQUOI chaque droit a été donné ou refusé : ils restent
 * utiles pour décider d'un élargissement. Ne pas modifier les listes — la source de vérité
 * d'exécution est `matrice-droits.ts` (dérivée de `capacites-actions.ts` et des préréglages).
 */

import type { RoleUtilisateur } from '@dfa/shared';

import type { Action } from './matrice-droits';

// =================================================================================================
// Groupes de droits — chaque groupe cite sa provenance (§10 littéral ou inférence documentée)
// =================================================================================================

/**
 * Lecture du socle : accordée à tous les rôles (inchangé étape 0).
 */
const LECTURE_SOCLE: readonly Action[] = ['socle.tenant.lire', 'socle.site.lire'];

/**
 * Lecture étendue (paramétrage, clients, véhicules, recherche) : accordée à tous les rôles.
 * Aucune ligne de §10 ne restreint la LECTURE de ces domaines, seule l'écriture y est gouvernée
 * (ex. §10 L958 : comptable a « lecture » sur les clients quand les autres ont « oui » en écriture
 * — la lecture, elle, n'est jamais refusée). Étendu par le même principe à `parametrage.*.lire`
 * (non couvert par §10, aucun rôle n'a de raison métier d'en être privé) et `recherche.executer`
 * (RM-112, spec ligne 370 : recherche comptoir, outil transversal).
 */
const LECTURE_ETENDUE: readonly Action[] = [
  'parametrage.atelier.lire',
  'parametrage.referentiel.lire',
  'client.lire',
  'vehicule.lire',
  'recherche.executer',
];

/**
 * Lecture de l'OR : tous les rôles opérationnels de l'atelier, PAS `vendeur` (hors flux étape 1,
 * §2.1 lignes 56-69 ne le mentionne dans aucune étape du §3).
 */
const LECTURE_OR: readonly Action[] = ['atelier.or.lire'];

/**
 * §10 L958 — Créer / modifier un client : réceptionnaire, chef d'atelier, magasinier, direction
 * (comptable = lecture seule, technicien = non).
 */
const L958_CLIENT_ECRITURE: readonly Action[] = ['client.creer', 'client.modifier'];

/**
 * Inféré — désactivation d'un client (RM-12, spec ligne 246). Aucune ligne §10 ne la couvre
 * littéralement ; alignée sur le périmètre « gestion de la relation client » (réceptionnaire,
 * chef d'atelier, direction) SANS magasinier : désactiver une fiche est une décision de suivi
 * commercial, pas une opération de comptoir pièces (magasinier n'a que la création/modification
 * de fiches en §10 L958, pour ses propres besoins de saisie).
 */
const INFERE_CLIENT_DESACTIVATION: readonly Action[] = ['client.desactiver'];

/**
 * Inféré — conditions commerciales du client : rabais %, délai de paiement, taux horaire
 * spécifique (RM-07, spec ligne 241). Distinct du rabais PAR LIGNE d'OR (§10 L970, plafonné P-13
 * pour réceptionnaire/chef d'atelier) : ceci est la donnée de référence sur la fiche client,
 * assimilée à une décision de gestion commerciale au même titre que la fusion de clients
 * (§10 L959, direction seule). Restreint à direction (+ admin).
 */
const INFERE_CLIENT_CONDITIONS: readonly Action[] = ['client.condition.modifier'];

/**
 * Inféré — consentements (RM-09, ligne 243) et notes (RM-13, ligne 247) : actions opérationnelles
 * de contact client, dans le périmètre réceptionnaire/chef d'atelier/direction, comme la
 * désactivation.
 */
const INFERE_CLIENT_CONTACT: readonly Action[] = [
  'client.consentement.enregistrer',
  'client.note.ecrire',
];

/**
 * Droit d'accès nLPD (art. 25) — générer l'export complet des données détenues sur un client.
 * Geste LISIBLE et réversible (aucune écriture) : même périmètre que `INFERE_CLIENT_CONTACT`
 * (contact opérationnel courant avec la fiche) plutôt que le palier de l'anonymisation ci-dessous
 * — un client qui demande ce que le garage détient sur lui n'a pas besoin d'attendre la
 * direction, à la différence de l'effacement, qui lui est irréversible. Bascule du palliatif
 * `clients/droits-provisoires.ts::ROLES_CLIENT_EXPORT`, mêmes rôles exacts.
 */
const INFERE_CLIENT_EXPORT: readonly Action[] = ['client.export.generer'];

/**
 * Droit à l'effacement nLPD (art. 32) — anonymiser un client : geste IRRÉVERSIBLE sur des données
 * réelles, PAS une action de comptoir. Restreint à direction (+ admin, qui suit ici la doctrine
 * « admin = même périmètre que direction sauf geste financier » — anonymiser un client ne touche
 * aucun montant, voir la tête de fichier). Bascule du palliatif
 * `clients/droits-provisoires.ts::ROLES_CLIENT_ANONYMISATION`, mêmes rôles exacts — SANS
 * `receptionnaire`/`chef_atelier`, à la différence d'`INFERE_CLIENT_EXPORT` ci-dessus : composé
 * dans `DROITS_DIRECTION` (pas `DROITS_RECEPTIONNAIRE`), voir plus bas.
 */
const INFERE_CLIENT_ANONYMISATION: readonly Action[] = ['client.anonymiser'];

/**
 * §10 L960 — Créer / modifier un véhicule : réceptionnaire, chef d'atelier, magasinier, direction.
 * Le technicien a « km seulement » — couvert séparément par `vehicule.kilometrage.saisir`, PAS ici.
 */
const L960_VEHICULE_ECRITURE: readonly Action[] = ['vehicule.creer', 'vehicule.modifier'];

/**
 * §10 L961 — Changer le détenteur d'un véhicule : réceptionnaire, chef d'atelier, direction.
 */
const L961_VEHICULE_DETENTEUR: readonly Action[] = ['vehicule.detention.changer'];

/**
 * Inféré — archivage véhicule (RM-31, ligne 268), gestion de plaque (RM-17/RM-19, lignes 254 et
 * 256), saisie d'expertise (RM-28, ligne 265), campagnes constructeur (RM-30, ligne 267) et
 * travaux reportés (RM-73/RM-36, lignes 319 et 276). Aucune ligne §10 littérale ; alignées sur le
 * même périmètre que « changer le détenteur » (§10 L961) : réceptionnaire, chef d'atelier,
 * direction — actions de comptoir/atelier, pas de saisie pièces (magasinier exclu ici, à la
 * différence de la création/modification générale en §10 L960).
 */
const INFERE_VEHICULE_GESTION: readonly Action[] = [
  'vehicule.archiver',
  'vehicule.plaque.gerer',
  'vehicule.expertise.saisir',
  'vehicule.travail_reporte.gerer',
];

/**
 * Saisie du kilométrage (RM-23, ligne 260) : réceptionnaire, chef d'atelier, magasinier, direction
 * (via §10 L960, écriture générale du véhicule) + technicien (§10 L960, mention explicite
 * « km seulement »).
 */
const KILOMETRAGE_SAISIE: readonly Action[] = ['vehicule.kilometrage.saisir'];

/**
 * §10 L962 — Corriger un kilométrage à la baisse : chef d'atelier, direction (réceptionnaire et
 * technicien explicitement « non »).
 */
const L962_KM_CORRECTION: readonly Action[] = ['vehicule.kilometrage.corriger_regression'];

/**
 * Inféré — correction de détention (RM-20, ligne 257). Pas de ligne §10 littérale distincte de
 * « changer le détenteur » (§10 L961) ; traitée comme une correction sensible au même titre que
 * la correction de kilométrage (§10 L962) : chef d'atelier, direction, PAS réceptionnaire (une
 * correction répare une erreur, un changement normal suit le flux courant de §10 L961).
 */
const INFERE_DETENTION_CORRECTION: readonly Action[] = ['vehicule.detention.corriger'];

/**
 * §10 L965 — Ouvrir un OR : réceptionnaire, chef d'atelier, direction. Couvre à la fois la
 * création (`atelier.or.creer`) et la transition T-01/T-02/T-03 (spec lignes 431-433, acteur
 * réceptionnaire) : `atelier.or.receptionner`.
 */
const L965_OR_OUVERTURE: readonly Action[] = ['atelier.or.creer', 'atelier.or.receptionner'];

/**
 * Inféré — modification générale d'un OR (localisation RM-55 ligne 298, date de restitution
 * promise RM-56 ligne 299) : même périmètre que l'ouverture (§10 L965).
 */
const INFERE_OR_MODIFICATION: readonly Action[] = ['atelier.or.modifier'];

/**
 * §10 L969 — Modifier le montant plafond : réceptionnaire, chef d'atelier, direction.
 */
const L969_PLAFOND: readonly Action[] = ['atelier.or.plafond_modifier'];

/**
 * §10 L976 — Passer l'OR à `terminé` : réceptionnaire, chef d'atelier, direction. (La machine à
 * états §5.1 T-13/T-14 ne nomme que le chef d'atelier comme acteur, mais §10 est la source
 * arbitrale du plan — aucune interprétation.)
 */
const L976_OR_TERMINER: readonly Action[] = ['atelier.or.terminer'];

/**
 * §10 L978 — Restituer le véhicule : réceptionnaire, chef d'atelier, direction.
 */
const L978_OR_RESTITUER: readonly Action[] = ['atelier.or.restituer'];

/**
 * §10 L979 — Annuler un OR : réceptionnaire, chef d'atelier, direction.
 */
const L979_OR_ANNULER: readonly Action[] = ['atelier.or.annuler'];

/**
 * Inféré — clôture (T-19, spec ligne 449 : « automatique ou réceptionnaire »). Pas de ligne §10 ;
 * alignée sur le même périmètre que restitution/annulation/terminer (réceptionnaire, chef
 * d'atelier, direction) pour permettre un forçage manuel par les mêmes rôles qui gèrent la fin de
 * vie de l'OR.
 */
const INFERE_OR_CLOTURE: readonly Action[] = ['atelier.or.cloturer'];

/**
 * Inféré — démarrage (T-04, ligne 434 : « technicien / chef d'atelier ») et passage en contrôle
 * (T-11, ligne 441 : « technicien »). Pas de ligne §10 dédiée ; le technicien exécute (§2.1 ligne
 * 60), le chef d'atelier supervise et peut se substituer à tout instant.
 */
const INFERE_OR_EXECUTION: readonly Action[] = [
  'atelier.or.demarrer',
  'atelier.or.passer_en_controle',
];

/**
 * §10 L975 — Valider le contrôle qualité : chef d'atelier, technicien (« autre que l'exécutant » —
 * règle de service que le guard ne peut pas arbitrer, l'action reste binaire ici ; à faire
 * respecter par le service métier, pas par `GardeDroit`).
 */
const L975_CONTROLE: readonly Action[] = ['atelier.or.controler'];

/**
 * Inféré — réouverture (T-15, ligne 445 : « chef d'atelier », motif obligatoire). Pas de ligne
 * §10 ; réservée au chef d'atelier (+ direction), pas au réceptionnaire : rouvrir un OR terminé
 * défait un travail technique déjà clos, décision d'atelier, pas de comptoir.
 */
const INFERE_OR_ROUVRIR: readonly Action[] = ['atelier.or.rouvrir'];

/**
 * §10 L966 — Ajouter une ligne constatée : réceptionnaire, chef d'atelier, technicien, magasinier
 * (« pièces »), direction.
 */
const L966_LIGNE_CREATION: readonly Action[] = ['atelier.ligne.creer'];

/**
 * §10 L967 — Valider une ligne dans le plafond : réceptionnaire, chef d'atelier, direction.
 */
const L967_LIGNE_VALIDATION: readonly Action[] = ['atelier.ligne.valider'];

/**
 * §10 L970/L971 — Appliquer un rabais / passer une ligne en payeur `garage` (geste commercial) :
 * réceptionnaire et chef d'atelier « jusqu'à P-13 », direction « sans limite ». La borne P-13
 * elle-même est une règle de calcul appliquée par le service métier (paramètre par rôle), pas un
 * filtre de rôle : ce droit n'ouvre que l'accès à l'action `atelier.ligne.modifier`.
 */
const L970_L971_LIGNE_COMMERCIALE: readonly Action[] = ['atelier.ligne.modifier'];

/**
 * Inféré — refus de ligne (RM-72, ligne 318) et annulation de ligne (RM-71, ligne 317). Pas de
 * ligne §10 dédiée ; alignées sur le périmètre de la validation (§10 L967 : réceptionnaire, chef
 * d'atelier, direction), symétrique de la décision d'accepter.
 */
const INFERE_LIGNE_DECISION: readonly Action[] = ['atelier.ligne.refuser', 'atelier.ligne.annuler'];

/**
 * Inféré — marquer une ligne réalisée (transition `en_cours` → `realisee`, §5.2 ligne 480). Pas
 * de ligne §10 (la machine à états des lignes ne nomme pas d'acteur) ; c'est le technicien qui
 * exécute (§2.1 ligne 60) qui clôt sa propre ligne, le chef d'atelier pouvant se substituer.
 *
 * `magasinier` (I-18/#18) : reçoit CE DROIT AUSSI, séparément, sur `DROITS_MAGASINIER` (pas via
 * cette const, gardée fermée à sa composition d'origine ci-dessus). Sur une ligne `type: piece`,
 * « marquer réalisée » EST le geste du magasinier — prendre la pièce sur l'étagère et la remettre
 * au mécanicien, ce qui déclenche la sortie de stock (`satisfaireReservationSiApplicable`,
 * `service-ligne-or.ts::marquerRealisee`) — pas une substitution au technicien mais l'exécution
 * normale de SA partie du travail. Cohérent avec `pieces.mouvement.creer`/`pieces.stock.modifier`/
 * `pieces.reservation.satisfaire` déjà reçus par `magasinier` (`DROITS_PIECES_PAR_ROLE`) : sans ce
 * droit, il a l'accès pour sortir le stock mais pas celui d'actionner le geste qui le déclenche —
 * un trou de matrice, pas une restriction voulue (confirmé par l'issue).
 */
const INFERE_LIGNE_REALISATION: readonly Action[] = ['atelier.ligne.marquer_realisee'];

/**
 * §10 L968 — Enregistrer une réponse de devis complémentaire : réceptionnaire, chef d'atelier,
 * direction.
 */
const L968_DEVIS_REPONSE: readonly Action[] = ['atelier.devis.repondre'];

/**
 * Inféré — création du devis complémentaire (T-05, ligne 435, acteur réceptionnaire ; RM-79,
 * ligne 328). Même périmètre que la réponse (§10 L968).
 */
const INFERE_DEVIS_CREATION: readonly Action[] = ['atelier.devis.creer'];

/**
 * Inféré — lecture du journal d'audit de l'OR (RM-59 ligne 302, RM-111 ligne 369). Pas d'action
 * §10 dédiée ; restreinte aux rôles qui pilotent l'OR au quotidien (réceptionnaire, chef d'atelier,
 * direction) — pas au technicien/magasinier/comptable, qui n'ont pas besoin de l'historique
 * complet des modifications pour leur tâche.
 */
const INFERE_JOURNAL_LECTURE: readonly Action[] = ['atelier.journal.lire'];

/**
 * Inféré — gouvernance du paramétrage atelier et des référentiels (taux horaires, prestations).
 * Pas de ligne §10 (le paramétrage n'y est pas modélisé) ; restreinte à chef d'atelier + direction,
 * cohérent avec le fait que direction est de gouvernance dans TOUTES les lignes §10 et que le
 * chef d'atelier « arbitre les gestes commerciaux » (§2.1 ligne 59).
 */
const INFERE_PARAMETRAGE_GOUVERNANCE: readonly Action[] = [
  'parametrage.atelier.modifier',
  'parametrage.referentiel.modifier',
];

/**
 * contrats-api-etape-1.md L524/L529 — confirmations `CLIENT_BLOQUE` et `OR_SANS_RDV` : chef
 * d'atelier ou direction.
 */
const CONFIRMATION_CHEF_ATELIER_DIRECTION: readonly Action[] = [
  'atelier.confirmation.client_bloque',
  'atelier.confirmation.or_sans_rdv',
];

/**
 * contrats-api-etape-1.md L525 — confirmation `VEHICULE_DEUX_OR_OUVERTS` : « receptionnaire+ »,
 * donc réceptionnaire ET chef d'atelier/direction.
 */
const CONFIRMATION_DEUX_OR_OUVERTS: readonly Action[] = ['atelier.confirmation.deux_or_ouverts'];

// =================================================================================================
// Composition par rôle
// =================================================================================================

/**
 * `receptionnaire` : acteur central de l'étape 1 (§2.1 ligne 58 — reçoit, ouvre l'OR, gère les
 * devis complémentaires, contrôle avant facturation, restitue). Reçoit l'écriture opérationnelle
 * complète sur clients/véhicules/OR/lignes/devis, MAIS PAS : la gouvernance du paramétrage, les
 * conditions commerciales de fond (client.condition.modifier), les corrections sensibles
 * (détention, kilométrage à la baisse), ni les transitions internes à l'atelier réservées au
 * chef d'atelier/technicien (démarrer, passer en contrôle, contrôler, rouvrir, marquer réalisée),
 * ni les confirmations `CLIENT_BLOQUE`/`OR_SANS_RDV` (réservées chef d'atelier/direction).
 */
const DROITS_RECEPTIONNAIRE: readonly Action[] = [
  ...LECTURE_SOCLE,
  ...LECTURE_ETENDUE,
  ...LECTURE_OR,
  ...L958_CLIENT_ECRITURE,
  ...INFERE_CLIENT_DESACTIVATION,
  ...INFERE_CLIENT_CONTACT,
  ...INFERE_CLIENT_EXPORT,
  ...L960_VEHICULE_ECRITURE,
  ...L961_VEHICULE_DETENTEUR,
  ...INFERE_VEHICULE_GESTION,
  ...KILOMETRAGE_SAISIE,
  ...L965_OR_OUVERTURE,
  ...INFERE_OR_MODIFICATION,
  ...L969_PLAFOND,
  ...L976_OR_TERMINER,
  ...L978_OR_RESTITUER,
  ...L979_OR_ANNULER,
  ...INFERE_OR_CLOTURE,
  ...L966_LIGNE_CREATION,
  ...L967_LIGNE_VALIDATION,
  ...L970_L971_LIGNE_COMMERCIALE,
  ...INFERE_LIGNE_DECISION,
  ...L968_DEVIS_REPONSE,
  ...INFERE_DEVIS_CREATION,
  ...INFERE_JOURNAL_LECTURE,
  ...CONFIRMATION_DEUX_OR_OUVERTS,
];

/**
 * `chef_atelier` : tout ce que `receptionnaire` a, PLUS la supervision technique (démarrer,
 * passer en contrôle, contrôler, rouvrir, marquer réalisée), les corrections sensibles, la
 * gouvernance du paramétrage, et les confirmations `CLIENT_BLOQUE`/`OR_SANS_RDV`/RDV/prêt.
 * PAS `client.condition.modifier` (conditions commerciales de fond réservées à direction/admin,
 * distinct des gestes bornés par P-13 que le chef d'atelier arbitre déjà via `atelier.ligne.modifier`).
 */
const DROITS_CHEF_ATELIER: readonly Action[] = [
  ...DROITS_RECEPTIONNAIRE,
  ...INFERE_PARAMETRAGE_GOUVERNANCE,
  ...INFERE_DETENTION_CORRECTION,
  ...L962_KM_CORRECTION,
  ...INFERE_OR_EXECUTION,
  ...L975_CONTROLE,
  ...INFERE_OR_ROUVRIR,
  ...INFERE_LIGNE_REALISATION,
  ...CONFIRMATION_CHEF_ATELIER_DIRECTION,
];

/**
 * `technicien` : pointe, exécute, remonte des constats, demande des pièces (§2.1 ligne 60).
 * Lecture large, saisie du kilométrage, création de lignes constatées, transitions internes
 * (démarrer, passer en contrôle, contrôler « autre que l'exécutant », marquer réalisée). AUCUN
 * droit sur les clients/véhicules (hors kilométrage), AUCUNE écriture financière (rabais, payeur,
 * plafond), AUCUNE gestion du cycle de vie de l'OR (ouvrir/terminer/restituer/annuler).
 */
const DROITS_TECHNICIEN: readonly Action[] = [
  ...LECTURE_SOCLE,
  ...LECTURE_ETENDUE,
  ...LECTURE_OR,
  ...KILOMETRAGE_SAISIE,
  ...L966_LIGNE_CREATION,
  ...INFERE_OR_EXECUTION,
  ...L975_CONTROLE,
  ...INFERE_LIGNE_REALISATION,
];

/**
 * `magasinier` : sort les pièces (étape 3 ; en étape 1 il saisit les lignes de pièces, §2.1
 * ligne 61). Reçoit l'écriture générale client/véhicule (§10 L958/L960 l'y incluent
 * explicitement), le kilométrage, la création de lignes — PAS la gestion fine du véhicule
 * (plaque, détention, expertise, campagnes, travaux reportés) ni aucune décision sur l'OR.
 *
 * `...INFERE_LIGNE_REALISATION` (I-18/#18) : AJOUT STRICT — seul ce droit, pas une composition
 * depuis `DROITS_TECHNICIEN`/`DROITS_CHEF_ATELIER` (interdit par la doctrine de tête de fichier).
 * Voir le commentaire de `INFERE_LIGNE_REALISATION` ci-dessus pour la justification complète :
 * remettre une pièce au mécanicien EST le geste qui déclenche la sortie de stock, domaine déjà
 * ouvert au magasinier par `pieces.mouvement.creer`/`pieces.stock.modifier` (`DROITS_PIECES_PAR_
 * ROLE.magasinier`). Ne PAS composer `DROITS_MAGASINIER` depuis `DROITS_TECHNICIEN` pour autant :
 * ce dernier a aussi `INFERE_OR_EXECUTION` (démarrer/passer en contrôle une ligne), geste
 * d'exécution technique qui reste hors du métier du magasinier.
 */
const DROITS_MAGASINIER: readonly Action[] = [
  ...LECTURE_SOCLE,
  ...LECTURE_ETENDUE,
  ...LECTURE_OR,
  ...L958_CLIENT_ECRITURE,
  ...L960_VEHICULE_ECRITURE,
  ...KILOMETRAGE_SAISIE,
  ...L966_LIGNE_CREATION,
  ...INFERE_LIGNE_REALISATION,
];

/**
 * `comptable` : consulte, ne modifie pas l'atelier (§2.1 ligne 62). Lecture seule, y compris sur
 * l'OR (nécessaire pour préparer la facturation de l'étape 2, §10 L977).
 */
const DROITS_COMPTABLE: readonly Action[] = [...LECTURE_SOCLE, ...LECTURE_ETENDUE, ...LECTURE_OR];

/**
 * `vendeur` : listé par `ARCHITECTURE.md §3` mais absent de tous les flux du lot 1 (§2.1, §3).
 * Lecture minimale (paramétrage, clients, véhicules, recherche) pour ne pas casser un futur écran
 * transversal ; PAS de lecture OR (aucun besoin identifié en étape 1) ; AUCUNE écriture atelier.
 */
const DROITS_VENDEUR: readonly Action[] = [...LECTURE_SOCLE, ...LECTURE_ETENDUE];

/**
 * `poste_atelier` — LE SEUL RÔLE DE CE FICHIER QUI NE DÉSIGNE PAS UNE PERSONNE
 * (`ROLES_COMPTE_DE_SERVICE`, `@dfa/shared`). C'est la tablette murale de l'atelier : un compte de
 * service scopé à UN site (`utilisateur.site_id`, migration 0039), derrière lequel n'importe quel
 * technicien de l'équipe se présente en tapant un code PIN.
 *
 * **La règle de construction n'est pas la même que pour les autres rôles.** Partout ailleurs dans
 * ce fichier, la lecture est ouverte par défaut et seule l'écriture est gouvernée (voir
 * `LECTURE_SOCLE` / `LECTURE_ETENDUE`, doctrine de tête de fichier). Ici c'est l'inverse : le
 * périmètre est CONSTRUIT PAR ÉNUMÉRATION, et tout ce qui n'y figure pas est refusé. La raison est
 * physique, pas philosophique — cet écran est accroché à un mur, allumé en permanence, sans
 * verrouillage, et n'importe qui entrant dans l'atelier (client, livreur, visiteur) est devant.
 * `LECTURE_ETENDUE` y exposerait le fichier clients complet du garage à la vue de tous ; c'est
 * pourquoi ce rôle ne le reçoit PAS, à la différence des huit autres.
 *
 * Ce qu'il reçoit, et pourquoi chaque entrée :
 *  - `LECTURE_SOCLE` : lire son tenant et son site. Nécessaire à l'en-tête de l'application, et
 *    strictement borné — `session.sites` ne rend qu'un site à un compte de service, et
 *    `verifierSiteAutorise()` (`auth/comptes-de-service.ts`) refuse tout autre site.
 *  - `LECTURE_OR` : la borne affiche les OR en cours de SON atelier pour que le technicien
 *    choisisse sur quoi pointer. Sans montants — `poste_atelier` figure dans `ROLES_SANS_MONTANT`.
 *  - le bloc pointage (`DROITS_POINTAGE_PAR_ROLE.poste_atelier`) : identifier par PIN, démarrer,
 *    arrêter, lire.
 *
 * Ce qu'il ne reçoit à AUCUN prix (RM-115/RM-131) : toute transition d'OR, toute réponse de devis,
 * toute écriture client/véhicule, tout document, tout paiement, toute correction de pointage
 * d'autrui, toute gestion de PIN. Un PIN emprunté doit rester une erreur d'imputation d'heures et
 * ne jamais pouvoir devenir autre chose — cette liste est ce qui rend cette phrase vraie.
 */
const DROITS_POSTE_ATELIER: readonly Action[] = [...LECTURE_SOCLE, ...LECTURE_OR];

/**
 * `direction` : voit les indicateurs, arbitre en dernier ressort (§2.1 ligne 63). « oui » ou
 * « sans limite » sur les 24 lignes de §10 sans exception : reçoit tout ce que `chef_atelier` a,
 * plus les actions réservées à direction seule (`client.condition.modifier`).
 */
const DROITS_DIRECTION: readonly Action[] = [
  ...DROITS_CHEF_ATELIER,
  ...INFERE_CLIENT_CONDITIONS,
  ...INFERE_CLIENT_ANONYMISATION,
];

/**
 * `admin` : compte technique de l'intégrateur (`ARCHITECTURE.md §3`) — administre le système
 * (tenants, sites, utilisateurs, paramètres), ne vend pas, ne facture pas, ne touche pas au stock.
 * PAS le propriétaire métier du garage : ça, c'est `direction` (voir note de tête de fichier,
 * doctrine complète arbitrée par l'issue #21). Non décrit comme acteur métier de l'étape 1 — reçoit
 * par construction le même périmètre que `direction` UNIQUEMENT ici (atelier/clients/véhicules) ;
 * retombe à `[]` littéral dès qu'une action touche à l'argent ou au stock (RF-115, blocs additifs
 * plus bas).
 */
const DROITS_ADMIN: readonly Action[] = [...DROITS_DIRECTION];

// =================================================================================================
// Facturation — paiements (étape 2) : bloc ADDITIF PUR, ne modifie aucune des consts ci-dessus
// =================================================================================================
//
// Ajouté par le lot `paiements` (apps/api/src/facturation/paiements/), périmètre disjoint de ce
// fichier. Décision délibérée de NE PAS insérer ces droits DANS les listes composées ci-dessus
// (`DROITS_RECEPTIONNAIRE`, `DROITS_CHEF_ATELIER`, `DROITS_DIRECTION`, `DROITS_ADMIN`) : RF-114
// (`docs/specification-etape-2-facturation.md` §9) casse ICI, pour la première fois, l'hypothèse de
// hiérarchie stricte que ce fichier a suivie jusqu'alors (chef_atelier ⊇ receptionnaire, direction/
// admin ⊇ chef_atelier) — « Encaisser / imputer » est ✅ pour receptionnaire mais ❌ pour
// chef_atelier, qui est pourtant construit comme un SUR-ensemble de receptionnaire. Restructurer la
// chaîne de composition existante pour faire rentrer cette exception aurait un rayon d'effet bien
// plus large que ce seul module : les droits `document_vente` qu'un futur lot `documents` ajoutera
// cassent la MÊME hiérarchie de la MÊME façon (« Émettre une facture » est ✅ pour receptionnaire, ❌
// pour chef_atelier). Un lookup additif par rôle, fusionné une seule fois dans `MATRICE_DROITS`
// ci-dessous, est la façon la moins invasive de poser une matrice financière qui ne suit PAS la
// hiérarchie atelier — et ce futur module peut faire exactement pareil, EN PARALLÈLE, sans jamais
// toucher aux mêmes lignes que ce bloc.
//
// RF-115, LITTÉRAL ET NON NÉGOCIABLE : « admin est un rôle technique et n'a aucun droit financier »
// — séparation des pouvoirs explicite dès l'étape 2 (qui crée des comptes ne doit pas pouvoir
// émettre/encaisser), À LA DIFFÉRENCE de la doctrine de l'étape 1 rappelée en tête de fichier
// (`admin` = superset de `direction`). Son entrée ci-dessous est donc `[]`, VOLONTAIREMENT, et ne
// doit JAMAIS être remplie par copier-coller de celle de `direction`. CONFIRMÉ EXPLICITEMENT par
// l'arbitrage de l'issue #21 (12.08.2026, voir tête de fichier) : `admin` = compte technique de
// l'intégrateur, ne vend ni ne facture jamais — ce n'est pas un oubli de la matrice §11.

/** RF-114, ligne « Voir les montants » côté paiements. */
const LECTURE_PAIEMENT: readonly Action[] = ['facturation.paiement.lire'];
/** RF-114, ligne « Encaisser / imputer » : direction, comptable, vendeur, réceptionnaire, magasinier
 *  — PAS chef d'atelier (❌ littéral), PAS technicien, PAS admin (RF-115). */
const ENCAISSEMENT_PAIEMENT: readonly Action[] = [
  'facturation.paiement.creer',
  'facturation.paiement.imputer',
];
/**
 * RF-114, ligne « Rembourser un trop-perçu » : direction, comptable SEULS. `facturation.paiement.
 * abandonner` (RF-79 issue 3) N'A PAS de ligne littérale dans le tableau RF-114 — INFÉRÉ au même
 * périmètre : c'est une décision de disposition financière de l'avance client, structurellement
 * plus engageante qu'un remboursement (elle renonce à rendre l'argent au client), jamais moins.
 */
const DISPOSITION_AVANCE_PAIEMENT: readonly Action[] = [
  'facturation.paiement.rembourser',
  'facturation.paiement.abandonner',
];

const DROITS_PAIEMENT_PAR_ROLE: Readonly<Record<RoleUtilisateur, readonly Action[]>> = {
  direction: [...LECTURE_PAIEMENT, ...ENCAISSEMENT_PAIEMENT, ...DISPOSITION_AVANCE_PAIEMENT],
  comptable: [...LECTURE_PAIEMENT, ...ENCAISSEMENT_PAIEMENT, ...DISPOSITION_AVANCE_PAIEMENT],
  vendeur: [...LECTURE_PAIEMENT, ...ENCAISSEMENT_PAIEMENT],
  receptionnaire: [...LECTURE_PAIEMENT, ...ENCAISSEMENT_PAIEMENT],
  magasinier: [...LECTURE_PAIEMENT, ...ENCAISSEMENT_PAIEMENT],
  chef_atelier: [...LECTURE_PAIEMENT],
  technicien: [],
  // RF-115 : jamais de droit financier pour admin — voir le commentaire de tête de section.
  admin: [],
  // Compte de service (borne d'atelier) : aucun droit dans ce domaine, par construction.
  poste_atelier: [],
};

// =================================================================================================
// Facturation — documents (étape 2) : bloc ADDITIF PUR, calé LITTÉRALEMENT sur le tableau `RF-114`
// (docs/specification-etape-2-facturation.md §9) — aucune ligne n'est une inférence de ce lot.
// =================================================================================================

/** `RF-114` ligne « (lecture) » — pas de ligne littérale dédiée, mais la lecture d'un document
 *  n'est refusée à AUCUN rôle (seule la VISIBILITÉ DES MONTANTS l'est, RF-116, gérée séparément par
 *  `ROLES_SANS_MONTANT_FACTURATION` dans `facturation/documents/mappeurs.ts`, pas ici). */
const LECTURE_DOCUMENT: readonly Action[] = ['facturation.document.lire'];

/** `RF-114` ligne « Créer / modifier un brouillon » : direction, comptable, vendeur, réceptionnaire,
 *  chef d'atelier, magasinier — PAS technicien, PAS admin (RF-115). */
const ECRITURE_BROUILLON: readonly Action[] = [
  'facturation.document.creer',
  'facturation.document.modifier',
  'facturation.document.transitionner',
  'facturation.avoir.creer',
];

/** `RF-114` ligne « Émettre un devis / bon de commande » : direction, comptable, vendeur,
 *  réceptionnaire, chef d'atelier — PAS magasinier, PAS technicien, PAS admin. */
const EMISSION_DEVIS_BC: readonly Action[] = [
  'facturation.document.emettre',
  'facturation.document.emettre_devis_bc',
];

/** `RF-114` ligne « Émettre une facture » : direction, comptable, vendeur, réceptionnaire — PAS
 *  chef d'atelier (rompt la hiérarchie habituelle chef_atelier ⊇ receptionnaire, voir la note de
 *  tête de section), PAS magasinier, PAS technicien, PAS admin. */
const EMISSION_FACTURE: readonly Action[] = [
  'facturation.document.emettre',
  'facturation.document.emettre_facture',
];

/** `RF-114` ligne « Émettre un avoir » : direction, comptable, réceptionnaire (⚠️ plafonné, RF-117
 *  non implémenté — voir la note sur le type `Action`) — PAS vendeur, PAS chef d'atelier, PAS
 *  magasinier, PAS technicien, PAS admin. */
const EMISSION_AVOIR: readonly Action[] = [
  'facturation.document.emettre',
  'facturation.document.emettre_avoir',
];

/** RF-117 : les avoirs de ce rôle sont plafonnés (contrainte, remplace `role === 'receptionnaire'`). */
const AVOIR_PLAFONNE: readonly Action[] = ['facturation.avoir.plafonne'];

/**
 * `facturation.document.corriger` — demande relayée par le mainteneur (voir le commentaire sur
 * `TOUTES_ACTIONS` ci-dessus pour la doctrine complète : endpoint pas encore écrit, droit posé en
 * avance). Corrige une facture ÉMISE : annule par avoir ET recrée une nouvelle facture dans la
 * MÊME opération — plus engageant qu'`EMISSION_AVOIR` seule, périmètre volontairement PLUS ÉTROIT :
 * `direction`/`comptable` EXACTEMENT, ni `receptionnaire` (qui a pourtant `EMISSION_AVOIR`) ni
 * `admin` (RF-115). Ne pas élargir « par cohérence » avec les rôles de `EMISSION_AVOIR` — l'écart
 * est délibéré, pas un oubli.
 */
const CORRECTION_FACTURE: readonly Action[] = ['facturation.document.corriger'];

const DROITS_DOCUMENT_PAR_ROLE: Readonly<Record<RoleUtilisateur, readonly Action[]>> = {
  direction: [
    ...LECTURE_DOCUMENT,
    ...ECRITURE_BROUILLON,
    ...EMISSION_DEVIS_BC,
    ...EMISSION_FACTURE,
    ...EMISSION_AVOIR,
    ...CORRECTION_FACTURE,
  ],
  comptable: [
    ...LECTURE_DOCUMENT,
    ...ECRITURE_BROUILLON,
    ...EMISSION_DEVIS_BC,
    ...EMISSION_FACTURE,
    ...EMISSION_AVOIR,
    ...CORRECTION_FACTURE,
  ],
  vendeur: [...LECTURE_DOCUMENT, ...ECRITURE_BROUILLON, ...EMISSION_DEVIS_BC, ...EMISSION_FACTURE],
  receptionnaire: [
    ...LECTURE_DOCUMENT,
    ...ECRITURE_BROUILLON,
    ...EMISSION_DEVIS_BC,
    ...EMISSION_FACTURE,
    ...EMISSION_AVOIR,
    ...AVOIR_PLAFONNE,
  ],
  chef_atelier: [...LECTURE_DOCUMENT, ...ECRITURE_BROUILLON, ...EMISSION_DEVIS_BC],
  magasinier: [...LECTURE_DOCUMENT, ...ECRITURE_BROUILLON],
  technicien: [...LECTURE_DOCUMENT],
  // RF-115 : aucun droit financier pour admin, y compris la simple création d'un brouillon —
  // séparation des pouvoirs explicite, à ne JAMAIS combler par copier-coller de `direction`.
  admin: [...LECTURE_DOCUMENT],
  // Compte de service (borne d'atelier) : aucun droit dans ce domaine, par construction.
  poste_atelier: [],
};

// =================================================================================================
// Bloc créancier QR-facture (étape 2) : bloc ADDITIF PUR, même patron que les deux blocs ci-dessus.
// =================================================================================================
//
// Arbitrage du coordinateur, suite au constat d'un lot qui a livré `GET|PATCH
// /parametres-facturation/creancier` (`apps/api/src/parametrage/bloc-creancier/`, porte l'IBAN
// d'encaissement du garage) SANS action de droit dédiée, faute d'accès à ce fichier — plutôt que
// d'inventer une entrée hors de son périmètre, il a signalé le trou et posé un palliatif
// (`@AucunDroitRequis()` + test de rôle en service) que ce bloc rend inutile.
//
// PAS `parametrage.atelier.modifier`/`parametrage.referentiel.modifier` (`INFERE_PARAMETRAGE_
// GOUVERNANCE`, chef_atelier/direction/admin) : ces deux-là donnent l'écriture à `admin`, ce qui
// violerait `RF-115` (« admin est un rôle technique et n'a aucun droit financier ») — changer
// l'IBAN d'encaissement EST un geste financier. Périmètre repris À L'IDENTIQUE de
// `DISPOSITION_AVANCE_PAIEMENT` (« Rembourser un trop-perçu »), le palier de gouvernance le plus
// élevé déjà présent dans la matrice : direction + comptable SEULS, `admin: []` VOLONTAIREMENT —
// à ne JAMAIS combler par copier-coller de `direction`, exactement le geste que RF-115 interdit et
// qui parait anodin pour une action de paramétrage (les autres actions `parametrage.*` donnent
// toutes l'écriture à admin, ce qui rend l'erreur de recopie particulièrement facile ici).
const LECTURE_CREANCIER: readonly Action[] = ['facturation.parametrage.creancier.lire'];
const ECRITURE_CREANCIER: readonly Action[] = ['facturation.parametrage.creancier.modifier'];

const DROITS_PARAMETRAGE_CREANCIER_PAR_ROLE: Readonly<Record<RoleUtilisateur, readonly Action[]>> =
  {
    direction: [...LECTURE_CREANCIER, ...ECRITURE_CREANCIER],
    // Le comptable LIT le bloc créancier mais ne change pas l'IBAN d'encaissement (arbitrage).
    comptable: [...LECTURE_CREANCIER],
    vendeur: [],
    receptionnaire: [],
    chef_atelier: [],
    technicien: [],
    magasinier: [],
    // RF-115 : jamais de droit financier pour admin — voir le commentaire de tête de section. Changer
    // l'IBAN d'encaissement du garage est au moins aussi engageant que rembourser un trop-perçu.
    admin: [],
    // Compte de service (borne d'atelier) : aucun droit dans ce domaine, par construction.
    poste_atelier: [],
  };

// =================================================================================================
// Plafonds financiers de `reception` (RF-117, issue #45 ; ÉTENDU issue #52) : bloc ADDITIF PUR,
// MÊME PALIER que le bloc créancier ci-dessus.
// =================================================================================================
//
// `PATCH /parametres-atelier` (`apps/api/src/parametrage/parametres-atelier/`, PAS le périmètre de
// ce fichier) est le SEUL endpoint qui écrit DEUX colonnes à sémantique IDENTIQUE (`db/schema/
// atelier/parametrage.ts` : NULL = aucun plafond convenu, 0 = accord requis pour tout, n>0 =
// plafond nominal) : `reception.plafondAvoirReceptionnaireCentimes` — le montant au-delà duquel un
// `receptionnaire` ne peut plus émettre un avoir seul (`EMISSION_AVOIR` ci-dessus, contrôlé
// dynamiquement par `ServiceEmissionDocument.emettre()`) — et `reception.plafondDefautCentimes`
// (issue #52 : pas encore consommé par un service au lot 1, mais même famille de politique de
// réception, même table). Preuve en exécution (issue #45, rejouée à l'identique pour #52) :
// connecté `admin`, `PATCH /parametres-atelier { reception: { plafondAvoirReceptionnaireCentimes:
// 999999 } }` PUIS `{ reception: { plafondDefautCentimes: 777777 } }` répondaient tous deux `200`
// et écrivaient la valeur — alors que `RF-115` est littéral (« admin est un rôle technique et n'a
// aucun droit financier »). Fixer l'un OU l'autre de ces plafonds EST un geste financier, au moins
// aussi engageant que changer l'IBAN créancier ou lancer un export fiduciaire : mêmes rôles,
// direction + comptable SEULS, `admin: []` VOLONTAIREMENT.
//
// UN SEUL droit pour les deux champs, pas un par champ (arbitrage issue #52) : même table, même
// commentaire de sémantique tête à tête dans le schéma, même population de rôles gouvernée
// (direction + comptable) — dédoubler l'action aurait ajouté une distinction que rien ne justifie.
// Contraste DÉLIBÉRÉ avec `atelier.or.plafond_modifier` (bloc `atelier/`, hors périmètre de ce
// fichier) : celui-ci gouverne un plafond OPÉRATIONNEL par OR (réceptionnaire + chef_atelier +
// direction), population réellement différente de celle-ci — les deux plafonds ne sont PAS
// fusionnés avec `atelier.or.plafond_modifier`, volontairement.
//
// PAS `parametrage.atelier.modifier` (`INFERE_PARAMETRAGE_GOUVERNANCE`, chef_atelier/direction/admin
// via `DROITS_CHEF_ATELIER`) : ce droit générique gouverne TOUT le reste de l'endpoint (kilométrage
// obligatoire, signature de réception, préfixe OR…) et reste posé statiquement sur la route — la même
// route sert donc PLUSIEURS usages que `@ExigerDroit` ne peut pas distinguer avant exécution (il ne
// connaît pas encore, au moment de la garde, si CE corps touche l'un des deux plafonds). Même famille
// que `atelier.or.plafond_modifier` (`ServiceOr.modifier`) et `vehicule.kilometrage.corriger_regression`
// (`ServiceVehiculeKilometrage.creer`) : contrôle posé EN SERVICE
// (`ServiceParametresAtelier.modifier` → `verifierDroitPlafondsFinanciers`), uniquement quand la
// valeur soumise diffère de la valeur actuelle en base, jamais en permanence — sinon `chef_atelier`
// ne pourrait plus modifier AUCUN réglage ordinaire de ce même endpoint. Couverte par une entrée
// `verification-conditionnelle-service` dans `common/droits/allowlist-actions-non-decorees.ts`, PAS
// par un `@ExigerDroit` statique.
// Pas de `.lire` dédiée : la LECTURE des deux plafonds reste embarquée dans `GET /parametres-atelier`
// sous `parametrage.atelier.lire` (ouvert à tout rôle authentifié), exactement comme
// `atelier.or.plafondCentimes` reste lisible sous `atelier.or.lire` alors que sa modification exige
// `atelier.or.plafond_modifier` — seule l'ÉCRITURE de ces montants est le geste financier que RF-115
// vise, pas leur simple lecture au milieu d'un singleton de paramétrage à 30+ champs très
// majoritairement non financiers. Distinct du bloc créancier (endpoint DÉDIÉ, entièrement financier,
// où lecture ET écriture sont gouvernées) : décision consciente, pas un oubli.
const ECRITURE_PLAFOND_AVOIR_RECEPTIONNAIRE: readonly Action[] = [
  'parametrage.atelier.plafond_avoir.modifier',
];

const DROITS_PLAFOND_AVOIR_RECEPTIONNAIRE_PAR_ROLE: Readonly<
  Record<RoleUtilisateur, readonly Action[]>
> = {
  direction: [...ECRITURE_PLAFOND_AVOIR_RECEPTIONNAIRE],
  comptable: [...ECRITURE_PLAFOND_AVOIR_RECEPTIONNAIRE],
  vendeur: [],
  receptionnaire: [],
  chef_atelier: [],
  technicien: [],
  magasinier: [],
  // RF-115 / issue #45, étendu #52 : jamais de droit financier pour admin — voir le commentaire de
  // tête de section. Fixer l'un ou l'autre des deux plafonds de réception est au moins aussi
  // engageant que rembourser un trop-perçu ou modifier l'IBAN créancier.
  admin: [],
  // Compte de service (borne d'atelier) : aucun droit dans ce domaine, par construction.
  poste_atelier: [],
};

// =================================================================================================
// Export fiduciaire (étape 2) : bloc ADDITIF PUR, même patron et MÊME PALIER que le bloc créancier.
// =================================================================================================
//
// Arbitrage du coordinateur, même motif que le bloc créancier : un lot a livré l'orchestration
// complète de l'export comptable (`apps/api/src/facturation/export/service-export-comptable.ts` —
// sélection des factures/avoirs émis non exportés, continuité de numérotation, écritures
// équilibrées, fichier WinBIZ, marquage `exporte_le`/`export_id`, idempotence) et refusé de câbler
// `POST /exports-fiduciaires` faute de l'action de droit, plutôt que de forcer par un cast (`as
// Action` sur un littéral hors union ne compile pas — pas de porte de sortie silencieuse). Il a bien
// fait, exactement comme pour le bloc créancier.
//
// Transmettre les écritures à la fiduciaire est IRRÉVERSIBLE côté destinataire (le code d'erreur
// `EXPORT_DEJA_TRANSMIS` existe précisément pour ce cas) — au moins aussi engageant qu'un
// remboursement. Mêmes rôles EXACTEMENT que `DISPOSITION_AVANCE_PAIEMENT` et le bloc créancier :
// direction + comptable SEULS, `admin: []` VOLONTAIREMENT — à ne JAMAIS combler par copier-coller
// de `direction` (RF-115).
const DROITS_EXPORT_COMPTABLE_PAR_ROLE: Readonly<Record<RoleUtilisateur, readonly Action[]>> = {
  direction: ['facturation.export.creer', 'facturation.export.lire'],
  comptable: ['facturation.export.creer', 'facturation.export.lire'],
  vendeur: [],
  receptionnaire: [],
  chef_atelier: [],
  technicien: [],
  magasinier: [],
  // RF-115 : jamais de droit financier pour admin — voir le commentaire de tête de section. Transmettre
  // les écritures à la fiduciaire est irréversible côté destinataire, au moins aussi engageant que
  // rembourser un trop-perçu ou modifier l'IBAN créancier.
  admin: [],
  // Compte de service (borne d'atelier) : aucun droit dans ce domaine, par construction.
  poste_atelier: [],
};

// =================================================================================================
// Impression PDF facture QR (étape 2) : bloc ADDITIF PUR, même patron que les blocs ci-dessus.
// =================================================================================================
//
// Accordé EXACTEMENT aux rôles pour lesquels `roleVoitLesMontants()` (`facturation/documents/
// mappeurs.ts`) est vrai — soit tous les rôles SAUF `technicien` (`ROLES_SANS_MONTANT`, const
// partagé) ET `admin` (RF-115/RF-116, ajouté LOCALEMENT par ce module au périmètre facturation, voir
// `ROLES_SANS_MONTANT_FACTURATION` dans `facturation/documents/mappeurs.ts`).
//
// DÉLIBÉRÉMENT PAS calé sur `EMISSION_FACTURE` (direction, comptable, vendeur, receptionnaire
// SEULEMENT) : `chef_atelier` et `magasinier` n'ont pas le droit d'ÉMETTRE une facture (RF-114), mais
// ILS VOIENT LES MONTANTS — donc ils peuvent l'IMPRIMER. Distinction consulter / engager, pas une
// incohérence à aplatir. Voir le commentaire sur l'entrée `TOUTES_ACTIONS` correspondante pour le
// détail de l'arbitrage RF-116, et `matrice-droits.spec.ts` pour le test qui lie ce bloc à
// `roleVoitLesMontants()` de façon vérifiable à l'exécution.
const DROITS_IMPRESSION_PAR_ROLE: Readonly<Record<RoleUtilisateur, readonly Action[]>> = {
  direction: ['facturation.document.imprimer'],
  comptable: ['facturation.document.imprimer'],
  vendeur: ['facturation.document.imprimer'],
  receptionnaire: ['facturation.document.imprimer'],
  chef_atelier: ['facturation.document.imprimer'],
  magasinier: ['facturation.document.imprimer'],
  technicien: [],
  // RF-115/RF-116 : admin ne voit pas les montants en facturation (ROLES_SANS_MONTANT_FACTURATION =
  // ROLES_SANS_MONTANT + admin) — il ne doit donc pas pouvoir les imprimer non plus. `[]`
  // VOLONTAIREMENT, jamais à combler par copier-coller de `direction`.
  admin: [],
  // Compte de service (borne d'atelier) : aucun droit dans ce domaine, par construction.
  poste_atelier: [],
};

// =================================================================================================
// Pièces (étape 3) : bloc ADDITIF PUR, calé sur la matrice §11 de
// docs/specification-etape-3-pieces.md — même patron que les blocs facturation ci-dessus (rôles
// listés explicitement, jamais composés depuis `DROITS_RECEPTIONNAIRE`/`DROITS_CHEF_ATELIER` : la
// hiérarchie habituelle chef_atelier ⊇ receptionnaire NE TIENT PAS ici — `magasinier` a l'écriture
// stock complète, `chef_atelier` n'a que la lecture pour `pieces.mouvement.creer`).
//
// LITTÉRAL : `admin` reçoit `[]` sur TOUT le domaine pièces, y compris la simple LECTURE — la
// matrice §11 écrit « non (RF-115, aucun droit métier) » jusque sur la ligne « Consulter
// article/stock », ce qui est plus strict que la doctrine habituelle de ce fichier (`admin` =
// superset de `direction` pour le lot 1 atelier/clients) : ici `admin` n'a AUCUN droit métier
// pièces, ni écriture ni lecture, jamais à combler par copier-coller de `direction`. CONFIRMÉ,
// DÉLIBÉRÉ (issue #21, tranchée 12.08.2026, voir tête de fichier) : `admin` administre le système,
// il ne touche pas au stock — `direction` (le patron, qui vend et dépanne ses employés) le voit.
//
// COLONNES « (P) » DE LA MATRICE §11 — paramétrables en théorie, NON implémentées ce lot (aucun
// paramètre `parametre_pieces` ne porte ces réglages, voir `contrats/pieces/parametrage.ts`,
// `PP-01`→`PP-08`) : traitées comme leur valeur par défaut LITTÉRALE de la matrice, jamais comme un
// « oui » optimiste :
//  - « Voir prix d'achat / marge » (vendeur/receptionnaire « non (P) », chef_atelier « oui (P) ») :
//    filtrage de CHAMP, pas une action de droit — voir `pieces/mappers.ts::ROLES_SANS_PRIX_ACHAT_PIECES`.
//  - « Enregistrer une entrée/sortie », « Réceptionner une commande » (direction/chef_atelier
//    « non (P) ») : traité `non` ferme pour `pieces.mouvement.creer` — seul `magasinier` l'a.
//
// PÉRIMÈTRE DE CE LOT (voir `pieces/pieces.module.ts`, tête de fichier) : commande fournisseur,
// consigne et vente comptoir (dernières lignes de la matrice §11) N'ONT AUCUNE route dans ce lot —
// aucune action de droit correspondante n'est créée (ni ici ni dans `TOUTES_ACTIONS`), pour ne pas
// inventer une action inerte sans justification dans `allowlist-actions-non-decorees.ts`.

/** §11 ligne « Consulter article/stock » — tous les rôles opérationnels, PAS `admin` (RF-115). */
const LECTURE_PIECES: readonly Action[] = [
  'pieces.article.lire',
  'pieces.stock.lire',
  'pieces.reservation.lire',
];

/** §11 ligne « Créer/modifier un article » : direction, chef_atelier `[À VALIDER]`, magasinier. */
const ECRITURE_ARTICLE_PIECES: readonly Action[] = [
  'pieces.article.creer',
  'pieces.article.modifier',
];

/**
 * Inféré — réglages de stock par site (`PATCH /articles/{id}/stock/{siteId}`, emplacement/seuils,
 * `PP-08`) : aucune ligne §11 littérale, aligné sur le même périmètre que « Créer/modifier un
 * article » (direction, chef_atelier, magasinier) — c'est une donnée de référentiel au même titre.
 */
const ECRITURE_STOCK_SITE_PIECES: readonly Action[] = ['pieces.stock.modifier'];

/**
 * §11 lignes « Enregistrer une entrée/sortie », « Réceptionner une commande », « Faire
 * l'inventaire » : `magasinier` SEUL de façon ferme (direction/chef_atelier marqués « non (P) »,
 * traité `non` faute de paramètre — voir la note de tête de section).
 */
const ECRITURE_MOUVEMENT_PIECES: readonly Action[] = ['pieces.mouvement.creer'];

/**
 * FAILLE CORRIGÉE (audit sécurité) — `forcer: true` sur `casse`/`perte` outrepasse le refus de
 * stock insuffisant (`RP-15`/`PP-02`) ; ce droit dédié le gouverne, EN PLUS de
 * `ECRITURE_MOUVEMENT_PIECES` (les deux sont exigés ensemble par `ServiceMouvement`, `forcer` ne
 * sert jamais seul). Réservé à `magasinier` : c'est le SEUL rôle qui détient déjà l'écriture de
 * mouvement (§11, « non (P) » pour direction/chef_atelier — voir la note de tête de section), et
 * le rôle qui constate PHYSIQUEMENT une casse/perte que le système croit ne pas pouvoir couvrir —
 * la même logique que `PP-02`, qui n'a jamais remis en cause QUI force, seulement l'absence de
 * droit dédié pour le faire. Ne pas l'accorder en plus à `direction`/`chef_atelier` : sans
 * `pieces.mouvement.creer` (qu'ils n'ont pas), le droit y serait inerte — un signal trompeur
 * plutôt qu'un contrôle réel. Si `pieces.mouvement.creer` est un jour étendu à un autre rôle, ce
 * fichier devra alors statuer EXPLICITEMENT sur `pieces.mouvement.forcer` pour ce rôle plutôt que
 * de l'hériter silencieusement — exactement le trou que cette action ferme.
 */
const FORCAGE_MOUVEMENT_PIECES: readonly Action[] = ['pieces.mouvement.forcer'];

/**
 * §11 ligne « Créer une réservation (ligne d'OR pièce) » : DÉJÀ couverte par
 * `atelier.ligne.creer` (`L966_LIGNE_CREATION`, voir la note littérale de la matrice §11 elle-même)
 * — aucune action `pieces.reservation.creer` n'existe, la création n'a pas de route dans ce
 * contrat (`reservation.ts`, GELÉ : « AUCUN `POST /reservations` »). `satisfaire` = §11 ligne
 * « Enregistrer une sortie » (même périmètre que `ECRITURE_MOUVEMENT_PIECES`, magasinier seul).
 */
const SATISFACTION_RESERVATION_PIECES: readonly Action[] = ['pieces.reservation.satisfaire'];

/** §11 ligne « Libérer une réservation active » : direction, chef_atelier, magasinier. */
const LIBERATION_RESERVATION_PIECES: readonly Action[] = ['pieces.reservation.liberer'];

// ---- Pièces, second relais (fournisseurs, commandes fournisseur, consignes, paramétrage) --------
// Transmis par le mainteneur pour le compte du lot qui a complété le module Pièces, même
// patron additif que le reste de ce fichier. `admin: []` reconduit SANS EXCEPTION (RF-115, déjà
// littéral sur TOUTE la matrice §11 pièces — voir la note de tête de section ci-dessus) : le stock
// (fournisseurs, commandes, consignes) porte une valeur financière (COGS, valorisation
// d'inventaire) au même titre que les articles déjà tranchés `admin: []`. Ce traitement DIFFÈRE
// délibérément de `atelier.pointage.*` (bloc suivant, `admin` y reçoit les 6 actions) : le pointage
// enregistre du TEMPS de travail, pas une valeur monétaire — pas une incohérence, une distinction
// cohérente avec la lecture stricte de RF-115 (« aucun droit FINANCIER ») déjà appliquée ailleurs
// dans ce fichier (le bloc créancier et l'export fiduciaire, par exemple, sont eux aussi `admin: []`
// alors que `parametrage.atelier.modifier`/`parametrage.referentiel.modifier` ne le sont pas — la
// même nature de geste peut recevoir un traitement différent selon qu'il touche ou non à l'argent).
const LECTURE_FOURNISSEUR_PIECES: readonly Action[] = ['pieces.fournisseur.lire'];
const ECRITURE_FOURNISSEUR_PIECES: readonly Action[] = [
  'pieces.fournisseur.creer',
  'pieces.fournisseur.modifier',
];
const LECTURE_COMMANDE_FOURNISSEUR_PIECES: readonly Action[] = ['pieces.commande_fournisseur.lire'];
const ECRITURE_COMMANDE_FOURNISSEUR_PIECES: readonly Action[] = [
  'pieces.commande_fournisseur.creer',
];
/** Couvre aussi l'annulation de reliquat (note du lot, pas une seconde action distincte). */
const RECEPTION_COMMANDE_FOURNISSEUR_PIECES: readonly Action[] = [
  'pieces.commande_fournisseur.reception',
];
const LECTURE_CONSIGNE_PIECES: readonly Action[] = ['pieces.consigne.lire'];
const RETOUR_CONSIGNE_PIECES: readonly Action[] = ['pieces.consigne.retourner'];
const LECTURE_PARAMETRAGE_PIECES: readonly Action[] = ['pieces.parametrage.lire'];
const ECRITURE_PARAMETRAGE_PIECES: readonly Action[] = ['pieces.parametrage.modifier'];

/**
 * Factures fournisseur — bascule depuis le palliatif `droits-provisoires.ts` du module
 * (`pieces/factures-fournisseur/`), retiré. Décision métier, PAS une reconduction mécanique du
 * palliatif ni du front : les deux ont été confrontés à la matrice §11 pièces déjà tranchée
 * ci-dessus, et à trois traits propres à une facture fournisseur (engage de l'argent, pièce
 * comptable soumise à conservation art. 958f CO, rapprochement = acte de contrôle) :
 *
 *  - LECTURE : `direction`, `chef_atelier`, `magasinier` — même trio EXACT que
 *    `LECTURE_FOURNISSEUR_PIECES`/`LECTURE_COMMANDE_FOURNISSEUR_PIECES` ci-dessus (`chef_atelier`
 *    y est déjà traité à l'identique de `direction` sur tout le cluster fournisseur/commande —
 *    consulter la facture qui règle CE QU'IL a commandé n'est pas un droit nouveau, c'est la
 *    continuation du même périmètre). `comptable` AJOUTÉ, même raisonnement que
 *    `LECTURE_CONSIGNE_PIECES` (« une créance/dépense qui dort », pièce comptable RF-conservation) —
 *    PAS `admin` (RF-115, §11 littéral « non, aucun droit métier », déjà appliqué à TOUT le domaine
 *    pièces, une facture fournisseur est financière au même titre qu'un article/une consigne).
 *  - ÉCRITURE (déposer, valider/rejeter le rapprochement) : `magasinier` SEUL — même périmètre
 *    EXACT que `RECEPTION_COMMANDE_FOURNISSEUR_PIECES` ci-dessus, pas `ECRITURE_FOURNISSEUR_PIECES`/
 *    `ECRITURE_COMMANDE_FOURNISSEUR_PIECES` (direction/chef_atelier créent/gèrent la RELATION
 *    fournisseur et la commande, mais ni l'un ni l'autre ne détient la réception physique — le
 *    dépôt/rapprochement d'une facture est le même geste de confirmation, pas un acte de gestion).
 *    `comptable` explicitement EXCLU de l'écriture malgré la lecture : hors des domaines
 *    `facturation.`/`ventes.`, `comptable` ne détient QUE des actions `.lire` dans cette matrice
 *    (invariant vérifié par `matrice-droits.spec.ts`, section pointage) — rapprocher une facture
 *    fournisseur reste un contrôle terrain (comparer livraison/commande), pas un geste comptable au
 *    sens de cette matrice.
 *
 * Corrige une divergence RÉELLE trouvée entre ce palliatif et `apps/web/src/ecrans/pieces/
 * droits.ts` : le front avait déjà ce périmètre EXACT (jamais modifié par cette bascule), le
 * palliatif serveur accordait à tort `admin`/`direction` en écriture et refusait à tort
 * `chef_atelier` en lecture — voir le rapport de livraison pour le détail du sens de la divergence.
 */
const LECTURE_FACTURE_FOURNISSEUR_PIECES: readonly Action[] = ['pieces.facture_fournisseur.lire'];
const ECRITURE_FACTURE_FOURNISSEUR_PIECES: readonly Action[] = [
  'pieces.facture_fournisseur.deposer',
  'pieces.facture_fournisseur.valider',
  'pieces.facture_fournisseur.rejeter',
];

/** Les 8 gestes de stock/réception, accordés à `magasinier` ET à `direction` (phase 0 rôles). */
const ACTIONS_MAGASINIER_ACCORDEES_A_DIRECTION: readonly Action[] = [
  ...ECRITURE_MOUVEMENT_PIECES,
  ...FORCAGE_MOUVEMENT_PIECES,
  ...SATISFACTION_RESERVATION_PIECES,
  ...RECEPTION_COMMANDE_FOURNISSEUR_PIECES,
  ...RETOUR_CONSIGNE_PIECES,
  ...ECRITURE_FACTURE_FOURNISSEUR_PIECES,
];

const DROITS_PIECES_PAR_ROLE: Readonly<Record<RoleUtilisateur, readonly Action[]>> = {
  direction: [
    ...LECTURE_PIECES,
    ...ECRITURE_ARTICLE_PIECES,
    ...ECRITURE_STOCK_SITE_PIECES,
    ...LIBERATION_RESERVATION_PIECES,
    ...LECTURE_FOURNISSEUR_PIECES,
    ...ECRITURE_FOURNISSEUR_PIECES,
    ...LECTURE_COMMANDE_FOURNISSEUR_PIECES,
    ...ECRITURE_COMMANDE_FOURNISSEUR_PIECES,
    ...LECTURE_CONSIGNE_PIECES,
    ...LECTURE_PARAMETRAGE_PIECES,
    ...ECRITURE_PARAMETRAGE_PIECES,
    ...LECTURE_FACTURE_FOURNISSEUR_PIECES,
    // Phase 0 rôles : dans un petit garage sans magasinier, le patron EST le magasinier — sans
    // ces 8 gestes personne ne pouvait réceptionner une livraison ni valider une facture
    // fournisseur. `direction` devient donc un sur-ensemble du magasinier sur tout le domaine.
    // `chef_atelier` NE les reçoit PAS (matrice §11 « non (P) » maintenue : il gère la relation
    // fournisseur et la commande, la réception reste un geste de stock) ; `admin` reste `[]`.
    ...ACTIONS_MAGASINIER_ACCORDEES_A_DIRECTION,
  ],
  // Consigne : une consigne d'échange standard jamais rendue est une créance qui dort — donnée
  // financière, INFÉRÉ par le lot qui a livré ce bloc (pas une ligne littérale de la matrice §11).
  // Facture fournisseur : même raisonnement — voir le commentaire de tête de
  // `LECTURE_FACTURE_FOURNISSEUR_PIECES` ci-dessus.
  comptable: [...LECTURE_PIECES, ...LECTURE_CONSIGNE_PIECES, ...LECTURE_FACTURE_FOURNISSEUR_PIECES],
  vendeur: [...LECTURE_PIECES],
  receptionnaire: [...LECTURE_PIECES],
  chef_atelier: [
    ...LECTURE_PIECES,
    ...ECRITURE_ARTICLE_PIECES,
    ...ECRITURE_STOCK_SITE_PIECES,
    ...LIBERATION_RESERVATION_PIECES,
    ...LECTURE_FOURNISSEUR_PIECES,
    ...ECRITURE_FOURNISSEUR_PIECES,
    ...LECTURE_COMMANDE_FOURNISSEUR_PIECES,
    ...ECRITURE_COMMANDE_FOURNISSEUR_PIECES,
    ...LECTURE_CONSIGNE_PIECES,
    ...LECTURE_PARAMETRAGE_PIECES,
    ...ECRITURE_PARAMETRAGE_PIECES,
    ...LECTURE_FACTURE_FOURNISSEUR_PIECES,
  ],
  magasinier: [
    ...LECTURE_PIECES,
    ...ECRITURE_ARTICLE_PIECES,
    ...ECRITURE_STOCK_SITE_PIECES,
    ...ECRITURE_MOUVEMENT_PIECES,
    ...FORCAGE_MOUVEMENT_PIECES,
    ...SATISFACTION_RESERVATION_PIECES,
    ...LIBERATION_RESERVATION_PIECES,
    ...LECTURE_FOURNISSEUR_PIECES,
    ...ECRITURE_FOURNISSEUR_PIECES,
    ...LECTURE_COMMANDE_FOURNISSEUR_PIECES,
    ...ECRITURE_COMMANDE_FOURNISSEUR_PIECES,
    ...RECEPTION_COMMANDE_FOURNISSEUR_PIECES,
    ...LECTURE_CONSIGNE_PIECES,
    ...RETOUR_CONSIGNE_PIECES,
    // Exécute la politique de stock, ne la fixe pas : lecture seule du paramétrage.
    ...LECTURE_PARAMETRAGE_PIECES,
    ...LECTURE_FACTURE_FOURNISSEUR_PIECES,
    ...ECRITURE_FACTURE_FOURNISSEUR_PIECES,
  ],
  technicien: [...LECTURE_PIECES],
  // RF-115, littéral sur TOUTE la matrice §11 (y compris la lecture) — voir la note de tête de
  // section. `[]` VOLONTAIREMENT, jamais à combler par copier-coller de `direction`.
  admin: [],
  // Compte de service (borne d'atelier) : aucun droit dans ce domaine, par construction.
  poste_atelier: [],
};

// =================================================================================================
// Ventes VN/VO (étape 4) : bloc ADDITIF PUR, calé sur la matrice §11 de
// docs/specification-etape-4-ventes.md — même patron que les blocs facturation/pièces ci-dessus
// (rôles listés EXPLICITEMENT par domaine, jamais composés depuis `DROITS_RECEPTIONNAIRE`/
// `DROITS_CHEF_ATELIER`/`DROITS_DIRECTION` : §11 ne couvre QUE 4 des 8 rôles — vendeur, direction,
// comptable, receptionnaire — et ne suit ni la hiérarchie chef_atelier ⊇ receptionnaire ni la
// doctrine « admin = superset de direction » de l'étape 1).
//
// §11 EST LITTÉRAL SUR 9 LIGNES SEULEMENT (`docs/specification-etape-4-ventes.md`, lignes 720-730) :
//   1. Créer/modifier un dossier de vente en `prospection`         → vendeur, direction
//   2. Faire signer un bon de commande                              → vendeur, direction
//   3. Saisir une estimation/valeur de reprise négociée              → vendeur, direction
//   4. Voir la marge d'un véhicule en stock (RV-06)         [À VALIDER, QV-15 pour vendeur] → direction, comptable
//   5. Émettre la facture de vente               → vendeur, direction, comptable (DÉJÀ couvert par
//      `EMISSION_FACTURE` du bloc RF-114 ci-dessus — cette ligne confirme, n'ajoute aucune action)
//   6. Émettre un avoir sur une facture de vente  → direction, comptable, PAS vendeur (idem, déjà
//      couvert par `EMISSION_AVOIR` — confirme l'absence de `vendeur` dans ce bloc, pas ajouté ici)
//   7. Confirmer un financement/leasing                     → vendeur, direction, comptable
//   8. Enregistrer la livraison (changement de détention)   → vendeur, direction ; receptionnaire
//      « possible selon organisation » [À VALIDER, QV-16]
//   9. Modifier le prix d'achat/frais de remise en état     [À VALIDER, QV-15 pour vendeur] → direction
//
// DEUX LIGNES « [À VALIDER] » CÔTÉ SPEC (QV-15 : marge/prix d'achat visibles/modifiables par
// `vendeur` ? ; QV-16 : `receptionnaire` peut-il enregistrer une livraison ?) — traitées ici en
// position CONSERVATRICE, REFUSÉES plutôt qu'accordées par optimisme : `vendeur` ne reçoit AUCUNE
// action d'ÉCRITURE sur `vehicule_stock` (seulement `ventes.vehicule_stock.lire` — le champ
// `prixAchatCentimes` du contrat gelé `contrats/ventes/vehicule-stock.ts::ReponseVehiculeStock`
// est de toute façon `number` non-nullable, PAS `number | null` comme `pieces/article.ts` — le
// contrat gelé ne permet même pas de MASQUER ce champ par rôle, seulement de refuser l'ÉCRITURE ;
// masquer la lecture demanderait de rouvrir ce contrat, hors périmètre de ce lot) ;
// `receptionnaire` ne reçoit PAS `ventes.dossier.livrer`. **À CONFIRMER AVEC @laupernoe** — voir le
// rapport de livraison.
//
// ACTIONS ABSENTES DE §11, INFÉRÉES (le cycle de vie complet du dossier — `preparer`,
// `marquer_pret_a_livrer`, `cloturer`, `annuler`, `abandonner` ; la création/le refus de
// financement ; la lecture de chaque sous-domaine ; la correction exceptionnelle
// `remettre-disponible` de `vehicule_stock`) : §11 ne prétend documenter que 9 gestes emblématiques,
// pas l'intégralité de la machine à états gelée (`enums.ts::ACTIONS_DOSSIER_VENTE` compte 10
// verbes, `ACTIONS_REPRISE` 4, `ACTIONS_FINANCEMENT` 2). Chaque inférence suit le même principe que
// le reste de ce fichier : le rôle qui « signe le bon de commande » (`vendeur`, ligne 2) est celui
// qui pilote le dossier de bout en bout — il reçoit donc le cycle de vie complet du dossier —, et
// la correction exceptionnelle de `vehicule_stock` (`remettre-disponible`, motif obligatoire, même
// doctrine que `vehicule.detention.corriger`) reste réservée à `direction` seule.
//
// RF-115 REPRIS ICI, décision de CE bloc (pas une ligne littérale de §11, qui ne mentionne même
// pas `admin`) : `admin` reçoit `[]` sur TOUT le domaine ventes, y compris la simple lecture — même
// palier que le domaine pièces (étape 3) et le domaine financier de la facturation (étape 2). Un
// dossier de vente porte un prix de véhicule, une valeur de reprise négociée, un financement — au
// moins aussi engageant financièrement que les domaines déjà tranchés `admin: []`. **DÉCISION DE
// CE LOT, pas une ligne §11** : à confirmer avec @laupernoe au même titre que QV-15/QV-16 — voir le
// rapport de livraison. Ne JAMAIS combler par copier-coller de `direction`.
//
// `chef_atelier` reçoit une lecture MINIMALE (`vehicule_stock.lire`, `dossier.lire`) — INFÉRÉE,
// coordination opérationnelle de la préparation d'une VO (remise en état, § « chef d'atelier
// arbitre les gestes commerciaux », doctrine déjà posée à l'étape 1) — PAS `reprise.lire` ni
// `financement.lire` (détail financier sans besoin opérationnel identifié). `technicien` et
// `magasinier` ne sont acteurs d'AUCUNE ligne de §11 : `[]`.

/** §11 ligne 4 (comptable/direction), + `vehicule_stock.lire` étendu à tous les acteurs du domaine
 *  pour ne pas bloquer la lecture de la fiche à laquelle un dossier de vente s'accroche. */
const LECTURE_VEHICULE_STOCK: readonly Action[] = ['ventes.vehicule_stock.lire'];

/** Écriture `vehicule_stock` (mise en stock, PATCH, réception) : §11 ligne 9 ne donne l'écriture
 *  qu'à `direction` (`vendeur` `[À VALIDER, QV-15]`, traité `non` en attendant). */
const ECRITURE_VEHICULE_STOCK: readonly Action[] = [
  'ventes.vehicule_stock.creer',
  'ventes.vehicule_stock.modifier',
];

/** Correction exceptionnelle (`remettre-disponible`, motif obligatoire) — INFÉRÉE, réservée à
 *  `direction` seule, même doctrine que `vehicule.detention.corriger` (étape 1). */
const CORRECTION_VEHICULE_STOCK: readonly Action[] = ['ventes.vehicule_stock.corriger'];

const LECTURE_DOSSIER_VENTE: readonly Action[] = ['ventes.dossier.lire'];

/** §11 lignes 1/2 : créer/modifier un dossier en `prospection`, faire signer le bon de commande
 *  (`engager`) — `vendeur`, `direction`. Étendu (INFÉRÉ) au reste du cycle de vie du dossier :
 *  `preparer`, `marquer_pret_a_livrer`, `cloturer`, `annuler`, `abandonner` — voir la note de tête
 *  de section. `livrer` séparé ci-dessous (§11 ligne 8, receptionnaire `[À VALIDER, QV-16]`). */
const ECRITURE_DOSSIER_VENTE_HORS_LIVRAISON: readonly Action[] = [
  'ventes.dossier.creer',
  'ventes.dossier.modifier',
  'ventes.dossier.engager',
  'ventes.dossier.preparer',
  'ventes.dossier.marquer_pret_a_livrer',
  'ventes.dossier.cloturer',
  'ventes.dossier.annuler',
  'ventes.dossier.abandonner',
];

/** §11 ligne 8 : `vendeur`, `direction`. `receptionnaire` « possible selon organisation »
 *  `[À VALIDER, QV-16]` — EXCLU ici, position conservatrice (voir note de tête de section). */
const LIVRAISON_DOSSIER_VENTE: readonly Action[] = ['ventes.dossier.livrer'];

const LECTURE_REPRISE: readonly Action[] = ['ventes.reprise.lire'];

/** §11 ligne 3 : `vendeur`, `direction` — création de l'estimation, modification, négociation. */
const ECRITURE_REPRISE_NEGOCIATION: readonly Action[] = [
  'ventes.reprise.creer',
  'ventes.reprise.modifier',
  'ventes.reprise.negocier',
];

/** INFÉRÉ — le refus (le client garde son véhicule) suit le même périmètre que la négociation :
 *  c'est une décision commerciale courante, pas une correction exceptionnelle. */
const REFUS_REPRISE: readonly Action[] = ['ventes.reprise.refuser'];

/** INFÉRÉ — `confirmer` est NORMALEMENT un effet de bord de `dossier.engager` (RV-19/RV-27) ;
 *  l'appel DIRECT n'existe que pour la correction exceptionnelle (dossier orphelin,
 *  resynchronisation, motif obligatoire) — réservé à `direction` seule, même doctrine que
 *  `ventes.vehicule_stock.corriger`. */
const CONFIRMATION_REPRISE: readonly Action[] = ['ventes.reprise.confirmer'];

const LECTURE_FINANCEMENT: readonly Action[] = ['ventes.financement.lire'];

/** §11 ligne 7 : `vendeur`, `direction`, `comptable` — confirmer un financement/leasing. Étendu
 *  (INFÉRÉ) à la création de la proposition de financement et à son refus direct (flip-side de la
 *  confirmation, §7.3 : un refus fait revenir le dossier « en attente d'un nouveau mode de
 *  financement », c'est un événement courant du parcours de vente, pas une correction). */
const ECRITURE_FINANCEMENT: readonly Action[] = [
  'ventes.financement.creer',
  'ventes.financement.confirmer',
  'ventes.financement.refuser',
];

const DROITS_VENTES_PAR_ROLE: Readonly<Record<RoleUtilisateur, readonly Action[]>> = {
  direction: [
    ...LECTURE_VEHICULE_STOCK,
    ...ECRITURE_VEHICULE_STOCK,
    ...CORRECTION_VEHICULE_STOCK,
    ...LECTURE_DOSSIER_VENTE,
    ...ECRITURE_DOSSIER_VENTE_HORS_LIVRAISON,
    ...LIVRAISON_DOSSIER_VENTE,
    ...LECTURE_REPRISE,
    ...ECRITURE_REPRISE_NEGOCIATION,
    ...REFUS_REPRISE,
    ...CONFIRMATION_REPRISE,
    ...LECTURE_FINANCEMENT,
    ...ECRITURE_FINANCEMENT,
  ],
  comptable: [
    ...LECTURE_VEHICULE_STOCK,
    ...LECTURE_DOSSIER_VENTE,
    ...LECTURE_REPRISE,
    ...LECTURE_FINANCEMENT,
    'ventes.financement.confirmer',
    'ventes.financement.refuser',
  ],
  vendeur: [
    ...LECTURE_VEHICULE_STOCK,
    ...LECTURE_DOSSIER_VENTE,
    ...ECRITURE_DOSSIER_VENTE_HORS_LIVRAISON,
    ...LIVRAISON_DOSSIER_VENTE,
    ...LECTURE_REPRISE,
    ...ECRITURE_REPRISE_NEGOCIATION,
    ...REFUS_REPRISE,
    ...LECTURE_FINANCEMENT,
    ...ECRITURE_FINANCEMENT,
  ],
  receptionnaire: [
    ...LECTURE_VEHICULE_STOCK,
    ...LECTURE_DOSSIER_VENTE,
    ...LECTURE_REPRISE,
    ...LECTURE_FINANCEMENT,
  ],
  chef_atelier: [...LECTURE_VEHICULE_STOCK, ...LECTURE_DOSSIER_VENTE],
  technicien: [],
  magasinier: [],
  // RF-115, appliqué ICI par décision de ce lot (§11 ne mentionne pas admin) — voir la note de
  // tête de section : `[]` VOLONTAIREMENT, jamais à combler par copier-coller de `direction`.
  admin: [],
  // Compte de service (borne d'atelier) : aucun droit dans ce domaine, par construction.
  poste_atelier: [],
};

// =================================================================================================
// Pointage (lot 2) : bloc ADDITIF PUR transmis par le mainteneur pour le compte du lot
// `pointage/` — même patron que les blocs précédents. Table proposée à l'origine : `chef_atelier`/
// `direction`/`admin` reçoivent les actions d'encadrement (dont `pointer_autrui`, ajouté par la
// correction de faille — voir sa définition dans `TOUTES_ACTIONS`) ; `technicien`/`magasinier`
// reçoivent `demarrer`/`arreter`/`lire` (ce sont eux qui pointent, POUR EUX-MÊMES uniquement — ils
// n'ont PAS `pointer_autrui`, donc pas d'imputation d'heures à un collègue) ; `comptable` recevrait
// la gouvernance de période ;
// `receptionnaire`/`vendeur` aucune (le pointage n'est pas leur outil). CORRIGÉ depuis : `comptable`
// ne reçoit NI `verrouiller_periode` NI `deverrouiller_periode` — voir l'arbitrage détaillé au-dessus
// de `DROITS_POINTAGE_PAR_ROLE` ci-dessous (invariant « comptable = lecture-seule hors facturation/
// ventes », `matrice-droits.spec.ts`).
//
// `admin` REÇOIT LES 6 — décision reprise TELLE QUELLE, vérifiée COHÉRENTE avec la doctrine de ce
// fichier : `RF-115` (« admin n'a AUCUN droit financier ») ne s'applique qu'aux blocs qui
// manipulent de l'argent (paiements, documents de vente, créancier QR, export fiduciaire, PLUS,
// décision de CE LOT, le domaine ventes ci-dessus) — le pointage enregistre du TEMPS de travail,
// pas un montant. `admin` reste ici le rôle technique/propriétaire du tenant, superset de
// `direction`, doctrine de tête de fichier (lot 1) : cohérent avec `parametrage.atelier.modifier`/
// `parametrage.referentiel.modifier`, qui donnent eux aussi l'écriture à `admin` sans réserve
// RF-115. Aucune raison de traiter le pointage plus durement que le paramétrage atelier.
//
// `verrouiller_periode` / `deverrouiller_periode` — NI L'UNE NI L'AUTRE pour `comptable` : arbitrage
// de @laupernoe (2026-08-03), qui corrige une décision antérieure de ce fichier. Un premier passage avait
// accordé `verrouiller_periode` à `comptable` par symétrie avec `atelier.or.terminer`/`atelier.or.
// cloturer` (clôture largement accordée), tout en réservant `deverrouiller_periode` à `chef_atelier`/
// `direction`/`admin` seuls — précédent invoqué : `INFERE_OR_ROUVRIR` (`atelier.or.rouvrir`, T-15)
// réservé de la même façon, alors que la fermeture symétrique (`atelier.or.terminer`) est accordée à
// `receptionnaire` en plus. Cette demi-mesure heurtait un invariant DÉJÀ écrit dans ce fichier et
// vérifié par `matrice-droits.spec.ts` (« comptable — consulte, ne modifie rien dans l'atelier… ») :
// hors des domaines `facturation.`/`ventes.`, `comptable` ne détient QUE des actions `.lire` ou
// `recherche.executer` — jamais d'écriture. `verrouiller_periode` n'est ni l'un ni l'autre.
//
// Sur le fond, PAS seulement un problème de forme : verrouiller une période de pointage fige des
// heures de travail avant la paie ; déverrouiller rouvre des heures déjà figées. Les deux gestes
// sont la même famille de décision — CLORE l'enregistrement du temps de travail d'une équipe pour
// une période — au même titre que `atelier.or.terminer`/`atelier.or.cloturer` sont une décision
// d'atelier, pas un geste comptable : c'est du droit du travail (qui peut figer/rouvrir des heures
// déclarées), pas de la comptabilité (qui les REÇOIT, déjà closes, pour préparer la paie/la
// facturation). `comptable` reste donc strictement lecture-seule sur le domaine pointage, exactement
// comme sur `atelier.or.*` (`DROITS_COMPTABLE`, tête de fichier) — les deux actions de verrouillage
// appartiennent à `chef_atelier`/`direction`/`admin` SEULS.
//
// NOTE : `comptable` ne détient PAS non plus `atelier.pointage.lire` dans ce bloc (héritage de la
// table transmise par le lot `pointage/`, jamais réexaminé ici) — hors périmètre de cette
// correction, qui porte UNIQUEMENT sur les deux actions de verrouillage signalées par le test.
//
// `gerer_pin` (RM-128, mode borne) — `chef_atelier`/`direction`/`admin`, exactement le trio qui
// détient déjà `corriger_autrui` et les deux verrouillages de période. Volontairement PLUS
// permissif que `parametrage.atelier.modifier` (direction/admin), qui gouverne le MODE du site :
// changer le mode d'un site est une décision d'organisation rare ; attribuer ou réinitialiser un
// PIN est un geste quotidien d'atelier (embauche, oubli, code soupçonné connu d'un collègue) qui
// ne doit pas attendre la direction. Le technicien NE PEUT PAS s'auto-attribuer un PIN : il n'est
// dans aucune de ces trois listes, et l'auto-service est explicitement reporté.
const DROITS_POINTAGE_PAR_ROLE: Readonly<Record<RoleUtilisateur, readonly Action[]>> = {
  chef_atelier: [
    'atelier.pointage.demarrer',
    'atelier.pointage.arreter',
    'atelier.pointage.lire',
    'atelier.pointage.pointer_autrui',
    'atelier.pointage.corriger_autrui',
    'atelier.pointage.verrouiller_periode',
    'atelier.pointage.deverrouiller_periode',
    'atelier.pointage.gerer_pin',
  ],
  direction: [
    'atelier.pointage.demarrer',
    'atelier.pointage.arreter',
    'atelier.pointage.lire',
    'atelier.pointage.pointer_autrui',
    'atelier.pointage.corriger_autrui',
    'atelier.pointage.verrouiller_periode',
    'atelier.pointage.deverrouiller_periode',
    'atelier.pointage.gerer_pin',
  ],
  admin: [
    'atelier.pointage.demarrer',
    'atelier.pointage.arreter',
    'atelier.pointage.lire',
    'atelier.pointage.pointer_autrui',
    'atelier.pointage.corriger_autrui',
    'atelier.pointage.verrouiller_periode',
    'atelier.pointage.deverrouiller_periode',
    'atelier.pointage.gerer_pin',
  ],
  technicien: ['atelier.pointage.demarrer', 'atelier.pointage.arreter', 'atelier.pointage.lire'],
  magasinier: ['atelier.pointage.demarrer', 'atelier.pointage.arreter', 'atelier.pointage.lire'],
  // La borne : elle pointe pour le compte du technicien que le PIN vient de désigner, et elle
  // identifie. Rien d'autre du domaine pointage — surtout PAS `corriger_autrui` (une correction se
  // fait au bureau, depuis un compte nominatif, RM-131) ni les verrouillages de période.
  poste_atelier: [
    'atelier.pointage.identifier',
    'atelier.pointage.demarrer',
    'atelier.pointage.arreter',
    'atelier.pointage.lire',
  ],
  // Arbitrage @laupernoe (2026-08-03, documenté ci-dessus) : NI verrouiller NI déverrouiller — comptable
  // reste lecture-seule hors facturation/ventes, cet invariant prime sur la table transmise.
  comptable: [],
  receptionnaire: [],
  vendeur: [],
};

// =================================================================================================
// Tableau de bord — activité atelier + stock (arbitrage coordinateur, quantités/comptes seulement)
// =================================================================================================
//
// `GET /tableau-bord/activite` (`apps/api/src/tableau-bord/`) restait sous `@AucunDroitRequis()` +
// une vérification de rôle posée EN SERVICE (`tableau-bord/droits-provisoires.ts`, retiré par ce
// bloc), faute d'accès de son auteur à ce fichier — palliatif signalé par le lot, pas un accès
// ouvert par négligence, même patron que le bloc créancier avant que ses actions n'existent.
//
// AUCUN montant dans cette réponse (OR par statut, délai moyen de restitution, lignes en attente
// de validation, articles sous seuil de réapprovisionnement — voir `ReponseActiviteTableauBord`,
// `@dfa/shared`) : même doctrine que `LECTURE_ETENDUE` (tête de fichier, « la lecture est ouverte
// par défaut, seule l'écriture est gouvernée »). Ouvert aux 8 rôles de PERSONNE SANS EXCEPTION,
// `poste_atelier` EXCLU — SEULE exception, pour la MÊME raison physique déjà posée sur
// `DROITS_POSTE_ATELIER` : la borne est un écran mural allumé en permanence devant clients et
// visiteurs, et un tableau de bord n'a aucune utilité à sa fonction (identifier par PIN,
// démarrer/arrêter un pointage) — l'y exposer serait le premier écran de statistiques accroché au
// mur d'un atelier, hors de son rôle (RM-115/RM-131).
//
// `admin` INCLUS, à la différence des blocs financiers de ce fichier : RF-115 (« aucun droit
// FINANCIER ») ne s'applique pas ici puisqu'aucun montant ne transite par cette réponse — même
// précédent que le pointage (`DROITS_POINTAGE_PAR_ROLE`, « le pointage enregistre du temps de
// travail, pas un montant ») : `admin` reste le rôle technique/propriétaire du tenant, superset de
// `direction` sur tout domaine non financier.
const LECTURE_TABLEAU_BORD_ACTIVITE: readonly Action[] = ['tableau_bord.activite.lire'];

const DROITS_TABLEAU_BORD_ACTIVITE_PAR_ROLE: Readonly<Record<RoleUtilisateur, readonly Action[]>> =
  {
    direction: [...LECTURE_TABLEAU_BORD_ACTIVITE],
    comptable: [...LECTURE_TABLEAU_BORD_ACTIVITE],
    vendeur: [...LECTURE_TABLEAU_BORD_ACTIVITE],
    receptionnaire: [...LECTURE_TABLEAU_BORD_ACTIVITE],
    chef_atelier: [...LECTURE_TABLEAU_BORD_ACTIVITE],
    technicien: [...LECTURE_TABLEAU_BORD_ACTIVITE],
    magasinier: [...LECTURE_TABLEAU_BORD_ACTIVITE],
    admin: [...LECTURE_TABLEAU_BORD_ACTIVITE],
    // La borne murale : périmètre construit par énumération (voir `DROITS_POSTE_ATELIER`), exclue
    // délibérément — un tableau de bord n'a aucune utilité à sa fonction et exposerait le premier
    // écran de statistiques accroché au mur d'un atelier.
    poste_atelier: [],
  };

// =================================================================================================
// Tableau de bord — financier (arbitrage coordinateur, palier de gouvernance le plus élevé)
// =================================================================================================
//
// `GET /tableau-bord/financier` expose le chiffre d'affaires, les encaissements et l'encours
// clients CONSOLIDÉS sur l'ensemble du garage, sur une période — une exposition structurellement
// PLUS large qu'un document ou un paiement pris un par un (`RF-114`/`RF-116` gouvernent chacun UN
// document ou UN paiement, jamais leur somme sur toute l'activité) : c'est précisément le piège que
// ce module devait éviter, un tableau de bord qui afficherait le chiffre d'affaires à tout rôle
// authentifié contournerait la séparation des pouvoirs déjà posée par `ROLES_SANS_MONTANT`/
// `ROLES_SANS_MONTANT_FACTURATION`. Restait sous `@AucunDroitRequis()` + une vérification de rôle
// posée EN SERVICE (`tableau-bord/droits-provisoires.ts`, retiré par ce bloc), même palliatif que
// le bloc activité ci-dessus, pour la même raison (action absente de cette matrice).
//
// Aligné sur le palier de gouvernance le PLUS ÉLEVÉ déjà posé dans ce fichier — EXACTEMENT le même
// périmètre que le bloc créancier, l'export fiduciaire et la disposition d'une avance de paiement
// (`DROITS_PARAMETRAGE_CREANCIER_PAR_ROLE`, `DROITS_EXPORT_COMPTABLE_PAR_ROLE`,
// `DISPOSITION_AVANCE_PAIEMENT`) : `direction` + `comptable` SEULS.
//
// `admin` EXCLU délibérément (`RF-115`, littéral : « il ne voit pas les montants, n'émet rien et
// n'encaisse rien, c'est une séparation des pouvoirs élémentaire »,
// `docs/specification-etape-2-facturation.md` L1327) — JAMAIS comblé par copier-coller de
// `direction`, exactement le geste que `RF-115` interdit et que ce fichier met en garde à plusieurs
// reprises. `vendeur`/`receptionnaire`/`chef_atelier` EXCLUS bien que chacun détienne un droit
// d'ÉMISSION sur UN document (`facturation.document.emettre*`) : émettre UNE facture n'est pas la
// même exposition que voir le chiffre d'affaires CONSOLIDÉ du garage sur une période. Écart
// SIGNALÉ, pas tranché ici — si le terrain montre qu'un rôle opérationnel a besoin de voir le CA de
// son propre périmètre, c'est une décision de conception, pas une inférence de ce lot.
const LECTURE_TABLEAU_BORD_FINANCIER: readonly Action[] = ['tableau_bord.financier.lire'];

const DROITS_TABLEAU_BORD_FINANCIER_PAR_ROLE: Readonly<Record<RoleUtilisateur, readonly Action[]>> =
  {
    direction: [...LECTURE_TABLEAU_BORD_FINANCIER],
    comptable: [...LECTURE_TABLEAU_BORD_FINANCIER],
    vendeur: [],
    receptionnaire: [],
    chef_atelier: [],
    technicien: [],
    magasinier: [],
    // RF-115 : jamais de droit financier pour admin — voir le commentaire de tête de section.
    admin: [],
    // Compte de service (borne d'atelier) : aucun droit dans ce domaine, par construction.
    poste_atelier: [],
  };

// =================================================================================================
// Pneus — hangar à pneus (docs/specification-parc-et-hangar-pneus.md, RPP-01→RPP-08) : bloc
// ADDITIF PUR, même patron que le tableau de bord ci-dessus. Voir le commentaire sur les 4 entrées
// `pneus.depot.*` de `TOUTES_ACTIONS` pour le détail de la correction apportée à la proposition de
// le lot `pneus/` (séparation de `gerer` en `changer_saison` / `sortir`).
//
// AUCUN MONTANT dans `depot_pneus` (id, véhicule, site, saison, statut, code_case, dimension,
// état, dates, motif_sortie, ligne_or_dernier_changement_id — voir `versDepotPneusResponse`,
// `pneus/mappers.ts`) : le forfait de dépôt, s'il existe, est facturé via un OR ou une facturation
// directe, PAS un champ de cette table (RPP-08, spec §2 « Facturation du dépôt »). Vérifié en
// lisant le schéma réel avant d'écrire ce bloc, pas supposé par analogie. `RF-115` (« admin est un
// rôle technique et n'a aucun droit financier ») ne s'applique donc PAS ici — même précédent que le
// pointage et le tableau de bord d'activité juste au-dessus (« le pointage enregistre du temps de
// travail, pas un montant » ; ici, un dépôt de pneus n'enregistre ni l'un ni l'autre) : `admin`
// reste le rôle technique/propriétaire du tenant, superset de `direction`.
//
// `pneus.depot.lire` : ouverte aux 8 rôles de PERSONNE sans exception (même doctrine que
// `LECTURE_ETENDUE`/`tableau_bord.activite.lire` : « la lecture est ouverte par défaut, seule
// l'écriture est gouvernée »), `poste_atelier` EXCLU pour la même raison physique que partout
// ailleurs dans ce fichier — l'écran mural de l'atelier n'a aucune utilité au hangar à pneus, et son
// périmètre est construit par énumération, jamais par ouverture de la lecture par défaut.
//
// `pneus.depot.creer` / `pneus.depot.changer_saison` : admin, direction, réceptionnaire, chef
// d'atelier, technicien, magasinier — repris À L'IDENTIQUE du périmètre de `atelier.ligne.creer`
// (`L966_LIGNE_CREATION`) : entrer un jeu en dépôt ou basculer été/hiver est un geste physique
// d'atelier au même titre qu'ajouter une ligne constatée, réalisé par qui reçoit le véhicule
// (réceptionnaire), qui exécute (technicien) ou qui gère le stock/l'emplacement (magasinier).
// `vendeur` et `comptable` EXCLUS : aucun geste physique sur un jeu de pneus ne relève de leur
// fonction (même exclusion que pour `atelier.ligne.creer`).
//
// `pneus.depot.sortir` : admin, direction, réceptionnaire, chef d'atelier SEULS — repris À
// L'IDENTIQUE du périmètre de `atelier.or.restituer` (`L978_OR_RESTITUER`), PAS de
// `creer`/`changer_saison` : contrairement à un changement de saison (réversible, purement
// technique), sortir un jeu clôt la garde du garage sur un bien du client (rendu au client, véhicule
// vendu, mis au rebut — RPP-05, motif obligatoire, statut TERMINAL) — le geste qui engage la
// responsabilité du garage envers son client, décision de comptoir/supervision, pas un geste
// d'exécution technique. `technicien` et `magasinier` EXCLUS : ils manipulent physiquement les
// pneus (creer/changer_saison) mais ne décident pas seuls de la sortie définitive d'un bien client,
// exactement comme ils n'ont pas `atelier.or.restituer` alors qu'ils ont `atelier.ligne.creer`.
const LECTURE_PNEUS: readonly Action[] = ['pneus.depot.lire'];
const ENTREE_PNEUS: readonly Action[] = ['pneus.depot.creer', 'pneus.depot.changer_saison'];
const SORTIE_PNEUS: readonly Action[] = ['pneus.depot.sortir'];

const DROITS_PNEUS_PAR_ROLE: Readonly<Record<RoleUtilisateur, readonly Action[]>> = {
  admin: [...LECTURE_PNEUS, ...ENTREE_PNEUS, ...SORTIE_PNEUS],
  direction: [...LECTURE_PNEUS, ...ENTREE_PNEUS, ...SORTIE_PNEUS],
  receptionnaire: [...LECTURE_PNEUS, ...ENTREE_PNEUS, ...SORTIE_PNEUS],
  chef_atelier: [...LECTURE_PNEUS, ...ENTREE_PNEUS, ...SORTIE_PNEUS],
  technicien: [...LECTURE_PNEUS, ...ENTREE_PNEUS],
  magasinier: [...LECTURE_PNEUS, ...ENTREE_PNEUS],
  vendeur: [...LECTURE_PNEUS],
  comptable: [...LECTURE_PNEUS],
  // La borne murale : périmètre construit par énumération (voir `DROITS_POSTE_ATELIER`), exclue
  // délibérément — le hangar à pneus n'a aucune utilité à sa fonction (identifier par PIN,
  // démarrer/arrêter un pointage).
  poste_atelier: [],
};

// =================================================================================================
// Relances automatiques (docs/specification-relances-automatiques.md) : bloc ADDITIF PUR, même
// patron que le tableau de bord et les pneus ci-dessus. Voir le commentaire sur les 4 entrées
// `relances.facturation.*` de `TOUTES_ACTIONS` pour le détail de l'arbitrage — notamment le fait
// qu'un SEUL jeu de rôles gouverne LIRE et ÉCRIRE ici, contrairement à la doctrine par défaut du
// reste de ce fichier.
const DROITS_RELANCES_FACTURATION: readonly Action[] = [
  'relances.facturation.regle.lire',
  'relances.facturation.regle.ecrire',
  'relances.facturation.planifier',
  'relances.facturation.envoyer',
];

const DROITS_RELANCES_PAR_ROLE: Readonly<Record<RoleUtilisateur, readonly Action[]>> = {
  direction: [...DROITS_RELANCES_FACTURATION],
  comptable: [...DROITS_RELANCES_FACTURATION],
  vendeur: [],
  receptionnaire: [],
  chef_atelier: [],
  technicien: [],
  magasinier: [],
  // RF-115 : jamais de droit financier pour admin — voir le commentaire de tête de section.
  admin: [],
  // Compte de service (borne d'atelier) : aucun droit dans ce domaine, par construction.
  poste_atelier: [],
};

// =================================================================================================
// Rendez-vous d'atelier (lot RDV-1) — bloc ADDITIF PUR, voir le commentaire des 6 entrées
// `rendez_vous.*` de `TOUTES_ACTIONS` ci-dessus pour la justification complète de la répartition.
// =================================================================================================
const LECTURE_RDV: readonly Action[] = ['rendez_vous.lire'];
const CYCLE_VIE_RDV: readonly Action[] = [
  'rendez_vous.modifier',
  'rendez_vous.arrivee',
  'rendez_vous.absence',
  'rendez_vous.annuler',
];
const RDV_COMPLET: readonly Action[] = [...LECTURE_RDV, 'rendez_vous.creer', ...CYCLE_VIE_RDV];

const DROITS_RENDEZ_VOUS_PAR_ROLE: Readonly<Record<RoleUtilisateur, readonly Action[]>> = {
  // « Le réceptionniste prend et déplace les rendez-vous » (brief) : périmètre complet.
  receptionnaire: [...RDV_COMPLET],
  // « Le chef d'atelier les voit et les réorganise » : cycle de vie complet SAUF la prise
  // initiale au téléphone — comptoir seul, cohérent avec `L958_CLIENT_ECRITURE`/`L960_
  // VEHICULE_ECRITURE` où chef_atelier a déjà l'écriture courante mais pas la primauté d'accueil.
  chef_atelier: [...LECTURE_RDV, ...CYCLE_VIE_RDV],
  direction: [...RDV_COMPLET],
  // `admin` = superset de `direction` par construction (RF-115 non applicable : aucune de ces
  // actions n'est financière) — même doctrine que `DROITS_ADMIN` ci-dessous.
  admin: [...RDV_COMPLET],
  // « Le technicien les consulte » : lecture seule, même périmètre que `LECTURE_OR`.
  technicien: [...LECTURE_RDV],
  vendeur: [],
  magasinier: [],
  comptable: [],
  // Compte de service (borne d'atelier) : aucun geste de comptoir depuis un écran mural.
  poste_atelier: [],
};

// =================================================================================================
// Gestion des employés (issue #137) — voir le commentaire des 5 entrées `socle.utilisateur.*` de
// `TOUTES_ACTIONS` ci-dessus pour la justification complète (RF-115 : administration système, pas
// métier — `direction` ET `admin`, seuls). AUCUN autre rôle ne détient ces actions : un technicien
// ou un magasinier ne gère jamais les comptes de ses collègues, même en lecture.
// =================================================================================================
const LECTURE_GESTION_UTILISATEURS: readonly Action[] = ['socle.utilisateur.lire'];
const GESTION_UTILISATEURS_COMPLETE: readonly Action[] = [
  ...LECTURE_GESTION_UTILISATEURS,
  'socle.utilisateur.creer',
  'socle.utilisateur.modifier',
  'socle.utilisateur.desactiver',
  'socle.utilisateur.reinitialiser_acces',
  'socle.borne.lire',
  'socle.borne.creer',
  'socle.borne.desactiver',
  'socle.borne.reinitialiser_acces',
];

const DROITS_UTILISATEUR_PAR_ROLE: Readonly<Record<RoleUtilisateur, readonly Action[]>> = {
  direction: [...GESTION_UTILISATEURS_COMPLETE],
  // `admin` = superset de `direction` sur CE domaine précis (RF-115 non applicable : gérer les
  // comptes est de l'administration système, pas du métier financier/commercial — voir le
  // commentaire de tête de `TOUTES_ACTIONS`), contrairement au reste de la matrice où `admin`
  // retombe à `[]` dès qu'une action touche à l'argent.
  admin: [...GESTION_UTILISATEURS_COMPLETE],
  vendeur: [],
  receptionnaire: [],
  chef_atelier: [],
  technicien: [],
  magasinier: [],
  comptable: [],
  // Compte de service (borne d'atelier) : ne gère jamais de comptes, pas même en lecture.
  poste_atelier: [],
};

// =================================================================================================
// Reprise de données (lot d'assemblage) — voir le commentaire des dix entrées `reprise.*` de
// `TOUTES_ACTIONS` ci-dessus pour la justification complète de la répartition.
// =================================================================================================
const REPRISE_PREPARATION: readonly Action[] = [
  'reprise.dossier.lire',
  'reprise.dossier.deposer',
  'reprise.dossier.annuler',
  'reprise.analyse.lire',
  'reprise.analyse.lancer',
  'reprise.plan.lire',
  'reprise.plan.modifier',
  'reprise.import.lire',
];
/** L'acte lourd — écriture réelle des données dans le tenant. `direction` SEULE. */
const REPRISE_DECLENCHEMENT_IMPORT: readonly Action[] = [
  'reprise.plan.valider',
  'reprise.import.lancer',
];

const DROITS_REPRISE_PAR_ROLE: Readonly<Record<RoleUtilisateur, readonly Action[]>> = {
  direction: [...REPRISE_PREPARATION, ...REPRISE_DECLENCHEMENT_IMPORT],
  // `admin` = superset de `direction` SAUF `REPRISE_DECLENCHEMENT_IMPORT` (RF-115 : aucun droit
  // financier) — seul bloc de ce fichier où `admin` n'est ni `[...direction]` (comme `rendez_vous`/
  // gestion des employés) ni `[]` (comme facturation) : un mélange délibéré, documenté à la source.
  admin: [...REPRISE_PREPARATION],
  vendeur: [],
  receptionnaire: [],
  chef_atelier: [],
  technicien: [],
  magasinier: [],
  comptable: [],
  poste_atelier: [],
};

// =================================================================================================
// Véhicules de courtoisie + signalement de travaux reportés — voir le commentaire des quatre
// entrées de `TOUTES_ACTIONS` ci-dessus.
// =================================================================================================
const COURTOISIE_LECTURE: readonly Action[] = ['courtoisie.lire'];
const COURTOISIE_COMPTOIR: readonly Action[] = [
  ...COURTOISIE_LECTURE,
  'courtoisie.preter',
  'vehicule.travail_reporte.signaler',
];
const COURTOISIE_COMPLETE: readonly Action[] = [...COURTOISIE_COMPTOIR, 'courtoisie.parc.gerer'];

const DROITS_COURTOISIE_PAR_ROLE: Readonly<Record<RoleUtilisateur, readonly Action[]>> = {
  receptionnaire: [...COURTOISIE_COMPTOIR],
  chef_atelier: [...COURTOISIE_COMPLETE],
  direction: [...COURTOISIE_COMPLETE],
  admin: [...COURTOISIE_COMPLETE],
  technicien: [...COURTOISIE_LECTURE, 'vehicule.travail_reporte.signaler'],
  vendeur: [],
  magasinier: [],
  comptable: [],
  poste_atelier: [],
};

// =================================================================================================
// Photos d'une ligne d'OR — voir le commentaire des trois entrées de `TOUTES_ACTIONS` ci-dessus.
// =================================================================================================
const PHOTO_LECTURE: readonly Action[] = ['atelier.ligne.photo.lire'];
const PHOTO_TERRAIN: readonly Action[] = [
  ...PHOTO_LECTURE,
  'atelier.ligne.photo.ajouter',
  'atelier.ligne.photo.supprimer',
];

const DROITS_PHOTO_LIGNE_PAR_ROLE: Readonly<Record<RoleUtilisateur, readonly Action[]>> = {
  admin: [...PHOTO_TERRAIN],
  direction: [...PHOTO_TERRAIN],
  receptionnaire: [...PHOTO_TERRAIN],
  chef_atelier: [...PHOTO_TERRAIN],
  technicien: [...PHOTO_TERRAIN],
  magasinier: [...PHOTO_TERRAIN],
  // Aucun droit : la borne est un compte de service sans identité de personne, et sa matrice est
  // verrouillée à la lecture + pointage (invariant testé RM-115/RM-131) — une photo sans auteur
  // identifiable n'a pas sa place là.
  poste_atelier: [],
  vendeur: [...PHOTO_LECTURE],
  comptable: [...PHOTO_LECTURE],
};

// =================================================================================================
// Accueil — état de mise en route du garage (`accueil.demarrage.lire`) : direction et admin.
// =================================================================================================
const DROITS_ACCUEIL_PAR_ROLE: Readonly<Record<RoleUtilisateur, readonly Action[]>> = {
  admin: [
    'accueil.demarrage.lire',
    'parametrage.modules.modifier',
    'parametrage.envoi_courriel.gerer',
  ],
  direction: [
    'accueil.demarrage.lire',
    'parametrage.modules.modifier',
    'parametrage.envoi_courriel.gerer',
  ],
  vendeur: [],
  receptionnaire: [],
  chef_atelier: [],
  technicien: [],
  magasinier: [],
  comptable: [],
  poste_atelier: [],
};

export const MATRICE_DROITS_HISTORIQUE = {
  admin: [
    ...DROITS_ADMIN,
    ...DROITS_PAIEMENT_PAR_ROLE.admin,
    ...DROITS_DOCUMENT_PAR_ROLE.admin,
    ...DROITS_PARAMETRAGE_CREANCIER_PAR_ROLE.admin,
    ...DROITS_PLAFOND_AVOIR_RECEPTIONNAIRE_PAR_ROLE.admin,
    ...DROITS_EXPORT_COMPTABLE_PAR_ROLE.admin,
    ...DROITS_IMPRESSION_PAR_ROLE.admin,
    ...DROITS_PIECES_PAR_ROLE.admin,
    ...DROITS_VENTES_PAR_ROLE.admin,
    ...DROITS_POINTAGE_PAR_ROLE.admin,
    ...DROITS_TABLEAU_BORD_ACTIVITE_PAR_ROLE.admin,
    ...DROITS_TABLEAU_BORD_FINANCIER_PAR_ROLE.admin,
    ...DROITS_PNEUS_PAR_ROLE.admin,
    ...DROITS_RELANCES_PAR_ROLE.admin,
    ...DROITS_RENDEZ_VOUS_PAR_ROLE.admin,
    ...DROITS_UTILISATEUR_PAR_ROLE.admin,
    ...DROITS_REPRISE_PAR_ROLE.admin,
    ...DROITS_COURTOISIE_PAR_ROLE.admin,
    ...DROITS_PHOTO_LIGNE_PAR_ROLE.admin,
    ...DROITS_ACCUEIL_PAR_ROLE.admin,
  ],
  direction: [
    ...DROITS_DIRECTION,
    ...DROITS_PAIEMENT_PAR_ROLE.direction,
    ...DROITS_DOCUMENT_PAR_ROLE.direction,
    ...DROITS_PARAMETRAGE_CREANCIER_PAR_ROLE.direction,
    ...DROITS_PLAFOND_AVOIR_RECEPTIONNAIRE_PAR_ROLE.direction,
    ...DROITS_EXPORT_COMPTABLE_PAR_ROLE.direction,
    ...DROITS_IMPRESSION_PAR_ROLE.direction,
    ...DROITS_PIECES_PAR_ROLE.direction,
    ...DROITS_VENTES_PAR_ROLE.direction,
    ...DROITS_POINTAGE_PAR_ROLE.direction,
    ...DROITS_TABLEAU_BORD_ACTIVITE_PAR_ROLE.direction,
    ...DROITS_TABLEAU_BORD_FINANCIER_PAR_ROLE.direction,
    ...DROITS_PNEUS_PAR_ROLE.direction,
    ...DROITS_RELANCES_PAR_ROLE.direction,
    ...DROITS_RENDEZ_VOUS_PAR_ROLE.direction,
    ...DROITS_UTILISATEUR_PAR_ROLE.direction,
    ...DROITS_REPRISE_PAR_ROLE.direction,
    ...DROITS_COURTOISIE_PAR_ROLE.direction,
    ...DROITS_PHOTO_LIGNE_PAR_ROLE.direction,
    ...DROITS_ACCUEIL_PAR_ROLE.direction,
  ],
  vendeur: [
    ...DROITS_VENDEUR,
    ...DROITS_PAIEMENT_PAR_ROLE.vendeur,
    ...DROITS_DOCUMENT_PAR_ROLE.vendeur,
    ...DROITS_PARAMETRAGE_CREANCIER_PAR_ROLE.vendeur,
    ...DROITS_PLAFOND_AVOIR_RECEPTIONNAIRE_PAR_ROLE.vendeur,
    ...DROITS_EXPORT_COMPTABLE_PAR_ROLE.vendeur,
    ...DROITS_IMPRESSION_PAR_ROLE.vendeur,
    ...DROITS_PIECES_PAR_ROLE.vendeur,
    ...DROITS_VENTES_PAR_ROLE.vendeur,
    ...DROITS_POINTAGE_PAR_ROLE.vendeur,
    ...DROITS_TABLEAU_BORD_ACTIVITE_PAR_ROLE.vendeur,
    ...DROITS_TABLEAU_BORD_FINANCIER_PAR_ROLE.vendeur,
    ...DROITS_PNEUS_PAR_ROLE.vendeur,
    ...DROITS_RELANCES_PAR_ROLE.vendeur,
    ...DROITS_RENDEZ_VOUS_PAR_ROLE.vendeur,
    ...DROITS_UTILISATEUR_PAR_ROLE.vendeur,
    ...DROITS_REPRISE_PAR_ROLE.vendeur,
    ...DROITS_COURTOISIE_PAR_ROLE.vendeur,
    ...DROITS_PHOTO_LIGNE_PAR_ROLE.vendeur,
    ...DROITS_ACCUEIL_PAR_ROLE.vendeur,
  ],
  receptionnaire: [
    ...DROITS_RECEPTIONNAIRE,
    ...DROITS_PAIEMENT_PAR_ROLE.receptionnaire,
    ...DROITS_DOCUMENT_PAR_ROLE.receptionnaire,
    ...DROITS_PARAMETRAGE_CREANCIER_PAR_ROLE.receptionnaire,
    ...DROITS_PLAFOND_AVOIR_RECEPTIONNAIRE_PAR_ROLE.receptionnaire,
    ...DROITS_EXPORT_COMPTABLE_PAR_ROLE.receptionnaire,
    ...DROITS_IMPRESSION_PAR_ROLE.receptionnaire,
    ...DROITS_PIECES_PAR_ROLE.receptionnaire,
    ...DROITS_VENTES_PAR_ROLE.receptionnaire,
    ...DROITS_POINTAGE_PAR_ROLE.receptionnaire,
    ...DROITS_TABLEAU_BORD_ACTIVITE_PAR_ROLE.receptionnaire,
    ...DROITS_TABLEAU_BORD_FINANCIER_PAR_ROLE.receptionnaire,
    ...DROITS_PNEUS_PAR_ROLE.receptionnaire,
    ...DROITS_RELANCES_PAR_ROLE.receptionnaire,
    ...DROITS_RENDEZ_VOUS_PAR_ROLE.receptionnaire,
    ...DROITS_UTILISATEUR_PAR_ROLE.receptionnaire,
    ...DROITS_REPRISE_PAR_ROLE.receptionnaire,
    ...DROITS_COURTOISIE_PAR_ROLE.receptionnaire,
    ...DROITS_PHOTO_LIGNE_PAR_ROLE.receptionnaire,
    ...DROITS_ACCUEIL_PAR_ROLE.receptionnaire,
  ],
  chef_atelier: [
    ...DROITS_CHEF_ATELIER,
    ...DROITS_PAIEMENT_PAR_ROLE.chef_atelier,
    ...DROITS_DOCUMENT_PAR_ROLE.chef_atelier,
    ...DROITS_PARAMETRAGE_CREANCIER_PAR_ROLE.chef_atelier,
    ...DROITS_PLAFOND_AVOIR_RECEPTIONNAIRE_PAR_ROLE.chef_atelier,
    ...DROITS_EXPORT_COMPTABLE_PAR_ROLE.chef_atelier,
    ...DROITS_IMPRESSION_PAR_ROLE.chef_atelier,
    ...DROITS_PIECES_PAR_ROLE.chef_atelier,
    ...DROITS_VENTES_PAR_ROLE.chef_atelier,
    ...DROITS_POINTAGE_PAR_ROLE.chef_atelier,
    ...DROITS_TABLEAU_BORD_ACTIVITE_PAR_ROLE.chef_atelier,
    ...DROITS_TABLEAU_BORD_FINANCIER_PAR_ROLE.chef_atelier,
    ...DROITS_PNEUS_PAR_ROLE.chef_atelier,
    ...DROITS_RELANCES_PAR_ROLE.chef_atelier,
    ...DROITS_RENDEZ_VOUS_PAR_ROLE.chef_atelier,
    ...DROITS_UTILISATEUR_PAR_ROLE.chef_atelier,
    ...DROITS_REPRISE_PAR_ROLE.chef_atelier,
    ...DROITS_COURTOISIE_PAR_ROLE.chef_atelier,
    ...DROITS_PHOTO_LIGNE_PAR_ROLE.chef_atelier,
    ...DROITS_ACCUEIL_PAR_ROLE.chef_atelier,
  ],
  technicien: [
    ...DROITS_TECHNICIEN,
    ...DROITS_PAIEMENT_PAR_ROLE.technicien,
    ...DROITS_DOCUMENT_PAR_ROLE.technicien,
    ...DROITS_PARAMETRAGE_CREANCIER_PAR_ROLE.technicien,
    ...DROITS_PLAFOND_AVOIR_RECEPTIONNAIRE_PAR_ROLE.technicien,
    ...DROITS_EXPORT_COMPTABLE_PAR_ROLE.technicien,
    ...DROITS_IMPRESSION_PAR_ROLE.technicien,
    ...DROITS_PIECES_PAR_ROLE.technicien,
    ...DROITS_VENTES_PAR_ROLE.technicien,
    ...DROITS_POINTAGE_PAR_ROLE.technicien,
    ...DROITS_TABLEAU_BORD_ACTIVITE_PAR_ROLE.technicien,
    ...DROITS_TABLEAU_BORD_FINANCIER_PAR_ROLE.technicien,
    ...DROITS_PNEUS_PAR_ROLE.technicien,
    ...DROITS_RELANCES_PAR_ROLE.technicien,
    ...DROITS_RENDEZ_VOUS_PAR_ROLE.technicien,
    ...DROITS_UTILISATEUR_PAR_ROLE.technicien,
    ...DROITS_REPRISE_PAR_ROLE.technicien,
    ...DROITS_COURTOISIE_PAR_ROLE.technicien,
    ...DROITS_PHOTO_LIGNE_PAR_ROLE.technicien,
    ...DROITS_ACCUEIL_PAR_ROLE.technicien,
  ],
  magasinier: [
    ...DROITS_MAGASINIER,
    ...DROITS_PAIEMENT_PAR_ROLE.magasinier,
    ...DROITS_DOCUMENT_PAR_ROLE.magasinier,
    ...DROITS_PARAMETRAGE_CREANCIER_PAR_ROLE.magasinier,
    ...DROITS_PLAFOND_AVOIR_RECEPTIONNAIRE_PAR_ROLE.magasinier,
    ...DROITS_EXPORT_COMPTABLE_PAR_ROLE.magasinier,
    ...DROITS_IMPRESSION_PAR_ROLE.magasinier,
    ...DROITS_PIECES_PAR_ROLE.magasinier,
    ...DROITS_VENTES_PAR_ROLE.magasinier,
    ...DROITS_POINTAGE_PAR_ROLE.magasinier,
    ...DROITS_TABLEAU_BORD_ACTIVITE_PAR_ROLE.magasinier,
    ...DROITS_TABLEAU_BORD_FINANCIER_PAR_ROLE.magasinier,
    ...DROITS_PNEUS_PAR_ROLE.magasinier,
    ...DROITS_RELANCES_PAR_ROLE.magasinier,
    ...DROITS_RENDEZ_VOUS_PAR_ROLE.magasinier,
    ...DROITS_UTILISATEUR_PAR_ROLE.magasinier,
    ...DROITS_REPRISE_PAR_ROLE.magasinier,
    ...DROITS_COURTOISIE_PAR_ROLE.magasinier,
    ...DROITS_PHOTO_LIGNE_PAR_ROLE.magasinier,
    ...DROITS_ACCUEIL_PAR_ROLE.magasinier,
  ],
  comptable: [
    ...DROITS_COMPTABLE,
    ...DROITS_PAIEMENT_PAR_ROLE.comptable,
    ...DROITS_DOCUMENT_PAR_ROLE.comptable,
    ...DROITS_PARAMETRAGE_CREANCIER_PAR_ROLE.comptable,
    ...DROITS_PLAFOND_AVOIR_RECEPTIONNAIRE_PAR_ROLE.comptable,
    ...DROITS_EXPORT_COMPTABLE_PAR_ROLE.comptable,
    ...DROITS_IMPRESSION_PAR_ROLE.comptable,
    ...DROITS_PIECES_PAR_ROLE.comptable,
    ...DROITS_VENTES_PAR_ROLE.comptable,
    ...DROITS_POINTAGE_PAR_ROLE.comptable,
    ...DROITS_TABLEAU_BORD_ACTIVITE_PAR_ROLE.comptable,
    ...DROITS_TABLEAU_BORD_FINANCIER_PAR_ROLE.comptable,
    ...DROITS_PNEUS_PAR_ROLE.comptable,
    ...DROITS_RELANCES_PAR_ROLE.comptable,
    ...DROITS_RENDEZ_VOUS_PAR_ROLE.comptable,
    ...DROITS_UTILISATEUR_PAR_ROLE.comptable,
    ...DROITS_REPRISE_PAR_ROLE.comptable,
    ...DROITS_COURTOISIE_PAR_ROLE.comptable,
    ...DROITS_PHOTO_LIGNE_PAR_ROLE.comptable,
    ...DROITS_ACCUEIL_PAR_ROLE.comptable,
  ],
  poste_atelier: [
    ...DROITS_POSTE_ATELIER,
    ...DROITS_PAIEMENT_PAR_ROLE.poste_atelier,
    ...DROITS_DOCUMENT_PAR_ROLE.poste_atelier,
    ...DROITS_PARAMETRAGE_CREANCIER_PAR_ROLE.poste_atelier,
    ...DROITS_PLAFOND_AVOIR_RECEPTIONNAIRE_PAR_ROLE.poste_atelier,
    ...DROITS_EXPORT_COMPTABLE_PAR_ROLE.poste_atelier,
    ...DROITS_IMPRESSION_PAR_ROLE.poste_atelier,
    ...DROITS_PIECES_PAR_ROLE.poste_atelier,
    ...DROITS_VENTES_PAR_ROLE.poste_atelier,
    ...DROITS_POINTAGE_PAR_ROLE.poste_atelier,
    ...DROITS_TABLEAU_BORD_ACTIVITE_PAR_ROLE.poste_atelier,
    ...DROITS_TABLEAU_BORD_FINANCIER_PAR_ROLE.poste_atelier,
    ...DROITS_PNEUS_PAR_ROLE.poste_atelier,
    ...DROITS_RELANCES_PAR_ROLE.poste_atelier,
    ...DROITS_RENDEZ_VOUS_PAR_ROLE.poste_atelier,
    ...DROITS_UTILISATEUR_PAR_ROLE.poste_atelier,
    ...DROITS_REPRISE_PAR_ROLE.poste_atelier,
    ...DROITS_COURTOISIE_PAR_ROLE.poste_atelier,
    ...DROITS_PHOTO_LIGNE_PAR_ROLE.poste_atelier,
    ...DROITS_ACCUEIL_PAR_ROLE.poste_atelier,
  ],
} as const satisfies Readonly<Record<RoleUtilisateur, readonly Action[]>>;

/**
 * Rôles pour lesquels le serveur retire tout champ monétaire des réponses (invariant front n°10,
 * plan-lot1-execution.md L611-618). Vit ici et nulle part ailleurs : le filtrage des montants est
 * une décision d'autorisation, pas une préférence d'affichage, et s'applique côté serveur — y
 * compris dans `blocages` (contrats-api-etape-1.md §3.5).
 *
 * `technicien` : n'a aucun droit `atelier.ligne.modifier` (rabais, payeur) ni `atelier.or.plafond_modifier`
 * ni `client.condition.modifier` dans la matrice ci-dessus — cohérent avec l'exclusion des montants.
 *
 * `poste_atelier` : la borne est un écran mural allumé en permanence, à la vue de tout le monde
 * (clients, livreurs, visiteurs). Y afficher un prix de main-d'œuvre, un plafond ou un total d'OR
 * serait une divulgation commerciale par simple présence physique dans l'atelier — un canal que
 * l'auth ne peut pas gouverner autrement qu'en retirant les montants à la source.
 */
export const ROLES_SANS_MONTANT: readonly RoleUtilisateur[] = ['technicien', 'poste_atelier'];
