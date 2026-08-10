/**
 * Protège la règle n°1 du projet (isolation tenant) contre toute régression future dans le
 * contrat d'API : aucune opération du document OpenAPI généré (packages/shared/openapi/
 * dfa-openapi.json, cf. contrat gelé §4 "Aucun endpoint n'accepte de tenantId — ni chemin, ni
 * query, ni corps") ne doit exposer de paramètre ou de propriété de corps nommée "tenantId" — ni
 * aucun de ses synonymes plausibles. Le tenant se résout TOUJOURS depuis la session, jamais
 * depuis une entrée cliente.
 *
 * Interdire un seul nom littéral ("tenantId") est un garde-fou qui se contourne en silence : il
 * suffit de renommer le paramètre en "garageId" (le tenant de ce produit EST un garage — cf.
 * apps/api/src/exploitation/openapi/construire-document-console.ts, invariant 6) pour que ce test
 * reste vert alors que la fuite existe. La liste ci-dessous couvre donc les variantes de
 * vocabulaire (tenant/garage) ET les variantes de casse/séparateur (camelCase des contrats TS,
 * snake_case des colonnes Postgres, SCREAMING_SNAKE_CASE si copié depuis du SQL).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Module CommonJS : `__dirname` est fourni par le runtime, pas besoin de `import.meta.url`.
const CHEMIN_OPENAPI = path.resolve(
  __dirname,
  '../../../../packages/shared/openapi/dfa-openapi.json',
);

/**
 * Noms interdits pour tout paramètre de route/query ou propriété de corps : le tenant ne se
 * sélectionne jamais par une entrée cliente, quel que soit le mot ou la casse utilisés.
 */
const NOMS_INTERDITS: readonly string[] = [
  // camelCase — convention des DTO/contrats API de ce dépôt.
  'tenantId',
  'garageId',
  // snake_case — convention des colonnes Postgres ; plausible si copié-collé depuis le schéma.
  'tenant_id',
  'garage_id',
  // PascalCase / SCREAMING_SNAKE_CASE — plausible si copié depuis du SQL, du C#, ou un DTO externe.
  'TenantId',
  'GarageId',
  'TENANT_ID',
  'GARAGE_ID',
];

const ENSEMBLE_NOMS_INTERDITS = new Set(NOMS_INTERDITS);

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
  for (const nomPropriete of Object.keys(proprietes ?? {})) {
    if (ENSEMBLE_NOMS_INTERDITS.has(nomPropriete)) {
      infractions.push(`${libelleOperation} : propriété de corps "${nomPropriete}"`);
    }
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

type DocumentOpenApi = SchemaJson & { paths?: Record<string, Record<string, unknown>> };

/**
 * Parcourt tout le document et rend la liste des infractions trouvées, chacune nommant
 * explicitement l'opération (méthode + chemin), le paramètre ou la propriété fautive, et
 * l'emplacement (path/query/corps) — un message qui ne dit pas où coûte du temps de triage.
 */
function trouverInfractions(document: DocumentOpenApi): string[] {
  const infractions: string[] = [];
  const chemins = document.paths ?? {};

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
        if (nom !== undefined && ENSEMBLE_NOMS_INTERDITS.has(nom)) {
          infractions.push(`${libelle} : paramètre "${nom}" (${emplacement ?? '?'})`);
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

  return infractions;
}

describe('contrat OpenAPI — la règle n°1 du projet (isolation tenant) ne peut pas régresser silencieusement', () => {
  it('aucune opération n\'expose de paramètre (chemin/query) ou de propriété de corps nommée "tenantId" ou l\'un de ses synonymes', () => {
    let brut: string;
    try {
      brut = readFileSync(CHEMIN_OPENAPI, 'utf8');
    } catch {
      throw new Error(
        `Document OpenAPI introuvable (${CHEMIN_OPENAPI}). Généré par "pnpm api:openapi" ` +
          `(exporter-openapi.ts, propriété expert-nestjs) — à exécuter avant ce test.`,
      );
    }

    const document = JSON.parse(brut) as DocumentOpenApi;
    const chemins = document.paths ?? {};

    expect(
      Object.keys(chemins).length,
      'document OpenAPI sans aucun chemin — génération incomplète ?',
    ).toBeGreaterThan(0);

    expect(trouverInfractions(document)).toEqual([]);
  });

  // Un détecteur qui n'a jamais été vu en train de rougir n'a rien prouvé : les deux cas suivants
  // forgent un document minimal et vérifient que la détection réagit réellement, sur chacune des
  // deux surfaces visées (paramètre de route/query, propriété de schéma de corps), avec un
  // synonyme différent de "tenantId" à chaque fois — la preuve que la LISTE fonctionne, pas
  // seulement le nom historique.
  it('rougit sur un paramètre query nommé "garageId" (synonyme de tenantId) — preuve que le détecteur fonctionne', () => {
    const documentForge: DocumentOpenApi = {
      paths: {
        '/exploitation/v1/interventions': {
          get: {
            responses: { '200': {} },
            parameters: [{ name: 'garageId', in: 'query' }],
          },
        },
      },
    };

    const infractions = trouverInfractions(documentForge);

    expect(infractions).toEqual([
      'GET /exploitation/v1/interventions : paramètre "garageId" (query)',
    ]);
  });

  it('rougit sur une propriété de corps nommée "tenant_id" (variante snake_case) — preuve que le détecteur fonctionne', () => {
    const documentForge: DocumentOpenApi = {
      paths: {
        '/exploitation/v1/interventions': {
          post: {
            responses: { '201': {} },
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      tenant_id: { type: 'string' },
                      description: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const infractions = trouverInfractions(documentForge);

    expect(infractions).toEqual([
      'POST /exploitation/v1/interventions : propriété de corps "tenant_id"',
    ]);
  });
});
