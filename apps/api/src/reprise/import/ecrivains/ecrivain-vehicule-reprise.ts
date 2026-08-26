/**
 * Écrivain de domaine `vehicules` — deuxième maillon FK (client -> VÉHICULE -> plaques/
 * détentions). Démontre le troisième mécanisme générique du module : reconstruction d'intervalles
 * SANS CHEVAUCHEMENT (`reconstituerIntervallesSansChevauchement`) pour satisfaire les contraintes
 * `EXCLUDE USING GIST` de `vehicule_plaque`/`vehicule_detention` (migration 0007) — voir l'en-tête
 * de `import/reconstruction-intervalles.ts` pour la mécanique complète.
 *
 * Clé de rapprochement véhicule : `calculerCleVehicule` (VIN 17 caractères si fiable, sinon repli
 * sur `numeroOrigine` — voir `import/cle-vehicule-reprise.ts`, piège VIN documenté).
 *
 * TROIS PHASES SÉPARÉES, DÉLIBÉRÉMENT (même doctrine que `ecrivain-client-reprise.ts`, § tête de
 * `service-import-reprise.ts::executer`) :
 *   1. `preparerCandidatsVehiculesReprise` — CPU pur (construction des candidats + déduplication de
 *      lot), cessions comprises, HORS de toute transaction.
 *   2. `ecrireVehiculesBaseReprise` — écriture des lignes `vehicule` (I/O réelle), transaction
 *      COURTE ouverte par l'appelant pour CETTE seule écriture. Rend les ids DFA réellement
 *      attribués (INDISPENSABLES pour bâtir les intervalles plaque/détention : `vehicule.id` est
 *      un défaut base `gen_random_uuid()`, jamais connu avant l'INSERT) et les enregistrements
 *      candidats à reconstruire.
 *   3. `reconstruireIntervallesVehiculesReprise` — CPU pur (tri + fusion,
 *      `reconstituerIntervallesSansChevauchement` x2), HORS de toute transaction : entre la fin de
 *      la transaction #2 et l'ouverture de la transaction #3 ci-dessous.
 *   4. `ecrireVehiculesIntervallesReprise` — écriture des intervalles reconstruits (I/O réelle),
 *      une SECONDE transaction courte.
 * Jamais de cession d'event loop À L'INTÉRIEUR d'une transaction (phases 2 et 4) : c'est
 * exactement ce que ce découpage élimine. La reconstruction (phase 3) DOIT donc se produire entre
 * les deux transactions, pas dans l'une d'elles — d'où quatre fonctions plutôt que deux.
 *
 * `ecrireVehiculesReprise` reste exportée comme COMPOSITION des quatre (même séquence/cessions
 * qu'avant ce découpage, UNE seule transaction reçue en paramètre pour les deux écritures) — c'est
 * elle qu'exerce `ecrivain-vehicule-reprise.spec.ts`, volontairement inchangé : le comportement
 * observable de CETTE fonction ne change pas. Le VRAI appelant de production
 * (`service-import-reprise.ts`) n'utilise plus cette composition : il enchaîne les quatre étapes
 * avec deux transactions distinctes.
 *
 * IDEMPOTENCE `vehicule_plaque`/`vehicule_detention` (défaut trouvé en construisant ce découpage,
 * corrigé ici) : la ligne `vehicule` s'upsertait déjà par `(tenant_id, numero_origine)` (migration
 * 0066), mais les INSERT de plaque/détention n'avaient AUCUNE clause `on conflict` — un REJEU
 * complet (`POST .../import/rejouer`, qui relit et réécrit TOUT depuis la source, jamais une
 * reprise « à partir d'où on s'est arrêté ») retentait donc d'insérer EXACTEMENT le même intervalle
 * `[du, au)` pour un véhicule déjà repris, ce qu'`EXCLUDE USING GIST` refuse (un intervalle
 * identique se chevauche avec lui-même) — le rejeu échouait alors systématiquement, PIRE que le
 * défaut structurel que ce chantier corrige. `on conflict do nothing` SANS cible : Postgres accepte
 * cette forme précisément parce qu'une contrainte EXCLUDE ne peut pas être nommée comme cible
 * d'inférence ON CONFLICT — documenté dans la doc PostgreSQL sur INSERT (« DO NOTHING ... can also
 * be used to skip an exclusion violation »). Un rejeu redevient un no-op sur les intervalles déjà
 * écrits, exactement comme il l'était déjà pour `client`/`vehicule`.
 */

