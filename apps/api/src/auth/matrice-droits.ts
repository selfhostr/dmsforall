/**
 * Matrice rôle × action — source de vérité UNIQUE de l'autorisation.
 *
 * Ce fichier ne contient que des données et des types : aucun import de NestJS, aucun service.
 * C'est délibéré. La matrice est lue par `common/droits/garde-droit.ts` ; si elle vivait dans le
 * même fichier que le garde, `common` importerait `auth` qui importe `common`, et le cycle rend
 * une classe `undefined` à l'exécution selon l'ordre de chargement des modules — panne qui ne se
 * manifeste que sur certains points d'entrée (l'API démarrait, l'export OpenAPI non).
 *
 * Un seul mécanisme d'autorisation existe dans le produit : `@ExigerDroit(...)` + `GardeDroit`.
 * L'ancien couple `@Roles`/`GardeRoles` a été supprimé — deux mécanismes concurrents lisant la
 * même matrice avec deux clés de métadonnées voisines (`dfa:action` / `dfa:actions`) créaient un
 * piège silencieux : décorer avec l'un et garder avec l'autre laissait passer TOUT rôle
 * authentifié, sans erreur ni test rouge.
 *
 * Bloquant B3 (rapport QA étape 0) : `MATRICE_DROITS` est typée `Record<RoleUtilisateur, …>`, pas
 * `Record<string, …>`. Avec `string`, rien n'imposait qu'un rôle de `ROLES_UTILISATEUR` figure
 * dans la matrice — un rôle ajouté à l'enum sans être ajouté ici compilait, lintait et testait
 * vert, puis recevait `403 DROIT_INSUFFISANT` sur l'intégralité de l'application en production
 * (`GardeDroit` évalue `MATRICE_DROITS[role] ?? []`). `Record<RoleUtilisateur, …>` fait échouer
 * la compilation si un rôle manque ; `matrice-droits.spec.ts` couvre en plus le cas où quelqu'un
 * réélargirait le type à `string` pour « débloquer » un typecheck rouge.
 *
 * VIGILANCE — `GardeDroit` est fail-open en l'absence de `@ExigerDroit` sur une route (voir
 * `common/droits/garde-droit.ts`) : un endpoint oublié reste accessible à tout rôle authentifié,
 * y compris `vendeur` ou `technicien` sur une action `atelier.or.*`. Ce n'est pas la responsabilité
 * de ce fichier — mais chaque contrôleur du lot 1 DOIT poser `@ExigerDroit(...)` sur toutes ses
 * routes, sans exception, pour que le contenu de cette matrice ait un effet réel.
 *
 * ---------------------------------------------------------------------------------------------
 * Lot 1 (atelier + clients) — méthode de remplissage
 * ---------------------------------------------------------------------------------------------
 * La matrice §10 de `docs/specification-etape-1-atelier-clients.md` (lignes 956-981) est la
 * source primaire : chaque groupe d'actions ci-dessous cite la ligne §10 dont il découle **sans
 * interprétation** quand une ligne existe littéralement pour cette action.
 *
 * §10 ne couvre que 6 des 8 rôles (ni `admin` ni `vendeur` n'y figurent — `ARCHITECTURE.md §3`
 * les liste mais la spec §2.1 ne les décrit pas comme acteurs de l'étape 1) et ne couvre pas
 * toutes les actions de §6.4 du plan d'exécution (paramétrage, référentiels, recherche, certains
 * verbes du cycle de vie de l'OR qui sont des transitions de la machine à états §5.1/§5.2 plutôt
 * que des lignes de §10). Pour ces cas, l'attribution est **inférée** et documentée comme telle,
 * avec sa justification (règle métier RM-xx, transition T-xx, ou principe explicite) :
 *
 *  - `admin` reçoit le même périmètre que `direction` (rôle technique/propriétaire du tenant,
 *    superset par construction — cohérent avec le fait que `direction` est "oui" ou "sans limite"
 *    sur les 24 lignes de §10, sans exception).
 *  - `vendeur` n'est PAS un acteur de l'étape 1 (§2.1 ligne 66-67 : seul le manque de
 *    `receptionnaire` y est signalé, `vendeur` n'apparaît dans aucun flux du §3). Il reçoit une
 *    lecture minimale (paramétrage, clients, véhicules, recherche) et AUCUN droit d'écriture
 *    atelier — c'est délibéré : `receptionnaire` est l'acteur central de la réception et de la
 *    restitution (§2.1 ligne 58), `vendeur` ne doit pas en être un décalque par confort de copie.
 *  - la lecture (`*.lire`) est ouverte à tous les rôles authentifiés sauf mention contraire,
 *    par le même principe que `LECTURE_SOCLE` existant : consulter son garage est un préalable,
 *    seule l'écriture est gouvernée.
 */

import type { CodeConfirmation, RoleUtilisateur } from '@dfa/shared';

/**
 * Action métier protégée. Convention : `domaine.ressource.verbe`.
 */
