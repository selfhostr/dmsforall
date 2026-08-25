import { Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { schemaIdentifiant } from '@dfa/shared';

import { ServiceContexteRequete } from '../../common/contexte';
import { ExigerDroit, GardeDroit } from '../../common/droits';
import { ApiReponseProbleme } from '../../common/erreurs';
import { PipeZod } from '../../common/validation';

import { ServiceAnalyseReprise } from './service-analyse-reprise';

@ApiTags('Reprise de données')
@ApiCookieAuth()
@Controller({ path: 'reprise/dossiers', version: '1' })
@UseGuards(GardeDroit)
export class AnalyseRepriseController {
  constructor(
    private readonly service: ServiceAnalyseReprise,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Post(':dossierId/analyses')
  @HttpCode(HttpStatus.ACCEPTED)
  @ExigerDroit('reprise.analyse.lancer')
  @ApiOperation({
    summary:
      "Lance ou relance l'analyse asynchrone — autorisé depuis depot_receptionne ou analyse_echouee.",
  })
  @ApiParam({ name: 'dossierId', format: 'uuid' })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(404, 'Dossier introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'REPRISE_DOSSIER_TRANSITION_INTERDITE.')
  async lancer(
    @Param('dossierId', new PipeZod(schemaIdentifiant)) dossierId: string,
  ): Promise<void> {
    const ctx = this.contexte.contexteTenant();
    await this.service.lancer(ctx, dossierId);
  }

  @Get(':dossierId/analyse')
  @ExigerDroit('reprise.analyse.lire')
  @ApiOperation({ summary: "Résultat courant de l'analyse (singleton par dossier)." })
  @ApiParam({ name: 'dossierId', format: 'uuid' })
  @ApiOkResponse({
    description:
      'ReponseAnalyseReprise (contrats/reprise.ts) — voir en-tête de fichier pour la simplification Swagger sur les listes JSONB.',
    schema: { type: 'object' },
  })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(404, 'Aucune analyse pour ce dossier.')
  async lire(@Param('dossierId', new PipeZod(schemaIdentifiant)) dossierId: string) {
    const ctx = this.contexte.contexteTenant();
    return this.service.lire(ctx, dossierId);
  }
}
