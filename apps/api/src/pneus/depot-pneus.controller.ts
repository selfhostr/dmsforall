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
  schemaChangementSaisonDepotPneus,
  schemaCreationDepotPneus,
  schemaSortieDepotPneus,
  type EntreeChangementSaisonDepotPneus,
  type EntreeCreationDepotPneus,
  type EntreeSortieDepotPneus,
  type FiltresARelancerPneus,
  type FiltresDepotsPneusVehicule,
  type FiltresHangarPneus,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { CorpsZod } from '../common/documentation';
import { AucunDroitRequis, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';

import { DepotPneusDto, PageDepotPneusDto } from './dto';
import {
  schemaFiltresARelancerPneus,
  schemaFiltresDepotsPneusVehicule,
  schemaFiltresHangarPneus,
  schemaUuid,
} from './schemas';
import { ServiceDepotPneus } from './service-depot-pneus';

/**
 * Trois contrôleurs pour un module — préfixes de route disjoints (`sites/`, `vehicules/`,
 * `depots-pneus/`), même patron que `pieces/` (un contrôleur par racine REST, pas un seul
 * contrôleur multi-préfixe). Droits PROVISOIRES sur toutes les routes (`@AucunDroitRequis()` +
 * vérification en service, voir `droits-provisoires.ts`) : `apps/api/src/auth/matrice-droits.ts`
 * n'est pas dans le périmètre d'écriture de cet agent.
 */

@ApiTags('Pneus — Hangar')
@ApiCookieAuth()
@Controller({ path: 'sites', version: '1' })
@UseGuards(GardeDroit)
export class SiteHangarPneusController {
  constructor(
    private readonly service: ServiceDepotPneus,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get(':siteId/hangar-pneus')
  @AucunDroitRequis()
  @ApiOperation({
    summary:
      'Vue hangar : jeux de pneus du site, filtrables par statut/saison (spec §5, §6). ' +
      'Rôle vérifié en service (pneus.depot.lire, droit provisoire).',
  })
  @ApiParam({ name: 'siteId', format: 'uuid' })
  @ApiOkResponse({ type: PageDepotPneusDto })
  @ApiReponseProbleme(400, 'Filtres, tri ou curseur invalides.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Rôle non autorisé (contrôle provisoire en service).')
  @ApiReponseProbleme(404, 'Site introuvable pour ce tenant.')
  async hangar(
    @Param('siteId', new PipeZod(schemaUuid)) siteId: string,
    @Query(new PipeZod(schemaFiltresHangarPneus)) query: FiltresHangarPneus,
  ): Promise<PageDepotPneusDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.service.hangar(ctx, role, siteId, query);
  }
}

@ApiTags('Pneus — Hangar')
@ApiCookieAuth()
@Controller({ path: 'vehicules', version: '1' })
@UseGuards(GardeDroit)
export class VehiculeDepotsPneusController {
  constructor(
    private readonly service: ServiceDepotPneus,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get(':vehiculeId/depots-pneus')
  @AucunDroitRequis()
  @ApiOperation({
    summary:
      'Historique COMPLET (tous statuts, sorti compris — RPP-05) des jeux de pneus d’un véhicule.',
  })
  @ApiParam({ name: 'vehiculeId', format: 'uuid' })
  @ApiOkResponse({ type: PageDepotPneusDto })
  @ApiReponseProbleme(400, 'Filtres, tri ou curseur invalides.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Rôle non autorisé (contrôle provisoire en service).')
  @ApiReponseProbleme(404, 'Véhicule introuvable pour ce tenant.')
  async parVehicule(
    @Param('vehiculeId', new PipeZod(schemaUuid)) vehiculeId: string,
    @Query(new PipeZod(schemaFiltresDepotsPneusVehicule)) query: FiltresDepotsPneusVehicule,
  ): Promise<PageDepotPneusDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.service.parVehicule(ctx, role, vehiculeId, query);
  }

  @Post(':vehiculeId/depots-pneus')
  @HttpCode(HttpStatus.CREATED)
  @AucunDroitRequis()
  @ApiOperation({
    summary:
      'Entre un jeu de pneus en dépôt (RPP-01, RPP-02). `Idempotency-Key` obligatoire. ' +
      '`dimension` omise → recopiée depuis vehicule.pneusEte/pneusHiver.',
  })
  @ApiParam({ name: 'vehiculeId', format: 'uuid' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiResponse({ status: 201, type: DepotPneusDto })
  @ApiReponseProbleme(400, 'Corps invalide ou Idempotency-Key manquante/mal formée.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Rôle non autorisé (contrôle provisoire en service).')
  @ApiReponseProbleme(404, 'Véhicule ou site introuvable pour ce tenant.')
  @ApiReponseProbleme(
    409,
    'Un jeu actif existe déjà pour ce véhicule et cette saison (RPP-02), ou IDEMPOTENCE_CONFLIT.',
  )
  async creer(
    @Param('vehiculeId', new PipeZod(schemaUuid)) vehiculeId: string,
    @CorpsZod(schemaCreationDepotPneus) entree: EntreeCreationDepotPneus,
    @Headers('idempotency-key') cleIdempotence: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    const resultat = await this.service.creer(ctx, role, vehiculeId, entree, cleIdempotence ?? '');
    res.status(resultat.reponse.statutHttp);
    if (resultat.rejoue) res.setHeader('Idempotency-Rejeu', 'true');
    return resultat.reponse.corps;
  }
}

@ApiTags('Pneus — Hangar')
@ApiCookieAuth()
@Controller({ path: 'depots-pneus', version: '1' })
@UseGuards(GardeDroit)
export class DepotPneusController {
  constructor(
    private readonly service: ServiceDepotPneus,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get('a-relancer')
  @AucunDroitRequis()
  @ApiOperation({ summary: 'Jeux oubliés (RPP-04) : statut a_relancer, site ou tenant entier.' })
  @ApiOkResponse({ type: PageDepotPneusDto })
  @ApiReponseProbleme(400, 'Filtres, tri ou curseur invalides.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Rôle non autorisé (contrôle provisoire en service).')
  @ApiReponseProbleme(404, 'Site introuvable pour ce tenant (si `siteId` fourni).')
  async aRelancer(
    @Query(new PipeZod(schemaFiltresARelancerPneus)) query: FiltresARelancerPneus,
  ): Promise<PageDepotPneusDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.service.aRelancer(ctx, role, query);
  }

  @Post(':id/changer-saison')
  @AucunDroitRequis()
  @ApiOperation({
    summary:
      'RPP-03 : inverse monté ↔ en dépôt du jeu visé et de son jumeau actif (saison opposée, ' +
      'même véhicule) s’il existe. `ligneOrId` facultatif.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: DepotPneusDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Rôle non autorisé (contrôle provisoire en service).')
  @ApiReponseProbleme(404, 'Dépôt de pneus ou ligne OR introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'Transition interdite : le dépôt n’est ni en_depot ni monte (RPP-03).')
  async changerSaison(
    @Param('id', new PipeZod(schemaUuid)) id: string,
    @CorpsZod(schemaChangementSaisonDepotPneus) entree: EntreeChangementSaisonDepotPneus,
  ): Promise<DepotPneusDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.service.changerSaison(ctx, role, id, entree);
  }

  @Post(':id/sortir')
  @AucunDroitRequis()
  @ApiOperation({
    summary: 'RPP-05 : statut TERMINAL, motif obligatoire. Jamais une suppression de ligne.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: DepotPneusDto })
  @ApiReponseProbleme(400, 'Motif manquant ou invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Rôle non autorisé (contrôle provisoire en service).')
  @ApiReponseProbleme(404, 'Dépôt de pneus introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'Ce dépôt est déjà "sorti" (RPP-05).')
  async sortir(
    @Param('id', new PipeZod(schemaUuid)) id: string,
    @CorpsZod(schemaSortieDepotPneus) entree: EntreeSortieDepotPneus,
  ): Promise<DepotPneusDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.service.sortir(ctx, role, id, entree);
  }
}
