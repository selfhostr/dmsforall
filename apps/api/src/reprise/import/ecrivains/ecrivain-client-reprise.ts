/**
 * Écrivain de domaine `clients` — premier maillon de l'ordre d'insertion imposé par les FK
 * (socle -> CLIENT -> ...). Démontre les trois mécanismes génériques du module sur le domaine le
 * plus simple : déduplication DE LOT (`dedupliquerLot`), conversion d'enum SANS exception
 * (`convertirVersEnum`), idempotence par `(tenant_id, numero_origine)` via `on conflict do nothing`
 * (migration 0066).
 *
 * MAPPING DE COLONNES SOURCE : HEURISTIQUE PAR ALIAS, PAS UNE SPÉCIFICATION FIGÉE — aucun contrat
 * ne décrit le nom des colonnes d'un DMS tiers (Auto-i, Stieger, tableur…), et `lecteurs/` ne
 * fournit qu'un RÔLE déduit par table, jamais un mapping champ-à-champ. `alias(...)` essaie une
 * liste de noms plausibles (français/allemand, la Suisse romande et alémanique) et rend le premier
 * trouvé — DEFENSIBLE, PAS PROUVÉ sur toutes les variantes d'archive : à affiner en premier dès qu'une nouvelle
 * variante Auto-i/Stieger est disponible en test.
 *
 * DEUX PHASES SÉPARÉES, DÉLIBÉRÉMENT (défaut structurel réel du 26.08.2026, § tête de
 * `service-import-reprise.ts::executer`) : `preparerCandidatsClientsReprise` (CPU pur — construction
 * des candidats + déduplication de lot, cessions d'event loop comprises) doit tourner HORS de toute
 * transaction Postgres ; `ecrireClientsPreparesReprise` (I/O socket réelle, `tx.execute` par
 * candidat) tourne DANS une transaction COURTE ouverte par l'appelant (`service-import-reprise.ts`)
 * juste pour cette écriture — jamais une cession d'event loop À L'INTÉRIEUR de cette transaction,
 * voir la doctrine complète côté orchestrateur. `ecrireClientsReprise` reste exportée comme
 * COMPOSITION des deux (mêmes cessions, même séquence qu'avant ce découpage) — c'est elle
 * qu'exerce `ecrivain-client-reprise.spec.ts`, volontairement inchangé : le comportement observable
 * de CETTE fonction ne change pas, seul l'appelant réel (`service-import-reprise.ts`) a changé de
 * façon de l'invoquer (phases séparées, transaction propre à l'écriture).
 */

import { sql } from 'drizzle-orm';
import type { AnomalieImportReprise } from '@dfa/shared';

import type { TransactionDfa } from '../../../db';
import type { CedeurEventLoop } from '../../../common/concurrence';
import type { LigneTable } from '../../lecteurs/types';
import { CORRESPONDANCE_TYPE_CLIENT } from '../correspondance-enum-reprise';
import { convertirVersEnum } from '../correspondance-enum-reprise';
import { CandidatDedupLot, dedupliquerLot } from '../deduplication-lot-reprise';
import { indexerColonnesLigne, texteParAlias } from '../resolution-alias-colonne-reprise';
import {
  creerCompteurProgresEcriture,
  type CallbackProgresEcritureReprise,
} from '../progression-ecriture-reprise';

export interface ResultatEcritureClients {
  readonly insere: number;
  readonly ecarte: number;
  readonly anomalies: readonly AnomalieImportReprise[];
  /** `numeroOrigine` -> `client.id` DFA — nécessaire aux domaines qui référencent un client
   *  (véhicules/détentions, documents de vente, paiements). */
  readonly idParNumeroOrigine: ReadonlyMap<string, string>;
}

/** Un candidat client RETENU après déduplication de lot — plus de `ligneSource` (n'a plus
 *  d'utilité une fois la préparation terminée, seules les anomalies en gardent trace). */
export interface CandidatClientRepriseRetenu {
  readonly numeroOrigine: string;
  readonly type: 'particulier' | 'entreprise';
  readonly nom: string | null;
  readonly raisonSociale: string | null;
  readonly langue: 'fr' | 'de' | 'it';
}

