/**
 * Dépôt par tranches : upsert idempotent par numéro, reprise après interruption (dernier numéro
 * contigu), finalisation avec contrôle d'intégrité SHA-256 CÔTÉ SERVEUR (le calcul du client n'est
 * qu'un signal de défense en profondeur — voir `contrats/reprise.ts`, doc de
 * `schemaFinalisationDepotReprise`).
 */

import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  ArchiveDeposeeReprise,
  ReponseDossierReprise,
  ReponseTrancheDeposee,
} from '@dfa/shared';

import { JETON_DB, type AccesBase, type ContexteTenant, type TransactionDfa } from '../../db';
import { ErreurMetier } from '../../common/erreurs';
import { projeterDossierReprise } from '../db-reprise.types';
import { JETON_STOCKAGE_ARCHIVE_REPRISE } from '../reprise.jetons';
import type { PortStockageArchiveReprise } from './stockage-archive-reprise';
import { ServiceCycleVieDossierReprise } from '../service-cycle-vie-dossier-reprise';

@Injectable()
export class ServiceDepotReprise {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_STOCKAGE_ARCHIVE_REPRISE) private readonly stockage: PortStockageArchiveReprise,
    private readonly cycleVie: ServiceCycleVieDossierReprise,
  ) {}

  async deposerTranche(
    ctx: ContexteTenant,
    dossierId: string,
    numero: number,
    contenu: Buffer,
  ): Promise<ReponseTrancheDeposee> {
    if (contenu.length === 0) {
      throw new ErreurMetier('VALIDATION_ECHOUEE', 'Tranche vide refusée.');
    }

    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await this.cycleVie.ligneBrute(tx, ctx.tenantId, dossierId);
      if (ligne.statut !== 'depot_en_cours') {
        throw new ErreurMetier(
          'REPRISE_DOSSIER_TRANSITION_INTERDITE',
          `Dépôt de tranche refusé : dossier ${dossierId} au statut « ${ligne.statut} » (attendu depot_en_cours).`,
        );
      }

      const tailleAnnoncee = Number(ligne.taille_octets_annoncee);
      const octetsRecusAvant = Number(ligne.octets_recus ?? '0');
      const octetsAutresTranches = await this.octetsAutresTranches(
        tx,
        ctx.tenantId,
        dossierId,
        numero,
        octetsRecusAvant,
      );
      if (octetsAutresTranches + contenu.length > tailleAnnoncee) {
        throw new ErreurMetier(
          'REPRISE_TRANCHE_HORS_SEQUENCE',
          `La tranche ${numero} porterait le total reçu au-delà de la taille annoncée (${tailleAnnoncee} octets) pour le dossier ${dossierId}.`,
        );
      }

      await this.stockage.ecrireTranche(ligne.stockage_chemin, numero, contenu);

      await tx.execute(sql`
        insert into public.reprise_tranche (tenant_id, dossier_reprise_id, numero, taille_octets, chemin_stockage)
        values (${ctx.tenantId}, ${dossierId}, ${numero}, ${contenu.length}, ${`tranches/${numero}.bin`})
        on conflict (tenant_id, dossier_reprise_id, numero)
        do update set taille_octets = excluded.taille_octets, chemin_stockage = excluded.chemin_stockage, recue_le = now()
      `);

      const dernierContigu = await this.etendreFrontiereContigue(
        tx,
        ctx.tenantId,
        dossierId,
        ligne.dernier_numero_tranche_recu_contigu,
      );
      await tx.execute(sql`
        update public.dossier_reprise set dernier_numero_tranche_recu_contigu = ${dernierContigu}
         where tenant_id = ${ctx.tenantId} and id = ${dossierId}
      `);

      const octetsRecus = await this.sommeOctets(tx, ctx.tenantId, dossierId);
      return {
        numero,
        octetsRecus,
        toutesTranchesRecues: octetsRecus === tailleAnnoncee,
      };
    });
  }

  async etatArchive(ctx: ContexteTenant, dossierId: string): Promise<ArchiveDeposeeReprise> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await this.cycleVie.ligneBrute(tx, ctx.tenantId, dossierId);
      const octetsRecus = await this.sommeOctets(tx, ctx.tenantId, dossierId);
      return projeterDossierReprise(ligne, octetsRecus).archive;
    });
  }

  async finaliser(
    ctx: ContexteTenant,
    dossierId: string,
    empreinteCalculeeClient: string,
  ): Promise<ReponseDossierReprise> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await this.cycleVie.ligneBrute(tx, ctx.tenantId, dossierId);
      if (ligne.statut !== 'depot_en_cours') {
        throw new ErreurMetier(
          'REPRISE_DOSSIER_TRANSITION_INTERDITE',
          `Finalisation refusée : dossier ${dossierId} au statut « ${ligne.statut} » (attendu depot_en_cours).`,
        );
      }

      const tailleAnnoncee = Number(ligne.taille_octets_annoncee);
      const dernierContigu = ligne.dernier_numero_tranche_recu_contigu;
      const maxNumero = await this.maxNumeroTranche(tx, ctx.tenantId, dossierId);

      if (dernierContigu === null || maxNumero === null || dernierContigu !== maxNumero) {
        throw new ErreurMetier(
          'REPRISE_ARCHIVE_INCOMPLETE',
          `Finalisation refusée : trou dans la séquence de tranches du dossier ${dossierId} (contigu=${dernierContigu}, max=${maxNumero}).`,
        );
      }
      const octetsRecus = await this.sommeOctets(tx, ctx.tenantId, dossierId);
      if (octetsRecus !== tailleAnnoncee) {
        throw new ErreurMetier(
          'REPRISE_ARCHIVE_INCOMPLETE',
          `Finalisation refusée : ${octetsRecus}/${tailleAnnoncee} octets reçus pour le dossier ${dossierId}.`,
        );
      }

      const { empreinteSha256Hex } = await this.stockage.assemblerEtCalculerEmpreinte(
        ligne.stockage_chemin,
        dernierContigu,
      );

      const empreinteAnnonceeHex = ligne.empreinte_sha256_annoncee.toString('hex');
      const integriteValidee = empreinteSha256Hex === empreinteAnnonceeHex;
      // `empreinteCalculeeClient` : signal de défense en profondeur uniquement, jamais l'arbitre —
      // voir la doc du contrat. Non comparé ici, sciemment : seule l'empreinte SERVEUR fait foi.
      void empreinteCalculeeClient;

      await tx.execute(sql`
        update public.dossier_reprise
           set empreinte_sha256_verifiee = ${Buffer.from(empreinteSha256Hex, 'hex')},
               integrite_validee = ${integriteValidee}
         where tenant_id = ${ctx.tenantId} and id = ${dossierId}
      `);

      if (!integriteValidee) {
        throw new ErreurMetier(
          'REPRISE_EMPREINTE_INVALIDE',
          `Empreinte assemblée ${empreinteSha256Hex} différente de l'empreinte annoncée pour le dossier ${dossierId}.`,
        );
      }

      const apres = await this.cycleVie.transiter(tx, ctx.tenantId, dossierId, 'depot_receptionne');
      return projeterDossierReprise(apres, octetsRecus);
    });
  }

  // -----------------------------------------------------------------------------------------
  // Interne
  // -----------------------------------------------------------------------------------------

  private async sommeOctets(
    tx: TransactionDfa,
    tenantId: string,
    dossierId: string,
  ): Promise<number> {
    const resultat = await tx.execute<{ readonly total: string }>(sql`
      select coalesce(sum(taille_octets), 0)::text as total
        from public.reprise_tranche
       where tenant_id = ${tenantId} and dossier_reprise_id = ${dossierId}
    `);
    return Number(resultat.rows[0]?.total ?? '0');
  }

  private async octetsAutresTranches(
    tx: TransactionDfa,
    tenantId: string,
    dossierId: string,
    numeroExclu: number,
    octetsRecusAvant: number,
  ): Promise<number> {
    // Si `numeroExclu` a déjà été reçue (réécriture idempotente), soustraire sa taille actuelle du
    // total avant comparaison — un rejeu de la MÊME tranche ne doit jamais être compté deux fois.
    const resultat = await tx.execute<{ readonly taille: string | null }>(sql`
      select taille_octets::text as taille from public.reprise_tranche
       where tenant_id = ${tenantId} and dossier_reprise_id = ${dossierId} and numero = ${numeroExclu}
    `);
    const tailleExistante = resultat.rows[0]?.taille ? Number(resultat.rows[0].taille) : 0;
    return octetsRecusAvant - tailleExistante;
  }

  private async maxNumeroTranche(
    tx: TransactionDfa,
    tenantId: string,
    dossierId: string,
  ): Promise<number | null> {
    const resultat = await tx.execute<{ readonly max: number | null }>(sql`
      select max(numero) as max from public.reprise_tranche
       where tenant_id = ${tenantId} and dossier_reprise_id = ${dossierId}
    `);
    return resultat.rows[0]?.max ?? null;
  }

  private async etendreFrontiereContigue(
    tx: TransactionDfa,
    tenantId: string,
    dossierId: string,
    contiguActuel: number | null,
  ): Promise<number | null> {
    const depart = contiguActuel === null ? 0 : contiguActuel + 1;
    const resultat = await tx.execute<{ readonly numero: number }>(sql`
      select numero from public.reprise_tranche
       where tenant_id = ${tenantId} and dossier_reprise_id = ${dossierId} and numero >= ${depart}
       order by numero
    `);
    let frontiere = contiguActuel;
    let attendu = depart;
    for (const { numero } of resultat.rows) {
      if (numero !== attendu) break;
      frontiere = numero;
      attendu += 1;
    }
    return frontiere;
  }
}
