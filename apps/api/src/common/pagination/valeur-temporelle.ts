/**
 * Valeur de curseur pour un tri sur colonne `timestamptz` — SANS jamais transiter par un objet
 * `Date` JavaScript.
 *
 * ## Le bug corrigé ici (constat mesuré le 2026-07-29, jeu de démonstration)
 *
 * `GET /vehicules?tri=creeLe:desc&limite=2` : la page 2 revenait VIDE alors que 2 véhicules
 * restaient à afficher — aucune erreur, la pagination s'arrêtait juste silencieusement trop tôt.
 *
 * Cause : PostgreSQL conserve un `timestamptz` à la MICROSECONDE
 * (`select v.cree_le::text from public.vehicule v` → `2026-07-29 13:37:35.171181+00`), mais
 * `Date` de JavaScript ne peut représenter que la MILLISECONDE depuis l'epoch — c'est une limite
 * STRUCTURELLE du type, pas un détail d'implémentation contournable. Le code de construction de la
 * valeur de curseur faisait `enDate(brut).toISOString()` (`vehicules/service-vehicule.ts`,
 * `valeurDeTri()`), ce qui tronque SILENCIEUSEMENT toute microseconde non nulle :
 * `new Date('2026-07-29 13:37:35.171181+00').toISOString()` → `'2026-07-29T13:37:35.171Z'`.
 *
 * La comparaison keyset `(v.cree_le, v.id) < (curseur.valeur::timestamptz, curseur.id)` compare
 * alors une valeur RÉELLE à pleine précision à un seuil TRONQUÉ : toute ligne dont la microseconde
 * réelle dépasse la valeur tronquée du curseur est exclue à tort, quel que soit `id`. Ça ne
 * plante jamais — ça saute des lignes. Le jeu de démonstration rend le défaut visible parce que
 * ses 4 véhicules partagent la même microseconde de création (insertion en lot), mais la cause
 * générale frappe tout lot de lignes qui partagent seulement la même MILLISECONDE — typiquement
 * une reprise de données ou un import.
 *
 * Constat additionnel, en amont de `enDate()` : le pilote `pg`, laissé à sa configuration par
 * défaut (`apps/api/src/db/acces-base.service.ts`), parse DÉJÀ une colonne `timestamptz` en
 * `Date` au niveau du pilote — mesuré directement (`SELECT v.cree_le` via le même `Pool`/`drizzle`
 * que l'application rend `{ cree_le: 2026-07-29T13:37:35.171Z }`, `instanceof Date === true`).
 * La perte a donc lieu AVANT même qu'un `enDate(...).toISOString()` applicatif s'exécute : retirer
 * cet appel ne suffit pas. La colonne source doit être lue en TEXTE — `::text` explicite dans le
 * `SELECT` (`v.cree_le::text as cree_le`), pas de dépendance au comportement par défaut du pilote —
 * pour que la microseconde survive jusqu'à cette fonction. Voir la liste des appelants à adapter
 * dans le rapport qui accompagne ce correctif ; ce module ne peut pas la corriger lui-même (hors
 * de son périmètre d'écriture).
 *
 * ## Ce que fait cette fonction
 *
 * Valide que la valeur reçue est bien le texte natif rendu par PostgreSQL pour un `timestamptz`
 * (jamais un `Date` : un `Date` ici signifierait que la microseconde a déjà été perdue en amont —
 * la recevoir serait dissimuler la perte, pas la corriger), puis la reformate en ISO-8601
 * canonique à microseconde FIXE (6 chiffres, zéros de fin restitués — PostgreSQL les tronque à
 * l'affichage) et décalage explicite (`+00:00`, jamais `Z` seul ni `+00` nu). Le résultat est :
 *   - un littéral valide pour un cast SQL `::timestamptz` en aller-retour EXACT ;
 *   - trié lexicographiquement comme chaîne dans le même ordre que la valeur temporelle qu'il
 *     représente, à décalage constant (propriété non exploitée par le tri SQL réel, qui recompare
 *     via `::timestamptz`, mais utile aux tests et au débogage).
 *
 * Usage attendu : remplace tout `enDate(brut).toISOString()` au moment de construire la `valeur`
 * d'un curseur v2 (`DonneesCurseurTrie.valeur`) sur un tri temporel — jamais pour l'affichage
 * (là, la précision milliseconde de `Date`/`toISOString()` reste appropriée).
 */

const FORMAT_TIMESTAMPTZ_PG =
  /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/;

export function valeurCurseurTimestamptz(brut: string): string {
  if (typeof brut !== 'string') {
    throw new Error(
      'valeurCurseurTimestamptz attend le texte brut rendu par PostgreSQL pour un "timestamptz" ' +
        `(colonne sélectionnée avec un cast "::text", jamais laissée au parseur par défaut du ` +
        `pilote) — reçu un ${typeof brut}. Un Date ici signifierait que la microseconde a déjà ` +
        `été perdue en amont (Date ne stocke que la milliseconde) : le lui passer dissimulerait ` +
        `la perte plutôt que de la corriger. Voir la documentation de ce module.`,
    );
  }

  const trouve = FORMAT_TIMESTAMPTZ_PG.exec(brut.trim());
  if (!trouve) {
    throw new Error(
      `valeurCurseurTimestamptz : format inattendu pour un timestamptz PostgreSQL : "${brut}". ` +
        'Format attendu : "AAAA-MM-JJ HH:MI:SS[.ffffff][+-]HH[:MM]" (texte natif PostgreSQL) ou ' +
        'la même chose au format ISO-8601 avec séparateur "T" et/ou suffixe "Z".',
    );
  }

  const [, date, heure, fraction, decalageBrut] = trouve;
  const microsecondes = (fraction ?? '').padEnd(6, '0');
  const decalage = normaliserDecalage(decalageBrut!);

  return `${date}T${heure}.${microsecondes}${decalage}`;
}

/** `"Z"` → `"+00:00"`, `"+00"` → `"+00:00"`, `"+0530"` / `"+05:30"` → `"+05:30"`. */
function normaliserDecalage(brut: string): string {
  if (brut === 'Z') return '+00:00';
  const signe = brut[0];
  const chiffres = brut.slice(1).replace(':', '');
  const heures = chiffres.slice(0, 2);
  const minutes = chiffres.length > 2 ? chiffres.slice(2, 4) : '00';
  return `${signe}${heures}:${minutes}`;
}
