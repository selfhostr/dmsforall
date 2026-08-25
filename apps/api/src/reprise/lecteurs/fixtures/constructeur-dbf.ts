/**
 * Constructeur de fichiers `.dbf`/`.fpt` synthétiques, réservé aux tests.
 *
 * Aucune donnée réelle de garage n'entre jamais ici : toutes les valeurs sont générées par le
 * code appelant (les specs), jamais recopiées d'une archive. Le format DBF est assez simple pour
 * être ré-émis directement (cf. `dbf/en-tete-dbf.ts` pour le sens lecture).
 */
import { encoderChaineDbf } from '../dbf/codepages';

export interface ChampSpecification {
  nom: string;
  type: string;
  longueur: number;
  decimales?: number;
}

export type ValeurBrute = string | number | boolean | null | { memo: string };

export interface EnregistrementSpecification {
  supprime?: boolean;
  valeurs: Record<string, ValeurBrute>;
}

export interface OptionsConstructionDbf {
  champs: ChampSpecification[];
  enregistrements: EnregistrementSpecification[];
  /** Octet page de code de l'en-tête (offset 29). Défaut : 0x03 (cp1252). */
  octetPageDeCode?: number;
  /** Encodage utilisé pour produire les octets des champs C/M (doit être cohérent avec octetPageDeCode). */
  encodage?: 'cp850' | 'cp1252' | 'latin1' | 'ascii';
  octetVersion?: number;
  /** Taille de bloc du fichier .fpt (mémos). Défaut 64, comme FoxPro. */
  tailleBlocMemo?: number;
}

export interface DbfConstruit {
  dbf: Buffer;
  fpt: Buffer | null;
}

function encoderChampD(valeur: string | null): Buffer {
  // Format DBF : "aaaammjj" en ASCII, ou 8 espaces si vide.
  const texte = valeur ?? '        ';
  return Buffer.from(texte.padEnd(8, ' ').slice(0, 8), 'ascii');
}

function encoderChampN(valeur: number | null, longueur: number, decimales: number): Buffer {
  const texte = valeur === null ? '' : valeur.toFixed(decimales);
  return Buffer.from(texte.padStart(longueur, ' ').slice(0, longueur), 'ascii');
}

function encoderChampL(valeur: boolean | null): Buffer {
  const c = valeur === null ? '?' : valeur ? 'T' : 'F';
  return Buffer.from(c, 'ascii');
}

/** Construit les blocs mémo (.fpt) pour les valeurs `{ memo: string }` rencontrées, dans l'ordre. */
function construireBlocsMemo(
  champs: ChampSpecification[],
  enregistrements: EnregistrementSpecification[],
  encodage: string,
  tailleBloc: number,
): { fpt: Buffer; numerosBlocs: Map<string, number> } {
  const blocs: Buffer[] = [];
  const numerosBlocs = new Map<string, number>(); // clé "indexEnregistrement:nomChamp" -> numéro de bloc
  let prochainBloc = 1; // le bloc 0 sert d'en-tête, cf. header .fpt

  enregistrements.forEach((enr, indexEnr) => {
    for (const champ of champs) {
      if (champ.type !== 'M') continue;
      const valeur = enr.valeurs[champ.nom];
      if (valeur === null || valeur === undefined || typeof valeur !== 'object') continue;
      const contenu = encoderChaineDbf(valeur.memo, encodage);
      const enTeteBloc = Buffer.alloc(8);
      enTeteBloc.writeUInt32BE(1, 0); // type 1 = mémo texte
      enTeteBloc.writeUInt32BE(contenu.length, 4);
      const blocBrut = Buffer.concat([enTeteBloc, contenu]);
      const nbBlocsOccupes = Math.ceil(blocBrut.length / tailleBloc);
      const tailleTotale = nbBlocsOccupes * tailleBloc;
      const blocPadde = Buffer.concat([blocBrut, Buffer.alloc(tailleTotale - blocBrut.length)]);

      numerosBlocs.set(`${indexEnr}:${champ.nom}`, prochainBloc);
      blocs.push(blocPadde);
      prochainBloc += nbBlocsOccupes;
    }
  });

  const enTeteFpt = Buffer.alloc(tailleBloc); // le premier "bloc" logique héberge l'en-tête .fpt
  enTeteFpt.writeUInt32BE(prochainBloc, 0); // pointeur prochain bloc libre (peu utilisé en lecture)
  enTeteFpt.writeUInt16BE(tailleBloc, 6); // taille de bloc, big-endian, offset 6 — c'est le seul champ qui compte pour le lecteur.

  return { fpt: Buffer.concat([enTeteFpt, ...blocs]), numerosBlocs };
}

