import { ApiProperty } from '@nestjs/swagger';
import type { ReponseClient } from '@dfa/shared';

import { ClientAdresseDto } from './client-adresse.dto';
import { ClientConditionDto } from './client-condition.dto';
import { ClientConsentementDto } from './client-consentement.dto';
import { ClientContactDto } from './client-contact.dto';
import { ClientDto } from './client.dto';
import { ClientNoteDto } from './client-note.dto';
import { OrdreReparationResumeDto } from './ordre-reparation-resume.dto';
import { VehiculeResumeDto } from './vehicule-resume.dto';

/**
 * `GET /clients/{id}/export` — droit d'ACCÈS nLPD (art. 25), distinct de l'anonymisation.
 * Recensement complet de ce que l'application détient sur ce client — voir l'en-tête de
 * `migrations/0061_anonymisation_client.sql` pour le détail exhaustif des emplacements couverts et
 * de ceux délibérément hors périmètre. `notes` expose TOUTES les natures (`interne` COMPRISE,
 * contrairement à `ClientDto.notesAlerte` qui ne rend que `alerte`) : le droit d'accès nLPD porte
 * sur la donnée détenue, pas sur ce qui est utile à l'écran comptoir — à la charge du garage de
 * filtrer avant remise si une note interne ne doit légitimement pas être communiquée.
 */
export class DocumentVenteExportDto {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'null tant que le document est un brouillon non numéroté.',
  })
  readonly numero!: string | null;

  @ApiProperty({ example: 'facture' })
  readonly typeDocument!: string;

  @ApiProperty({ example: 'emis' })
  readonly statut!: string;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  readonly dateDocument!: string | null;

  @ApiProperty({ description: 'Centimes entiers.' })
  readonly totalTtcCentimes!: number;

  @ApiProperty({ example: 'CHF' })
  readonly devise!: string;
}

export class RendezVousExportDto {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ format: 'date' })
  readonly date!: string;

  @ApiProperty({ example: 'matin' })
  readonly moment!: string;

  @ApiProperty({ example: 'confirme' })
  readonly statut!: string;

  @ApiProperty({ type: String, nullable: true })
  readonly commentaire!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly motifAnnulation!: string | null;
}

/**
 * `relance_envoi` (`db/schema/relances/relance-envoi.ts`) — DONNÉE PERSONNELLE FIGÉE (RA-12) :
 * `destinataireFige`/`contenuFige` portent l'adresse réellement utilisée et le texte réellement
 * envoyé (donc le nom du client dans la formule de politesse), jamais recalculés. Table du module
 * `relances`, lue ici en LECTURE SEULE (import de schéma existant, aucune écriture) — ce module
 * n'a AUCUN moyen d'anonymiser ces deux colonnes (hors de son périmètre d'écriture), voir le
 * résidu signalé en tête de la migration 0061 et dans le rapport de tâche.
 */
export class RelanceExportDto {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty()
  readonly typeRelance!: string;

  @ApiProperty()
  readonly palier!: number;

  @ApiProperty()
  readonly canal!: string;

  @ApiProperty()
  readonly destinataireFige!: string;

  @ApiProperty()
  readonly contenuFige!: string;

  @ApiProperty()
  readonly statutEnvoi!: string;

  @ApiProperty({ format: 'date-time' })
  readonly envoyeLe!: string;
}

export class ExportClientDto {
  @ApiProperty({ format: 'date-time' })
  readonly genereLe!: string;

  @ApiProperty({ type: () => ClientDto })
  readonly client!: ReponseClient;

  @ApiProperty({ type: () => [ClientAdresseDto] })
  readonly adresses!: readonly ClientAdresseDto[];

  @ApiProperty({ type: () => [ClientContactDto] })
  readonly contacts!: readonly ClientContactDto[];

  @ApiProperty({ type: () => [ClientConditionDto] })
  readonly conditions!: readonly ClientConditionDto[];

  @ApiProperty({ type: () => [ClientConsentementDto] })
  readonly consentements!: readonly ClientConsentementDto[];

  @ApiProperty({
    type: () => [ClientNoteDto],
    description: 'TOUTES natures (interne comprise) — voir la description du contrôleur.',
  })
  readonly notes!: readonly ClientNoteDto[];

  @ApiProperty({ type: () => [VehiculeResumeDto] })
  readonly vehicules!: readonly VehiculeResumeDto[];

  @ApiProperty({ type: () => [OrdreReparationResumeDto] })
  readonly ordresReparation!: readonly OrdreReparationResumeDto[];

  @ApiProperty({ type: () => [DocumentVenteExportDto] })
  readonly documentsVente!: readonly DocumentVenteExportDto[];

  @ApiProperty({ type: () => [RendezVousExportDto] })
  readonly rendezVous!: readonly RendezVousExportDto[];

  @ApiProperty({ type: () => [RelanceExportDto] })
  readonly relances!: readonly RelanceExportDto[];
}
