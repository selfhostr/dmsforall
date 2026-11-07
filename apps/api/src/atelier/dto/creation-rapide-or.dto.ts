import { ApiProperty } from '@nestjs/swagger';
import type {
  ReponseClient,
  ReponseCreationRapideOrdreReparation,
  ReponseOrdreReparation,
  ReponseVehicule,
} from '@dfa/shared';

import { ClientDto } from '../../clients/dto/client.dto';
import { ReponseVehiculeDto } from '../../vehicules/dto/vehicule.dto';

import { ReponseOrdreReparationDto } from './ordre-reparation.dto';

/** `POST /ordres-reparation/creation-rapide` — voir `atelier/creation-rapide-or.ts`. */
export class ReponseCreationRapideOrdreReparationDto implements ReponseCreationRapideOrdreReparation {
  @ApiProperty({ type: () => ClientDto, description: 'Le client (créé ou existant).' })
  readonly client!: ReponseClient;

  @ApiProperty({ type: () => ReponseVehiculeDto, description: 'Le véhicule (créé ou existant).' })
  readonly vehicule!: ReponseVehicule;

  @ApiProperty({ type: () => ReponseOrdreReparationDto, description: "L'OR créé." })
  readonly ordreReparation!: ReponseOrdreReparation;
}
