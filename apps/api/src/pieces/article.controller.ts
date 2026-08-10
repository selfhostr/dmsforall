import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  schemaCreationArticle,
  schemaCreationReferenceArticle,
  schemaDesactivationArticle,
  schemaMarquageObsolete,
  schemaModificationArticle,
  schemaRechercheComptoir,
  type EntreeCreationArticle,
  type EntreeCreationReferenceArticle,
  type EntreeDesactivationArticle,
  type EntreeMarquageObsolete,
  type FiltresReferencesArticle,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { ApiCorpsZod, CorpsZod } from '../common/documentation';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';

import {
  ArticleAvecAvertissementsDto,
  ArticleDto,
  PageArticleDto,
  PageArticleReferenceDto,
  ResultatRechercheComptoirArticleDto,
} from './dto';
import {
  schemaFiltresReferencesArticle,
  schemaListeArticles,
  schemaUuid,
  type ParametresListeArticles,
} from './schemas';
import { ServiceArticle } from './service-article';

/**
 * CRUD du référentiel article (RP-01 → RP-08, priorité 1 du lot). Pas de `DELETE` : un article se
 * désactive ou devient obsolète (RP-07), jamais ne se supprime — même doctrine que `client`/`vehicule`.
 */
@ApiTags('Pièces — Articles')
@ApiCookieAuth()
@Controller({ path: 'articles', version: '1' })
@UseGuards(GardeDroit)
export class ArticleController {
  constructor(
    private readonly service: ServiceArticle,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get()
  @ExigerDroit('pieces.article.lire')
  @ApiOperation({ summary: 'Liste paginée des articles du tenant courant (RP-03).' })
  @ApiOkResponse({ type: PageArticleDto })
  @ApiReponseProbleme(400, 'Filtres, tri ou curseur invalides.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (rôle sans pieces.article.lire).')
  async lister(
    @Query(new PipeZod(schemaListeArticles)) query: ParametresListeArticles,
  ): Promise<PageArticleDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.service.lister(ctx, role, query);
  }

  @Get('recherche-comptoir')
  @ExigerDroit('pieces.article.lire')
  @ApiOperation({
    summary:
      'Recherche compacte pour la saisie assistée (comptoir, ligne d’OR pièce) — un seul appel donne prix, référence et disponibilité au site.',
  })
  @ApiQuery({ name: 'q', required: true })
  @ApiQuery({ name: 'siteId', required: true, format: 'uuid' })
  @ApiQuery({ name: 'limite', required: false })
  @ApiOkResponse({ type: [ResultatRechercheComptoirArticleDto] })
  @ApiReponseProbleme(400, 'Paramètres invalides.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  async rechercheComptoir(
    @Query(new PipeZod(schemaRechercheComptoir))
    query: {
      q: string;
      siteId: string;
      limite: number;
    },
  ): Promise<readonly ResultatRechercheComptoirArticleDto[]> {
    const ctx = this.contexte.contexteTenant();
    return this.service.rechercheComptoir(ctx, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('pieces.article.creer')
  @ApiOperation({
    summary: "Création d'un article.",
    description:
      '`Idempotency-Key` obligatoire (uuid v4) : un rejeu ne doit pas brûler un second numéro d’article (RP-08).',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'uuid v4, identité de la requête.',
  })
  @ApiResponse({ status: 201, type: ArticleAvecAvertissementsDto })
  @ApiReponseProbleme(400, 'Corps invalide ou Idempotency-Key manquante/mal formée.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (rôle sans pieces.article.creer).')
  @ApiReponseProbleme(
    409,
    'IDEMPOTENCE_CONFLIT — même clé, corps différent ou exécution encore en cours.',
  )
  async creer(
    @CorpsZod(schemaCreationArticle, {
      exemple: {
        designation: 'Plaquettes de frein avant',
        categorie: 'piece_mecanique',
        referencePrincipale: '1K0698151',
        prixVenteTtcCentimes: 8900,
        tauxTvaPourmille: 81,
        estEchangeStandard: false,
      },
    })
    entree: EntreeCreationArticle,
    @Headers('idempotency-key') cleIdempotence: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    const resultat = await this.service.creer(ctx, role, entree, cleIdempotence ?? '');

    res.status(resultat.reponse.statutHttp);
    if (resultat.rejoue) res.setHeader('Idempotency-Rejeu', 'true');
    return resultat.reponse.corps;
  }

  @Get(':articleId')
  @ExigerDroit('pieces.article.lire')
  @ApiOperation({ summary: "Fiche d'un article (références + résumé de stock par site)." })
  @ApiParam({ name: 'articleId', format: 'uuid' })
  @ApiOkResponse({ type: ArticleDto })
  @ApiReponseProbleme(400, 'Identifiant mal formé.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Article introuvable pour ce tenant.')
  async parId(@Param('articleId', new PipeZod(schemaUuid)) articleId: string): Promise<ArticleDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.service.parId(ctx, role, articleId);
  }

  @Get(':articleId/references')
  @ExigerDroit('pieces.article.lire')
  @ApiOperation({
    summary:
      'Références alternatives d’un article, page complète (pagination par curseur) — le recours quand `ArticleDto.referencesTronquees = true`.',
  })
  @ApiParam({ name: 'articleId', format: 'uuid' })
  @ApiOkResponse({ type: PageArticleReferenceDto })
  @ApiReponseProbleme(400, 'Identifiant, filtres, tri ou curseur invalides.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Article introuvable pour ce tenant.')
  async listerReferences(
    @Param('articleId', new PipeZod(schemaUuid)) articleId: string,
    @Query(new PipeZod(schemaFiltresReferencesArticle)) query: FiltresReferencesArticle,
  ): Promise<PageArticleReferenceDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.listerReferences(ctx, articleId, query);
  }

