/**
 * Écrivain de domaine `vehicules` — deuxième maillon FK (client -> VÉHICULE -> plaques/
 * détentions). Démontre le troisième mécanisme générique du module : reconstruction d'intervalles
 * SANS CHEVAUCHEMENT (`reconstituerIntervallesSansChevauchement`) pour satisfaire les contraintes
 * `EXCLUDE USING GIST` de `vehicule_plaque`/`vehicule_detention` (migration 0007) — voir l'en-tête
 * de `import/reconstruction-intervalles.ts` pour la mécanique complète.
 *
 * Clé de rapprochement véhicule : `calculerCleVehicule` (VIN 17 caractères si fiable, sinon repli
 * sur `numeroOrigine` — voir `import/cle-vehicule-reprise.ts`, piège VIN documenté).
 */

import { sql } from 'drizzle-orm';
import type { AnomalieImportReprise } from '@dfa/shared';

import type { TransactionDfa } from '../../../db';
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

function texte(valeurs: Record<string, ValeurChamp>, ...aliases: readonly string[]): string | null {
  for (const alias of aliases) {
    const v = valeurs[alias];
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

export async function ecrireVehiculesReprise(
  tx: TransactionDfa,
  tenantId: string,
  lignes: readonly LigneTable[],
  clientIdParNumeroOrigine: ReadonlyMap<string, string>,
): Promise<ResultatEcritureVehicules> {
  const anomalies: AnomalieImportReprise[] = [];

  interface DonneesVehicule {
    readonly numeroOrigine: string;
    readonly vin: string | null;
    readonly marque: string;
    readonly modele: string;
    readonly clientNumeroOrigine: string | null;
    readonly plaqueValeur: string | null;
    readonly plaqueDu: string | null;
    readonly ligneSource: number;
  }

  const candidats: CandidatDedupLot<DonneesVehicule>[] = [];

  for (const ligne of lignes) {
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
        ligneSource: ligne.index,
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

  const idParNumeroOrigine = new Map<string, string>();
  let insere = 0;
  const plaquesAInserer: EnregistrementIntervalle<{ vehiculeId: string }>[] = [];
  const detentionsAInserer: EnregistrementIntervalle<{ vehiculeId: string; clientId: string }>[] =
    [];

  for (const candidat of retenus) {
    const d = candidat.donnees;
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
        ligneSource: d.ligneSource,
        donnees: {
          raison: 'client référencé introuvable',
          clientNumeroOrigine: d.clientNumeroOrigine,
        },
      });
    }
  }

  // Reconstruction des intervalles — voir l'en-tête de fichier : referme chaque plaque/détention à
  // la date de début de la suivante PARTAGEANT LA MÊME CLÉ (valeur de plaque / véhicule), condition
  // nécessaire pour satisfaire les EXCLUDE GiST de 0007.
  for (const intervalle of reconstituerIntervallesSansChevauchement(plaquesAInserer)) {
    await tx.execute(sql`
      insert into public.vehicule_plaque (tenant_id, vehicule_id, valeur, du, au)
      values (${tenantId}, ${intervalle.donnees.vehiculeId}, ${intervalle.cle}, ${intervalle.du}, ${intervalle.au})
    `);
  }
  for (const intervalle of reconstituerIntervallesSansChevauchement(detentionsAInserer)) {
    await tx.execute(sql`
      insert into public.vehicule_detention (tenant_id, vehicule_id, client_id, du, au, motif_fin)
      values (
        ${tenantId}, ${intervalle.donnees.vehiculeId}, ${intervalle.donnees.clientId}, ${intervalle.du}, ${intervalle.au},
        ${intervalle.au ? 'vente' : null}
      )
    `);
  }

  return {
    insere,
    ecarte: candidats.length - retenus.length + (lignes.length - candidats.length),
    anomalies,
    idParNumeroOrigine,
  };
}
