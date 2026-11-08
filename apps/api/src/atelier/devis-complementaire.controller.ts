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
import { z } from 'zod';
import {
  schemaCreationDevisComplementaire,
  schemaFiltresDevis,
  schemaIdentifiant,
  schemaReponseDevisComplementaire,
  type EntreeCreationDevisComplementaire,
  type EntreeReponseDevisComplementaire,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { CorpsZod } from '../common/documentation';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';

import { EnveloppeOrDto, PageOrDto, ReponseDevisComplementaireDto } from './dto';
import { ServiceDevis } from './service-devis';
import { ExigerModule } from '../common/droits/garde-module';

const EnveloppeDevisComplementaireDto = EnveloppeOrDto(
  ReponseDevisComplementaireDto,
  'DevisComplementaire',
);
const PageDevisComplementaireDto = PageOrDto(ReponseDevisComplementaireDto, 'DevisComplementaire');

const schemaListeDevis = schemaFiltresDevis.extend({
  limite: z.coerce.number().int().min(1).max(200).default(50),
  curseur: z.string().max(512).optional(),
});
type EntreeListeDevis = z.infer<typeof schemaListeDevis>;

/**
 * Devis complémentaires (§7.9, RM-79 → RM-84). **Pas de `PATCH`, pas de `DELETE`** : un devis
 * répondu est immuable (RM-79) — une réponse erronée se corrige par un NOUVEAU devis.
 */
@ApiTags('Ordres de réparation — devis complémentaires')
@ApiCookieAuth()
@ExigerModule('atelier')
@Controller({ path: 'ordres-reparation', version: '1' })
@UseGuards(GardeDroit)
export class DevisComplementaireController {
  constructor(
    private readonly serviceDevis: ServiceDevis,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get(':orId/devis-complementaires')
  @ExigerDroit('atelier.or.lire')
  @ApiOperation({ summary: "Collection paginée des devis complémentaires d'un OR." })
  @ApiParam({ name: 'orId', format: 'uuid' })
  @ApiOkResponse({ type: PageDevisComplementaireDto })
  @ApiReponseProbleme(400, 'Filtres, tri ou curseur invalides.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Ordre de réparation introuvable pour ce tenant.')
  async lister(
    @Param('orId', new PipeZod(schemaIdentifiant)) orId: string,
    @Query(new PipeZod(schemaListeDevis)) query: EntreeListeDevis,
  ) {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    const { limite, curseur, ...filtres } = query;
    return this.serviceDevis.lister(ctx, principal, orId, filtres, limite, curseur);
  }

  @Post(':orId/devis-complementaires')
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('atelier.devis.creer')
  @ApiOperation({
    summary: "Envoi d'un devis complémentaire au client (RM-79).",
    description:
      '`Idempotency-Key` obligatoire (uuid v4) : pièce à valeur probante. `montantTtcCentimes` calculé par le serveur ' +
      'depuis les lignes référencées, déjà figées (RM-65) — jamais fourni par le client.',
  })
  @ApiParam({ name: 'orId', format: 'uuid' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'uuid v4, identité de la requête.',
  })
  @ApiResponse({ status: 201, type: EnveloppeDevisComplementaireDto })
  @ApiReponseProbleme(400, 'Corps invalide ou Idempotency-Key manquante/mal formée.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Ordre de réparation ou ligne référencée introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'OR_LIGNE_VERROUILLEE ou IDEMPOTENCE_CONFLIT.')
  async creer(
    @Param('orId', new PipeZod(schemaIdentifiant)) orId: string,
    @CorpsZod(schemaCreationDevisComplementaire, {
      exemple: {
        ligneIds: ['5a1c9e2e-2f0a-4b3a-9c1a-8e6f2d4b7a10'],
        nouveauPlafondCentimes: 90_000,
        canal: 'telephone',
        impactRestitutionLe: '2026-08-04T16:00:00.000Z',
      },
    })
    entree: EntreeCreationDevisComplementaire,
    @Headers('idempotency-key') cleIdempotence: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    const resultat = await this.serviceDevis.creer(
      ctx,
      principal,
      orId,
      entree,
      cleIdempotence ?? '',
    );

    res.status(resultat.reponse.statutHttp);
    if (resultat.rejoue) res.setHeader('Idempotency-Rejeu', 'true');
    return resultat.reponse.corps;
  }

  @Post(':orId/devis-complementaires/:devisId/repondre')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('atelier.devis.repondre')
  @ApiOperation({
    summary: 'Enregistrement de la réponse du client (RM-81, CT-33).',
    description:
      '`Idempotency-Key` obligatoire : une double réponse est un litige (RM-81). `partiel` fait prendre à ' +
      'chaque ligne sa propre décision. L’OR reprend son cours, il n’est JAMAIS annulé (RM-84).',
  })
  @ApiParam({ name: 'orId', format: 'uuid' })
  @ApiParam({ name: 'devisId', format: 'uuid' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'uuid v4, identité de la requête.',
  })
  @ApiOkResponse({ type: EnveloppeDevisComplementaireDto })
  @ApiReponseProbleme(400, 'Corps invalide ou Idempotency-Key manquante/mal formée.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Ordre de réparation ou devis introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'DEVIS_IMMUABLE, OR_LIGNE_VERROUILLEE ou IDEMPOTENCE_CONFLIT.')
  async repondre(
    @Param('orId', new PipeZod(schemaIdentifiant)) orId: string,
    @Param('devisId', new PipeZod(schemaIdentifiant)) devisId: string,
    @CorpsZod(schemaReponseDevisComplementaire, {
      exemple: {
        decision: 'accepte',
        canal: 'telephone',
        interlocuteurNom: 'Mme Perret',
        repondueLe: '2026-08-04T16:12:00.000Z',
        retranscription:
          'Le client accepte le devis complémentaire pour le remplacement des disques.',
      },
    })
    entree: EntreeReponseDevisComplementaire,
    @Headers('idempotency-key') cleIdempotence: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    const resultat = await this.serviceDevis.repondre(
      ctx,
      principal,
      orId,
      devisId,
      entree,
      cleIdempotence ?? '',
    );

    res.status(resultat.reponse.statutHttp);
    if (resultat.rejoue) res.setHeader('Idempotency-Rejeu', 'true');
    return resultat.reponse.corps;
  }
}
