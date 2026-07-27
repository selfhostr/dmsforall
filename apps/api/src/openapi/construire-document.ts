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
export function construireDocument(app: INestApplication, options: OptionsDocumentOpenApi): OpenAPIObject {
  const builder = new DocumentBuilder()
    .setOpenAPIVersion('3.1.0')
    .setTitle('API dmsforall (DFA)')
    .setDescription(
      'API du DMS (Dealer Management System) pour garages et concessions suisses. ' +
        "Contrat d'erreur unique application/problem+json (schéma ProblemeDetailCommunDto, code machine stable). " +
        'Le tenant est toujours résolu depuis la session — aucun endpoint n\'accepte de tenantId en paramètre.',
    )
    .setVersion(options.versionApp)
    .addTag('Auth', 'Connexion, déconnexion, session courante.')
    .addTag('Socle', 'Tenant courant et sites.')
    .addTag('Santé', 'Sondes de vie et de disponibilité applicative.')
    .addCookieAuth(options.cookieNom, { type: 'apiKey', in: 'cookie', name: options.cookieNom }, 'cookie')
    .build();

  return SwaggerModule.createDocument(app, builder, {
    extraModels: [ProblemeDetailCommunDto],
  });
}
