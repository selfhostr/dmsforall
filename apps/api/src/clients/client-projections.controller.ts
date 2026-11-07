import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { droitsDuPrincipal } from '../auth/droits-personne';
import { ServiceContexteRequete } from '../common/contexte';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';
import { PageOrdreReparationResumeDto } from './dto';
import { PageVehiculeResumeDto } from './dto';
import {
  schemaListeOrDuClient,
  schemaListeVehiculesDuClient,
  schemaUuid,
  type ParametresListeOrDuClient,
  type ParametresListeVehiculesDuClient,
} from './schemas';
import { ServiceClientOrdresReparation } from './service-client-ordres-reparation';
import { ServiceClientVehicules } from './service-client-vehicules';

/**
 * Projections en lecture seule rattachées à la fiche client : véhicules détenus (RM-20) et
 * ordres de réparation (RM-21). Propriétés réelles respectivement de `vehicules/` et `atelier/`
 * (voir les commentaires de tête de `service-client-vehicules.ts` / `service-client-ordres-reparation.ts`
 * sur le risque de source de vérité concurrente) — droits alignés sur le domaine PROJETÉ
 * (`vehicule.lire`, `atelier.or.lire`), pas sur `client.lire`, pour rester cohérents avec ce que
 * ces mêmes ressources exigent quand elles sont lues depuis leur propre module.
 */

@ApiTags('Clients')
@ApiCookieAuth()
@Controller({ path: 'clients/:clientId/vehicules', version: '1' })
@UseGuards(GardeDroit)
export class ClientVehiculesController {
  constructor(
    private readonly service: ServiceClientVehicules,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get()
  @ExigerDroit('vehicule.lire')
  @ApiOperation({
    summary: 'Véhicules détenus par le client (RM-20).',
    description:
      'Les détentions CLOSES ne sont visibles que sur demande explicite (`inclureAnciennesDetentions`).',
  })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiOkResponse({ type: PageVehiculeResumeDto })
  @ApiReponseProbleme(400, 'Filtres, tri ou curseur invalides.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Client introuvable pour ce tenant.')
  async lister(
    @Param('clientId', new PipeZod(schemaUuid)) clientId: string,
    @Query(new PipeZod(schemaListeVehiculesDuClient)) params: ParametresListeVehiculesDuClient,
  ): Promise<PageVehiculeResumeDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.lister(ctx, clientId, params);
  }
}

@ApiTags('Clients')
@ApiCookieAuth()
@Controller({ path: 'clients/:clientId/ordres-reparation', version: '1' })
@UseGuards(GardeDroit)
export class ClientOrdresReparationController {
  constructor(
    private readonly service: ServiceClientOrdresReparation,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get()
  @ExigerDroit('atelier.or.lire')
  @ApiOperation({
    summary: 'Ordres de réparation du client (RM-21).',
    description:
      '`totalTtcCentimes` absent pour un rôle sans droit aux montants (`technicien`, ' +
      '`ROLES_SANS_MONTANT` — invariant front n°10), retiré CÔTÉ SERVEUR.',
  })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiOkResponse({ type: PageOrdreReparationResumeDto })
  @ApiReponseProbleme(400, 'Filtres, tri ou curseur invalides.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Client introuvable pour ce tenant.')
  async lister(
    @Param('clientId', new PipeZod(schemaUuid)) clientId: string,
    @Query(new PipeZod(schemaListeOrDuClient)) params: ParametresListeOrDuClient,
  ): Promise<PageOrdreReparationResumeDto> {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    const avecMontants = droitsDuPrincipal(principal).voitMontants;
    return this.service.lister(ctx, clientId, params, avecMontants);
  }
}