export interface ResultatPreparationClientsReprise {
  readonly candidatsRetenus: readonly CandidatClientRepriseRetenu[];
  readonly ecarte: number;
  readonly anomalies: readonly AnomalieImportReprise[];
}

export interface ResultatEcritureClientsPreparesReprise {
  readonly insere: number;
  readonly idParNumeroOrigine: ReadonlyMap<string, string>;
}

/**
 * Phase 1 — CPU pur, AUCUN accès base : construit les candidats (mapping par alias, conversion
 * d'enum, validation) puis déduplique le lot. À appeler HORS de toute transaction — voir l'en-tête
 * de fichier.
 */
export async function preparerCandidatsClientsReprise(
  lignes: readonly LigneTable[],
  langueTenantParDefaut: 'fr' | 'de' | 'it',
  cedeurEventLoop: CedeurEventLoop,
): Promise<ResultatPreparationClientsReprise> {
  const anomalies: AnomalieImportReprise[] = [];

  const candidats: CandidatDedupLot<CandidatClientRepriseRetenu>[] = [];

  // Boucle CPU pure (aucun accès base) — nombre d'itérations = volume de la table source. Voir
  // `common/concurrence/ceder-controle-event-loop.ts` : c'est exactement le gabarit mesuré comme
  // affamant la boucle d'événements sans cession explicite.
  for (const ligne of lignes) {
    await cedeurEventLoop.cederSiNecessaire();
    // Index insensible à la casse — voir `resolution-alias-colonne-reprise.ts` (défaut réel du
    // 26.08.2026 : la casse d'origine des colonnes Access, ex. `KundenNr`, faisait échouer 100%
    // des lignes ici, jamais résolues contre les alias en minuscules ci-dessous).
    const index = indexerColonnesLigne(ligne);
    const numeroOrigine = texteParAlias(
      index,
      'id',
      'numero',
      'client_id',
      'kundennr',
      'no_client',
    );
    if (!numeroOrigine) {
      anomalies.push({
        type: 'reference_manquante',
        domaine: 'clients',
        ligneSource: ligne.index,
        donnees: { raison: 'identifiant source absent' },
      });
      continue;
    }

    const typeSource = texteParAlias(index, 'type', 'type_client', 'kundentyp');
    const nom = texteParAlias(index, 'nom', 'name', 'nachname');
    const raisonSociale = texteParAlias(index, 'raison_sociale', 'entreprise', 'firma', 'societe');
    const conversionType = convertirVersEnum(typeSource, CORRESPONDANCE_TYPE_CLIENT);
    if (conversionType.inconnue) {
      anomalies.push({
        type: 'ligne_invalide',
        domaine: 'clients',
        ligneSource: ligne.index,
        donnees: { champ: 'type', valeur: conversionType.valeurSourceBrute },
      });
      continue;
    }
    const type = conversionType.valeur ?? (raisonSociale ? 'entreprise' : 'particulier');
    if (type === 'particulier' && !nom) {
      anomalies.push({
        type: 'ligne_invalide',
        domaine: 'clients',
        ligneSource: ligne.index,
        donnees: { raison: 'client particulier sans nom' },
      });
      continue;
    }
    if (type === 'entreprise' && !raisonSociale) {
      anomalies.push({
        type: 'ligne_invalide',
        domaine: 'clients',
        ligneSource: ligne.index,
        donnees: { raison: 'client entreprise sans raison sociale' },
      });
      continue;
    }

    const conversionLangue = convertirVersEnum(texteParAlias(index, 'langue', 'sprache'), {
      correspondances: { fr: 'fr', de: 'de', it: 'it' },
    });
    const langue = conversionLangue.valeur ?? langueTenantParDefaut;

    candidats.push({
      cle: numeroOrigine,
      ligneSource: ligne.index,
      donnees: { numeroOrigine, type, nom, raisonSociale, langue },
    });
  }

  const { retenus, ecartes } = dedupliquerLot(candidats);
  for (const doublon of ecartes) {
    anomalies.push({
      type: 'doublon_deja_importe',
      domaine: 'clients',
      ligneSource: doublon.ligneSource,
      donnees: {
        numeroOrigine: doublon.donnees.numeroOrigine,
        raison: 'doublon dans le lot source',
      },
    });
  }

  // Cession absorbant le CPU de `dedupliquerLot` ci-dessus (fonction pure, un seul passage
  // synchrone, aucun point de cession interne possible) — dernière cession de la phase de
  // préparation, ENCORE hors de toute transaction.
  await cedeurEventLoop.cederSiNecessaire();

  return {
    candidatsRetenus: retenus.map((r) => r.donnees),
    ecarte: candidats.length - retenus.length + (lignes.length - candidats.length),
    anomalies,
  };
}

