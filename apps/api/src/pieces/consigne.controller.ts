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
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FiltresConsignes } from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';

import { ConsigneEchangeStandardDto, PageConsigneEchangeStandardDto } from './dto';
import { schemaFiltresConsignes, schemaUuid } from './schemas';
import { ServiceConsigne } from './service-consigne';
import { ExigerModule } from '../common/droits/garde-module';

/**
 * Consigne d'échange standard (RP-37 → RP-42, §6.4). PAS de `POST /consignes` : la pose naît comme
 * effet de bord serveur de la réalisation d'une ligne d'OR de dépose (`atelier/`, GELÉ, hors
 * périmètre — même remarque que `reservation.ts`).
 */
@ApiTags('Pièces — Consignes')
@ApiCookieAuth()
@ExigerModule('pieces')
@Controller({ path: 'consignes', version: '1' })
@UseGuards(GardeDroit)
export class ConsigneController {
  constructor(
    private readonly service: ServiceConsigne,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get()
  @ExigerDroit('pieces.consigne.lire')
  @ApiOperation({
    summary:
      'Vue transverse des consignes — §7.7 : une consigne jamais rendue est de l’argent qui dort.',
  })
  @ApiOkResponse({ type: PageConsigneEchangeStandardDto })
  @ApiReponseProbleme(400, 'Filtres, tri ou curseur invalides.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  async lister(
    @Query(new PipeZod(schemaFiltresConsignes)) query: FiltresConsignes,
  ): Promise<PageConsigneEchangeStandardDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.lister(ctx, query);
  }

  @Post(':id/marquer-retour-fournisseur')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('pieces.consigne.retourner')
  @ApiOperation({
    summary:
      'Le client ramène la vieille pièce (RP-40) — génère le mouvement retour_consigne, statut terminal.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ConsigneEchangeStandardDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Consigne introuvable pour ce tenant.')
  @ApiReponseProbleme(
    409,
    'CONSIGNE_TRANSITION_INTERDITE — la consigne n’est plus en attente de retour.',
  )
  async marquerRetourFournisseur(
    @Param('id', new PipeZod(schemaUuid)) id: string,
  ): Promise<ConsigneEchangeStandardDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.marquerRetourFournisseur(ctx, id);
  }
}
