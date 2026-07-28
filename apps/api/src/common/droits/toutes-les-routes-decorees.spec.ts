/**
 * Test de non-régression sur le refus par défaut de `GardeDroit` (voir `garde-droit.ts`).
 *
 * Parcourt le graphe RÉEL des modules Nest depuis `AppModule` — pas une liste de contrôleurs
 * recopiée à la main, qui se périmerait au premier contrôleur du lot 1 oublié — et échoue si un
 * seul handler de route n'est couvert par AUCUN des trois marqueurs valides : `@Public()`,
 * `@ExigerDroit(...)`, `@AucunDroitRequis()`. C'est ce test qui protège les futurs contrôleurs du
 * lot 1 (54 actions, une douzaine de contrôleurs) contre l'oubli silencieux d'un décorateur —
 * qui, avant le durcissement de `GardeDroit`, ouvrait la route à tout rôle authentifié sans test
 * rouge ni avertissement de lint.
 *
 * PUREMENT STATIQUE : ne construit aucun conteneur Nest, n'instancie aucun provider, n'ouvre
 * aucune connexion Postgres/Redis. `AppModule.pourConfig(config)`/`Module.forRoot(...)` ne
 * renvoient que des DESCRIPTEURS de module (objets `{ module, imports, controllers, … }`) —
 * lire ces descripteurs et les décorateurs (`Reflect.getMetadata`) suffit à retrouver
 * exactement les routes que Nest monterait, sans les monter. C'est ce qui permet à ce fichier de
 * rester un test "unitaire" (`src/**\/*.spec.ts`, aucune dépendance Docker, cf. vitest.config.ts)
 * alors que la vérité qu'il vérifie porte sur l'application entière.
 */
