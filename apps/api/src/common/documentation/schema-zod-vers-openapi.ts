import type { ApiBodyOptions } from '@nestjs/swagger';
import { z, type ZodType } from 'zod';

/**
 * `SchemaObject` n'est pas réexporté par `@nestjs/swagger` (seul `ApiBodyOptions`, union
 * publique, l'est) — on extrait le type attendu par `ApiBody({ schema })` sans dépendre d'un
 * chemin d'import profond dans le package, qui casserait au premier changement de version.
 */
export type SchemaObjectOpenApi = Extract<ApiBodyOptions, { schema: unknown }>['schema'];

/**
 * Convertit un schéma zod — le même objet passé à `new PipeZod(schema)` côté runtime — en
 * schéma OpenAPI (JSON Schema, dialecte `2020-12` : le document est publié en OpenAPI 3.1,
 * voir `openapi/construire-document.ts`).
 *
 * Décisions figées :
 * - `io: 'input'` : on documente ce que le CLIENT doit envoyer, pas ce que zod restitue après
 *   application des `.default(...)`. Un champ `payeur: z.enum(...).default('client')` doit
 *   apparaître optionnel dans `requestBody`, jamais requis — c'est l'inverse qui trompe un
 *   connecteur tiers.
 * - `reused: 'inline'` : aucun `$defs`/`$ref` dans le fragment produit. Un `requestBody` reste
 *   un schéma autonome, lisible sans devoir résoudre de référence croisée dans le document.
 * - Pas de garde-fou `unrepresentable` : un schéma zod contenant un `.transform()` ou tout
 *   autre élément non représentable en JSON Schema fait ÉCHOUER `pnpm api:openapi` plutôt que
 *   de produire silencieusement un `requestBody` tronqué. C'est le comportement recherché —
 *   voir l'en-tête de `api-corps-zod.decorator.ts`.
 *
 * `$schema` (méta-donnée de dialecte, hors de propos dans un fragment `requestBody`) est retiré
 * du résultat.
 */
export function schemaZodVersOpenApi(schema: ZodType): SchemaObjectOpenApi {
  const { $schema: _$schema, ...corps } = z.toJSONSchema(schema, { io: 'input', reused: 'inline' }) as Record<string, unknown>;
  return corps as SchemaObjectOpenApi;
}
