/**
 * `GET|PATCH /sites/{siteId}/parametres-atelier` (contrats-api-etape-1.md §8.2, §7.12).
 *
 * Greffé sur la ressource `/sites` du socle plutôt que sous une famille `/parametrage/sites/{id}`
 * parallèle — un seul chemin possible pour un même site (voir §8.2, dernier paragraphe).
 * `siteId` d'un autre tenant → `404 RESSOURCE_INTROUVABLE`, jamais `403` (§1.2, I-13) : le RLS
 * scope déjà `enTenant`, et le service ne distingue pas « site inexistant » de « site d'un autre
 * tenant » — la même réponse dans les deux cas est la propriété recherchée.
 */
import { ApiCookieAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Controller, Get, Headers, Param, Patch, Res } from '@nestjs/common';
import type { Response } from 'express';
import { schemaIdentifiant, schemaModificationParametresSite, type EntreeModificationParametresSite } from '@dfa/shared';

import { ApiReponseProbleme } from '../../common/erreurs';
import { ServiceContexteRequete } from '../../common/contexte';
import { CorpsZod } from '../../common/documentation';
import { ExigerDroit } from '../../common/droits';
import { PipeZod } from '../../common/validation';
import { calculerEtag, ifNoneMatchSatisfait } from '../etag';
import { ReponseParametresSiteDto } from '../dto/reponse-parametres-site.dto';
import { ServiceParametresSite } from './service-parametres-site';

@ApiTags('Paramétrage')
@ApiCookieAuth()
@Controller('sites/:siteId/parametres-atelier')
export class ParametresSiteController {
  constructor(
    private readonly service: ServiceParametresSite,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @ExigerDroit('parametrage.atelier.lire')
  @Get()
  @ApiParam({ name: 'siteId', format: 'uuid' })
  @ApiOperation({ summary: 'Paramètres du site (P-20 capacité, P-31 clôture pointage).' })
  @ApiResponse({ status: 200, description: 'Paramètres du site.', type: ReponseParametresSiteDto })
  @ApiResponse({ status: 304, description: 'Non modifié depuis `If-None-Match`.' })
  @ApiReponseProbleme(404, 'RESSOURCE_INTROUVABLE — site inconnu de ce tenant, ou sans ligne de paramétrage.')
  async obtenir(
    @Param('siteId', new PipeZod(schemaIdentifiant)) siteId: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const dto = await this.service.obtenir(this.contexte.contexteTenant(), siteId);
    res.setHeader('ETag', calculerEtag(dto.version));
    res.setHeader('Cache-Control', 'private, must-revalidate');

    if (ifNoneMatchSatisfait(ifNoneMatch, dto.version)) {
      res.status(304).end();
      return;
    }
    res.status(200).json(dto);
  }

  @ExigerDroit('parametrage.atelier.modifier')
  @Patch()
  @ApiParam({ name: 'siteId', format: 'uuid' })
  @ApiOperation({ summary: 'Modifie partiellement les paramètres du site.' })
  @ApiResponse({ status: 200, description: 'Paramètres du site mis à jour.', type: ReponseParametresSiteDto })
  @ApiReponseProbleme(400, 'VALIDATION_ECHOUEE — corps invalide.')
  @ApiReponseProbleme(404, 'RESSOURCE_INTROUVABLE — site inconnu de ce tenant, ou sans ligne de paramétrage.')
  async modifier(
    @Param('siteId', new PipeZod(schemaIdentifiant)) siteId: string,
    @CorpsZod(schemaModificationParametresSite, {
      exemple: { heureOuverture: '07:30', heureFermeture: '18:00', heureCloturePointage: '18:30', capaciteHeuresJourCentiemes: 4800 },
    })
    corps: EntreeModificationParametresSite,
  ): Promise<ReponseParametresSiteDto> {
    return this.service.modifier(this.contexte.contexteTenant(), siteId, corps);
  }
}
