/**
 * DTO Swagger de la ressource racine `DossierReprise` — seule ressource du module dont la forme
 * est stable et peu profonde (pas de JSONB variable) : modélisée intégralement en classes
 * `@ApiProperty`. Les sous-ressources singleton (analyse/plan/import/rapport) portent, elles, des
 * listes JSONB à structure ouverte (§ tête de `db/migrations/0067_reprise_donnees.sql`) —
 * documentées par `@ApiResponse({ schema: { type: 'object' } })` sur leurs contrôleurs plutôt que
 * par une hiérarchie de classes profonde : simplification DÉLIBÉRÉE, signalée au rapport de
 * livraison plutôt que silencieuse.
 */

import { ApiProperty } from '@nestjs/swagger';
import {
  STATUTS_DOSSIER_REPRISE,
  type ArchiveDeposeeReprise,
  type ReponseCreationDossierReprise,
  type ReponseDossierReprise,
  type StatutDossierReprise,
} from '@dfa/shared';

export class ArchiveDeposeeRepriseDto implements ArchiveDeposeeReprise {
  @ApiProperty() tailleOctetsAnnoncee!: number;
  @ApiProperty() octetsRecus!: number;
  @ApiProperty({ nullable: true, type: Number }) dernierNumeroTrancheRecuContigu!: number | null;
  @ApiProperty() empreinteSha256Annoncee!: string;
  @ApiProperty({ nullable: true, type: String }) empreinteSha256Verifiee!: string | null;
  @ApiProperty({ nullable: true, type: Boolean }) integriteValidee!: boolean | null;
}

export class ReponseDossierRepriseDto implements ReponseDossierReprise {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: STATUTS_DOSSIER_REPRISE }) statut!: StatutDossierReprise;
  @ApiProperty({ type: ArchiveDeposeeRepriseDto }) archive!: ArchiveDeposeeReprise;
  @ApiProperty({ nullable: true, type: String }) analyseId!: string | null;
  @ApiProperty({ nullable: true, type: String }) planId!: string | null;
  @ApiProperty({ nullable: true, type: String }) importId!: string | null;
  @ApiProperty() creeLe!: string;
  @ApiProperty() modifieLe!: string;
}

export class ReponseCreationDossierRepriseDto implements ReponseCreationDossierReprise {
  @ApiProperty({ type: ReponseDossierRepriseDto }) dossier!: ReponseDossierReprise;
  @ApiProperty() tailleTrancheRecommandeeOctets!: number;
}

export class PageDossierRepriseDto {
  @ApiProperty({ type: [ReponseDossierRepriseDto] }) donnees!: readonly ReponseDossierReprise[];
  @ApiProperty({ nullable: true, type: String }) curseurSuivant!: string | null;
  @ApiProperty() limite!: number;
}

export class ReponseTrancheDeposeeDto {
  @ApiProperty() numero!: number;
  @ApiProperty() octetsRecus!: number;
  @ApiProperty() toutesTranchesRecues!: boolean;
}