export type Action =
  // ---- Socle (étape 0), inchangé --------------------------------------------------------------
  | 'socle.tenant.lire'
  | 'socle.site.lire'
  // ---- Paramétrage atelier et référentiels (plan-lot1-execution.md §6.4) ----------------------
  | 'parametrage.atelier.lire'
  | 'parametrage.atelier.modifier'
  | 'parametrage.referentiel.lire'
  | 'parametrage.referentiel.modifier'
  // ---- Clients (§6.4 ; RM-01 → RM-14, spec lignes 233-248) -------------------------------------
  | 'client.lire'
  | 'client.creer'
  | 'client.modifier'
  | 'client.desactiver'
  | 'client.condition.modifier'
  | 'client.consentement.enregistrer'
  | 'client.note.ecrire'
  // ---- Véhicules (§6.4 ; RM-15 → RM-33, spec lignes 250-270) -----------------------------------
  | 'vehicule.lire'
  | 'vehicule.creer'
  | 'vehicule.modifier'
  | 'vehicule.archiver'
  | 'vehicule.plaque.gerer'
  | 'vehicule.detention.changer'
  | 'vehicule.detention.corriger'
  | 'vehicule.kilometrage.saisir'
  | 'vehicule.kilometrage.corriger_regression'
  | 'vehicule.expertise.saisir'
  | 'vehicule.campagne.gerer'
  | 'vehicule.travail_reporte.gerer'
  // ---- Recherche comptoir (RM-112, spec ligne 370) ---------------------------------------------
  | 'recherche.executer'
  // ---- Ordre de réparation (§6.4 ; §5.1, spec lignes 376-475) ----------------------------------
  | 'atelier.or.lire'
  | 'atelier.or.creer'
  | 'atelier.or.modifier'
  | 'atelier.or.plafond_modifier'
  | 'atelier.or.receptionner'
  | 'atelier.or.demarrer'
  | 'atelier.or.passer_en_controle'
  | 'atelier.or.controler'
  | 'atelier.or.terminer'
  | 'atelier.or.rouvrir'
  | 'atelier.or.restituer'
  | 'atelier.or.cloturer'
  | 'atelier.or.annuler'
  // ---- Lignes d'OR (§6.4 ; §5.2, spec lignes 477-496) -------------------------------------------
  | 'atelier.ligne.creer'
  | 'atelier.ligne.modifier'
  | 'atelier.ligne.valider'
  | 'atelier.ligne.refuser'
  | 'atelier.ligne.annuler'
  | 'atelier.ligne.marquer_realisee'
  // ---- Devis complémentaire (§6.4 ; RM-79 → RM-86, spec lignes 326-335) -------------------------
  | 'atelier.devis.creer'
  | 'atelier.devis.repondre'
  // ---- Journal d'audit de l'OR (RM-59, RM-111) ---------------------------------------------------
  | 'atelier.journal.lire'
  // ---- Confirmations (contrats-api-etape-1.md §4.4, lignes 522-529) -----------------------------
  | 'atelier.confirmation.client_bloque'
  | 'atelier.confirmation.deux_or_ouverts'
  | 'atelier.confirmation.or_sans_rdv'
  // ---- Confirmations hors périmètre opérationnel du lot 1 (RDV, prêt de véhicule) ---------------
  // `CodeConfirmation` (packages/shared/src/contrats/probleme.ts) porte 6 valeurs ; seules 3 ont
  // une action opérationnelle au lot 1 (les tables rendez_vous*/*_courtoisie ne sont pas créées,
  // voir plan-lot1-execution.md §7.2 L1-05 delta Δ4). `DROIT_PAR_CONFIRMATION` doit néanmoins être
  // exhaustif sur `CodeConfirmation` (le compilateur l'impose, arbitrage confirmé : un
  // `Partial<Record<...>>` reproduirait le bloquant B3 — `[code]` rendrait `Action | undefined`,
  // et le traitement naturel de ce cas par un consommateur futur serait soit fail-open soit une
  // panne muette). Ces 3 actions sont donc créées par anticipation, inertes tant que les lots
  // RDV/prêt ne livrent aucun endpoint qui les consulte — même principe que les enums de modules
  // absents créés en L1-05 pour rester exhaustif.
  //
  // ATTENTION à qui câble le module RDV/prêt plus tard : le droit ci-dessous (chef d'atelier ou
  // direction, aligné sur contrats-api-etape-1.md lignes 526-528) est calé PAR COHÉRENCE avec
  // `client_bloque`/`or_sans_rdv` en l'ABSENCE d'information métier propre à RDV/prêt — ce n'est
  // PAS une décision métier prise pour ce module. Il doit être réexaminé avec la spec du module
  // au moment de son implémentation (qui a réellement le droit de forcer une double réservation
  // de ressource RDV, ou de confirmer l'indisponibilité d'un véhicule de courtoisie ? la matrice
  // §10 de la spec étape 1, lignes 963-964, suggère déjà `chef_atelier`/`direction` pour le
  // chevauchement de ressource — à vérifier contre la spec du module RDV le moment venu, pas à
  // supposer déjà tranché.
  | 'rendez_vous.confirmation.ressource_chevauchement'
  | 'rendez_vous.confirmation.hors_ouverture'
  | 'pret_vehicule.confirmation.indisponible';

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
const INFERE_CLIENT_CONTACT: readonly Action[] = ['client.consentement.enregistrer', 'client.note.ecrire'];

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
  'vehicule.campagne.gerer',
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
const INFERE_OR_EXECUTION: readonly Action[] = ['atelier.or.demarrer', 'atelier.or.passer_en_controle'];

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

