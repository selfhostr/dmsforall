import { ErreurMetier } from '../erreurs/erreur-metier';

/** Contenu décodé d'un curseur de pagination : date de création + id, pour un tri stable. */
export interface DonneesCurseur {
  readonly creeLe: Date;
  readonly id: string;
}

const REGEX_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Encode `{creeLe, id}` en curseur opaque base64url : `{"c":"<ISO>","i":"<uuid>"}`.
 * Le tri de la liste sous-jacente doit être `(cree_le DESC, id DESC)` pour que ce curseur
 * reste cohérent d'une page à l'autre.
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
  let brut: string;
  try {
    brut = Buffer.from(curseur, 'base64url').toString('utf8');
  } catch {
    throw erreurCurseurInvalide();
  }

  let objet: unknown;
  try {
    objet = JSON.parse(brut);
  } catch {
    throw erreurCurseurInvalide();
  }

  if (
    typeof objet !== 'object' ||
    objet === null ||
    !('c' in objet) ||
    !('i' in objet) ||
    typeof (objet as Record<string, unknown>).c !== 'string' ||
    typeof (objet as Record<string, unknown>).i !== 'string'
  ) {
    throw erreurCurseurInvalide();
  }

  const { c, i } = objet as { c: string; i: string };
  const creeLe = new Date(c);
  if (Number.isNaN(creeLe.getTime()) || !REGEX_UUID.test(i)) {
    throw erreurCurseurInvalide();
  }

  return { creeLe, id: i };
}

function erreurCurseurInvalide(): ErreurMetier {
  return new ErreurMetier('VALIDATION_ECHOUEE', 'Curseur de pagination invalide.', {
    erreurs: [{ champ: 'curseur', code: 'curseur_invalide', message: 'Curseur de pagination illisible.' }],
  });
}
