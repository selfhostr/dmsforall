import * as fsPromises from 'node:fs/promises';
import type { DescripteurChampDbf, LigneTable, OptionsLectureDbf, ValeurChamp } from '../types';
import { analyserEnTeteDbf } from './en-tete-dbf';
import { decoderChaineDbf } from './codepages';
import { ouvrirMemoFpt, type LecteurMemoFpt } from './memo-fpt';

const STATUT_ACTIF = 0x20;
const STATUT_SUPPRIME = 0x2a;

/** ~1 Mo par lot de lecture, quel que soit le nombre total de lignes du fichier. */
const OCTETS_PAR_LOT_CIBLE = 1_048_576;
const LOT_MIN = 1;
const LOT_MAX = 2000;

/**
 * Nombre d'enregistrements lus par appel `fd.read` — borné en octets (~1 Mo), jamais en nombre
 * de lignes : une table de 20 000 lignes et une table de 9,4 millions de lignes utilisent
 * exactement la même taille de lot, calculée uniquement depuis la taille d'un enregistrement.
 * Exportée pour être testée directement, sans avoir à instrumenter le module `fs` natif (ESM,
 * non re-configurable en test — cf. lecteur-dbf.spec.ts).
 */
export function calculerTailleLotLecture(tailleEnregistrement: number): number {
  const brut = Math.floor(OCTETS_PAR_LOT_CIBLE / Math.max(1, tailleEnregistrement));
  return Math.min(LOT_MAX, Math.max(LOT_MIN, brut));
}

function julienVersDate(jd: number): Date | null {
  // Fliegel & Van Flandern — jour julien -> date grégorienne, cf. lecteur de référence Python.
  let l = jd + 68569;
  const n = Math.floor((4 * l) / 146097);
  l = l - Math.floor((146097 * n + 3) / 4);
  const i = Math.floor((4000 * (l + 1)) / 1461001);
  l = l - Math.floor((1461 * i) / 4) + 31;
  const j = Math.floor((80 * l) / 2447);
  const jour = l - Math.floor((2447 * j) / 80);
  l = Math.floor(j / 11);
  const mois = j + 2 - 12 * l;
  const annee = 100 * (n - 49) + i + l;
  const date = new Date(Date.UTC(annee, mois - 1, jour));
  return Number.isNaN(date.getTime()) ? null : date;
}

async function decoderValeurChamp(
  champ: DescripteurChampDbf,
  brut: Buffer,
  encodage: string,
  memo: LecteurMemoFpt | null,
): Promise<ValeurChamp> {
  switch (champ.type) {
    case 'C': {
      let fin = brut.length;
      while (fin > 0 && brut[fin - 1] === 0x00) fin--;
      return decoderChaineDbf(brut.subarray(0, fin), encodage).replace(/ +$/, '');
    }
    case 'N':
    case 'F': {
      const s = brut.toString('ascii').trim();
      if (s === '' || s === '.') return null;
      const v = Number(s);
      return Number.isNaN(v) ? null : v;
    }
    case 'D': {
      const s = brut.toString('ascii').trim();
      if (!/^\d{8}$/.test(s)) return null;
      const annee = Number(s.slice(0, 4));
      const mois = Number(s.slice(4, 6));
      const jour = Number(s.slice(6, 8));
      const date = new Date(Date.UTC(annee, mois - 1, jour));
      return Number.isNaN(date.getTime()) ? null : date;
    }
    case 'L': {
      const c = brut.toString('ascii').trim().toUpperCase();
      if (c === 'T' || c === 'Y') return true;
      if (c === 'F' || c === 'N') return false;
      return null; // '?' = non renseigné
    }
    case 'I':
      return brut.length >= 4 ? brut.readInt32LE(0) : null;
    case 'Y':
      return brut.length >= 8 ? Number(brut.readBigInt64LE(0)) / 10000 : null;
    case 'B':
      return brut.length >= 8 ? brut.readDoubleLE(0) : null;
    case 'T': {
      if (brut.length < 8) return null;
      const julien = brut.readUInt32LE(0);
      const msecs = brut.readUInt32LE(4);
      if (julien === 0) return null;
      const dateBase = julienVersDate(julien);
      return dateBase ? new Date(dateBase.getTime() + msecs) : null;
    }
    case 'M': {
      if (brut.length < 4 || !memo) return null;
      const numeroBloc = brut.readUInt32LE(0);
      if (numeroBloc === 0) return null;
      const bloc = await memo.obtenirMemo(numeroBloc);
      if (!bloc) return null;
      return bloc.type === 1 ? decoderChaineDbf(bloc.contenu, encodage) : bloc.contenu;
    }
    default:
      return brut; // types non documentés (G/P/...) : rendus bruts, jamais décodés à l'aveugle
  }
}

