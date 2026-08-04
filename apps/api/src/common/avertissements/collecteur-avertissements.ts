import type { Avertissement, CodeAvertissement, ReponseAvecAvertissements } from '@dfa/shared';

/**
 * Accumulateur d'avertissements pendant l'exécution d'UNE commande métier d'écriture.
 *
 * Un service instancie un `CollecteurAvertissements` en tête de méthode, y ajoute au fil de
 * l'eau (doublon client probable, kilométrage aberrant, plafond de planning dépassé…) puis
 * enveloppe le résultat avec `envelopper()` avant de le renvoyer au contrôleur — c'est la seule
 * façon de produire `ReponseAvecAvertissements<T>` (contrats-api-etape-1.md §7.1) : `avertissements`
 * y est présent même vide (`[]`), jamais absent, pour ne jamais devoir transformer plus tard un
 * endpoint « nu » en endpoint enveloppé (une rupture de contrat).
 *
 * Toujours une instance PAR APPEL — jamais partagée entre deux requêtes ni entre deux services :
 * ce n'est pas un provider NestJS, c'est une valeur locale à la méthode.
 */
export class CollecteurAvertissements {
  private readonly avertissements: Avertissement[] = [];

  /** Ajoute un avertissement, dans l'ordre où il est détecté. */
  ajouter(
    code: CodeAvertissement,
    message: string,
    donnees?: Readonly<Record<string, unknown>>,
  ): void {
    this.avertissements.push(
      donnees !== undefined ? { code, message, donnees } : { code, message },
    );
  }

  estVide(): boolean {
    return this.avertissements.length === 0;
  }

  /** Copie défensive — l'appelant ne peut pas muter l'accumulateur par la liste rendue. */
  liste(): readonly Avertissement[] {
    return [...this.avertissements];
  }

  /** Enveloppe `donnees` avec les avertissements accumulés jusqu'ici. */
  envelopper<T>(donnees: T): ReponseAvecAvertissements<T> {
    return { donnees, avertissements: this.liste() };
  }
}