  @Patch(':articleId')
  @ExigerDroit('pieces.article.modifier')
  @ApiOperation({ summary: "Modification partielle d'un article." })
  @ApiParam({ name: 'articleId', format: 'uuid' })
  @ApiOkResponse({ type: ArticleAvecAvertissementsDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Article introuvable pour ce tenant.')
  @ApiCorpsZod(schemaModificationArticle, {
    description:
      'Corps brut transmis tel quel au service (jamais pré-parsé ici) : `schemaModificationArticle` ' +
      'porte `estEchangeStandard.default(false)`, que `.partial()` rend facultatif SANS annuler le ' +
      "défaut — un parse ici l'appliquerait à tort à un corps qui ne touche pas `estEchangeStandard` " +
      '(F-01-bis). Voir `ServiceArticle.modifier`.',
    exemple: { designation: 'Plaquettes de frein avant' },
  })
  async modifier(
    @Param('articleId', new PipeZod(schemaUuid)) articleId: string,
    @Body() corpsBrut: Record<string, unknown>,
  ): Promise<ArticleAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.service.modifier(ctx, role, articleId, corpsBrut);
  }

  @Post(':articleId/references')
  @ExigerDroit('pieces.article.modifier')
  @ApiOperation({
    summary:
      'Ajoute ou met à jour une référence alternative (upsert sur (tenant, reference) — RP-02/RP-03).',
  })
  @ApiParam({ name: 'articleId', format: 'uuid' })
  @ApiOkResponse({ type: ArticleAvecAvertissementsDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Article introuvable pour ce tenant.')
  @ApiReponseProbleme(
    409,
    'ARTICLE_REFERENCE_COLLISION — référence déjà portée par un autre article.',
  )
  async ajouterReference(
    @Param('articleId', new PipeZod(schemaUuid)) articleId: string,
    @CorpsZod(schemaCreationReferenceArticle) entree: EntreeCreationReferenceArticle,
  ): Promise<ArticleAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.service.ajouterReference(ctx, role, articleId, entree);
  }

  @Post(':articleId/marquer-obsolete')
  @ExigerDroit('pieces.article.modifier')
  @ApiOperation({ summary: 'Marque un article obsolète (RP-04).' })
  @ApiParam({ name: 'articleId', format: 'uuid' })
  @ApiOkResponse({ type: ArticleAvecAvertissementsDto })
  @ApiReponseProbleme(400, '`referenceRemplacementId` requis (ARTICLE_REMPLACANT_REQUIS).')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Article introuvable pour ce tenant.')
  async marquerObsolete(
    @Param('articleId', new PipeZod(schemaUuid)) articleId: string,
    @CorpsZod(schemaMarquageObsolete) entree: EntreeMarquageObsolete,
  ): Promise<ArticleAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.service.marquerObsolete(ctx, role, articleId, entree);
  }

  @Post(':articleId/desactiver')
  @ExigerDroit('pieces.article.modifier')
  @ApiOperation({
    summary: 'Désactive un article (§6.1) — refusé si une réservation active porte sur lui.',
  })
  @ApiParam({ name: 'articleId', format: 'uuid' })
  @ApiOkResponse({ type: ArticleAvecAvertissementsDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Article introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'ARTICLE_DESACTIVATION_IMPOSSIBLE — réservation active en cours.')
  async desactiver(
    @Param('articleId', new PipeZod(schemaUuid)) articleId: string,
    @CorpsZod(schemaDesactivationArticle) entree: EntreeDesactivationArticle,
  ): Promise<ArticleAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.service.desactiver(ctx, role, articleId, entree);
  }

  @Post(':articleId/reactiver')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('pieces.article.modifier')
  @ApiOperation({
    summary: 'Réactive un article (retour à `actif` depuis `obsolete` ou `desactive`, §6.1).',
  })
  @ApiParam({ name: 'articleId', format: 'uuid' })
  @ApiOkResponse({ type: ArticleAvecAvertissementsDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Article introuvable pour ce tenant.')
  async reactiver(
    @Param('articleId', new PipeZod(schemaUuid)) articleId: string,
  ): Promise<ArticleAvecAvertissementsDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.service.reactiver(ctx, role, articleId);
  }
}
