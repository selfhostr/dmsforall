import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Chiffrement au repos des secrets saisis dans l'application (mot de passe SMTP d'un garage).
 *
 * AES-256-GCM, clé maîtresse de l'instance (`CLE_CHIFFREMENT_SECRETS`), IV aléatoire de 12 octets
 * par chiffrement. Le tenant est passé en données authentifiées (AAD) : un texte chiffré copié
 * d'un garage vers un autre ne se déchiffre pas. Format stocké : `v1.<iv>.<tag>.<chiffré>` (base64url) ;
 * le préfixe de version permet une rotation de clé future sans migration de schéma.
 */

const ALGORITHME = 'aes-256-gcm';
const PREFIXE = 'v1';

/** Octets de la clé maîtresse, ou `null` si la valeur n'est ni du base64 ni de l'hexadécimal de 32 octets. */
export function decoderCleChiffrement(valeur: string): Buffer | null {
  if (/^[0-9a-fA-F]{64}$/.test(valeur)) return Buffer.from(valeur, 'hex');
  if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(valeur)) {
    const octets = Buffer.from(valeur, 'base64');
    if (octets.length === 32) return octets;
  }
  return null;
}

export class ErreurDechiffrementSecret extends Error {
  constructor() {
    super('Secret illisible : clé de chiffrement changée, ou donnée altérée.');
    this.name = 'ErreurDechiffrementSecret';
  }
}

export function chiffrerSecret(clair: string, cle: Buffer, tenantId: string): string {
  const iv = randomBytes(12);
  const chiffreur = createCipheriv(ALGORITHME, cle, iv);
  chiffreur.setAAD(Buffer.from(tenantId, 'utf8'));
  const chiffre = Buffer.concat([chiffreur.update(clair, 'utf8'), chiffreur.final()]);
  return [
    PREFIXE,
    ...[iv, chiffreur.getAuthTag(), chiffre].map((b) => b.toString('base64url')),
  ].join('.');
}

export function dechiffrerSecret(stocke: string, cle: Buffer, tenantId: string): string {
  const [version, iv, tag, chiffre] = stocke.split('.');
  if (version !== PREFIXE || !iv || !tag || chiffre === undefined) {
    throw new ErreurDechiffrementSecret();
  }
  try {
    const dechiffreur = createDecipheriv(ALGORITHME, cle, Buffer.from(iv, 'base64url'));
    dechiffreur.setAAD(Buffer.from(tenantId, 'utf8'));
    dechiffreur.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      dechiffreur.update(Buffer.from(chiffre, 'base64url')),
      dechiffreur.final(),
    ]).toString('utf8');
  } catch {
    throw new ErreurDechiffrementSecret();
  }
}
