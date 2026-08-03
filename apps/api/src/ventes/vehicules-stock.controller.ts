import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { schemaFiltresVehiculesStock, type FiltresVehiculesStock } from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';

import { PageVehiculeStockResumeDto } from './dto';
import { ServiceVehiculeStock } from './service-vehicule-stock';

/**
 * Collection paginée des véhicules en stock (RV-01→RV-14, priorité 4 du module) — distincte de
 * `GET /vehicules/{vehiculeId}/stock` (fiche singulière), même distinction collection/ressource
 * que partout ailleurs dans l'API. Rend `VehiculeStockResume` (projection légère, contrat littéral).
 */
@ApiTags('Véhicules en stock')
@ApiCookieAuth()
@Controller({ path: 'vehicules-stock', version: '1' })
@UseGuards(GardeDroit)
export class VehiculesStockController {
  constructor(
    private readonly service: ServiceVehiculeStock,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get()
  @ExigerDroit('ventes.vehicule_stock.lire')
  @ApiOperation({ summary: 'Liste paginée des véhicules en stock du tenant courant.' })
  @ApiOkResponse({ type: PageVehiculeStockResumeDto })
  @ApiReponseProbleme(400, 'Filtres, tri ou curseur invalides.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  async lister(@Query(new PipeZod(schemaFiltresVehiculesStock)) filtres: FiltresVehiculesStock): Promise<PageVehiculeStockResumeDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.lister(ctx, filtres);
  }
}
