import { ApiProperty } from '@nestjs/swagger';
import type { ReponseAccesTemporaire } from '@dfa/shared';

/** Rendue UNE SEULE FOIS (création ou réinitialisation d'accès) — jamais persistée en clair,
 *  jamais journalisée. Voir `apps/api/src/auth/generateur-mot-de-passe-temporaire.ts`. */
export class ReponseAccesTemporaireDto implements ReponseAccesTemporaire {
  @ApiProperty({
    example: 'k3f9Qz…',
    description:
      "Mot de passe temporaire en clair, à transmettre oralement à l'employé — ne réapparaît plus jamais.",
  })
  readonly motDePasseTemporaire!: string;
}
