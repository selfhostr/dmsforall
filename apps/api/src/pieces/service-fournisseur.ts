import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type {
  EntreeCreationFournisseur,
  EntreeModificationFournisseur,
  FiltresFournisseurs,
  PageCurseur,
  ReponseAvecAvertissements,
  ReponseFournisseur,
} from '@dfa/shared';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import { JETON_DB } from '../db';
import { fournisseur } from '../db/schema';
import type { LigneFournisseur, NouveauFournisseur } from '../db/schema';
import { CollecteurAvertissements } from '../common/avertissements';
import { ErreurMetier } from '../common/erreurs';

import { versFournisseurResponse } from './mappers';
import {
  construireConditionKeyset,
  construireOrderBy,
  decoderCurseurPourTri,
  encoderCurseurTrie,
  expressionTriValeur,
  valeurCurseurDepuisTri,
  type DefinitionTri,
} from './pagination-triee';

const DEFINITIONS_TRI_FOURNISSEURS: Readonly<Record<FiltresFournisseurs['tri'], DefinitionTri>> = {
  'nom:asc': { expression: sql`f.nom`, sens: 'asc', nullable: false },
  'nom:desc': { expression: sql`f.nom`, sens: 'desc', nullable: false },
  'creeLe:desc': { expression: sql`f.cree_le`, sens: 'desc', nullable: false, temporel: true },
};

const COLONNES_FOURNISSEUR_ALIASEES = sql`
  f.id as "id", f.nom as "nom", f.email as "email", f.telephone as "telephone",
  f.delai_habituel_jours as "delaiHabituelJours", f.statut as "statut",
  f.cree_le as "creeLe", f.modifie_le as "modifieLe"
`;

/**
 * Service fournisseur (RP-26, §1) : référentiel minimal — fiche, liste, création, modification,
 * désactivation/réactivation. PAS de suppression (RP-07/RM-12/RM-31, même doctrine que
 * `article`/`client`/`vehicule`). Priorité 2 du lot (voir l'en-tête de `pieces.module.ts`).
 */
@Injectable()
export class ServiceFournisseur {
  constructor(@Inject(JETON_DB) private readonly acces: AccesBase) {}

  async lister(
    ctx: ContexteTenant,
    params: FiltresFournisseurs,
  ): Promise<PageCurseur<ReponseFournisseur>> {
    const definition = DEFINITIONS_TRI_FOURNISSEURS[params.tri];
    const idExpr = sql`f.id`;
    const curseurDecode = decoderCurseurPourTri(params.curseur, params.tri);

    return this.acces.enTenant(ctx, async (tx) => {
      const conditions = [sql`f.tenant_id = ${ctx.tenantId}`];
      if (params.statut && params.statut.length > 0) {
        conditions.push(
          sql`f.statut::text in (${sql.join(
            params.statut.map((s) => sql`${s}`),
            sql`, `,
          )})`,
        );
      }
      if (curseurDecode) {
        conditions.push(
          construireConditionKeyset(definition, idExpr, curseurDecode.valeur, curseurDecode.id),
        );
      }

      const resultat = await tx.execute<
        LigneFournisseur & { triValeur: string | number | null }
      >(sql`
        select ${COLONNES_FOURNISSEUR_ALIASEES}, ${expressionTriValeur(definition)} as "triValeur"
          from public.fournisseur f
         where ${sql.join(conditions, sql` and `)}
         order by ${construireOrderBy(definition, idExpr)}
         limit ${params.limite + 1}
      `);

      const lignes = resultat.rows;
      const aUnePageSuivante = lignes.length > params.limite;
      const pageLignes = aUnePageSuivante ? lignes.slice(0, params.limite) : lignes;
      const derniere = pageLignes[pageLignes.length - 1];

      return {
        donnees: pageLignes.map((l) => versFournisseurResponse(l)),
        curseurSuivant:
          aUnePageSuivante && derniere
            ? encoderCurseurTrie({
                tri: params.tri,
                valeur: valeurCurseurDepuisTri(definition, derniere.triValeur),
                id: derniere.id,
              })
            : null,
        limite: params.limite,
      };
    });
  }

