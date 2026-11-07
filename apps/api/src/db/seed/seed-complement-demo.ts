/**
 * Jeu de démonstration « complet » : orchestre les sections `seed-complement-*.ts`, APRÈS les
 * seeds historiques (`seed-dev.ts` et ses satellites). Objectif : qu'aucun écran ne soit vide
 * quand on se connecte au garage de démo.
 *
 * Écrit en SQL direct (rôle `dfa_migrator`) dans UNE transaction : tout ou rien. Les triggers de
 * la base (machines à états, verrouillage des documents émis, audit) restent actifs.
 */
import { Client } from 'pg';
import { creerRnd, ecrireCompteurs, type Ctx } from './seed-complement-outils';
import {
  semerClients,
  semerCollaborateurs,
  semerPostesEtActivites,
  semerVehicules,
} from './seed-complement-personnes';
import {
  appliquerStockOr,
  semerCataloguePieces,
  semerCommandesEtStockBas,
  semerConsignes,
} from './seed-complement-pieces';
import { semerAtelierEtFacturation } from './seed-complement-atelier';
import {
  semerControlesEtDevisComplementaires,
  semerCourtoisie,
  semerExportEtPeriodes,
  semerPneus,
  semerPointages,
  semerRelances,
  semerRendezVous,
  semerVentes,
} from './seed-complement-divers';

export async function semerComplementDemo(options: {
  readonly urlMigration: string;
  readonly nodeEnv: string;
  readonly tenantId: string;
  readonly journaliser?: (m: string) => void;
}): Promise<void> {
  if (options.nodeEnv === 'production') {
    throw new Error('Le seed de démonstration complet est interdit en production.');
  }
  const journaliser = options.journaliser ?? ((m: string) => process.stdout.write(`${m}\n`));
  const c = new Client({
    connectionString: options.urlMigration,
    application_name: 'dfa-seed-complement',
  });
  await c.connect();
  try {
    await c.query('begin');
    const ctx: Ctx = {
      c,
      tenantId: options.tenantId,
      maintenant: new Date(),
      rnd: creerRnd(20260807),
      journaliser,
      sites: new Map(),
      utilisateurs: new Map(),
      compteurs: new Map(),
    };
    for (const s of (
      await c.query<{ id: string; code: string }>(
        'select id, code from site where tenant_id = $1',
        [ctx.tenantId],
      )
    ).rows) {
      ctx.sites.set(s.code, s.id);
    }
    for (const u of (
      await c.query<{ id: string; role: string }>(
        'select id, role::text from utilisateur where tenant_id = $1 order by cree_le',
        [ctx.tenantId],
      )
    ).rows) {
      if (!ctx.utilisateurs.has(u.role)) ctx.utilisateurs.set(u.role, u.id);
    }
    journaliser('');
    journaliser('Jeu de démonstration complet :');
    await semerCollaborateurs(ctx);
    // La clé « technicien » du seed de base sert aussi aux pointages.
    await semerPostesEtActivites(ctx);
    const clients = await semerClients(ctx);
    const vehicules = await semerVehicules(ctx, clients);
    const pieces = await semerCataloguePieces(ctx);
    const atelier = await semerAtelierEtFacturation(ctx, clients, vehicules, pieces.articles);
    await appliquerStockOr(ctx, atelier);
    await semerCommandesEtStockBas(ctx, pieces);
    await semerConsignes(ctx, pieces);
    await semerRendezVous(ctx, clients, vehicules, atelier);
    await semerPointages(ctx, atelier);
    const sion = ctx.sites.get('SION');
    if (sion) {
      await c.query(
        `insert into pointage_verrouillage_site (tenant_id, site_id, verrouille_jusquau_le, dernier_motif, derniere_action_le, dernier_utilisateur_id)
         values ($1, $2, current_date - 40, 'Clôture mensuelle des heures', now() - interval '38 days', $3)`,
        [ctx.tenantId, sion, ctx.utilisateurs.get('direction') ?? null],
      );
    }
    await semerCourtoisie(ctx, clients, atelier);
    await semerControlesEtDevisComplementaires(ctx);
    const nbPneus = await semerPneus(ctx, vehicules);
    journaliser(`  ${String(nbPneus)} dépôts de pneus (en dépôt, à relancer, monté, sortis)`);
    await semerVentes(ctx, clients);
    await semerRelances(ctx, clients, atelier);
    await semerExportEtPeriodes(ctx);
    await ecrireCompteurs(ctx);
    await c.query('commit');
    journaliser('Jeu complet écrit.');
  } catch (erreur) {
    await c.query('rollback');
    throw erreur;
  } finally {
    await c.end();
  }
}
