import { ApiProperty } from '@nestjs/swagger';
import type { ReponseBlocCreancier } from '@dfa/shared';

/**
 * DTO Swagger de `GET|PATCH /parametres-facturation/creancier`. Structure calquée sur
 * `DtoBlocCreancier` (`../bloc-creancier/mappeur-bloc-creancier.ts`) — voir ce fichier pour la
 * sémantique « ligne absente = paramétrage vide, jamais 404 ».
 *
 * `implements ReponseBlocCreancier` (`@dfa/shared`) : garde de compilation qui rend impossible
 * une divergence de champ (nom, type, nullabilité) entre ce DTO Swagger et le contrat partagé
 * consommé par le front — si l'un des deux bouge sans l'autre, `pnpm typecheck` échoue ici.
 */
export class ReponseBlocCreancierDto implements ReponseBlocCreancier {
  @ApiProperty({ type: String, nullable: true, example: 'Garage Martin SA' })
  readonly nom!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Rue de la Gare' })
  readonly rue!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '12',
    description:
      'Absent pour une case postale, un lieu-dit ou un hameau — délibérément optionnel, jamais forcé.',
  })
  readonly numero!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '1000' })
  readonly npa!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Lausanne' })
  readonly localite!: string | null;

  @ApiProperty({
    example: 'CH',
    description:
      'Code ISO 3166-1 alpha-2. `CH` ou `LI` uniquement pour un compte de QR-facture suisse.',
  })
  readonly pays!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'CH9300762011623852957',
    description:
      'Compte ORDINAIRE (jamais un QR-IBAN — colonne distincte de `qrIban`), forme compacte sans espaces.',
  })
  readonly iban!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'CH4431999123000889012',
    description:
      'QR-IBAN (IID 30000–31999, jamais un IBAN ordinaire), forme compacte sans espaces.',
  })
  readonly qrIban!: string | null;

  @ApiProperty({
    description:
      'Sert l\'ETag (`W/"<version>"`). Dérivé de `modifie_le` ; `0` si aucun bloc créancier n\'a encore été enregistré pour ce tenant.',
  })
  readonly version!: number;
}