import { sql } from 'drizzle-orm';
import type { AnomalieImportReprise } from '@dfa/shared';

import type { TransactionDfa } from '../../../db';
import type { CedeurEventLoop } from '../../../common/concurrence';
import type { LigneTable, ValeurChamp } from '../../lecteurs/types';
import { calculerCleVehicule, normaliserVin } from '../cle-vehicule-reprise';
import { dedupliquerLot, type CandidatDedupLot } from '../deduplication-lot-reprise';
import {
  reconstituerIntervallesSansChevauchement,
  type EnregistrementIntervalle,
} from '../reconstruction-intervalles';

export interface ResultatEcritureVehicules {
  readonly insere: number;
  readonly ecarte: number;
  readonly anomalies: readonly AnomalieImportReprise[];
  readonly idParNumeroOrigine: ReadonlyMap<string, string>;
}

export interface CandidatVehiculeRepriseRetenu {
  readonly numeroOrigine: string;
  readonly vin: string | null;
  readonly marque: string;
  readonly modele: string;
  readonly clientNumeroOrigine: string | null;
  readonly plaqueValeur: string | null;
  readonly plaqueDu: string | null;
}

export interface ResultatPreparationVehiculesReprise {
  readonly candidatsRetenus: readonly CandidatVehiculeRepriseRetenu[];
  readonly ecarte: number;
  readonly anomalies: readonly AnomalieImportReprise[];
}

export interface ResultatEcritureVehiculesBaseReprise {
  readonly insere: number;
  readonly idParNumeroOrigine: ReadonlyMap<string, string>;
  readonly anomalies: readonly AnomalieImportReprise[];
  readonly plaquesAInserer: readonly EnregistrementIntervalle<{ vehiculeId: string }>[];
  readonly detentionsAInserer: readonly EnregistrementIntervalle<{
    vehiculeId: string;
    clientId: string;
  }>[];
}

export interface ResultatReconstructionIntervallesVehiculesReprise {
  readonly plaquesReconstituees: readonly EnregistrementReconstitueVehicule[];
  readonly detentionsReconstituees: readonly EnregistrementReconstitueDetention[];
}

interface EnregistrementReconstitueVehicule {
  readonly cle: string;
  readonly du: string;
  readonly au: string | null;
  readonly donnees: { readonly vehiculeId: string };
}

interface EnregistrementReconstitueDetention {
  readonly cle: string;
  readonly du: string;
  readonly au: string | null;
  readonly donnees: { readonly vehiculeId: string; readonly clientId: string };
}

