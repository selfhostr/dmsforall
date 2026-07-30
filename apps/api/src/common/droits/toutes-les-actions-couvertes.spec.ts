/**
 * Test structurel anti-régression : chaque `Action` de l'union déclarée dans
 * `apps/api/src/auth/matrice-droits.ts` DOIT être couverte par au moins un mécanisme de contrôle
 * réel — sinon un rôle peut détenir un droit sur le papier sans que rien, nulle part, ne le
 * vérifie à l'exécution.
 *
 * ORIGINE : un audit a trouvé `vehicule.kilometrage.corriger_regression` dans la matrice,
 * réservée au chef d'atelier / à la direction, mais posée sur AUCUNE route — n'importe quel
 * technicien pouvait donc faire reculer un compteur kilométrique. `toutes-les-routes-decorees.spec.ts`
 * (sibling, à lire avant ce fichier) prouve que toute route MONTÉE porte un marqueur
 * d'autorisation (`@Public`, `@ExigerDroit` ou `@AucunDroitRequis`) — mais il ne dit RIEN sur les
 * actions qui n'apparaissent tout simplement JAMAIS dans `@ExigerDroit(...)`, qui est précisément
 * la forme qu'a prise la faille : la route existait, portait un `@ExigerDroit`, mais pour une
 * action DIFFÉRENTE et plus faible (`vehicule.kilometrage.saisir`), pas pour
 * `corriger_regression`. Ce fichier comble ce trou-là : il part de la matrice (toutes les actions
 * qui DEVRAIENT être gouvernées), pas des routes (ce qui EST décoré), et exige une preuve de
 * contrôle pour chacune.
 *
 * QUATRE MÉCANISMES DE COUVERTURE VALIDES, un seul suffit par action :
 *  1. `@ExigerDroit(action)` posé sur une route du graphe de modules RÉELLEMENT monté (même
 *     technique que le sibling : lecture de `Reflect.getMetadata` sur les descripteurs de module,
 *     sans instancier Nest — voir le commentaire d'en-tête de `toutes-les-routes-decorees.spec.ts`
 *     pour le détail de la technique, reprise ici à l'identique).
 *  2. Une valeur de `DROIT_PAR_CONFIRMATION` (`apps/api/src/atelier/confirmations.ts`) : ce
 *     Record mappe CHAQUE `CodeConfirmation` vers une `Action`, et `verifierConfirmation()`
 *     applique `MATRICE_DROITS[role].includes(droitRequis)` pour CE code, quel que soit le
 *     `CodeConfirmation` — c'est un contrôle réel et générique, pas un décorateur statique.
 *  3. Une entrée `verification-conditionnelle-service` dans l'allowlist (voir
 *     `allowlist-actions-non-decorees.ts`) : un contrôle réel existe, en service, sur une branche
 *     conditionnelle qu'un scan statique de décorateurs ne peut pas voir.
 *  4. Une entrée `action-inerte-anticipee` dans la même allowlist : aucune route n'exerce
 *     l'action aujourd'hui (module futur, ou écriture pas encore publiée), il n'y a donc rien à
 *     décorer — mais c'est déclaré, pas simplement absent.
 *
 * Les mécanismes 3 et 4 ne peuvent PAS être déduits par un scan : ils vivent dans une allowlist
 * EXPLICITE, elle-même vérifiée ci-dessous (justification obligatoire, pas de doublon, pas
 * d'action fantôme — voir la 2e section de tests).
 *
 * DUPLICATION VOLONTAIRE de la marche dans le graphe de modules (fonction `collecterControleurs`
 * ci-dessous) plutôt qu'un import depuis `toutes-les-routes-decorees.spec.ts` : Vitest exécute le
 * code de top-niveau de tout module importé pour enregistrer ses `describe`/`it` — importer un
 * `.spec.ts` depuis un autre `.spec.ts` ferait tourner deux fois la suite du fichier importé (une
 * fois sous son propre nom de fichier, une fois réenregistrée sous celui de l'importeur). La
 * technique (lire les descripteurs de module Nest via `Reflect`, sans instancier) est identique ;
 * seule la sortie collectée diffère (ici : les valeurs `Action` de `@ExigerDroit`, pas la liste
 * complète des routes avec leur statut public/protégé).
 */
