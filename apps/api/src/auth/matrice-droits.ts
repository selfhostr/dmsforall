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
 *  - `admin` reçoit le même périmètre que `direction` pour CE lot (atelier/clients/véhicules) —
 *    superset par construction, cohérent avec le fait que `direction` est "oui" ou "sans limite"
 *    sur les 24 lignes de §10, sans exception. DOCTRINE COMPLÈTE, ARBITRÉE (issue #21, tranchée
 *    12.08.2026, à ne PAS rouvrir) : `admin` est le compte TECHNIQUE de l'intégrateur — celui qui
 *    administre le système pour le compte du garage (tenants, sites, utilisateurs, paramètres). Il
 *    ne vend pas, ne facture pas, ne touche pas au stock. `direction`, elle, EST le patron du
 *    garage : il vend souvent lui-même et doit pouvoir contrôler et dépanner ses employés sur
 *    l'intégralité du métier — c'est pour ça que `direction` reste le rôle « sans limite », jamais
 *    `admin`. Les deux rôles reçoivent le MÊME périmètre ici (lot 1, atelier) parce que §10 ne
 *    décrit pas `admin` comme acteur et que rien n'exclut explicitement l'atelier pour un compte
 *    technique — mais dès qu'une action touche à l'argent (facturation, pièces/stock, export
 *    fiduciaire, bloc créancier — voir RF-115 plus bas), `admin` retombe à `[]`, littéralement,
 *    JAMAIS comblé par copier-coller de `direction`. Le compte de démo à utiliser pour tester le
 *    métier est `direction@garage-martin.ch`, jamais `admin@` (qui n'a AUCUN droit métier
 *    financier/stock et rend des 403 attendus sur ces domaines — voir la doc de démarrage).
 *  - `vendeur` n'est PAS un acteur de l'étape 1 (§2.1 ligne 66-67 : seul le manque de
 *    `receptionnaire` y est signalé, `vendeur` n'apparaît dans aucun flux du §3). Il reçoit une
 *    lecture minimale (paramétrage, clients, véhicules, recherche) et AUCUN droit d'écriture
 *    atelier — c'est délibéré : `receptionnaire` est l'acteur central de la réception et de la
 *    restitution (§2.1 ligne 58), `vendeur` ne doit pas en être un décalque par confort de copie.
 *  - la lecture (`*.lire`) est ouverte à tous les rôles authentifiés sauf mention contraire,
 *    par le même principe que `LECTURE_SOCLE` existant : consulter son garage est un préalable,
 *    seule l'écriture est gouvernée.
 */

import {
  PREREGLAGES,
  capacitesDeLaGrille,
  type Capacite,
  type CodeConfirmation,
  type GrilleCapacites,
  type RoleUtilisateur,
} from '@dfa/shared';

import { CAPACITE_DE_L_ACTION } from './capacites-actions';

/**
 * Toutes les actions métier protégées, énumérées EN DONNÉES (pas seulement en type) — voir le
 * commentaire du type `Action` juste en dessous pour la raison : c'est la source de vérité UNIQUE,
 * lue à la fois par le compilateur (dérivation du type) et par `vitest run` (test structurel
 * `common/droits/toutes-les-actions-couvertes.spec.ts`, qui importe `TOUTES_ACTIONS` directement).
 *
 * Convention de nommage : `domaine.ressource.verbe`.
 */
export const TOUTES_ACTIONS = [
  // ---- Socle (étape 0), inchangé --------------------------------------------------------------
  'socle.tenant.lire',
  'socle.site.lire',
  // ---- Gestion des employés (issue #137, choix produit 13.08.2026) -----------------------------
  // Rangée dans l'administration SYSTÈME par la doctrine RF-115 déjà écrite plus bas dans ce
  // fichier (« tenants, sites, utilisateurs, paramètres »), pas dans le métier — c'est pourquoi
  // `admin` reçoit ces cinq actions au même titre que `direction`, sans que ça rouvre RF-115 :
  // gérer QUI a un accès et QUEL rôle il porte n'est ni une vente, ni une facture, ni un
  // mouvement de stock. `direction` (le patron) gère ses employés au quotidien ; `admin` (le
  // compte technique de l'intégrateur) le peut aussi, ne serait-ce que pour créer le tout premier
  // compte `direction` d'un nouveau garage — geste qui, avant ce lot, se faisait par insertion
  // directe en base (`db/seed/seed-dev.ts`). La garde qui empêche un patron de distribuer un
  // accès d'intégrateur (créer/promouvoir un `admin`) ne vit PAS ici — voir
  // `auth/gouvernance-roles.ts::verifierAttributionRoleAutorisee`, appliquée par
  // `ServiceUtilisateur` en plus de cette matrice, jamais à sa place.
  'socle.utilisateur.lire',
  'socle.utilisateur.creer',
  'socle.utilisateur.modifier',
  'socle.utilisateur.desactiver',
  'socle.utilisateur.reinitialiser_acces',
  // Bornes d'atelier (comptes de service `poste_atelier`) : mêmes titulaires que les employés.
  'socle.borne.lire',
  'socle.borne.creer',
  'socle.borne.desactiver',
  'socle.borne.reinitialiser_acces',
  // ---- Paramétrage atelier et référentiels (plan-lot1-execution.md §6.4) ----------------------
  'parametrage.atelier.lire',
  'parametrage.atelier.modifier',
  // Issue #45 / RF-117 (0018), ÉTENDUE par issue #52 : `reception.
  // plafondAvoirReceptionnaireCentimes` ET `reception.plafondDefautCentimes` (même sémantique
  // documentée, `db/schema/atelier/parametrage.ts`) partagent l'endpoint `PATCH
  // /parametres-atelier` avec des réglages non financiers (§ « Bloc plafond d'avoir
  // réceptionnaire » plus bas pour le détail de l'arbitrage) — UN SEUL droit dédié pour les deux
  // champs (même table, même population de rôles), retiré d'`admin` (RF-115), PAS couvert par
  // `parametrage.atelier.modifier`.
  'parametrage.atelier.plafond_avoir.modifier',
  'parametrage.referentiel.lire',
  'parametrage.referentiel.modifier',
  // ---- Clients (§6.4 ; RM-01 → RM-14, spec lignes 233-248) -------------------------------------
  'client.lire',
  'client.creer',
  'client.modifier',
  'client.desactiver',
  'client.condition.modifier',
  'client.consentement.enregistrer',
  'client.note.ecrire',
  // Effacement nLPD (tâche « effacement nLPD », migration 0061) — bascule du palliatif
  // `clients/droits-provisoires.ts` (ROLES_CLIENT_ANONYMISATION/ROLES_CLIENT_EXPORT) : ces deux
  // routes portaient `@AucunDroitRequis()` et vérifiaient le rôle EN SERVICE, hors de cette
  // matrice — corrigé ici, voir les groupes `INFERE_CLIENT_EXPORT`/`INFERE_CLIENT_ANONYMISATION`
  // plus bas pour la composition par rôle.
  'client.export.generer',
  'client.anonymiser',
  // ---- Véhicules (§6.4 ; RM-15 → RM-33, spec lignes 250-270) -----------------------------------
  'vehicule.lire',
  'vehicule.creer',
  'vehicule.modifier',
  'vehicule.archiver',
  'vehicule.plaque.gerer',
  'vehicule.detention.changer',
  'vehicule.detention.corriger',
  'vehicule.kilometrage.saisir',
  'vehicule.kilometrage.corriger_regression',
  'vehicule.expertise.saisir',
  'vehicule.travail_reporte.gerer',
  // ---- Recherche comptoir (RM-112, spec ligne 370) ---------------------------------------------
  'recherche.executer',
  // ---- Ordre de réparation (§6.4 ; §5.1, spec lignes 376-475) ----------------------------------
  'atelier.or.lire',
  'atelier.or.creer',
  'atelier.or.modifier',
  'atelier.or.plafond_modifier',
  'atelier.or.receptionner',
  'atelier.or.demarrer',
  'atelier.or.passer_en_controle',
  'atelier.or.controler',
  'atelier.or.terminer',
  'atelier.or.rouvrir',
  'atelier.or.restituer',
  'atelier.or.cloturer',
  'atelier.or.annuler',
  // ---- Lignes d'OR (§6.4 ; §5.2, spec lignes 477-496) -------------------------------------------
  'atelier.ligne.creer',
  'atelier.ligne.modifier',
  'atelier.ligne.valider',
  'atelier.ligne.refuser',
  'atelier.ligne.annuler',
  'atelier.ligne.marquer_realisee',
  // ---- Devis complémentaire (§6.4 ; RM-79 → RM-86, spec lignes 326-335) -------------------------
  'atelier.devis.creer',
  'atelier.devis.repondre',
  // ---- Journal d'audit de l'OR (RM-59, RM-111) ---------------------------------------------------
  'atelier.journal.lire',
  // ---- Confirmations (contrats-api-etape-1.md §4.4, lignes 522-529) -----------------------------
  'atelier.confirmation.client_bloque',
  'atelier.confirmation.deux_or_ouverts',
  'atelier.confirmation.or_sans_rdv',
  // ---- Facturation — paiements (étape 2, RF-65 → RF-80, RF-114 → RF-116) -----------------------
  // Ajouté par le lot `paiements` (`apps/api/src/facturation/paiements/`), périmètre disjoint de
  // ce fichier (`apps/api/src/auth/`) — voir le rapport de livraison pour le détail de l'arbitrage.
  // Calé littéralement sur le tableau RF-114 (« Encaisser / imputer », « Rembourser un
  // trop-perçu ») de `docs/specification-etape-2-facturation.md` §9. `facturation.paiement.
  // abandonner` (RF-79 issue 3, « abandon en faveur du garage ») N'A PAS DE LIGNE LITTÉRALE dans
  // le tableau RF-114 — INFÉRÉ au même périmètre que « Rembourser un trop-perçu » (direction,
  // comptable) : c'est une décision de disposition financière de l'avance client, structurellement
  // plus engageante qu'un remboursement (elle renonce à rendre l'argent), jamais moins.
  'facturation.paiement.lire',
  'facturation.paiement.creer',
  'facturation.paiement.imputer',
  'facturation.paiement.rembourser',
  'facturation.paiement.abandonner',
  // ---- Facturation — chaîne documentaire (étape 2, RF-1 → RF-32, RF-114 → RF-120) --------------
  // Ajouté par le lot `documents` (`apps/api/src/facturation/documents/`), périmètre disjoint de
  // ce fichier — MÊME PATRON que le bloc « Facturation — paiements » ci-dessus (bloc additif pur,
  // fusionné dans `MATRICE_DROITS` sans toucher aux consts `DROITS_*` existantes), pour la MÊME
  // raison déjà posée par ce lot : `RF-114` (tableau §9 de la spec étape 2) casse la hiérarchie
  // stricte chef_atelier ⊇ receptionnaire / direction-admin ⊇ chef_atelier que ce fichier suit
  // depuis l'étape 1 — « Émettre une facture » est ✅ pour receptionnaire, ❌ pour chef_atelier ;
  // « Créer / modifier un brouillon » est ❌ pour admin (RF-115, séparation des pouvoirs), alors que
  // `DROITS_ADMIN` hérite normalement de `DROITS_DIRECTION`.
  //
  // TROIS actions d'ÉMISSION distinctes (pas une seule `facturation.document.emettre`) parce que
  // `RF-114` donne des lignes DIFFÉRENTES pour « Émettre un devis / bon de commande », « Émettre
  // une facture » et « Émettre un avoir » — alors que le contrat expose UN SEUL endpoint `POST
  // /documents-vente/{id}/emettre` pour les quatre types (`schemaEmissionDocumentVente` ne
  // distingue pas). `@ExigerDroit` est posé PAR ROUTE, statiquement, et ne peut donc pas choisir
  // entre les trois selon le `typeDocument` du document chargé (connu seulement APRÈS lecture en
  // base) — `facturation.document.emettre` reste posé sur la route comme portillon générique
  // (accordé à qui a AU MOINS un des trois droits d'émission ci-dessous), et
  // `ServiceEmissionDocument.emettre()` (`facturation/documents/service-emission.ts`, méthode
  // privée `verifierDroitEmission()`, appelée ligne 66 de `emettre()`, avant tout effet de bord)
  // vérifie le droit PRÉCIS pour le `typeDocument` réel via `MATRICE_DROITS[role]` — même patron
  // que `ServiceOr.modifier` (vérification dynamique post-chargement pour
  // `atelier.or.plafond_modifier`, `atelier/service-or.ts`). Couvertes par une entrée
  // `verification-conditionnelle-service` dans `common/droits/allowlist-actions-non-decorees.ts`,
  // PAS par un `@ExigerDroit` — impossible à poser statiquement sur une route à quatre types.
  //
  // RF-117 IMPLÉMENTÉ ET PROUVÉ. « Émettre un avoir » est plafonné en montant pour `receptionnaire`,
  // contrôlé dynamiquement dans `ServiceEmissionDocument.emettre()` (ligne 66 avant tout effet de
  // bord). Plafond paramétrable par tenant (`parametre_atelier.plafond_avoir_receptionnaire_centimes`,
  // migration 0018, centimes entiers, nullable) : NULL signifie aucun plafond convenu (garage non
  // configuré n'est pas plafonné). Comparaison CUMULATIVE (ce montant + tous avoirs déjà émis sur la
  // même facture) pour empêcher le contournement par fractionnement **À CONFIRMER AVEC @laupernoe**. Au-delà
  // du plafond, `receptionnaire` reçoit `409 AVOIR_PLAFOND_DEPASSE` ; état persiste avec `statut=
  // 'brouillon'` et `numero=NULL` (aucun numéro légal consommé). `direction`/`comptable` sans plafond.
  'facturation.document.lire',
  'facturation.document.creer',
  'facturation.document.modifier',
  'facturation.document.transitionner',
  'facturation.document.emettre',
  'facturation.document.emettre_devis_bc',
  'facturation.document.emettre_facture',
  'facturation.document.emettre_avoir',
  'facturation.avoir.creer',
  // Marqueur de CONTRAINTE (pas un pouvoir) : le rôle qui le détient voit ses avoirs soumis au
  // plafond RF-117 (`parametre_atelier.plafond_avoir_receptionnaire_centimes`). Vérifié en service.
  'facturation.avoir.plafonne',
  // `facturation.document.corriger` — demande relayée par le mainteneur pour le compte d'un lot
  // sans accès à ce fichier (même patron que les blocs additifs déjà présents ici). ENDPOINT SERVEUR
  // PAS ENCORE ÉCRIT à la date de cet ajout : contrat et écran l'appellent déjà, défaut ouvert par
  // ailleurs — le droit est posé EN AVANCE de l'opération pour que la route, le jour où elle
  // s'écrit, trouve sa garde déjà en place plutôt que d'être livrée sans `@ExigerDroit`. Distinct de
  // `facturation.document.emettre_avoir` : corriger une facture ÉMISE annule par avoir ET RECRÉE une
  // nouvelle facture dans la même opération — plus engageant qu'un simple avoir, ne réutilise donc
  // pas son périmètre. Réservé à `direction`/`comptable` EXACTEMENT (voir `DROITS_DOCUMENT_PAR_ROLE`
  // ci-dessous) — ni `admin` (RF-115, aucun droit financier), ni `receptionnaire` : périmètre
  // arbitré, à ne pas élargir « par cohérence apparente » avec les actions de facturation voisines.
  'facturation.document.corriger',
  // ---- Bloc créancier QR-facture (étape 2) — palier de gouvernance le plus élevé de la matrice ---
  // `GET|PATCH /parametres-facturation/creancier` (`apps/api/src/parametrage/bloc-creancier/`, PAS
  // le périmètre de ce fichier) porte l'IBAN sur lequel les clients du garage paient. Arbitrage du
  // coordinateur : un lot a livré ces routes SANS action de droit dédiée, faute d'accès à ce
  // fichier — constat juste, qu'il a signalé plutôt que d'inventer une entrée ici. Deux actions
  // dédiées, PAS `parametrage.atelier.modifier`/`parametrage.referentiel.modifier` : ces deux-là
  // donnent l'écriture à `admin` via `INFERE_PARAMETRAGE_GOUVERNANCE`, ce qui violerait `RF-115`
  // (« admin est un rôle technique et n'a aucun droit financier ») — changer l'IBAN d'encaissement
  // EST un geste financier, au moins aussi engageant que « Rembourser un trop-perçu »
  // (`DISPOSITION_AVANCE_PAIEMENT`, direction+comptable seuls) dont ce bloc reprend exactement le
  // périmètre. `admin` N'A NI L'UNE NI L'AUTRE — voir `DROITS_PARAMETRAGE_CREANCIER_PAR_ROLE`
  // ci-dessous, et le test dédié dans `matrice-droits.spec.ts` qui échoue si `admin` est un jour
  // rempli par copie de `direction`, exactement le geste que RF-115 interdit.
  'facturation.parametrage.creancier.lire',
  'facturation.parametrage.creancier.modifier',
  // ---- Export fiduciaire (étape 2) — même palier de gouvernance que le bloc créancier ------------
  // `POST /exports-fiduciaires` (`apps/api/src/facturation/export/service-export-comptable.ts`, PAS
  // le périmètre de ce fichier) orchestre l'export comptable : sélection des factures/avoirs émis
  // non encore exportés sur une période, vérification de continuité de numérotation, construction
  // des écritures équilibrées, génération du fichier WinBIZ, marquage `exporte_le`/`export_id`, le
  // tout sous idempotence. Arbitrage du coordinateur, même motif que le bloc créancier : un lot a
  // livré le service complet et refusé de câbler la route faute de l'action de droit, plutôt que de
  // forcer par un cast (un `as Action` naïf sur un littéral hors union ne compile pas — pas de porte
  // de sortie silencieuse). Transmettre les écritures à la fiduciaire est un geste comptable
  // engageant et IRRÉVERSIBLE côté destinataire (`EXPORT_DEJA_TRANSMIS` existe précisément pour ce
  // cas) — au moins aussi sensible qu'un remboursement. Mêmes rôles EXACTEMENT que
  // `DISPOSITION_AVANCE_PAIEMENT` et le bloc créancier : direction + comptable seuls, `admin: []`
  // (RF-115) — voir `DROITS_EXPORT_COMPTABLE_PAR_ROLE` ci-dessous.
  'facturation.export.creer',
  // Lecture de l'export (aperçu, historique, relecture du fichier, plan comptable) : distincte de
  // `creer` pour que les routes GET ne demandent pas le droit de déclencher l'export. Mêmes rôles.
  'facturation.export.lire',
  // ---- Impression PDF facture QR (étape 2, docs/design-impression-facture-qr.md §11.5) ----------
  // `GET /documents-vente/{id}/pdf` (`apps/api/src/facturation/impression/`, PAS le périmètre de ce
  // fichier) génère le PDF de facture avec bulletin de versement QR — livré et prouvé contre la vraie
  // base, mais son contrôleur a dû être RETIRÉ (jamais monté) faute de cette action : voir le
  // commentaire de tête de `facturation/impression/impression.module.ts`.
  //
  // Le PDF expose les montants EN CLAIR, et sa charge QR aussi (elle encode le montant à payer) — RF-116
  // (la visibilité des montants dépend du rôle) s'applique donc à l'impression exactement comme à
  // l'écran. Ce droit est accordé EXACTEMENT aux rôles pour lesquels `roleVoitLesMontants()`
  // (`facturation/documents/mappeurs.ts`) est vrai, NI PLUS NI MOINS — voir `DROITS_IMPRESSION_PAR_ROLE`
  // ci-dessous pour le détail, et le test dédié dans `matrice-droits.spec.ts` qui lie explicitement
  // cette liste à `roleVoitLesMontants()` : un futur élargissement de l'un sans l'autre doit faire
  // rougir ce test. Un rôle qui ne voit pas les montants à l'écran ne doit pas pouvoir les télécharger
  // en PDF — exactement ce qui s'était produit avec la charge QR, masquée en bloc parce qu'elle contient
  // le montant.
  //
  // DÉLIBÉRÉMENT PAS calé sur `EMISSION_FACTURE` (qui exclut chef_atelier et magasinier) : ces deux
  // rôles n'ont pas le droit d'ÉMETTRE une facture, mais voient les montants — ils peuvent donc
  // IMPRIMER. Ce n'est pas une incohérence, c'est la distinction entre CONSULTER et ENGAGER.
  //
  // Ce test structurel `toutes-les-actions-couvertes.spec.ts` restera ROUGE pour cette action tant que
  // le contrôleur de `facturation/impression/` n'est pas réintégré — DÉLIBÉRÉ, même patron que le bloc
  // créancier et l'export fiduciaire avant que leurs routes n'existent. AUCUNE entrée n'est ajoutée
  // dans `allowlist-actions-non-decorees.ts` : la route sera statique, un `@ExigerDroit` normal la
  // couvrira dès que le contrôleur sera réintégré, ce n'est ni une vérification conditionnelle en
  // service ni une action inerte anticipée sans route prévue.
  'facturation.document.imprimer',
  // ---- Pièces (étape 3, RP-01→RP-25) — bloc ADDITIF PUR, calé sur la matrice §11 de
  // docs/specification-etape-3-pieces.md ; voir `DROITS_PIECES_PAR_ROLE` ci-dessous pour le détail
  // rôle par rôle et les écarts documentés vis-à-vis des colonnes marquées « (P) » (paramétrable
  // en théorie, non implémenté ce lot — traité comme sa valeur par défaut littérale, jamais
  // réglable via `parametre_pieces` qui ne porte aucune colonne pour ces droits).
  'pieces.article.lire',
  'pieces.article.creer',
  'pieces.article.modifier',
  'pieces.stock.lire',
  'pieces.stock.modifier',
  'pieces.mouvement.creer',
  // FAILLE CORRIGÉE (audit sécurité) : le paramètre `forcer` de `casse`/`perte`
  // (`POST /articles/{id}/mouvements/{casse|perte}`, `contrats/pieces/mouvement.ts`) permet de
  // passer outre le refus `409 STOCK_INSUFFISANT` et d'enregistrer un stock négatif — jusqu'ici
  // gouverné par le SEUL `pieces.mouvement.creer`, sans droit dédié : quiconque pouvait créer un
  // mouvement pouvait aussi forcer, sans décision distincte. Voir `DROITS_PIECES_PAR_ROLE` plus
  // bas et `ServiceMouvement.creerMouvementSortie` (`pieces/service-mouvement.ts`) pour le
  // contrôle réel, et `common/droits/allowlist-actions-non-decorees.ts` pour la justification de
  // sa couverture (vérification conditionnelle en service, comme `atelier.or.plafond_modifier`).
  'pieces.mouvement.forcer',
  'pieces.reservation.lire',
  'pieces.reservation.satisfaire',
  'pieces.reservation.liberer',
  // ---- Pièces, second relais (étape 3, fournisseurs/commandes/consignes/paramétrage) — transmis
  // par le mainteneur au nom du lot qui a complété le module Pièces (périmètre disjoint, sans
  // accès à ce fichier). Voir `DROITS_PIECES_PAR_ROLE` ci-dessous pour le détail rôle par rôle.
  'pieces.fournisseur.lire',
  'pieces.fournisseur.creer',
  'pieces.fournisseur.modifier',
  'pieces.commande_fournisseur.lire',
  'pieces.commande_fournisseur.creer',
  'pieces.commande_fournisseur.reception',
  'pieces.consigne.lire',
  'pieces.consigne.retourner',
  'pieces.parametrage.lire',
  'pieces.parametrage.modifier',
  // Factures fournisseur (dépôt/rapprochement) — bascule depuis le palliatif
  // `pieces/factures-fournisseur/droits-provisoires.ts` (retiré, voir `DROITS_PIECES_PAR_ROLE`
  // ci-dessous pour le détail rôle par rôle). Divergence corrigée avec le front au passage : le
  // palliatif accordait admin (violait RF-115) et direction (aucun geste de confirmation physique,
  // contrairement au front qui les excluait déjà tous les deux) en écriture, et excluait
  // chef_atelier en lecture (que le front accordait déjà) — voir `matrice-droits.spec.ts`, describe
  // dédié, pour la table de vérité.
  'pieces.facture_fournisseur.lire',
  'pieces.facture_fournisseur.deposer',
  'pieces.facture_fournisseur.valider',
  'pieces.facture_fournisseur.rejeter',
  // ---- Ventes VN/VO (étape 4, RV-01→RV-62) — bloc ADDITIF PUR, calé sur la matrice §11 de
  // docs/specification-etape-4-ventes.md (4 colonnes SEULEMENT : vendeur, direction, comptable,
  // receptionnaire — chef_atelier/technicien/magasinier/admin n'y apparaissent dans AUCUNE
  // colonne). Voir `DROITS_VENTES_PAR_ROLE` ci-dessous pour le détail rôle par rôle, les 9 lignes
  // littérales de §11, et les écarts INFÉRÉS documentés (dont deux `[À VALIDER, QV-15/QV-16]`
  // explicites côté spécification, traités en position CONSERVATRICE — refusés plutôt qu'accordés
  // par optimisme).
  'ventes.vehicule_stock.lire',
  'ventes.vehicule_stock.creer',
  'ventes.vehicule_stock.modifier',
  'ventes.vehicule_stock.corriger',
  'ventes.dossier.lire',
  'ventes.dossier.creer',
  'ventes.dossier.modifier',
  'ventes.dossier.engager',
  'ventes.dossier.preparer',
  'ventes.dossier.marquer_pret_a_livrer',
  'ventes.dossier.livrer',
  'ventes.dossier.cloturer',
  'ventes.dossier.annuler',
  'ventes.dossier.abandonner',
  'ventes.reprise.lire',
  'ventes.reprise.creer',
  'ventes.reprise.modifier',
  'ventes.reprise.negocier',
  'ventes.reprise.confirmer',
  'ventes.reprise.refuser',
  'ventes.financement.lire',
  'ventes.financement.creer',
  'ventes.financement.confirmer',
  'ventes.financement.refuser',
  // ---- Pointage (lot 2, RM-87→RM-99, RM-113→RM-123) — bloc ADDITIF PUR, transmis par
  // le mainteneur au nom du lot `pointage/` (périmètre disjoint, sans accès à ce fichier).
  // Voir `DROITS_POINTAGE_PAR_ROLE` ci-dessous. Trois actions citées par la spécification
  // (`lire_equipe`, `lire_indicateurs`, `corriger_soi_meme`) sont VOLONTAIREMENT absentes : aucune
  // route livrée ne les consomme encore — les ajouter maintenant créerait des actions inertes que
  // le test structurel de couverture (`toutes-les-actions-couvertes.spec.ts`) obligerait à faire
  // vivre artificiellement. Elles viendront avec leur implémentation.
  'atelier.pointage.demarrer',
  'atelier.pointage.arreter',
  'atelier.pointage.lire',
  'atelier.pointage.corriger_autrui',
  // `pointer_autrui` (FAILLE CORRIGÉE, audit sécurité) — DÉMARRER ou ARRÊTER le pointage d'un
  // AUTRE que soi. `demarrer`/`arreter` ci-dessus ouvrent la route à tout rôle qui pointe ; ils ne
  // disent RIEN sur la CIBLE. Avant correction, un technicien pouvait poster un pointage avec le
  // `technicienId` d'un collègue (heures imputées à autrui) — la route ne portait aucun contrôle de
  // propriété. Ce droit gouverne EXACTEMENT ce cas : `technicienId` (démarrage) ou
  // `pointage.technicienId` (arrêt) ≠ utilisateur de la session. Vérifié DYNAMIQUEMENT en service
  // (`ServicePointage.exigerDroitCiblerAutrui`), pas par `@ExigerDroit` : la route sert AUSSI le cas
  // légitime « pour soi », qu'un garde statique interdirait au technicien. Même patron que
  // `atelier.or.plafond_modifier` / `vehicule.kilometrage.corriger_regression` (voir
  // `allowlist-actions-non-decorees.ts`, catégorie `verification-conditionnelle-service`).
  // Encadrement SEUL (chef_atelier/direction/admin) — voir `DROITS_POINTAGE_PAR_ROLE`. La borne
  // `poste_atelier` ne le détient PAS et n'en a pas besoin : un compte de service n'a pas d'identité
  // personnelle (jamais « soi »), la vérification `soi/autrui` ne le concerne pas (elle l'exempte via
  // `estCompteDeService`), et sa capacité à pointer pour le technicien identifié par PIN reste portée
  // par `demarrer`/`arreter` + le scoping de site, jamais par ce droit — ce qui préserve son jeu de
  // droits minimal (RM-115/RM-131, « aucun geste sensible depuis un écran mural »).
  'atelier.pointage.pointer_autrui',
  'atelier.pointage.verrouiller_periode',
  'atelier.pointage.deverrouiller_periode',
  // ---- Mode « borne partagée » du pointage (docs/specification-pointage-borne.md) --------------
  // Deux actions posées par l'équipe authentification EN AMONT du module PIN, pour que le lot qui construira
  // `pin_pointage` / `POST /pointages/identification` s'appuie sur des noms déjà figés plutôt que
  // d'en inventer. Aucune route ne les exerce aujourd'hui : elles sont déclarées
  // `action-inerte-anticipee` dans `common/droits/allowlist-actions-non-decorees.ts`.
  //
  // `identifier` : reconnaître un technicien par son code PIN sur une borne. N'ouvre AUCUNE
  // session (contrat `pointage/identification.ts`) — c'est pourquoi ce n'est pas une action
  // d'auth mais une action de pointage. Réservée au seul rôle `poste_atelier` : sur un compte de
  // personne, l'identification n'a pas d'objet (la session dit déjà qui agit), et l'ouvrir plus
  // largement offrirait un oracle de PIN à n'importe quel compte du tenant.
  //
  // `gerer_pin` : attribuer ou réinitialiser le PIN d'un technicien sur un site (RM-128). Droit
  // DISTINCT de `parametrage.atelier.modifier` (qui gouverne le MODE du site, décision
  // d'organisation rare, direction/admin) : attribuer un PIN est un geste quotidien d'atelier qui
  // ne doit pas attendre la direction.
  'atelier.pointage.identifier',
  'atelier.pointage.gerer_pin',
  // ---- Tableau de bord (arbitrage coordinateur) — `apps/api/src/tableau-bord/`, périmètre
  // disjoint de ce fichier. Livré derrière un palliatif signalé, pas un accès ouvert par
  // négligence : les deux routes portaient `@AucunDroitRequis()` + une vérification de rôle posée
  // EN SERVICE (`tableau-bord/droits-provisoires.ts`, retiré par ce bloc — voir le détail rôle par
  // rôle sous `DROITS_TABLEAU_BORD_ACTIVITE_PAR_ROLE` / `DROITS_TABLEAU_BORD_FINANCIER_PAR_ROLE`
  // ci-dessous), faute d'accès de son auteur à ce fichier — même patron que le bloc créancier avant
  // que ses actions n'existent.
  'tableau_bord.activite.lire',
  'tableau_bord.financier.lire',
  // ---- Pneus — hangar à pneus (docs/specification-parc-et-hangar-pneus.md, RPP-01→RPP-08) ------
  // Bloc ADDITIF PUR, transmis par le mainteneur au nom du lot qui a livré
  // `apps/api/src/pneus/` (périmètre disjoint, sans accès à ce fichier — palliatif signalé, pas un
  // accès ouvert par négligence, même patron que le tableau de bord juste au-dessus : les six
  // routes portaient `@AucunDroitRequis()` + une vérification de rôle posée EN SERVICE
  // (`pneus/droits-provisoires.ts`, retiré par ce bloc), faute d'accès de son auteur à ce fichier.
  //
  // TROIS actions proposées par ce lot (`pneus.depot.lire`, `pneus.depot.creer`,
  // `pneus.depot.gerer`) — CORRIGÉES ICI en QUATRE : `pneus.depot.gerer` couvrait à la fois
  // `POST .../changer-saison` (RPP-03, bascule réversible monté ↔ en dépôt, geste physique
  // routinier de l'atelier) ET `POST .../sortir` (RPP-05, statut TERMINAL, motif obligatoire —
  // rendu au client, véhicule vendu, mis au rebut) avec le MÊME jeu de rôles pour les deux, faute
  // d'arbitrage. Ce n'est PAS le même geste : « sortir » est la sortie DÉFINITIVE d'un bien du
  // client de la garde du garage (le jeu de pneus quitte le hangar pour de bon, aucun retour en
  // arrière possible hors nouvelle entrée), donc structurellement plus proche d'`atelier.or.
  // restituer` (rendre le VÉHICULE au client, réservé receptionnaire/chef_atelier/direction/admin,
  // PAS technicien/magasinier — `L978_OR_RESTITUER` ci-dessus) que d'un simple changement de statut
  // réversible. Voir `DROITS_PNEUS_PAR_ROLE` ci-dessous pour le détail rôle par rôle : `sortir`
  // reprend EXACTEMENT le périmètre de `atelier.or.restituer`, `creer`/`changer_saison` reprennent
  // EXACTEMENT celui de `atelier.ligne.creer` (le geste physique de saisie d'atelier, déjà ouvert à
  // technicien et magasinier dans ce fichier).
  'pneus.depot.lire',
  'pneus.depot.creer',
  'pneus.depot.changer_saison',
  'pneus.depot.sortir',
  // ---- Relances automatiques (docs/specification-relances-automatiques.md, lot 1 facturation) ---
  // Bloc ADDITIF PUR, transmis par le mainteneur au nom du lot qui a livré
  // `apps/api/src/relances/` (périmètre disjoint, sans accès à ce fichier — palliatif signalé, pas
  // un accès ouvert par négligence, même patron que le tableau de bord et les pneus ci-dessus : les
  // quatre routes portaient `@AucunDroitRequis()` + une vérification de rôle posée EN SERVICE
  // (`relances/droits-provisoires.ts`, retiré par ce bloc), faute d'accès de son auteur à ce
  // fichier.
  //
  // UN SEUL jeu de rôles pour LIRE et ÉCRIRE — choix produit, confirmé, qui casse ICI la
  // doctrine par défaut de ce fichier (« la lecture est ouverte, seule l'écriture est gouvernée »,
  // `LECTURE_ETENDUE`/`pneus.depot.lire`/`tableau_bord.activite.lire` ci-dessus) : même LIRE la
  // configuration des relances (délais par palier, canaux) expose une politique de recouvrement du
  // garage (quand et comment on relance un client en retard de paiement) — déjà une décision
  // financière/commerciale, pas un fait neutre comme un statut d'OR ou un dépôt de pneus. Voir
  // `DROITS_RELANCES_PAR_ROLE` ci-dessous.
  //
  // Aligné sur le palier de gouvernance le PLUS ÉLEVÉ déjà posé dans ce fichier — EXACTEMENT le
  // même périmètre que le bloc créancier, l'export fiduciaire, la disposition d'une avance de
  // paiement et le tableau de bord financier : `direction` + `comptable` SEULS. `admin` EXCLU
  // délibérément (RF-115, littéral : « admin est un rôle technique et n'a aucun droit financier » —
  // configurer ou déclencher un rappel de facture EST un geste financier, jamais comblé par
  // copier-coller de `direction`). Tous les rôles opérationnels exclus également
  // (`vendeur`/`receptionnaire`/`chef_atelier`/`technicien`/`magasinier`) : aucun d'eux ne pilote la
  // politique de recouvrement du garage.
  'relances.facturation.regle.lire',
  'relances.facturation.regle.ecrire',
  'relances.facturation.planifier',
  'relances.facturation.envoyer',
  // ---- Rendez-vous d'atelier (lot RDV-1, docs/conception-rendez-vous-metier.md §7, §9) ---------
  // Bloc ADDITIF PUR, ajouté par le lot `apps/api/src/rendezvous/` (périmètre disjoint autorisé
  // à toucher ce fichier pour cette tâche — contrairement aux autres blocs additifs ci-dessus, pas
  // un palliatif : aucune route ne tournait avant ce bloc).
  //
  // Distinct de `atelier.confirmation.or_sans_rdv`/les anciennes confirmations RDV/prêt (supprimées,
  // inertes) : ceux-là gouvernent des CONFIRMATIONS (§4.4), ceux-ci des ACTIONS. Distinct aussi de
  // `parametrage.referentiel.lire`, réutilisé tel quel pour `GET /motifs-rendez-vous` (catalogue
  // paramétrable, même nature que `GET /referentiels/taux-horaires` — pas une action propre au
  // domaine rendez-vous, aucune entrée dédiée nécessaire ici).
  //
  // Répartition calée sur le brief de le mainteneur, littéral : « le réceptionniste prend et
  // déplace les rendez-vous, le chef d'atelier les voit et les réorganise, le technicien les
  // consulte » — donc `rendez_vous.creer` au réceptionniste SEUL (« prend »), `rendez_vous.
  // modifier`/`arrivee`/`absence`/`annuler` à réceptionniste ET chef_atelier (« déplace » /
  // « réorganise » couvrent le cycle de vie complet une fois pris), `rendez_vous.lire` ouvert aux
  // trois plus direction/admin. `admin` reçoit le périmètre de `direction` (rôle technique,
  // superset par construction, même doctrine que `DROITS_ADMIN` — RF-115 n'entre pas en jeu ici,
  // aucune de ces actions n'est financière). `vendeur`/`magasinier`/`comptable`/`poste_atelier` :
  // exclus, même périmètre que `atelier.or.*` (ni l'un ni l'autre n'est acteur du flux RDV, même
  // raisonnement que `LECTURE_OR` déjà posé plus haut dans ce fichier).
  'rendez_vous.lire',
  'rendez_vous.creer',
  'rendez_vous.modifier',
  'rendez_vous.arrivee',
  'rendez_vous.absence',
  'rendez_vous.annuler',
  // ---- Reprise de données (`apps/api/src/reprise/`, contrats/reprise.ts, migrations 0066/0067) —
  // bloc ADDITIF PUR, ajouté par le lot d'assemblage qui a câblé `RepriseModule` dans
  // `app.module.ts` (périmètre disjoint autorisé à toucher ce fichier pour cette tâche précise —
  // même situation que `rendez_vous.*` ci-dessus, PAS un palliatif : les cinq contrôleurs du
  // module portaient `@AucunDroitRequis()` sur TOUTES leurs routes, remplacé ici).
  //
  // GRANULARITÉ, calée sur ce que fait ce fichier pour des opérations comparables (§ tête de
  // fichier, RF-115, bloc créancier/export comptable) : la reprise crée en bloc des clients, des
  // véhicules et des documents de vente dans le tenant — un geste d'ONBOARDING technique
  // (rare, un garage qui bascule depuis Auto-i/Nextlane), pas un geste commercial courant.
  //
  //  - `reprise.dossier.*`/`reprise.analyse.*`/`reprise.plan.lire`/`reprise.plan.modifier`/
  //    `reprise.import.lire` : périmètre « administration système » (RF-115 : « admin administre
  //    le système pour le compte du garage — tenants, sites, utilisateurs, paramètres »), MÊME
  //    DOCTRINE que `DROITS_UTILISATEUR_PAR_ROLE` (gestion des employés) et
  //    `DROITS_RENDEZ_VOUS_PAR_ROLE.admin` ci-dessus : `admin` reçoit le MÊME périmètre que
  //    `direction` ici, parce que déposer une archive, lancer une analyse ou ajuster le plan
  //    proposé NE CRÉE ENCORE AUCUNE donnée dans les tables métier du tenant — c'est de la
  //    préparation technique, exactement le type de tâche que RF-115 confie à `admin`.
  //  - `reprise.plan.valider`/`reprise.import.lancer` : L'ACTE LOURD — celui-ci, et lui seul,
  //    déclenche l'écriture RÉELLE de clients/véhicules/documents de vente dans le tenant
  //    (`import/service-import-reprise.ts`), en bloc et de façon quasi irréversible (pas
  //    d'annulation automatique, seule une purge manuelle du dossier). Struturellement plus
  //    engageant qu'une simple préparation — ALIGNÉ SUR LE PALIER DE GOUVERNANCE LE PLUS ÉLEVÉ
  //    déjà posé dans ce fichier (bloc créancier, export comptable, disposition d'une avance de
  //    paiement) : `admin` EXCLU, littéralement, JAMAIS comblé par copier-coller de `direction`
  //    (RF-115 : « admin n'a aucun droit financier » — importer en bloc des documents de vente
  //    EST un geste financier, même quand la donnée est historique). Restreint à `direction`
  //    SEULE ici (pas même `comptable`, à la différence du bloc créancier/export comptable) :
  //    `reprise.import.lancer` déclenche une opération technique de bascule de données, pas une
  //    décision de gestion financière courante — `comptable` n'a pas vocation à la piloter.
  //    ARBITRAGE PRUDENT, PAS UNE SPEC ÉCRITE : à confirmer avec @laupernoe si un rôle plus large
  //    s'avère nécessaire en pratique (signalé au rapport de livraison).
  'reprise.dossier.lire',
  'reprise.dossier.deposer',
  'reprise.dossier.annuler',
  'reprise.analyse.lire',
  'reprise.analyse.lancer',
  'reprise.plan.lire',
  'reprise.plan.modifier',
  'reprise.plan.valider',
  'reprise.import.lire',
  'reprise.import.lancer',
  // ---- Véhicules de courtoisie et travaux reportés saisis à la main --------------------------------
  //    `courtoisie.lire` : voir le parc et sa disponibilité (« une voiture libre jeudi ? ») —
  //    réceptionnaire, chef d'atelier, direction, admin, technicien (le mécanicien prête aussi la
  //    voiture au client qui attend, mais ne décide pas du parc). `courtoisie.preter` : créer,
  //    rendre ou annuler un prêt — comptoir seulement (réceptionnaire et au-dessus, pas
  //    technicien). `courtoisie.parc.gerer` : ajouter/modifier/retirer un véhicule du parc —
  //    chef d'atelier, direction, admin. `vehicule.travail_reporte.signaler` : noter un travail
  //    « à faire la prochaine fois » — réceptionnaire, chef d'atelier, direction, admin ET
  //    technicien (c'est le mécanicien sous le capot qui le voit). Corriger/clore un travail reste
  //    `vehicule.travail_reporte.gerer`. Aucune de ces actions n'est financière (admin inclus).
  'courtoisie.lire',
  'courtoisie.preter',
  'courtoisie.parc.gerer',
  'vehicule.travail_reporte.signaler',
  // ---- Photos d'une ligne d'OR ------------------------------------------------------------------
  //    `ajouter` : le geste physique de prendre la photo — mêmes titulaires que
  //    `atelier.ligne.creer` (magasinier inclus, vendeur/comptable exclus). La borne `poste_atelier`
  //    est exclue (compte de service, invariant « pointage seul »). `lire` : tous les rôles de
  //    personne. `supprimer` : encadrement partout ; technicien et magasinier seulement leurs
  //    propres photos (contrôle d'auteur dans le service). Aucune n'est financière.
  'atelier.ligne.photo.ajouter',
  'atelier.ligne.photo.lire',
  'atelier.ligne.photo.supprimer',
] as const;

/**
 * Action métier protégée. Convention : `domaine.ressource.verbe`.
 *
 * DÉRIVÉ de `TOUTES_ACTIONS` ci-dessus, jamais l'inverse — refactor délibéré (voir aussi
 * `common/droits/toutes-les-actions-couvertes.spec.ts`) : avant, ce type était un littéral écrit à
 * la main, et le test structurel qui doit prouver que CHAQUE action a un contrôle réel recopiait
 * cette liste à la main dans un second fichier (`Record<Action, true>` codé en dur). Les deux
 * pouvaient diverger sans qu'aucun test ne rougisse : `vitest run` tourne sous SWC en
 * transpile-only (voir `vitest.config.ts`), qui efface les types avant exécution — une divergence
 * entre `Action` et l'énumération recopiée n'était détectée QUE par `pnpm typecheck` (`tsc`
 * complet), jamais par le test qui prétendait pourtant garantir la couverture. C'est exactement ce
 * qui s'est produit : 14 actions de facturation ajoutées au type sont restées invisibles au test
 * structurel pendant tout un cycle de lots, découvertes seulement par un `tsc --noEmit` isolé.
 * Dériver le type de la constante élimine la possibilité même de cette divergence — il n'existe
 * plus deux listes à synchroniser, une seule, lue à la fois par le compilateur ET par `vitest run`.
 */
export type Action = (typeof TOUTES_ACTIONS)[number];

// =================================================================================================
// Matrice DÉRIVÉE du modèle de capacités (phase 1 de la simplification des rôles)
// =================================================================================================
//
// Avant : une liste d'actions par rôle, écrite à la main (conservée pour les tests dans
// `matrice-droits-historique.ts`, avec toute l'histoire des arbitrages). Maintenant : chaque
// ACTION est rattachée à une ou deux capacités (`capacites-actions.ts`, `Record<Action, …>` — une
// action non classée ne compile pas), chaque PERSONNE porte une grille (`@dfa/shared`
// `GrilleCapacites`, colonnes de `utilisateur`), et les rôles ne sont plus que des préréglages.
// `MATRICE_DROITS[role]` n'est donc plus que « les actions du préréglage de ce rôle » : la valeur
// d'une personne sans grille connue (tests, comptes créés hors API), JAMAIS la source de la garde
// quand la grille de la personne est chargée (`auth/droits-personne.ts`).

/**
 * Profil d'appareil de la borne d'atelier (`poste_atelier`) — FIGÉ, hors grille (invariants
 * RM-115 / RM-131) : lire les OR de son site, pointer, identifier un technicien par PIN. Aucun
 * montant, aucun geste sensible. Une grille stockée sur une borne est ignorée.
 */
export const ACTIONS_PROFIL_BORNE: readonly Action[] = [
  'socle.tenant.lire',
  'socle.site.lire',
  'atelier.or.lire',
  'atelier.pointage.demarrer',
  'atelier.pointage.arreter',
  'atelier.pointage.lire',
  'atelier.pointage.identifier',
];

function capacitesDeLAction(action: Action): readonly Capacite[] {
  const classement = CAPACITE_DE_L_ACTION[action];
  return typeof classement === 'string' ? [classement] : classement;
}

const CACHE_ACTIONS_PAR_GRILLE = new Map<string, readonly Action[]>();

function cleDeGrille(g: GrilleCapacites): string {
  return JSON.stringify([
    g.niveaux,
    g.encadrer,
    g.gererEmployes,
    g.patron,
    // TOUTES les options : `voitMontants` conditionne `facturation.montants` et le domaine Finances
    // (une clé qui l'omettrait ferait partager à deux personnes les droits de l'une).
    g.options,
  ]);
}

/**
 * Actions qu'accorde une grille : celles dont AU MOINS UNE capacité est détenue. Mémoïsé (les
 * grilles distinctes d'un garage se comptent sur les doigts).
 */
export function actionsDeLaGrille(grille: GrilleCapacites): readonly Action[] {
  const cle = cleDeGrille(grille);
  const connu = CACHE_ACTIONS_PAR_GRILLE.get(cle);
  if (connu) return connu;
  const capacites = capacitesDeLaGrille(grille);
  const actions = TOUTES_ACTIONS.filter((action) =>
    capacitesDeLAction(action).some((c) => capacites.has(c)),
  );
  CACHE_ACTIONS_PAR_GRILLE.set(cle, actions);
  return actions;
}

function actionsDuPrereglageDuRole(role: RoleUtilisateur): readonly Action[] {
  if (role === 'poste_atelier') return ACTIONS_PROFIL_BORNE;
  return actionsDeLaGrille(PREREGLAGES[role].grille);
}

/**
 * Actions du PRÉRÉGLAGE de chaque rôle. `Record<RoleUtilisateur, …>` : un rôle ajouté à l'enum sans
 * préréglage ne compile pas (même garantie que l'ancienne matrice, bloquant B3).
 */
export const MATRICE_DROITS: Readonly<Record<RoleUtilisateur, readonly Action[]>> = {
  admin: actionsDuPrereglageDuRole('admin'),
  direction: actionsDuPrereglageDuRole('direction'),
  vendeur: actionsDuPrereglageDuRole('vendeur'),
  receptionnaire: actionsDuPrereglageDuRole('receptionnaire'),
  chef_atelier: actionsDuPrereglageDuRole('chef_atelier'),
  technicien: actionsDuPrereglageDuRole('technicien'),
  magasinier: actionsDuPrereglageDuRole('magasinier'),
  comptable: actionsDuPrereglageDuRole('comptable'),
  poste_atelier: actionsDuPrereglageDuRole('poste_atelier'),
};

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
  // Codes jamais émis par l'API (aucun contrôleur ni écran ne les cite) : conservés dans l'enum
  // partagé (contrat publié) donc la table reste exhaustive, mais sans action dédiée — fail-closed
  // sur le droit le plus strict (chef d'atelier / direction) en attendant un vrai usage.
  RDV_RESSOURCE_CHEVAUCHEMENT: 'atelier.confirmation.client_bloque',
  RDV_HORS_OUVERTURE: 'atelier.confirmation.client_bloque',
  PRET_VEHICULE_INDISPONIBLE: 'atelier.confirmation.client_bloque',
};
