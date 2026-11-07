import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import type {
  EntreeCreationMotifRendezVous,
  EntreeModificationMotifRendezVous,
  ReponseMotifRendezVous,
} from '@dfa/shared';

import { ErreurMetier } from '../common/erreurs';
import { JETON_DB, type AccesBase, type ContexteTenant } from '../db';
import { motifRendezVous } from '../db/schema';

import { versDtoMotifRendezVous } from './mappeurs';

const SQLSTATE_UNICITE = '23505';

/**
 * `GET|POST /motifs-rendez-vous`, `PATCH /motifs-rendez-vous/{id}` — catalogue `motif_rendez_vous` (existant depuis la migration 0005,
 * jamais consommé avant ce lot). Petit référentiel par tenant (quelques entrées) : pas de
 * pagination — même doctrine que `GET /parametres-atelier` (liste courte, pas une collection).
 */
@Injectable()
export class ServiceMotifsRendezVous {
  constructor(@Inject(JETON_DB) private readonly acces: AccesBase) {}

  async lister(ctx: ContexteTenant): Promise<readonly ReponseMotifRendezVous[]> {
    return this.acces.enTenant(ctx, async (tx) => {
      const lignes = await tx
        .select()
        .from(motifRendezVous)
        .where(eq(motifRendezVous.tenantId, ctx.tenantId))
        .orderBy(asc(motifRendezVous.libelleFr));
      return lignes.map(versDtoMotifRendezVous);
    });
  }

  async creer(
    ctx: ContexteTenant,
    entree: EntreeCreationMotifRendezVous,
  ): Promise<ReponseMotifRendezVous> {
    return this.acces.enTenant(ctx, async (tx) => {
      try {
        const [ligne] = await tx
          .insert(motifRendezVous)
          .values({
            tenantId: ctx.tenantId,
            code: entree.code,
            libelleFr: entree.libelleFr,
            libelleDe: entree.libelleDe ?? null,
            libelleIt: entree.libelleIt ?? null,
            dureeDefautMinutes: entree.dureeDefautMinutes ?? null,
            heuresAtelierDefautCentiemes: entree.heuresAtelierDefautCentiemes ?? null,
            actif: entree.actif ?? true,
          })
          .returning();
        if (!ligne) {
          throw new ErreurMetier('ERREUR_INTERNE', "L'insertion du motif n'a rendu aucune ligne.");
        }
        return versDtoMotifRendezVous(ligne);
      } catch (erreur) {
        if ((erreur as { code?: unknown } | null)?.code === SQLSTATE_UNICITE) {
          throw new ErreurMetier(
            'CONFLIT',
            `Un motif de rendez-vous avec le code « ${entree.code} » existe déjà.`,
          );
        }
        throw erreur;
      }
    });
  }

  /**
   * Le `code` ne change jamais. Désactiver (`actif: false`) retire le motif des nouvelles prises de
   * rendez-vous (`ServiceRendezVous.creer`) sans toucher à l'historique ; il n'existe aucune
   * suppression (clé étrangère depuis `rendez_vous`, et `dfa_app` n'a pas `DELETE`).
   */
  async modifier(
    ctx: ContexteTenant,
    id: string,
    entree: EntreeModificationMotifRendezVous,
  ): Promise<ReponseMotifRendezVous> {
    const colonnes: Partial<typeof motifRendezVous.$inferInsert> = {};
    if (entree.libelleFr !== undefined) colonnes.libelleFr = entree.libelleFr;
    if (entree.libelleDe !== undefined) colonnes.libelleDe = entree.libelleDe;
    if (entree.libelleIt !== undefined) colonnes.libelleIt = entree.libelleIt;
    if (entree.dureeDefautMinutes !== undefined) {
      colonnes.dureeDefautMinutes = entree.dureeDefautMinutes;
    }
    if (entree.heuresAtelierDefautCentiemes !== undefined) {
      colonnes.heuresAtelierDefautCentiemes = entree.heuresAtelierDefautCentiemes;
    }
    if (entree.actif !== undefined) colonnes.actif = entree.actif;

    const introuvable = (): ErreurMetier =>
      new ErreurMetier('RESSOURCE_INTROUVABLE', `Motif de rendez-vous « ${id} » introuvable.`);
    const cible = and(eq(motifRendezVous.tenantId, ctx.tenantId), eq(motifRendezVous.id, id));

    return this.acces.enTenant(ctx, async (tx) => {
      const [ligne] =
        Object.keys(colonnes).length === 0
          ? await tx.select().from(motifRendezVous).where(cible)
          : await tx.update(motifRendezVous).set(colonnes).where(cible).returning();
      if (!ligne) throw introuvable();
      return versDtoMotifRendezVous(ligne);
    });
  }
}
