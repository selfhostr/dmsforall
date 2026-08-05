import { TRI_DEFAUT_CREATION } from '@dfa/shared';
import { ErreurMetier } from '../erreurs/erreur-metier';
import { valeurCurseurTimestamptz } from './valeur-temporelle';

/** Contenu décodé d'un curseur de pagination : date de création + id, pour un tri stable. */
export interface DonneesCurseur {
  readonly creeLe: Date;
  readonly id: string;
}

/**
 * Contenu décodé d'un curseur de pagination TRIABLE (v2, contrats-api-etape-1.md §6.1).
 * `tri` est la forme `<champ>:<asc|desc>` (voir `REGEX_TRI` de `@dfa/shared`) ; `valeur` est la
 * clé de tri du dernier élément rendu — chaîne, entier ou `null` (colonne nullable, `NULLS LAST`).
 */
export interface DonneesCurseurTrie {
  readonly tri: string;
  readonly valeur: string | number | null;
  readonly id: string;
}

/**
 * Nature attendue du CONTENU de `valeur` pour le tri demandé — au-delà de sa simple forme
 * (`string | number | null`, déjà vérifiée par `estValeurTriValide`).
 *
 * `'temporel'` : le tri porte sur une colonne (ou expression) `timestamptz` — `valeur`, si non
 * `null`, DOIT être le texte natif PostgreSQL d'un tel horodatage (voir `valeurCurseurTimestamptz`,
 * `./valeur-temporelle.ts`). `'texte'` (défaut) : aucune validation de contenu au-delà de la forme
 * générique — comportement HISTORIQUE, conservé pour compatibilité ascendante stricte des
 * appelants qui ne précisent pas encore ce paramètre (voir `decoderCurseurTrie`).
 */
export type TypeValeurCurseur = 'texte' | 'temporel';

const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Encode `{creeLe, id}` en curseur opaque base64url : `{"c":"<ISO>","i":"<uuid>"}`.
 * Le tri de la liste sous-jacente doit être `(cree_le DESC, id DESC)` pour que ce curseur
 * reste cohérent d'une page à l'autre.
 *
 * INCHANGÉE (contrat v1, socle étape 0) : c'est cette invariance qui garantit qu'un curseur v1
 * distribué avant l'étape 1 reste décodable indéfiniment (voir `decoderCurseurTrie` ci-dessous).
 */
export function encoderCurseur(donnees: DonneesCurseur): string {
  const brut = JSON.stringify({ c: donnees.creeLe.toISOString(), i: donnees.id });
  return Buffer.from(brut, 'utf8').toString('base64url');
}

/**
 * Décode un curseur opaque. Toute anomalie (base64 invalide, JSON invalide, champs
 * manquants, date ou uuid mal formés) doit se traduire par `400 VALIDATION_ECHOUEE` côté
 * client — jamais par une erreur 500 : le curseur est une donnée fournie par le client.
 */
export function decoderCurseur(curseur: string): DonneesCurseur {
  return validerChargeV1(decoderBase64Json(curseur));
}

/**
 * Encode `{tri, valeur, id}` en curseur opaque base64url v2 : `{"t":"…","v":…,"i":"…"}`
 * (contrats-api-etape-1.md §6.1, `DonneesCurseurV2` de `@dfa/shared`).
 */
export function encoderCurseurTrie(donnees: DonneesCurseurTrie): string {
  const brut = JSON.stringify({ t: donnees.tri, v: donnees.valeur, i: donnees.id });
  return Buffer.from(brut, 'utf8').toString('base64url');
}

/**
 * Décode un curseur en le rattachant au `tri` DEMANDÉ par la requête courante — c'est la
 * fonction que tout service de liste doit appeler dès qu'il expose un paramètre `tri`.
 *
 * Deux formes acceptées, dans cet ordre :
 *   1. v2 `{t,v,i}` : le curseur porte lui-même son tri. `t` doit être IDENTIQUE à `triAttendu`,
 *      sinon `400 VALIDATION_ECHOUEE` avec `erreurs[0].champ = "curseur"` — jamais une page
 *      silencieusement fausse (un client qui change de tri en cours de pagination doit
 *      recommencer du début, pas halluciner une continuité qui n'existe pas).
 *   2. v1 `{c,i}` (curseur historique, socle étape 0) : DÉCODABLE INDÉFINIMENT, traité comme
 *      équivalent à `t = TRI_DEFAUT_CREATION`. N'est accepté que si `triAttendu` est justement
 *      `TRI_DEFAUT_CREATION` — un curseur v1 ne peut pas mentir sur un tri qu'il ne connaît pas.
 *
 * Toute anomalie de forme (les deux ci-dessus confondues) produit `VALIDATION_ECHOUEE`, jamais
 * une exception non typée.
 *
 * DÉFAUT CORRIGÉ (constaté en exécution réelle, `GET /sites/{id}/hangar-pneus` → `500
 * ERREUR_INTERNE` sur un curseur v2 syntaxiquement valide) : cette fonction ne validait la forme de
 * `v` que jusqu'à `string | number | null` (`estValeurTriValide`), jamais son CONTENU. Un curseur
 * portant un tri sur colonne `timestamptz` mais une valeur qui n'était pas un horodatage bien
 * formé traversait tout ce décodage intact, puis devenait un littéral non castable dans la clause
 * `WHERE` construite par l'appelant — PostgreSQL levait alors une erreur native (`22007`) qu'aucun
 * code applicatif n'interceptait. Le paramètre `typeValeur` ci-dessous ferme ce trou : chaque
 * appelant connaît déjà la nature de la colonne qu'il trie (c'est exactement ce que porte son
 * `DefinitionTri.temporel` local dans les copies module-locales de la mécanique de curseur triable)
 * et peut donc demander la validation de contenu appropriée — ici, au décodage, plutôt que
 * dupliquée dans chaque copie.
 *
 * `typeValeur` par défaut à `'texte'` (comportement historique, INCHANGÉ) : un appelant qui ne
 * précise pas ce paramètre continue de se comporter exactement comme avant — aucune régression,
 * mais reste exposé à ce défaut jusqu'à sa mise à jour pour passer `'temporel'` où pertinent.
 */
