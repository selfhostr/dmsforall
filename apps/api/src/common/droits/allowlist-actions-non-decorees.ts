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
 *     (Un exemple réel de ce qu'il NE FAUT PAS faire : `atelier.or.plafond_modifier` existe dans
 *     la matrice, la route qui modifie le plafond existe et répond, mais elle est gardée par
 *     `atelier.or.modifier` — plus large — au lieu de sa propre action. Ce n'est ni une vérification
 *     conditionnelle en service (rien ne vérifie `plafond_modifier` nulle part) ni une action
 *     inerte (la route existe et fonctionne) : ça n'a donc pas sa place ici, et le test sibling la
 *     signale à raison comme non couverte, tant qu'elle n'est pas câblée par son propre
 *     `@ExigerDroit` ou par un contrôle conditionnel réel en service.)
 */

export type CategorieAllowlistAction = 'verification-conditionnelle-service' | 'action-inerte-anticipee';

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
      "Contrôle réel : ServiceVehiculeKilometrage.creer() (apps/api/src/vehicules/service-vehicule-kilometrage.ts), " +
      "bloc `if (decision.regressif) { const droitsDuRole = MATRICE_DROITS[role] ?? []; if " +
      "(!droitsDuRole.includes('vehicule.kilometrage.corriger_regression')) throw ... }`, exécuté UNIQUEMENT quand le " +
      'relevé nouvellement soumis est inférieur au dernier relevé connu — jamais en permanence, sinon la saisie ' +
      'normale du technicien (droit vehicule.kilometrage.saisir) serait aussi bloquée par ce droit plus fort.',
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
      "Aucune route HTTP pour ServiceVehiculeCampagne.creer()/modifier() au lot 1 — voir le commentaire de tête de " +
      "apps/api/src/vehicules/vehicules.module.ts, juste au-dessus du décorateur @Module. Le service et le provider " +
      "existent, prêts pour un futur contrôleur d'écriture ; la lecture (campagnes ouvertes) passe par GET " +
      '.../contexte-atelier sous le droit vehicule.lire, pas sous cette action.',
  },
  {
    // Même commentaire source que `vehicule.campagne.gerer` ci-dessus (même paragraphe de tête de
    // `vehicules.module.ts`) : `ServiceVehiculeTravailReporte` est enregistré comme provider, sans
    // aucun `@Controller` qui appelle ses méthodes d'écriture. La lecture des travaux reportés
    // passe par la même route `GET .../contexte-atelier` que les campagnes.
    action: 'vehicule.travail_reporte.gerer',
    categorie: 'action-inerte-anticipee',
    justification:
      'Aucune route HTTP pour ServiceVehiculeTravailReporte au lot 1 — voir le commentaire de tête de ' +
      'apps/api/src/vehicules/vehicules.module.ts (même paragraphe que vehicule.campagne.gerer, juste au-dessus du ' +
      "décorateur @Module). La lecture des travaux reportés passe par GET .../contexte-atelier sous vehicule.lire ; " +
      "l'écriture n'a pas encore de route.",
  },
];
