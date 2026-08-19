// Moteur OCR — Tesseract via tesseract.js (WASM, aucun binaire natif, aucun appel réseau à
// l'exécution : `fra.traineddata` embarqué dans l'image au build, voir Dockerfile). Choix
// justifié dans le rapport de livraison par une MESURE (précision par champ, temps, mémoire sur
// l'échantillon réel) plutôt que par réputation.
//
// Un petit pool de workers réutilisés (init coûte ~1-2s, à ne payer qu'au démarrage du
// conteneur, jamais par requête) — un scan mobilise déjà le processeur, la file d'attente ci-
// dessous fait que deux scans simultanés se sérialisent proprement plutôt que de saturer la
// mémoire avec des workers créés à la volée.

import { createWorker, PSM } from 'tesseract.js';

const TAILLE_POOL = Number(process.env.OCR_POOL_SIZE ?? 2);
const CHEMIN_LANGUES = process.env.OCR_TESSDATA_PATH ?? '/app/tessdata';

let pool = null;

/** File d'attente FIFO simple : chaque tâche attend qu'un worker du pool se libère. */
class PoolWorkers {
  constructor(workers) {
    this.libres = [...workers];
    this.attente = [];
  }

  async emprunter() {
    if (this.libres.length > 0) return this.libres.pop();
    return new Promise((resoudre) => this.attente.push(resoudre));
  }

  rendre(worker) {
    const suivant = this.attente.shift();
    if (suivant) {
      suivant(worker);
    } else {
      this.libres.push(worker);
    }
  }

  get enAttente() {
    return this.attente.length;
  }
}

export async function demarrerMoteur() {
  if (pool) return pool;
  const workers = await Promise.all(
    Array.from({ length: TAILLE_POOL }, () =>
      createWorker('fra', 1, {
        langPath: CHEMIN_LANGUES,
        cachePath: CHEMIN_LANGUES,
        gzip: false,
        // Pas de téléchargement réseau : le traineddata est déjà sur disque (image Docker),
        // conforme à la décision « aucun service externe ».
        cacheMethod: 'none',
      }),
    ),
  );
  pool = new PoolWorkers(workers);
  return pool;
}

export async function arreterMoteur() {
  if (!pool) return;
  await Promise.all(pool.libres.map((w) => w.terminate()));
  pool = null;
}

export function tachesEnAttente() {
  return pool?.enAttente ?? 0;
}

async function avecWorker(fn) {
  if (!pool) throw new Error('Moteur OCR non démarré (demarrerMoteur() non appelé).');
  const worker = await pool.emprunter();
  try {
    return await fn(worker);
  } finally {
    pool.rendre(worker);
  }
}

/** Passe pleine page : localisation des libellés (ancres), pas encore les valeurs. */
export async function reconnaitrePleinePage(buffer) {
  return avecWorker(async (worker) => {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, tessedit_char_whitelist: '' });
    const { data } = await worker.recognize(
      buffer,
      {},
      {
        blocks: true,
        text: false,
        hocr: false,
        tsv: false,
        box: false,
        unlv: false,
        osd: false,
        pdf: false,
        imageColor: false,
        imageGrey: false,
        imageBinary: false,
      },
    );
    return data.blocks ?? [];
  });
}

/**
 * Passe ciblée : une zone déjà recadrée + agrandie autour d'une valeur. `psm` single-line pour
 * les champs courts (VIN, code type, plaque, date), single-block pour l'adresse (plusieurs
 * lignes). `whitelist` vide = pas de restriction de caractères (nom/adresse : accents, espaces).
 */
export async function reconnaitreChamp(buffer, { psm = PSM.SINGLE_LINE, whitelist = '' } = {}) {
  return avecWorker(async (worker) => {
    await worker.setParameters({
      tessedit_pageseg_mode: psm,
      tessedit_char_whitelist: whitelist,
    });
    const { data } = await worker.recognize(
      buffer,
      {},
      {
        blocks: false,
        text: true,
        hocr: false,
        tsv: false,
        box: false,
        unlv: false,
        osd: false,
        pdf: false,
        imageColor: false,
        imageGrey: false,
        imageBinary: false,
      },
    );
    return { texte: (data.text ?? '').trim(), confiance: data.confidence ?? 0 };
  });
}

export { PSM };
