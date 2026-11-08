import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  schemaActionConfirmerFinancement,
  schemaActionRefuserFinancement,
  schemaCreationFinancement,
  schemaIdentifiant,
  type EntreeActionConfirmerFinancement,
  type EntreeActionRefuserFinancement,
  type EntreeCreationFinancement,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { CorpsZod } from '../common/documentation';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';

import { FinancementAvecAvertissementsDto } from './dto';
import { ServiceFinancement } from './service-financement';
import { ExigerModule } from '../common/droits/garde-module';

/**
 * Financement/leasing (RV-39→RV-45) — sous-ressource COLLECTION d'un dossier, APPEND-ONLY (CV-03).
 * Pas de `GET` dédié (ni fiche ni liste) : le contrat n'expose l'historique QU'embarqué dans
 * `ReponseDossierVente.financements`/`.financement` (doctrine « pas de pagination ici », voir
 * `contrats/ventes/financement.ts`) — aucune route à inventer au-delà de celles du contrat gelé.
 */
@ApiTags('Financement')
@ApiCookieAuth()
@ExigerModule('ventes')
@Controller({ path: 'dossiers-vente/:dossierVenteId/financements', version: '1' })
@UseGuards(GardeDroit)
export class FinancementController {
  constructor(
    private readonly service: ServiceFinancement,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('ventes.financement.creer')
  @ApiOperation({
    summary: 'Enregistre une tentative de financement/leasing.',
    description:
      '`Idempotency-Key` obligatoire. `statutConfirmation` initial DÉRIVÉ : `confirme` immédiat pour `comptant`, ' +
      '`en_attente` pour `credit`/`leasing` (organisme obligatoire dans ce cas).',
  })
  @ApiParam({ name: 'dossierVenteId', format: 'uuid' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'uuid v4, identité de la requête.',
  })
  @ApiResponse({ status: 201, type: FinancementAvecAvertissementsDto })
  @ApiReponseProbleme(
    400,
    'Corps invalide, organisme manquant pour credit/leasing (VALIDATION_ECHOUEE), ou Idempotency-Key manquante/mal formée.',
  )
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Dossier de vente ou organisme introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'IDEMPOTENCE_CONFLIT.')
  async creer(
    @Param('dossierVenteId', new PipeZod(schemaIdentifiant)) dossierVenteId: string,
    @CorpsZod(schemaCreationFinancement, { exemple: { type: 'comptant' } })
    entree: EntreeCreationFinancement,
    @Headers('idempotency-key') cleIdempotence: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    const resultat = await this.service.creer(
      ctx,
      principal,
      dossierVenteId,
      entree,
      cleIdempotence ?? '',
    );

    res.status(resultat.reponse.statutHttp);
    if (resultat.rejoue) res.setHeader('Idempotency-Rejeu', 'true');
    return resultat.reponse.corps;
  }

  @Post(':financementId/confirmer')
  @ExigerDroit('ventes.financement.confirmer')
  @ApiOperation({ summary: '`en_attente -> confirme`.' })
  @ApiParam({ name: 'dossierVenteId', format: 'uuid' })
  @ApiParam({ name: 'financementId', format: 'uuid' })
  @ApiOkResponse({ type: FinancementAvecAvertissementsDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Financement introuvable pour ce dossier de vente.')
  @ApiReponseProbleme(409, 'VENTE_FINANCEMENT_TRANSITION_INTERDITE.')
  async confirmer(
    @Param('dossierVenteId', new PipeZod(schemaIdentifiant)) dossierVenteId: string,
    @Param('financementId', new PipeZod(schemaIdentifiant)) financementId: string,
    @CorpsZod(schemaActionConfirmerFinancement, { exemple: {} })
    entree: EntreeActionConfirmerFinancement,
  ): Promise<FinancementAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.service.confirmer(ctx, role, dossierVenteId, financementId, entree);
  }

  @Post(':financementId/refuser')
  @ExigerDroit('ventes.financement.refuser')
  @ApiOperation({
    summary: '`en_attente -> refuse` — TERMINAL (CV-03), motif obligatoire.',
    description:
      "Un organisme qui change d'avis ouvre un NOUVEAU financement, il ne rouvre pas l'ancien.",
  })
  @ApiParam({ name: 'dossierVenteId', format: 'uuid' })
  @ApiParam({ name: 'financementId', format: 'uuid' })
  @ApiOkResponse({ type: FinancementAvecAvertissementsDto })
  @ApiReponseProbleme(400, 'Motif manquant.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Financement introuvable pour ce dossier de vente.')
  @ApiReponseProbleme(409, 'VENTE_FINANCEMENT_TRANSITION_INTERDITE.')
  async refuser(
    @Param('dossierVenteId', new PipeZod(schemaIdentifiant)) dossierVenteId: string,
    @Param('financementId', new PipeZod(schemaIdentifiant)) financementId: string,
    @CorpsZod(schemaActionRefuserFinancement, {
      exemple: { motif: "Dossier de crédit refusé par l'organisme." },
    })
    entree: EntreeActionRefuserFinancement,
  ): Promise<FinancementAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.service.refuser(ctx, role, dossierVenteId, financementId, entree);
  }
}