import { describe, expect, it } from 'vitest';
import 'reflect-metadata';
import type { DynamicModule, ForwardReference, Type } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';

import { AppModule } from '../../app.module';
import { chargerConfig } from '../../config';
import { CLE_META_ACTION } from './garde-droit';
import { DROIT_PAR_CONFIRMATION, TOUTES_ACTIONS, type Action } from '../../auth/matrice-droits';
import { ALLOWLIST_ACTIONS_SANS_DECORATEUR, type EntreeAllowlistAction } from './allowlist-actions-non-decorees';

// -----------------------------------------------------------------------------------------------
// Config bidon, identique en substance à celle du sibling : juste assez pour que `chargerConfig`
// valide (zod) et qu'`AppModule.pourConfig` produise son descripteur. Aucune connexion réelle
// n'est jamais tentée (voir le commentaire d'en-tête de `toutes-les-routes-decorees.spec.ts`).
// -----------------------------------------------------------------------------------------------
const CONFIG_MINIMALE = chargerConfig({
  API_URL_PUBLIQUE: 'http://localhost:3000',
  WEB_URL_PUBLIQUE: 'http://localhost:5173',
  DATABASE_URL: 'postgres://app-scan-statique/db',
  DATABASE_URL_MIGRATION: 'postgres://migrateur-scan-statique/db',
  REDIS_URL: 'redis://scan-statique',
});

/** Une classe de contrôleur ou de module — on ne s'intéresse jamais à ses paramètres de ctor. */
type ClasseModule = Type<unknown>;

type EntreeImport = ClasseModule | DynamicModule | ForwardReference | Promise<DynamicModule> | undefined;

function estDescripteurDynamique(valeur: EntreeImport): valeur is DynamicModule {
  return typeof valeur === 'object' && valeur !== null && 'module' in valeur;
}

function estReferenceDifferee(valeur: EntreeImport): valeur is ForwardReference {
  return typeof valeur === 'object' && valeur !== null && typeof (valeur as ForwardReference).forwardRef === 'function';
}

/** Reprend à l'identique la marche dans le graphe du sibling — voir le commentaire d'en-tête. */
function collecterControleurs(entree: EntreeImport, dejaVus: Set<ClasseModule>): ClasseModule[] {
  if (entree === undefined) return [];
  if (entree instanceof Promise) {
    throw new Error(
      'collecterControleurs() : module asynchrone (Promise<DynamicModule>) rencontré — ce scan statique ne sait ' +
        'pas le résoudre sans instancier Nest, exactement comme dans toutes-les-routes-decorees.spec.ts. Si un ' +
        'futur module utilise .forRootAsync(...), ce test doit être mis à jour plutôt que de laisser cette branche ' +
        'de routes invérifiée en silence.',
    );
  }
  if (estReferenceDifferee(entree)) return collecterControleurs(entree.forwardRef() as EntreeImport, dejaVus);

  const classeModule = (estDescripteurDynamique(entree) ? entree.module : entree) as ClasseModule;
  if (dejaVus.has(classeModule)) return [];
  dejaVus.add(classeModule);

  const controleursDynamiques: readonly ClasseModule[] = estDescripteurDynamique(entree)
    ? ((entree.controllers ?? []) as ClasseModule[])
    : [];
  const importsDynamiques: readonly EntreeImport[] = estDescripteurDynamique(entree) ? (entree.imports ?? []) : [];

  const controleursDecores: readonly ClasseModule[] =
    (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, classeModule) as ClasseModule[] | undefined) ?? [];
  const importsDecores: readonly EntreeImport[] =
    (Reflect.getMetadata(MODULE_METADATA.IMPORTS, classeModule) as EntreeImport[] | undefined) ?? [];

  const controleurs = [...controleursDynamiques, ...controleursDecores];
  for (const sousImport of [...importsDynamiques, ...importsDecores]) {
    controleurs.push(...collecterControleurs(sousImport, dejaVus));
  }
  return controleurs;
}

