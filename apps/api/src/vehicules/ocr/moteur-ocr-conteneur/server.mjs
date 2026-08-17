// Service OCR dédié — HTTP minimal (node:http, aucune dépendance framework : un seul endpoint,
// pas besoin d'Express). Reçoit l'image en corps BRUT (le tri MIME/taille/droit est déjà fait par
// l'API principale avant l'appel réseau interne, voir apps/api/src/vehicules/ocr/), rend le texte
// brut lu par champ.
//
// AUCUNE ÉCRITURE DISQUE DE L'IMAGE REÇUE : le corps de requête est accumulé en mémoire
// (`Buffer.concat`), jamais passé à `fs.write*`/`createWriteStream`. Vérifiable par lecture de ce
// fichier et de `extraction-champs.mjs`/`pretraitement.mjs` : aucun des trois n'importe le module
// `node:fs` pour l'image (seul tesseract.js lit `fra.traineddata`, un fichier moteur, pas une
// donnée utilisateur).

import http from 'node:http';

import { arreterMoteur, demarrerMoteur, tachesEnAttente } from './moteur-tesseract.mjs';
import { ErreurFormatImage, extraireChampsPermis } from './extraction-champs.mjs';

const PORT = Number(process.env.PORT ?? 8090);
const TAILLE_MAX_OCTETS = Number(process.env.OCR_TAILLE_MAX_OCTETS ?? 12 * 1024 * 1024);
// File d'attente interne bornée : au-delà, le conteneur est déjà saturé (un scan mobilise le
// processeur) — 503 plutôt qu'un temps de réponse qui grimpe sans borne.
const PROFONDEUR_FILE_MAX = Number(process.env.OCR_PROFONDEUR_FILE_MAX ?? 4);

function lireCorpsBorne(req, limiteOctets) {
  return new Promise((resoudre, rejeter) => {
    const morceaux = [];
    let total = 0;
    let coupe = false;

    req.on('data', (morceau) => {
      if (coupe) return;
      total += morceau.length;
      if (total > limiteOctets) {
        coupe = true;
        req.destroy();
        rejeter(
          Object.assign(new Error('CORPS_TROP_VOLUMINEUX'), { code: 'CORPS_TROP_VOLUMINEUX' }),
        );
        return;
      }
      morceaux.push(morceau);
    });
    req.on('end', () => {
      if (!coupe) resoudre(Buffer.concat(morceaux));
    });
    req.on('error', rejeter);
  });
}

function repondreJson(res, statut, corps) {
  const texte = JSON.stringify(corps);
  res.writeHead(statut, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(texte);
}

const serveur = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/sante') {
    repondreJson(res, 200, { statut: 'ok', enAttente: tachesEnAttente() });
    return;
  }

  if (req.method !== 'POST' || req.url !== '/scan-permis') {
    repondreJson(res, 404, { erreur: 'ROUTE_INCONNUE' });
    return;
  }

  if (tachesEnAttente() >= PROFONDEUR_FILE_MAX) {
    repondreJson(res, 503, { erreur: 'FILE_SATUREE' });
    return;
  }

  let corps;
  try {
    corps = await lireCorpsBorne(req, TAILLE_MAX_OCTETS);
  } catch (cause) {
    if (cause.code === 'CORPS_TROP_VOLUMINEUX') {
      repondreJson(res, 413, { erreur: 'IMAGE_TROP_VOLUMINEUSE' });
    } else {
      repondreJson(res, 400, { erreur: 'CORPS_ILLISIBLE' });
    }
    return;
  }

  if (corps.length === 0) {
    repondreJson(res, 400, { erreur: 'CORPS_VIDE' });
    return;
  }

  const debut = Date.now();
  try {
    const { champs, avertissements } = await extraireChampsPermis(corps);
    repondreJson(res, 200, { champs, avertissements, dureeMs: Date.now() - debut });
  } catch (cause) {
    if (cause instanceof ErreurFormatImage) {
      repondreJson(res, 422, { erreur: 'FORMAT_NON_SUPPORTE', detail: cause.message });
      return;
    }
    // eslint-disable-next-line no-console -- conteneur autonome, pas de pino ici : la seule
    // sortie de log possible. Jamais le contenu de `corps` (l'image), jamais `champs` lus.
    console.error('vehicule-ocr-conteneur: erreur de traitement', cause?.message ?? cause);
    repondreJson(res, 500, { erreur: 'ERREUR_INTERNE' });
  } finally {
    // `corps` sort de portée ici ; rien n'en a jamais persisté copie sur disque entre-temps.
  }
});

async function demarrer() {
  await demarrerMoteur();
  serveur.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`vehicule-ocr-conteneur: à l'écoute sur le port ${PORT}`);
  });
}

async function arreterProprement() {
  serveur.close();
  await arreterMoteur();
  process.exit(0);
}

process.on('SIGTERM', arreterProprement);
process.on('SIGINT', arreterProprement);

demarrer().catch((cause) => {
  // eslint-disable-next-line no-console
  console.error('vehicule-ocr-conteneur: démarrage échoué', cause);
  process.exit(1);
});
