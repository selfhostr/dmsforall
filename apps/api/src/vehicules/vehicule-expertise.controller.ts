import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { schemaExpertiseVehicule, schemaIdentifiant, type EntreeExpertiseVehicule } from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';
import { ReponseVehiculeExpertiseDto } from './dto';
import { ServiceVehiculeExpertise } from './service-vehicule-expertise';

@ApiTags('Véhicules')
@ApiCookieAuth()
@Controller({ path: 'vehicules/:vehiculeId/expertises', version: '1' })
@UseGuards(GardeDroit)
export class VehiculeExpertiseController {
  constructor(
    private readonly service: ServiceVehiculeExpertise,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get()
  @ExigerDroit('vehicule.lire')
  @ApiOperation({ summary: 'Historique des expertises MFK (RM-28).' })
  @ApiParam({ name: 'vehiculeId', format: 'uuid' })
  @ApiOkResponse({ type: [ReponseVehiculeExpertiseDto] })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Véhicule introuvable pour ce tenant.')
  async lister(@Param('vehiculeId', new PipeZod(schemaIdentifiant)) vehiculeId: string) {
    const ctx = this.contexte.contexteTenant();
    return this.service.lister(ctx, vehiculeId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('vehicule.expertise.saisir')
  @ApiOperation({
    summary: "Enregistrement d'une expertise (RM-28, CT-10).",
    description: 'Une convocation cantonale (`sourceEcheance: "convocation"`) prime toujours sur une périodicité calculée.',
  })
  @ApiParam({ name: 'vehiculeId', format: 'uuid' })
  @ApiResponse({ status: 201, type: ReponseVehiculeExpertiseDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Véhicule introuvable pour ce tenant.')
  async creer(
    @Param('vehiculeId', new PipeZod(schemaIdentifiant)) vehiculeId: string,
    @Body(new PipeZod(schemaExpertiseVehicule)) entree: EntreeExpertiseVehicule,
  ) {
    const ctx = this.contexte.contexteTenant();
    return this.service.creer(ctx, vehiculeId, entree);
  }
}
