/**
 * `GET|PATCH /parametres-entreprise/modules` — Réglages > Modules : le garage retire ce qu'il
 * n'utilise pas. Droits : ceux du paramétrage atelier (`parametrage.atelier.lire`/`.modifier`,
 * grille existante). Le socle (accueil, clients et véhicules, facturation, réglages) n'est pas
 * un module : il ne se retire pas.
 */
import { Controller, Get, Patch } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { schemaModificationModules, type EntreeModificationModules } from '@dfa/shared';

import { ServiceContexteRequete } from '../../common/contexte';
import { CorpsZod } from '../../common/documentation';
import { ExigerDroit } from '../../common/droits';
import { ApiReponseProbleme } from '../../common/erreurs';
import { ReponseModulesDto } from '../dto/reponse-modules.dto';
import { ServiceModules } from './service-modules';

@ApiTags('Paramétrage')
@ApiCookieAuth()
@Controller('parametres-entreprise/modules')
export class ModulesController {
  constructor(
    private readonly service: ServiceModules,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @ExigerDroit('parametrage.atelier.lire')
  @Get()
  @ApiOperation({
    summary: 'Modules retirés et modules actifs du garage.',
    description:
      '`modulesDesactives` : le choix du garage. `modulesActifs` : ce qui fonctionne réellement ' +
      '(pointage dépend de atelier, tablettes de pointage). Les mêmes `modulesActifs` sont dans `GET /auth/moi`.',
  })
  @ApiOkResponse({ type: ReponseModulesDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'DROIT_INSUFFISANT.')
  async obtenir(): Promise<ReponseModulesDto> {
    return this.service.obtenir(this.contexte.contexteTenant());
  }

  @ExigerDroit('parametrage.atelier.modifier')
  @Patch()
  @ApiOperation({
    summary: 'Remplace la liste des modules retirés par le garage.',
    description:
      '`modulesDesactives` est la liste COMPLÈTE des modules retirés (`[]` : tout est actif). Les ' +
      'écritures d’un module retiré, ou dont une dépendance est retirée, répondent ensuite ' +
      '`403 MODULE_DESACTIVE` ; les lectures restent possibles. Aucune donnée n’est supprimée : ' +
      'réactiver restaure tout. Le changement est journalisé (avant/après).',
  })
  @ApiOkResponse({ type: ReponseModulesDto })
  @ApiReponseProbleme(400, 'VALIDATION_ECHOUEE — module inconnu.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'DROIT_INSUFFISANT.')
  async modifier(
    @CorpsZod(schemaModificationModules, { exemple: { modulesDesactives: ['pneus', 'ventes'] } })
    corps: EntreeModificationModules,
  ): Promise<ReponseModulesDto> {
    return this.service.modifier(this.contexte.contexteTenant(), corps);
  }
}
