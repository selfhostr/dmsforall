/** Projection Swagger des contrats `@dfa/shared` `capacites.ts` (voir l'en-tête de `auth.dto.ts`). */
import { ApiProperty } from '@nestjs/swagger';
import {
  DOMAINES_CAPACITE,
  IDS_PREREGLAGE,
  NIVEAUX_ACCES,
  ROLES_PERSONNE,
  type CapacitesPersonne,
  type DomaineModele,
  type ModeleCapacites,
  type NiveauModele,
  type OptionModele,
  type PrereglageModele,
} from '@dfa/shared';

export class NiveauxCapacitesDto {
  @ApiProperty({ enum: NIVEAUX_ACCES }) atelier!: CapacitesPersonne['niveaux']['atelier'];
  @ApiProperty({ enum: NIVEAUX_ACCES }) accueil!: CapacitesPersonne['niveaux']['accueil'];
  @ApiProperty({ enum: NIVEAUX_ACCES }) facturation!: CapacitesPersonne['niveaux']['facturation'];
  @ApiProperty({ enum: NIVEAUX_ACCES }) pieces!: CapacitesPersonne['niveaux']['pieces'];
  @ApiProperty({ enum: NIVEAUX_ACCES }) ventes!: CapacitesPersonne['niveaux']['ventes'];
  @ApiProperty({ enum: NIVEAUX_ACCES }) finances!: CapacitesPersonne['niveaux']['finances'];
}

export class OptionsCapacitesDto {
  @ApiProperty({ description: 'Voit les prix de vente, totaux et montants.' })
  voitMontants!: boolean;
  @ApiProperty({ description: "Voit les prix d'achat et marges (pièces)." })
  voitPrixAchat!: boolean;
  @ApiProperty({ description: "Avoirs plafonnés au plafond d'avoir du garage (une contrainte)." })
  avoirsPlafonnes!: boolean;
}

export class GrilleCapacitesDto {
  @ApiProperty({ type: () => NiveauxCapacitesDto }) niveaux!: NiveauxCapacitesDto;
  @ApiProperty({ description: 'Corriger les heures des autres, rouvrir un OR, lever un blocage.' })
  encadrer!: boolean;
  @ApiProperty({ description: 'Employés & réglages (comptes, bornes). Suit le préréglage.' })
  gererEmployes!: boolean;
  @ApiProperty({ description: 'Gestes irréversibles (IBAN, reprise). Suit le préréglage.' })
  patron!: boolean;
  @ApiProperty({ type: () => OptionsCapacitesDto }) options!: OptionsCapacitesDto;
}

export class CapacitesPersonneDto extends GrilleCapacitesDto implements CapacitesPersonne {
  @ApiProperty({ enum: IDS_PREREGLAGE, nullable: true, type: String })
  prereglage!: CapacitesPersonne['prereglage'];
  @ApiProperty({ description: 'La grille diffère du préréglage du rôle.' })
  personnalisee!: boolean;
}

export class DomaineModeleDto implements DomaineModele {
  @ApiProperty({ enum: DOMAINES_CAPACITE }) id!: DomaineModele['id'];
  @ApiProperty() libelleCle!: string;
  @ApiProperty() descriptionCle!: string;
  @ApiProperty({ type: [String] }) exemplesCles!: readonly string[];
}

export class NiveauModeleDto implements NiveauModele {
  @ApiProperty({ enum: NIVEAUX_ACCES }) id!: NiveauModele['id'];
  @ApiProperty() libelleCle!: string;
}

export class OptionModeleDto implements OptionModele {
  @ApiProperty({ enum: ['voitMontants', 'voitPrixAchat', 'avoirsPlafonnes'] })
  id!: OptionModele['id'];
  @ApiProperty() libelleCle!: string;
  @ApiProperty() descriptionCle!: string;
}

export class CleCaseDto {
  @ApiProperty() libelleCle!: string;
  @ApiProperty() descriptionCle!: string;
}

export class PrereglageModeleDto implements PrereglageModele {
  @ApiProperty({ enum: IDS_PREREGLAGE }) id!: PrereglageModele['id'];
  @ApiProperty({ enum: ROLES_PERSONNE }) roleOrigine!: PrereglageModele['roleOrigine'];
  @ApiProperty() libelleCle!: string;
  @ApiProperty() descriptionCle!: string;
  @ApiProperty({ type: () => GrilleCapacitesDto }) grille!: GrilleCapacitesDto;
}

export class ModeleCapacitesDto implements ModeleCapacites {
  @ApiProperty({ type: () => [DomaineModeleDto] }) domaines!: readonly DomaineModeleDto[];
  @ApiProperty({ type: () => [NiveauModeleDto] }) niveaux!: readonly NiveauModeleDto[];
  @ApiProperty({ type: () => [OptionModeleDto] }) options!: readonly OptionModeleDto[];
  @ApiProperty({ type: () => CleCaseDto }) encadrer!: CleCaseDto;
  @ApiProperty({ type: () => CleCaseDto }) gererEmployes!: CleCaseDto;
  @ApiProperty({ type: () => [PrereglageModeleDto] }) prereglages!: readonly PrereglageModeleDto[];
}
