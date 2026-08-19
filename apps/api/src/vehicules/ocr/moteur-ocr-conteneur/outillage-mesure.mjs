// Outillage de mesure batch — prend un DOSSIER de photos, exécute l'extraction sur chacune, rend
// un tableau champ par champ (lu / non lu / temps). N'affiche et n'enregistre JAMAIS le contenu
// extrait (aucune valeur, aucun fragment de texte) — uniquement des indicateurs : présence,
// longueur, confiance Tesseract, mode retenu (cadré/repli), durée. Sert à régler les zones fixes
// (`zones-cadrees.mjs`) et les seuils dès réception d'un corpus réel, sans relire chaque image à
// l'œil pour chronométrer à la main.
//
// Usage : node outillage-mesure.mjs <dossier-de-photos> [--json]
//   pnpm --filter (n/a, hors workspace) : `npm run mesurer -- <dossier>` depuis ce répertoire.
//
// AUCUNE PHOTO N'EST JAMAIS COPIÉE NI ÉCRITE PAR CET OUTIL — lecture seule, résultats en mémoire.
import fs from 'node:fs/promises';
import path from 'node:path';

import { demarrerMoteur, arreterMoteur } from './moteur-tesseract.mjs';
import { extraireChampsPermis, ErreurFormatImage } from './extraction-champs.mjs';
import { CHAMPS_CONNUS } from './ancres.mjs';

const EXTENSIONS_IMAGE = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);

function formaterLigne(colonnes, largeurs) {
  return colonnes.map((c, i) => String(c).padEnd(largeurs[i])).join('  ');
}

async function listerPhotos(dossier) {
  const entrees = await fs.readdir(dossier, { withFileTypes: true });
  return entrees
    .filter((e) => e.isFile() && EXTENSIONS_IMAGE.has(path.extname(e.name).toLowerCase()))
    .map((e) => path.join(dossier, e.name))
    .sort();
}

async function mesurerUnePhoto(cheminPhoto) {
  const buffer = await fs.readFile(cheminPhoto);
  const debut = Date.now();
  try {
    const { champs, avertissements } = await extraireChampsPermis(buffer);
    const dureeMs = Date.now() - debut;
    const mode = avertissements.includes('mode:cadre') ? 'cadre' : 'repli';
    return {
      fichier: path.basename(cheminPhoto),
      ok: true,
      mode,
      dureeMs,
      champs: Object.fromEntries(
        CHAMPS_CONNUS.map((nom) => [
          nom,
          champs[nom] ? { lu: true, confiance: Math.round(champs[nom].confiance) } : { lu: false },
        ]),
      ),
    };
  } catch (cause) {
    const dureeMs = Date.now() - debut;
    return {
      fichier: path.basename(cheminPhoto),
      ok: false,
      erreur: cause instanceof ErreurFormatImage ? 'FORMAT_NON_SUPPORTE' : 'ERREUR_INTERNE',
      dureeMs,
    };
  }
}

function afficherTableau(resultats) {
  const enTete = ['fichier', 'mode', 'ms', ...CHAMPS_CONNUS];
  const lignes = resultats.map((r) => {
    if (!r.ok) return [r.fichier, r.erreur, String(r.dureeMs), ...CHAMPS_CONNUS.map(() => '-')];
    return [
      r.fichier,
      r.mode,
      String(r.dureeMs),
      ...CHAMPS_CONNUS.map((nom) => (r.champs[nom].lu ? 'lu' : 'non-lu')),
    ];
  });

  const toutesLignes = [enTete, ...lignes];
  const largeurs = enTete.map((_, i) => Math.max(...toutesLignes.map((l) => String(l[i]).length)));

  console.log(formaterLigne(enTete, largeurs));
  console.log(largeurs.map((l) => '-'.repeat(l)).join('  '));
  for (const ligne of lignes) console.log(formaterLigne(ligne, largeurs));

  const photosOk = resultats.filter((r) => r.ok);
  console.log('');
  console.log(
    `Photos traitées : ${resultats.length} (${photosOk.length} exploitées, ${resultats.length - photosOk.length} en échec de format)`,
  );
  if (photosOk.length > 0) {
    const durees = photosOk.map((r) => r.dureeMs).sort((a, b) => a - b);
    const moyenne = Math.round(durees.reduce((s, d) => s + d, 0) / durees.length);
    const mediane = durees[Math.floor(durees.length / 2)];
    const cadre = photosOk.filter((r) => r.mode === 'cadre').length;
    console.log(
      `Durée : moyenne ${moyenne} ms, médiane ${mediane} ms, min ${durees[0]} ms, max ${durees[durees.length - 1]} ms`,
    );
    console.log(
      `Mode cadré retenu : ${cadre}/${photosOk.length} — repli : ${photosOk.length - cadre}/${photosOk.length}`,
    );
    for (const nomChamp of CHAMPS_CONNUS) {
      const lus = photosOk.filter((r) => r.champs[nomChamp].lu).length;
      console.log(`  ${nomChamp} : lu sur ${lus}/${photosOk.length} photo(s)`);
    }
  }
}

async function main() {
  const dossier = process.argv[2];
  const sortieJson = process.argv.includes('--json');
  if (!dossier) {
    console.error('usage: node outillage-mesure.mjs <dossier-de-photos> [--json]');
    process.exit(1);
  }

  const photos = await listerPhotos(dossier);
  if (photos.length === 0) {
    console.error(`Aucune image trouvée dans ${dossier} (${[...EXTENSIONS_IMAGE].join(', ')}).`);
    process.exit(1);
  }

  await demarrerMoteur();
  const resultats = [];
  for (const chemin of photos) {
    resultats.push(await mesurerUnePhoto(chemin));
  }
  await arreterMoteur();

  if (sortieJson) {
    console.log(JSON.stringify(resultats, null, 2));
  } else {
    afficherTableau(resultats);
  }
}

main().catch((cause) => {
  console.error('outillage-mesure: échec', cause?.message ?? cause);
  process.exit(1);
});
