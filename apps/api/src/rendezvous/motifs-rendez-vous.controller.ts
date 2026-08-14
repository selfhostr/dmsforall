import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ServiceContexteRequete } from '../common/contexte';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';

import { ReponseMotifRendezVousDto } from './dto';
import { ServiceMotifsRendezVous } from './service-motifs-rendez-vous';

/**
 * `GET /motifs-rendez-vous` — catalogue paramétrable par garage (RV-01/RV-02). Même droit que les
 * autres référentiels de paramétrage (`parametrage.referentiel.lire`, ouvert à tout rôle
 * authentifié) : ce n'est pas une action propre au domaine rendez-vous, c'est une lecture de
 * référentiel comme `GET /referentiels/taux-horaires`.
 */
@ApiTags('Rendez-vous')
@ApiCookieAuth()
@Controller({ path: 'motifs-rendez-vous', version: '1' })
@UseGuards(GardeDroit)
export class MotifsRendezVousController {
  constructor(
    private readonly service: ServiceMotifsRendezVous,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get()
  @ExigerDroit('parametrage.referentiel.lire')
  @ApiOperation({
    summary: 'Catalogue des motifs de rendez-vous, avec leur durée par défaut (RV-01/RV-02).',
  })
  @ApiOkResponse({ type: [ReponseMotifRendezVousDto] })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  async lister(): Promise<readonly ReponseMotifRendezVousDto[]> {
    const ctx = this.contexte.contexteTenant();
    return this.service.lister(ctx);
  }
}
