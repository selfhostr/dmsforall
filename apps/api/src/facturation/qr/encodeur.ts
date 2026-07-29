/**
 * Encodeur de la charge utile du Swiss QR Code (« Swiss Payments Code »).
 *
 * Produit la chaîne exacte qui sera encodée dans le symbole QR. Rien ici ne dessine, ne rend ni
 * ne met en page : le rendu graphique et le PDF viendront après, et ils consomment cette sortie
 * telle quelle.
 *
 * Deux invariants portés par ce fichier :
 *
 *  1. **Le décompte des éléments est vérifié à l'exécution**, pas seulement en test. Si le
 *     nombre d'éléments produits ne correspond pas au décompte attendu de `structure.ts`,
 *     l'encodeur **refuse d'émettre** (`DECOMPTE_ELEMENTS_INCOHERENT`). Un QR décalé d'un champ
 *     est illisible par les banques ; une exception au comptoir est infiniment préférable à une
 *     facture jolie et impayable dont on n'apprend l'échec qu'aux réclamations.
 *  2. **La charge utile est figée à l'émission** (`RF-63`). L'appelant persiste la chaîne
 *     renvoyée, telle quelle, octet pour octet. Un duplicata réimprime la chaîne stockée — il ne
 *     la recalcule jamais, sans quoi un changement de banque ou de raison sociale rendrait
 *     impayables des factures déjà envoyées.
 */

import {
  encoderBlocAdresse,
  evaluerCompletudeAdresse,
  blocAdresseVide,
  assainirChamp,
  CHAMPS_REQUIS_BLOC_CREANCIER,
  CHAMPS_REQUIS_BLOC_DEBITEUR,
  type AdresseStructuree,
  type ChampAdresse,
} from './adresse';
import { ErreurQrFacture } from './erreurs-qr';
import { determinerTypeReference, validerIbanCreancier } from './iban';
import { encoderMontantOptionnel, validerDevise } from './montant';
import { validerReferenceQrr } from './reference-qrr';
import { validerReferenceScor } from './reference-scor';
import {
  DECOMPTES_ELEMENTS_ADMIS,
  LONGUEURS_MAX,
  LONGUEUR_MAX_PAYLOAD,
  NOMBRE_MAX_PROCEDURES_ALTERNATIVES,
  QR_TYPE,
  SEPARATEUR_LIGNE_PAYLOAD,
  TRAILER_EPD,
  TYPE_ENCODAGE_UTF8,
  VERSION_STRUCTURE_QR,
  type DeviseQr,
  type TypeReference,
} from './structure';

/** Données d'entrée de l'encodeur. Les montants y sont **toujours** en centimes entiers. */
export interface DonneesQrFacture {
  /** IBAN ou QR-IBAN du garage. Espaces tolérés en entrée, supprimés à l'encodage. */
  readonly ibanCreancier: string;
  /** Le garage. Adresse complète obligatoire (`RF-54`). */
  readonly creancier: AdresseStructuree;
  /**
   * Montant total de la facture, en **centimes**. `null` / `undefined` = QR sans montant, que
   * le payeur saisit lui-même (`RF-57`). Ne change jamais après un paiement partiel (`RF-64`).
   */
  readonly montantCentimes?: number | null;
  readonly devise: string;
  /**
   * Le client. Omis **en entier** si son adresse est incomplète (`RF-59`) — voir `adresse.ts`.
   */
  readonly debiteur?: AdresseStructuree | null;
  /**
   * Référence. Son type découle de l'IBAN (`RF-55`) : QRR de 27 chiffres pour un QR-IBAN,
   * SCOR (`RF…`) ou rien pour un IBAN ordinaire.
   */
  readonly reference?: string | null;
  /** Message non structuré, 140 caractères — typiquement « Facture 2026-00424 ». */
  readonly messageNonStructure?: string | null;
  /** Information de facturation structurée Swico S1, 140 caractères. */
  readonly informationFacturation?: string | null;
  /** Procédures alternatives, deux au maximum, 100 caractères chacune. */
  readonly proceduresAlternatives?: readonly string[] | null;
}

