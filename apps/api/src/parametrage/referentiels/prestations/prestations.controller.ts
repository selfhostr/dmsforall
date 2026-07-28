/**
 * `GET|POST /referentiels/prestations` · `PATCH /{id}` (contrats-api-etape-1.md §7.12, spec §7.9).
 * Prix historisés : `prixCentimes` en écriture ouvre/ferme une période de `prestation_prix` datée
 * à aujourd'hui — voir `service-prestations.ts`.
 */
import { ApiCookieAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import {
  schemaCreationPrestation,
  schemaIdentifiant,
  schemaModificationPrestation,
  schemaParametresPage,
  type EntreeCreationPrestation,
  type ParametresPage,
} from '@dfa/shared';

import { ApiReponseProbleme } from '../../../common/erreurs';
import { ServiceContexteRequete } from '../../../common/contexte';
import { ExigerDroit } from '../../../common/droits';
import { PipeZod } from '../../../common/validation';
import { PagePrestationDto, ReponsePrestationDto } from '../../dto/reponse-prestation.dto';
import { ServicePrestations, type EntreeModificationPrestation } from './service-prestations';

@ApiTags('Paramétrage')
@ApiCookieAuth()
@Controller('referentiels/prestations')
export class PrestationsController {
  constructor(
    private readonly service: ServicePrestations,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @ExigerDroit('parametrage.referentiel.lire')
  @Get()
  @ApiOperation({ summary: 'Catalogue de prestations, avec prix courant. Pagination par curseur.' })
  @ApiQuery({ name: 'limite', required: false, type: Number })
  @ApiQuery({ name: 'curseur', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Page de prestations.', type: PagePrestationDto })
  async lister(@Query(new PipeZod(schemaParametresPage)) page: ParametresPage): Promise<PagePrestationDto> {
    return this.service.lister(this.contexte.contexteTenant(), page.limite, page.curseur);
  }

  @ExigerDroit('parametrage.referentiel.modifier')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Crée une prestation du catalogue.',
    description: 'Si `prixCentimes` est fourni, ouvre immédiatement une période de prix valide à partir d\'aujourd\'hui.',
  })
  @ApiResponse({ status: 201, description: 'Prestation créée.', type: ReponsePrestationDto })
  @ApiReponseProbleme(400, 'VALIDATION_ECHOUEE — corps invalide.')
  @ApiReponseProbleme(409, 'CONFLIT — code de prestation déjà utilisé par ce tenant.')
  async creer(@Body(new PipeZod(schemaCreationPrestation)) corps: EntreeCreationPrestation): Promise<ReponsePrestationDto> {
    return this.service.creer(this.contexte.contexteTenant(), corps);
  }

  @ExigerDroit('parametrage.referentiel.modifier')
  @Patch(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Modifie une prestation (jamais son `code`).',
    description:
      'Changer `prixCentimes` clôture le prix couramment ouvert (`valide_au` = aujourd\'hui) et en ' +
      'ouvre un nouveau daté à aujourd\'hui — l\'historique des prix passés n\'est jamais réécrit ' +
      '(RM-65, prix figés sur les lignes d\'OR existantes).',
  })
  @ApiResponse({ status: 200, description: 'Prestation mise à jour.', type: ReponsePrestationDto })
  @ApiReponseProbleme(400, 'VALIDATION_ECHOUEE — corps invalide.')
  @ApiReponseProbleme(404, 'RESSOURCE_INTROUVABLE — prestation inconnue de ce tenant.')
  async modifier(
    @Param('id', new PipeZod(schemaIdentifiant)) id: string,
    @Body(new PipeZod(schemaModificationPrestation)) corps: EntreeModificationPrestation,
  ): Promise<ReponsePrestationDto> {
    return this.service.modifier(this.contexte.contexteTenant(), id, corps);
  }
}
