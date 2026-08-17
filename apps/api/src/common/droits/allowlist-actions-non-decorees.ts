import type { Action } from '../../auth/matrice-droits';

/**
 * Allowlist EXPLICITE des `Action` (`apps/api/src/auth/matrice-droits.ts`) qui n'ont — et ne
 * peuvent pas avoir — de `@ExigerDroit(action)` posé sur une route, sans que ce soit un trou.
 *
 * Ce fichier est le cœur du dispositif anti-régression de `toutes-les-actions-couvertes.spec.ts`.
 * Contexte : un audit a trouvé `vehicule.kilometrage.corriger_regression` dans la matrice,
 * réservée au chef d'atelier / à la direction, mais posée sur AUCUNE route — n'importe quel
 * technicien pouvait donc faire reculer un compteur kilométrique sans qu'aucun test ne s'en
 * aperçoive. La faille elle-même est corrigée (voir l'entrée ci-dessous), mais rien n'empêchait
 * qu'elle se reproduise avec une autre action : le test sibling exige maintenant que TOUTE action
 * de l'union `Action` soit couverte par l'un de 4 mécanismes. Les deux premiers sont détectés
 * automatiquement par un scan (un `@ExigerDroit` réel dans le graphe de modules monté, ou une
 * valeur de `DROIT_PAR_CONFIRMATION`). Les deux autres ne PEUVENT PAS l'être par un scan statique
 * et vivent ici, chacun avec sa justification :
 *
 *  - `verification-conditionnelle-service` : le droit est exigé par du code métier, à l'intérieur
 *    d'un service, sur UNE branche seulement d'un traitement qui partage sa route avec un cas non
 *    protégé — poser `@ExigerDroit` statiquement sur la route interdirait aussi le cas non protégé
 *    (ex. la saisie NORMALE de kilométrage, qui doit rester ouverte au technicien).
 *  - `action-inerte-anticipee` : l'action existe dans la matrice par anticipation (déclaration
 *    volontaire avant que la route HTTP correspondante n'existe — module futur, ou endpoint
 *    d'écriture pas encore publié dans un module qui, lui, existe déjà), mais AUCUNE route ne
 *    l'exerce aujourd'hui : il n'y a rien à décorer.
 *
 * RÈGLES DE CE FICHIER — imposées par le test, pas seulement documentées ici :
 *  1. Chaque entrée DOIT porter une `justification` non vide et substantielle (le test rejette une
 *     justification vide ou trop courte pour être informative), EN PLUS du commentaire au-dessus
 *     de l'entrée qui s'adresse au relecteur humain, pas à la machine — les deux sont vérifiés
 *     séparément, aucun des deux ne dispense de l'autre.
 *  2. Une entrée qui référence une action absente de l'union `Action` actuelle (renommée ou
 *     supprimée depuis l'ajout de l'entrée) fait ROUGIR le test : cette liste ne doit jamais
 *     devenir un cimetière qui autorise silencieusement un trou.
 *  3. Ajouter une action ici est un choix qui s'assume : si elle peut être câblée par un
 *     `@ExigerDroit` normal, câblez-la plutôt que de l'ajouter ici. Cette liste n'existe que pour
 *     les deux cas ci-dessus, jamais comme échappatoire de confort pour « faire passer le test ».
 *     (Ce qu'il NE FAUT PAS faire, à titre d'exemple hypothétique : inscrire ici une action dont la
 *     route existe et répond, mais qui reste gardée par un `@ExigerDroit` DIFFÉRENT et plus large —
 *     sans qu'aucun contrôle réel, nulle part en service, ne vérifie CETTE action précise. Ce n'est
 *     alors ni une vérification conditionnelle en service (rien ne la vérifie), ni une action
 *     inerte (la route existe et fonctionne) : ça n'a pas sa place ici, et le test sibling doit la
 *     signaler comme non couverte tant qu'elle n'est pas câblée par son propre `@ExigerDroit` ou par
 *     un contrôle conditionnel réel en service. `atelier.or.plafond_modifier`, ci-dessous, a été un
 *     temps ce cas précis — refusé à raison dans cette liste jusqu'à ce qu'un contrôle réel existe —
 *     avant qu'un contrôle conditionnel en service ne soit effectivement posé dans
 *     `ServiceOr.modifier`, ce qui justifie désormais sa présence ici.)
 */

