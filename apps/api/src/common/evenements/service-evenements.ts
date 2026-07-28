import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { ContexteTenant, TransactionDfa } from '../../db';
import { Horloge } from '../horloge/horloge';
import type { EvenementAPublier, ServiceEvenements } from './evenements.types';

/**
 * Implémentation SQL directe — pas de schéma Drizzle `evenement_metier` : la table est créée par
 * la migration `0004` (L1-04, en parallèle de cet agent), donc pas encore disponible au moment où
 * ce fichier est écrit. Colonnes assumées, dérivées du contrat gelé `EnveloppeEvenementMetier`
 * (`@dfa/shared`, `contrats/atelier/evenement.ts`) : `evenement_metier(id, tenant_id, site_id,
 * type, version_schema, survenu_le, ressource_type, ressource_id, ressource_numero, donnees
 * jsonb, cree_le)`. `id` est un uuid généré par défaut en base (convention `colonneId()` du
 * projet), jamais fourni par ce service. Si la migration livrée s'écarte de ces noms, seule
 * cette classe doit changer — `ServiceEvenements` ne dépend d'aucun détail de colonne.
 */
@Injectable()
export class ServiceEvenementsImpl implements ServiceEvenements {
  constructor(private readonly horloge: Horloge) {}

  async publier(tx: TransactionDfa, ctx: ContexteTenant, evenement: EvenementAPublier): Promise<void> {
    const survenuLe = this.horloge.maintenant();

    await tx.execute(sql`
      insert into public.evenement_metier
        (tenant_id, site_id, type, version_schema, survenu_le, ressource_type, ressource_id, ressource_numero, donnees)
      values (
        ${ctx.tenantId},
        ${evenement.siteId},
        ${evenement.type},
        ${evenement.versionSchema},
        ${survenuLe},
        ${evenement.ressource.type},
        ${evenement.ressource.id},
        ${evenement.ressource.numero ?? null},
        ${JSON.stringify(evenement.donnees)}::jsonb
      )
    `);
  }
}
