import { Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { schemaIdentifiant } from '@dfa/shared';

import { ServiceContexteRequete } from '../../common/contexte';
import { ExigerDroit, GardeDroit } from '../../common/droits';
import { ApiReponseProbleme } from '../../common/erreurs';
import { PipeZod } from '../../common/validation';

import { ServiceImportReprise } from './service-import-reprise';

const SCHEMA_REPONSE_OBJET = { schema: { type: 'object' as const } };

@ApiTags('Reprise de données')
@ApiCookieAuth()
@Controller({ path: 'reprise/dossiers', version: '1' })
@UseGuards(GardeDroit)
export class ImportRepriseController {
  constructor(
    private readonly service: ServiceImportReprise,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get(':dossierId/import')
  @ExigerDroit('reprise.import.lire')
  @ApiOperation({ summary: "Avancement d'import (singleton par dossier)." })
  @ApiParam({ name: 'dossierId', format: 'uuid' })
  @ApiOkResponse(SCHEMA_REPONSE_OBJET)
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(404, 'Aucun import pour ce dossier.')
  async lire(@Param('dossierId', new PipeZod(schemaIdentifiant)) dossierId: string) {
    const ctx = this.contexte.contexteTenant();
    return this.service.lire(ctx, dossierId);
  }

  @Post(':dossierId/import/rejouer')
  @HttpCode(HttpStatus.ACCEPTED)
  @ExigerDroit('reprise.import.lancer')
  @ApiOperation({
    summary: "Reprise après import_echoue, SANS redépôt — idempotent via l'ancrage d'origine.",
  })
  @ApiParam({ name: 'dossierId', format: 'uuid' })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(404, 'Aucun import pour ce dossier.')
  @ApiReponseProbleme(409, 'REPRISE_DOSSIER_TRANSITION_INTERDITE (dossier pas en import_echoue).')
  async rejouer(
    @Param('dossierId', new PipeZod(schemaIdentifiant)) dossierId: string,
  ): Promise<void> {
    const ctx = this.contexte.contexteTenant();
    await this.service.rejouer(ctx, dossierId);
  }

  @Get(':dossierId/rapport')
  @ExigerDroit('reprise.import.lire')
  @ApiOperation({ summary: 'Rapport de réconciliation — lisible dès que import a démarré.' })
  @ApiParam({ name: 'dossierId', format: 'uuid' })
  @ApiOkResponse(SCHEMA_REPONSE_OBJET)
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(404, 'Aucun rapport pour ce dossier.')
  async rapport(@Param('dossierId', new PipeZod(schemaIdentifiant)) dossierId: string) {
    const ctx = this.contexte.contexteTenant();
    return this.service.lireRapport(ctx, dossierId);
  }
}
