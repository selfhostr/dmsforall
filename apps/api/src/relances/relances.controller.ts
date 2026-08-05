import { Controller, Get, HttpCode, HttpStatus, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  schemaUpsertRegleRelance,
  type EntreeUpsertRegleRelance,
  type TypeRelance,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { CorpsZod } from '../common/documentation';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';

import { EnvoiRelancesDto, PlanificationRelancesDto, RegleRelanceDto } from './dto';
import { schemaTypeRelance } from './schemas';
import { ServiceRegleRelance } from './service-regle-relance';
import { ServiceRelancesFacture } from './service-relances-facture';

/**
 * Relances automatiques, LOT 1 (facturation, rappel #2 —
 * `docs/specification-relances-automatiques.md`).
 *
 * Droits POSÉS DÉFINITIVEMENT (`auth/matrice-droits.ts`) : `@ExigerDroit(...)` + `GardeDroit`
 * refuse `403 DROIT_INSUFFISANT` en `canActivate()` AVANT que le handler (donc les services de ce
 * module, donc tout accès base) ne s'exécute — un rôle non autorisé ne déclenche structurellement
 * aucune requête. Remplace le palliatif `@AucunDroitRequis()` + vérification de rôle en service
 * (`relances/droits-provisoires.ts`, retiré), posé faute d'accès de son auteur à
 * `auth/matrice-droits.ts` au moment de la livraison de ce module. UN SEUL jeu de rôles
 * (`direction`, `comptable`) gouverne les quatre routes ci-dessous — voir `matrice-droits.ts` pour
 * l'arbitrage (même LIRE la configuration des relances expose une politique de recouvrement).
 *
 * AUCUN ORDONNANCEUR : `POST .../planifier` et `POST .../envoyer` sont des opérations APPELABLES
 * à la demande — un futur déclencheur périodique (cron applicatif, job BullMQ répété) les
 * invoquera à intervalle régulier, voir le rapport de livraison de ce lot pour ce qui manque
 * côté infrastructure, y compris l'identité machine sous laquelle un tel déclencheur devrait
 * s'authentifier (aucun des deux rôles autorisés ci-dessus ne désigne un compte de service).
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
  @ExigerDroit('relances.facturation.regle.lire')
  @ApiOperation({
    summary: 'Configuration des relances par type (§5, §4 de la spec).',
  })
  @ApiOkResponse({ type: [RegleRelanceDto] })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (relances.facturation.regle.lire).')
  async lister(): Promise<readonly RegleRelanceDto[]> {
    const ctx = this.contexte.contexteTenant();
    return this.serviceRegle.lister(ctx);
  }

  @Put('regles/:typeRelance')
  @ExigerDroit('relances.facturation.regle.ecrire')
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
  @ApiReponseProbleme(403, 'Droit insuffisant (relances.facturation.regle.ecrire).')
  async upserter(
    @Param('typeRelance', new PipeZod(schemaTypeRelance)) typeRelance: TypeRelance,
    @CorpsZod(schemaUpsertRegleRelance) entree: EntreeUpsertRegleRelance,
  ): Promise<RegleRelanceDto> {
    const ctx = this.contexte.contexteTenant();
    return this.serviceRegle.upserter(ctx, typeRelance, entree);
  }

  @Post('facturation/planifier')
  @ExigerDroit('relances.facturation.planifier')
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
  @ApiReponseProbleme(403, 'Droit insuffisant (relances.facturation.planifier).')
  async planifier(): Promise<PlanificationRelancesDto> {
    const ctx = this.contexte.contexteTenant();
    return this.serviceFacture.planifier(ctx);
  }

  @Post('facturation/envoyer')
  @ExigerDroit('relances.facturation.envoyer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Envoie les rappels facture `prete` (un lot borné par appel), via le connecteur ' +
      'NotificationSender — sans connecteur actif, rend un lot vide (jamais une erreur).',
  })
  @ApiOkResponse({ type: EnvoiRelancesDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (relances.facturation.envoyer).')
  async envoyer(): Promise<EnvoiRelancesDto> {
    const ctx = this.contexte.contexteTenant();
    return this.serviceFacture.envoyerPretes(ctx);
  }
}
