import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CODES_ERREUR, type CodeErreur, type ErreurChamp, type ProblemeDetail } from '@dfa/shared';

/**
 * DTO Swagger du contrat d'erreur unique de l'API (`application/problem+json`). N'existe que
 * pour porter les décorateurs `@ApiProperty` — le contrat TypeScript réel côté runtime reste
 * `ProblemeDetail` (packages/shared). Enregistré comme modèle global dans
 * `openapi/construire-document.ts` (`extraModels`).
 *
 * Nommage `*CommunDto` (et non `ProblemeDetailDto` tout court) : le module `auth/` définit sa
 * propre copie locale `ProblemeDetailDto` (voir `auth/dto/auth.dto.ts`, choix assumé pour ne pas
 * créer de dépendance de compilation entre répertoires appartenant à des experts différents).
 * `@nestjs/swagger` utilise le NOM de la classe comme clé de schéma OpenAPI
 * (`#/components/schemas/<nom>`) : deux classes distinctes portant le même nom entreraient en
 * collision dans le document généré. Ce préfixe `Commun` est donc structurant, pas cosmétique.
 */
export class ErreurChampCommunDto implements ErreurChamp {
  @ApiProperty({ description: 'Chemin du champ fautif (notation pointée).', example: 'email' })
  readonly champ!: string;

  @ApiProperty({ description: 'Code machine de la violation.', example: 'invalid_string' })
  readonly code!: string;

  @ApiProperty({ description: 'Message FR — jamais affiché tel quel par le front.' })
  readonly message!: string;
}

export class ProblemeDetailCommunDto implements ProblemeDetail {
  @ApiProperty({ example: 'https://docs.dmsforall.example/erreurs/VALIDATION_ECHOUEE' })
  readonly type!: string;

  @ApiProperty({
    description: 'Libellé FR stable — JAMAIS affiché par le front.',
    example: 'Validation échouée',
  })
  readonly title!: string;

  @ApiProperty({ example: 400 })
  readonly status!: number;

  @ApiProperty({
    enum: CODES_ERREUR,
    description: 'Contrat machine : seul champ que le front doit lire.',
  })
  readonly code!: CodeErreur;

  @ApiPropertyOptional({ description: "Détail technique — jamais affiché à l'utilisateur final." })
  readonly detail?: string;

  @ApiProperty({ description: 'Identifiant de la requête, = en-tête X-Requete-Id.' })
  readonly instance!: string;

  @ApiPropertyOptional({ type: () => [ErreurChampCommunDto] })
  readonly erreurs?: ReadonlyArray<ErreurChamp>;
}
