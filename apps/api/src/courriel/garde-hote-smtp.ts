import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Garde contre le détournement du serveur d'envoi : le nom d'hôte est saisi par le garage, donc le
 * serveur d'application ouvre une connexion vers une destination choisie par un utilisateur. Sans
 * garde, « Envoyer un e-mail d'essai » permettrait de sonder le réseau interne (base, Redis,
 * métadonnées du fournisseur cloud). On résout le nom UNE fois, on refuse les adresses privées,
 * puis on se connecte à l'adresse résolue (pas de seconde résolution exploitable par DNS rebinding).
 */

export class ErreurHoteSmtpInterdit extends Error {
  constructor(readonly hote: string) {
    super(`Hôte d'envoi interdit (réseau privé ou local) : ${hote}`);
    this.name = 'ErreurHoteSmtpInterdit';
  }
}

function octetsIpv4(ip: string): number[] {
  return ip.split('.').map(Number);
}

/** `true` pour boucle locale, réseaux privés, lien local (dont métadonnées cloud), CGNAT, multicast, non spécifiée. */
export function adresseEstReseauPrive(ip: string): boolean {
  const famille = isIP(ip);
  if (famille === 4) {
    const [a = 0, b = 0] = octetsIpv4(ip);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (famille === 6) {
    const bas = ip.toLowerCase();
    const mappe = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(bas);
    if (mappe?.[1]) return adresseEstReseauPrive(mappe[1]);
    return (
      bas === '::' ||
      bas === '::1' ||
      bas.startsWith('fc') ||
      bas.startsWith('fd') ||
      /^fe[89ab]/.test(bas) ||
      bas.startsWith('ff')
    );
  }
  return true;
}

export interface HoteSmtpResolu {
  /** Adresse IP à joindre. */
  readonly adresse: string;
  /** Nom d'origine, à passer en `servername` TLS pour que le certificat soit vérifié. */
  readonly nom: string;
}

export type ResolveurDns = (hote: string) => Promise<readonly string[]>;

const resolveurSysteme: ResolveurDns = async (hote) =>
  (await lookup(hote, { all: true })).map((r) => r.address);

export async function resoudreHoteSmtp(
  hote: string,
  autoriserReseauPrive: boolean,
  resolveur: ResolveurDns = resolveurSysteme,
): Promise<HoteSmtpResolu> {
  const adresses = isIP(hote) ? [hote] : await resolveur(hote);
  const premiere = adresses[0];
  if (premiere === undefined) throw new ErreurHoteSmtpInterdit(hote);
  if (!autoriserReseauPrive && adresses.some(adresseEstReseauPrive)) {
    throw new ErreurHoteSmtpInterdit(hote);
  }
  return { adresse: premiere, nom: hote };
}
