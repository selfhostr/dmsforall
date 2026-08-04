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
  schemaAnnulationCommandeFournisseur,
  schemaAnnulationReliquat,
  schemaCreationCommandeFournisseur,
  schemaReceptionCommandeFournisseur,
  type EntreeAnnulationCommandeFournisseur,
  type EntreeAnnulationReliquat,
  type EntreeCreationCommandeFournisseur,
  type EntreeReceptionCommandeFournisseur,
  type FiltresCommandesFournisseur,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { CorpsZod } from '../common/documentation';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';

import {
  CommandeFournisseurAvecAvertissementsDto,
  CommandeFournisseurDto,
  PageCommandeFournisseurDto,
  ReceptionCommandeFournisseurAvecAvertissementsDto,
} from './dto';
import { schemaFiltresCommandesFournisseur, schemaUuid } from './schemas';
import { ServiceCommandeFournisseur } from './service-commande-fournisseur';

/**
 * Commande fournisseur (RP-26 → RP-31, §6.2) — priorité 1 du lot. PAS de `PATCH` générique sur
 * `statut` (même patron que `ordre-reparation.ts`/`document.ts`) : chaque transition est une
 * ACTION NOMMÉE (`envoyer`, `reception`, `annuler-reliquat`, `annuler`).
 */
