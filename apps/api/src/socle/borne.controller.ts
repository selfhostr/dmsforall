/**
 * `/api/v1/bornes` — gestion des bornes d'atelier (comptes de service `poste_atelier`) par le
 * garage. Droits `socle.borne.*` : `direction` et `admin` seuls. Tenant exclusivement issu de la
 * session ; schémas `.strict()` (un `tenantId` dans le corps est un 400).
 */
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { schemaCreationBorne, schemaParametresPage, type ParametresPage } from '@dfa/shared';
import { z } from 'zod';

import { ServiceContexteRequete } from '../common/contexte';
import { CorpsZod } from '../common/documentation';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';
import {
  BorneResumeDto,
  PageBorneResumeDto,
  ReponseAccesTemporaireDto,
  ReponseCreationBorneDto,
} from './dto';
import { ServiceBorne } from './service-borne';
import { ExigerModule } from '../common/droits/garde-module';

const schemaBorneId = z.string().uuid();

@ApiTags('Socle')
@ApiCookieAuth()
@ExigerModule('tablettes')
@Controller({ path: 'bornes', version: '1' })
@UseGuards(GardeDroit)
export class BorneController {
  constructor(
    private readonly service: ServiceBorne,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get()
  @ExigerDroit('socle.borne.lire')
  @ApiOperation({ summary: "Liste des bornes d'atelier du tenant courant" })
  @ApiQuery({ name: 'limite', required: false, type: Number, example: 50 })
  @ApiQuery({ name: 'curseur', required: false, type: String })
  @ApiOkResponse({ type: PageBorneResumeDto })
  @ApiReponseProbleme(400, 'Curseur illisible ou paramètres de pagination invalides.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (rôle sans socle.borne.lire).')
  async lister(
    @Query(new PipeZod(schemaParametresPage)) params: ParametresPage,
  ): Promise<PageBorneResumeDto> {
    return this.service.lister(this.contexte.contexteTenant(), params);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('socle.borne.creer')
  @ApiOperation({
    summary: "Créer une borne d'atelier rattachée à un site",
    description:
      "L'identifiant de connexion et le mot de passe sont générés par le serveur ; le mot de " +
      'passe est rendu UNE SEULE FOIS (acces.motDePasseTemporaire). Les PIN de pointage restent ' +
      'gérés par technicien (PUT /pointage/pins).',
  })
  @ApiCreatedResponse({ type: ReponseCreationBorneDto })
  @ApiReponseProbleme(400, 'Corps invalide, ou site introuvable pour ce tenant.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (rôle sans socle.borne.creer).')
  async creer(
    @CorpsZod(schemaCreationBorne, {
      exemple: { nom: 'Atelier Sion', siteId: '11111111-1111-4111-8111-111111111111' },
    })
    corps: z.infer<typeof schemaCreationBorne>,
  ): Promise<ReponseCreationBorneDto> {
    return this.service.creer(this.contexte.contexteTenant(), corps);
  }

  @Post(':borneId/desactiver')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('socle.borne.desactiver')
  @ApiOperation({
    summary: 'Désactiver une borne (révoque ses sessions)',
  })
  @ApiParam({ name: 'borneId', format: 'uuid' })
  @ApiOkResponse({ type: BorneResumeDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (rôle sans socle.borne.desactiver).')
  @ApiReponseProbleme(404, 'Borne introuvable pour ce tenant.')
  async desactiver(
    @Param('borneId', new PipeZod(schemaBorneId)) borneId: string,
  ): Promise<BorneResumeDto> {
    return this.service.desactiver(this.contexte.contexteTenant(), borneId);
  }

  @Post(':borneId/reactiver')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('socle.borne.desactiver')
  @ApiOperation({ summary: 'Réactiver une borne désactivée' })
  @ApiParam({ name: 'borneId', format: 'uuid' })
  @ApiOkResponse({ type: BorneResumeDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (rôle sans socle.borne.desactiver).')
  @ApiReponseProbleme(404, 'Borne introuvable pour ce tenant.')
  async reactiver(
    @Param('borneId', new PipeZod(schemaBorneId)) borneId: string,
  ): Promise<BorneResumeDto> {
    return this.service.reactiver(this.contexte.contexteTenant(), borneId);
  }

  @Post(':borneId/reinitialiser-acces')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('socle.borne.reinitialiser_acces')
  @ApiOperation({
    summary: "Nouveau mot de passe d'une borne",
    description: 'Mot de passe rendu UNE SEULE FOIS ; les sessions de la borne sont révoquées.',
  })
  @ApiParam({ name: 'borneId', format: 'uuid' })
  @ApiOkResponse({ type: ReponseAccesTemporaireDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (rôle sans socle.borne.reinitialiser_acces).')
  @ApiReponseProbleme(404, 'Borne introuvable pour ce tenant.')
  async reinitialiserAcces(
    @Param('borneId', new PipeZod(schemaBorneId)) borneId: string,
  ): Promise<ReponseAccesTemporaireDto> {
    return this.service.reinitialiserAcces(this.contexte.contexteTenant(), borneId);
  }
}
