/**
 * `GET /api/v1/capacites/modele` — de quoi dessiner l'écran « Qui peut quoi » : domaines, niveaux,
 * options et préréglages, avec des clés i18n. Donnée de référence identique pour tous les tenants
 * (aucun contenu client) ; réservée à qui gère les employés, comme l'écran lui-même.
 */
import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ModeleCapacitesDto } from '../auth/dto/capacites.dto';
import { construireModeleCapacites } from '../auth/modele-capacites';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';

@ApiTags('Socle')
@ApiCookieAuth()
@Controller({ path: 'capacites', version: '1' })
@UseGuards(GardeDroit)
export class CapacitesController {
  @Get('modele')
  @ExigerDroit('socle.utilisateur.lire')
  @ApiOperation({
    summary: 'Modèle de la grille de capacités (domaines, niveaux, options, préréglages)',
    description:
      'Libellés sous forme de clés i18n. Les préréglages portent la grille complète à appliquer ; ' +
      "`fiduciaire` s'enregistre avec le rôle d'origine `comptable`.",
  })
  @ApiOkResponse({ type: ModeleCapacitesDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (rôle sans socle.utilisateur.lire).')
  modele(): ModeleCapacitesDto {
    return construireModeleCapacites();
  }
}