export type CategorieAllowlistAction =
  'verification-conditionnelle-service' | 'action-inerte-anticipee';

export interface EntreeAllowlistAction {
  readonly action: Action;
  readonly categorie: CategorieAllowlistAction;
  /** Doit dire QUOI (le mécanisme réel) et OÙ (fichier + fonction/branche) — voir règle 1 ci-dessus. */
  readonly justification: string;
}

export const ALLOWLIST_ACTIONS_SANS_DECORATEUR: readonly EntreeAllowlistAction[] = [
  // ---------------------------------------------------------------------------------------------
  // Vérifications conditionnelles en service
  // ---------------------------------------------------------------------------------------------
  {
    // FAILLE CORRIGÉE (audit sécurité) : ce droit n'était vérifié NULLE PART avant correction — un
    // technicien pouvait déclarer n'importe quel kilométrage régressif sans que rien ne s'y
    // oppose. La route `POST .../kilometrages` sert À LA FOIS la saisie normale (tout rôle avec
    // `vehicule.kilometrage.saisir`, y compris technicien) ET la correction régressive (RM-24,
    // §10 L962) : `@ExigerDroit` est statique par route, il ne peut pas distinguer les deux
    // requêtes AVANT exécution — seul le service, après avoir chargé le dernier relevé connu, sait
    // si CETTE saisie précise est régressive.
    action: 'vehicule.kilometrage.corriger_regression',
    categorie: 'verification-conditionnelle-service',
    justification:
      'Contrôle réel : ServiceVehiculeKilometrage.creer() (apps/api/src/vehicules/service-vehicule-kilometrage.ts), ' +
      'bloc `if (decision.regressif) { const droitsDuRole = MATRICE_DROITS[role] ?? []; if ' +
      "(!droitsDuRole.includes('vehicule.kilometrage.corriger_regression')) throw ... }`, exécuté UNIQUEMENT quand le " +
      'relevé nouvellement soumis est inférieur au dernier relevé connu — jamais en permanence, sinon la saisie ' +
      'normale du technicien (droit vehicule.kilometrage.saisir) serait aussi bloquée par ce droit plus fort.',
  },
  {
    // Même famille que `vehicule.kilometrage.corriger_regression` ci-dessus. `PATCH
    // /ordres-reparation/{orId}` (ServiceOr.modifier) sert TOUS les champs libres de l'en-tête de
    // l'OR sous le SEUL droit `atelier.or.modifier`, alors que `plafondCentimes` (le montant
    // au-delà duquel l'accord du client est requis, RM-54, §10 L969) mérite son propre droit,
    // structurellement plus fort, `atelier.or.plafond_modifier`. Un `@ExigerDroit` STATIQUE sur
    // cette route interdirait AUSSI les modifications ordinaires (localisation, sous-traitant,
    // report de restitution…) à tout rôle qui a `atelier.or.modifier` sans `atelier.or.plafond_modifier`
    // — la route est partagée entre les deux usages, et seul le service, après avoir chargé la
    // valeur actuelle sous verrou, sait si CETTE requête précise touche réellement le plafond.
    action: 'atelier.or.plafond_modifier',
    categorie: 'verification-conditionnelle-service',
    justification:
      'Contrôle réel : ServiceOr.modifier() (apps/api/src/atelier/service-or.ts, ~lignes 248-270), bloc ' +
      '`const modifiePlafond = entree.plafondCentimes !== undefined && entree.plafondCentimes !== (ligne.plafondCentimes ' +
      '?? undefined); if (modifiePlafond) { const droitsDuRole = MATRICE_DROITS[principal.role] ?? []; if ' +
      "(!droitsDuRole.includes('atelier.or.plafond_modifier')) throw ... }`, exécuté UNIQUEMENT quand la valeur de " +
      'plafondCentimes soumise diffère de la valeur actuelle en base (resoumettre la même valeur ne déclenche pas la ' +
      'garde) — jamais en permanence, sinon les modifications ordinaires des autres champs de la même route seraient ' +
      "aussi bloquées par ce droit plus fort. Le rôle est lu depuis l'appelant (principal.role), jamais depuis le " +
      'client. Couvert par 5 tests dans apps/api/src/atelier/service-or.spec.ts : refus 403 sans écriture en base ' +
      'pour un rôle non habilité qui tente de RELEVER le plafond, acceptation pour un rôle habilité (réceptionnaire), ' +
      'un champ ordinaire (localisation) reste modifiable sans le droit fort, resoumission de la même valeur ne ' +
      'déclenche pas la garde, et une BAISSE du plafond est bloquée aussi (pas seulement une hausse).',
  },

  {
    // FAILLE CORRIGÉE (audit sécurité) : `POST /pointages`, `POST /pointages/{id}/arreter` — un
    // technicien pouvait démarrer/arrêter un pointage au nom d'un AUTRE (heures imputées à un
    // collègue), la route ne vérifiant jamais que la cible (`technicienId` du corps au démarrage,
    // `pointage.technicienId` chargé à l'arrêt) correspond à l'utilisateur de la session. La route
    // sert À LA FOIS le cas légitime « pour soi » (tout rôle qui pointe) ET le cas « au nom d'un
    // autre » (encadrement : correction a posteriori, oubli de pointer) : `@ExigerDroit` est
    // statique par route, il ne peut pas distinguer les deux AVANT de connaître la cible — poser
    // `pointer_autrui` en garde statique interdirait au technicien de pointer POUR LUI-MÊME. Seul le
    // service, une fois la cible connue, sait si CETTE requête vise autrui. Même famille que
    // `vehicule.kilometrage.corriger_regression` et `atelier.or.plafond_modifier` ci-dessus.
    action: 'atelier.pointage.pointer_autrui',
    categorie: 'verification-conditionnelle-service',
    justification:
      'Contrôle réel : ServicePointage.exigerDroitCiblerAutrui() (apps/api/src/pointage/service-pointage.ts), ' +
      'appelée par demarrer() AVANT toute écriture (comparaison entree.technicienId vs principal.utilisateurId) et ' +
      'par arreter() juste après chargement du pointage sous verrou, AVANT ecrireFermeture() (comparaison ' +
      "actuel.technicienId vs principal.utilisateurId). Quand la cible diffère de l'utilisateur de la session, " +
      "vérifie MATRICE_DROITS[principal.role].includes('atelier.pointage.pointer_autrui') et lève DROIT_INSUFFISANT " +
      "(403) sinon — jamais quand on pointe pour soi (technicien pointant pour lui-même n'est pas bloqué). Les " +
      'comptes de service (borne poste_atelier, estCompteDeService) sont exemptés de ce contrôle : sans identité ' +
      'personnelle, le concept soi/autrui ne les concerne pas — ils pointent pour le technicien identifié par PIN, ' +
      "capacité portée par demarrer/arreter + le scoping de site, pas par pointer_autrui (qu'ils ne détiennent pas). " +
      'Le rôle est lu depuis principal.role (jamais depuis le client). Couvert par les tests de ' +
      'apps/api/src/pointage/service-pointage.spec.ts (refus 403 pour un technicien ciblant autrui, sans écriture).',
  },

  {
    // FAILLE CORRIGÉE (audit sécurité) : `forcer: true` sur `POST /articles/{id}/mouvements/casse`
    // et `.../perte` outrepasse le refus `409 STOCK_INSUFFISANT` (`RP-15`/`PP-02`) — jusqu'ici
    // gouverné par le SEUL `pieces.mouvement.creer`, sans droit dédié pour le forçage lui-même. La
    // route sert À LA FOIS la création NORMALE (tout appelant avec `pieces.mouvement.creer`,
    // aujourd'hui `magasinier` seul) ET le forçage (sous-cas conditionné par `entree.forcer ===
    // true`) : `@ExigerDroit` est statique par route, il ne peut pas distinguer les deux requêtes
    // AVANT exécution — un `@ExigerDroit('pieces.mouvement.forcer')` posé statiquement sur la
    // route interdirait AUSSI la création normale, non forcée, à `magasinier`. Même famille que
    // `atelier.or.plafond_modifier` ci-dessus.
    action: 'pieces.mouvement.forcer',
    categorie: 'verification-conditionnelle-service',
    justification:
      'Contrôle réel : ServiceMouvement.creerMouvementSortie() (apps/api/src/pieces/service-mouvement.ts), appelée ' +
      'par casse()/perte() — les deux seules actions du contrat qui exposent `forcer` (RP-15) — bloc `if (forcer) { ' +
      "const droitsDuRole = MATRICE_DROITS[role] ?? []; if (!droitsDuRole.includes('pieces.mouvement.forcer')) throw " +
      "new ErreurMetier('DROIT_INSUFFISANT', ...); }`, exécuté AVANT tout accès base (chargement article/site, " +
      'vérification de disponibilité) — jamais quand `forcer` est absent ou `false`, sinon la création normale de ' +
      "casse/perte (sans forçage) serait aussi bloquée par ce droit plus fort. Le rôle est lu depuis l'appelant " +
      '(paramètre `role`, jamais depuis le client). Couvert par des tests dans ' +
      'apps/api/src/pieces/service-mouvement.spec.ts : refus 403 sans écriture pour un rôle sans le droit qui tente ' +
      'forcer=true, et non-régression pour le même rôle sans forcer (ou magasinier avec forcer=true).',
  },

  {
    // FAILLE CORRIGÉE (issue #45), ÉTENDUE (issue #52) : `PATCH /parametres-atelier` écrivait
    // `reception.plafondAvoirReceptionnaireCentimes` (RF-117, montant au-delà duquel un
    // `receptionnaire` ne peut plus émettre un avoir seul) ET `reception.plafondDefautCentimes`
    // (même sémantique documentée, `db/schema/atelier/parametrage.ts`) sous le SEUL droit générique
    // `parametrage.atelier.modifier` — accordé à `admin` via `INFERE_PARAMETRAGE_GOUVERNANCE`, ce
    // qui violait `RF-115` (« admin est un rôle technique et n'a aucun droit financier ») pour les
    // DEUX champs (prouvé en exécution séparément pour chacun). La route sert À LA FOIS ces deux
    // plafonds financiers ET tous les réglages ordinaires du même endpoint (kilométrage
    // obligatoire, signature de réception, préfixe OR…) : `@ExigerDroit` est statique par route, il
    // ne peut pas distinguer les usages AVANT exécution — un droit fort posé statiquement
    // interdirait aussi à `chef_atelier` de modifier les réglages non financiers du même endpoint.
    // Même famille que `atelier.or.plafond_modifier` et `vehicule.kilometrage.corriger_regression`
    // ci-dessus.
    action: 'parametrage.atelier.plafond_avoir.modifier',
    categorie: 'verification-conditionnelle-service',
    justification:
      'Contrôle réel : ServiceParametresAtelier.modifier() (apps/api/src/parametrage/parametres-atelier/' +
      'service-parametres-atelier.ts), méthode privée verifierDroitPlafondsFinanciers() appelée AVANT ' +
      'tout UPDATE, qui vérifie CHACUN des deux champs via verifierDroitPlafondFinancier() — bloc ' +
      '`if (modifieLePlafond) { const droitsDuRole = MATRICE_DROITS[role] ?? []; if ' +
      "(!droitsDuRole.includes('parametrage.atelier.plafond_avoir.modifier')) throw new " +
      "ErreurMetier('DROIT_INSUFFISANT', ...); }`, exécuté UNIQUEMENT quand la valeur soumise " +
      '(reception.plafondAvoirReceptionnaireCentimes OU reception.plafondDefautCentimes) diffère de ' +
      'la valeur actuelle en base (resoumettre la même valeur ne déclenche pas la garde, pour aucun ' +
      'des deux champs) — jamais en permanence, sinon la modification des réglages ordinaires du ' +
      'même endpoint (droit parametrage.atelier.modifier, chef_atelier compris) serait aussi bloquée ' +
      'par ce droit plus fort. Le rôle est lu depuis le principal de session (jamais depuis le ' +
      'client). Couvert par des tests dans ' +
      'apps/api/src/parametrage/parametres-atelier/service-parametres-atelier.spec.ts : refus 403 sans ' +
      'écriture en base pour admin qui tente de FIXER chacun des deux plafonds, acceptation pour ' +
      'direction/comptable sur chacun, refus pour chef_atelier sur chacun, un réglage ordinaire ' +
      '(or.prefixe) reste modifiable par chef_atelier sans le droit fort, et resoumission de la même ' +
      'valeur ne déclenche pas la garde (pour les deux champs).',
  },

  // ---------------------------------------------------------------------------------------------
  // Actions inertes, créées par anticipation
  // ---------------------------------------------------------------------------------------------
  {
    // Les tables `rendez_vous*`/`*_courtoisie` ne sont pas créées au lot 1 (plan-lot1-execution.md
    // §7.2 L1-05 delta Δ4) : il n'existe aucun module RDV, donc aucune route à décorer. L'action
    // existe déjà pour que `DROIT_PAR_CONFIRMATION: Record<CodeConfirmation, Action>` (6 valeurs)
    // reste exhaustif SANS `Partial<...>` — voir le commentaire détaillé sur le type `Action` dans
    // `auth/matrice-droits.ts`. Elle est déjà, structurellement, une valeur de
    // `DROIT_PAR_CONFIRMATION` (couverte aussi par ce mécanisme automatique) ; listée ici EN PLUS
    // pour documenter explicitement son statut anticipé et forcer sa réévaluation au moment où le
    // module RDV sera implémenté (voir l'avertissement détaillé sur le type `Action`, qui précise
    // que le rôle assigné aujourd'hui n'est PAS une décision métier tranchée pour ce futur module).
    action: 'rendez_vous.confirmation.ressource_chevauchement',
    categorie: 'action-inerte-anticipee',
    justification:
      'Aucun module rendez_vous au lot 1 (aucune table, aucun contrôleur, plan-lot1-execution.md §7.2 delta Δ4) : ' +
      'action créée par anticipation pour garder DROIT_PAR_CONFIRMATION exhaustif sur les 6 valeurs de ' +
      'CodeConfirmation (auth/matrice-droits.ts, tête de fichier et commentaire sur le type Action). À réexaminer ' +
      'avec la spec du module RDV au moment de son implémentation, pas à supposer déjà tranchée.',
  },
  {
    // Même situation que `rendez_vous.confirmation.ressource_chevauchement` ci-dessus : aucun
    // module rendez_vous au lot 1.
    action: 'rendez_vous.confirmation.hors_ouverture',
    categorie: 'action-inerte-anticipee',
    justification:
      'Même situation que rendez_vous.confirmation.ressource_chevauchement ci-dessus : aucun module rendez_vous au ' +
      'lot 1 (plan-lot1-execution.md §7.2 delta Δ4), action créée par anticipation pour DROIT_PAR_CONFIRMATION ' +
      '(auth/matrice-droits.ts).',
  },
  {
    // Même famille que les deux entrées RDV ci-dessus : le module de prêt de véhicule (courtoisie)
    // n'existe pas non plus au lot 1 (mêmes tables absentes, même delta Δ4).
    action: 'pret_vehicule.confirmation.indisponible',
    categorie: 'action-inerte-anticipee',
    justification:
      'Aucun module pret_vehicule au lot 1 (tables *_courtoisie absentes, plan-lot1-execution.md §7.2 delta Δ4) : ' +
      'action créée par anticipation pour DROIT_PAR_CONFIRMATION (auth/matrice-droits.ts), au même titre que les 2 ' +
      'actions rendez_vous.confirmation.* ci-dessus.',
  },
  {
    // `POST /documents-vente/{id}/emettre` expose UN SEUL endpoint pour les QUATRE types de document
    // (`schemaEmissionDocumentVente` ne distingue pas), alors que RF-114 donne des lignes DIFFÉRENTES
    // pour « Émettre un devis / bon de commande » selon le rôle — `@ExigerDroit` est statique par
    // route, il ne peut pas choisir entre les trois droits d'émission selon le `typeDocument` réel,
    // connu seulement APRÈS chargement du document en base. `facturation.document.emettre` reste posé
    // sur la route (portillon générique, accordé à qui a au moins un des trois droits d'émission).
    action: 'facturation.document.emettre_devis_bc',
    categorie: 'verification-conditionnelle-service',
    justification:
      'Contrôle réel : ServiceEmissionDocument.verifierDroitEmission() (apps/api/src/facturation/documents/' +
      'service-emission.ts, ~lignes 237-251), appelée par emettre() juste après chargement du document et AVANT ' +
      'tout effet de bord (ligne 66, avant recalcul TVA/numérotation). Calcule `action` selon `typeDocument` réel ' +
      "('devis'/'bon_commande' → 'facturation.document.emettre_devis_bc', 'facture' → '..._facture', 'avoir' → " +
      "'..._avoir'), puis vérifie `MATRICE_DROITS[principal.role].includes(action)` et lève DROIT_INSUFFISANT sinon " +
      '— même patron que atelier.or.plafond_modifier (ServiceOr.modifier). Le rôle est lu depuis principal.role ' +
      "(jamais depuis le client). Pas de test dédié à ce jour (hors périmètre de l'agent auth/common-droits qui a " +
      'posé cette entrée — signalé, pas masqué : à couvrir par des tests d’intégration sur ServiceEmissionDocument).',
  },
  {
    // Même route, même mécanisme que `facturation.document.emettre_devis_bc` ci-dessus — voir sa
    // justification pour le détail du contrôle réel (même fonction, même appel, seule la valeur de
    // `typeDocument` change).
    action: 'facturation.document.emettre_facture',
    categorie: 'verification-conditionnelle-service',
    justification:
      'Même contrôle réel que facturation.document.emettre_devis_bc ci-dessus : ServiceEmissionDocument.' +
      'verifierDroitEmission() (apps/api/src/facturation/documents/service-emission.ts, ~lignes 237-251), branche ' +
      "`typeDocument === 'facture' → action = 'facturation.document.emettre_facture'`, vérifiée contre " +
      'MATRICE_DROITS[principal.role] avant tout effet de bord. « Émettre une facture » est ✅ pour receptionnaire, ' +
      '❌ pour chef_atelier (RF-114 littéral, casse la hiérarchie chef_atelier ⊇ receptionnaire) — précisément le ' +
      'cas que ce contrôle dynamique protège, un @ExigerDroit statique sur la route ne pourrait pas le distinguer.',
  },
  {
    // Même route, même mécanisme — voir `facturation.document.emettre_devis_bc` ci-dessus.
    action: 'facturation.document.emettre_avoir',
    categorie: 'verification-conditionnelle-service',
    justification:
      'Même contrôle réel que facturation.document.emettre_devis_bc ci-dessus : ServiceEmissionDocument.' +
      'verifierDroitEmission() (apps/api/src/facturation/documents/service-emission.ts, ~lignes 237-251), branche ' +
      "`typeDocument === 'avoir' → action = 'facturation.document.emettre_avoir'`, vérifiée contre " +
      'MATRICE_DROITS[principal.role] avant tout effet de bord. ⚠️ RF-117 (plafond de montant sur l’émission ' +
      "d'avoir par receptionnaire) NON IMPLÉMENTÉ ici : aucune colonne de paramétrage pour ce plafond n'existe, la " +
      'vérification reste binaire (a le droit / ne l’a pas), sans notion de montant — dégradé documenté, voir ' +
      'auth/matrice-droits.ts et auth/matrice-droits.spec.ts pour le détail.',
  },
  {
    // `vehicules.module.ts` (commentaire de tête, au-dessus du décorateur `@Module`) est explicite :
    // « ServiceVehiculeCampagne ... n'a, comme clients/, aucun contrôleur qui appelle LEURS
    // méthodes (CRUD) au lot 1 (aucune route POST/PATCH campagnes ... publiée) — déclaré ici quand
    // même pour que l'injection soit prête le jour où ces contrôleurs existeront ». La LECTURE des
    // campagnes ouvertes est déjà exposée en HTTP (`GET .../contexte-atelier`, gardée par
    // `vehicule.lire`, via les fonctions de requête partagées de `vehicule-requetes.ts`), mais
    // l'ÉCRITURE (créer/modifier une campagne) n'a aucune route : rien à décorer avec
    // `vehicule.campagne.gerer` aujourd'hui — le service existe, le provider est enregistré dans
    // `VehiculesModule`, aucun `@Controller` ne l'appelle.
    action: 'vehicule.campagne.gerer',
    categorie: 'action-inerte-anticipee',
    justification:
      'Aucune route HTTP pour ServiceVehiculeCampagne.creer()/modifier() au lot 1 — voir le commentaire de tête de ' +
      'apps/api/src/vehicules/vehicules.module.ts, juste au-dessus du décorateur @Module. Le service et le provider ' +
      "existent, prêts pour un futur contrôleur d'écriture ; la lecture (campagnes ouvertes) passe par GET " +
      '.../contexte-atelier sous le droit vehicule.lire, pas sous cette action.',
  },
  {
    // `apps/api/src/ventes/financement.controller.ts` (tête de fichier) est explicite : le
    // financement est une sous-ressource COLLECTION APPEND-ONLY d'un dossier de vente, et le
    // contrat GELÉ `packages/shared/src/contrats/ventes/financement.ts` (tête de fichier, §« Pas de
    // collection paginée par curseur ici ») NE PRÉVOIT AUCUN `GET` dédié — ni fiche par id, ni
    // liste — « aucune route à inventer au-delà de celles du contrat gelé ». `financement.
    // controller.ts` n'expose que trois routes (`POST` créer/confirmer/refuser), toutes les trois
    // décorées de leur propre `@ExigerDroit` (`ventes.financement.creer/.confirmer/.refuser`).
    // Ce n'est PAS un oubli d'implémentation : c'est une doctrine PERMANENTE, pas une anticipation
    // d'un futur contrôleur — un `GET /dossiers-vente/{id}/financements` n'est pas prévu et ne le
    // sera pas sans rouvrir le contrat gelé.
    //
    // OÙ LE CONTRÔLE VIT RÉELLEMENT : la SEULE lecture possible du financement passe par `GET
    // /dossiers-vente/{dossierVenteId}` (`DossierVenteController.parId`, `apps/api/src/ventes/
    // dossier-vente.controller.ts`), qui embarque `financement`/`financements` dans
    // `ReponseDossierVente` (`ServiceDossierVente.obtenirComplet`, `apps/api/src/ventes/
    // service-dossier-vente.ts`) — cette route est gardée par `ventes.dossier.lire`, PAS par
    // `ventes.financement.lire` : le service n'applique aucun filtre supplémentaire par rôle sur les
    // champs `financement`/`financements` une fois `ventes.dossier.lire` accordé. `ventes.financement.
    // lire` a donc été déclarée dans la matrice par symétrie mécanique avec `ventes.reprise.lire`
    // (qui, elle, protège une VRAIE route `GET .../reprise`, voir reprise.controller.ts) mais
    // n'exerce, et n'exercera, aucun contrôle propre : grep sur le dépôt confirme qu'elle n'apparaît
    // nulle part hors de auth/matrice-droits.ts et de son spec. Si une route de lecture dédiée du
    // financement voit un jour le jour (le contrat devrait d'abord être rouvert), câbler
    // `@ExigerDroit('ventes.financement.lire')` dessus et retirer cette entrée.
    action: 'ventes.financement.lire',
    categorie: 'action-inerte-anticipee',
    justification:
      "Aucune route HTTP n'expose ni n'exposera de lecture DÉDIÉE du financement : le contrat gelé " +
      'packages/shared/src/contrats/ventes/financement.ts (tête de fichier) exclut explicitement toute collection ' +
      "paginée/fiche dédiée — le financement s'embarque intégralement dans ReponseDossierVente, sous le droit " +
      "ventes.dossier.lire (DossierVenteController.parId → ServiceDossierVente.obtenirComplet), qui n'applique " +
      "aucun filtre supplémentaire propre à ventes.financement.lire. financement.controller.ts n'a que 3 routes " +
      "(créer/confirmer/refuser), toutes décorées de leur propre action — aucune n'est ventes.financement.lire. " +
      "Vérifié par recherche texte : cette action n'apparaît dans aucun fichier du dépôt hors auth/matrice-" +
      'droits.ts et son spec.',
  },
  // NOTE (mode borne PIN) : `atelier.pointage.identifier` et `atelier.pointage.gerer_pin` figuraient
  // ICI comme `action-inerte-anticipee` tant qu'aucune route ne les exerçait. Elles ont été RETIRÉES
  // en même temps que le module PIN a livré `PinController` (`apps/api/src/pointage/pin.controller.ts`),
  // qui pose `@ExigerDroit('atelier.pointage.identifier')` sur `POST /pointages/identification` et
  // `@ExigerDroit('atelier.pointage.gerer_pin')` sur `PUT /pointages/pins` + `POST /pointages/pins/revocation`.
  // Les deux actions sont donc désormais couvertes par le mécanisme automatique (scan d'un
  // `@ExigerDroit` réel dans le graphe de modules monté) ; les laisser ici masquerait un vrai contrôle
  // derrière une exception inutile — retrait correct.
];
