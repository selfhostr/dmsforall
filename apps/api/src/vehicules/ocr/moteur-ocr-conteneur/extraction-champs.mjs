// Orchestration d'un scan complet. Rend du texte BRUT par champ, jamais interprété : la
// validation (formats, checksum VIN, correspondance référentiel/véhicules/clients) est un
// problème de données métier, elle vit côté API principale (apps/api/src/vehicules/ocr/, hors de
// ce conteneur) — ce module ne fait QUE de la lecture de pixels.
//
// DEUX CHEMINS (refonte du 18.08 — cadrage guidé côté écran mobile, cible 5s) :
//
//   1. CADRÉ (par défaut, rapide) — l'écran mobile impose un cadre à remplir avec le RECTO du
//      permis (voir apps/web/src/ecrans/scan/) : la position de chaque champ dans la photo est
//      donc CONNUE D'AVANCE (`zones-cadrees.mjs`), pas à découvrir par une passe pleine page. Zéro
//      appel `reconnaitrePleinePage` — directement 6 recadrages + 6 OCR ciblés, EN PARALLÈLE
//      (mesuré : ~2000-6000ms selon la source, contre ~14-24s pour le chemin d'hier — voir le
//      rapport de livraison).
//
//   2. REPLI (localisation par libellés, `ancres.mjs`) — déclenché automatiquement si le chemin
//      cadré ne rend pas assez de champs exploitables (photo forcée hors cadre, cf. l'écran
//      mobile qui permet de forcer une photo non conforme). C'est le chemin d'hier, optimisé :
//      résolution de repérage réduite (mesuré : passe pleine page ~7-8x plus rapide à 1100px
//      qu'à 2000px, confiance de localisation des libellés inchangée) tout en gardant une
//      résolution élevée pour le recadrage de VALEUR (repéré et recadré ne sont plus la même
//      image — voir `pretraitement.reduireResolutionPage` et `ancres.boiteValeurFraction`).
//
// AUCUN FLAG DE MODE dans la requête HTTP : le chemin cadré est TOUJOURS tenté en premier, le
// repli est une conséquence automatique d'un rendement insuffisant, jamais un choix transmis par
// l'appelant — évite toute renégociation du contrat HTTP interne API<->conteneur pour ce choix.
// Signalé pour arbitrage (rapport de livraison) : l'écran connaît pourtant déjà, lui, si
// l'utilisateur a forcé une photo hors cadre — un signal explicite éviterait une tentative cadrée
// vouée à l'échec sur ces photos-là. Non câblé aujourd'hui faute de coordination avec l'agent
// front sur ce point précis.
import {
  decoderHeicVersPng,
  estHeic,
  pretraiterPageComplete,
  reduireResolutionPage,
  recadrerChamp,
} from './pretraitement.mjs';
import {
  boiteValeurFraction,
  CHAMPS_CONNUS,
  localiserAncres,
  motsDepuisBlocs,
  normaliserBboxFraction,
} from './ancres.mjs';
import { CHAMPS_CONNUS_CADRE, ZONES_CADRE_PROVISOIRE } from './zones-cadrees.mjs';
import { elargirEtBornerBoite, fractionVersPixels } from './geometrie.mjs';
import { PSM, reconnaitreChamp, reconnaitrePleinePage } from './moteur-tesseract.mjs';

