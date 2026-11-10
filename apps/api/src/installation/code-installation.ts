/**
 * Code d'installation : tirage, normalisation, empreinte et comparaison.
 *
 * Fonctions pures, sans base ni Nest. Le code vaut ~59 bits (12 caractères parmi 31) : de quoi
 * rendre une recherche exhaustive hors de portée derrière la limitation de débit de la route, ce
 * qui justifie un simple SHA-256 salé (un code à haute entropie n'a pas besoin d'un hachage lent).
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** 31 caractères sans ambiguïté à la lecture ni à la frappe : ni 0/O, ni 1/I/L. */
export const ALPHABET_CODE_INSTALLATION = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const GROUPES = 3;
const LONGUEUR_GROUPE = 4;

/** Tire un code `XXXX-XXXX-XXXX` avec le générateur cryptographique du système. */
export function genererCodeInstallation(): string {
  const groupes: string[] = [];
  for (let g = 0; g < GROUPES; g += 1) {
    let groupe = '';
    for (let i = 0; i < LONGUEUR_GROUPE; i += 1) {
      groupe += ALPHABET_CODE_INSTALLATION[randomInt(ALPHABET_CODE_INSTALLATION.length)];
    }
    groupes.push(groupe);
  }
  return groupes.join('-');
}

/** Majuscules, sans tiret ni espace : `abcd efgh-jkmn` et `ABCD-EFGH-JKMN` désignent le même code. */
export function normaliserCodeInstallation(saisie: string): string {
  return saisie.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export interface EmpreinteCodeInstallation {
  readonly sel: Buffer;
  readonly empreinte: Buffer;
}

function empreinteAvecSel(sel: Buffer, saisie: string): Buffer {
  return createHash('sha256').update(sel).update(normaliserCodeInstallation(saisie)).digest();
}

export function empreinterCodeInstallation(code: string): EmpreinteCodeInstallation {
  const sel = randomBytes(16);
  return { sel, empreinte: empreinteAvecSel(sel, code) };
}

/** Comparaison en temps constant : la durée ne dépend pas du nombre de caractères justes. */
export function codeInstallationCorrespond(
  saisie: string,
  stocke: EmpreinteCodeInstallation,
): boolean {
  const calculee = empreinteAvecSel(stocke.sel, saisie);
  return calculee.length === stocke.empreinte.length && timingSafeEqual(calculee, stocke.empreinte);
}

/** Bloc très visible pour les journaux de démarrage (`docker compose logs api`). */
export function afficherCodeInstallation(
  code: string,
  ecrire: (texte: string) => unknown = (texte) => process.stdout.write(texte),
): void {
  const trait = '='.repeat(66);
  ecrire(
    [
      '',
      trait,
      "  dmsforall - no garage yet / aucun garage pour l'instant",
      '',
      `  Installation code / Code d'installation : ${code}`,
      '',
      '  Open the web address of this server and create your garage with this code.',
      "  Ouvrez l'adresse web de ce serveur et créez votre garage avec ce code.",
      '  Valid until the first garage exists; a new code is drawn at each start.',
      '  Read it again: docker compose logs api',
      trait,
      '',
      '',
    ].join('\n'),
  );
}