/** Construit un couple `.dbf`/`.fpt` en mémoire, sans toucher au disque. */
export function construireDbf(options: OptionsConstructionDbf): DbfConstruit {
  const encodage = options.encodage ?? 'cp1252';
  const octetPageDeCode = options.octetPageDeCode ?? 0x03;
  const octetVersion = options.octetVersion ?? 0x30;
  const tailleBloc = options.tailleBlocMemo ?? 64;

  const aDesMemos = options.champs.some((c) => c.type === 'M');
  const { fpt, numerosBlocs } = aDesMemos
    ? construireBlocsMemo(options.champs, options.enregistrements, encodage, tailleBloc)
    : { fpt: null as Buffer | null, numerosBlocs: new Map<string, number>() };

  // Descripteurs de champs (32o chacun) + terminateur 0x0D.
  const descripteurs: Buffer[] = [];
  let offsetEnregistrement = 1;
  for (const champ of options.champs) {
    if (champ.nom.length > 10) {
      // Limite réelle du format DBF (11 octets, dont 1 pour le terminateur nul) : tronquer en
      // silence produirait un champ introuvable par son nom complet côté lecture, un piège de
      // test difficile à diagnostiquer (vécu en écrivant ces fixtures).
      throw new Error(`nom de champ DBF trop long (max 10 caractères) : "${champ.nom}"`);
    }
    const desc = Buffer.alloc(32);
    Buffer.from(champ.nom, 'ascii').copy(desc, 0);
    desc.writeUInt8(champ.type.charCodeAt(0), 11);
    desc.writeUInt8(champ.longueur & 0xff, 16);
    desc.writeUInt8(champ.decimales ?? 0, 17);
    descripteurs.push(desc);
    offsetEnregistrement += champ.longueur;
  }
  const tailleEnregistrement = offsetEnregistrement;
  const zoneChamps = Buffer.concat([...descripteurs, Buffer.from([0x0d])]);
  const tailleEntete = 32 + zoneChamps.length;

  const enTete = Buffer.alloc(32);
  enTete.writeUInt8(octetVersion, 0);
  enTete.writeUInt8(26, 1); // date de dernière maj arbitraire, sans conséquence
  enTete.writeUInt8(1, 2);
  enTete.writeUInt8(1, 3);
  enTete.writeUInt32LE(options.enregistrements.length, 4);
  enTete.writeUInt16LE(tailleEntete, 8);
  enTete.writeUInt16LE(tailleEnregistrement, 10);
  enTete.writeUInt8(octetPageDeCode, 29);

  const lignes: Buffer[] = options.enregistrements.map((enr, indexEnr) => {
    const ligne = Buffer.alloc(tailleEnregistrement);
    ligne.writeUInt8(enr.supprime ? 0x2a : 0x20, 0);
    let offsetChamp = 1;
    for (const champ of options.champs) {
      const valeur = enr.valeurs[champ.nom] ?? null;
      let brut: Buffer;
      switch (champ.type) {
        case 'C': {
          const texte = typeof valeur === 'string' ? valeur : '';
          const encode = encoderChaineDbf(texte, encodage);
          brut = Buffer.alloc(champ.longueur, 0x20);
          encode.copy(brut, 0, 0, Math.min(encode.length, champ.longueur));
          break;
        }
        case 'N':
        case 'F':
          brut = encoderChampN(
            typeof valeur === 'number' ? valeur : null,
            champ.longueur,
            champ.decimales ?? 0,
          );
          break;
        case 'D':
          brut = encoderChampD(typeof valeur === 'string' ? valeur : null);
          break;
        case 'L':
          brut = encoderChampL(typeof valeur === 'boolean' ? valeur : null);
          break;
        case 'M': {
          const numeroBloc = numerosBlocs.get(`${indexEnr}:${champ.nom}`) ?? 0;
          brut = Buffer.alloc(4);
          brut.writeUInt32LE(numeroBloc, 0);
          if (champ.longueur > 4) brut = Buffer.concat([brut, Buffer.alloc(champ.longueur - 4)]);
          break;
        }
        default:
          brut = Buffer.alloc(champ.longueur);
      }
      const dest = Buffer.alloc(champ.longueur);
      brut.copy(dest, 0, 0, Math.min(brut.length, champ.longueur));
      dest.copy(ligne, offsetChamp);
      offsetChamp += champ.longueur;
    }
    return ligne;
  });

  const dbf = Buffer.concat([enTete, zoneChamps, ...lignes]);
  return { dbf, fpt };
}

/** Écrit un couple `.dbf`/`.fpt` sur disque (répertoire temporaire de test). */
export async function ecrireDbf(
  cheminDbf: string,
  options: OptionsConstructionDbf,
): Promise<{ cheminDbf: string; cheminFpt: string | null }> {
  const { writeFile } = await import('node:fs/promises');
  const { dirname, basename, extname, join } = await import('node:path');
  const construit = construireDbf(options);
  await writeFile(cheminDbf, construit.dbf);
  let cheminFpt: string | null = null;
  if (construit.fpt) {
    cheminFpt = join(dirname(cheminDbf), basename(cheminDbf, extname(cheminDbf)) + '.fpt');
    await writeFile(cheminFpt, construit.fpt);
  }
  return { cheminDbf, cheminFpt };
}
