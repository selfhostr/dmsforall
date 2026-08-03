import { ApiProperty } from '@nestjs/swagger';
import type { Type } from '@nestjs/common';
import type { Avertissement, PageCurseur, ReponseAvecAvertissements } from '@dfa/shared';

import { AvertissementPointageDto } from './avertissement.dto';

/** Fabrique de DTO d'enveloppe `{ donnees, avertissements }` — copie locale, voir `avertissement.dto.ts`. */
export function EnveloppePointageDto<T>(classeDonnees: Type<T>, nom: string): Type<ReponseAvecAvertissements<T>> {
  class EnveloppeGeneree implements ReponseAvecAvertissements<T> {
    @ApiProperty({ type: () => classeDonnees })
    readonly donnees!: T;

    @ApiProperty({ type: () => [AvertissementPointageDto] })
    readonly avertissements!: readonly Avertissement[];
  }

  Object.defineProperty(EnveloppeGeneree, 'name', { value: `Enveloppe${nom}Dto` });
  return EnveloppeGeneree as Type<ReponseAvecAvertissements<T>>;
}

/** Fabrique de DTO `PageCurseur<T>` (§3.6) — pagination par curseur opaque. */
export function PagePointageDto<T>(classeDonnees: Type<T>, nom: string): Type<PageCurseur<T>> {
  class PageGeneree implements PageCurseur<T> {
    @ApiProperty({ type: () => [classeDonnees] })
    readonly donnees!: readonly T[];

    @ApiProperty({ type: String, nullable: true, description: 'Opaque base64url ; null = fin de liste.' })
    readonly curseurSuivant!: string | null;

    @ApiProperty({ example: 50 })
    readonly limite!: number;
  }

  Object.defineProperty(PageGeneree, 'name', { value: `Page${nom}Dto` });
  return PageGeneree as Type<PageCurseur<T>>;
}
