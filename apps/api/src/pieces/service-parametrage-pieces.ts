import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { EntreeModificationParametresPieces, ReponseParametresPieces } from '@dfa/shared';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import { JETON_DB } from '../db';
import { parametrePieces } from '../db/schema';
import type { LigneParametrePieces, NouveauParametrePieces } from '../db/schema';
import { ErreurMetier } from '../common/erreurs';

import { versParametresPiecesResponse } from './mappers';

/**
 * Service paramétrage pièces (§10, PP-01 → PP-08) — priorité 4 du lot. Une ligne par tenant
 * (`parametre_pieces`, PK = `tenant_id`).
 *
 * Contrairement à `ServiceParametresAtelier` (`parametrage/parametres-atelier/`, doctrine « la
 * ligne aurait dû être créée à la création du tenant »), AUCUN mécanisme de bootstrap n'insère de
 * ligne `parametre_pieces` à la création d'un tenant à ce jour (vérifié : aucune référence hors de
 * `db/schema/pieces/`, `pieces/mappers.ts` et `pieces/service-mouvement.ts` — le lecteur de seuil
 * d'ajustement) — ce module est postérieur (étape 3) au flux de création de tenant (étape 0), hors
 * périmètre d'écriture de cet agent. Ce service se rend donc résilient à l'absence de ligne : lit
 * en garantissant l'existence (`INSERT … ON CONFLICT DO NOTHING` avant SELECT), les valeurs par
 * défaut de chaque colonne (0028) produisant exactement la réponse attendue pour un tenant qui n'a
 * jamais réglé ce paramétrage. Signalé au rapport de livraison : le bootstrap propre (à la création
 * du tenant, socle) reste préférable à terme, mais cette résilience rend le lot utilisable sans
 * attendre cette correction ailleurs.
 *
 * AVERTISSEMENT DE PORTÉE, signalé au rapport de livraison (le brief demande explicitement de le
 * faire si ce PATCH rend du code existant obsolète) : `stockAutresSitesVisible` (PP-01) et
 * `stockNegatifForcageAutorise` (PP-02) deviennent ici LISIBLES et ÉCRIVABLES, mais RESTENT
 * INERTES — aucun service du domaine (`ServiceStock`, `ServiceMouvement`) ne les CONSULTE encore :
 * la visibilité inter-site n'est filtrée nulle part, et `verifierDisponible()`
 * (`service-mouvement.ts`) laisse `entree.forcer: true` contourner `STOCK_INSUFFISANT`
 * inconditionnellement, quelle que soit la valeur de `stockNegatifForcageAutorise`. Câbler cette
 * consultation est un changement de comportement sur du code déjà livré et testé — délibérément
 * PAS fait dans ce lot sans confirmation.
 */
@Injectable()
export class ServiceParametragePieces {
  constructor(@Inject(JETON_DB) private readonly acces: AccesBase) {}

  async obtenir(ctx: ContexteTenant): Promise<ReponseParametresPieces> {
    return this.acces.enTenant(ctx, async (tx) => versParametresPiecesResponse(await this.garantirLigne(tx, ctx)));
  }

  /** `PATCH /parametrage/pieces` — mise à jour partielle (`conditionnementArticleDistinct` ABSENT du schéma d'entrée, RP-05). */
  async modifier(ctx: ContexteTenant, entree: EntreeModificationParametresPieces): Promise<ReponseParametresPieces> {
    return this.acces.enTenant(ctx, async (tx) => {
      await this.garantirLigne(tx, ctx);

      const valeurs: Partial<NouveauParametrePieces> = {};
      if ('stockAutresSitesVisible' in entree && entree.stockAutresSitesVisible !== undefined) {
        valeurs.stockAutresSitesVisible = entree.stockAutresSitesVisible;
      }
      if ('stockNegatifForcageAutorise' in entree && entree.stockNegatifForcageAutorise !== undefined) {
        valeurs.stockNegatifForcageAutorise = entree.stockNegatifForcageAutorise;
      }
      if ('methodePrixAchat' in entree) valeurs.methodePrixAchat = entree.methodePrixAchat ?? null;
      if ('seuilValeurAjustementSignificatifCentimes' in entree) {
        valeurs.seuilValeurAjustementSignificatifCentimes = entree.seuilValeurAjustementSignificatifCentimes ?? null;
      }
      if ('delaiConsigneAcquisitionJours' in entree) {
        valeurs.delaiConsigneAcquisitionJours = entree.delaiConsigneAcquisitionJours ?? null;
      }
      if ('tauxTvaConsignePourmille' in entree && entree.tauxTvaConsignePourmille !== undefined) {
        valeurs.tauxTvaConsignePourmille = entree.tauxTvaConsignePourmille;
      }

      if (Object.keys(valeurs).length === 0) {
        return versParametresPiecesResponse(await this.chargerLigne(tx, ctx));
      }

      const [ligne] = await tx.update(parametrePieces).set(valeurs).where(eq(parametrePieces.tenantId, ctx.tenantId)).returning();
      if (!ligne) throw new ErreurMetier('ERREUR_INTERNE', 'Échec de mise à jour des paramètres pièces.');
      return versParametresPiecesResponse(ligne);
    });
  }

  private async chargerLigne(tx: TransactionDfa, ctx: ContexteTenant): Promise<LigneParametrePieces> {
    const [ligne] = await tx.select().from(parametrePieces).where(eq(parametrePieces.tenantId, ctx.tenantId));
    if (!ligne) throw new ErreurMetier('ERREUR_INTERNE', 'Paramètres pièces introuvables après garantie de leur existence.');
    return ligne;
  }

  private async garantirLigne(tx: TransactionDfa, ctx: ContexteTenant): Promise<LigneParametrePieces> {
    await tx.insert(parametrePieces).values({ tenantId: ctx.tenantId }).onConflictDoNothing();
    return this.chargerLigne(tx, ctx);
  }
}
