/**
 * Lecture/écriture de la ligne singleton `referentiel_vehicules_ch_etat_import` (migration 0057)
 * — traçabilité du job de contrôle/import quotidien ASTRA.
 *
 * MÊME PATRON DE CONNEXION que `db/seed/import-referentiel-vehicules-ch.ts` : un `pg.Client`
 * dédié sur `DATABASE_URL_MIGRATION` (rôle `dfa_migrator`), JAMAIS `AccesBase`/`JETON_DB`
 * (`dfa_app`) — `dfa_app` n'a que SELECT sur cette table (posture `[dfa:referentiel-partage]`,
 * voir l'en-tête de la migration 0057), exactement comme sur `type_approbation_ch` elle-même.
 * Le job de contrôle/import (`job-mise-a-jour-referentiel-vehicules-ch.ts`) ouvre une connexion
 * courte pour chaque opération plutôt que de partager celle de l'import — un job quotidien n'a
 * aucun besoin de réutilisation de connexion, et ça garde ce fichier indépendant de la forme
 * exacte de `importerReferentielVehiculesCh`.
 */

import { eq, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';

import {
  referentielVehiculesChEtatImport,
  type LigneEtatImportReferentielVehiculesCh,
} from '../../db/schema/referentiel/etat-import-referentiel-vehicules-ch';

async function avecClientMigration<T>(
  urlMigration: string,
  nomApplication: string,
  fonction: (base: NodePgDatabase) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: urlMigration, application_name: nomApplication });
  await client.connect();
  try {
    return await fonction(drizzle(client));
  } finally {
    await client.end();
  }
}

/**
 * Charge l'état courant. La ligne singleton existe TOUJOURS depuis la migration 0057 (`insert`
 * posé par la migration elle-même) — une absence de ligne est une anomalie de schéma, pas un cas
 * métier normal, d'où l'erreur plutôt qu'un `null` silencieux.
 */
export async function chargerEtatImportReferentielVehiculesCh(
  urlMigration: string,
): Promise<LigneEtatImportReferentielVehiculesCh> {
  return avecClientMigration(
    urlMigration,
    'dfa-referentiel-vehicules-ch-etat-lecture',
    async (base) => {
      const [ligne] = await base
        .select()
        .from(referentielVehiculesChEtatImport)
        .where(eq(referentielVehiculesChEtatImport.id, true))
        .limit(1);
      if (!ligne) {
        throw new Error(
          'referentiel_vehicules_ch_etat_import : ligne singleton introuvable — migration 0057 non appliquée ou corrompue.',
        );
      }
      return ligne;
    },
  );
}

/** Résultat d'un passage du job — discriminé par `issue`, voir
 *  `job-mise-a-jour-referentiel-vehicules-ch.ts` pour qui produit chaque variante. */
export type ResultatVerificationReferentielVehiculesCh =
  | { readonly issue: 'inchange'; readonly signatureSource: string }
  | { readonly issue: 'succes'; readonly signatureSource: string; readonly nombreLignes: number }
  | { readonly issue: 'echec'; readonly motif: string };

/** Colonnes à poser hors `echecs_consecutifs` (traité à part, voir
 *  `construireMiseAJourEtatImport` : c'est un INCRÉMENT SQL sur `echec`, pas une valeur statique
 *  calculable sans connaître le compteur EN BASE — la seule raison pour laquelle cette fonction
 *  ne rend pas un objet `set()` complet directement passable à Drizzle). */
export interface MiseAJourEtatImport {
  readonly derniereVerificationLe: Date;
  readonly derniereIssue: 'succes' | 'inchange' | 'echec';
  readonly dernierMotifEchec: string | null;
  readonly dernierImportReussiLe?: Date;
  readonly dernierNombreLignes?: number;
  readonly signatureSource?: string;
}

/**
 * Fonction PURE : quelles colonnes poser pour QUEL résultat — testable sans base (voir le fichier
 * de test colocalisé). Voir les RÈGLES ci-dessous, qui reflètent exactement les trois
 * informations qui ne doivent jamais se confondre (migration 0057, en-tête) et la contrainte
 * `referentiel_vehicules_ch_etat_import_motif_coherent_chk` (un motif d'échec seulement sur
 * `echec`, jamais à côté).
 *
 * RÈGLES :
 *   - `derniere_verification_le` avance à CHAQUE passage, quelle que soit l'issue ;
 *   - `dernier_import_reussi_le`/`dernier_nombre_lignes`/`signature_source` n'avancent QUE sur
 *     `succes` — un `inchange` reconduit la signature déjà connue (elle vient de la CONFIRMER,
 *     pas de la changer : `signatureSource` n'est PAS reposée, la colonne garde sa valeur), un
 *     `echec` ne touche à AUCUN des trois (la prochaine tentative doit repartir de la dernière
 *     signature CONNUE COMME IMPORTÉE, pas d'une signature intermédiaire jamais réellement
 *     appliquée — voir le job pour le raisonnement complet).
 */
export function construireMiseAJourEtatImport(
  resultat: ResultatVerificationReferentielVehiculesCh,
  maintenant: Date,
): MiseAJourEtatImport {
  if (resultat.issue === 'echec') {
    return {
      derniereVerificationLe: maintenant,
      derniereIssue: 'echec',
      dernierMotifEchec: resultat.motif,
    };
  }
  if (resultat.issue === 'inchange') {
    return {
      derniereVerificationLe: maintenant,
      derniereIssue: 'inchange',
      dernierMotifEchec: null,
    };
  }
  return {
    derniereVerificationLe: maintenant,
    derniereIssue: 'succes',
    dernierMotifEchec: null,
    dernierImportReussiLe: maintenant,
    dernierNombreLignes: resultat.nombreLignes,
    signatureSource: resultat.signatureSource,
  };
}

/**
 * Persiste le résultat d'UN passage du job. `maintenant` explicite (jamais `new Date()` ici) :
 * ce fichier n'est pas un service Nest injectable (fonctions pures/IO simples, même style que
 * `import-referentiel-vehicules-ch.ts`), l'horloge testable est donc un paramètre plutôt qu'une
 * dépendance `Horloge` injectée.
 *
 * `echecs_consecutifs` — remis à 0 sur `succes`/`inchange`, incrémenté sur `echec` (`sql\`... +
 * 1\``, calculé côté base : c'est ce qui rend un échec RÉPÉTÉ visible, et la seule colonne que
 * `construireMiseAJourEtatImport` ne calcule pas elle-même, voir sa documentation).
 */
export async function enregistrerResultatVerificationReferentielVehiculesCh(
  urlMigration: string,
  resultat: ResultatVerificationReferentielVehiculesCh,
  maintenant: Date,
): Promise<void> {
  const colonnes = construireMiseAJourEtatImport(resultat, maintenant);
  await avecClientMigration(
    urlMigration,
    'dfa-referentiel-vehicules-ch-etat-ecriture',
    async (base) => {
      await base
        .update(referentielVehiculesChEtatImport)
        .set({
          ...colonnes,
          echecsConsecutifs:
            resultat.issue === 'echec'
              ? sql`${referentielVehiculesChEtatImport.echecsConsecutifs} + 1`
              : 0,
        })
        .where(eq(referentielVehiculesChEtatImport.id, true));
    },
  );
}
