import { z } from 'zod';

import { TYPES_RESULTAT_RECHERCHE, type TypeResultatRecherche } from './enums';
import { schemaListeQuery } from '../filtres';

/**
 * Recherche unifiée (contrats-api-etape-1.md §7.5, D-08).
 *
 * NOTE DE PÉRIMÈTRE : fichier AJOUTÉ à la liste nominale de `plan-lot1-execution.md` §6.1, pour la
 * même raison que `parametrage.ts` — L1-11 en a besoin et `packages/shared` est gelé ensuite.
 *
 * `GET /recherche` est une PROJECTION, pas une collection : `limite` <= 50, **pas de curseur**.
 * Un `curseurSuivant` inciterait à paginer une recherche floue dont le classement change à chaque
 * frappe ; on veut les meilleurs résultats, pas la page 3.
 */

/** Où la correspondance a été trouvée, et si c'est un rattachement HISTORIQUE. */
export interface CorrespondanceRecherche {
  readonly champ: string;
  readonly valeur: string;
  /**
   * CT-05 / RM-17 : `true` quand la plaque a été portée par ce véhicule dans le PASSÉ. Le
   * véhicule courant sort en premier ; l'historique est signalé, jamais confondu. Sans ce
   * drapeau, une plaque réattribuée ferait ouvrir l'OR sur le mauvais véhicule.
   */
  readonly historique: boolean;
  readonly porteeJusquLe?: string;
}

export interface ResultatRecherche {
  readonly type: TypeResultatRecherche;
  readonly id: string;
  /** Pertinence dans `[0,1]`, décroissante. */
  readonly score: number;
  readonly correspondance: CorrespondanceRecherche;
  /**
   * Résumé d'affichage, dépendant du `type`. Additif : on ajoute des clés, jamais on n'en retire.
   * Les clés monétaires sont retirées côté serveur pour un rôle sans droit aux montants.
   */
  readonly resume: Readonly<Record<string, unknown>>;
}

export interface ReponseRecherche {
  readonly resultats: readonly ResultatRecherche[];
  /**
   * RM-18 / §6.9 : `true` quand la plaque cherchée est INTERCHANGEABLE. Les DEUX véhicules sont
   * alors retournés — **le serveur ne choisit jamais à la place de l'utilisateur.**
   */
  readonly plaqueInterchangeable: boolean;
}

/**
 * `types` est RÉPÉTABLE (`?types=vehicule&types=client`) — jamais une liste séparée par virgules.
 *
 * `q` est normalisé PAR LE SERVEUR (casse, accents, espaces, apostrophes, tirets, points), qui
 * détecte aussi la forme saisie (2 lettres + chiffres -> plaque ; 17 caractères -> VIN ; `@` ->
 * e-mail ; `OR-` -> numéro d'OR) et cherche par fragment (CT-04).
 *
 * La normalisation est SERVEUR parce qu'elle doit être identique à celle des index d'expression
 * (`normaliser_recherche()`). Deux normalisations divergentes — l'une en TypeScript navigateur,
 * l'autre en SQL — produiraient des résultats manquants indébogables.
 */
export const schemaParametresRecherche = z.object({
  q: z.string().trim().min(1).max(120),
  types: schemaListeQuery(z.enum(TYPES_RESULTAT_RECHERCHE)).optional(),
  limite: z.coerce.number().int().min(1).max(50).default(20),
});

export type ParametresRecherche = z.infer<typeof schemaParametresRecherche>;
