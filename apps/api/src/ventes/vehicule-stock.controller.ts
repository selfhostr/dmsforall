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
  schemaIdentifiant,
  schemaMarquerVenduVehiculeStock,
  schemaMiseEnStock,
  schemaModificationVehiculeStock,
  schemaReceptionnerVehiculeStock,
  schemaRemettreDisponibleVehiculeStock,
  type EntreeMarquerVenduVehiculeStock,
  type EntreeMiseEnStock,
  type EntreeModificationVehiculeStock,
  type EntreeReceptionnerVehiculeStock,
  type EntreeRemettreDisponibleVehiculeStock,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { CorpsZod } from '../common/documentation';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';

import { ReponseVehiculeStockDto, VehiculeStockAvecAvertissementsDto } from './dto';
import { ServiceVehiculeStock } from './service-vehicule-stock';
import { ExigerModule } from '../common/droits/garde-module';

/**
 * Véhicule en stock (RV-01→RV-14, §6.1) — sous-ressource SINGULIÈRE d'un véhicule (0 ou 1),
 * `/vehicules/{vehiculeId}/stock` : 404 si ce véhicule n'a jamais été mis en stock. La collection
 * paginée (`GET /vehicules-stock`) est dans `vehicules-stock.controller.ts` — même distinction
 * collection/ressource que partout ailleurs dans l'API.
 */
