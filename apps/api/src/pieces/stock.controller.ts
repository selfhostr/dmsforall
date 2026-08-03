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
  schemaIdentifiant,
  schemaModificationStockSite,
  type EntreeModificationStockSite,
} from '@dfa/shared';
import { z } from 'zod';

import { ServiceContexteRequete } from '../common/contexte';
import { CorpsZod } from '../common/documentation';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';

import { DisponibiliteArticleDto, StockArticleDto } from './dto';
import { schemaUuid } from './schemas';
import { ServiceStock } from './service-stock';

const schemaQueteDisponibilite = z.object({ siteId: schemaIdentifiant });

/**
 * Consultation du stock par (article, site) et disponibilité (RP-09 → RP-15, priorités 2 et 3) —
 * routes rattachées à `/articles/{id}/...`, contrôleur disjoint d'`ArticleController` (périmètre
 * de service distinct, mêmes conventions).
 */
@ApiTags('Pièces — Stock')
@ApiCookieAuth()
@Controller({ path: 'articles', version: '1' })
@UseGuards(GardeDroit)
export class StockArticleController {
  constructor(
    private readonly service: ServiceStock,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get(':articleId/disponibilite')
  @ExigerDroit('pieces.stock.lire')
  @ApiOperation({
    summary:
      'Disponibilité d’un article sur un site (RP-14/RP-19) — rend RP-19 vérifiable : qui bloque quoi, nommément.',
  })
  @ApiParam({ name: 'articleId', format: 'uuid' })
  @ApiQuery({ name: 'siteId', required: true, format: 'uuid' })
  @ApiOkResponse({ type: DisponibiliteArticleDto })
  @ApiReponseProbleme(400, 'siteId manquant ou mal formé.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Article introuvable pour ce tenant.')
  async disponibilite(
    @Param('articleId', new PipeZod(schemaUuid)) articleId: string,
    @Query(new PipeZod(schemaQueteDisponibilite)) query: { siteId: string },
  ): Promise<DisponibiliteArticleDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.disponibilite(ctx, articleId, query.siteId);
  }

  @Patch(':articleId/stock/:siteId')
  @ExigerDroit('pieces.stock.modifier')
  @ApiOperation({
    summary:
      'Réglages de stock d’un site (emplacement, seuils) — JAMAIS la quantité physique (RP-16→RP-18).',
  })
  @ApiParam({ name: 'articleId', format: 'uuid' })
  @ApiParam({ name: 'siteId', format: 'uuid' })
  @ApiOkResponse({ type: StockArticleDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Article ou site introuvable pour ce tenant.')
  async modifierSite(
    @Param('articleId', new PipeZod(schemaUuid)) articleId: string,
    @Param('siteId', new PipeZod(schemaUuid)) siteId: string,
    @CorpsZod(schemaModificationStockSite) entree: EntreeModificationStockSite,
  ): Promise<StockArticleDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.modifierSite(ctx, articleId, siteId, entree);
  }
}
