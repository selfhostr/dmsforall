import { TRI_DEFAUT_CREATION } from '@dfa/shared';
import { ErreurMetier } from '../erreurs/erreur-metier';

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
 */
export function decoderCurseurTrie(curseur: string, triAttendu: string): DonneesCurseurTrie {
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
    return { tri: t, valeur: v, id: i };
  }

  if (estChargeV1(objet)) {
    const donneesV1 = validerChargeV1(objet);
    if (triAttendu !== TRI_DEFAUT_CREATION) {
      throw erreurCurseurInvalide();
    }
    return { tri: TRI_DEFAUT_CREATION, valeur: donneesV1.creeLe.toISOString(), id: donneesV1.id };
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

function erreurCurseurInvalide(): ErreurMetier {
  return new ErreurMetier('VALIDATION_ECHOUEE', 'Curseur de pagination invalide.', {
    erreurs: [
      { champ: 'curseur', code: 'curseur_invalide', message: 'Curseur de pagination illisible.' },
    ],
  });
}
