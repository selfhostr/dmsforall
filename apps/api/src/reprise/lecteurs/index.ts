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
// `choix-copie-source.ts` (choisirCopieSourceDeVerite/regrouperCopiesRivales/estGabaritVide/
// detecterIncoherenceRoleVide) SUPPRIMÉ le 26.08.2026 : code mort, aucun appelant réel dans tout
// le dépôt (confirmé par recherche exhaustive, revalidé par le coordinateur) — le VRAI départage
// entre copies rivales d'une même table vit dans `plan/generation-plan-reprise.ts::
// genererPlanDepuisTables`, à une granularité différente (par TABLE détectée, pas par RÉPERTOIRE
// candidat). Les heuristiques documentées là-bas (gabarit vierge, incohérence rôle vide, ne
// JAMAIS décider sur le nom/chemin) restent valables et réutilisables si un futur chantier
// `analyse/` construit un jour de vrais `CandidatCopie` groupés par répertoire (utile pour
// FoxPro/DBF, où une "copie" est un répertoire entier de .dbf, pas un fichier unique comme
// Access) — récupérer l'historique git plutôt que de laisser une implémentation non branchée se
// périmer en silence.
//
// `choisirCopieFaisantFoi` (port `PortLecteurArchiveReprise`, `lecture/adaptateur-lecteur-
// archive-reprise.ts`) est ÉGALEMENT du code mort (même vérification), mais NON supprimé : il
// fait partie d'un CONTRAT DE PORT hors du périmètre de ce chantier (`lecteurs/`/`import/`
// seulement) — le retirer toucherait l'interface et ses deux implémentations
// (`lecture/port-lecteur-archive-reprise.ts`, `adaptateur-lecteur-archive-reprise.ts`,
// `adaptateur-lecteur-archive-reprise-factice.ts`). Laissé en place, documenté comme non appelé
// à sa propre définition — signalé, pas retiré à l'aveugle.