/**
 * Contrairement au sibling (qui liste des ROUTES avec leur statut complet), on ne veut ici que
 * l'ensemble des `Action` qui apparaissent AU MOINS UNE FOIS comme argument de `@ExigerDroit(...)`
 * dans le graphe monté — au niveau classe (rare, mais `ExigerDroit` est typé
 * `MethodDecorator & ClassDecorator`) ou au niveau d'un handler de route réel (identifié comme le
 * sibling par la présence de métadonnées de chemin HTTP posées par les décorateurs `@Get`/`@Post`/
 * etc. — ici on se contente de vérifier que c'est une fonction du prototype, la présence d'un
 * `@ExigerDroit` handler-level sur un membre qui ne serait pas un handler de route est de toute
 * façon un décorateur mort sans effet, jamais une fausse preuve de couverture).
 */
function collecterActionsExigees(controleurs: readonly ClasseModule[]): ReadonlySet<Action> {
  const actions = new Set<Action>();
  for (const classe of controleurs) {
    const actionClasse = Reflect.getMetadata(CLE_META_ACTION, classe) as Action | undefined;
    if (actionClasse !== undefined) actions.add(actionClasse);

    const prototype = classe.prototype as Record<string, unknown>;
    for (const nomMethode of Object.getOwnPropertyNames(prototype)) {
      if (nomMethode === 'constructor') continue;
      const handler = prototype[nomMethode];
      if (typeof handler !== 'function') continue;
      const actionHandler = Reflect.getMetadata(CLE_META_ACTION, handler) as Action | undefined;
      if (actionHandler !== undefined) actions.add(actionHandler);
    }
  }
  return actions;
}

const CONTROLEURS = collecterControleurs(AppModule.pourConfig(CONFIG_MINIMALE), new Set());
const ACTIONS_EXIGEES_PAR_DECORATEUR = collecterActionsExigees(CONTROLEURS);
const ACTIONS_PAR_CONFIRMATION = new Set<Action>(Object.values(DROIT_PAR_CONFIRMATION));
const ACTIONS_ALLOWLIST = new Set<Action>(ALLOWLIST_ACTIONS_SANS_DECORATEUR.map((e) => e.action));

/**
 * Énumération exhaustive de l'union `Action` — dérivée DIRECTEMENT de `TOUTES_ACTIONS`
 * (`auth/matrice-droits.ts`), la même constante qui définit désormais le type `Action` lui-même
 * (`export type Action = (typeof TOUTES_ACTIONS)[number]`, voir son commentaire de tête).
 *
 * AVANT ce refactor, cette énumération était un `Record<Action, true>` recopié À LA MAIN dans CE
 * fichier, distinct de la déclaration du type dans `matrice-droits.ts`. La garantie de synchronisation
 * n'existait qu'à la COMPILATION (`pnpm typecheck` rougissait si les deux divergeaient, excès ou
 * défaut de propriété sur un littéral assigné à un type annoté) — invisible sous `vitest run` seul :
 * la chaîne de transpilation de test (SWC, voir `vitest.config.ts`) efface les types avant
 * exécution, donc une divergence PUREMENT TYPÉE ne pouvait jamais faire rougir ce test. C'est
 * exactement ce qui s'est produit : 14 actions de facturation ajoutées au type `Action` sont restées
 * invisibles à ce test structurel — qui prétend pourtant garantir qu'aucune action n'échappe au
 * contrôle — pendant tout un cycle d'agents, découvertes seulement par un `tsc --noEmit` isolé, pas
 * par cette suite. En import ant `TOUTES_ACTIONS` au lieu de le recopier, il n'existe plus deux
 * listes à synchroniser : il y en a une seule, et TOUT ajout/retrait/renommage dans
 * `matrice-droits.ts` est désormais visible ICI, À L'EXÉCUTION, sous `vitest run` seul — sans
 * dépendre de `pnpm typecheck`. Le filet de compilation (assignation à `Record<Action, true>`)
 * disparaît avec lui : il n'a plus de raison d'être, la divergence qu'il détectait est devenue
 * structurellement impossible.
 */
