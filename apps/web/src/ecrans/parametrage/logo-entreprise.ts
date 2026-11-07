import { LIMITE_TAILLE_LOGO_OCTETS, TYPES_MIME_LOGO } from '@dfa/shared';

export type RefusLogo = 'type' | 'taille';

/**
 * Premier filtre côté poste, pour éviter un envoi voué à l'échec : type déclaré par le navigateur
 * et taille. Le serveur reste juge (il lit les premiers octets du fichier).
 */
export function verifierFichierLogo(fichier: { type: string; size: number }): RefusLogo | null {
  if (!(TYPES_MIME_LOGO as readonly string[]).includes(fichier.type)) return 'type';
  if (fichier.size > LIMITE_TAILLE_LOGO_OCTETS) return 'taille';
  return null;
}