  async parId(ctx: ContexteTenant, id: string): Promise<ReponseFournisseur> {
    return this.acces.enTenant(ctx, async (tx) =>
      versFournisseurResponse(await this.chargerOu404(tx, ctx, id)),
    );
  }

  /**
   * `POST /fournisseurs` — PAS d'`Idempotency-Key` : aucune ressource rare générée par le serveur
   * (pas de numérotation, contrairement à `article`/`client`), voir le contrat `fournisseur.ts`.
   */
  async creer(
    ctx: ContexteTenant,
    entree: EntreeCreationFournisseur,
  ): Promise<ReponseAvecAvertissements<ReponseFournisseur>> {
    return this.acces.enTenant(ctx, async (tx) => {
      const valeurs: NouveauFournisseur = {
        tenantId: ctx.tenantId,
        nom: entree.nom,
        email: entree.email ?? null,
        telephone: entree.telephone ?? null,
        delaiHabituelJours: entree.delaiHabituelJours ?? null,
      };
      const [ligne] = await tx.insert(fournisseur).values(valeurs).returning();
      if (!ligne) throw new ErreurMetier('ERREUR_INTERNE', 'Échec de création du fournisseur.');
      return new CollecteurAvertissements().envelopper(versFournisseurResponse(ligne));
    });
  }

  async modifier(
    ctx: ContexteTenant,
    id: string,
    entree: EntreeModificationFournisseur,
  ): Promise<ReponseAvecAvertissements<ReponseFournisseur>> {
    return this.acces.enTenant(ctx, async (tx) => {
      await this.chargerOu404(tx, ctx, id);

      const valeurs: Partial<NouveauFournisseur> = {};
      if ('nom' in entree && entree.nom !== undefined) valeurs.nom = entree.nom;
      if ('email' in entree) valeurs.email = entree.email ?? null;
      if ('telephone' in entree) valeurs.telephone = entree.telephone ?? null;
      if ('delaiHabituelJours' in entree)
        valeurs.delaiHabituelJours = entree.delaiHabituelJours ?? null;

      if (Object.keys(valeurs).length > 0) {
        await tx
          .update(fournisseur)
          .set(valeurs)
          .where(and(eq(fournisseur.tenantId, ctx.tenantId), eq(fournisseur.id, id)));
      }

      const ligneMaj = await this.chargerOu404(tx, ctx, id);
      return new CollecteurAvertissements().envelopper(versFournisseurResponse(ligneMaj));
    });
  }

  /** `POST /fournisseurs/{id}/desactiver` — pas de suppression (RP-07/RM-12/RM-31). */
  async desactiver(
    ctx: ContexteTenant,
    id: string,
  ): Promise<ReponseAvecAvertissements<ReponseFournisseur>> {
    return this.acces.enTenant(ctx, async (tx) => {
      await this.chargerOu404(tx, ctx, id);
      await tx
        .update(fournisseur)
        .set({ statut: 'inactif' })
        .where(and(eq(fournisseur.tenantId, ctx.tenantId), eq(fournisseur.id, id)));
      const ligneMaj = await this.chargerOu404(tx, ctx, id);
      return new CollecteurAvertissements().envelopper(versFournisseurResponse(ligneMaj));
    });
  }

  /** `POST /fournisseurs/{id}/reactiver` — retour à `actif`. */
  async reactiver(
    ctx: ContexteTenant,
    id: string,
  ): Promise<ReponseAvecAvertissements<ReponseFournisseur>> {
    return this.acces.enTenant(ctx, async (tx) => {
      await this.chargerOu404(tx, ctx, id);
      await tx
        .update(fournisseur)
        .set({ statut: 'actif' })
        .where(and(eq(fournisseur.tenantId, ctx.tenantId), eq(fournisseur.id, id)));
      const ligneMaj = await this.chargerOu404(tx, ctx, id);
      return new CollecteurAvertissements().envelopper(versFournisseurResponse(ligneMaj));
    });
  }

  private async chargerOu404(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    id: string,
  ): Promise<LigneFournisseur> {
    const lignes = await tx
      .select()
      .from(fournisseur)
      .where(and(eq(fournisseur.tenantId, ctx.tenantId), eq(fournisseur.id, id)))
      .limit(1);
    const ligne = lignes[0];
    if (!ligne) throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Fournisseur introuvable.');
    return ligne;
  }
}
