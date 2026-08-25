import { open } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { access, constants as fsConstants } from 'node:fs/promises';
import type { DescripteurChampDbf, EnTeteDbf } from '../types';
import { ErreurEnTeteDbfInvalide } from '../erreurs';
import { encodageDepuisOctetPageDeCode } from './codepages';

/** Types de champ documentés (spec) + G/P lus en brut, non décodés. */
const TYPES_CHAMP_CONNUS = new Set(['C', 'N', 'D', 'L', 'M', 'F', 'I', 'T', 'Y', 'B', 'G', 'P']);

const TAILLE_ENTETE_MIN = 32;
const NB_CHAMPS_MAX_PLAUSIBLE = 1024;

export interface EnTeteDbfBrute {
  octetVersion: number;
  nbEnregistrementsDeclares: number;
  tailleEntete: number;
  tailleEnregistrement: number;
  octetPageDeCode: number;
  champs: DescripteurChampDbf[];
}

/**
 * Parseur pur : ne fait aucune I/O, prend un tampon contenant au moins les `tailleEntete`
 * premiers octets du fichier. Rend `null` si le tampon ne décrit pas un en-tête DBF plausible
 * (tampon trop court, descripteurs de champs incohérents, somme des longueurs ≠ taille
 * d'enregistrement déclarée) — jamais une exception, pour servir de sonde de reconnaissance de
 * famille sur un fichier arbitraire sans avoir à gérer un cas d'erreur par appelant.
 *
 * C'est ce parseur, et lui seul, qui sert de base à la fois à `analyserEnTeteDbf` (lecture
 * disque réelle) et à `detection-famille.ts` (reconnaissance sur en-tête, jamais sur extension).
 */
export function analyserEnTeteDepuisTampon(tampon: Buffer): EnTeteDbfBrute | null {
  if (tampon.length < TAILLE_ENTETE_MIN) return null;

  const octetVersion = tampon.readUInt8(0);
  const nbEnregistrementsDeclares = tampon.readUInt32LE(4);
  const tailleEntete = tampon.readUInt16LE(8);
  const tailleEnregistrement = tampon.readUInt16LE(10);
  const octetPageDeCode = tampon.readUInt8(29);

  if (tailleEntete < TAILLE_ENTETE_MIN + 32 + 1) return null; // au moins 1 champ + terminateur
  if (tailleEnregistrement < 1) return null;
  if (tampon.length < tailleEntete) return null; // tampon insuffisant pour couvrir les champs

  const champs: DescripteurChampDbf[] = [];
  let offsetLecture = TAILLE_ENTETE_MIN;
  let offsetEnregistrement = 1; // octet 0 de l'enregistrement = statut de suppression
  let terminateurTrouve = false;

  while (offsetLecture < tampon.length && offsetLecture < tailleEntete) {
    // Le terminateur ne tient que sur 1 octet : le vérifier avant d'exiger 32 octets pleins
    // pour un descripteur de champ, sans quoi le terminateur d'une petite zone de champs
    // n'est jamais atteint et un DBF pourtant valide est rejeté à tort.
    const premierOctet = tampon.readUInt8(offsetLecture);
    if (premierOctet === 0x0d) {
      terminateurTrouve = true;
      break;
    }
    if (offsetLecture + 32 > tampon.length) return null; // descripteur de champ tronqué
    if (champs.length >= NB_CHAMPS_MAX_PLAUSIBLE) return null;

    const desc = tampon.subarray(offsetLecture, offsetLecture + 32);
    const finNom = desc.subarray(0, 11).indexOf(0);
    const nomBrut = desc.subarray(0, finNom === -1 ? 11 : finNom);
    const nom = nomBrut.toString('latin1').trim();
    const type = String.fromCharCode(desc.readUInt8(11));
    if (!TYPES_CHAMP_CONNUS.has(type)) return null;

    let longueur = desc.readUInt8(16);
    let decimales = desc.readUInt8(17);
    if (type === 'C' && decimales !== 0) {
      // VFP encode une longueur C sur 2 octets quand elle dépasse 255 : byte17 = octet fort.
      longueur = longueur + (decimales << 8);
      decimales = 0;
    }
    if (longueur === 0) return null;

    champs.push({ nom, type, longueur, decimales, offset: offsetEnregistrement });
    offsetEnregistrement += longueur;
    offsetLecture += 32;
  }

  if (!terminateurTrouve || champs.length === 0) return null;

  // Signal décisif : la somme des longueurs de champs + l'octet de statut doit correspondre
  // exactement à la taille d'enregistrement déclarée. Rejette avec confiance les faux positifs
  // (fichier binaire arbitraire qui aurait, par coïncidence, un en-tête 32 octets plausible).
  if (offsetEnregistrement !== tailleEnregistrement) return null;

  return {
    octetVersion,
    nbEnregistrementsDeclares,
    tailleEntete,
    tailleEnregistrement,
    octetPageDeCode,
    champs,
  };
}

async function trouverCheminMemo(cheminDbf: string): Promise<string | null> {
  const rep = dirname(cheminDbf);
  const base = basename(cheminDbf, extname(cheminDbf));
  for (const ext of ['.fpt', '.FPT', '.Fpt']) {
    const candidat = join(rep, base + ext);
    try {
      await access(candidat, fsConstants.R_OK);
      return candidat;
    } catch {
      // essai suivant
    }
  }
  return null;
}

/**
 * Lit et valide l'en-tête complet d'un fichier `.dbf` réel sur disque (I/O bornée : seuls les
 * `tailleEntete` premiers octets sont lus, jamais le corps de la table).
 *
 * @throws {ErreurEnTeteDbfInvalide} si le fichier n'est pas un DBF plausible.
 */
export async function analyserEnTeteDbf(
  cheminDbf: string,
  options?: { encodage?: string },
): Promise<EnTeteDbf> {
  const fd = await open(cheminDbf, 'r');
  try {
    const tamponInitial = Buffer.alloc(TAILLE_ENTETE_MIN);
    const { bytesRead: luInitial } = await fd.read(tamponInitial, 0, TAILLE_ENTETE_MIN, 0);
    if (luInitial < TAILLE_ENTETE_MIN) {
      throw new ErreurEnTeteDbfInvalide(cheminDbf, `fichier tronqué (${luInitial} octets lus)`);
    }
    const tailleEntete = tamponInitial.readUInt16LE(8);
    const tampon = Buffer.alloc(tailleEntete);
    const { bytesRead: lu } = await fd.read(tampon, 0, tailleEntete, 0);
    if (lu < tailleEntete) {
      throw new ErreurEnTeteDbfInvalide(
        cheminDbf,
        `zone de champs tronquée (${lu}/${tailleEntete} octets)`,
      );
    }

    const brute = analyserEnTeteDepuisTampon(tampon);
    if (!brute) {
      throw new ErreurEnTeteDbfInvalide(
        cheminDbf,
        "descripteurs de champs incohérents avec la taille d'enregistrement déclarée",
      );
    }

    const cheminMemo = await trouverCheminMemo(cheminDbf);
    const encodage = options?.encodage ?? encodageDepuisOctetPageDeCode(brute.octetPageDeCode);

    return {
      cheminDbf,
      cheminMemo,
      octetVersion: brute.octetVersion,
      nbEnregistrementsDeclares: brute.nbEnregistrementsDeclares,
      tailleEntete: brute.tailleEntete,
      tailleEnregistrement: brute.tailleEnregistrement,
      octetPageDeCode: brute.octetPageDeCode,
      encodage,
      champs: brute.champs,
    };
  } finally {
    await fd.close();
  }
}
