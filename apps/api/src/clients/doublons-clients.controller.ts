import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { schemaParametresDoublonsClients, type ParametresDoublonsClients } from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';
import { ReponseDoublonsClientsDto } from './dto';
import { ServiceClient } from './service-client';

/**
 * `GET /doublons-clients` (RM-05) — placé à la RACINE, PAS sous `/clients/…` : un segment
 * littéral ne se met jamais là où un identifiant est attendu (voir le commentaire de
 * `ReponseDoublonsClients` dans le contrat gelé, `packages/shared/src/contrats/atelier/client.ts`).
 *
 * Projection consommée à la frappe, non paginée. AVERTISSEMENT, jamais un blocage (CT-01) : deux
 * frères à la même adresse sont deux clients légitimes — cet endpoint n'empêche rien, il informe.
 */
@ApiTags('Clients')
@ApiCookieAuth()
@Controller({ path: 'doublons-clients', version: '1' })
@UseGuards(GardeDroit)
export class DoublonsClientsController {
  constructor(
    private readonly serviceClient: ServiceClient,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get()
  @ExigerDroit('client.lire')
  @ApiOperation({ summary: 'Candidats doublons pour un nom, un NPA, un email, un téléphone ou un IDE (RM-05).' })
  @ApiOkResponse({ type: ReponseDoublonsClientsDto })
  @ApiReponseProbleme(400, 'Aucun critère de recherche fourni.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  async lister(
    @Query(new PipeZod(schemaParametresDoublonsClients)) query: ParametresDoublonsClients,
  ): Promise<ReponseDoublonsClientsDto> {
    const ctx = this.contexte.contexteTenant();
    return this.serviceClient.doublons(ctx, query);
  }
}