export function decoderCurseurTrie(
  curseur: string,
  triAttendu: string,
  typeValeur: TypeValeurCurseur = 'texte',
): DonneesCurseurTrie {
  const objet = decoderBase64Json(curseur);

  if (estChargeV2(objet)) {
    const { t, v, i } = objet;
    if (
      typeof t !== 'string' ||
      typeof i !== 'string' ||
      !REGEX_UUID.test(i) ||
      !estValeurTriValide(v)
    ) {
      throw erreurCurseurInvalide();
    }
    if (t !== triAttendu) {
      throw erreurCurseurInvalide();
    }
    validerContenuValeur(v, typeValeur);
    return { tri: t, valeur: v, id: i };
  }

  if (estChargeV1(objet)) {
    const donneesV1 = validerChargeV1(objet);
    if (triAttendu !== TRI_DEFAUT_CREATION) {
      throw erreurCurseurInvalide();
    }
    // Toujours un horodatage ISO valide (construit depuis un `Date` déjà validé ci-dessus par
    // `validerChargeV1`) : la validation de contenu ne peut jamais y échouer, mais on la fait tout
    // de même transiter pour rester sur un seul chemin de vérité — pas de branche non couverte.
    const valeur = donneesV1.creeLe.toISOString();
    validerContenuValeur(valeur, typeValeur);
    return { tri: TRI_DEFAUT_CREATION, valeur, id: donneesV1.id };
  }

  throw erreurCurseurInvalide();
}

// ---------------------------------------------------------------------------------------------
// Décodage bas niveau, partagé entre v1 et v2
// ---------------------------------------------------------------------------------------------

function decoderBase64Json(curseur: string): unknown {
  let brut: string;
  try {
    brut = Buffer.from(curseur, 'base64url').toString('utf8');
  } catch {
    throw erreurCurseurInvalide();
  }

  try {
    return JSON.parse(brut);
  } catch {
    throw erreurCurseurInvalide();
  }
}

function estObjet(objet: unknown): objet is Record<string, unknown> {
  return typeof objet === 'object' && objet !== null && !Array.isArray(objet);
}

function estChargeV1(objet: unknown): objet is { c: unknown; i: unknown } {
  return estObjet(objet) && 'c' in objet && 'i' in objet;
}

function estChargeV2(objet: unknown): objet is { t: unknown; v: unknown; i: unknown } {
  return estObjet(objet) && 't' in objet && 'v' in objet && 'i' in objet;
}

function estValeurTriValide(v: unknown): v is string | number | null {
  return typeof v === 'string' || typeof v === 'number' || v === null;
}

function validerChargeV1(objet: unknown): DonneesCurseur {
  if (!estChargeV1(objet) || typeof objet.c !== 'string' || typeof objet.i !== 'string') {
    throw erreurCurseurInvalide();
  }

  const { c, i } = objet;
  const creeLe = new Date(c);
  if (Number.isNaN(creeLe.getTime()) || !REGEX_UUID.test(i)) {
    throw erreurCurseurInvalide();
  }

  return { creeLe, id: i };
}

/**
 * Valide le CONTENU de `valeur` pour `typeValeur === 'temporel'` — `'texte'` ne rajoute aucune
 * contrainte (comportement historique). `null` est toujours accepté (colonne nullable, `NULLS
 * LAST`) quel que soit `typeValeur` : un curseur forgé peut prétendre `null` sur une colonne non
 * nullable sans risque, `construireConditionKeyset` ne rendant alors simplement aucune ligne.
 */
function validerContenuValeur(valeur: string | number | null, typeValeur: TypeValeurCurseur): void {
  if (typeValeur !== 'temporel' || valeur === null) return;
  if (typeof valeur === 'string') {
    try {
      valeurCurseurTimestamptz(valeur);
      return;
    } catch {
      // Tombe dans le rejet commun ci-dessous — même code/statut que le reste de ce module.
    }
  }
  throw erreurCurseurInvalide();
}

function erreurCurseurInvalide(): ErreurMetier {
  return new ErreurMetier('VALIDATION_ECHOUEE', 'Curseur de pagination invalide.', {
    erreurs: [
      { champ: 'curseur', code: 'curseur_invalide', message: 'Curseur de pagination illisible.' },
    ],
  });
}
