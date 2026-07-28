import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { schemaCloturePlaque, schemaIdentifiant, schemaPlaqueVehicule, type EntreePlaqueVehicule } from '@dfa/shared';
import type { EntreeCloturePlaqueVehicule } from './schemas-locales';

import { ServiceContexteRequete } from '../common/contexte';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';
import { ReponseVehiculePlaqueDto } from './dto';
import { ServiceVehiculePlaque } from './service-vehicule-plaque';

@ApiTags('Véhicules')
@ApiCookieAuth()
@Controller({ path: 'vehicules/:vehiculeId/plaques', version: '1' })
@UseGuards(GardeDroit)
export class VehiculePlaqueController {
  constructor(
    private readonly service: ServiceVehiculePlaque,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get()
  @ExigerDroit('vehicule.lire')
  @ApiOperation({ summary: "Historique des plaques d'un véhicule (RM-17)." })
  @ApiParam({ name: 'vehiculeId', format: 'uuid' })
  @ApiOkResponse({ type: [ReponseVehiculePlaqueDto] })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Véhicule introuvable pour ce tenant.')
  async lister(@Param('vehiculeId', new PipeZod(schemaIdentifiant)) vehiculeId: string) {
    const ctx = this.contexte.contexteTenant();
    return this.service.lister(ctx, vehiculeId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('vehicule.plaque.gerer')
  @ApiOperation({ summary: 'Attribution d’une nouvelle plaque (RM-18/19).' })
  @ApiParam({ name: 'vehiculeId', format: 'uuid' })
  @ApiResponse({ status: 201, type: ReponseVehiculePlaqueDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Véhicule introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'VEHICULE_PLAQUE_COLLISION (CT-06).')
  async creer(
    @Param('vehiculeId', new PipeZod(schemaIdentifiant)) vehiculeId: string,
    @Body(new PipeZod(schemaPlaqueVehicule)) entree: EntreePlaqueVehicule,
  ) {
    const ctx = this.contexte.contexteTenant();
    return this.service.creer(ctx, vehiculeId, entree);
  }

  @Post(':plaqueId/cloturer')
  @ExigerDroit('vehicule.plaque.gerer')
  @ApiOperation({ summary: 'Clôture (fin de validité) de la plaque (RM-17).' })
  @ApiParam({ name: 'vehiculeId', format: 'uuid' })
  @ApiParam({ name: 'plaqueId', format: 'uuid' })
  @ApiOkResponse({ type: ReponseVehiculePlaqueDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Plaque introuvable pour ce véhicule.')
  @ApiReponseProbleme(409, 'Plaque déjà clôturée.')
  async cloturer(
    @Param('vehiculeId', new PipeZod(schemaIdentifiant)) vehiculeId: string,
    @Param('plaqueId', new PipeZod(schemaIdentifiant)) plaqueId: string,
    @Body(new PipeZod(schemaCloturePlaque)) entree: EntreeCloturePlaqueVehicule,
  ) {
    const ctx = this.contexte.contexteTenant();
    return this.service.cloturer(ctx, vehiculeId, plaqueId, entree.finLe);
  }
}
