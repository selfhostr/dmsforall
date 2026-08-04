import { z } from 'zod';

/**
 * Coercition « valeur unique -> tableau » pour les filtres de LISTE transmis en query string.
 *
 * LE PIÈGE, constaté en HTTP réel sur l'API en marche — pas une hypothèse de lecture de code :
 * Express ne construit `req.query.x` en tableau que lorsque le paramètre apparaît AU MOINS DEUX
 * FOIS dans l'URL (`?statut=en_cours&statut=termine`). Avec une seule occurrence
 * (`?statut=en_cours`), il transmet une simple chaîne. Un schéma `z.array(z.enum(...)).optional()`
 * est pourtant *exactement* le contrat qu'on veut décrire — « ce filtre accepte plusieurs
 * valeurs » — et il n'y a rien à corriger à sa lecture : le défaut est dans l'asymétrie du
 * transport HTTP entre une et plusieurs occurrences, pas dans la forme du schéma. Sans cette
 * coercition, la requête à une seule valeur échoue en `400 VALIDATION_ECHOUEE`
 * (`"expected array, received string"`) alors que la même requête à deux valeurs passe — ce qui
 * fait qu'un test manuel « avec plusieurs valeurs » ne le voit jamais, et que le cas qui casse est
 * justement le plus fréquent en usage réel (un seul statut coché, un seul filtre actif). C'est
 * ainsi que `usePointageOuvertTechnicien` (`statut: ['en_cours']`, un seul élément) a cassé
 * l'écran de pointage technicien en production alors que le front encode correctement le tableau
 * (`parametres.append('statut', valeur)` par élément, la façon standard d'encoder un tableau en
 * query string — ce n'est PAS le front qu'il faut corriger).
 *
 * Sémantique volontairement minimale, à ne pas enrichir : `undefined` reste `undefined` (un
 * filtre absent doit rester absent, jamais devenir `[]` — un tableau vide et « pas de filtre »
 * ne sont pas la même chose pour le code appelant), une valeur seule devient un tableau à un
 * élément, un tableau passe inchangé. Aucune validation de contenu ici : elle reste entièrement
 * à la charge du schéma `z.array(...)` qui reçoit le résultat coercé en aval (voir
 * `schemaListeQuery` ci-dessous) — `.enum(...)`, `.min()`, `.max()` etc. s'appliquent donc
 * normalement, exactement comme avant l'introduction de cette fonction.
 *
 * RÉSERVÉ AUX SCHÉMAS DE QUERY STRING (paramètres consommés via `@Query(...)` côté contrôleur).
 * Un tableau reçu dans un CORPS JSON (`@CorpsZod(...)`) est déjà un vrai tableau dès le parsing
 * HTTP — `JSON.parse('["a"]')` ne s'aplatit jamais en chaîne — donc l'appliquer là n'aurait
 * aucun effet utile, et masquerait silencieusement un vrai bug de contrat si un corps envoyait un
 * jour une chaîne au lieu d'un tableau à cet endroit (ce cas DOIT continuer à produire un 400).
 */
export function coercionListeQuery(valeur: unknown): unknown {
  if (valeur === undefined) {
    return undefined;
  }
  return Array.isArray(valeur) ? valeur : [valeur];
}

/**
 * Enveloppe `coercionListeQuery` autour d'un schéma élément pour le cas d'usage très majoritaire
 * de ce dépôt : un filtre multivaleur optionnel sur une query string, du type
 * `statut: schemaListeQuery(z.enum(STATUTS_X)).optional()`.
 *
 * `.optional()` reste à la charge de l'appelant, APRÈS l'appel — jamais intégré ici — pour deux
 * raisons : garder la forme visuellement proche de l'ancien `z.array(z.enum(...)).optional()`
 * (le diff de migration reste local à chaque ligne, sans réordonnancement) et permettre à un
 * futur filtre RÉELLEMENT obligatoire de composer `schemaListeQuery(...)` sans `.optional()`.
 * Note pour la relecture : une fois enveloppé dans `.optional()`, Zod court-circuite sur
 * `undefined` avant même d'invoquer la fonction de préprocessing — la branche `undefined` de
 * `coercionListeQuery` ne sert donc pas dans ce cas précis, mais reste nécessaire pour tout appel
 * direct de `schemaListeQuery(...)` sans `.optional()` derrière (champ requis dont l'absence doit
 * quand même produire l'erreur `expected array, received undefined`, un message plus juste que
 * s'il fallait deviner pourquoi une chaîne vide échoue).
 *
 * Si un filtre de query a un jour besoin de `.min()`/`.max()` sur le nombre d'éléments (aucun cas
 * aujourd'hui côté query — ce besoin n'existe pour l'instant que côté CORPS, volontairement hors
 * du champ de cette fonction, voir `atelier/avertissement.ts::schemaConfirmations`), composer
 * directement `z.preprocess(coercionListeQuery, z.array(schema).min(1))` plutôt que d'étendre
 * cette fonction : le nom `schemaListeQuery` doit rester lisible comme « le cas simple », et un
 * deuxième paramètre optionnel serait invisible à l'appel.
 */
export function schemaListeQuery<Schema extends z.ZodTypeAny>(schemaElement: Schema) {
  return z.preprocess(coercionListeQuery, z.array(schemaElement));
}
