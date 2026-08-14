import { ApiProperty } from '@nestjs/swagger';
import {
  CATEGORIES_ARTICLE,
  STATUTS_ARTICLE,
  TYPES_REFERENCE_ARTICLE,
  type PageCurseur,
  type ReponseArticle,
  type ReponseArticleReference,
  type ReponseAvecAvertissements,
  type ResultatRechercheComptoirArticle,
  type StockResumeArticle,
} from '@dfa/shared';

import { AvertissementDto } from './avertissement.dto';

export class ArticleReferenceDto implements ReponseArticleReference {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ format: 'uuid' })
  readonly articleId!: string;

  @ApiProperty({ enum: TYPES_REFERENCE_ARTICLE })
  readonly type!: ReponseArticleReference['type'];

  @ApiProperty()
  readonly reference!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: "Obligatoire et UNIQUEMENT pour `type = 'fournisseur'` (RP-02).",
  })
  readonly fournisseurId!: string | null;

  @ApiProperty({ format: 'date-time' })
  readonly creeLe!: string;
}

export class StockResumeArticleDto implements StockResumeArticle {
  @ApiProperty({ format: 'uuid' })
  readonly siteId!: string;

  @ApiProperty()
  readonly quantitePhysiqueMillieme!: number;

  @ApiProperty({
    description: 'quantitePhysiqueMillieme - quantiteReserveeMillieme (RP-14), dérivé.',
  })
  readonly quantiteDisponibleMillieme!: number;

  @ApiProperty({ type: String, nullable: true, description: 'Texte libre (RP-11).' })
  readonly emplacement!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Casier structuré (rayon, 0056), COMPLÉMENT de `emplacement` — jamais un remplacement. ' +
      'Toujours normalisé (majuscules, sans espace) : "B3", "b3" et "B 3" saisis produisent la ' +
      'même valeur.',
  })
  readonly rayon!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Casier structuré (tiroir, 0056) — mêmes règles de normalisation que `rayon`.',
  })
  readonly tiroir!: string | null;
}

export class ArticleDto implements ReponseArticle {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({
    example: 'P-000123',
    description: 'Généré par le serveur, unique par tenant (RP-08). Jamais fourni en entrée.',
  })
  readonly numeroArticle!: string;

  @ApiProperty()
  readonly designation!: string;

  @ApiProperty({ type: String, nullable: true })
  readonly marque!: string | null;

  @ApiProperty({ enum: CATEGORIES_ARTICLE })
  readonly categorie!: ReponseArticle['categorie'];

  @ApiProperty({ enum: STATUTS_ARTICLE })
  readonly statut!: ReponseArticle['statut'];

  @ApiProperty()
  readonly referencePrincipale!: string;

  @ApiProperty({ type: String, nullable: true })
  readonly codeBarres!: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Dernier prix d’achat connu, en CENTIMES. `null` tant qu’aucune réception n’a eu lieu, OU si le ' +
      'rôle appelant ne voit pas le prix d’achat (§11 de la spec pièces — RF-115/RF-116 appliqué au domaine pièces).',
  })
  readonly prixAchatCentimes!: number | null;

  @ApiProperty({ description: 'TVA comprise, jamais HT + TVA ajoutée à l’écran.' })
  readonly prixVenteTtcCentimes!: number;

  @ApiProperty({
    description:
      'Taux courant appliqué par défaut à une nouvelle ligne référençant cet article (RP-36).',
  })
  readonly tauxTvaPourmille!: number;

  @ApiProperty({
    description:
      'Article d’échange standard (alternateur, démarreur…) — active la saisie d’une consigne à la pose (RP-37).',
  })
  readonly estEchangeStandard!: boolean;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Obligatoire et UNIQUEMENT si estEchangeStandard = true. TTC (RP-38).',
  })
  readonly montantConsigneTtcCentimes!: number | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Renseigné UNIQUEMENT si statut = obsolete et qu’un remplaçant est connu (RP-04).',
  })
  readonly referenceRemplacementId!: string | null;

  @ApiProperty({ type: () => [ArticleReferenceDto] })
  readonly references!: readonly ArticleReferenceDto[];

  @ApiProperty()
  readonly referencesTronquees!: boolean;

  @ApiProperty({ type: () => [StockResumeArticleDto] })
  readonly stocksResume!: readonly StockResumeArticleDto[];

  @ApiProperty({ format: 'date-time' })
  readonly creeLe!: string;

  @ApiProperty({ format: 'date-time' })
  readonly modifieLe!: string;
}

export class PageArticleDto implements PageCurseur<ArticleDto> {
  @ApiProperty({ type: () => [ArticleDto] })
  readonly donnees!: readonly ArticleDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Opaque base64url ; null = fin de liste.',
  })
  readonly curseurSuivant!: string | null;

  @ApiProperty({ example: 50 })
  readonly limite!: number;
}

/** `GET /articles/{id}/references` — la suite de `ArticleDto.references` au-delà de `referencesTronquees`. */
export class PageArticleReferenceDto implements PageCurseur<ArticleReferenceDto> {
  @ApiProperty({ type: () => [ArticleReferenceDto] })
  readonly donnees!: readonly ArticleReferenceDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Opaque base64url ; null = fin de liste.',
  })
  readonly curseurSuivant!: string | null;

  @ApiProperty({ example: 50 })
  readonly limite!: number;
}

export class ArticleAvecAvertissementsDto implements ReponseAvecAvertissements<ArticleDto> {
  @ApiProperty({ type: () => ArticleDto })
  readonly donnees!: ArticleDto;

  @ApiProperty({ type: () => [AvertissementDto] })
  readonly avertissements!: readonly AvertissementDto[];
}

export class ResultatRechercheComptoirArticleDto implements ResultatRechercheComptoirArticle {
  @ApiProperty({ format: 'uuid' })
  readonly articleId!: string;

  @ApiProperty()
  readonly numeroArticle!: string;

  @ApiProperty()
  readonly designation!: string;

  @ApiProperty()
  readonly referencePrincipale!: string;

  @ApiProperty()
  readonly prixVenteTtcCentimes!: number;

  @ApiProperty()
  readonly quantiteDisponibleMillieme!: number;

  @ApiProperty({ type: String, nullable: true })
  readonly emplacement!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Casier structuré (rayon, 0056), COMPLÉMENT de `emplacement`.',
  })
  readonly rayon!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Casier structuré (tiroir, 0056).' })
  readonly tiroir!: string | null;

  @ApiProperty()
  readonly estEchangeStandard!: boolean;

  @ApiProperty({ type: Number, nullable: true })
  readonly montantConsigneTtcCentimes!: number | null;
}
