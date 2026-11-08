/**
 * QR-facture suisse — charge utile et références.
 *
 * Périmètre volontairement restreint à ce qui est **invisible et fatal** : la structure exacte
 * de la charge utile et les chiffres de contrôle des références. Le rendu (symbole QR, croix
 * suisse, section paiement aux dimensions imposées, PDF) n'est pas ici et consommera
 * `ChargeUtileQr.payload` tel quel.
 *
 * Aucune dépendance NestJS ni `@dfa/shared` : ce module est de l'arithmétique et du formatage
 * purs, appelable depuis un service, un job de rendu ou un test sans rien démarrer.
 */

export {
  QR_TYPE,
  VERSION_STRUCTURE_QR,
  TYPE_ENCODAGE_UTF8,
  TRAILER_EPD,
  SEPARATEUR_LIGNE_PAYLOAD,
  TYPE_ADRESSE_STRUCTUREE,
  NOMBRE_CHAMPS_BLOC_ADRESSE,
  NOMBRE_ELEMENTS_JUSQU_A_EPD,
  NOMBRE_ELEMENTS_AVEC_INFO_FACTURATION,
  NOMBRE_ELEMENTS_AVEC_UNE_PROCEDURE_ALTERNATIVE,
  NOMBRE_ELEMENTS_AVEC_PROCEDURES_ALTERNATIVES,
  DECOMPTES_ELEMENTS_ADMIS,
  NOMBRE_MAX_PROCEDURES_ALTERNATIVES,
  LONGUEUR_MAX_PAYLOAD,
  ORDRE_CHAMPS_PAYLOAD,
  LONGUEURS_MAX,
  TYPES_REFERENCE,
  DEVISES_ADMISES,
  MONTANT_MIN_CENTIMES,
  MONTANT_MAX_CENTIMES,
  type TypeReference,
  type DeviseQr,
} from './structure';

export { ErreurQrFacture, CODES_ERREUR_QR, type CodeErreurQr } from './erreurs-qr';

export {
  calculerChiffreControleModulo10Recursif,
  construireReferenceQrr,
  validerReferenceQrr,
  estReferenceQrrValide,
  normaliserReferenceQrr,
  formaterReferenceQrrPourAffichage,
  LONGUEUR_REFERENCE_QRR,
  LONGUEUR_BASE_REFERENCE_QRR,
} from './reference-qrr';

export {
  construireReferenceScor,
  validerReferenceScor,
  estReferenceScorValide,
  normaliserReferenceScor,
  formaterReferenceScorPourAffichage,
  LONGUEUR_MAX_REFERENCE_SCOR,
  LONGUEUR_MAX_BASE_REFERENCE_SCOR,
} from './reference-scor';

export {
  normaliserIban,
  validerIbanCreancier,
  extraireIid,
  estQrIban,
  determinerTypeReference,
  IID_QR_IBAN_MIN,
  IID_QR_IBAN_MAX,
  LONGUEUR_IBAN_CH_LI,
  PAYS_IBAN_ADMIS,
} from './iban';

export { formaterMontantPayload, encoderMontantOptionnel, validerDevise } from './montant';

export {
  evaluerCompletudeAdresse,
  encoderBlocAdresse,
  blocAdresseVide,
  assainirChamp,
  CHAMPS_REQUIS_BLOC_CREANCIER,
  adresseCreancierDepuisLigne,
  evaluerCompletudeCreancier,
  type LigneAdresseCreancier,
  CHAMPS_REQUIS_BLOC_DEBITEUR,
  PAYS_PAR_DEFAUT,
  type AdresseStructuree,
  type ChampAdresse,
  type CompletudeAdresse,
} from './adresse';

export {
  encoderChargeUtileQr,
  decouperChargeUtileQr,
  type DonneesQrFacture,
  type ChargeUtileQr,
  type AvertissementQr,
  type CodeAvertissementQr,
} from './encodeur';
