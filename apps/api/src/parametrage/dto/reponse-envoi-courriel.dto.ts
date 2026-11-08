import { ApiProperty } from '@nestjs/swagger';
import {
  CAUSES_ECHEC_ENVOI_COURRIEL,
  SECURITES_SMTP,
  SOURCES_ENVOI_COURRIEL,
  type CauseEchecEnvoiCourriel,
  type DernierTestEnvoiCourriel,
  type ReglageEnvoiCourriel,
  type ReponseEnvoiCourriel,
  type ReponseTestEnvoiCourriel,
  type SecuriteSmtp,
  type SourceEnvoiCourriel,
} from '@dfa/shared';

export class DernierTestEnvoiCourrielDto implements DernierTestEnvoiCourriel {
  @ApiProperty({ example: '2026-11-08T09:30:00.000Z', description: 'Horodatage UTC (ISO 8601).' })
  readonly le!: string;

  @ApiProperty({ example: true })
  readonly succes!: boolean;

  @ApiProperty({
    enum: CAUSES_ECHEC_ENVOI_COURRIEL,
    enumName: 'CauseEchecEnvoiCourriel',
    nullable: true,
    example: null,
    description: '`null` si le test a réussi.',
  })
  readonly cause!: CauseEchecEnvoiCourriel | null;
}

export class ReglageEnvoiCourrielDto implements ReglageEnvoiCourriel {
  @ApiProperty({ example: 'mail.infomaniak.com' })
  readonly hote!: string;

  @ApiProperty({ example: 587, minimum: 1, maximum: 65535 })
  readonly port!: number;

  @ApiProperty({ enum: SECURITES_SMTP, enumName: 'SecuriteSmtp', example: 'starttls' })
  readonly securite!: SecuriteSmtp;

  @ApiProperty({ type: String, nullable: true, example: 'atelier@garage-martin.ch' })
  readonly utilisateur!: string | null;

  @ApiProperty({
    example: true,
    description: 'Le mot de passe est enregistré (chiffré). Il n’est jamais renvoyé par l’API.',
  })
  readonly motDePasseDefini!: boolean;

  @ApiProperty({ example: 'atelier@garage-martin.ch' })
  readonly adresseExpediteur!: string;

  @ApiProperty({ type: String, nullable: true, example: 'Garage Martin' })
  readonly nomAffiche!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'contact@garage-martin.ch' })
  readonly adresseReponse!: string | null;

  @ApiProperty({
    type: () => DernierTestEnvoiCourrielDto,
    nullable: true,
    description: '`null` : aucun test depuis la dernière modification du réglage.',
  })
  readonly dernierTest!: DernierTestEnvoiCourrielDto | null;
}

export class ReponseEnvoiCourrielDto implements ReponseEnvoiCourriel {
  @ApiProperty({
    type: () => ReglageEnvoiCourrielDto,
    nullable: true,
    description: 'Réglage propre au garage ; `null` s’il n’en a pas saisi.',
  })
  readonly reglage!: ReglageEnvoiCourrielDto | null;

  @ApiProperty({
    enum: SOURCES_ENVOI_COURRIEL,
    enumName: 'SourceEnvoiCourriel',
    example: 'garage',
    description:
      'Ce qui sert réellement à envoyer : `garage` (son réglage), `instance` (variables SMTP_* du serveur) ou `aucune`.',
  })
  readonly source!: SourceEnvoiCourriel;

  @ApiProperty({
    example: true,
    description: '`false` : aucun envoi possible (`source = aucune`).',
  })
  readonly configure!: boolean;

  @ApiProperty({
    example: false,
    description:
      '`true` hors production : les e-mails sont capturés et jamais remis (seul l’e-mail d’essai part réellement).',
  })
  readonly modeCapture!: boolean;

  @ApiProperty({ example: false, description: 'Le serveur fournit un envoi de repli (SMTP_*).' })
  readonly instanceDisponible!: boolean;

  @ApiProperty({
    example: true,
    description:
      '`false` : la clé de chiffrement du serveur est absente, enregistrer un mot de passe est refusé.',
  })
  readonly chiffrementDisponible!: boolean;
}

export class ReponseTestEnvoiCourrielDto implements ReponseTestEnvoiCourriel {
  @ApiProperty({ example: '2026-11-08T09:30:00.000Z', description: 'Horodatage UTC (ISO 8601).' })
  readonly envoyeLe!: string;
}
