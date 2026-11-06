import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { TransactionDfa } from '../../db';
import type { ClefCompteur, ServiceCompteurs } from './compteurs.types';

/** Neutralise `site_id` dans l'index d'unicité — identique à celui posé dans la migration. */
const SITE_NUL = '00000000-0000-0000-0000-000000000000';

/** Colonnes brutes lues (snake_case, driver `pg`) — convention `service-idempotence.ts`. */
type LigneCompteurBrute = { readonly id: string; readonly valeur: number };

@Injectable()
export class ServiceCompteursImpl implements ServiceCompteurs {
  async prochainNumero(tx: TransactionDfa, clef: ClefCompteur): Promise<number> {
    const siteClef = clef.siteId ?? SITE_NUL;

    // 1. Garantit l'existence de la ligne. `on conflict do nothing` : si une transaction
    // concurrente est en train de créer la même clé (premier numéro d'un garage neuf), cet INSERT
    // attend son commit puis ne fait rien (ou s'exécute si elle a fait rollback) — plus jamais
    // d'erreur `compteur_document_uk`. `site_id` est écrit tel quel (potentiellement `null`,
    // portée tenant) ; l'uuid nul n'existe que dans l'expression de l'index, d'où la cible
    // d'inférence recopiée à l'identique de la migration 0005. La ligne naît à 0 (défaut de la
    // colonne) et l'incrément ci-dessous la porte à 1 : un rollback annule les deux ensemble.
    await tx.execute(sql`
      insert into public.compteur_document (tenant_id, type_document, annee, site_id, valeur)
      values (${clef.tenantId}, ${clef.typeDocument}, ${clef.annee}, ${clef.siteId}, 0)
      on conflict (tenant_id, type_document, annee,
                   coalesce(site_id, ${SITE_NUL}::uuid))
      do nothing
    `);

    // 2. `select … for update` : verrouille la ligne pour la durée de la transaction appelante —
    // un appel concurrent sur la MÊME clé attend le commit/rollback du premier au lieu de lire une
    // valeur périmée (protocole documenté sur la table, db/migrations/0005_parametrage.sql §4).
    // Nouvelle instruction en READ COMMITTED : elle voit la ligne commitée par la concurrente.
    const existante = await tx.execute<LigneCompteurBrute>(sql`
      select id, valeur
        from public.compteur_document
       where tenant_id = ${clef.tenantId}
         and type_document = ${clef.typeDocument}
         and annee = ${clef.annee}
         and coalesce(site_id, ${SITE_NUL}::uuid) = ${siteClef}::uuid
         for update
    `);

    const ligne = existante.rows[0];
    if (!ligne) {
      throw new Error(
        `ServiceCompteurs : la ligne de compteur (${clef.tenantId}/${clef.typeDocument}/${String(clef.annee)}) est introuvable après insertion.`,
      );
    }

    const suivant = ligne.valeur + 1;
    await tx.execute(sql`
      update public.compteur_document
         set valeur = ${suivant}
       where id = ${ligne.id}
    `);
    return suivant;
  }
}
