/**
 * Décodage d'une charge utile Swiss QR Code (« Swiss Payments Code », SPC) — l'INVERSE de
 * `facturation/qr/encodeur.ts`. Réutilise `facturation/qr` en LECTURE SEULE (module voisin,
 * jamais modifié par ce lot) comme SEULE SOURCE DE VÉRITÉ pour l'ordre/le nombre de champs
 * (`ORDRE_CHAMPS_PAYLOAD`, `DECOMPTES_ELEMENTS_ADMIS`) — exactement ce que son en-tête demande :
 * « tout se corrige ici, aucun autre fichier ne compte de champs à la main ». Le DÉCODAGE
 * lui-même (ce fichier) est une réécriture indépendante, jamais un import de logique d'encodage.
 *
 * Lecture EXACTE, sans reconnaissance de caractères — la donnée la plus fiable de toute la chaîne
 * (`contrats/pieces/enums.ts`, `OrigineDonneeFacture`).
 */
import {
  DECOMPTES_ELEMENTS_ADMIS,
  NOMBRE_ELEMENTS_JUSQU_A_EPD,
  ORDRE_CHAMPS_PAYLOAD,
  QR_TYPE,
  SEPARATEUR_LIGNE_PAYLOAD,
  TRAILER_EPD,
} from '../../../facturation/qr';

import type { EnTeteFactureExtrait } from './types';

/** Mutable le temps de la construction — le type public reste `readonly`, voir `types.ts`. */
type EnTeteFactureExtraitMutable = {
  -readonly [K in keyof EnTeteFactureExtrait]?: EnTeteFactureExtrait[K];
};

/**
 * Inverse de `formaterMontantPayload` (`facturation/qr/montant.ts`) : chaîne `"123.45"` ->
 * centimes entiers. Arithmétique ENTIÈRE sur les deux morceaux de la chaîne — jamais
 * `Math.round(parseFloat(txt) * 100)`, dont l'arrondi binaire est exactement ce que
 * `montant.ts` documente vouloir éviter à l'encodage ; le décodage doit la même rigueur.
 * `null` si la chaîne est vide (QR sans montant imposé, `RF-57`) ou mal formée.
 */
export function centimesDepuisMontantQr(texte: string): number | null {
  const nettoye = texte.trim();
  if (nettoye.length === 0) return null;
  const correspondance = /^(\d{1,9})(?:\.(\d{2}))?$/.exec(nettoye);
  if (!correspondance) return null;
  const francs = Number(correspondance[1]);
  const centimes = correspondance[2] ? Number(correspondance[2]) : 0;
  if (!Number.isSafeInteger(francs)) return null;
  return francs * 100 + centimes;
}

/**
 * Décode une charge utile SPC en champs d'en-tête, chacun marqué `origine: 'qr'`. `null` si la
 * charge utile n'est structurellement PAS un Swiss QR Code valide (type/version/trailer, ou un
 * décompte d'éléments hors de `DECOMPTES_ELEMENTS_ADMIS`) — un symbole trouvé dans un PDF n'est
 * pas forcément une QR-facture (logo, code de suivi de colis…), ce cas doit rester silencieux
 * (diagnostic côté appelant), jamais une exception.
 */
export function decoderPayloadQrFacture(payload: string): EnTeteFactureExtrait | null {
  const elements = payload.split(SEPARATEUR_LIGNE_PAYLOAD);

  if (!(DECOMPTES_ELEMENTS_ADMIS as readonly number[]).includes(elements.length)) return null;
  if (elements[0] !== QR_TYPE) return null;
  if (elements[NOMBRE_ELEMENTS_JUSQU_A_EPD - 1] !== TRAILER_EPD) return null;

  const champs = new Map<string, string>();
  for (let i = 0; i < elements.length; i++) {
    const chemin = ORDRE_CHAMPS_PAYLOAD[i];
    const valeur = elements[i];
    if (chemin !== undefined && valeur !== undefined) champs.set(chemin, valeur);
  }

  const iban = champs.get('QRCH/CdtrInf/IBAN')?.trim();
  const nomCreancier = champs.get('QRCH/CdtrInf/Cdtr/Name')?.trim();
  const montantTexte = champs.get('QRCH/CcyAmt/Amt') ?? '';
  const devise = champs.get('QRCH/CcyAmt/Ccy')?.trim();
  const typeReference = champs.get('QRCH/RmtInf/Tp')?.trim();
  const reference = champs.get('QRCH/RmtInf/Ref')?.trim();

  const montantCentimes = centimesDepuisMontantQr(montantTexte);

  const resultat: EnTeteFactureExtraitMutable = {};

  if (iban) resultat.ibanCreancier = { valeur: iban, origine: 'qr' };
  if (nomCreancier) resultat.nomCreancier = { valeur: nomCreancier, origine: 'qr' };
  if (montantCentimes !== null)
    resultat.montantTotalCentimes = { valeur: montantCentimes, origine: 'qr' };
  if (devise) resultat.devise = { valeur: devise, origine: 'qr' };
  // `NON` = pas de référence (RF-55) : distinct d'une référence absente par erreur de lecture,
  // mais dans les deux cas rien à exposer côté rapprochement.
  if (reference && typeReference !== 'NON') {
    resultat.referencePaiement = { valeur: reference, origine: 'qr' };
  }

  return resultat;
}
