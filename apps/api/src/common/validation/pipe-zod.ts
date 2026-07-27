import { Injectable, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { ErreurMetier } from '../erreurs/erreur-metier';

/**
 * Pipe de validation générique : il ne connaît AUCUN schéma métier, on lui passe le schéma
 * zod à appliquer au cas par cas (`new PipeZod(schemaConnexion)`, `new PipeZod(schemaParametresPage)`…).
 * Toute erreur de validation devient `400 VALIDATION_ECHOUEE` avec le détail par champ.
 */
@Injectable()
export class PipeZod<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(valeur: unknown): T {
    const resultat = this.schema.safeParse(valeur);
    if (!resultat.success) {
      const erreurs = resultat.error.issues.map((issue) => ({
        champ: issue.path.length > 0 ? issue.path.join('.') : '(racine)',
        code: issue.code,
        message: issue.message,
      }));
      throw new ErreurMetier('VALIDATION_ECHOUEE', 'Validation échouée.', { erreurs });
    }
    return resultat.data;
  }
}