@ApiTags('Véhicules en stock')
@ApiCookieAuth()
@ExigerModule('ventes')
@Controller({ path: 'vehicules/:vehiculeId/stock', version: '1' })
@UseGuards(GardeDroit)
export class VehiculeStockController {
  constructor(
    private readonly service: ServiceVehiculeStock,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('ventes.vehicule_stock.creer')
  @ApiOperation({
    summary: 'Met un véhicule EXISTANT en stock (RV-01).',
    description:
      '`Idempotency-Key` obligatoire (uuid v4) : un double-clic comptoir ne doit jamais produire deux ' +
      'fiches de coût pour le même véhicule. `statutCommercial` initial est DÉRIVÉ (en_commande si VN sans VIN connu, disponible sinon).',
  })
  @ApiParam({ name: 'vehiculeId', format: 'uuid' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'uuid v4, identité de la requête.',
  })
  @ApiResponse({ status: 201, type: VehiculeStockAvecAvertissementsDto })
  @ApiReponseProbleme(400, 'Corps invalide ou Idempotency-Key manquante/mal formée.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Véhicule introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'VENTE_VEHICULE_STOCK_DEJA_EXISTANT ou IDEMPOTENCE_CONFLIT.')
  async mettreEnStock(
    @Param('vehiculeId', new PipeZod(schemaIdentifiant)) vehiculeId: string,
    @CorpsZod(schemaMiseEnStock, {
      exemple: {
        siteId: '2f6c9e1a-8b3d-4e7a-9c2b-1a5d6e8f9012',
        provenance: 'achat_particulier',
        dateEntreeStock: '2026-07-31',
        prixAchatCentimes: 1_500_000,
      },
    })
    entree: EntreeMiseEnStock,
    @Headers('idempotency-key') cleIdempotence: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    const resultat = await this.service.mettreEnStock(
      ctx,
      principal,
      vehiculeId,
      entree,
      cleIdempotence ?? '',
    );

    res.status(resultat.reponse.statutHttp);
    if (resultat.rejoue) res.setHeader('Idempotency-Rejeu', 'true');
    return resultat.reponse.corps;
  }

  @Get()
  @ExigerDroit('ventes.vehicule_stock.lire')
  @ApiOperation({ summary: 'Fiche stock complète du véhicule (404 si jamais mis en stock).' })
  @ApiParam({ name: 'vehiculeId', format: 'uuid' })
  @ApiOkResponse({ type: ReponseVehiculeStockDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Véhicule jamais mis en stock pour ce tenant.')
  async obtenir(
    @Param('vehiculeId', new PipeZod(schemaIdentifiant)) vehiculeId: string,
  ): Promise<ReponseVehiculeStockDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.service.obtenir(ctx, role, vehiculeId);
  }

  @Patch()
  @ExigerDroit('ventes.vehicule_stock.modifier')
  @ApiOperation({
    summary: 'Modification de la fiche stock.',
    description:
      '`If-Match: W/"<version>"` obligatoire. `prixAchatCentimes` verrouillé dès `statutCommercial = vendu`.',
  })
  @ApiParam({ name: 'vehiculeId', format: 'uuid' })
  @ApiHeader({
    name: 'If-Match',
    required: true,
    description: 'W/"<version>" lu sur la dernière lecture (ETag).',
  })
  @ApiOkResponse({ type: VehiculeStockAvecAvertissementsDto })
  @ApiReponseProbleme(400, 'Corps invalide ou If-Match manquant/mal formé.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Véhicule jamais mis en stock pour ce tenant.')
  @ApiReponseProbleme(409, 'CONFLIT (version périmée ou prix d’achat verrouillé après vente).')
  async modifier(
    @Param('vehiculeId', new PipeZod(schemaIdentifiant)) vehiculeId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @CorpsZod(schemaModificationVehiculeStock) entree: EntreeModificationVehiculeStock,
  ): Promise<VehiculeStockAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.service.modifier(ctx, role, vehiculeId, ifMatch, entree);
  }

  @Post('receptionner')
  @ExigerDroit('ventes.vehicule_stock.modifier')
  @ApiOperation({
    summary: 'Réception physique d’un VN commandé — `en_commande -> disponible` (RV-09).',
  })
  @ApiParam({ name: 'vehiculeId', format: 'uuid' })
  @ApiOkResponse({ type: VehiculeStockAvecAvertissementsDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Véhicule jamais mis en stock pour ce tenant.')
  @ApiReponseProbleme(409, 'CONFLIT — le véhicule n’est pas en commande.')
  async receptionner(
    @Param('vehiculeId', new PipeZod(schemaIdentifiant)) vehiculeId: string,
    @CorpsZod(schemaReceptionnerVehiculeStock, { exemple: {} })
    entree: EntreeReceptionnerVehiculeStock,
  ): Promise<VehiculeStockAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.service.receptionner(ctx, role, vehiculeId, entree);
  }

  @Post('remettre-disponible')
  @ExigerDroit('ventes.vehicule_stock.corriger')
  @ApiOperation({
    summary: 'Retour manuel à `disponible` depuis `reserve` — correction exceptionnelle (RV-10).',
    description:
      'Normalement un EFFET DE BORD de `POST /dossiers-vente/{id}/annuler|abandonner` — cette action ' +
      'directe existe pour la correction exceptionnelle (dossier orphelin), motif obligatoire.',
  })
  @ApiParam({ name: 'vehiculeId', format: 'uuid' })
  @ApiOkResponse({ type: VehiculeStockAvecAvertissementsDto })
  @ApiReponseProbleme(400, 'Motif manquant.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Véhicule jamais mis en stock pour ce tenant.')
  @ApiReponseProbleme(409, 'CONFLIT — le véhicule n’est pas réservé.')
  async remettreDisponible(
    @Param('vehiculeId', new PipeZod(schemaIdentifiant)) vehiculeId: string,
    @CorpsZod(schemaRemettreDisponibleVehiculeStock, {
      exemple: { motif: 'Dossier de vente annulé manuellement, régularisation.' },
    })
    entree: EntreeRemettreDisponibleVehiculeStock,
  ): Promise<VehiculeStockAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.service.remettreDisponible(ctx, role, vehiculeId, entree);
  }

  @Post('marquer-vendu')
  @ExigerDroit('ventes.vehicule_stock.corriger')
  @ApiOperation({
    summary: '`reserve -> vendu` — normalement un effet de bord de l’émission de facture (RV-37).',
    description:
      'USAGE NORMAL : appel PROGRAMMATIQUE par `facturation/` à l’émission de la facture — ' +
      'aucun écran ne devrait appeler cet endpoint dans le parcours courant. Il existe pour la ' +
      'correction exceptionnelle (resynchronisation, ou usage avant que le câblage facturation ' +
      'n’existe), motif obligatoire, même patron que `remettre-disponible`.',
  })
  @ApiParam({ name: 'vehiculeId', format: 'uuid' })
  @ApiOkResponse({ type: VehiculeStockAvecAvertissementsDto })
  @ApiReponseProbleme(400, 'Motif manquant.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Véhicule jamais mis en stock pour ce tenant.')
  @ApiReponseProbleme(409, 'CONFLIT — le véhicule n’est pas réservé.')
  async marquerVendu(
    @Param('vehiculeId', new PipeZod(schemaIdentifiant)) vehiculeId: string,
    @CorpsZod(schemaMarquerVenduVehiculeStock, {
      exemple: { motif: 'Resynchronisation manuelle avant câblage facturation.' },
    })
    entree: EntreeMarquerVenduVehiculeStock,
  ): Promise<VehiculeStockAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.service.marquerVendu(ctx, role, vehiculeId, entree);
  }
}
