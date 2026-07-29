/**
 * `GET|POST /referentiels/taux-horaires` · `PATCH /{id}` (contrats-api-etape-1.md §7.12, RM-65).
 */
import { ApiCookieAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import {
  schemaCreationTauxHoraire,
  schemaIdentifiant,
  schemaModificationTauxHoraire,
  schemaParametresPage,
  type EntreeCreationTauxHoraire,
  type ParametresPage,
} from '@dfa/shared';

import { ApiReponseProbleme } from '../../../common/erreurs';
import { ServiceContexteRequete } from '../../../common/contexte';
import { CorpsZod } from '../../../common/documentation';
import { ExigerDroit } from '../../../common/droits';
import { PipeZod } from '../../../common/validation';
import { PageTauxHoraireDto, ReponseTauxHoraireDto } from '../../dto/reponse-taux-horaire.dto';
import { ServiceTauxHoraires, type EntreeModificationTauxHoraire } from './service-taux-horaires';

@ApiTags('Paramétrage')
@ApiCookieAuth()
@Controller('referentiels/taux-horaires')
export class TauxHorairesController {
  constructor(
    private readonly service: ServiceTauxHoraires,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @ExigerDroit('parametrage.referentiel.lire')
  @Get()
  @ApiOperation({ summary: 'Liste des taux horaires (datés, RM-65). Pagination par curseur.' })
  @ApiQuery({ name: 'limite', required: false, type: Number })
  @ApiQuery({ name: 'curseur', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Page de taux horaires.', type: PageTauxHoraireDto })
  async lister(
    @Query(new PipeZod(schemaParametresPage)) page: ParametresPage,
  ): Promise<PageTauxHoraireDto> {
    return this.service.lister(this.contexte.contexteTenant(), page.limite, page.curseur);
  }

  @ExigerDroit('parametrage.referentiel.modifier')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Crée une période de taux horaire.',
    description:
      'Deux périodes valides du même code ne peuvent jamais se chevaucher pour un tenant ' +
      '(contrainte EXCLUDE en base) — une tentative de chevauchement renvoie `409 CONFLIT`.',
  })
  @ApiResponse({ status: 201, description: 'Taux horaire créé.', type: ReponseTauxHoraireDto })
  @ApiReponseProbleme(400, 'VALIDATION_ECHOUEE — corps invalide.')
  @ApiReponseProbleme(409, 'CONFLIT — période chevauchant une période valide existante du même code.')
  async creer(
    @CorpsZod(schemaCreationTauxHoraire, {
      exemple: { code: 'MECANIQUE', libelle: 'Taux horaire mécanique', montantCentimes: 14500, valideDuLe: '2026-01-01' },
    })
    corps: EntreeCreationTauxHoraire,
  ): Promise<ReponseTauxHoraireDto> {
    return this.service.creer(this.contexte.contexteTenant(), corps);
  }

  @ExigerDroit('parametrage.referentiel.modifier')
  @Patch(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Modifie partiellement une période de taux horaire (jamais son `code`).' })
  @ApiResponse({ status: 200, description: 'Taux horaire mis à jour.', type: ReponseTauxHoraireDto })
  @ApiReponseProbleme(400, 'VALIDATION_ECHOUEE — corps invalide.')
  @ApiReponseProbleme(404, 'RESSOURCE_INTROUVABLE — taux horaire inconnu de ce tenant.')
  @ApiReponseProbleme(409, 'CONFLIT — nouvelle période chevauchant une période valide existante du même code.')
  async modifier(
    @Param('id', new PipeZod(schemaIdentifiant)) id: string,
    @CorpsZod(schemaModificationTauxHoraire, { exemple: { montantCentimes: 15000, valideAuLe: '2026-12-31' } })
    corps: EntreeModificationTauxHoraire,
  ): Promise<ReponseTauxHoraireDto> {
    return this.service.modifier(this.contexte.contexteTenant(), id, corps);
  }
}
