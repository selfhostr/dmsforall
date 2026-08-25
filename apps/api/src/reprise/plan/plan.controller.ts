import { Controller, Get, Headers, Param, Patch, Post, Res, UseGuards } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  schemaIdentifiant,
  schemaModificationPlanReprise,
  schemaValidationPlanReprise,
  type EntreeModificationPlanReprise,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../../common/contexte';
import { CorpsZod } from '../../common/documentation';
import { ExigerDroit, GardeDroit } from '../../common/droits';
import { ApiReponseProbleme } from '../../common/erreurs';
import { PipeZod } from '../../common/validation';

import { ServicePlanReprise } from './service-plan-reprise';

const SCHEMA_REPONSE_PLAN = {
  description:
    'ReponsePlanReprise (contrats/reprise.ts) — listes JSONB non détaillées en Swagger, voir en-tête de dossier-reprise.dto.ts.',
  schema: { type: 'object' as const },
};

@ApiTags('Reprise de données')
@ApiCookieAuth()
@Controller({ path: 'reprise/dossiers', version: '1' })
@UseGuards(GardeDroit)
export class PlanRepriseController {
  constructor(
    private readonly service: ServicePlanReprise,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get(':dossierId/plan')
  @ExigerDroit('reprise.plan.lire')
  @ApiOperation({
    summary: 'Plan de reprise proposé — écran de validation unique (singleton par dossier).',
  })
  @ApiParam({ name: 'dossierId', format: 'uuid' })
  @ApiOkResponse(SCHEMA_REPONSE_PLAN)
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(404, 'Aucun plan pour ce dossier.')
  async lire(@Param('dossierId', new PipeZod(schemaIdentifiant)) dossierId: string) {
    const ctx = this.contexte.contexteTenant();
    return this.service.lire(ctx, dossierId);
  }

  @Patch(':dossierId/plan')
  @ExigerDroit('reprise.plan.modifier')
  @ApiOperation({
    summary:
      'Ajuste le plan — inclure/exclure des domaines EN BLOC (le seul levier, jamais un éditeur de mapping).',
  })
  @ApiParam({ name: 'dossierId', format: 'uuid' })
  @ApiOkResponse(SCHEMA_REPONSE_PLAN)
  @ApiReponseProbleme(400, 'REPRISE_AJUSTEMENT_ELEMENT_INCONNU ou corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(404, 'Aucun plan pour ce dossier.')
  @ApiReponseProbleme(409, 'REPRISE_PLAN_NON_VALIDABLE (plan déjà validé).')
  async ajuster(
    @Param('dossierId', new PipeZod(schemaIdentifiant)) dossierId: string,
    @CorpsZod(schemaModificationPlanReprise) entree: EntreeModificationPlanReprise,
  ) {
    const ctx = this.contexte.contexteTenant();
    return this.service.ajuster(ctx, dossierId, entree);
  }

  @Post(':dossierId/plan/valider')
  @ExigerDroit('reprise.plan.valider')
  @ApiOperation({
    summary: "Valide le plan — déclenche l'import dans le même geste.",
    description: '`Idempotency-Key` obligatoire : un rejeu ne doit jamais lancer un second import.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'uuid v4, identité de la requête.',
  })
  @ApiParam({ name: 'dossierId', format: 'uuid' })
  @ApiOkResponse(SCHEMA_REPONSE_PLAN)
  @ApiReponseProbleme(400, 'Idempotency-Key manquante/mal formée ou corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(404, 'Aucun plan pour ce dossier.')
  @ApiReponseProbleme(409, 'REPRISE_PLAN_NON_VALIDABLE ou IDEMPOTENCE_CONFLIT.')
  async valider(
    @Param('dossierId', new PipeZod(schemaIdentifiant)) dossierId: string,
    @CorpsZod(schemaValidationPlanReprise) _entree: unknown,
    @Headers('idempotency-key') cleIdempotence: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const ctx = this.contexte.contexteTenant();
    const resultat = await this.service.valider(ctx, dossierId, cleIdempotence ?? '');
    res.status(resultat.reponse.statutHttp);
    if (resultat.rejoue) res.setHeader('Idempotency-Rejeu', 'true');
    return resultat.reponse.corps;
  }
}
