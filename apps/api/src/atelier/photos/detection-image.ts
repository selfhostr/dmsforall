import type { TypeMimePhotoLigne } from '@dfa/shared';

/**
 * Type RÉEL d'une image d'après ses premiers octets — le `Content-Type` déclaré par le client et
 * le nom du fichier ne sont jamais crus. `heic` est reconnu uniquement pour refuser avec un
 * message utile (le serveur ne décode pas le HEIC).
 */
export type TypeImageDetecte = TypeMimePhotoLigne | 'heic' | 'inconnu';

const SIGNATURE_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MARQUES_HEIC = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

export function detecterTypeImage(octets: Buffer): TypeImageDetecte {
  if (octets.length >= 3 && octets[0] === 0xff && octets[1] === 0xd8 && octets[2] === 0xff) {
    return 'image/jpeg';
  }
  if (octets.length >= 8 && SIGNATURE_PNG.every((o, i) => octets[i] === o)) {
    return 'image/png';
  }
  if (octets.length >= 12 && octets.toString('latin1', 4, 8) === 'ftyp') {
    if (MARQUES_HEIC.has(octets.toString('latin1', 8, 12))) return 'heic';
  }
  return 'inconnu';
}
