import { ApiProperty } from '@nestjs/swagger';

export class SanteDto {
  @ApiProperty({ enum: ['ok'] })
  readonly statut!: 'ok';

  @ApiProperty({ example: '0.1.42+a1b2c3d' })
  readonly version!: string;

  // Branche (ou tag) ayant produit ce build — affichée à côté de `version` en pied de barre
  // latérale (ex. « main 0.1.234 »). Voir apps/api/src/config/version-app.ts pour le calcul en
  // développement, et .github/workflows/publier-images.yml pour la valeur figée dans l'image de
  // production (github.ref_name : jamais un HEAD détaché, contrairement à une commande git
  // exécutée dans un conteneur sans .git).
  @ApiProperty({ example: 'main' })
  readonly branche!: string;
}

export class SantePreteDto {
  @ApiProperty({ enum: ['ok'] })
  readonly base!: 'ok';

  @ApiProperty({ enum: ['ok'] })
  readonly redis!: 'ok';
}