const UNIVERS_ACTIONS: readonly Action[] = TOUTES_ACTIONS;

function estCouverte(action: Action): boolean {
  return ACTIONS_EXIGEES_PAR_DECORATEUR.has(action) || ACTIONS_PAR_CONFIRMATION.has(action) || ACTIONS_ALLOWLIST.has(action);
}

describe('Couverture des actions — chaque Action de la matrice a une preuve de contrôle réelle', () => {
  it('a trouvé au moins un contrôleur et au moins une action décorée (garde-fou : ne doit jamais tourner à vide)', () => {
    // Si ces nombres tombent à 0, la marche dans le graphe de modules s'est cassée (renommage
    // d'un fichier module, changement de forme d'un DynamicModule…) : le test principal
    // passerait alors trivialement sans avoir rien vérifié — pire qu'un test rouge, un test vert
    // qui ment. Comparer au sibling : `toutes-les-routes-decorees.spec.ts` a le même garde-fou.
    expect(CONTROLEURS.length).toBeGreaterThan(0);
    expect(ACTIONS_EXIGEES_PAR_DECORATEUR.size).toBeGreaterThan(0);
  });

  it("chaque action de l'union Action est couverte par @ExigerDroit, DROIT_PAR_CONFIRMATION, ou une entrée justifiée de l'allowlist", () => {
    const nonCouvertes = UNIVERS_ACTIONS.filter((action) => !estCouverte(action));

    if (nonCouvertes.length > 0) {
      const liste = nonCouvertes.map((a) => `'${a}'`).join('\n  - ');
      throw new Error(
        `${nonCouvertes.length} action(s) de MATRICE_DROITS sans AUCUNE preuve de contrôle : ni @ExigerDroit sur ` +
          `une route réellement montée, ni valeur de DROIT_PAR_CONFIRMATION, ni entrée dans l'allowlist ` +
          `(common/droits/allowlist-actions-non-decorees.ts).\n\n` +
          `Pour CHAQUE action listée ci-dessous, deux choix — pas de troisième :\n` +
          `  1. CÂBLEZ-LA : posez @ExigerDroit('<action>') sur la route qui l'exerce (cas le plus courant) — ou, ` +
          `si le droit ne peut être tranché qu'après avoir chargé une donnée métier (une seule branche d'un ` +
          `traitement partagé avec un cas non protégé), vérifiez-la explicitement en service, comme ` +
          `ServiceVehiculeKilometrage.creer() le fait pour vehicule.kilometrage.corriger_regression ` +
          `(apps/api/src/vehicules/service-vehicule-kilometrage.ts).\n` +
          `  2. JUSTIFIEZ SON ABSENCE : si elle n'a vraiment aucun contrôle possible aujourd'hui (aucune route ne ` +
          `l'exerce, module ou endpoint pas encore implémenté), ajoutez une entrée dans allowlist-actions-non-` +
          `decorees.ts, avec un commentaire ET un champ justification expliquant pourquoi et où le contrôle vivra ` +
          `réellement — jamais une entrée sans cette explication.\n\n` +
          `Rappel de ce que ce test empêche de reproduire : vehicule.kilometrage.corriger_regression figurait dans ` +
          `la matrice, réservée au chef d'atelier, sans être vérifiée nulle part — n'importe quel technicien ` +
          `pouvait faire reculer un compteur kilométrique. Un droit dans la matrice sans contrôle réel n'est pas ` +
          `un droit, c'est une case cochée qui ment.\n\n` +
          `Action(s) concernée(s) :\n  - ${liste}`,
      );
    }
  });
});

