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

    // `select … for update` : verrouille la ligne de compteur existante pour la durée de la
    // transaction appelante — un second appel concurrent sur la MÊME clé attend le commit/rollback
    // du premier au lieu de lire une valeur périmée (protocole documenté sur la table,
    // db/migrations/0005_parametrage.sql §4).
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

    if (ligne) {
      const suivant = ligne.valeur + 1;
      await tx.execute(sql`
        update public.compteur_document
           set valeur = ${suivant}
         where id = ${ligne.id}
      `);
      return suivant;
    }

    // Aucune ligne pour cette clé : première émission de l'année/du site pour ce type de document.
    // `site_id` est écrit tel quel (potentiellement `null`, portée tenant) — c'est la colonne
    // réelle qui distingue la portée « tenant » de la portée « site », l'uuid nul ci-dessus ne
    // sert qu'à l'expression de l'index et n'est jamais persisté.
    const insertion = await tx.execute<LigneCompteurBrute>(sql`
      insert into public.compteur_document (tenant_id, type_document, annee, site_id, valeur)
      values (${clef.tenantId}, ${clef.typeDocument}, ${clef.annee}, ${clef.siteId}, 1)
      returning id, valeur
    `);

    // `on conflict` n'est délibérément pas utilisé ici : le `for update` ci-dessus a déjà pris le
    // verrou de ligne applicable si la ligne existait, et la contrainte `compteur_document_uk`
    // rendrait de toute façon une éventuelle course concurrente visible par une erreur — jamais
    // par un numéro dupliqué silencieux.
    const creee = insertion.rows[0];
    if (!creee) {
      throw new Error(
        `ServiceCompteurs : l'insertion de la ligne de compteur (${clef.tenantId}/${clef.typeDocument}/${String(clef.annee)}) n'a rendu aucune ligne.`,
      );
    }
    return creee.valeur;
  }
}
