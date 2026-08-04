import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { schemaFiltreTableauBord, type FiltreTableauBord } from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { AucunDroitRequis, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';

import { ReponseFinancierTableauBordDto } from './dto';
import { ServiceTableauBordFinancier } from './service-tableau-bord-financier';

/**
 * `GET /tableau-bord/financier` — chiffre d'affaires, encaissements, encours clients. Réservé
 * `direction`/`comptable` (`RF-115` : `admin` explicitement exclu). Voir `droits-provisoires.ts`
 * pour le détail du découpage — LE point sensible de tout ce module.
 *
 * `@AucunDroitRequis()` PROVISOIRE, PAS un accès ouvert — voir l'en-tête de
 * `droits-provisoires.ts` : `ServiceTableauBordFinancier.obtenir` vérifie le rôle réel EN SERVICE,
 * AVANT tout accès base, en l'absence de l'action `tableau_bord.financier.lire` dans
 * `auth/matrice-droits.ts` (hors du périmètre d'écriture de ce module). Un rôle non autorisé
 * n'exécute JAMAIS la moindre requête d'agrégation financière.
 */
@ApiTags('Tableau de bord')
@ApiCookieAuth()
@Controller({ path: 'tableau-bord', version: '1' })
@UseGuards(GardeDroit)
export class TableauBordFinancierController {
  constructor(
    private readonly service: ServiceTableauBordFinancier,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get('financier')
  @AucunDroitRequis()
  @ApiOperation({
    summary: 'Chiffre d’affaires, encaissements, encours clients — réservé direction/comptable.',
    description:
      "Chiffre d'affaires HT/TVA/TTC (factures + avoirs ÉMIS de la période, net d'annulation), " +
      'encaissements (paiements de la période, net des remboursements), encours clients (snapshot, ' +
      'factures encore émises non soldées). `du`/`au` omis → mois civil UTC courant. Aucune notion ' +
      'de marge : voir la documentation du contrat (`@dfa/shared`, `contrats/tableau-bord/financier.ts`).',
  })
  @ApiQuery({ name: 'siteId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'du', required: false, format: 'date' })
  @ApiQuery({ name: 'au', required: false, format: 'date' })
  @ApiOkResponse({ type: ReponseFinancierTableauBordDto })
  @ApiReponseProbleme(400, '`du`/`au`/`siteId` invalides, ou `du` postérieur à `au`.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant — réservé à direction/comptable.')
  async financier(
    @Query(new PipeZod(schemaFiltreTableauBord)) query: FiltreTableauBord,
  ): Promise<ReponseFinancierTableauBordDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.service.obtenir(ctx, role, query);
  }
}
