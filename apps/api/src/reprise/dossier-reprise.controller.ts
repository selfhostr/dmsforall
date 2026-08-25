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
  schemaAnnulationDossierReprise,
  schemaCreationDossierReprise,
  schemaFiltresDossiersReprise,
  schemaIdentifiant,
  type EntreeAnnulationDossierReprise,
  type EntreeCreationDossierReprise,
  type FiltresDossiersReprise,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { CorpsZod } from '../common/documentation';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';

import {
  PageDossierRepriseDto,
  ReponseCreationDossierRepriseDto,
  ReponseDossierRepriseDto,
} from './dto/dossier-reprise.dto';
import { ServiceCycleVieDossierReprise } from './service-cycle-vie-dossier-reprise';

/**
 * `dossier_reprise` — ressource racine. Droits `reprise.dossier.*` (`auth/matrice-droits.ts`,
 * `DROITS_REPRISE_PAR_ROLE`) — réservés à `direction`/`admin` (onboarding technique, aucun rôle
 * opérationnel n'y a accès) : voir le commentaire des entrées `reprise.*` dans `TOUTES_ACTIONS`
 * pour la justification complète de la granularité.
 */
@ApiTags('Reprise de données')
@ApiCookieAuth()
@Controller({ path: 'reprise/dossiers', version: '1' })
@UseGuards(GardeDroit)
export class DossierRepriseController {
  constructor(
    private readonly service: ServiceCycleVieDossierReprise,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get()
  @ExigerDroit('reprise.dossier.lire')
  @ApiOperation({
    summary: 'Liste des dossiers de reprise du tenant courant, curseur, tri creeLe.',
  })
  @ApiOkResponse({ type: PageDossierRepriseDto })
  @ApiReponseProbleme(400, 'Filtres, tri ou curseur invalides.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  async lister(@Query(new PipeZod(schemaFiltresDossiersReprise)) filtres: FiltresDossiersReprise) {
    const ctx = this.contexte.contexteTenant();
    return this.service.lister(ctx, filtres);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('reprise.dossier.deposer')
  @ApiOperation({
    summary:
      "Ouvre un dossier de reprise et déclare l'archive à venir (aucun octet transporté ici).",
    description:
      '`Idempotency-Key` obligatoire (uuid v4) : un rejeu ne doit jamais ouvrir un second dossier.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'uuid v4, identité de la requête.',
  })
  @ApiResponse({ status: 201, type: ReponseCreationDossierRepriseDto })
  @ApiReponseProbleme(400, 'Corps invalide ou Idempotency-Key manquante/mal formée.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(409, 'IDEMPOTENCE_CONFLIT.')
  async creer(
    @CorpsZod(schemaCreationDossierReprise) entree: EntreeCreationDossierReprise,
    @Headers('idempotency-key') cleIdempotence: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const ctx = this.contexte.contexteTenant();
    const resultat = await this.service.creer(ctx, entree, cleIdempotence ?? '');
    res.status(resultat.reponse.statutHttp);
    if (resultat.rejoue) res.setHeader('Idempotency-Rejeu', 'true');
    return resultat.reponse.corps;
  }

  @Get(':dossierId')
  @ExigerDroit('reprise.dossier.lire')
  @ApiOperation({
    summary: "Fiche d'un dossier de reprise (§ ressource racine, contrats/reprise.ts).",
  })
  @ApiParam({ name: 'dossierId', format: 'uuid' })
  @ApiOkResponse({ type: ReponseDossierRepriseDto })
  @ApiReponseProbleme(400, 'Identifiant mal formé.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(404, 'Dossier introuvable pour ce tenant.')
  async lire(@Param('dossierId', new PipeZod(schemaIdentifiant)) dossierId: string) {
    const ctx = this.contexte.contexteTenant();
    return this.service.lire(ctx, dossierId);
  }

  @Post(':dossierId/annuler')
  @ExigerDroit('reprise.dossier.annuler')
  @ApiOperation({
    summary: "Annule un dossier de reprise — motif requis, purge immédiate de l'archive déposée.",
  })
  @ApiParam({ name: 'dossierId', format: 'uuid' })
  @ApiOkResponse({ type: ReponseDossierRepriseDto })
  @ApiReponseProbleme(400, 'Identifiant mal formé ou motif manquant.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(404, 'Dossier introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'REPRISE_DOSSIER_TRANSITION_INTERDITE (dossier déjà terminal).')
  async annuler(
    @Param('dossierId', new PipeZod(schemaIdentifiant)) dossierId: string,
    @CorpsZod(schemaAnnulationDossierReprise) entree: EntreeAnnulationDossierReprise,
  ) {
    const ctx = this.contexte.contexteTenant();
    return this.service.annuler(ctx, dossierId, entree.motif);
  }
}