@ApiTags('Pièces — Commandes fournisseur')
@ApiCookieAuth()
@Controller({ path: 'commandes-fournisseur', version: '1' })
@UseGuards(GardeDroit)
export class CommandeFournisseurController {
  constructor(
    private readonly service: ServiceCommandeFournisseur,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get()
  @ExigerDroit('pieces.commande_fournisseur.lire')
  @ApiOperation({ summary: 'Liste paginée des commandes fournisseur du tenant courant.' })
  @ApiOkResponse({ type: PageCommandeFournisseurDto })
  @ApiReponseProbleme(400, 'Filtres, tri ou curseur invalides.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  async lister(
    @Query(new PipeZod(schemaFiltresCommandesFournisseur)) query: FiltresCommandesFournisseur,
  ): Promise<PageCommandeFournisseurDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.lister(ctx, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('pieces.commande_fournisseur.creer')
  @ApiOperation({
    summary:
      "Création d'une commande fournisseur (statut initial toujours `brouillon`). `Idempotency-Key` obligatoire.",
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiResponse({ status: 201, type: CommandeFournisseurAvecAvertissementsDto })
  @ApiReponseProbleme(400, 'Corps invalide ou Idempotency-Key manquante/mal formée.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(
    404,
    'Fournisseur, site, article ou ligne d’OR d’origine introuvable pour ce tenant.',
  )
  @ApiReponseProbleme(409, 'IDEMPOTENCE_CONFLIT.')
  async creer(
    @CorpsZod(schemaCreationCommandeFournisseur) entree: EntreeCreationCommandeFournisseur,
    @Headers('idempotency-key') cleIdempotence: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const ctx = this.contexte.contexteTenant();
    const resultat = await this.service.creer(ctx, entree, cleIdempotence ?? '');
    res.status(resultat.reponse.statutHttp);
    if (resultat.rejoue) res.setHeader('Idempotency-Rejeu', 'true');
    return resultat.reponse.corps;
  }

  @Get(':id')
  @ExigerDroit('pieces.commande_fournisseur.lire')
  @ApiOperation({ summary: "Fiche d'une commande fournisseur, lignes comprises." })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CommandeFournisseurDto })
  @ApiReponseProbleme(400, 'Identifiant mal formé.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Commande fournisseur introuvable pour ce tenant.')
  async parId(@Param('id', new PipeZod(schemaUuid)) id: string): Promise<CommandeFournisseurDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.parId(ctx, id);
  }

  @Post(':id/envoyer')
  @ExigerDroit('pieces.commande_fournisseur.creer')
  @ApiOperation({ summary: 'Envoie la commande au fournisseur — `brouillon → envoyee` (§6.2).' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CommandeFournisseurAvecAvertissementsDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Commande fournisseur introuvable pour ce tenant.')
  @ApiReponseProbleme(
    409,
    'COMMANDE_FOURNISSEUR_TRANSITION_INTERDITE — la commande n’est pas en brouillon.',
  )
  async envoyer(
    @Param('id', new PipeZod(schemaUuid)) id: string,
  ): Promise<CommandeFournisseurAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.envoyer(ctx, id);
  }

  @Post(':id/reception')
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('pieces.commande_fournisseur.reception')
  @ApiOperation({
    summary:
      'Réceptionne tout ou partie de la commande (§7.4) — génère un mouvement `entree_livraison` par ligne. `Idempotency-Key` obligatoire.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiResponse({ status: 201, type: ReceptionCommandeFournisseurAvecAvertissementsDto })
  @ApiReponseProbleme(400, 'Corps invalide ou Idempotency-Key manquante/mal formée.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(
    404,
    'Commande, ligne de commande ou article reçu introuvable pour ce tenant.',
  )
  @ApiReponseProbleme(
    409,
    'COMMANDE_FOURNISSEUR_TRANSITION_INTERDITE, RECEPTION_REFERENCE_NON_EQUIVALENTE, ou IDEMPOTENCE_CONFLIT.',
  )
  async reception(
    @Param('id', new PipeZod(schemaUuid)) id: string,
    @CorpsZod(schemaReceptionCommandeFournisseur) entree: EntreeReceptionCommandeFournisseur,
    @Headers('idempotency-key') cleIdempotence: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const ctx = this.contexte.contexteTenant();
    const resultat = await this.service.reception(ctx, id, entree, cleIdempotence ?? '');
    res.status(resultat.reponse.statutHttp);
    if (resultat.rejoue) res.setHeader('Idempotency-Rejeu', 'true');
    return resultat.reponse.corps;
  }

  @Post(':id/lignes/:ligneId/annuler-reliquat')
  @ExigerDroit('pieces.commande_fournisseur.reception')
  @ApiOperation({ summary: 'Solde un reliquat SANS livraison, avec motif (RP-28).' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'ligneId', format: 'uuid' })
  @ApiOkResponse({ type: CommandeFournisseurAvecAvertissementsDto })
  @ApiReponseProbleme(400, 'Motif manquant ou trop court.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Commande ou ligne de commande introuvable pour ce tenant.')
  @ApiReponseProbleme(
    409,
    'COMMANDE_FOURNISSEUR_RELIQUAT_DEJA_SOLDE, ou COMMANDE_FOURNISSEUR_TRANSITION_INTERDITE.',
  )
  async annulerReliquat(
    @Param('id', new PipeZod(schemaUuid)) id: string,
    @Param('ligneId', new PipeZod(schemaUuid)) ligneId: string,
    @CorpsZod(schemaAnnulationReliquat) entree: EntreeAnnulationReliquat,
  ): Promise<CommandeFournisseurAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.annulerReliquat(ctx, id, ligneId, entree);
  }

  @Post(':id/annuler')
  @ExigerDroit('pieces.commande_fournisseur.creer')
  @ApiOperation({
    summary: 'Annule la commande entière, avec motif — UNIQUEMENT avant toute réception (§6.2).',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CommandeFournisseurAvecAvertissementsDto })
  @ApiReponseProbleme(400, 'Motif manquant ou trop court.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Commande fournisseur introuvable pour ce tenant.')
  @ApiReponseProbleme(
    409,
    'COMMANDE_FOURNISSEUR_TRANSITION_INTERDITE — une réception a déjà eu lieu.',
  )
  async annuler(
    @Param('id', new PipeZod(schemaUuid)) id: string,
    @CorpsZod(schemaAnnulationCommandeFournisseur) entree: EntreeAnnulationCommandeFournisseur,
  ): Promise<CommandeFournisseurAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.annuler(ctx, id, entree);
  }
}
