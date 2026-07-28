import { applyDecorators } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import type { ZodType } from 'zod';
import { schemaZodVersOpenApi } from './schema-zod-vers-openapi';

export interface OptionsApiCorpsZod {
  readonly description?: string;
  /** Exemple réaliste (un OR, une ligne de main d'œuvre…) affiché tel quel dans Swagger UI. */
  readonly exemple?: unknown;
}

/**
 * Déclare le `requestBody` Swagger d'un endpoint d'écriture À PARTIR DU MÊME schéma zod que
 * celui donné à `new PipeZod(schema)` — jamais une redescription à la main.
 *
 * Contexte du défaut corrigé : avant ce mécanisme, `@Body(new PipeZod(schemaX))` validait bien
 * la requête à l'exécution (zod fait foi), mais Swagger n'avait AUCUN moyen de déduire la forme
 * du corps depuis un type inféré (`z.infer<typeof schemaX>` n'est qu'un alias TypeScript, effacé
 * à la compilation) faute de `@ApiBody()` explicite. Résultat vérifié sur `dfa-openapi.json` :
 * tout `requestBody` d'endpoint d'écriture était absent du document — le front (et tout
 * connecteur tiers lisant l'OpenAPI) ne savait pas ce qu'il devait envoyer.
 *
 * Poser ce décorateur seul (sans passer par `@CorpsZod`, voir `corps-zod.decorator.ts`) reste
 * possible pour un endpoint où le corps est validé autrement (rare) — mais pour le cas normal
 * `@Body(new PipeZod(schema))`, préférer `@CorpsZod(schema)` : un seul décorateur qui VALIDE et
 * DOCUMENTE, pour qu'il soit structurellement impossible d'ajouter l'un sans l'autre.
 */
export const ApiCorpsZod = (schema: ZodType, options: OptionsApiCorpsZod = {}): MethodDecorator =>
  applyDecorators(
    ApiBody({
      description: options.description,
      schema: schemaZodVersOpenApi(schema),
      ...(options.exemple !== undefined ? { examples: { defaut: { value: options.exemple } } } : {}),
    }),
  );