/**
 * Actions de confirmation hors périmètre opérationnel du lot 1 (RDV, prêt de véhicule) — voir le
 * commentaire sur le type `Action`. Même droit que `CONFIRMATION_CHEF_ATELIER_DIRECTION` par
 * cohérence avec contrats-api-etape-1.md lignes 526-528 (chef d'atelier ou direction pour les 3) —
 * PAS une décision métier prise pour le futur module RDV/prêt : à réexaminer avec sa spec, voir
 * l'avertissement détaillé sur le type `Action`.
 */
const CONFIRMATION_HORS_LOT1: readonly Action[] = [
  'rendez_vous.confirmation.ressource_chevauchement',
  'rendez_vous.confirmation.hors_ouverture',
  'pret_vehicule.confirmation.indisponible',
];

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
  ...CONFIRMATION_HORS_LOT1,
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
 */
const DROITS_MAGASINIER: readonly Action[] = [
  ...LECTURE_SOCLE,
  ...LECTURE_ETENDUE,
  ...LECTURE_OR,
  ...L958_CLIENT_ECRITURE,
  ...L960_VEHICULE_ECRITURE,
  ...KILOMETRAGE_SAISIE,
  ...L966_LIGNE_CREATION,
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
 * `direction` : voit les indicateurs, arbitre en dernier ressort (§2.1 ligne 63). « oui » ou
 * « sans limite » sur les 24 lignes de §10 sans exception : reçoit tout ce que `chef_atelier` a,
 * plus les actions réservées à direction seule (`client.condition.modifier`).
 */
const DROITS_DIRECTION: readonly Action[] = [...DROITS_CHEF_ATELIER, ...INFERE_CLIENT_CONDITIONS];

/**
 * `admin` : rôle technique/propriétaire du tenant (`ARCHITECTURE.md §3`), non décrit comme acteur
 * métier de l'étape 1 — reçoit par construction le même périmètre que `direction` (voir note de
 * tête de fichier).
 */
const DROITS_ADMIN: readonly Action[] = [...DROITS_DIRECTION];

export const MATRICE_DROITS = {
  admin: DROITS_ADMIN,
  direction: DROITS_DIRECTION,
  vendeur: DROITS_VENDEUR,
  receptionnaire: DROITS_RECEPTIONNAIRE,
  chef_atelier: DROITS_CHEF_ATELIER,
  technicien: DROITS_TECHNICIEN,
  magasinier: DROITS_MAGASINIER,
  comptable: DROITS_COMPTABLE,
} as const satisfies Readonly<Record<RoleUtilisateur, readonly Action[]>>;

/**
 * Rôles pour lesquels le serveur retire tout champ monétaire des réponses (invariant front n°10,
 * plan-lot1-execution.md L611-618). Vit ici et nulle part ailleurs : le filtrage des montants est
 * une décision d'autorisation, pas une préférence d'affichage, et s'applique côté serveur — y
 * compris dans `blocages` (contrats-api-etape-1.md §3.5).
 *
 * `technicien` : n'a aucun droit `atelier.ligne.modifier` (rabais, payeur) ni `atelier.or.plafond_modifier`
 * ni `client.condition.modifier` dans la matrice ci-dessus — cohérent avec l'exclusion des montants.
 */
export const ROLES_SANS_MONTANT: readonly RoleUtilisateur[] = ['technicien'];

/**
 * Droit requis pour rejouer une requête avec une confirmation donnée (contrats-api-etape-1.md
 * §4.4, protocole en deux temps : `409 CONFIRMATION_REQUISE` si l'appelant a le droit,
 * `409 <CodeErreur homonyme>` + `DEMANDER_HABILITATION` sinon).
 *
 * Exhaustif sur `CodeConfirmation` (6 valeurs) par construction du compilateur, alors que le
 * périmètre opérationnel du lot 1 (§6.4 du plan) n'en couvre que 3 — voir le commentaire sur les
 * 3 dernières valeurs du type `Action` ci-dessus pour la justification des 3 entrées restantes.
 */
export const DROIT_PAR_CONFIRMATION: Readonly<Record<CodeConfirmation, Action>> = {
  CLIENT_BLOQUE: 'atelier.confirmation.client_bloque',
  VEHICULE_DEUX_OR_OUVERTS: 'atelier.confirmation.deux_or_ouverts',
  OR_SANS_RDV: 'atelier.confirmation.or_sans_rdv',
  RDV_RESSOURCE_CHEVAUCHEMENT: 'rendez_vous.confirmation.ressource_chevauchement',
  RDV_HORS_OUVERTURE: 'rendez_vous.confirmation.hors_ouverture',
  PRET_VEHICULE_INDISPONIBLE: 'pret_vehicule.confirmation.indisponible',
};
