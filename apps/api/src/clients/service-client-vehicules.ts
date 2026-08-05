import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PageCurseur, VehiculeResume } from '@dfa/shared';

import type { AccesBase, ContexteTenant } from '../db';
import { JETON_DB } from '../db';
import { ErreurMetier } from '../common/erreurs';

import {
  construireConditionKeyset,
  construireOrderBy,
  decoderCurseurPourTri,
  encoderCurseurTrie,
  type DefinitionTri,
} from './pagination-triee';
import type { ParametresListeVehiculesDuClient } from './schemas';

/**
 * `GET /clients/{id}/vehicules` — RM-20 : les détentions CLOSES ne sont visibles que sur demande
 * explicite (`inclureAnciennesDetentions`). Projection `VehiculeResume` (`@dfa/shared`) : le
 * contrat ne définit aucun type plus riche pour cette collection — voir la réponse de tâche.
 *
 * Propriété du domaine véhicules (`apps/api/src/vehicules/**`, L1-09) : cette lecture réutilise
 * uniquement le SCHÉMA de table, jamais de code de ce module. La composition de `designation`
 * (`marque modele version`) est une hypothèse locale, à confronter à celle du module véhicules
 * si elle diverge (source de vérité concurrente sinon — voir la réponse de tâche).
 */
const DEFINITIONS_TRI_VEHICULES: Readonly<
  Record<ParametresListeVehiculesDuClient['tri'], DefinitionTri>
> = {
  'plaque:asc': { expression: sql`p.valeur`, sens: 'asc', nullable: true },
  'plaque:desc': { expression: sql`p.valeur`, sens: 'desc', nullable: true },
};

type LigneVehiculeResumeBrute = {
  readonly id: string;
  readonly plaque: string | null;
  readonly canton: string | null;
  readonly designation: string;
  readonly vin: string | null;
  readonly premiereMiseEnCirculationLe: string | null;
  readonly identificationIncomplete: boolean;
  readonly emplacementLibre: string | null;
  readonly triValeur: string | number | null;
};

function versVehiculeResume(ligne: LigneVehiculeResumeBrute): VehiculeResume {
  return {
    id: ligne.id,
    plaque: ligne.plaque,
    canton: ligne.canton,
    designation: ligne.designation,
    vin: ligne.vin,
    premiereMiseEnCirculationLe: ligne.premiereMiseEnCirculationLe,
    identificationIncomplete: ligne.identificationIncomplete,
    emplacementLibre: ligne.emplacementLibre,
  };
}

@Injectable()
export class ServiceClientVehicules {
  constructor(@Inject(JETON_DB) private readonly acces: AccesBase) {}

  async lister(
    ctx: ContexteTenant,
    clientId: string,
    params: ParametresListeVehiculesDuClient,
  ): Promise<PageCurseur<VehiculeResume>> {
    const definition = DEFINITIONS_TRI_VEHICULES[params.tri];
    const idExpr = sql`v.id`;
    const curseurDecode = decoderCurseurPourTri(
      params.curseur,
      params.tri,
      DEFINITIONS_TRI_VEHICULES,
    );

    return this.acces.enTenant(ctx, async (tx) => {
      const clientExiste = await tx.execute<{ id: string }>(
        sql`select id from public.client where tenant_id = ${ctx.tenantId} and id = ${clientId} limit 1`,
      );
      if (clientExiste.rows.length === 0)
        throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Client introuvable.');

      const conditionDetention = params.inclureAnciennesDetentions
        ? sql`d.tenant_id = v.tenant_id and d.vehicule_id = v.id and d.client_id = ${clientId}`
        : sql`d.tenant_id = v.tenant_id and d.vehicule_id = v.id and d.client_id = ${clientId} and d.au is null`;

      const conditions = [
        sql`v.tenant_id = ${ctx.tenantId}`,
        sql`exists (select 1 from public.vehicule_detention d where ${conditionDetention})`,
      ];
      if (curseurDecode) {
        conditions.push(
          construireConditionKeyset(definition, idExpr, curseurDecode.valeur, curseurDecode.id),
        );
      }

      const requete = sql`
        select
          v.id as "id",
          p.valeur as "plaque",
          p.canton as "canton",
          (v.marque || ' ' || v.modele || coalesce(' ' || v.version, '')) as "designation",
          v.vin as "vin",
          v.date_1re_circulation as "premiereMiseEnCirculationLe",
          v.identification_incomplete as "identificationIncomplete",
          v.emplacement_libre as "emplacementLibre",
          ${definition.expression} as "triValeur"
        from public.vehicule v
        left join public.vehicule_plaque p on p.tenant_id = v.tenant_id and p.vehicule_id = v.id and p.au is null
        where ${sql.join(conditions, sql` and `)}
        order by ${construireOrderBy(definition, idExpr)}
        limit ${params.limite + 1}
      `;

      const resultat = await tx.execute<LigneVehiculeResumeBrute>(requete);
      const lignes = resultat.rows;
      const aUnePageSuivante = lignes.length > params.limite;
      const pageLignes = aUnePageSuivante ? lignes.slice(0, params.limite) : lignes;
      const derniere = pageLignes[pageLignes.length - 1];

      return {
        donnees: pageLignes.map(versVehiculeResume),
        curseurSuivant:
          aUnePageSuivante && derniere
            ? encoderCurseurTrie({ tri: params.tri, valeur: derniere.triValeur, id: derniere.id })
            : null,
        limite: params.limite,
      };
    });
  }
}
