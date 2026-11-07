import { TYPES_MIME_LOGO, type TypeMimeLogo } from '@dfa/shared';

const SIGNATURE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SIGNATURE_JPEG = Buffer.from([0xff, 0xd8, 0xff]);

/**
 * Éléments/attributs SVG refusés : un SVG est du XML exécutable dans un navigateur
 * (`<script>`, gestionnaires `on*=`, `javascript:`, `<foreignObject>`, entités XML, ressources
 * externes). Liste de REFUS volontairement stricte — un logo simple n'en a besoin d'aucun.
 */
const MOTIFS_SVG_REFUSES: readonly RegExp[] = [
  /<\s*script/i,
  /<\s*foreignObject/i,
  /<\s*iframe/i,
  /<\s*embed/i,
  /<\s*object/i,
  /<!ENTITY/i,
  /<!DOCTYPE[^>]*\[/i,
  /\bon[a-z]+\s*=/i,
  /javascript\s*:/i,
  /(?:href|src)\s*=\s*["']\s*(?:https?:|\/\/|data:text)/i,
  /url\(\s*["']?\s*(?:https?:|\/\/)/i,
];

/**
 * Type d'un fichier logo d'après ses PREMIERS OCTETS (jamais l'extension ni le MIME déclaré par le
 * client). `null` = format refusé ou SVG dangereux.
 */
export function detecterTypeLogo(contenu: Buffer): TypeMimeLogo | null {
  if (contenu.length >= SIGNATURE_PNG.length && contenu.subarray(0, 8).equals(SIGNATURE_PNG)) {
    return 'image/png';
  }
  if (contenu.length >= 3 && contenu.subarray(0, 3).equals(SIGNATURE_JPEG)) {
    return 'image/jpeg';
  }
  if (estSvgSur(contenu)) return 'image/svg+xml';
  return null;
}

function estSvgSur(contenu: Buffer): boolean {
  // Texte UTF-8 uniquement (un octet nul = binaire déguisé), BOM toléré.
  if (contenu.includes(0)) return false;
  const texte = contenu.toString('utf8').replace(new RegExp('^\\u' + 'FEFF'), '');
  const debut = texte.trimStart().slice(0, 512).toLowerCase();
  const ressembleASvg =
    debut.startsWith('<svg') ||
    (debut.startsWith('<?xml') && /<svg[\s>]/.test(texte.toLowerCase()));
  if (!ressembleASvg) return false;
  return !MOTIFS_SVG_REFUSES.some((motif) => motif.test(texte));
}

export const TYPES_LOGO_IMPRIMABLES: readonly TypeMimeLogo[] = TYPES_MIME_LOGO.filter(
  (t) => t !== 'image/svg+xml',
);
