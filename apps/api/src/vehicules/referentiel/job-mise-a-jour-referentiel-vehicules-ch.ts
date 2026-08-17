/**
 * Orchestration du passage quotidien : contrôler la source ASTRA, réimporter SEULEMENT si elle a
 * changé, toujours tracer le résultat (`referentiel_vehicules_ch_etat_import`, migration 0057).
 *
 * Fonction PURE d'orchestration (`executerVerificationReferentielVehiculesCh`) qui reçoit CHAQUE
 * collaborateur en paramètre — jamais un import direct de `fetch` global ni de
 * `importerReferentielVehiculesCh` à l'intérieur de la fonction : c'est ce qui la rend testable
 * sans réseau ni base (voir le fichier de test colocalisé), le service Nest ci-dessous
 * (`ServiceJobReferentielVehiculesCh`) ne fait que la brancher aux implémentations réelles.
 *
 * DÉCISION (voir migration 0057 pour le détail des trois informations qui ne se confondent
 * jamais) :
 *   1. contrôle la signature ACTUELLE des trois sources TAS — via `collaborateurs.
 *      detecterSignature`, câblé sur la VRAIE implémentation `detecterSignatureSourcesTas`
 *      (`detecter-changement-source-tas.ts`) UNIQUEMENT par `ServiceJobReferentielVehiculesCh`
 *      (`service-job-referentiel-vehicules-ch.ts`) — jamais importée directement ici, exprès
 *      (voir juste au-dessus) ;
 *   2. si elle échoue (source injoignable, HTTP en erreur) -> issue `echec`, RIEN d'autre ne
 *      bouge, jamais de réimport tenté sur une signature qu'on n'a pas pu établir ;
 *   3. si elle réussit et est IDENTIQUE à `signature_source` (état persisté) -> issue `inchange`,
 *      AUCUN appel à `importerReferentielVehiculesCh` (c'est tout le point de ce chantier : ne
 *      pas réimporter pour rien) ;
 *   4. si elle diffère (ou qu'aucun import n'a jamais réussi, `signature_source` NULL) -> import
 *      complet des trois sources. Succès -> issue `succes`, signature ET compteur de lignes
 *      avancés ENSEMBLE. Échec (réseau coupé en cours de route, CSV tronqué, contrainte violée)
 *      -> issue `echec`, la signature N'AVANCE PAS : la prochaine exécution retrouvera la même
 *      différence et retentera l'import complet, plutôt que de mémoriser une signature dont les
 *      données n'ont en réalité JAMAIS été appliquées (piège qu'on évite explicitement ici).
 *
 * ROBUSTESSE — cette fonction NE LÈVE JAMAIS pour une erreur venant des collaborateurs contrôle/
 * import (réseau, HTTP, CSV) : elle les capture, les traduit en issue `echec` + motif, et
 * persiste ce résultat avant de rendre la main. Elle peut en revanche laisser filer une erreur de
 * PERSISTANCE elle-même (`enregistrerEtat` qui échoue) — rien d'autre à faire dans ce cas, le
 * contrôleur BullMQ (voir `processeur-referentiel-vehicules-ch.ts`) la traite alors comme un
 * échec de job au sens BullMQ (retries standard), en plus du best-effort déjà tenté ici.
 */

import type { StatistiquesImportSource } from '../../db/seed/import-referentiel-vehicules-ch';
import { SOURCES_TAS, URL_BASE_TAS } from '../../db/seed/import-referentiel-vehicules-ch';
import type { FetchInjectable } from './detecter-changement-source-tas';
import type { ResultatVerificationReferentielVehiculesCh } from './etat-import-referentiel-vehicules-ch';

export interface ResultatJobReferentielVehiculesCh {
  readonly issue: 'succes' | 'inchange' | 'echec';
  readonly signatureSource?: string;
  readonly nombreLignes?: number;
  readonly motif?: string;
}

export interface CollaborateursJobReferentielVehiculesCh {
  readonly urlMigration: string;
  readonly fetchImpl: FetchInjectable;
  readonly detecterSignature: (
    sources: readonly { readonly fichier: string; readonly url: string }[],
    fetchImpl: FetchInjectable,
  ) => Promise<string>;
  readonly chargerEtat: (
    urlMigration: string,
  ) => Promise<{ readonly signatureSource: string | null }>;
  readonly importer: (options: {
    readonly urlMigration: string;
  }) => Promise<readonly StatistiquesImportSource[]>;
  readonly enregistrerEtat: (
    urlMigration: string,
    resultat: ResultatVerificationReferentielVehiculesCh,
    maintenant: Date,
  ) => Promise<void>;
  readonly maintenant: () => Date;
  readonly journaliser: (message: string) => void;
}

function motifErreur(erreur: unknown): string {
  const message = erreur instanceof Error ? erreur.message : String(erreur);
  return message.trim().length > 0 ? message : 'Erreur inconnue (aucun message).';
}

export async function executerVerificationReferentielVehiculesCh(
  collaborateurs: CollaborateursJobReferentielVehiculesCh,
): Promise<ResultatJobReferentielVehiculesCh> {
  const {
    urlMigration,
    fetchImpl,
    detecterSignature,
    chargerEtat,
    importer,
    enregistrerEtat,
    maintenant,
    journaliser,
  } = collaborateurs;

  const sources = SOURCES_TAS.map((source) => ({
    fichier: source.fichier,
    url: `${URL_BASE_TAS}${source.fichier}`,
  }));

  let signatureActuelle: string;
  try {
    signatureActuelle = await detecterSignature(sources, fetchImpl);
  } catch (erreur) {
    const motif = motifErreur(erreur);
    journaliser(`Contrôle de la source ASTRA en échec : ${motif}`);
    await enregistrerEtat(urlMigration, { issue: 'echec', motif }, maintenant());
    return { issue: 'echec', motif };
  }

  const etat = await chargerEtat(urlMigration);
  if (etat.signatureSource === signatureActuelle) {
    journaliser('Source ASTRA inchangée depuis le dernier contrôle — aucun réimport déclenché.');
    await enregistrerEtat(
      urlMigration,
      { issue: 'inchange', signatureSource: signatureActuelle },
      maintenant(),
    );
    return { issue: 'inchange', signatureSource: signatureActuelle };
  }

  journaliser(
    etat.signatureSource === null
      ? 'Aucun import réussi connu — import complet du référentiel véhicules ASTRA.'
      : 'Source ASTRA modifiée depuis le dernier import — réimport complet déclenché.',
  );

  let statistiques: readonly StatistiquesImportSource[];
  try {
    statistiques = await importer({ urlMigration });
  } catch (erreur) {
    const motif = motifErreur(erreur);
    journaliser(`Import du référentiel véhicules ASTRA en échec : ${motif}`);
    // La signature N'AVANCE PAS — voir l'en-tête de fichier, § point 4 : la prochaine exécution
    // doit retrouver la même différence et retenter l'import complet.
    await enregistrerEtat(urlMigration, { issue: 'echec', motif }, maintenant());
    return { issue: 'echec', motif };
  }

  const nombreLignes = statistiques.reduce((somme, s) => somme + s.upsertees, 0);
  await enregistrerEtat(
    urlMigration,
    { issue: 'succes', signatureSource: signatureActuelle, nombreLignes },
    maintenant(),
  );
  return { issue: 'succes', signatureSource: signatureActuelle, nombreLignes };
}
