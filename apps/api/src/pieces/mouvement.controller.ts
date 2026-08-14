import {
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
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
  schemaApercuForcageMouvement,
  schemaCreationAjustementInventaire,
  schemaCreationMouvementCasse,
  schemaCreationMouvementPerte,
  schemaCreationMouvementRetourClient,
  schemaCreationMouvementSortieComptoir,
  schemaCreationMouvementTransfert,
  schemaCreationRetourFournisseur,
  type EntreeApercuForcageMouvement,
  type EntreeCreationAjustementInventaire,
  type EntreeCreationMouvementCasse,
  type EntreeCreationMouvementPerte,
  type EntreeCreationMouvementRetourClient,
  type EntreeCreationMouvementSortieComptoir,
  type EntreeCreationMouvementTransfert,
  type EntreeCreationRetourFournisseur,
  type FiltresMouvementsStock,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { CorpsZod } from '../common/documentation';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';

import {
  ApercuForcageMouvementDto,
  MouvementAvecAvertissementsDto,
  MouvementStockDto,
  PageMouvementStockDto,
} from './dto';
import { schemaFiltresMouvementsStock, schemaUuid } from './schemas';
import { ServiceMouvement } from './service-mouvement';

/**
 * Mouvements de stock (RP-16 → RP-18) : historique + les cinq actions à déclenchement direct.
 * `mouvement_stock` est IMMUABLE — aucun `PATCH`/`DELETE` dans ce contrôleur, jamais.
 */
@ApiTags('Pièces — Mouvements de stock')
@ApiCookieAuth()
@Controller({ path: 'articles', version: '1' })
@UseGuards(GardeDroit)
export class MouvementController {
  constructor(
    private readonly service: ServiceMouvement,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get(':articleId/mouvements')
  @ExigerDroit('pieces.stock.lire')
  @ApiOperation({ summary: 'Historique des mouvements de stock d’un article.' })
  @ApiParam({ name: 'articleId', format: 'uuid' })
  @ApiOkResponse({ type: PageMouvementStockDto })
  @ApiReponseProbleme(400, 'Filtres, tri ou curseur invalides.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Article introuvable pour ce tenant.')
  async lister(
    @Param('articleId', new PipeZod(schemaUuid)) articleId: string,
    @Query(new PipeZod(schemaFiltresMouvementsStock)) query: FiltresMouvementsStock,
  ): Promise<PageMouvementStockDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.service.lister(ctx, role, articleId, query);
  }

  @Get(':articleId/mouvements/apercu-forcage')
  @ExigerDroit('pieces.mouvement.forcer')
  @ApiOperation({
    summary:
      "Aperçu, en lecture seule, des réservations qu'un forçage (`casse`/`perte`, `forcer: true`) " +
      'libérerait s’il était soumis maintenant — à interroger AVANT de cocher « Forcer » ' +
      '(RP-15 : avertissement spécifique et chiffré). Réservé à qui détient déjà le droit de ' +
      'forcer : `[]` si le forçage ne libérerait rien (stock déjà suffisant, ou aucune réservation ' +
      'active).',
  })
  @ApiParam({ name: 'articleId', format: 'uuid' })
  @ApiOkResponse({ type: ApercuForcageMouvementDto })
  @ApiReponseProbleme(400, 'Filtres invalides.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Article ou site introuvable pour ce tenant.')
  async apercuForcage(
    @Param('articleId', new PipeZod(schemaUuid)) articleId: string,
    @Query(new PipeZod(schemaApercuForcageMouvement)) query: EntreeApercuForcageMouvement,
  ): Promise<ApercuForcageMouvementDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.apercuForcage(ctx, articleId, query);
  }

  @Post(':articleId/mouvements/casse')
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('pieces.mouvement.creer')
  @ApiOperation({ summary: 'Enregistre une casse (RP-17). `Idempotency-Key` obligatoire.' })
  @ApiParam({ name: 'articleId', format: 'uuid' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiResponse({ status: 201, type: MouvementStockDto })
  @ApiReponseProbleme(400, 'Corps invalide ou Idempotency-Key manquante/mal formée.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Article ou site introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'STOCK_INSUFFISANT (sans `forcer: true`), ou IDEMPOTENCE_CONFLIT.')
  async casse(
    @Param('articleId', new PipeZod(schemaUuid)) articleId: string,
    @CorpsZod(schemaCreationMouvementCasse) entree: EntreeCreationMouvementCasse,
    @Headers('idempotency-key') cleIdempotence: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    const resultat = await this.service.casse(ctx, role, articleId, entree, cleIdempotence ?? '');
    res.status(resultat.reponse.statutHttp);
    if (resultat.rejoue) res.setHeader('Idempotency-Rejeu', 'true');
    return resultat.reponse.corps;
  }

  @Post(':articleId/mouvements/perte')
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('pieces.mouvement.creer')
  @ApiOperation({ summary: 'Enregistre une perte (RP-17). `Idempotency-Key` obligatoire.' })
  @ApiParam({ name: 'articleId', format: 'uuid' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiResponse({ status: 201, type: MouvementStockDto })
  @ApiReponseProbleme(400, 'Corps invalide ou Idempotency-Key manquante/mal formée.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Article ou site introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'STOCK_INSUFFISANT (sans `forcer: true`), ou IDEMPOTENCE_CONFLIT.')
  async perte(
    @Param('articleId', new PipeZod(schemaUuid)) articleId: string,
    @CorpsZod(schemaCreationMouvementPerte) entree: EntreeCreationMouvementPerte,
    @Headers('idempotency-key') cleIdempotence: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    const resultat = await this.service.perte(ctx, role, articleId, entree, cleIdempotence ?? '');
    res.status(resultat.reponse.statutHttp);
    if (resultat.rejoue) res.setHeader('Idempotency-Rejeu', 'true');
    return resultat.reponse.corps;
  }

  @Post(':articleId/mouvements/transfert')
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('pieces.mouvement.creer')
  @ApiOperation({
    summary:
      'Transfère une quantité entre deux sites — un mouvement unique (RP-13). `Idempotency-Key` obligatoire.',
  })
  @ApiParam({ name: 'articleId', format: 'uuid' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiResponse({ status: 201, type: MouvementStockDto })
  @ApiReponseProbleme(400, 'Corps invalide ou Idempotency-Key manquante/mal formée.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Article ou site introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'STOCK_INSUFFISANT au site source, ou IDEMPOTENCE_CONFLIT.')
  async transfert(
    @Param('articleId', new PipeZod(schemaUuid)) articleId: string,
    @CorpsZod(schemaCreationMouvementTransfert) entree: EntreeCreationMouvementTransfert,
    @Headers('idempotency-key') cleIdempotence: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    const resultat = await this.service.transfert(
      ctx,
      role,
      articleId,
      entree,
      cleIdempotence ?? '',
    );
    res.status(resultat.reponse.statutHttp);
    if (resultat.rejoue) res.setHeader('Idempotency-Rejeu', 'true');
    return resultat.reponse.corps;
  }

  @Post(':articleId/mouvements/ajustement-inventaire')
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('pieces.mouvement.creer')
  @ApiOperation({
    summary:
      'Ajuste le stock physique à la quantité COMPTÉE (§7.6). `Idempotency-Key` obligatoire. ' +
      'Aucun mouvement créé si le compte correspond déjà au stock physique — `donnees: null`.',
  })
  @ApiParam({ name: 'articleId', format: 'uuid' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiResponse({ status: 201, type: MouvementAvecAvertissementsDto })
  @ApiReponseProbleme(400, 'Corps invalide ou Idempotency-Key manquante/mal formée.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Article ou site introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'IDEMPOTENCE_CONFLIT.')
  async ajustementInventaire(
    @Param('articleId', new PipeZod(schemaUuid)) articleId: string,
    @CorpsZod(schemaCreationAjustementInventaire) entree: EntreeCreationAjustementInventaire,
    @Headers('idempotency-key') cleIdempotence: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    const resultat = await this.service.ajustementInventaire(
      ctx,
      role,
      articleId,
      entree,
      cleIdempotence ?? '',
    );
    res.status(resultat.reponse.statutHttp);
    if (resultat.rejoue) res.setHeader('Idempotency-Rejeu', 'true');
    return resultat.reponse.corps;
  }

  @Post(':articleId/mouvements/retour-fournisseur')
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('pieces.mouvement.creer')
  @ApiOperation({
    summary: 'Enregistre un retour au fournisseur (RP-30). `Idempotency-Key` obligatoire.',
  })
  @ApiParam({ name: 'articleId', format: 'uuid' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiResponse({ status: 201, type: MouvementStockDto })
  @ApiReponseProbleme(400, 'Corps invalide ou Idempotency-Key manquante/mal formée.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Article ou site introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'STOCK_INSUFFISANT, ou IDEMPOTENCE_CONFLIT.')
  async retourFournisseur(
    @Param('articleId', new PipeZod(schemaUuid)) articleId: string,
    @CorpsZod(schemaCreationRetourFournisseur) entree: EntreeCreationRetourFournisseur,
    @Headers('idempotency-key') cleIdempotence: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    const resultat = await this.service.retourFournisseur(
      ctx,
      role,
      articleId,
      entree,
      cleIdempotence ?? '',
    );
    res.status(resultat.reponse.statutHttp);
    if (resultat.rejoue) res.setHeader('Idempotency-Rejeu', 'true');
    return resultat.reponse.corps;
  }

  @Post(':articleId/mouvements/sortie-comptoir')
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('pieces.mouvement.creer')
  @ApiOperation({
    summary:
      'Vente directe au comptoir, sans OR ni document de vente. `Idempotency-Key` obligatoire. ' +
      'Aucun lien vers une facture n’est posé par cette route (voir `mouvement.ts`, note d’intégration).',
  })
  @ApiParam({ name: 'articleId', format: 'uuid' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiResponse({ status: 201, type: MouvementStockDto })
  @ApiReponseProbleme(400, 'Corps invalide ou Idempotency-Key manquante/mal formée.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Article ou site introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'STOCK_INSUFFISANT, ou IDEMPOTENCE_CONFLIT.')
  async sortieComptoir(
    @Param('articleId', new PipeZod(schemaUuid)) articleId: string,
    @CorpsZod(schemaCreationMouvementSortieComptoir) entree: EntreeCreationMouvementSortieComptoir,
    @Headers('idempotency-key') cleIdempotence: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    const resultat = await this.service.sortieComptoir(
      ctx,
      role,
      articleId,
      entree,
      cleIdempotence ?? '',
    );
    res.status(resultat.reponse.statutHttp);
    if (resultat.rejoue) res.setHeader('Idempotency-Rejeu', 'true');
    return resultat.reponse.corps;
  }

  @Post(':articleId/mouvements/retour-client')
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('pieces.mouvement.creer')
  @ApiOperation({
    summary:
      'Le client rapporte une pièce : remet la quantité en stock physique du site. ' +
      '`Idempotency-Key` obligatoire.',
  })
  @ApiParam({ name: 'articleId', format: 'uuid' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiResponse({ status: 201, type: MouvementStockDto })
  @ApiReponseProbleme(400, 'Corps invalide ou Idempotency-Key manquante/mal formée.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Article ou site introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'IDEMPOTENCE_CONFLIT.')
  async retourClient(
    @Param('articleId', new PipeZod(schemaUuid)) articleId: string,
    @CorpsZod(schemaCreationMouvementRetourClient) entree: EntreeCreationMouvementRetourClient,
    @Headers('idempotency-key') cleIdempotence: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    const resultat = await this.service.retourClient(
      ctx,
      role,
      articleId,
      entree,
      cleIdempotence ?? '',
    );
    res.status(resultat.reponse.statutHttp);
    if (resultat.rejoue) res.setHeader('Idempotency-Rejeu', 'true');
    return resultat.reponse.corps;
  }
}
