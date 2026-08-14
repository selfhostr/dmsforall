import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  schemaLiberationReservation,
  type EntreeLiberationReservation,
  type FiltresReservations,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { CorpsZod } from '../common/documentation';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';

import {
  PageReservationPieceDto,
  ReservationPieceAvecAvertissementsDto,
  ReservationPieceDto,
} from './dto';
import { schemaFiltresReservations, schemaUuid } from './schemas';
import { ServiceReservation } from './service-reservation';

/**
 * Réservations de pièces (RP-19 → RP-25, §6.3) — LE cœur du sujet, priorité 4. Pas de `POST`
 * racine ici : une réservation naît toujours comme effet de bord de `POST
 * /ordres-reparation/{orId}/lignes` (`atelier/`, gelé, hors périmètre).
 */
@ApiTags('Pièces — Réservations')
@ApiCookieAuth()
@Controller({ path: 'reservations', version: '1' })
@UseGuards(GardeDroit)
export class ReservationController {
  constructor(
    private readonly service: ServiceReservation,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get()
  @ExigerDroit('pieces.reservation.lire')
  @ApiOperation({ summary: 'Vue transverse : qu’est-ce qui est réservé, pour qui, depuis quand.' })
  @ApiOkResponse({ type: PageReservationPieceDto })
  @ApiReponseProbleme(400, 'Filtres, tri ou curseur invalides.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  async lister(
    @Query(new PipeZod(schemaFiltresReservations)) query: FiltresReservations,
  ): Promise<PageReservationPieceDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.lister(ctx, query);
  }

  @Post(':id/satisfaire')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('pieces.reservation.satisfaire')
  @ApiOperation({
    summary: 'Le magasinier remet physiquement la pièce (RP-21) — génère le mouvement sortie_or.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ReservationPieceDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Réservation introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'RESERVATION_TRANSITION_INTERDITE — la réservation n’est plus active.')
  async satisfaire(@Param('id', new PipeZod(schemaUuid)) id: string): Promise<ReservationPieceDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.satisfaire(ctx, id);
  }

  @Post(':id/liberer')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('pieces.reservation.liberer')
  @ApiOperation({
    summary:
      'Geste explicite du magasinier ou du chef d’atelier (RP-23, 3e cas) : libère la réservation sans mouvement.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ReservationPieceAvecAvertissementsDto })
  @ApiReponseProbleme(400, 'Motif manquant ou trop court.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Réservation introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'RESERVATION_TRANSITION_INTERDITE — la réservation n’est plus active.')
  async liberer(
    @Param('id', new PipeZod(schemaUuid)) id: string,
    @CorpsZod(schemaLiberationReservation) entree: EntreeLiberationReservation,
  ): Promise<ReservationPieceAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.liberer(ctx, id, entree);
  }
}
