import * as fsPromises from 'node:fs/promises';

const TAILLE_BLOC_REPLI = 64;
const LONGUEUR_MEMO_MAX_PLAUSIBLE = 64 * 1024 * 1024; // garde-fou contre un bloc corrompu

export interface BlocMemo {
  type: number;
  contenu: Buffer;
}

export interface LecteurMemoFpt {
  obtenirMemo(numeroBloc: number): Promise<BlocMemo | null>;
  fermer(): Promise<void>;
}

/**
 * Ouvre un fichier `.fpt` (mémos VFP/dBase) : lit une fois la taille de bloc déclarée (offset 6
 * de l'en-tête, big-endian), puis rend un lecteur qui résout un numéro de bloc à la demande —
 * jamais l'intégralité du fichier en mémoire.
 */
export async function ouvrirMemoFpt(cheminFpt: string): Promise<LecteurMemoFpt> {
  const fd = await fsPromises.open(cheminFpt, 'r');
  const enTete = Buffer.alloc(8);
  const { bytesRead } = await fd.read(enTete, 0, 8, 0);
  const tailleBlocDeclaree = bytesRead >= 8 ? enTete.readUInt16BE(6) : 0;
  const tailleBloc = tailleBlocDeclaree > 0 ? tailleBlocDeclaree : TAILLE_BLOC_REPLI;

  return {
    async obtenirMemo(numeroBloc: number): Promise<BlocMemo | null> {
      if (numeroBloc <= 0) return null;
      const position = numeroBloc * tailleBloc;
      const enTeteBloc = Buffer.alloc(8);
      const { bytesRead: luEntete } = await fd.read(enTeteBloc, 0, 8, position);
      if (luEntete < 8) return null;

      const type = enTeteBloc.readUInt32BE(0);
      const longueur = enTeteBloc.readUInt32BE(4);
      if (longueur === 0) return { type, contenu: Buffer.alloc(0) };
      if (longueur > LONGUEUR_MEMO_MAX_PLAUSIBLE) return null; // bloc corrompu, jamais d'allocation folle

      const contenu = Buffer.alloc(longueur);
      const { bytesRead: luContenu } = await fd.read(contenu, 0, longueur, position + 8);
      return { type, contenu: contenu.subarray(0, luContenu) };
    },
    async fermer(): Promise<void> {
      await fd.close();
    },
  };
}
