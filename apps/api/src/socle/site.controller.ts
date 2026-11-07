import { Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  schemaModificationSite,
  schemaParametresPage,
  type EntreeModificationSite,
  type ParametresPage,
} from '@dfa/shared';
import { z } from 'zod';
import { ServiceContexteRequete } from '../common/contexte';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { CorpsZod } from '../common/documentation';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';
import { PageSiteResumeDto, SiteResumeDto } from './dto';
import { ServiceSite } from './service-site';

const schemaSiteId = z.string().uuid();

/** `GET /api/v1/sites` et `GET /api/v1/sites/{siteId}` — endpoints 5 et 6 du contrat étape 0. */
@ApiTags('Socle')
@ApiCookieAuth()
@Controller({ path: 'sites', version: '1' })
@UseGuards(GardeDroit)
@ExigerDroit('socle.site.lire')
export class SiteController {
  constructor(
    private readonly serviceSite: ServiceSite,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Liste des sites du tenant courant',
    description: 'Pagination par curseur opaque, tri stable (cree_le desc, id desc).',
  })
  @ApiQuery({
    name: 'limite',
    required: false,
    type: Number,
    example: 50,
    description: 'Entre 1 et 200, défaut 50.',
  })
  @ApiQuery({
    name: 'curseur',
    required: false,
    type: String,
    description: 'Curseur opaque renvoyé par la page précédente.',
  })
  @ApiOkResponse({ type: PageSiteResumeDto })
  @ApiReponseProbleme(400, 'Curseur illisible ou paramètres de pagination invalides.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (rôle sans socle.site.lire).')
  async lister(
    @Query(new PipeZod(schemaParametresPage)) params: ParametresPage,
  ): Promise<PageSiteResumeDto> {
    const ctx = this.contexte.contexteTenant();
    return this.serviceSite.lister(ctx, params);
  }

  @Get(':siteId')
  @ApiOperation({ summary: "Détail d'un site du tenant courant" })
  @ApiParam({ name: 'siteId', format: 'uuid' })
  @ApiOkResponse({ type: SiteResumeDto })
  @ApiReponseProbleme(400, 'Identifiant de site mal formé (uuid attendu).')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (rôle sans socle.site.lire).')
  @ApiReponseProbleme(
    404,
    "Site introuvable pour ce tenant — y compris s'il existe pour un autre tenant.",
  )
  async parId(@Param('siteId', new PipeZod(schemaSiteId)) siteId: string): Promise<SiteResumeDto> {
    const ctx = this.contexte.contexteTenant();
    return this.serviceSite.parId(ctx, siteId);
  }

  @Patch(':siteId')
  @ExigerDroit('parametrage.atelier.modifier')
  @ApiOperation({
    summary: 'Modifier un site (code court)',
    description:
      'Code court : 1 à 5 caractères A-Z/0-9, unique dans le garage. Même droit que les ' +
      'réglages par site.',
  })
  @ApiParam({ name: 'siteId', format: 'uuid' })
  @ApiOkResponse({ type: SiteResumeDto })
  @ApiReponseProbleme(400, 'Corps invalide (code court hors format).')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (parametrage.atelier.modifier).')
  @ApiReponseProbleme(404, 'Site introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'CONFLIT — ce code court est déjà utilisé par un autre site.')
  async modifier(
    @Param('siteId', new PipeZod(schemaSiteId)) siteId: string,
    @CorpsZod(schemaModificationSite, { exemple: { codeCourt: 'MART' } })
    corps: EntreeModificationSite,
  ): Promise<SiteResumeDto> {
    const ctx = this.contexte.contexteTenant();
    return this.serviceSite.modifier(ctx, siteId, corps);
  }
}
