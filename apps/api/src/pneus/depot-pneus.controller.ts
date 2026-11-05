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
  schemaDeplacementDepotPneus,
  schemaSortieDepotPneus,
  type EntreeChangementSaisonDepotPneus,
  type EntreeCreationDepotPneus,
  type EntreeDeplacementDepotPneus,
  type EntreeSortieDepotPneus,
  type FiltresARelancerPneus,
  type FiltresDepotsPneusVehicule,
  type FiltresHangarPneus,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { CorpsZod } from '../common/documentation';
import { ExigerDroit, GardeDroit } from '../common/droits';
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
 * contrôleur multi-préfixe).
 *
 * Droits POSÉS DÉFINITIVEMENT (`auth/matrice-droits.ts`) : `@ExigerDroit(...)` + `GardeDroit`
 * refuse `403 DROIT_INSUFFISANT` en `canActivate()` AVANT que le handler (donc `ServiceDepotPneus`,
 * donc tout accès base) ne s'exécute — un rôle non autorisé ne déclenche structurellement aucune
 * requête. Remplace le palliatif `@AucunDroitRequis()` + vérification de rôle en service
 * (`pneus/droits-provisoires.ts`, retiré), posé faute d'accès de son auteur à
 * `auth/matrice-droits.ts` au moment de la livraison de ce module. `pneus.depot.lire` gouverne les
 * quatre routes de lecture ; `pneus.depot.creer` l'entrée en dépôt ; `pneus.depot.changer_saison`
 * gouverne RPP-03 ET `deplacer` (défaut corrigé, voir plus bas — aucun droit dédié n'existe pour ce
 * geste, `changer_saison` en reprend exactement le profil : physique, routinier, réversible) ;
 * `pneus.depot.sortir` (scindées depuis la proposition d'origine `pneus.depot.gerer`, voir
 * `matrice-droits.ts`) gouverne RPP-05.
 *
 * DÉFAUTS CORRIGÉS (rapport de livraison) :
 *  1. `GET /sites/{siteId}/hangar-pneus` (et les autres listes) répondaient `500 ERREUR_INTERNE`
 *     sur un curseur de pagination syntaxiquement valide mais dont la valeur n'était pas un
 *     timestamptz PostgreSQL bien formé — corrigé dans `common/pagination/keyset.ts::decoderCurseurPourTri`
 *     (validation avant toute requête SQL, `400 VALIDATION_ECHOUEE` au lieu d'une erreur Postgres
 *     non déballée).
 *  2. Le repère de rangement (`codeCase`, RPP-07) n'était modifiable qu'à la création — corrigé
 *     par la route `POST /depots-pneus/{id}/deplacer` ci-dessous.
 *  3. `changer-saison` et `sortir` documentaient `200` (`@ApiOkResponse`) mais rendaient `201`
 *     (défaut de NestJS sur `@Post()` sans `@HttpCode` explicite) — corrigé par l'ajout de
 *     `@HttpCode(HttpStatus.OK)` sur les trois routes `POST` qui rendent effectivement `200`
 *     (`changer-saison`, `sortir`, `deplacer`) ; `creer` avait déjà son `@HttpCode(HttpStatus.
 *     CREATED)` explicite et n'était pas concernée. Le même écart existe ailleurs dans le dépôt
 *     (`commande-fournisseur.controller.ts`, `annuler`/`envoyer`, déjà documenté dans un test) —
 *     HORS PÉRIMÈTRE de cet agent (`pieces/` interdit), signalé pour correction séparée.
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
  @ExigerDroit('pneus.depot.lire')
  @ApiOperation({
    summary: 'Vue hangar : jeux de pneus du site, filtrables par statut/saison (spec §5, §6).',
  })
  @ApiParam({ name: 'siteId', format: 'uuid' })
  @ApiOkResponse({ type: PageDepotPneusDto })
  @ApiReponseProbleme(400, 'Filtres, tri ou curseur invalides.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (pneus.depot.lire).')
  @ApiReponseProbleme(404, 'Site introuvable pour ce tenant.')
  async hangar(
    @Param('siteId', new PipeZod(schemaUuid)) siteId: string,
    @Query(new PipeZod(schemaFiltresHangarPneus)) query: FiltresHangarPneus,
  ): Promise<PageDepotPneusDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.hangar(ctx, siteId, query);
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
  @ExigerDroit('pneus.depot.lire')
  @ApiOperation({
    summary:
      'Historique COMPLET (tous statuts, sorti compris — RPP-05) des jeux de pneus d’un véhicule.',
  })
  @ApiParam({ name: 'vehiculeId', format: 'uuid' })
  @ApiOkResponse({ type: PageDepotPneusDto })
  @ApiReponseProbleme(400, 'Filtres, tri ou curseur invalides.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (pneus.depot.lire).')
  @ApiReponseProbleme(404, 'Véhicule introuvable pour ce tenant.')
  async parVehicule(
    @Param('vehiculeId', new PipeZod(schemaUuid)) vehiculeId: string,
    @Query(new PipeZod(schemaFiltresDepotsPneusVehicule)) query: FiltresDepotsPneusVehicule,
  ): Promise<PageDepotPneusDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.parVehicule(ctx, vehiculeId, query);
  }

  @Post(':vehiculeId/depots-pneus')
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('pneus.depot.creer')
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
  @ApiReponseProbleme(403, 'Droit insuffisant (pneus.depot.creer).')
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
    const resultat = await this.service.creer(ctx, vehiculeId, entree, cleIdempotence ?? '');
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
  @ExigerDroit('pneus.depot.lire')
  @ApiOperation({ summary: 'Jeux oubliés (RPP-04) : statut a_relancer, site ou tenant entier.' })
  @ApiOkResponse({ type: PageDepotPneusDto })
  @ApiReponseProbleme(400, 'Filtres, tri ou curseur invalides.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (pneus.depot.lire).')
  @ApiReponseProbleme(404, 'Site introuvable pour ce tenant (si `siteId` fourni).')
  async aRelancer(
    @Query(new PipeZod(schemaFiltresARelancerPneus)) query: FiltresARelancerPneus,
  ): Promise<PageDepotPneusDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.aRelancer(ctx, query);
  }

  @Post(':id/changer-saison')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('pneus.depot.changer_saison')
  @ApiOperation({
    summary:
      'RPP-03 : inverse monté ↔ en dépôt du jeu visé et de son jumeau actif (saison opposée, ' +
      'même véhicule) s’il existe. `ligneOrId` facultatif.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: DepotPneusDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (pneus.depot.changer_saison).')
  @ApiReponseProbleme(404, 'Dépôt de pneus ou ligne OR introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'Transition interdite : le dépôt n’est ni en_depot ni monte (RPP-03).')
  async changerSaison(
    @Param('id', new PipeZod(schemaUuid)) id: string,
    @CorpsZod(schemaChangementSaisonDepotPneus) entree: EntreeChangementSaisonDepotPneus,
  ): Promise<DepotPneusDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.changerSaison(ctx, id, entree);
  }

  @Post(':id/deplacer')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('pneus.depot.changer_saison')
  @ApiOperation({
    summary:
      'DÉFAUT CORRIGÉ (RPP-07) : modifie le repère de rangement (`codeCase`) d’un dépôt — posable ' +
      'seulement à la création jusqu’ici, alors que les jeux de pneus changent de case couramment ' +
      'dans le hangar. `codeCase` nullish (retrait du repère accepté). Met à jour ' +
      '`dernierMouvementLe` (un déplacement est un mouvement au sens RPP-04). Même droit que ' +
      '`changer-saison` : geste physique routinier, pas une clôture de garde (voir `sortir`).',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: DepotPneusDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (pneus.depot.changer_saison).')
  @ApiReponseProbleme(404, 'Dépôt de pneus introuvable pour ce tenant.')
  @ApiReponseProbleme(
    409,
    'Ce dépôt est "sorti" : son repère de rangement ne peut plus être modifié (RPP-05).',
  )
  async deplacer(
    @Param('id', new PipeZod(schemaUuid)) id: string,
    @CorpsZod(schemaDeplacementDepotPneus) entree: EntreeDeplacementDepotPneus,
  ): Promise<DepotPneusDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.deplacer(ctx, id, entree);
  }

  @Post(':id/sortir')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('pneus.depot.sortir')
  @ApiOperation({
    summary:
      'RPP-05 : statut TERMINAL, motif obligatoire. Jamais une suppression de ligne. Réservé aux ' +
      'rôles qui clôturent la garde du garage sur un bien du client (même périmètre que ' +
      'atelier.or.restituer — receptionnaire/chef d’atelier/direction/admin, PAS technicien ni ' +
      'magasinier, qui détiennent creer/changer-saison mais pas sortir).',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: DepotPneusDto })
  @ApiReponseProbleme(400, 'Motif manquant ou invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (pneus.depot.sortir).')
  @ApiReponseProbleme(404, 'Dépôt de pneus introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'Ce dépôt est déjà "sorti" (RPP-05).')
  async sortir(
    @Param('id', new PipeZod(schemaUuid)) id: string,
    @CorpsZod(schemaSortieDepotPneus) entree: EntreeSortieDepotPneus,
  ): Promise<DepotPneusDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.sortir(ctx, id, entree);
  }
}