/**
 * Itère les lignes ACTIVES d'une table `.dbf` — les enregistrements marqués supprimés
 * (octet de statut 0x2A) ne sont jamais rendus, sans option pour les réintroduire : c'est une
 * garantie forte de cette bibliothèque, pas un réglage.
 *
 * Lecture par lots bornés en octets (jamais tout le fichier en mémoire), avec sortie anticipée
 * dès que `options.limite` lignes actives ont été rendues — l'échantillonnage sur une table de
 * plusieurs millions de lignes ne parcourt donc que le strict nécessaire.
 */
export async function* lireLignesDbf(
  cheminDbf: string,
  options: OptionsLectureDbf = {},
): AsyncGenerator<LigneTable, void, void> {
  const entete = await analyserEnTeteDbf(cheminDbf, { encodage: options.encodage });
  const fd = await fsPromises.open(cheminDbf, 'r');
  let memo: LecteurMemoFpt | null = null;

  try {
    if (entete.cheminMemo) {
      memo = await ouvrirMemoFpt(entete.cheminMemo);
    }

    const nbParLot = calculerTailleLotLecture(entete.tailleEnregistrement);
    const tamponLot = Buffer.alloc(entete.tailleEnregistrement * nbParLot);
    let position = entete.tailleEntete;
    let indexPhysique = 0;
    let rendus = 0;

    lecture: while (true) {
      const { bytesRead } = await fd.read(tamponLot, 0, tamponLot.length, position);
      if (bytesRead <= 0) break;

      const nbEnregistrementsLus = Math.floor(bytesRead / entete.tailleEnregistrement);
      for (let i = 0; i < nbEnregistrementsLus; i++) {
        const debut = i * entete.tailleEnregistrement;
        const ligneBrute = tamponLot.subarray(debut, debut + entete.tailleEnregistrement);
        const statut = ligneBrute.readUInt8(0);
        const indexCourant = indexPhysique;
        indexPhysique++;

        if (statut === STATUT_SUPPRIME) continue;
        if (statut !== STATUT_ACTIF) continue; // statut inattendu : ignoré, jamais planté

        const valeurs: Record<string, ValeurChamp> = {};
        for (const champ of entete.champs) {
          const brutChamp = ligneBrute.subarray(champ.offset, champ.offset + champ.longueur);
          valeurs[champ.nom] = await decoderValeurChamp(champ, brutChamp, entete.encodage, memo);
        }

        yield { index: indexCourant, valeurs };
        rendus++;
        if (options.limite !== undefined && rendus >= options.limite) break lecture;
      }

      position += bytesRead;
      if (bytesRead < tamponLot.length) break; // fin de fichier atteinte dans ce lot
    }
  } finally {
    if (memo) await memo.fermer();
    await fd.close();
  }
}

/** Compte les lignes actives d'une table sans matérialiser leurs valeurs (mémoire O(1)). */
export async function compterLignesActivesDbf(cheminDbf: string): Promise<number> {
  let n = 0;
  for await (const _ligne of lireLignesDbf(cheminDbf)) {
    n++;
  }
  return n;
}
