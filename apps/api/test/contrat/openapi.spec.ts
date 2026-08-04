/**
 * Protège la règle n°1 du projet (isolation tenant) contre toute régression future dans le
 * contrat d'API : aucune opération du document OpenAPI généré (packages/shared/openapi/
 * dfa-openapi.json, cf. contrat gelé §4 "Aucun endpoint n'accepte de tenantId — ni chemin, ni
 * query, ni corps") ne doit exposer de paramètre ou de propriété de corps nommée "tenantId".
 * Le tenant se résout TOUJOURS depuis la session, jamais depuis une entrée cliente.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Module CommonJS : `__dirname` est fourni par le runtime, pas besoin de `import.meta.url`.
const CHEMIN_OPENAPI = path.resolve(
  __dirname,
  '../../../../packages/shared/openapi/dfa-openapi.json',
);

type SchemaJson = Record<string, unknown>;

function resoudreRef(schema: unknown, document: SchemaJson): SchemaJson | undefined {
  if (
    schema &&
    typeof schema === 'object' &&
    typeof (schema as { $ref?: unknown }).$ref === 'string'
  ) {
    const ref = (schema as { $ref: string }).$ref;
    if (!ref.startsWith('#/')) return undefined;
    const segments = ref.slice(2).split('/');
    let courant: unknown = document;
    for (const segment of segments) {
      if (courant === undefined || courant === null) return undefined;
      courant = (courant as Record<string, unknown>)[segment];
    }
    return courant as SchemaJson;
  }
  return schema as SchemaJson;
}

function chercherProprieteTenantId(
  schemaBrut: unknown,
  document: SchemaJson,
  libelleOperation: string,
  infractions: string[],
  dejaVus: Set<unknown>,
): void {
  const schema = resoudreRef(schemaBrut, document);
  if (!schema || typeof schema !== 'object' || dejaVus.has(schema)) return;
  dejaVus.add(schema);

  const proprietes = (schema as { properties?: Record<string, unknown> }).properties;
  if (proprietes && 'tenantId' in proprietes) {
    infractions.push(`${libelleOperation} : propriété de corps "tenantId"`);
  }
  for (const sousSchema of Object.values(proprietes ?? {})) {
    chercherProprieteTenantId(sousSchema, document, libelleOperation, infractions, dejaVus);
  }
  for (const cle of ['items', 'allOf', 'oneOf', 'anyOf'] as const) {
    const valeur = (schema as Record<string, unknown>)[cle];
    if (Array.isArray(valeur)) {
      for (const v of valeur)
        chercherProprieteTenantId(v, document, libelleOperation, infractions, dejaVus);
    } else if (valeur) {
      chercherProprieteTenantId(valeur, document, libelleOperation, infractions, dejaVus);
    }
  }
}

describe('contrat OpenAPI — la règle n°1 du projet (isolation tenant) ne peut pas régresser silencieusement', () => {
  it('aucune opération n\'expose de paramètre (chemin/query) ou de propriété de corps nommée "tenantId"', () => {
    let brut: string;
    try {
      brut = readFileSync(CHEMIN_OPENAPI, 'utf8');
    } catch {
      throw new Error(
        `Document OpenAPI introuvable (${CHEMIN_OPENAPI}). Généré par "pnpm api:openapi" ` +
          `(exporter-openapi.ts, propriété expert-nestjs) — à exécuter avant ce test.`,
      );
    }

    const document = JSON.parse(brut) as SchemaJson & {
      paths?: Record<string, Record<string, unknown>>;
    };
    const infractions: string[] = [];
    const chemins = document.paths ?? {};

    expect(
      Object.keys(chemins).length,
      'document OpenAPI sans aucun chemin — génération incomplète ?',
    ).toBeGreaterThan(0);

    for (const [chemin, operationsDuChemin] of Object.entries(chemins)) {
      const parametresPartagesDuChemin =
        (operationsDuChemin as { parameters?: unknown[] }).parameters ?? [];

      for (const [methode, operation] of Object.entries(operationsDuChemin)) {
        // Les clés non-HTTP (ex. "parameters" au niveau du chemin) n'ont pas de "responses".
        if (!operation || typeof operation !== 'object' || !('responses' in (operation as object)))
          continue;

        const libelle = `${methode.toUpperCase()} ${chemin}`;
        const parametresOperation = (operation as { parameters?: unknown[] }).parameters ?? [];

        for (const parametre of [...parametresPartagesDuChemin, ...parametresOperation]) {
          const nom = (parametre as { name?: string; in?: string }).name;
          const emplacement = (parametre as { in?: string }).in;
          if (nom === 'tenantId') {
            infractions.push(`${libelle} : paramètre "tenantId" (${emplacement ?? '?'})`);
          }
        }

        const schemaCorps = (
          operation as { requestBody?: { content?: Record<string, { schema?: unknown }> } }
        ).requestBody?.content?.['application/json']?.schema;
        if (schemaCorps) {
          chercherProprieteTenantId(schemaCorps, document, libelle, infractions, new Set());
        }
      }
    }

    expect(infractions).toEqual([]);
  });
});
