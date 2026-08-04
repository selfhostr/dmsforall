import { ApiProperty } from '@nestjs/swagger';
import {
  ORIGINES_COMMANDE_FOURNISSEUR,
  STATUTS_COMMANDE_FOURNISSEUR,
  type PageCurseur,
  type ReponseAvecAvertissements,
  type ReponseCommandeFournisseur,
  type ReponseLigneCommandeFournisseur,
  type ReponseReceptionCommandeFournisseur,
} from '@dfa/shared';

import { AvertissementDto } from './avertissement.dto';

export class LigneCommandeFournisseurDto implements ReponseLigneCommandeFournisseur {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ format: 'uuid' })
  readonly commandeFournisseurId!: string;

  @ApiProperty()
  readonly numeroOrdre!: number;

  @ApiProperty({ format: 'uuid' })
  readonly articleId!: string;

  @ApiProperty()
  readonly quantiteCommandeeMillieme!: number;

  @ApiProperty()
  readonly quantiteRecueCumuleeMillieme!: number;

  @ApiProperty({
    description:
      'DÉRIVÉ : max(0, commandée - reçue), sauf reliquatAnnuleLe renseigné auquel cas 0 (RP-28).',
  })
  readonly quantiteReliquatMillieme!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly reliquatAnnuleLe!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly reliquatMotifAnnulation!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  readonly prixAchatAttenduCentimes!: number | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly ligneOrOrigineId!: string | null;
}

export class CommandeFournisseurDto implements ReponseCommandeFournisseur {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ format: 'uuid' })
  readonly fournisseurId!: string;

  @ApiProperty({ format: 'uuid' })
  readonly siteId!: string;

  @ApiProperty({ enum: STATUTS_COMMANDE_FOURNISSEUR })
  readonly statut!: ReponseCommandeFournisseur['statut'];

  @ApiProperty({ enum: ORIGINES_COMMANDE_FOURNISSEUR })
  readonly origine!: ReponseCommandeFournisseur['origine'];

  @ApiProperty({ format: 'date' })
  readonly dateCommande!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly envoyeeLe!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly reference!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Renseigné uniquement pour statut = 'annulee' (§6.2).",
  })
  readonly motifAnnulation!: string | null;

  @ApiProperty({ type: () => [LigneCommandeFournisseurDto] })
  readonly lignes!: readonly LigneCommandeFournisseurDto[];

  @ApiProperty()
  readonly lignesTronquees!: boolean;

  @ApiProperty({ format: 'date-time' })
  readonly creeLe!: string;

  @ApiProperty({ format: 'date-time' })
  readonly modifieLe!: string;
}

/**
 * `creer`/`envoyer`/`annuler-reliquat`/`annuler` ne déclarent aucun type de réponse explicite côté
 * contrat (`commande-fournisseur.ts`) — même convention que le reste du domaine : la commande
 * rafraîchie, enveloppée d'avertissements.
 */
export class CommandeFournisseurAvecAvertissementsDto implements ReponseAvecAvertissements<CommandeFournisseurDto> {
  @ApiProperty({ type: () => CommandeFournisseurDto })
  readonly donnees!: CommandeFournisseurDto;

  @ApiProperty({ type: () => [AvertissementDto] })
  readonly avertissements!: readonly AvertissementDto[];
}

export class PageCommandeFournisseurDto implements PageCurseur<CommandeFournisseurDto> {
  @ApiProperty({ type: () => [CommandeFournisseurDto] })
  readonly donnees!: readonly CommandeFournisseurDto[];

  @ApiProperty({ type: String, nullable: true })
  readonly curseurSuivant!: string | null;

  @ApiProperty({ example: 50 })
  readonly limite!: number;
}

/** `GET /commandes-fournisseur/{id}/lignes` — la suite de `CommandeFournisseurDto.lignes` au-delà de `lignesTronquees`. */
export class PageLigneCommandeFournisseurDto implements PageCurseur<LigneCommandeFournisseurDto> {
  @ApiProperty({ type: () => [LigneCommandeFournisseurDto] })
  readonly donnees!: readonly LigneCommandeFournisseurDto[];

  @ApiProperty({ type: String, nullable: true })
  readonly curseurSuivant!: string | null;

  @ApiProperty({ example: 50 })
  readonly limite!: number;
}

class ReceptionCommandeFournisseurDto implements ReponseReceptionCommandeFournisseur {
  @ApiProperty({
    type: () => [String],
    description: 'Un mouvement entree_livraison par ligne reçue de cet appel.',
  })
  readonly mouvementsCrees!: readonly string[];

  @ApiProperty({ type: () => CommandeFournisseurDto })
  readonly commandeFournisseur!: CommandeFournisseurDto;
}

/**
 * `ReponseReceptionCommandeFournisseur` (contrat) ne porte PAS de champ `avertissements` — mais
 * `schemaLigneReceptionCommandeFournisseur` documente explicitement l'avertissement
 * `RECEPTION_EXCEDENT_RELIQUAT` (§7.4) : sans enveloppe, ce contrat n'a AUCUN canal pour le faire
 * remonter au client. Décision de ce lot (à confirmer, signalée au rapport de livraison) :
 * envelopper quand même, `ReponseAvecAvertissements<ReponseReceptionCommandeFournisseur>` —
 * additif du point de vue TypeScript (n'importe quel `T` peut être enveloppé sans toucher au
 * contrat qui définit `T`), cohérent avec CHAQUE autre action de ce domaine qui peut produire un
 * avertissement (`ajustementInventaire`, `liberer`…).
 */
export class ReceptionCommandeFournisseurAvecAvertissementsDto implements ReponseAvecAvertissements<ReceptionCommandeFournisseurDto> {
  @ApiProperty({ type: () => ReceptionCommandeFournisseurDto })
  readonly donnees!: ReceptionCommandeFournisseurDto;

  @ApiProperty({ type: () => [AvertissementDto] })
  readonly avertissements!: readonly AvertissementDto[];
}
