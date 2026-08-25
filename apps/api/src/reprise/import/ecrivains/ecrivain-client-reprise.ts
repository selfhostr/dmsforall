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
 * trouvé — DEFENSIBLE, PAS PROUVÉ sur une archive réelle : signalé au rapport de livraison comme
 * le point à affiner en premier une fois une vraie archive Auto-i/Stieger disponible.
 */

import { sql } from 'drizzle-orm';
import type { AnomalieImportReprise } from '@dfa/shared';

import type { TransactionDfa } from '../../../db';
import type { LigneTable, ValeurChamp } from '../../lecteurs/types';
import { CORRESPONDANCE_TYPE_CLIENT } from '../correspondance-enum-reprise';
import { convertirVersEnum } from '../correspondance-enum-reprise';
import { CandidatDedupLot, dedupliquerLot } from '../deduplication-lot-reprise';

export interface ResultatEcritureClients {
  readonly insere: number;
  readonly ecarte: number;
  readonly anomalies: readonly AnomalieImportReprise[];
  /** `numeroOrigine` -> `client.id` DFA — nécessaire aux domaines qui référencent un client
   *  (véhicules/détentions, documents de vente, paiements). */
  readonly idParNumeroOrigine: ReadonlyMap<string, string>;
}

function texte(valeurs: Record<string, ValeurChamp>, ...aliases: readonly string[]): string | null {
  for (const alias of aliases) {
    const valeur = valeurs[alias];
    if (typeof valeur === 'string' && valeur.trim() !== '') return valeur.trim();
  }
  return null;
}

export async function ecrireClientsReprise(
  tx: TransactionDfa,
  tenantId: string,
  lignes: readonly LigneTable[],
  langueTenantParDefaut: 'fr' | 'de' | 'it',
): Promise<ResultatEcritureClients> {
  const anomalies: AnomalieImportReprise[] = [];

  const candidats: CandidatDedupLot<{
    readonly numeroOrigine: string;
    readonly type: 'particulier' | 'entreprise';
    readonly nom: string | null;
    readonly raisonSociale: string | null;
    readonly langue: 'fr' | 'de' | 'it';
    readonly ligneSource: number;
  }>[] = [];

  for (const ligne of lignes) {
    const numeroOrigine = texte(
      ligne.valeurs,
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

    const typeSource = texte(ligne.valeurs, 'type', 'type_client', 'kundentyp');
    const nom = texte(ligne.valeurs, 'nom', 'name', 'nachname');
    const raisonSociale = texte(ligne.valeurs, 'raison_sociale', 'entreprise', 'firma', 'societe');
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

    const conversionLangue = convertirVersEnum(texte(ligne.valeurs, 'langue', 'sprache'), {
      correspondances: { fr: 'fr', de: 'de', it: 'it' },
    });
    const langue = conversionLangue.valeur ?? langueTenantParDefaut;

    candidats.push({
      cle: numeroOrigine,
      ligneSource: ligne.index,
      donnees: { numeroOrigine, type, nom, raisonSociale, langue, ligneSource: ligne.index },
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

  const idParNumeroOrigine = new Map<string, string>();
  let insere = 0;

  for (const candidat of retenus) {
    const { numeroOrigine, type, nom, raisonSociale, langue } = candidat.donnees;
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
  }

  return {
    insere,
    ecarte: candidats.length - retenus.length + (lignes.length - candidats.length),
    anomalies,
    idParNumeroOrigine,
  };
}
