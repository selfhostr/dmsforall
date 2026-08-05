import { Controller, Get, HttpCode, HttpStatus, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  schemaUpsertRegleRelance,
  type EntreeUpsertRegleRelance,
  type TypeRelance,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { CorpsZod } from '../common/documentation';
import { AucunDroitRequis, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';

import { EnvoiRelancesDto, PlanificationRelancesDto, RegleRelanceDto } from './dto';
import { schemaTypeRelance } from './schemas';
import { ServiceRegleRelance } from './service-regle-relance';
import { ServiceRelancesFacture } from './service-relances-facture';

/**
 * Relances automatiques, LOT 1 (facturation, rappel #2 —
 * `docs/specification-relances-automatiques.md`). Droits PROVISOIRES sur toutes les routes
 * (`@AucunDroitRequis()` + vérification en service, voir `droits-provisoires.ts`) :
 * `apps/api/src/auth/matrice-droits.ts` n'est pas dans le périmètre d'écriture de cet agent.
 *
 * AUCUN ORDONNANCEUR : `POST .../planifier` et `POST .../envoyer` sont des opérations APPELABLES
 * à la demande — un futur déclencheur périodique (cron applicatif, job BullMQ répété) les
 * invoquera à intervalle régulier, voir le rapport de livraison de ce lot pour ce qui manque
 * côté infrastructure.
 */
@ApiTags('Relances')
@ApiCookieAuth()
@Controller({ path: 'relances', version: '1' })
@UseGuards(GardeDroit)
export class RelancesController {
  constructor(
    private readonly serviceRegle: ServiceRegleRelance,
    private readonly serviceFacture: ServiceRelancesFacture,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get('regles')
  @AucunDroitRequis()
  @ApiOperation({
    summary:
      'Configuration des relances par type (§5, §4 de la spec). Rôle vérifié en service ' +
      '(relances.facturation.regle.lire, droit provisoire).',
  })
  @ApiOkResponse({ type: [RegleRelanceDto] })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Rôle non autorisé (contrôle provisoire en service).')
  async lister(): Promise<readonly RegleRelanceDto[]> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.serviceRegle.lister(ctx, role);
  }

  @Put('regles/:typeRelance')
  @AucunDroitRequis()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Upsert idempotent de la configuration d’un type de relance (une ligne par ' +
      '(tenant, type), §5).',
  })
  @ApiParam({ name: 'typeRelance', enum: schemaTypeRelance.options })
  @ApiOkResponse({ type: RegleRelanceDto })
  @ApiReponseProbleme(400, 'Type de relance ou corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Rôle non autorisé (contrôle provisoire en service).')
  async upserter(
    @Param('typeRelance', new PipeZod(schemaTypeRelance)) typeRelance: TypeRelance,
    @CorpsZod(schemaUpsertRegleRelance) entree: EntreeUpsertRegleRelance,
  ): Promise<RegleRelanceDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.serviceRegle.upserter(ctx, role, typeRelance, entree);
  }

  @Post('facturation/planifier')
  @AucunDroitRequis()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Calcule les paliers de rappel facture dus et les planifie (RA-05, idempotent — ' +
      'rejouable sans dommage, un lot borné par appel).',
    description:
      'Aucun ordonnanceur ne déclenche cette route automatiquement — voir le rapport de ' +
      'livraison pour ce qu’il faut pour l’appeler périodiquement.',
  })
  @ApiOkResponse({ type: PlanificationRelancesDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Rôle non autorisé (contrôle provisoire en service).')
  async planifier(): Promise<PlanificationRelancesDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.serviceFacture.planifier(ctx, role);
  }

  @Post('facturation/envoyer')
  @AucunDroitRequis()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Envoie les rappels facture `prete` (un lot borné par appel), via le connecteur ' +
      'NotificationSender — sans connecteur actif, rend un lot vide (jamais une erreur).',
  })
  @ApiOkResponse({ type: EnvoiRelancesDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Rôle non autorisé (contrôle provisoire en service).')
  async envoyer(): Promise<EnvoiRelancesDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.serviceFacture.envoyerPretes(ctx, role);
  }
}
