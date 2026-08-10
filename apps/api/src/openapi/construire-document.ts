import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { ProblemeDetailCommunDto } from '../common/erreurs';

export interface OptionsDocumentOpenApi {
  readonly versionApp: string;
  readonly cookieNom: string;
}

/**
 * OpenAPI 3.1, un tag par domaine, `ProblemeDetailCommunDto` enregistré comme modèle global
 * (`extraModels`) pour que toute réponse d'erreur déclarée via `@ApiReponseProbleme`
 * référence le même schéma — c'est ce document que le front lit pour générer ses types
 * (`openapi-typescript`), une réponse non déclarée ici n'existe pas pour lui.
 */
export function construireDocument(
  app: INestApplication,
  options: OptionsDocumentOpenApi,
): OpenAPIObject {
  const builder = new DocumentBuilder()
    .setOpenAPIVersion('3.1.0')
    .setTitle('API dmsforall (DFA)')
    .setDescription(
      'API du DMS (Dealer Management System) pour garages et concessions suisses. ' +
        "Contrat d'erreur unique application/problem+json (schéma ProblemeDetailCommunDto, code machine stable). " +
        "Le tenant est toujours résolu depuis la session — aucun endpoint n'accepte de tenantId en paramètre.",
    )
    .setVersion(options.versionApp)
    .addTag('Auth', 'Connexion, déconnexion, session courante.')
    .addTag('Socle', 'Tenant courant et sites.')
    .addTag('Santé', 'Sondes de vie et de disponibilité applicative.')
    .addCookieAuth(
      options.cookieNom,
      { type: 'apiKey', in: 'cookie', name: options.cookieNom },
      'cookie',
    )
    .build();

  const document = SwaggerModule.createDocument(app, builder, {
    extraModels: [ProblemeDetailCommunDto],
  });

  return exclureCheminsConsole(document);
}

/**
 * Retire du document MÉTIER tout chemin porté par le plan CONSOLE (`exploitation/`).
 *
 * `SwaggerModule.createDocument` sans option `include` parcourt TOUT le graphe Nest — si
 * `ExploitationModule` est monté (console allumée, `DATABASE_URL_CONSOLE` renseignée), ses
 * chemins atterriraient sinon dans CE document, alors que `construireDocumentConsole`
 * (`exploitation/openapi/construire-document-console.ts`) en produit déjà un second, disjoint,
 * précisément pour que `test/contrat/openapi.spec.ts` (qui interdit tout paramètre "tenantId"
 * dans le document métier) n'ait jamais à faire de la place à un contrat qui n'est pas le sien
 * (invariant 7 de `docs/conception-console-exploitation-acces.md` §8).
 *
 * Filtre par PRÉFIXE DE CHEMIN plutôt que par un `include` listant chaque module métier : la
 * liste de modules devrait sinon être tenue à jour à chaque ajout de module (silencieusement
 * oubliable — même famille de piège qu'un contrôleur non déclaré dans son module), alors que
 * tout contrôleur du plan console vit sous le seul segment `exploitation` (invariant : « aucune
 * route console n'est servie par une classe issue d'un répertoire métier »), qui ne bouge pas.
 *
 * Robuste même si la console est ÉTEINTE (cas par défaut) : dans ce cas `document.paths` ne
 * contient de toute façon aucun chemin `exploitation`, ce filtre est un no-op.
 *
 * Le préfixe `api`/`v1` est TOLÉRÉ mais pas exigé, car les deux appelants de `construireDocument`
 * ne présentent pas les mêmes chemins : `main.ts` l'appelle APRÈS `app.setGlobalPrefix('api')` et
 * `app.enableVersioning(...)` (le document généré porte alors `/api/v1/exploitation/…`), tandis que
 * `openapi/exporter-openapi.ts` (donc `pnpm api:openapi`, donc le document lu par
 * `test/contrat/openapi.spec.ts`) ne pose ni l'un ni l'autre avant de construire le document — les
 * chemins y apparaissent bruts (`/exploitation/…`), comme pour tout autre contrôleur du dépôt.
 */
function exclureCheminsConsole(document: OpenAPIObject): OpenAPIObject {
  const RE_CHEMIN_CONSOLE = /^\/(api\/)?(v\d+\/)?exploitation(\/|$)/;
  const estCheminConsole = (chemin: string): boolean => RE_CHEMIN_CONSOLE.test(chemin);

  const cheminsMetier = Object.fromEntries(
    Object.entries(document.paths ?? {}).filter(([chemin]) => !estCheminConsole(chemin)),
  );

  return {
    ...document,
    paths: cheminsMetier,
    // Défense en profondeur : `document.tags` ne reflète que les tags déclarés via
    // `DocumentBuilder.addTag()` (ce builder n'appelle jamais `.addTag('Console — plateforme', …)`),
    // donc ce filtre est normalement un no-op — posé pour que le document reste correct même si
    // un jour ce builder venait à déclarer ce tag par erreur.
    tags: document.tags?.filter((tag) => tag.name !== 'Console — plateforme'),
  };
}
