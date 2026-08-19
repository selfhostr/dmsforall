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
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  schemaCreationFournisseur,
  schemaModificationFournisseur,
  type EntreeCreationFournisseur,
  type EntreeModificationFournisseur,
  type FiltresFournisseurs,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { CorpsZod } from '../common/documentation';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';

import { FournisseurAvecAvertissementsDto, FournisseurDto, PageFournisseurDto } from './dto';
import { schemaFiltresFournisseurs, schemaUuid } from './schemas';
import { ServiceFournisseur } from './service-fournisseur';

/**
 * Référentiel fournisseur (RP-26, §1) : minimal — nom, coordonnées, délai habituel. Pas de
 * `DELETE` : un fournisseur se désactive, jamais ne se supprime (RP-07/RM-12/RM-31).
 */
@ApiTags('Pièces — Fournisseurs')
@ApiCookieAuth()
@Controller({ path: 'fournisseurs', version: '1' })
@UseGuards(GardeDroit)
export class FournisseurController {
  constructor(
    private readonly service: ServiceFournisseur,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get()
  @ExigerDroit('pieces.fournisseur.lire')
  @ApiOperation({ summary: 'Liste paginée des fournisseurs du tenant courant.' })
  @ApiOkResponse({ type: PageFournisseurDto })
  @ApiReponseProbleme(400, 'Filtres, tri ou curseur invalides.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  async lister(
    @Query(new PipeZod(schemaFiltresFournisseurs)) query: FiltresFournisseurs,
  ): Promise<PageFournisseurDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.lister(ctx, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('pieces.fournisseur.creer')
  @ApiOperation({
    summary: "Création d'un fournisseur. Pas d'Idempotency-Key (aucune numérotation serveur).",
  })
  @ApiResponse({ status: 201, type: FournisseurAvecAvertissementsDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  async creer(
    @CorpsZod(schemaCreationFournisseur) entree: EntreeCreationFournisseur,
  ): Promise<FournisseurAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.creer(ctx, entree);
  }

  @Get(':id')
  @ExigerDroit('pieces.fournisseur.lire')
  @ApiOperation({ summary: "Fiche d'un fournisseur." })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: FournisseurDto })
  @ApiReponseProbleme(400, 'Identifiant mal formé.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Fournisseur introuvable pour ce tenant.')
  async parId(@Param('id', new PipeZod(schemaUuid)) id: string): Promise<FournisseurDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.parId(ctx, id);
  }

  @Patch(':id')
  @ExigerDroit('pieces.fournisseur.modifier')
  @ApiOperation({ summary: "Modification partielle d'un fournisseur." })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: FournisseurAvecAvertissementsDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Fournisseur introuvable pour ce tenant.')
  async modifier(
    @Param('id', new PipeZod(schemaUuid)) id: string,
    @CorpsZod(schemaModificationFournisseur) entree: EntreeModificationFournisseur,
  ): Promise<FournisseurAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.modifier(ctx, id, entree);
  }

  @Post(':id/desactiver')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('pieces.fournisseur.modifier')
  @ApiOperation({ summary: 'Désactive un fournisseur (RP-07/RM-12/RM-31) — pas de suppression.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: FournisseurAvecAvertissementsDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Fournisseur introuvable pour ce tenant.')
  async desactiver(
    @Param('id', new PipeZod(schemaUuid)) id: string,
  ): Promise<FournisseurAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.desactiver(ctx, id);
  }

  @Post(':id/reactiver')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('pieces.fournisseur.modifier')
  @ApiOperation({ summary: 'Réactive un fournisseur (retour à `actif`).' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: FournisseurAvecAvertissementsDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Fournisseur introuvable pour ce tenant.')
  async reactiver(
    @Param('id', new PipeZod(schemaUuid)) id: string,
  ): Promise<FournisseurAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.reactiver(ctx, id);
  }
}