export type CodeAvertissementQr =
  /** Le bloc débiteur a été omis : adresse incomplète (`RF-59`, `RF-61`). */
  | 'BLOC_DEBITEUR_OMIS_ADRESSE_INCOMPLETE'
  /** Aucun débiteur n'a été fourni du tout — cas normal d'un bulletin ouvert. */
  | 'BLOC_DEBITEUR_ABSENT';

export interface AvertissementQr {
  readonly code: CodeAvertissementQr;
  /**
   * Champs qui manquaient. C'est ce que l'écran d'émission affiche pour proposer de compléter
   * la fiche en un clic (`RF-61`) — l'avertissement nomme le manquant, il ne bloque pas.
   */
  readonly champsManquants: readonly ChampAdresse[];
}

export interface ChargeUtileQr {
  /** La chaîne à encoder dans le symbole QR, séparateurs CR+LF compris. À figer telle quelle. */
  readonly payload: string;
  /** Les éléments, dans l'ordre — utile aux tests et au diagnostic. */
  readonly elements: readonly string[];
  /** Longueur de `elements`. Doit valoir 31, 32 ou 34 (cf. `structure.ts`). */
  readonly nombreElements: number;
  readonly typeReference: TypeReference;
  readonly reference: string;
  readonly devise: DeviseQr;
  /** Faux quand le bloc débiteur a été omis — l'écran doit le dire à l'utilisateur. */
  readonly blocDebiteurEmis: boolean;
  readonly avertissements: readonly AvertissementQr[];
}

/**
 * Construit la charge utile du Swiss QR Code.
 *
 * @throws ErreurQrFacture — l'émission est refusée plutôt que de produire un QR douteux.
 */
