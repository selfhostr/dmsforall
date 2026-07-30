import { Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  schemaFiltresTravauxReportes,
  schemaIdentifiant,
  schemaModificationTravailReporte,
  type EntreeModificationTravailReporte,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { CorpsZod } from '../common/documentation';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';
import { ReponseTravailReporteDto } from './dto';
import type { FiltresTravauxReportes } from './schemas-locales';
import { ServiceVehiculeTravailReporte } from './service-vehicule-travail-reporte';

/**
 * `GET`/`PATCH` des travaux reportés (RM-73) — c'est ce que le réceptionnaire relit quand le
 * véhicule revient au garage. La CRÉATION n'a AUCUNE route ici : un travail reporté naît d'un
 * refus de ligne d'OR (`POST /ordres-reparation/{orId}/refuser-lignes`, module `atelier`, hors
 * périmètre de ce fichier), jamais d'une saisie directe côté `vehicules` — voir le port
 * `CreationTravailReporte` exporté par `service-vehicule-travail-reporte.ts` et la réponse de
 * tâche pour le câblage exact attendu côté `atelier`.
 */
@ApiTags('Véhicules')
@ApiCookieAuth()
@Controller({ path: 'vehicules/:vehiculeId/travaux-reportes', version: '1' })
@UseGuards(GardeDroit)
export class VehiculeTravailReporteController {
  constructor(
    private readonly service: ServiceVehiculeTravailReporte,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get()
  @ExigerDroit('vehicule.lire')
  @ApiOperation({
    summary: 'Travaux reportés du véhicule (RM-73).',
    description:
      "`montantEstimeCentimes` absent pour un rôle sans droit aux montants (ROLES_SANS_MONTANT, " +
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
