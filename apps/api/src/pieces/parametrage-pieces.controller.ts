import { Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { schemaModificationParametresPieces, type EntreeModificationParametresPieces } from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { CorpsZod } from '../common/documentation';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';

import { ParametresPiecesDto } from './dto';
import { ServiceParametragePieces } from './service-parametrage-pieces';

/** Paramétrage du domaine pièces (§10, PP-01 → PP-08). Portée tenant. */
@ApiTags('Pièces — Paramétrage')
@ApiCookieAuth()
@Controller({ path: 'parametrage/pieces', version: '1' })
@UseGuards(GardeDroit)
export class ParametragePiecesController {
  constructor(
    private readonly service: ServiceParametragePieces,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get()
  @ExigerDroit('pieces.parametrage.lire')
  @ApiOperation({ summary: 'Paramètres pièces du tenant courant.' })
  @ApiOkResponse({ type: ParametresPiecesDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  async obtenir(): Promise<ParametresPiecesDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.obtenir(ctx);
  }

  @Patch()
  @ExigerDroit('pieces.parametrage.modifier')
  @ApiOperation({ summary: 'Modification partielle des paramètres pièces.' })
  @ApiOkResponse({ type: ParametresPiecesDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  async modifier(@CorpsZod(schemaModificationParametresPieces) entree: EntreeModificationParametresPieces): Promise<ParametresPiecesDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.modifier(ctx, entree);
  }
}