describe("allowlist-actions-non-decorees.ts — hygiène de la liste (elle ne doit jamais devenir un cimetière)", () => {
  it('ne contient aucune action en double', () => {
    const vues = new Set<Action>();
    const doublons: Action[] = [];
    for (const entree of ALLOWLIST_ACTIONS_SANS_DECORATEUR) {
      if (vues.has(entree.action)) doublons.push(entree.action);
      vues.add(entree.action);
    }
    expect(
      doublons,
      `Action(s) présente(s) plusieurs fois dans l'allowlist : ${doublons.join(', ')}. Une seule entrée par action.`,
    ).toEqual([]);
  });

  it("chaque entrée référence une action qui existe RÉELLEMENT dans l'union Action (aucune entrée fantôme, aucune action renommée/supprimée laissée derrière)", () => {
    const fantomes = ALLOWLIST_ACTIONS_SANS_DECORATEUR.filter((entree) => !UNIVERS_ACTIONS.includes(entree.action));
    if (fantomes.length > 0) {
      const liste = fantomes.map((e) => `'${e.action}'`).join('\n  - ');
      throw new Error(
        `${fantomes.length} entrée(s) de l'allowlist référencent une action ABSENTE de l'union Action actuelle — ` +
          `renommée ou supprimée dans auth/matrice-droits.ts sans que l'allowlist ait été mise à jour. Une entrée ` +
          `qui ne correspond plus à rien ne protège plus rien : retirez-la (ou corrigez le nom d'action) plutôt que ` +
          `de la laisser autoriser silencieusement un trou.\n\nAction(s) fantôme(s) :\n  - ${liste}`,
      );
    }
  });

  it('chaque entrée porte une justification non vide et substantielle (pas juste un mot de complaisance)', () => {
    const SEUIL_MIN_CARACTERES = 40;
    const insuffisantes = ALLOWLIST_ACTIONS_SANS_DECORATEUR.filter(
      (entree) => entree.justification.trim().length < SEUIL_MIN_CARACTERES,
    );
    if (insuffisantes.length > 0) {
      const liste = insuffisantes.map((e) => `'${e.action}'`).join('\n  - ');
      throw new Error(
        `${insuffisantes.length} entrée(s) de l'allowlist ont une justification vide ou trop courte pour être ` +
          `informative (< ${SEUIL_MIN_CARACTERES} caractères). La justification doit dire QUOI (le mécanisme réel ` +
          `de contrôle, ou son absence assumée) et OÙ (fichier + fonction/branche, ou raison de l'absence de ` +
          `route) — voir les entrées existantes pour le niveau de détail attendu.\n\nAction(s) concernée(s) :\n  - ${liste}`,
      );
    }
  });

  it('chaque entrée a une catégorie parmi les deux valeurs autorisées', () => {
    const categoriesValides = new Set(['verification-conditionnelle-service', 'action-inerte-anticipee']);
    for (const entree of ALLOWLIST_ACTIONS_SANS_DECORATEUR as readonly EntreeAllowlistAction[]) {
      expect(categoriesValides.has(entree.categorie), `Catégorie invalide pour '${entree.action}' : '${entree.categorie}'`).toBe(
        true,
      );
    }
  });

  it("une entrée 'action-inerte-anticipee' qui apparaîtrait maintenant sous un @ExigerDroit réel est devenue périmée (le module a été câblé : retirez l'entrée, elle a rempli son rôle)", () => {
    const perimees = ALLOWLIST_ACTIONS_SANS_DECORATEUR.filter(
      (entree) => entree.categorie === 'action-inerte-anticipee' && ACTIONS_EXIGEES_PAR_DECORATEUR.has(entree.action),
    );
    if (perimees.length > 0) {
      const liste = perimees.map((e) => `'${e.action}'`).join('\n  - ');
      throw new Error(
        `${perimees.length} entrée(s) 'action-inerte-anticipee' portent maintenant un @ExigerDroit réel sur une ` +
          `route montée : le module anticipé a été implémenté. Retirez ces entrées de l'allowlist — la couverture ` +
          `vient désormais du décorateur réel, l'entrée manuelle est devenue un doublon qui masquerait un futur ` +
          `oubli si le décorateur était un jour retiré par erreur.\n\nAction(s) concernée(s) :\n  - ${liste}`,
      );
    }
  });
});
