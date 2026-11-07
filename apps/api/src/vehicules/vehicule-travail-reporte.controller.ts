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
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  schemaCreationTravailReporte,
  schemaFiltresTravauxReportes,
  schemaIdentifiant,
  schemaModificationTravailReporte,
  type EntreeCreationTravailReporte,
  type EntreeModificationTravailReporte,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { CorpsZod } from '../common/documentation';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { Horloge } from '../common/horloge/horloge';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';
import { ReponseTravailReporteDto } from './dto';
import type { FiltresTravauxReportes } from './schemas-locales';
import { ServiceVehiculeTravailReporte } from './service-vehicule-travail-reporte';

/**
 * `GET`/`POST`/`PATCH` des travaux reportés (RM-73) — c'est ce que le réceptionnaire relit quand le
 * véhicule revient au garage. Un travail reporté naît soit d'un refus de ligne d'OR (port
 * `CreationTravailReporte`, module `atelier`), soit d'une saisie directe (`POST`, « à faire la
 * prochaine fois : courroie ») depuis la fiche véhicule ou un OR.
 */
@ApiTags('Véhicules')
@ApiCookieAuth()
@Controller({ path: 'vehicules/:vehiculeId/travaux-reportes', version: '1' })
@UseGuards(GardeDroit)
export class VehiculeTravailReporteController {
  constructor(
    private readonly service: ServiceVehiculeTravailReporte,
    private readonly contexte: ServiceContexteRequete,
    private readonly horloge: Horloge,
  ) {}

  @Get()
  @ExigerDroit('vehicule.lire')
  @ApiOperation({
    summary: 'Travaux reportés du véhicule (RM-73).',
    description:
      '`montantEstimeCentimes` absent pour un rôle sans droit aux montants (ROLES_SANS_MONTANT, ' +
      "aujourd'hui `technicien`) — filtrage SERVEUR, même règle que `GET .../contexte-atelier`.",
  })
  @ApiParam({ name: 'vehiculeId', format: 'uuid' })
  @ApiOkResponse({ type: [ReponseTravailReporteDto] })
  @ApiReponseProbleme(400, 'Filtres ou tri invalides.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Véhicule introuvable pour ce tenant.')
  async lister(
    @Param('vehiculeId', new PipeZod(schemaIdentifiant)) vehiculeId: string,
    @Query(new PipeZod(schemaFiltresTravauxReportes)) filtres: FiltresTravauxReportes,
  ) {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    return this.service.lister(ctx, vehiculeId, filtres, principal.role);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('vehicule.travail_reporte.signaler')
  @ApiOperation({
    summary: 'Noter un travail à faire la prochaine fois (RM-73).',
    description:
      'Saisie directe : désignation, détail, priorité (`a_faire` par défaut), origine facultative ' +
      '(`ordreReparationOrigineId`, un OR de CE véhicule ; absent = saisie libre). Ressort sur la ' +
      "fiche véhicule et à l'ouverture du prochain OR.",
  })
  @ApiParam({ name: 'vehiculeId', format: 'uuid' })
  @ApiCreatedResponse({ type: ReponseTravailReporteDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Véhicule ou ordre de réparation introuvable pour ce tenant.')
  async creer(
    @Param('vehiculeId', new PipeZod(schemaIdentifiant)) vehiculeId: string,
    @CorpsZod(schemaCreationTravailReporte, {
      exemple: { designation: 'Courroie de distribution', urgence: 'a_faire' },
    })
    entree: EntreeCreationTravailReporte,
  ) {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    return this.service.creer(ctx, vehiculeId, entree, principal.role, this.horloge.maintenant());
  }

  @Patch(':travailId')
  @ExigerDroit('vehicule.travail_reporte.gerer')
  @ApiOperation({
    summary: "Correction, clôture ou abandon d'un travail reporté (RM-73).",
    description:
      "UN SEUL endpoint pour l'édition libre (désignation, urgence, montant estimé) ET la " +
      "transition de statut : `statut: 'repris'` clôt le travail (fait, repris au passage), " +
      "`statut: 'abandonne'` l'écarte définitivement (le client a dit non). Aucun `DELETE` — RM-73 : " +
      "« un travail reporté s'écarte ou se corrige, il ne se supprime pas ».",
  })
  @ApiParam({ name: 'vehiculeId', format: 'uuid' })
  @ApiParam({ name: 'travailId', format: 'uuid' })
  @ApiOkResponse({ type: ReponseTravailReporteDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Travail reporté introuvable pour ce véhicule/tenant.')
  async modifier(
    @Param('vehiculeId', new PipeZod(schemaIdentifiant)) vehiculeId: string,
    @Param('travailId', new PipeZod(schemaIdentifiant)) travailId: string,
    @CorpsZod(schemaModificationTravailReporte, { exemple: { statut: 'abandonne' } })
    entree: EntreeModificationTravailReporte,
  ) {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    return this.service.modifier(ctx, vehiculeId, travailId, entree, principal.role);
  }
}
