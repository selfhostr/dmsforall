// Orchestration d'un scan complet : prétraitement -> passe pleine page (ancres) -> recadrage
// ciblé + OCR par champ. Rend du texte BRUT par champ, jamais interprété : la validation
// (formats, checksum VIN, correspondance référentiel/véhicules/clients) est un problème de
// données métier, elle vit côté API principale (apps/api/src/vehicules/ocr/, hors de ce
// conteneur) — ce module ne fait QUE de la lecture de pixels.

import {
  decoderHeicVersPng,
  estHeic,
  pretraiterPageComplete,
  recadrerChamp,
} from './pretraitement.mjs';
import { boiteValeur, CHAMPS_CONNUS, localiserAncres, motsDepuisBlocs } from './ancres.mjs';
import { PSM, reconnaitreChamp, reconnaitrePleinePage } from './moteur-tesseract.mjs';

const CONFIG_PAR_CHAMP = {
  vin: { psm: PSM.SINGLE_LINE, whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ' },
  codeTypeCh: { psm: PSM.SINGLE_LINE, whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -' },
  plaque: { psm: PSM.SINGLE_LINE, whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ' },
  premiereMiseEnCirculationLe: { psm: PSM.SINGLE_LINE, whitelist: '0123456789.' },
  detenteurNom: { psm: PSM.SINGLE_LINE, whitelist: '' },
  detenteurAdresse: { psm: PSM.SINGLE_BLOCK, whitelist: '' },
};

export class ErreurFormatImage extends Error {
  constructor(message) {
    super(message);
    this.name = 'ErreurFormatImage';
  }
}

/**
 * `buffer` : octets bruts de l'image telle qu'envoyée par le client (jamais écrits sur disque —
 * voir pretraitement.mjs). Rend `{ champs, avertissements }` : `champs[nomChamp]` est `null` si
 * le libellé correspondant n'a pas été localisé (jamais une zone devinée à l'aveugle), sinon
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

  let pagePretraitee;
  try {
    pagePretraitee = await pretraiterPageComplete(octetsImage);
  } catch (cause) {
    const err = new ErreurFormatImage('Image illisible (format non reconnu ou fichier corrompu).');
    err.cause = cause;
    throw err;
  }

  const blocs = await reconnaitrePleinePage(pagePretraitee.buffer);
  const mots = motsDepuisBlocs(blocs);
  const ancres = localiserAncres(mots);

  const champs = {};
  const avertissements = [];

  for (const nomChamp of CHAMPS_CONNUS) {
    const ancre = ancres[nomChamp];
    if (!ancre) {
      champs[nomChamp] = null;
      avertissements.push(`libelle_non_localise:${nomChamp}`);
      continue;
    }

    const boite = boiteValeur(nomChamp, ancre.bbox, pagePretraitee.largeur, pagePretraitee.hauteur);
    const crop = await recadrerChamp(pagePretraitee.buffer, boite);
    const config = CONFIG_PAR_CHAMP[nomChamp];
    const resultat = await reconnaitreChamp(crop, config);
    champs[nomChamp] = { texte: resultat.texte, confiance: resultat.confiance };
  }

  return { champs, avertissements };
}
