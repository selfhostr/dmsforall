import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ServiceContexteRequete } from '../common/contexte';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { TenantCourantDto } from './dto';
import { ServiceTenant } from './service-tenant';

/** `GET /api/v1/tenant/courant` — endpoint 4 du contrat étape 0. */
@ApiTags('Socle')
@ApiCookieAuth()
@Controller({ path: 'tenant', version: '1' })
export class TenantController {
  constructor(
    private readonly serviceTenant: ServiceTenant,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get('courant')
  @UseGuards(GardeDroit)
  @ExigerDroit('socle.tenant.lire')
  @ApiOperation({
    summary: 'Tenant courant',
    description:
      "Renvoie le tenant (entreprise cliente) de l'utilisateur authentifié. Ne prend aucun paramètre : le tenant vient exclusivement de la session.",
  })
  @ApiOkResponse({ type: TenantCourantDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (rôle sans socle.tenant.lire).')
  async courant(): Promise<TenantCourantDto> {
    const ctx = this.contexte.contexteTenant();
    return this.serviceTenant.courant(ctx);
  }
}
