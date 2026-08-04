import { ApiProperty } from '@nestjs/swagger';
import type { Type } from '@nestjs/common';
import type { Avertissement, ReponseAvecAvertissements } from '@dfa/shared';
import { AvertissementVehiculeDto } from './avertissement.dto';

/**
 * Fabrique de DTO d'enveloppe `{ donnees, avertissements }` (contrats-api-etape-1.md §7.1),
 * appliquée à TOUTE création/modification du module véhicules — la règle vit dans
 * `@dfa/shared/contrats/atelier/avertissement.ts` (« Présente même sur les endpoints qui
 * n'avertiront jamais ») et prime sur la colonne « 2xx » plus laconique de §7.4, qui omet parfois
 * le mot « enveloppe » par concision tabulaire sans jamais le contredire.
 *
 * Mixin de classe (pattern Nest standard pour les DTO génériques) : chaque appel produit une
 * classe distincte portant ses propres décorateurs `@ApiProperty`, nécessaire parce que
 * `@nestjs/swagger` lit les métadonnées de décorateurs sur la classe concrète, pas sur un
 * générique TypeScript effacé à la compilation.
 */
export function EnveloppeDto<T>(
  classeDonnees: Type<T>,
  nom: string,
): Type<ReponseAvecAvertissements<T>> {
  class EnveloppeGeneree implements ReponseAvecAvertissements<T> {
    @ApiProperty({ type: () => classeDonnees })
    readonly donnees!: T;

    @ApiProperty({ type: () => [AvertissementVehiculeDto] })
    readonly avertissements!: readonly Avertissement[];
  }

  Object.defineProperty(EnveloppeGeneree, 'name', { value: `Enveloppe${nom}Dto` });
  return EnveloppeGeneree as Type<ReponseAvecAvertissements<T>>;
}