function texte(valeurs: Record<string, ValeurChamp>, ...aliases: readonly string[]): string | null {
  for (const v of aliases.map((a) => valeurs[a])) {
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return null;
}

function dateIso(
  valeurs: Record<string, ValeurChamp>,
  ...aliases: readonly string[]
): string | null {
  for (const alias of aliases) {
    const v = valeurs[alias];
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return null;
}

/**
 * Phase 1 — CPU pur, AUCUN accès base. À appeler HORS de toute transaction — voir l'en-tête de
 * fichier.
 */
export async function preparerCandidatsVehiculesReprise(
  lignes: readonly LigneTable[],
  cedeurEventLoop: CedeurEventLoop,
): Promise<ResultatPreparationVehiculesReprise> {
  const anomalies: AnomalieImportReprise[] = [];
  const candidats: CandidatDedupLot<CandidatVehiculeRepriseRetenu>[] = [];

  // Boucle CPU pure (aucun accès base) — nombre d'itérations = volume de la table source, même
  // gabarit affamant que `ecrivain-client-reprise.ts`.
  for (const ligne of lignes) {
    await cedeurEventLoop.cederSiNecessaire();
    const numeroOrigine = texte(ligne.valeurs, 'id', 'numero', 'vehicule_id', 'fahrzeug_id');
    if (!numeroOrigine) {
      anomalies.push({
        type: 'reference_manquante',
        domaine: 'vehicules',
        ligneSource: ligne.index,
        donnees: { raison: 'identifiant source absent' },
      });
      continue;
    }
    const marque = texte(ligne.valeurs, 'marque', 'marke', 'make');
    const modele = texte(ligne.valeurs, 'modele', 'modell', 'model');
    if (!marque || !modele) {
      anomalies.push({
        type: 'ligne_invalide',
        domaine: 'vehicules',
        ligneSource: ligne.index,
        donnees: { raison: 'marque/modèle manquant' },
      });
      continue;
    }

    const vinBrut = texte(ligne.valeurs, 'vin', 'chassis', 'fahrgestellnummer');
    const { cle } = calculerCleVehicule(vinBrut, numeroOrigine);

    candidats.push({
      cle,
      ligneSource: ligne.index,
      donnees: {
        numeroOrigine,
        vin: normaliserVin(vinBrut),
        marque,
        modele,
        clientNumeroOrigine: texte(ligne.valeurs, 'client_id', 'proprietaire_id', 'halter_id'),
        plaqueValeur: texte(ligne.valeurs, 'plaque', 'immatriculation', 'kennzeichen'),
        plaqueDu: dateIso(
          ligne.valeurs,
          'plaque_du',
          'date_immatriculation',
          'date_1re_circulation',
        ),
      },
    });
  }

  const { retenus, ecartes } = dedupliquerLot(candidats);
  for (const doublon of ecartes) {
    anomalies.push({
      type: 'doublon_deja_importe',
      domaine: 'vehicules',
      ligneSource: doublon.ligneSource,
      donnees: {
        numeroOrigine: doublon.donnees.numeroOrigine,
        raison: 'doublon dans le lot source (clé véhicule)',
      },
    });
  }

  // Cession absorbant le CPU de `dedupliquerLot` ci-dessus (fonction pure, un seul passage
  // synchrone) — dernière cession de la phase de préparation, ENCORE hors de toute transaction.
  await cedeurEventLoop.cederSiNecessaire();

  return {
    candidatsRetenus: retenus.map((r) => r.donnees),
    ecarte: candidats.length - retenus.length + (lignes.length - candidats.length),
    anomalies,
  };
}

/**
 * Phase 2 — écriture des lignes `vehicule` (I/O réelle), transaction COURTE fournie par
 * l'appelant. AUCUNE cession d'event loop ici — voir l'en-tête de fichier. Rend, en plus du
 * résultat habituel, les enregistrements PRÊTS pour la reconstruction d'intervalles (phase 3, hors
 * transaction) : ils dépendent des ids réellement attribués par CETTE écriture.
 */
export async function ecrireVehiculesBaseReprise(
  tx: TransactionDfa,
  tenantId: string,
  candidatsRetenus: readonly CandidatVehiculeRepriseRetenu[],
  clientIdParNumeroOrigine: ReadonlyMap<string, string>,
): Promise<ResultatEcritureVehiculesBaseReprise> {
  const anomalies: AnomalieImportReprise[] = [];
  const idParNumeroOrigine = new Map<string, string>();
  let insere = 0;
  const plaquesAInserer: EnregistrementIntervalle<{ vehiculeId: string }>[] = [];
  const detentionsAInserer: EnregistrementIntervalle<{ vehiculeId: string; clientId: string }>[] =
    [];

  for (const d of candidatsRetenus) {
    const resultat = await tx.execute<{ readonly id: string }>(sql`
      insert into public.vehicule (tenant_id, marque, modele, vin, origine, numero_origine)
      values (${tenantId}, ${d.marque}, ${d.modele}, ${d.vin}, 'reprise', ${d.numeroOrigine})
      on conflict (tenant_id, numero_origine) where numero_origine is not null
      do update set numero_origine = excluded.numero_origine
      returning id
    `);
    const id = resultat.rows[0]?.id;
    if (!id) continue;
    idParNumeroOrigine.set(d.numeroOrigine, id);
    insere += 1;

    if (d.plaqueValeur && d.plaqueDu) {
      plaquesAInserer.push({
        cle: d.plaqueValeur.toUpperCase(),
        du: d.plaqueDu,
        donnees: { vehiculeId: id },
      });
    }
    const clientId = d.clientNumeroOrigine
      ? clientIdParNumeroOrigine.get(d.clientNumeroOrigine)
      : undefined;
    if (clientId && d.plaqueDu) {
      detentionsAInserer.push({ cle: id, du: d.plaqueDu, donnees: { vehiculeId: id, clientId } });
    } else if (d.clientNumeroOrigine && !clientId) {
      anomalies.push({
        type: 'reference_manquante',
        domaine: 'vehicules',
        ligneSource: null,
        donnees: {
          raison: 'client référencé introuvable',
          clientNumeroOrigine: d.clientNumeroOrigine,
        },
      });
    }
  }

  return { insere, idParNumeroOrigine, anomalies, plaquesAInserer, detentionsAInserer };
}

/**
 * Phase 3 — reconstruction des intervalles (CPU pur, `reconstituerIntervallesSansChevauchement`
 * x2), HORS de toute transaction — voir l'en-tête de fichier : referme chaque plaque/détention à
 * la date de début de la suivante PARTAGEANT LA MÊME CLÉ, condition nécessaire pour satisfaire les
 * EXCLUDE GiST de 0007. Deux cessions CONSTANTES (une par reconstruction) absorbent tout le CPU de
 * chaque appel, quel que soit le nombre d'intervalles produits — jamais de cession supplémentaire
 * par intervalle.
 */
export async function reconstruireIntervallesVehiculesReprise(
  plaquesAInserer: readonly EnregistrementIntervalle<{ vehiculeId: string }>[],
  detentionsAInserer: readonly EnregistrementIntervalle<{ vehiculeId: string; clientId: string }>[],
  cedeurEventLoop: CedeurEventLoop,
): Promise<ResultatReconstructionIntervallesVehiculesReprise> {
  const plaquesReconstituees = reconstituerIntervallesSansChevauchement(plaquesAInserer);
  await cedeurEventLoop.cederSiNecessaire();
  const detentionsReconstituees = reconstituerIntervallesSansChevauchement(detentionsAInserer);
  await cedeurEventLoop.cederSiNecessaire();
  return { plaquesReconstituees, detentionsReconstituees };
}

/**
 * Phase 4 — écriture des intervalles reconstruits (I/O réelle), SECONDE transaction courte fournie
 * par l'appelant. AUCUNE cession d'event loop ici. `on conflict do nothing` SANS cible sur les deux
 * INSERT — voir « IDEMPOTENCE » en tête de fichier : un rejeu qui retente d'écrire EXACTEMENT le
 * même intervalle devient un no-op, jamais une violation `EXCLUDE`.
 */
export async function ecrireVehiculesIntervallesReprise(
  tx: TransactionDfa,
  tenantId: string,
  plaquesReconstituees: readonly EnregistrementReconstitueVehicule[],
  detentionsReconstituees: readonly EnregistrementReconstitueDetention[],
): Promise<void> {
  for (const intervalle of plaquesReconstituees) {
    await tx.execute(sql`
      insert into public.vehicule_plaque (tenant_id, vehicule_id, valeur, du, au)
      values (${tenantId}, ${intervalle.donnees.vehiculeId}, ${intervalle.cle}, ${intervalle.du}, ${intervalle.au})
      on conflict do nothing
    `);
  }
  for (const intervalle of detentionsReconstituees) {
    await tx.execute(sql`
      insert into public.vehicule_detention (tenant_id, vehicule_id, client_id, du, au, motif_fin)
      values (
        ${tenantId}, ${intervalle.donnees.vehiculeId}, ${intervalle.donnees.clientId}, ${intervalle.du}, ${intervalle.au},
        ${intervalle.au ? 'vente' : null}
      )
      on conflict do nothing
    `);
  }
}

/**
 * Composition des quatre phases ci-dessus, MÊME séquence/cessions qu'avant le découpage, UNE
 * seule transaction reçue pour les deux écritures — réservée aux appelants qui n'ont pas besoin de
 * séparer préparation/écriture/reconstruction (tests, notamment). Le VRAI appelant de production
 * (`service-import-reprise.ts`) n'utilise plus cette composition — voir l'en-tête de fichier.
 */
export async function ecrireVehiculesReprise(
  tx: TransactionDfa,
  tenantId: string,
  lignes: readonly LigneTable[],
  clientIdParNumeroOrigine: ReadonlyMap<string, string>,
  cedeurEventLoop: CedeurEventLoop,
): Promise<ResultatEcritureVehicules> {
  const preparation = await preparerCandidatsVehiculesReprise(lignes, cedeurEventLoop);
  const base = await ecrireVehiculesBaseReprise(
    tx,
    tenantId,
    preparation.candidatsRetenus,
    clientIdParNumeroOrigine,
  );
  const { plaquesReconstituees, detentionsReconstituees } =
    await reconstruireIntervallesVehiculesReprise(
      base.plaquesAInserer,
      base.detentionsAInserer,
      cedeurEventLoop,
    );
  await ecrireVehiculesIntervallesReprise(
    tx,
    tenantId,
    plaquesReconstituees,
    detentionsReconstituees,
  );

  return {
    insere: base.insere,
    ecarte: preparation.ecarte,
    anomalies: [...preparation.anomalies, ...base.anomalies],
    idParNumeroOrigine: base.idParNumeroOrigine,
  };
}
