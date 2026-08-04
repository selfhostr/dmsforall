import { Body } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import type { ZodType } from 'zod';
import { PipeZod } from '../validation';
import { schemaZodVersOpenApi } from './schema-zod-vers-openapi';
import type { OptionsApiCorpsZod } from './api-corps-zod.decorator';

/**
 * Remplacement direct de `@Body(new PipeZod(schema))` : MÊME validation zod à l'exécution,
 * PLUS le `requestBody` Swagger posé automatiquement sur la méthode porteuse. Un seul geste
 * pour les deux — c'est le point de la conception (voir l'en-tête d'`api-corps-zod.decorator.ts`
 * pour le défaut que ce couplage referme).
 *
 * Pourquoi un décorateur de PARAMÈTRE peut aussi poser une métadonnée de MÉTHODE : à l'endroit
 * où TypeScript invoque un décorateur de paramètre, le descripteur de la méthode qui le porte
 * existe déjà sur le prototype (la classe est entièrement construite avant que le moindre
 * décorateur ne s'exécute — seul l'ORDRE d'exécution entre décorateurs varie). `ApiBody(...)`
 * est lui-même une factory qui rend une fonction `(target, clé, descripteur)` ; rien n'oblige à
 * ne l'invoquer que depuis la position syntaxique `@ApiBody(...)` au-dessus d'une méthode — on
 * l'appelle ici directement avec le descripteur retrouvé via `Object.getOwnPropertyDescriptor`.
 * Si `@nestjs/swagger` change un jour cette forme interne, `pnpm api:openapi` cesse de produire
 * un `requestBody` pour toute route utilisant `@CorpsZod` — un échec visible en revue, jamais un
 * défaut silencieux.
 *
 * `schema` reste la SEULE source de vérité (validation ET documentation) : aucune classe DTO de
 * requête à entretenir en parallèle.
 */
export function CorpsZod<T>(
  schema: ZodType<T>,
  options: OptionsApiCorpsZod = {},
): ParameterDecorator {
  const appliquerBody = Body(new PipeZod(schema));
  const appliquerApiBody = ApiBody({
    description: options.description,
    schema: schemaZodVersOpenApi(schema),
    ...(options.exemple !== undefined ? { examples: { defaut: { value: options.exemple } } } : {}),
  });

  return (target: object, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    appliquerBody(target, propertyKey, parameterIndex);

    if (propertyKey === undefined) return;
    const descripteur = Object.getOwnPropertyDescriptor(target, propertyKey);
    if (!descripteur) return;
    appliquerApiBody(target, propertyKey, descripteur);
  };
}
