import { Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  schemaChangementDetenteur,
  schemaClotureDetention,
  schemaDetentionVehicule,
  schemaIdentifiant,
  type EntreeChangementDetenteur,
  type EntreeDetentionVehicule,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { CorpsZod } from '../common/documentation';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';
import { EnveloppeDto, ReponseVehiculeDetentionDto, ReponseVehiculeDto } from './dto';
import type { EntreeClotureDetentionVehicule } from './schemas-locales';
import { ServiceVehiculeDetention } from './service-vehicule-detention';

const EnveloppeVehiculeDto = EnveloppeDto(ReponseVehiculeDto, 'VehiculeDetenteurChange');

@ApiTags('Véhicules')
@ApiCookieAuth()
@Controller({ path: 'vehicules/:vehiculeId', version: '1' })
@UseGuards(GardeDroit)
export class VehiculeDetentionController {
  constructor(
    private readonly service: ServiceVehiculeDetention,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get('detentions')
  @ExigerDroit('vehicule.lire')
  @ApiOperation({ summary: "Historique des détentions d'un véhicule (RM-20/21)." })
  @ApiParam({ name: 'vehiculeId', format: 'uuid' })
  @ApiOkResponse({ type: [ReponseVehiculeDetentionDto] })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Véhicule introuvable pour ce tenant.')
  async lister(@Param('vehiculeId', new PipeZod(schemaIdentifiant)) vehiculeId: string) {
    const ctx = this.contexte.contexteTenant();
    return this.service.lister(ctx, vehiculeId);
  }

  @Post('detentions')
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('vehicule.detention.corriger')
  @ApiOperation({ summary: 'Correction ou import de détention — le geste normal est `changer-detenteur`.' })
  @ApiParam({ name: 'vehiculeId', format: 'uuid' })
  @ApiResponse({ status: 201, type: ReponseVehiculeDetentionDto })
  @ApiReponseProbleme(400, 'Corps invalide ou deux détenteurs courants (VALIDATION_ECHOUEE).')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Véhicule introuvable pour ce tenant.')
  async creer(
    @Param('vehiculeId', new PipeZod(schemaIdentifiant)) vehiculeId: string,
    @CorpsZod(schemaDetentionVehicule, { exemple: { clientId: '3f9a1c2e-6b4d-4a1f-9c2e-8b7a6d5c4e3f', debutLe: '2024-05-01' } })
    entree: EntreeDetentionVehicule,
  ) {
    const ctx = this.contexte.contexteTenant();
    return this.service.creer(ctx, vehiculeId, entree);
  }

  @Post('detentions/:detentionId/cloturer')
  @ExigerDroit('vehicule.detention.corriger')
  @ApiOperation({ summary: 'Clôture manuelle de détention — correction/import.' })
  @ApiParam({ name: 'vehiculeId', format: 'uuid' })
  @ApiParam({ name: 'detentionId', format: 'uuid' })
  @ApiOkResponse({ type: ReponseVehiculeDetentionDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Détention introuvable.')
  @ApiReponseProbleme(409, 'Détention déjà clôturée.')
  async cloturer(
    @Param('vehiculeId', new PipeZod(schemaIdentifiant)) vehiculeId: string,
    @Param('detentionId', new PipeZod(schemaIdentifiant)) detentionId: string,
    @CorpsZod(schemaClotureDetention, { exemple: { finLe: '2026-06-30', motifFin: 'vente' } })
    entree: EntreeClotureDetentionVehicule,
  ) {
    const ctx = this.contexte.contexteTenant();
    return this.service.cloturer(ctx, vehiculeId, detentionId, entree);
  }

  @Post('changer-detenteur')
  @ExigerDroit('vehicule.detention.changer')
  @ApiOperation({
    summary: 'Changement de détenteur ATOMIQUE (RM-20/21, CT-47).',
    description:
      'Clôture de la détention en cours, ouverture de la nouvelle, et plaque éventuelle — dans ' +
      'une seule transaction. Le geste normal, préféré à `POST /detentions` + `/cloturer`.',
  })
  @ApiParam({ name: 'vehiculeId', format: 'uuid' })
  @ApiOkResponse({ type: EnveloppeVehiculeDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Véhicule introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'VALIDATION_ECHOUEE (deux détenteurs courants) ou VEHICULE_PLAQUE_COLLISION.')
  async changerDetenteur(
    @Param('vehiculeId', new PipeZod(schemaIdentifiant)) vehiculeId: string,
    @CorpsZod(schemaChangementDetenteur, {
      exemple: {
        nouveauClientId: '3f9a1c2e-6b4d-4a1f-9c2e-8b7a6d5c4e3f',
        changementLe: '2026-07-15',
        motifFin: 'vente',
        nouvellePlaque: { valeur: 'VD 654321', canton: 'VD', pays: 'CH', interchangeable: false, professionnelle: false },
      },
    })
    entree: EntreeChangementDetenteur,
  ) {
    const ctx = this.contexte.contexteTenant();
    const { donnees, avertissements } = await this.service.changerDetenteur(ctx, vehiculeId, entree);
    return avertissements.envelopper(donnees);
  }
}
