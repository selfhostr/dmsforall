import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FiltresReapprovisionnement } from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';

import { PageReapprovisionnementDto } from './dto';
import { schemaFiltresReapprovisionnement } from './schemas';
import { ServiceStock } from './service-stock';

/** `GET /stock/reapprovisionnement` — RP-12 : propose, ne commande jamais automatiquement. */
@ApiTags('Pièces — Stock')
@ApiCookieAuth()
@Controller({ path: 'stock', version: '1' })
@UseGuards(GardeDroit)
export class ReapprovisionnementController {
  constructor(
    private readonly service: ServiceStock,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get('reapprovisionnement')
  @ExigerDroit('pieces.stock.lire')
  @ApiOperation({ summary: 'Articles sous leur stock minimum, par site (RP-12).' })
  @ApiOkResponse({ type: PageReapprovisionnementDto })
  @ApiReponseProbleme(400, 'siteId manquant, filtres, tri ou curseur invalides.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  async lister(
    @Query(new PipeZod(schemaFiltresReapprovisionnement)) query: FiltresReapprovisionnement,
  ): Promise<PageReapprovisionnementDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.reapprovisionnement(ctx, query);
  }
}
