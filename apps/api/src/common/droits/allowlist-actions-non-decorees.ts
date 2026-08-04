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
  {
    // Mode « borne partagée » du pointage (docs/specification-pointage-borne.md) : expert-auth a
    // livré l'INFRASTRUCTURE d'identité (rôle `poste_atelier`, rattachement `utilisateur.site_id`,
    // résolution du site depuis la session) SANS le code PIN lui-même — table `pin_pointage`,
    // `POST /pointages/identification` et verrouillage anti-balayage appartiennent à l'agent
    // suivant, qui construira dessus. Les deux actions existent DÈS MAINTENANT dans la matrice
    // pour que cet agent s'appuie sur des noms figés et un périmètre de rôles déjà arbitré, au
    // lieu d'en inventer et de faire diverger la matrice de sa spec. Aucune route ne les exerce
    // aujourd'hui : il n'y a rien à décorer, et le déclarer ici vaut mieux que de le laisser
    // deviner.
    //
    // À RETIRER par l'agent PIN au moment où il pose `@ExigerDroit('atelier.pointage.identifier')`
    // sur `POST /pointages/identification` et `@ExigerDroit('atelier.pointage.gerer_pin')` sur les
    // routes d'attribution/réinitialisation.
    action: 'atelier.pointage.identifier',
    categorie: 'action-inerte-anticipee',
    justification:
      "Aucun endpoint POST /pointages/identification n'existe encore : expert-auth a livré l'identité de la borne " +
      '(rôle poste_atelier, utilisateur.site_id, PrincipalAuthentifie.siteId, migration 0039) mais PAS le code PIN, ' +
      "explicitement hors de son périmètre. L'action est posée en amont pour que l'agent qui construira " +
      'pin_pointage reprenne un nom et un périmètre de rôles déjà arbitrés (poste_atelier SEUL) plutôt que de les ' +
      'réinventer. À retirer de cette allowlist en même temps que la route sera décorée.',
  },
  {
    // Même livraison, même raison que `atelier.pointage.identifier` ci-dessus : le droit de gestion
    // des PIN (RM-128, chef_atelier/direction/admin) est arbitré maintenant, ses routes viendront
    // avec le module PIN.
    action: 'atelier.pointage.gerer_pin',
    categorie: 'action-inerte-anticipee',
    justification:
      "Aucune route d'attribution/réinitialisation de PIN n'existe encore (table pin_pointage non créée, hors " +
      "périmètre d'expert-auth). Droit arbitré en amont — RM-128 : chef_atelier/direction/admin, délibérément plus " +
      'permissif que parametrage.atelier.modifier qui gouverne le MODE du site — pour que la matrice ne diverge ' +
      "jamais de la spec pendant l'intervalle. À retirer quand les routes seront décorées.",
  },
];
