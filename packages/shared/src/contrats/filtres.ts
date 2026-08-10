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

/**
 * Filtre booléen de query string, sans `z.coerce.boolean()`.
 *
 * LE PIÈGE (issue #43, prouvé en exécution — 3 pointages sains en base, 0 avec anomalie) :
 * `z.coerce.boolean()` délègue à `Boolean(valeur)`. Sur une chaîne, seule la chaîne VIDE est
 * falsy — `Boolean('false')`, `Boolean('0')`, `Boolean('non')` valent tous `true`. Une query
 * string HTTP ne transporte jamais de chaîne vide pour `?x=false` (c'est la chaîne NON vide
 * `"false"`), donc `z.coerce.boolean()` sur un paramètre d'URL coerce SYSTÉMATIQUEMENT à `true`
 * dès que le paramètre est présent — `?anomalie=false` et `?anomalie=true` produisaient alors
 * exactement le même filtre, et seule l'absence totale du paramètre changeait quoi que ce soit
 * (`GET /pointages?anomalie=false` rendait une liste vide au lieu des 3 pointages sains).
 *
 * Cette fonction distingue explicitement les trois états attendus d'un filtre booléen de query :
 * absent (pas de filtre — `.optional()` reste à la charge de l'appelant, même convention que
 * `schemaListeQuery`), `"true"`, `"false"`. Toute autre valeur (`"oui"`, `"1"`, `"TRUE"`…) est
 * REFUSÉE en `400 VALIDATION_ECHOUEE` plutôt que devinée — un paramètre mal orthographié doit
 * être visible à l'appelant, jamais silencieusement retomber sur « pas de filtre » ou sur une
 * valeur arbitraire.
 *
 * `valeurParDefaut` couvre le cas d'un filtre booléen de query avec une valeur par défaut si le
 * paramètre est absent (ex. `inclureAnciennesDetentions`) : NE PAS chaîner `.default(false)`
 * APRÈS l'appel de cette fonction — `z.enum(['true', 'false']).transform(...).default(false)`
 * casse, car `ZodDefault` réinjecte sa valeur par défaut (un booléen) en ENTRÉE du schéma
 * enveloppé (l'enum de CHAÎNES), pas en sortie du `transform`, et `'true'|'false'` n'accepte pas
 * un booléen. Passer `valeurParDefaut` ici applique le défaut AVANT le transform, au bon niveau.
 */
export function schemaBooleenQuery(valeurParDefaut?: boolean) {
  const base = z.enum(['true', 'false']);
  const schemaAvecDefaut =
    valeurParDefaut === undefined ? base : base.default(valeurParDefaut ? 'true' : 'false');
  return schemaAvecDefaut.transform((valeur) => valeur === 'true');
}