import { describe, expect, it } from 'vitest';
import 'reflect-metadata';
import type { DynamicModule, ForwardReference, Type } from '@nestjs/common';
import { MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import { AppModule } from '../../app.module';
import { chargerConfig } from '../../config';
import { CLE_META_PUBLIC } from '../../auth/decorateurs/public.decorator';
import { CLE_META_ACTION, CLE_META_AUCUN_DROIT } from './garde-droit';

// -----------------------------------------------------------------------------------------------
// Config bidon : juste assez pour que `chargerConfig` valide (zod) et qu'`AppModule.pourConfig`
// produise son descripteur — aucune valeur n'est lue au-delà de ça, aucune connexion n'est jamais
// tentée (voir le commentaire d'en-tête).
// -----------------------------------------------------------------------------------------------
const CONFIG_MINIMALE = chargerConfig({
  API_URL_PUBLIQUE: 'http://localhost:3000',
  WEB_URL_PUBLIQUE: 'http://localhost:5173',
  DATABASE_URL: 'postgres://app-scan-statique/db',
  DATABASE_URL_MIGRATION: 'postgres://migrateur-scan-statique/db',
  REDIS_URL: 'redis://scan-statique',
});

// -----------------------------------------------------------------------------------------------
// Marche dans le graphe de modules Nest SANS instancier quoi que ce soit : un `Type` porte ses
// métadonnées `@Module({...})` via `Reflect`, un `DynamicModule` (retour de `X.pourConfig(...)`,
// `X.pourRacine(...)`, etc.) est déjà l'objet descripteur, pas besoin de décorateur pour le lire.
// -----------------------------------------------------------------------------------------------

/** Une classe de contrôleur ou de module — on ne s'intéresse jamais à ses paramètres de ctor. */
type ClasseModule = Type<unknown>;

/**
 * Toute entrée valide d'un tableau `imports`/`controllers` Nest — reprend exactement l'union
 * exposée par `DynamicModule['imports']` pour rester assignable sans conversion, y compris le cas
 * `Promise<DynamicModule>` (module asynchrone, ex. `.forRootAsync()`) que ce test ne sait pas
 * résoudre : rencontré, il fait échouer bruyamment plutôt que de silencieusement ignorer une
 * branche entière du graphe de routes.
 */
type EntreeImport = ClasseModule | DynamicModule | ForwardReference | Promise<DynamicModule> | undefined;

function estDescripteurDynamique(valeur: EntreeImport): valeur is DynamicModule {
  return typeof valeur === 'object' && valeur !== null && 'module' in valeur;
}

function estReferenceDifferee(valeur: EntreeImport): valeur is ForwardReference {
  return typeof valeur === 'object' && valeur !== null && typeof (valeur as ForwardReference).forwardRef === 'function';
}

function collecterControleurs(entree: EntreeImport, dejaVus: Set<ClasseModule>): ClasseModule[] {
  if (entree === undefined) return [];
  if (entree instanceof Promise) {
    throw new Error(
      'collecterControleurs() : module asynchrone (Promise<DynamicModule>) rencontré — ce scan statique ne ' +
        'sait pas le résoudre sans instancier Nest. Si un futur module utilise .forRootAsync(...), ce test ' +
        'doit être mis à jour plutôt que de laisser cette branche de routes invérifiée en silence.',
    );
  }
  if (estReferenceDifferee(entree)) return collecterControleurs(entree.forwardRef() as EntreeImport, dejaVus);

  const classeModule = (estDescripteurDynamique(entree) ? entree.module : entree) as ClasseModule;
  if (dejaVus.has(classeModule)) return []; // module déjà visité (ex. réimporté par plusieurs branches)
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

interface RouteHandler {
  readonly controleur: string;
  readonly methode: string;
  readonly cheminControleur: string;
  readonly cheminMethode: string;
  readonly estPublic: boolean;
  readonly action: unknown;
  readonly aucunDroitRequis: boolean;
}

/** Réplique `Reflector.getAllAndOverride` : la valeur posée sur le handler gagne, sinon celle de la classe. */
function metaEffective<T>(cle: string, handler: object, classe: ClasseModule): T | undefined {
  const surHandler = Reflect.getMetadata(cle, handler) as T | undefined;
  if (surHandler !== undefined) return surHandler;
  return Reflect.getMetadata(cle, classe) as T | undefined;
}

function listerRoutes(controleurs: readonly ClasseModule[]): RouteHandler[] {
  const routes: RouteHandler[] = [];
  for (const classe of controleurs) {
    const cheminControleur = (Reflect.getMetadata(PATH_METADATA, classe) as string | undefined) ?? '';
    const prototype = classe.prototype as Record<string, unknown>;
    for (const nomMethode of Object.getOwnPropertyNames(prototype)) {
      if (nomMethode === 'constructor') continue;
      const handler = prototype[nomMethode];
      if (typeof handler !== 'function') continue;
      const cheminMethode = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      if (cheminMethode === undefined) continue; // pas un handler de route HTTP (méthode privée, helper…)

      routes.push({
        controleur: classe.name,
        methode: nomMethode,
        cheminControleur,
        cheminMethode,
        estPublic: metaEffective<boolean>(CLE_META_PUBLIC, handler, classe) ?? false,
        action: metaEffective<unknown>(CLE_META_ACTION, handler, classe),
        aucunDroitRequis: metaEffective<boolean>(CLE_META_AUCUN_DROIT, handler, classe) ?? false,
      });
    }
  }
  return routes;
}

function nomRoute(route: RouteHandler): string {
  return `${route.controleur}.${route.methode}() [${route.cheminControleur}/${route.cheminMethode}]`;
}

const TOUTES_LES_ROUTES = listerRoutes(collecterControleurs(AppModule.pourConfig(CONFIG_MINIMALE), new Set()));

describe('GardeDroit — refus par défaut : toutes les routes réellement montées sont décorées', () => {
  it('a trouvé au moins une route à vérifier (garde-fou : ce test ne doit jamais tourner à vide)', () => {
    // Si ce nombre tombe à 0, la marche dans le graphe de modules s'est cassée (renommage d'un
    // fichier module, changement de forme d'un DynamicModule…) : le test ci-dessous passerait
    // alors trivialement sans avoir rien vérifié — pire qu'un test rouge, un test vert qui ment.
    expect(TOUTES_LES_ROUTES.length).toBeGreaterThan(0);
  });

  it('ne laisse aucune route sans @Public, @ExigerDroit ni @AucunDroitRequis', () => {
    const routesNonDecorees = TOUTES_LES_ROUTES.filter(
      (route) => !route.estPublic && route.action === undefined && !route.aucunDroitRequis,
    );

    if (routesNonDecorees.length > 0) {
      const liste = routesNonDecorees.map(nomRoute).join('\n  - ');
      throw new Error(
        `${routesNonDecorees.length} route(s) sans décorateur d'autorisation — ni @Public(), ni ` +
          `@ExigerDroit(...), ni @AucunDroitRequis(). Avec GardeDroit en refus par défaut, ces routes ` +
          `renvoient 403 pour tout appelant : ce n'est pas une faille silencieuse, mais il faut trancher ` +
          `explicitement leur droit :\n  - ${liste}`,
      );
    }
  });

  it("ne laisse aucune route porter à la fois @Public et un marqueur de droit (@ExigerDroit ou @AucunDroitRequis) — signe d'une intention contradictoire", () => {
    const routesAmbigues = TOUTES_LES_ROUTES.filter(
      (route) => route.estPublic && (route.action !== undefined || route.aucunDroitRequis),
    );

    if (routesAmbigues.length > 0) {
      const liste = routesAmbigues.map(nomRoute).join('\n  - ');
      throw new Error(
        `${routesAmbigues.length} route(s) @Public() portant EN PLUS @ExigerDroit/@AucunDroitRequis — ` +
          `@Public() fait déjà court-circuiter GardeSession (aucun principal résolu), donc GardeDroit ne ` +
          `peut de toute façon pas évaluer un droit dessus : décorateur mort, à retirer :\n  - ${liste}`,
      );
    }
  });
});
