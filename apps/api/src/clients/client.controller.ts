import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  schemaCreationClient,
  schemaDesactivationClient,
  schemaModificationClient,
  type EntreeCreationClient,
  type EntreeDesactivationClient,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { ApiCorpsZod, CorpsZod } from '../common/documentation';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';
import { ClientAvecAvertissementsDto, ClientDto, PageClientResumeDto } from './dto';
import { schemaListeClients, schemaUuid, type ParametresListeClients } from './schemas';
import { ServiceClient } from './service-client';

/**
 * CRUD cœur de la fiche client (RM-01 → RM-14, contrats-api-etape-1.md §7.3). Les sous-collections
 * (adresses, contacts, conditions, consentements, notes) et les projections (véhicules, ordres de
 * réparation) sont des contrôleurs distincts — voir `client-sous-collections.controller.ts` et
 * `client-projections.controller.ts`. `GET /doublons-clients` est un contrôleur à part
 * (`doublons-clients.controller.ts`) : placé à la RACINE, pas sous `/clients/…` (voir le
 * commentaire de `ReponseDoublonsClients` dans le contrat gelé).
 *
 * Aucun `DELETE` : un client se DÉSACTIVE (RM-12), jamais ne se supprime. La fusion (RM-06,
 * `POST /clients/{id}/fusionner`) n'est pas exposée ici — hors du périmètre demandé pour ce
 * lot d'assemblage, `schemaFusionClient` existe déjà dans le contrat gelé pour quand elle le sera.
 */
@ApiTags('Clients')
@ApiCookieAuth()
@Controller({ path: 'clients', version: '1' })
@UseGuards(GardeDroit)
export class ClientController {
  constructor(
    private readonly serviceClient: ServiceClient,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get()
  @ExigerDroit('client.lire')
  @ApiOperation({ summary: 'Liste paginée des clients du tenant courant (§6.2, §7.3).' })
  @ApiOkResponse({ type: PageClientResumeDto })
  @ApiReponseProbleme(400, 'Filtres, tri ou curseur invalides.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (rôle sans client.lire).')
  async lister(@Query(new PipeZod(schemaListeClients)) query: ParametresListeClients): Promise<PageClientResumeDto> {
    const ctx = this.contexte.contexteTenant();
    return this.serviceClient.lister(ctx, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('client.creer')
  @ApiOperation({
    summary: "Création d'une fiche client.",
    description:
      "`Idempotency-Key` obligatoire (uuid v4) : un rejeu ne doit pas brûler un numéro de client " +
      "(RM-11). La détection de doublon (RM-05) n'est jamais bloquante : un candidat probable " +
      'revient en `avertissements[]` (`CLIENT_DOUBLON_PROBABLE`), la création a lieu quand même.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'uuid v4, identité de la requête.' })
  @ApiResponse({ status: 201, type: ClientAvecAvertissementsDto })
  @ApiReponseProbleme(400, 'Corps invalide ou Idempotency-Key manquante/mal formée.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (rôle sans client.creer).')
  @ApiReponseProbleme(409, 'IDEMPOTENCE_CONFLIT — même clé, corps différent ou exécution encore en cours.')
  async creer(
    @CorpsZod(schemaCreationClient, {
      exemple: {
        type: 'particulier',
        civilite: 'Madame',
        nom: 'Dubois',
        prenom: 'Claire',
        langueCorrespondance: 'fr',
        adressePrincipale: {
          rue: 'Rue du Lac 12',
          npa: '1003',
          localite: 'Lausanne',
          pays: 'CH',
        },
        telephones: [{ valeur: '+41 79 123 45 67', principal: true }],
        email: 'claire.dubois@example.ch',
        poObligatoire: false,
      },
    })
    entree: EntreeCreationClient,
    @Headers('idempotency-key') cleIdempotence: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const ctx = this.contexte.contexteTenant();
    const resultat = await this.serviceClient.creer(ctx, entree, cleIdempotence ?? '');

    res.status(resultat.reponse.statutHttp);
    if (resultat.rejoue) {
      res.setHeader('Idempotency-Rejeu', 'true');
    }
    return resultat.reponse.corps;
  }

  @Get(':clientId')
  @ExigerDroit('client.lire')
  @ApiOperation({
    summary: "Fiche d'un client.",
    description:
      "Répond `200` même si la fiche a été absorbée par une fusion (`fusionneVersClientId` " +
      'renseigné, RM-06) : un connecteur qui détient l’ancien identifiant doit pouvoir suivre la ' +
      'trace, pas recevoir un 404.',
  })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiOkResponse({ type: ClientDto })
  @ApiReponseProbleme(400, 'Identifiant mal formé.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Client introuvable pour ce tenant.')
  async parId(@Param('clientId', new PipeZod(schemaUuid)) clientId: string): Promise<ClientDto> {
    const ctx = this.contexte.contexteTenant();
    return this.serviceClient.parId(ctx, clientId);
  }

  @Patch(':clientId')
  @ExigerDroit('client.modifier')
  @ApiOperation({
    summary: "Modification d'une fiche client.",
    description:
      "`type` est IMMUABLE après création (RM-01) : le poser dans le corps produit " +
      '`409 CLIENT_TYPE_IMMUABLE`, jamais un `400`. `statut` est en lecture seule — la ' +
      'désactivation passe par `POST /clients/{id}/desactiver`.',
  })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiOkResponse({ type: ClientAvecAvertissementsDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Client introuvable pour ce tenant.')
  @ApiReponseProbleme(409, "CLIENT_TYPE_IMMUABLE — `type` présent dans le corps.")
  @ApiCorpsZod(schemaModificationClient, {
    description:
      "`type` est volontairement absent de ce schéma (immuable, RM-01) — l'envoyer produit `409 CLIENT_TYPE_IMMUABLE`, détecté sur le corps brut par le service.",
    exemple: { telephone: '+41 21 555 12 34', email: 'claire.dubois@example.ch', poObligatoire: true },
  })
  async modifier(
    @Param('clientId', new PipeZod(schemaUuid)) clientId: string,
    @Body() corpsBrut: Record<string, unknown>,
  ): Promise<ClientAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    return this.serviceClient.modifier(ctx, clientId, corpsBrut);
  }

  @Post(':clientId/desactiver')
  @ExigerDroit('client.desactiver')
  @ApiOperation({
    summary: "Désactivation d'une fiche client (RM-12).",
    description: "Aucun `DELETE` n'existe. Refusée s'il reste des OR ou des détentions de véhicule ouverts.",
  })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiOkResponse({ type: ClientAvecAvertissementsDto })
  @ApiReponseProbleme(400, 'Motif manquant.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Client introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'CLIENT_DESACTIVATION_IMPOSSIBLE — `blocages[]` nomme chaque OR/détention ouvert.')
  async desactiver(
    @Param('clientId', new PipeZod(schemaUuid)) clientId: string,
    @CorpsZod(schemaDesactivationClient, { exemple: { motif: 'Fonds de commerce repris, clientèle transférée au nouveau garage' } })
    entree: EntreeDesactivationClient,
  ): Promise<ClientAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    return this.serviceClient.desactiver(ctx, clientId, entree);
  }
}
