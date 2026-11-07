import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  schemaCreationMotifRendezVous,
  schemaFiltresMotifsRendezVous,
  schemaIdentifiant,
  schemaModificationMotifRendezVous,
  type EntreeCreationMotifRendezVous,
  type EntreeModificationMotifRendezVous,
  type FiltresMotifsRendezVous,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { CorpsZod } from '../common/documentation';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';

import { ReponseMotifRendezVousDto } from './dto';
import { ServiceMotifsRendezVous } from './service-motifs-rendez-vous';
import { ExigerModule } from '../common/droits/garde-module';

/**
 * `GET|POST /motifs-rendez-vous`, `PATCH /motifs-rendez-vous/{id}` — catalogue paramétrable par
 * garage (RV-01/RV-02). Mêmes droits que les autres référentiels de paramétrage : lecture
 * `parametrage.referentiel.lire` (tout rôle authentifié), écriture `parametrage.referentiel.modifier`
 * (chef d'atelier, direction, admin) — comme `/referentiels/taux-horaires`. Pas de `DELETE` : on
 * désactive (`actif: false`), un motif cité par des rendez-vous ne disparaît jamais.
 */
@ApiTags('Rendez-vous')
@ApiCookieAuth()
@ExigerModule('planning')
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
  @ApiQuery({
    name: 'actifs',
    required: false,
    type: Boolean,
    description:
      '`true` : seulement les motifs proposables à la prise de rendez-vous ; `false` : seulement les inactifs ; absent : tous (comportement historique).',
  })
  @ApiOkResponse({ type: [ReponseMotifRendezVousDto] })
  @ApiReponseProbleme(400, 'Filtre invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  async lister(
    @Query(new PipeZod(schemaFiltresMotifsRendezVous)) filtres: FiltresMotifsRendezVous,
  ): Promise<readonly ReponseMotifRendezVousDto[]> {
    const ctx = this.contexte.contexteTenant();
    return this.service.lister(ctx, filtres);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('parametrage.referentiel.modifier')
  @ApiOperation({
    summary: 'Crée un motif de rendez-vous.',
    description:
      'Le `code` (majuscules, chiffres, `-`, `_`) est unique par garage et immuable. Un motif sans ' +
      'durée par défaut oblige à préciser la durée à chaque rendez-vous.',
  })
  @ApiCreatedResponse({ type: ReponseMotifRendezVousDto })
  @ApiReponseProbleme(400, 'VALIDATION_ECHOUEE — corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (parametrage.referentiel.modifier).')
  @ApiReponseProbleme(409, 'CONFLIT — un motif porte déjà ce code dans ce garage.')
  async creer(
    @CorpsZod(schemaCreationMotifRendezVous, {
      exemple: {
        code: 'CLIMATISATION',
        libelleFr: 'Climatisation',
        libelleDe: 'Klimaanlage',
        libelleIt: 'Climatizzazione',
        dureeDefautMinutes: 60,
      },
    })
    corps: EntreeCreationMotifRendezVous,
  ): Promise<ReponseMotifRendezVousDto> {
    return this.service.creer(this.contexte.contexteTenant(), corps);
  }

  @Patch(':id')
  @ExigerDroit('parametrage.referentiel.modifier')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Modifie ou désactive un motif de rendez-vous (jamais son code).',
    description:
      '`actif: false` retire le motif des nouvelles prises de rendez-vous ; les rendez-vous ' +
      "existants le gardent. Il n'existe pas de suppression.",
  })
  @ApiOkResponse({ type: ReponseMotifRendezVousDto })
  @ApiReponseProbleme(400, 'VALIDATION_ECHOUEE — corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (parametrage.referentiel.modifier).')
  @ApiReponseProbleme(404, 'RESSOURCE_INTROUVABLE — motif inconnu de ce garage.')
  async modifier(
    @Param('id', new PipeZod(schemaIdentifiant)) id: string,
    @CorpsZod(schemaModificationMotifRendezVous, {
      exemple: { dureeDefautMinutes: 90, actif: true },
    })
    corps: EntreeModificationMotifRendezVous,
  ): Promise<ReponseMotifRendezVousDto> {
    return this.service.modifier(this.contexte.contexteTenant(), id, corps);
  }
}
