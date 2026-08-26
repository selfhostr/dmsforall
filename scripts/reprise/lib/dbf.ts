/**
 * Constructeur minimal de fichiers `.dbf` (dBase/FoxPro) — SYNTHÉTIQUE, aucune donnée réelle de
 * garage. Écrit pour produire le « jeu petit et rapide » de ce harnais (voir `construire-jeu-
 * synthetique.ts`) : une archive de reprise VALIDE (au sens du sniff de famille et du classement
 * de rôle de `apps/api/src/reprise/lecteurs/`), sans dépendre d'un vrai export Access ni d'un
 * fichier de 2,4 Go rejoué dix fois.
 *
 * PROVENANCE ET PÉRIMÈTRE — un constructeur DBF quasi identique existe déjà dans le dépôt,
 * `apps/api/src/reprise/lecteurs/fixtures/constructeur-dbf.ts` (« Aucune donnée réelle de garage
 * n'entre jamais ici », même doctrine). CE FICHIER LE RÉÉCRIT ICI plutôt que de l'importer :
 * `apps/api/src/reprise/` est actuellement modifié par un autre agent sur cette même branche
 * (§ périmètre disjoint, CONTRIBUTING.md) — une dépendance croisée vers un fichier de SON périmètre
 * casserait sous ce harnais au premier refactor de son côté, sans lien avec ce qui change ici.
 * Le format DBF est stable et documenté (contrairement au reste du module reprise, en cours de
 * correction) : le dupliquer une fois coûte peu, et élimine tout couplage.
 *
 * FORMAT COUVERT — dBase III/FoxPro sans mémo (types `C`/`N`/`D`/`L` seulement) : suffisant pour
 * les trois domaines qui ont un écrivain réel (`clients`, `vehicules`, `documents_vente`, voir
 * `docs/reprise/decisions.md` et le rapport de livraison de `apps/api/src/reprise/import/
 * ecrivains/`), aucun besoin de blocs `.fpt`.
 */
import { writeFileSync } from 'node:fs';

export interface ChampDbf {
  readonly nom: string; // ≤ 10 caractères (limite réelle du format, cf. en-tete-dbf.ts du dépôt)
  readonly type: 'C' | 'N' | 'D' | 'L';
  readonly longueur: number;
  readonly decimales?: number;
}

export type ValeurDbf = string | number | boolean | null;

export interface TableDbf {
  /** Nom de fichier SANS extension (ex. `KUNDEN` — majuscules, à la façon d'un vieux DMS DOS). */
  readonly nom: string;
  readonly champs: readonly ChampDbf[];
  readonly lignes: readonly (readonly ValeurDbf[])[];
}

function encoderTexte(valeur: string, longueur: number): Buffer {
  // latin1 : identité octet <-> point de code pour les 256 premiers caractères Unicode, ce qui
  // couvre exactement l'alphabet français/allemand accentué utilisé ici (é, è, à, ç, ü, ö, ä) —
  // ces caractères ont le MÊME octet en latin1 et en cp1252 (l'en-tête DBF ci-dessous déclare
  // cp1252, octet de page de code 0x03 : `apps/api/src/reprise/lecteurs/dbf/codepages.ts::
  // encodageDepuisOctetPageDeCode`). Diverge de cp1252 seulement sur des caractères hors de cet
  // alphabet (ex. « œ », « € ») — non utilisés dans ce jeu synthétique.
  const buf = Buffer.alloc(longueur, 0x20);
  Buffer.from(valeur, 'latin1').copy(buf, 0, 0, longueur);
  return buf;
}

function encoderNombre(valeur: number, longueur: number, decimales: number): Buffer {
  const texte = valeur.toFixed(decimales).padStart(longueur, ' ').slice(0, longueur);
  return Buffer.from(texte, 'ascii');
}

function encoderDate(valeurIso: string | null, longueur: number): Buffer {
  // Format DBF : "aaaammjj" — jamais "jj.mm.aaaa" (piège documenté, `analyse/auto-i/commandes.md`
  // §« Repérage du vrai format de date »), ici volontairement en toutes lettres pour ne pas le
  // redécouvrir.
  const texte = valeurIso ? valeurIso.replaceAll('-', '') : ''.padEnd(8, ' ');
  return Buffer.alloc(longueur, 0x20).fill(
    Buffer.from(texte.padEnd(longueur, ' '), 'ascii'),
    0,
    longueur,
  );
}

function encoderBooleen(valeur: boolean | null): Buffer {
  return Buffer.from([valeur === null ? 0x3f : valeur ? 0x54 : 0x46]); // '?' / 'T' / 'F'
}

/** Construit le contenu binaire d'un `.dbf` en mémoire — aucune I/O. */
export function construireBufferDbf(table: TableDbf): Buffer {
  for (const champ of table.champs) {
    if (champ.nom.length > 10) {
      throw new Error(`Champ DBF « ${champ.nom} » dépasse 10 caractères (limite du format).`);
    }
  }

  const descripteurs = table.champs.map((champ) => {
    const desc = Buffer.alloc(32);
    Buffer.from(champ.nom, 'ascii').copy(desc, 0);
    desc.writeUInt8(champ.type.charCodeAt(0), 11);
    desc.writeUInt8(champ.longueur & 0xff, 16);
    desc.writeUInt8(champ.decimales ?? 0, 17);
    return desc;
  });
  const tailleEnregistrement = 1 + table.champs.reduce((s, c) => s + c.longueur, 0);
  const zoneChamps = Buffer.concat([...descripteurs, Buffer.from([0x0d])]);
  const tailleEntete = 32 + zoneChamps.length;

  const enTete = Buffer.alloc(32);
  enTete.writeUInt8(0x03, 0); // dBase III sans mémo — version simple, suffit ici
  enTete.writeUInt8(26, 1);
  enTete.writeUInt8(1, 2);
  enTete.writeUInt8(1, 3);
  enTete.writeUInt32LE(table.lignes.length, 4);
  enTete.writeUInt16LE(tailleEntete, 8);
  enTete.writeUInt16LE(tailleEnregistrement, 10);
  enTete.writeUInt8(0x03, 29); // page de code -> cp1252 (encodageDepuisOctetPageDeCode)

  const lignes = table.lignes.map((valeurs) => {
    const ligne = Buffer.alloc(tailleEnregistrement);
    ligne.writeUInt8(0x20, 0); // non supprimé
    let offset = 1;
    table.champs.forEach((champ, i) => {
      const valeur = valeurs[i] ?? null;
      let brut: Buffer;
      switch (champ.type) {
        case 'C':
          brut = encoderTexte(typeof valeur === 'string' ? valeur : '', champ.longueur);
          break;
        case 'N':
          brut = encoderNombre(
            typeof valeur === 'number' ? valeur : 0,
            champ.longueur,
            champ.decimales ?? 0,
          );
          break;
        case 'D':
          brut = encoderDate(typeof valeur === 'string' ? valeur : null, champ.longueur);
          break;
        case 'L':
          brut = encoderBooleen(typeof valeur === 'boolean' ? valeur : null);
          break;
      }
      brut.copy(ligne, offset, 0, Math.min(brut.length, champ.longueur));
      offset += champ.longueur;
    });
    return ligne;
  });

  return Buffer.concat([enTete, zoneChamps, ...lignes, Buffer.from([0x1a])]); // 0x1A = EOF conventionnel
}

export function ecrireDbf(cheminSansExtension: string, table: TableDbf): string {
  const chemin = `${cheminSansExtension}.dbf`;
  writeFileSync(chemin, construireBufferDbf(table));
  return chemin;
}
