import {
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
  schemaActionConfirmerReprise,
  schemaActionNegocierReprise,
  schemaActionRefuserReprise,
  schemaCreationReprise,
  schemaIdentifiant,
  schemaModificationReprise,
  type EntreeActionConfirmerReprise,
  type EntreeActionNegocierReprise,
  type EntreeActionRefuserReprise,
  type EntreeCreationReprise,
  type EntreeModificationReprise,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { CorpsZod } from '../common/documentation';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';

import { RepriseAvecAvertissementsDto, ReponseRepriseDto } from './dto';
import { ServiceReprise } from './service-reprise';

/**
 * La reprise (RV-19→RV-28, §6.3) — sous-ressource SINGULIÈRE d'un dossier de vente (0 ou 1), pas de
 * `POST /reprises` autonome (voir `contrats/ventes/reprise.ts`, tête de fichier).
 *
 * RAPPEL NON NÉGOCIABLE : `valeurEstimeeCentimes`/`valeurNegocieeCentimes` restent deux colonnes
 * distinctes. Aucune base TVA n'est calculée par ce module (RV-22/QV-05, non tranché).
 */
@ApiTags('Reprise')
@ApiCookieAuth()
@Controller({ path: 'dossiers-vente/:dossierVenteId/reprise', version: '1' })
@UseGuards(GardeDroit)
export class RepriseController {
  constructor(
    private readonly service: ServiceReprise,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('ventes.reprise.creer')
  @ApiOperation({
    summary: 'Création de la reprise (au plus une par dossier, RV-25).',
    description: '`Idempotency-Key` obligatoire. Statut initial toujours `estimee`.',
  })
  @ApiParam({ name: 'dossierVenteId', format: 'uuid' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'uuid v4, identité de la requête.',
  })
  @ApiResponse({ status: 201, type: RepriseAvecAvertissementsDto })
  @ApiReponseProbleme(400, 'Corps invalide ou Idempotency-Key manquante/mal formée.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Dossier de vente ou véhicule repris introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'VENTE_REPRISE_DEJA_EXISTANTE ou IDEMPOTENCE_CONFLIT.')
  async creer(
    @Param('dossierVenteId', new PipeZod(schemaIdentifiant)) dossierVenteId: string,
    @CorpsZod(schemaCreationReprise, {
      exemple: {
        vehiculeReprisId: '3a7d0f2b-9c4e-4f8b-0d3c-2b6e7f900123',
        valeurEstimeeCentimes: 800_000,
      },
    })
    entree: EntreeCreationReprise,
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

  @Get()
  @ExigerDroit('ventes.reprise.lire')
  @ApiOperation({ summary: 'Fiche complète de la reprise.' })
  @ApiParam({ name: 'dossierVenteId', format: 'uuid' })
  @ApiOkResponse({ type: ReponseRepriseDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Aucune reprise pour ce dossier de vente.')
  async obtenir(
    @Param('dossierVenteId', new PipeZod(schemaIdentifiant)) dossierVenteId: string,
  ): Promise<ReponseRepriseDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.service.obtenir(ctx, role, dossierVenteId);
  }

  @Patch()
  @ExigerDroit('ventes.reprise.modifier')
  @ApiOperation({
    summary: 'Modification de la reprise.',
    description:
      '`If-Match` obligatoire. `valeurEstimeeCentimes` modifiable UNIQUEMENT tant que `statut = estimee` (RV-27).',
  })
  @ApiParam({ name: 'dossierVenteId', format: 'uuid' })
  @ApiHeader({
    name: 'If-Match',
    required: true,
    description: 'W/"<version>" lu sur la dernière lecture (ETag).',
  })
  @ApiOkResponse({ type: RepriseAvecAvertissementsDto })
  @ApiReponseProbleme(400, 'Corps invalide ou If-Match manquant/mal formé.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Aucune reprise pour ce dossier de vente.')
  @ApiReponseProbleme(
    409,
    'CONFLIT (version périmée ou valeur estimée verrouillée au-delà de `estimee`).',
  )
  async modifier(
    @Param('dossierVenteId', new PipeZod(schemaIdentifiant)) dossierVenteId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @CorpsZod(schemaModificationReprise) entree: EntreeModificationReprise,
  ): Promise<RepriseAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.service.modifier(ctx, role, dossierVenteId, ifMatch, entree);
  }

  @Post('negocier')
  @ExigerDroit('ventes.reprise.negocier')
  @ApiOperation({
    summary: '`{estimee,negociee} -> negociee` — rejouable tant que non confirmée/refusée (RV-06).',
  })
  @ApiParam({ name: 'dossierVenteId', format: 'uuid' })
  @ApiOkResponse({ type: RepriseAvecAvertissementsDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Aucune reprise pour ce dossier de vente.')
  @ApiReponseProbleme(409, 'VENTE_REPRISE_TRANSITION_INTERDITE.')
  async negocier(
    @Param('dossierVenteId', new PipeZod(schemaIdentifiant)) dossierVenteId: string,
    @CorpsZod(schemaActionNegocierReprise, { exemple: { valeurNegocieeCentimes: 850_000 } })
    entree: EntreeActionNegocierReprise,
  ): Promise<RepriseAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.service.negocier(ctx, role, dossierVenteId, entree);
  }

  @Post('confirmer')
  @ExigerDroit('ventes.reprise.confirmer')
  @ApiOperation({
    summary: '`negociee -> confirmee` — NORMALEMENT un effet de bord de `POST .../engager`.',
    description: 'Appel direct réservé à la correction exceptionnelle, motif obligatoire.',
  })
  @ApiParam({ name: 'dossierVenteId', format: 'uuid' })
  @ApiOkResponse({ type: RepriseAvecAvertissementsDto })
  @ApiReponseProbleme(400, 'Motif manquant.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Aucune reprise pour ce dossier de vente.')
  @ApiReponseProbleme(
    409,
    'VENTE_REPRISE_TRANSITION_INTERDITE ou VENTE_REPRISE_VALEUR_NEGOCIEE_REQUISE.',
  )
  async confirmer(
    @Param('dossierVenteId', new PipeZod(schemaIdentifiant)) dossierVenteId: string,
    @CorpsZod(schemaActionConfirmerReprise, {
      exemple: { motif: 'Resynchronisation après incident, bon de commande déjà signé.' },
    })
    entree: EntreeActionConfirmerReprise,
  ): Promise<RepriseAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.service.confirmer(ctx, role, dossierVenteId, entree);
  }

  @Post('refuser')
  @ExigerDroit('ventes.reprise.refuser')
  @ApiOperation({
    summary:
      '`{estimee,negociee} -> refusee` — le client garde son véhicule, motif obligatoire (RV-25).',
  })
  @ApiParam({ name: 'dossierVenteId', format: 'uuid' })
  @ApiOkResponse({ type: RepriseAvecAvertissementsDto })
  @ApiReponseProbleme(400, 'Motif manquant.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Aucune reprise pour ce dossier de vente.')
  @ApiReponseProbleme(409, 'VENTE_REPRISE_TRANSITION_INTERDITE.')
  async refuser(
    @Param('dossierVenteId', new PipeZod(schemaIdentifiant)) dossierVenteId: string,
    @CorpsZod(schemaActionRefuserReprise, {
      exemple: { motif: 'Le client conserve finalement son véhicule.' },
    })
    entree: EntreeActionRefuserReprise,
  ): Promise<RepriseAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.service.refuser(ctx, role, dossierVenteId, entree);
  }
}
