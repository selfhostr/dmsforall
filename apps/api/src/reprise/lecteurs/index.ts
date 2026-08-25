/**
 * Bibliothèque de lecture des archives de reprise — point d'entrée public.
 *
 * Bibliothèque pure, sans dépendance à Nest : reconnaît la famille de moteur (Access/FoxPro-dBase)
 * sur en-tête binaire, lit les tables en flux (jamais tout en mémoire), et devine le rôle métier
 * de chaque table à son contenu. Types internes (`types.ts`) — la couche d'assemblage (hors de ce
 * périmètre) convertit vers le contrat partagé `@dfa/shared`.
 */

export * from './types';
export * from './erreurs';

export { sniffFamilleFichier, detecterFamilleRepertoire } from './detection-famille';

export { decoderChaineDbf, encodageDepuisOctetPageDeCode, type EncodageDbf } from './dbf/codepages';
export {
  analyserEnTeteDbf,
  analyserEnTeteDepuisTampon,
  type EnTeteDbfBrute,
} from './dbf/en-tete-dbf';
export { ouvrirMemoFpt, type BlocMemo, type LecteurMemoFpt } from './dbf/memo-fpt';
export { lireLignesDbf, compterLignesActivesDbf } from './dbf/lecteur-dbf';

export {
  verifierMdbToolsDisponible,
  listerTablesAccess,
  listerColonnesAccess,
  lireLignesAccess,
  type OptionsAccess,
  type OptionsLectureAccess,
} from './access/lecteur-access';
export {
  fabriqueProcessusReelle,
  type FabriqueProcessus,
  type ProcessusExecute,
} from './access/executeur-processus';

export * from './signaux-contenu';
export { evaluerRoleTable } from './detecteur-role';
export { detecterLiens, suggererPairesEnTeteLignes, type TableEchantillonnee } from './liens';
export { profilerColonnes, dateMaxPlausibleTable } from './profilage';
export {
  choisirCopieSourceDeVerite,
  regrouperCopiesRivales,
  estGabaritVide,
  detecterIncoherenceRoleVide,
  type CandidatCopie,
  type TableResumeCopie,
  type CopieEcartee,
  type GroupeCopiesRivales,
  type ResultatSelectionCopie,
} from './choix-copie-source';