export function encoderChargeUtileQr(donnees: DonneesQrFacture): ChargeUtileQr {
  const elements: string[] = [];
  const avertissements: AvertissementQr[] = [];

  /* 1-3 — En-tête (3 éléments). */
  elements.push(QR_TYPE, VERSION_STRUCTURE_QR, TYPE_ENCODAGE_UTF8);

  /* 4 — IBAN du créancier (1 élément). */
  const iban = validerIbanCreancier(donnees.ibanCreancier);
  elements.push(iban);

  /* 5-11 — Créancier (7 éléments). Incomplet ⇒ émission refusée (RF-54, PF-03). */
  const completudeCreancier = evaluerCompletudeAdresse(
    donnees.creancier,
    CHAMPS_REQUIS_BLOC_CREANCIER,
  );
  if (!completudeCreancier.complete) {
    throw new ErreurQrFacture(
      'CREANCIER_INCOMPLET',
      'Le bloc créancier est incomplet : ' +
        `${completudeCreancier.champsManquants.join(', ')}. Compléter les coordonnées du garage ` +
        'dans le paramétrage avant d’émettre.',
      `creancier.${completudeCreancier.champsManquants[0] ?? 'nom'}`,
    );
  }
  elements.push(...encoderBlocAdresse(donnees.creancier, 'creancier'));

  /* 12-18 — Ultimate Creditor (7 éléments VIDES).
     C'est le bloc contesté : 7 champs, pas 6. Réservé par la spécification, jamais rempli. */
  elements.push(...blocAdresseVide());

  /* 19-20 — Montant et devise (2 éléments). */
  elements.push(encoderMontantOptionnel(donnees.montantCentimes));
  const devise = validerDevise(donnees.devise);
  elements.push(devise);

  /* 21-27 — Débiteur (7 éléments, remplis ou tous vides — jamais partiels). */
  const completudeDebiteur = evaluerCompletudeAdresse(donnees.debiteur, CHAMPS_REQUIS_BLOC_DEBITEUR);
  const blocDebiteurEmis = completudeDebiteur.complete;

  if (blocDebiteurEmis && donnees.debiteur) {
    elements.push(...encoderBlocAdresse(donnees.debiteur, 'debiteur'));
  } else {
    elements.push(...blocAdresseVide());
    avertissements.push({
      code:
        donnees.debiteur === null || donnees.debiteur === undefined
          ? 'BLOC_DEBITEUR_ABSENT'
          : 'BLOC_DEBITEUR_OMIS_ADRESSE_INCOMPLETE',
      champsManquants: completudeDebiteur.champsManquants,
    });
  }

  /* 28-29 — Type de référence et référence (2 éléments). */
  const { type: typeReference, reference } = determinerTypeReference(iban, donnees.reference, {
    validerQrr: validerReferenceQrr,
    validerScor: validerReferenceScor,
  });
  elements.push(typeReference, reference);

  /* 30 — Message non structuré (1 élément). */
  const message = assainirChamp(
    donnees.messageNonStructure ?? '',
    'messageNonStructure',
    LONGUEURS_MAX.messageNonStructure,
  );
  elements.push(message);

  /* 31 — Trailer EPD. Le décompte de référence s'arrête ici. */
  elements.push(TRAILER_EPD);

  /* 32 — Information de facturation Swico S1 (facultative). */
  const informationFacturation = assainirChamp(
    donnees.informationFacturation ?? '',
    'informationFacturation',
    LONGUEURS_MAX.informationFacturation,
  );

  if (message.length + informationFacturation.length > LONGUEURS_MAX.messageEtInformationFacturation) {
    throw new ErreurQrFacture(
      'CHAMP_TROP_LONG',
      'Le message non structuré et l’information de facturation totalisent plus de ' +
        `${LONGUEURS_MAX.messageEtInformationFacturation} caractères ` +
        `(${message.length} + ${informationFacturation.length}).`,
      'messageNonStructure',
    );
  }

  /* 33-34 — Procédures alternatives (facultatives, deux au maximum). */
  const proceduresAlternatives = (donnees.proceduresAlternatives ?? []).map((procedure, index) =>
    assainirChamp(
      procedure,
      `proceduresAlternatives[${index}]`,
      LONGUEURS_MAX.procedureAlternative,
    ),
  );

  if (proceduresAlternatives.length > NOMBRE_MAX_PROCEDURES_ALTERNATIVES) {
    throw new ErreurQrFacture(
      'TROP_DE_PROCEDURES_ALTERNATIVES',
      `Au maximum ${NOMBRE_MAX_PROCEDURES_ALTERNATIVES} procédures alternatives ` +
        `(reçu ${proceduresAlternatives.length}).`,
      'proceduresAlternatives',
    );
  }

  // Les éléments facultatifs de queue ne sont ajoutés que s'il y a quelque chose à ajouter —
  // et `StrdBkgInf` doit être présent (fût-il vide) dès qu'une procédure alternative suit,
  // sans quoi les AltPmt remonteraient d'un rang et seraient lues comme l'information Swico.
  if (informationFacturation.length > 0 || proceduresAlternatives.length > 0) {
    elements.push(informationFacturation);
    elements.push(...proceduresAlternatives);
  }

  /* Garde-fou d'exécution : le décompte, avant toute chose. */
  if (!DECOMPTES_ELEMENTS_ADMIS.includes(elements.length)) {
    throw new ErreurQrFacture(
      'DECOMPTE_ELEMENTS_INCOHERENT',
      `Charge utile QR à ${elements.length} éléments alors que seuls ` +
        `${DECOMPTES_ELEMENTS_ADMIS.join(', ')} sont admis. Un champ en trop ou en moins décale ` +
        'tout ce qui suit et rend le QR illisible par les banques : émission refusée.',
    );
  }

  const payload = elements.join(SEPARATEUR_LIGNE_PAYLOAD);

  if (payload.length > LONGUEUR_MAX_PAYLOAD) {
    throw new ErreurQrFacture(
      'PAYLOAD_TROP_LONG',
      `La charge utile fait ${payload.length} caractères, maximum ${LONGUEUR_MAX_PAYLOAD}. ` +
        'Raccourcir le message non structuré ou l’information de facturation.',
    );
  }

  return {
    payload,
    elements,
    nombreElements: elements.length,
    typeReference,
    reference,
    devise,
    blocDebiteurEmis,
    avertissements,
  };
}

/**
 * Relit une charge utile figée et en extrait les éléments. Sert au contrôle d'un duplicata
 * (`RF-63`) : le payload rejoué doit être identique octet pour octet à celui persisté.
 */
export function decouperChargeUtileQr(payload: string): readonly string[] {
  return payload.split(SEPARATEUR_LIGNE_PAYLOAD);
}