const CONFIG_PAR_CHAMP = {
  vin: { psm: PSM.SINGLE_LINE, whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ' },
  codeTypeCh: { psm: PSM.SINGLE_LINE, whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -' },
  plaque: { psm: PSM.SINGLE_LINE, whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ' },
  premiereMiseEnCirculationLe: { psm: PSM.SINGLE_LINE, whitelist: '0123456789.' },
  detenteurNom: { psm: PSM.SINGLE_LINE, whitelist: '' },
  detenteurAdresse: { psm: PSM.SINGLE_BLOCK, whitelist: '' },
};

// --- Résolutions (mesurées sur l'échantillon réel, voir rapport de livraison) — env-surchargeables
// pour recalibrage rapide sans rebuild d'image, même patron que OCR_POOL_SIZE (moteur-tesseract.mjs).
/**
 * UNE SEULE source de recadrage, partagée par les deux chemins (cadré ET repli, si le repli se
 * déclenche) — un second `pretraiterPageComplete` séparé pour le repli (première version de cette
 * refonte) coûtait un second décodage/redimensionnement complet en pure perte quand le repli
 * s'enchaîne après un chemin cadré déjà tenté (mesuré : ~1s gâché sur le cas de repli). N'a plus
 * besoin d'une résolution pleine page comme hier (plus de passe OCR dessus pour le repérage, voir
 * `LARGEUR_REPERE_REPLI` ci-dessous) — juste assez pour que les petites zones recadrées restent
 * nettes une fois upscalées par `recadrerChamp` (mesuré : 1400px suffisant pour les deux chemins,
 * ~750ms de prétraitement contre ~6.5s à 2000px sur l'échantillon réel).
 */
const LARGEUR_PAGE = Number(process.env.OCR_LARGEUR_PAGE ?? 1400);
/** Passe de repérage (localisation des libellés) du chemin repli : mesuré ~7-8x plus rapide à
 *  1100px qu'à 2000px, sans perte de confiance de localisation sur l'échantillon réel — un libellé
 *  IMPRIMÉ (texte fixe connu) reste lisible à cette résolution, contrairement à une valeur
 *  variable. */
const LARGEUR_REPERE_REPLI = Number(process.env.OCR_LARGEUR_REPERE_REPLI ?? 1100);
/** Nombre minimal de champs avec du texte non vide pour considérer le chemin cadré suffisant —
 *  sous ce seuil, la photo est probablement hors cadre (forcée) : on retente en repli plutôt que
 *  de rendre un résultat pauvre. Seuil PROVISOIRE (voir zones-cadrees.mjs) : à ajuster une fois le
 *  corpus réel disponible et les zones recalibrées. */
const SEUIL_CHAMPS_SUFFISANTS_CADRE = Number(process.env.OCR_SEUIL_CHAMPS_CADRE ?? 3);

export class ErreurFormatImage extends Error {
  constructor(message) {
    super(message);
    this.name = 'ErreurFormatImage';
  }
}

/** Facteur d'agrandissement CIBLÉ sur la largeur RÉELLE de la découpe (pas une largeur de sortie
 *  fixe pour tous les champs, ce qui donnait un facteur très inégal selon la largeur de zone —
 *  mesuré : ~2.3x sur VIN/plaque contre ~4.1x sur code type avec l'ancien `largeurCible` fixe à
 *  1800px, en dehors de la fourchette 3-4x documentée pour les champs techniques). Borné haut pour
 *  ne pas payer un coût mémoire/temps Tesseract disproportionné sur une découpe déjà large (zone
 *  nom/adresse, plus permissive) ni bas pour rester lisible sur une découpe minuscule. */
export const FACTEUR_AGRANDISSEMENT_CIBLE = 3.5;
export const LARGEUR_CROP_MIN = 1200;
export const LARGEUR_CROP_MAX = 3600;

/** Fonction pure (testable sans image ni Tesseract, voir extraction-champs.spec.mjs) — extraite
 *  d'`ocrZone` pour ne pas enterrer cette règle dans un pipeline async. */
export function calculerLargeurCibleChamp(largeurBoitePixel) {
  return Math.min(
    LARGEUR_CROP_MAX,
    Math.max(LARGEUR_CROP_MIN, Math.round(largeurBoitePixel * FACTEUR_AGRANDISSEMENT_CIBLE)),
  );
}

async function ocrZone(bufferPageSource, boitePixel, nomChamp) {
  const largeurCible = calculerLargeurCibleChamp(boitePixel.width);
  const crop = await recadrerChamp(bufferPageSource, boitePixel, { largeurCible });
  const resultat = await reconnaitreChamp(crop, CONFIG_PAR_CHAMP[nomChamp]);
  const texte = resultat.texte.trim();
  return texte.length > 0 ? { texte, confiance: resultat.confiance } : null;
}

/** Chemin CADRÉ : 6 zones à coordonnées fixes, EN PARALLÈLE (le pool de workers borne déjà le
 *  parallélisme réel, voir moteur-tesseract.mjs — soumettre les 6 d'un coup ne sature rien de plus
 *  qu'une soumission séquentielle, juste plus vite, mesuré ~2.3x sur l'échantillon réel). */
async function extraireParZonesCadrees(pagePretraitee) {
  const champs = {};
  const avertissements = [];

  await Promise.all(
    CHAMPS_CONNUS_CADRE.map(async (nomChamp) => {
      const boiteFraction = ZONES_CADRE_PROVISOIRE[nomChamp];
      const boitePixel = elargirEtBornerBoite(
        fractionVersPixels(boiteFraction, pagePretraitee.largeur, pagePretraitee.hauteur),
        pagePretraitee.largeur,
        pagePretraitee.hauteur,
      );
      const resultat = await ocrZone(pagePretraitee.buffer, boitePixel, nomChamp);
      champs[nomChamp] = resultat;
      if (!resultat) avertissements.push(`zone_cadre_vide:${nomChamp}`);
    }),
  );

  return { champs, avertissements };
}

/** Chemin REPLI : localisation par libellés (repérage basse résolution) puis recadrage haute
 *  résolution + OCR, EN PARALLÈLE sur les champs dont l'ancre a été trouvée. */
async function extraireParLocalisationLibelles(pageHauteRes) {
  const pageRepere = await reduireResolutionPage(pageHauteRes.buffer, {
    largeurCible: LARGEUR_REPERE_REPLI,
  });
  const blocs = await reconnaitrePleinePage(pageRepere.buffer);
  const mots = motsDepuisBlocs(blocs);
  const ancres = localiserAncres(mots);

  const champs = {};
  const avertissements = [];

  await Promise.all(
    CHAMPS_CONNUS.map(async (nomChamp) => {
      const ancre = ancres[nomChamp];
      if (!ancre) {
        champs[nomChamp] = null;
        avertissements.push(`libelle_non_localise:${nomChamp}`);
        return;
      }

      const ancreFraction = normaliserBboxFraction(
        ancre.bbox,
        pageRepere.largeur,
        pageRepere.hauteur,
      );
      const boiteFraction = boiteValeurFraction(nomChamp, ancreFraction);
      const boitePixel = elargirEtBornerBoite(
        fractionVersPixels(boiteFraction, pageHauteRes.largeur, pageHauteRes.hauteur),
        pageHauteRes.largeur,
        pageHauteRes.hauteur,
      );
      const resultat = await ocrZone(pageHauteRes.buffer, boitePixel, nomChamp);
      champs[nomChamp] = resultat;
      if (!resultat) avertissements.push(`zone_repli_vide:${nomChamp}`);
    }),
  );

  return { champs, avertissements };
}

function nombreChampsExploitables(champs) {
  return Object.values(champs).filter((c) => c !== null).length;
}

/**
 * `buffer` : octets bruts de l'image telle qu'envoyée par le client (jamais écrits sur disque —
 * voir pretraitement.mjs). Rend `{ champs, avertissements }` : `champs[nomChamp]` est `null` si
 * rien d'exploitable n'a pu en être lu (jamais une zone devinée à l'aveugle sans texte), sinon
 * `{ texte, confiance }` BRUT.
 */
export async function extraireChampsPermis(buffer) {
  let octetsImage = buffer;
  if (estHeic(buffer)) {
    try {
      octetsImage = await decoderHeicVersPng(buffer);
    } catch (cause) {
      const err = new ErreurFormatImage(
        'Décodage HEIC/HEIF échoué : fichier corrompu ou variante non supportée.',
      );
      err.cause = cause;
      throw err;
    }
  }

  let page;
  try {
    page = await pretraiterPageComplete(octetsImage, { largeurCible: LARGEUR_PAGE });
  } catch (cause) {
    const err = new ErreurFormatImage('Image illisible (format non reconnu ou fichier corrompu).');
    err.cause = cause;
    throw err;
  }

  // ORIENTATION — observée, jamais utilisée pour changer de chemin : une tentative sur le corpus
  // réel (18.08) qui envoyait toute photo PORTRAIT direct en repli (en sautant le chemin cadré, au
  // motif que `zones-cadrees.mjs` vise un livret ouvert double page, structurellement absent d'un
  // cadre portrait) a été MESURÉE PUIS ABANDONNÉE : sur l'unique photo portrait du corpus (1/13),
  // le chemin cadré lisait 4 champs sur 6 quand le repli forcé n'en lisait ZÉRO — l'hypothèse
  // structurelle était raisonnable, le résultat mesuré la contredit. Avec un seul échantillon
  // portrait, rien ne permet de trancher pour de bon dans un sens ou dans l'autre ; se fier à un
  // raisonnement plutôt qu'à la mesure sur ce point précis aurait dégradé un cas réel plutôt que de
  // l'améliorer. L'étiquette ci-dessous reste pour permettre de RECALIBRER une fois un corpus
  // portrait plus large disponible — voir le rapport de livraison pour la recommandation côté écran
  // de capture (contraindre l'orientation plutôt que deviner côté serveur).
  const etiquetteOrientation =
    page.hauteur > page.largeur ? 'orientation:portrait' : 'orientation:paysage';

  const resultatCadre = await extraireParZonesCadrees(page);
  if (nombreChampsExploitables(resultatCadre.champs) >= SEUIL_CHAMPS_SUFFISANTS_CADRE) {
    return {
      champs: resultatCadre.champs,
      avertissements: [...resultatCadre.avertissements, etiquetteOrientation, 'mode:cadre'],
    };
  }

  // Repli : photo probablement forcée hors cadre. Réutilise LA MÊME page prétraitée (aucun second
  // décodage/redimensionnement) — seule la passe de repérage travaille sur une copie réduite
  // (`reduireResolutionPage`, dans `extraireParLocalisationLibelles`), le recadrage de valeur
  // repart bien de `page` en pleine résolution.
  const resultatRepli = await extraireParLocalisationLibelles(page);
  return {
    champs: resultatRepli.champs,
    avertissements: [
      ...resultatCadre.avertissements.map((a) => `cadre_insuffisant:${a}`),
      ...resultatRepli.avertissements,
      etiquetteOrientation,
      'mode:repli',
    ],
  };
}
