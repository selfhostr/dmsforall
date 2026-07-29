import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { schemaFiltresKilometrages, schemaIdentifiant, schemaKilometrageVehicule, type EntreeKilometrageVehicule } from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { CorpsZod } from '../common/documentation';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';
import { EnveloppeDto, ReponseVehiculeKilometrageDto } from './dto';
import type { FiltresKilometrages } from './schemas-locales';
import { ServiceVehiculeKilometrage } from './service-vehicule-kilometrage';

const EnveloppeKilometrageDto = EnveloppeDto(ReponseVehiculeKilometrageDto, 'Kilometrage');

@ApiTags('Véhicules')
@ApiCookieAuth()
@Controller({ path: 'vehicules/:vehiculeId/kilometrages', version: '1' })
@UseGuards(GardeDroit)
export class VehiculeKilometrageController {
  constructor(
    private readonly service: ServiceVehiculeKilometrage,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get()
  @ExigerDroit('vehicule.lire')
  @ApiOperation({ summary: 'Historique des relevés kilométriques (RM-23), append-only.' })
  @ApiParam({ name: 'vehiculeId', format: 'uuid' })
  @ApiOkResponse({ type: [ReponseVehiculeKilometrageDto] })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Véhicule introuvable pour ce tenant.')
  async lister(
    @Param('vehiculeId', new PipeZod(schemaIdentifiant)) vehiculeId: string,
    @Query(new PipeZod(schemaFiltresKilometrages)) filtres: FiltresKilometrages,
  ) {
    const ctx = this.contexte.contexteTenant();
    return this.service.lister(ctx, vehiculeId, filtres);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('vehicule.kilometrage.saisir')
  @ApiOperation({
    summary: 'Nouveau relevé kilométrique (RM-23/24/25).',
    description: 'Conversion mi→km faite par le serveur avant comparaison de régression (CT-08).',
  })
  @ApiParam({ name: 'vehiculeId', format: 'uuid' })
  @ApiResponse({ status: 201, type: EnveloppeKilometrageDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(
    403,
    "Droit insuffisant — ou, sur une saisie RÉGRESSIVE avec motif, rôle sans vehicule.kilometrage.corriger_regression (§10 L962, chef d'atelier/direction uniquement).",
  )
  @ApiReponseProbleme(404, 'Véhicule introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'VEHICULE_KILOMETRAGE_REGRESSIF (CT-07) — motifsAcceptes dans actionsProposees.')
  async creer(
    @Param('vehiculeId', new PipeZod(schemaIdentifiant)) vehiculeId: string,
    @CorpsZod(schemaKilometrageVehicule, {
      exemple: { valeur: 84200, unite: 'km', releveLe: '2026-07-15T08:30:00.000Z', source: 'reception' },
    })
    entree: EntreeKilometrageVehicule,
  ) {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    const { donnees, avertissements } = await this.service.creer(ctx, vehiculeId, entree, principal.role);
    return avertissements.envelopper(donnees);
  }
}