/**
 * Phase 2 — écriture réelle (`tx.execute` par candidat retenu), dans la transaction COURTE fournie
 * par l'appelant. AUCUNE cession d'event loop ici : chaque itération fait déjà un aller-retour
 * socket réel, qui cède naturellement la boucle d'événements — une cession `setImmediate`
 * supplémentaire n'apporterait rien, seulement une transaction inutilement plus longue.
 */
export async function ecrireClientsPreparesReprise(
  tx: TransactionDfa,
  tenantId: string,
  candidatsRetenus: readonly CandidatClientRepriseRetenu[],
  onProgres?: CallbackProgresEcritureReprise,
): Promise<ResultatEcritureClientsPreparesReprise> {
  const idParNumeroOrigine = new Map<string, string>();
  let insere = 0;
  // Progression VISIBLE en cours d'écriture, jamais seulement en fin de domaine — voir l'en-tête
  // de `progression-ecriture-reprise.ts` (défaut réel du 26.08.2026). Même transaction déjà
  // ouverte pour cette écriture, aucun allongement mesurable.
  const compteurProgres = creerCompteurProgresEcriture(onProgres);

  for (const candidat of candidatsRetenus) {
    const { numeroOrigine, type, nom, raisonSociale, langue } = candidat;
    const resultat = await tx.execute<{ readonly id: string }>(sql`
      insert into public.client (tenant_id, numero, type, nom, raison_sociale, langue, origine, numero_origine)
      values (
        ${tenantId}, ${`REPR-${numeroOrigine}`}, ${type}, ${nom}, ${raisonSociale}, ${langue},
        'reprise', ${numeroOrigine}
      )
      on conflict (tenant_id, numero_origine) where numero_origine is not null
      do update set numero_origine = excluded.numero_origine
      returning id
    `);
    const id = resultat.rows[0]?.id;
    if (id) {
      idParNumeroOrigine.set(numeroOrigine, id);
      insere += 1;
    }
    await compteurProgres.incrementer();
  }

  return { insere, idParNumeroOrigine };
}

/**
 * Composition des deux phases ci-dessus, MÊME séquence/cessions qu'avant le découpage — réservée
 * aux appelants qui n'ont pas besoin de séparer préparation et écriture (tests, notamment). Le
 * VRAI appelant de production (`service-import-reprise.ts`) n'utilise plus cette fonction : il
 * appelle `preparerCandidatsClientsReprise` hors transaction puis `ecrireClientsPreparesReprise`
 * dans une transaction courte ouverte pour l'occasion — voir l'en-tête de fichier.
 */
export async function ecrireClientsReprise(
  tx: TransactionDfa,
  tenantId: string,
  lignes: readonly LigneTable[],
  langueTenantParDefaut: 'fr' | 'de' | 'it',
  cedeurEventLoop: CedeurEventLoop,
): Promise<ResultatEcritureClients> {
  const preparation = await preparerCandidatsClientsReprise(
    lignes,
    langueTenantParDefaut,
    cedeurEventLoop,
  );
  const ecriture = await ecrireClientsPreparesReprise(tx, tenantId, preparation.candidatsRetenus);
  return {
    insere: ecriture.insere,
    ecarte: preparation.ecarte,
    anomalies: preparation.anomalies,
    idParNumeroOrigine: ecriture.idParNumeroOrigine,
  };
}
