import { ApiProperty } from '@nestjs/swagger';
import {
  MODES_SIGNALEMENT,
  type ModeSignalement,
  type ReponseParametresEntreprise,
} from '@dfa/shared';

/** DTO Swagger de `GET|PATCH /parametres-entreprise` (garde de compilation : `implements`). */
export class ReponseParametresEntrepriseDto implements ReponseParametresEntreprise {
  @ApiProperty({ example: 'Garage Martin SA' })
  readonly raisonSociale!: string;

  @ApiProperty({
    example: true,
    description:
      'Le garage est-il assujetti à la TVA ? `false` : aucune TVA sur ses documents (taux 0, régime « exclu »), mention « Non assujetti à la TVA », `numeroTva` toujours `null`. `true` par défaut (comportement historique) ; une facture ne peut être émise sans `numeroTva` quand il vaut `true`.',
  })
  readonly assujettiTva!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'CHE-116.281.710 TVA',
    description:
      'N° IDE avec mention TVA (CHE-123.456.789 TVA, MWST ou IVA), clé de contrôle vérifiée. `null` : numéro pas encore saisi, ou garage non assujetti.',
  })
  readonly numeroTva!: string | null;

  @ApiProperty({
    example: 30,
    minimum: 0,
    maximum: 365,
    description:
      'Délai de paiement par défaut des factures, en jours, pour un client sans condition de paiement propre.',
  })
  readonly delaiPaiementJoursDefaut!: number;

  @ApiProperty({
    enum: MODES_SIGNALEMENT,
    example: 'via_site',
    description:
      'Réglage « Signalements » : `via_site` (défaut) ouvre le site pour terminer le signalement, `copie_seule` ne propose que la copie du rapport, `desactive` retire le bouton « Signaler un problème ».',
  })
  readonly modeSignalement!: ModeSignalement;
}
