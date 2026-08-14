import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  ParametresRechercheMarquesVehiculesCh,
  ParametresRechercheModelesVehiculesCh,
  ReponseMarquesVehiculesCh,
  ReponseModelesVehiculesCh,
} from '@dfa/shared';

import { JETON_DB, type AccesBase, type ContexteTenant } from '../../db';

type LigneMarqueBrute = {
  readonly marque: string;
  /** `count(distinct ...)` — pg rend un `bigint` en chaîne via le driver `pg`, jamais un `number`. */
  readonly nombreModeles: string;
  /** `null` quand `marque` a été trouvée directement ; sinon le texte de l'alias qui l'a trouvée
   *  (table `type_approbation_ch_marque_alias`, migration 0051). */
  readonly aliasTrouve: string | null;
};

type LigneModeleBrute = {
  readonly modele: string;
  readonly codeTypeCh: string | null;
};

/**
 * Lecture du référentiel véhicules suisse (`type_approbation_ch`, migration 0050) — autocomplétion
 * marque → modèle (mode 2 de la migration).
 *
 * `type_approbation_ch` est un référentiel `[dfa:referentiel-partage]` : SANS `tenant_id`, données
 * ASTRA identiques pour tous les tenants. `AccesBase.enTenant` reste néanmoins le SEUL point
 * d'entrée vers les tables métier de ce dépôt (voir `db/acces-base.service.ts`) — `ctx` n'est ici
 * utilisé que pour l'emprunter, aucune clause `where tenant_id = ...` n'a de sens sur cette table
 * et n'en porte donc aucune.
 *
 * Recherche par PRÉFIXE (`normaliser_recherche(colonne) like normaliser_recherche(motif) || '%'`),
 * pas par fragment : c'est ce que sert l'index composite
 * `type_approbation_ch_marque_modele_recherche_idx` posé par 0050 (`text_pattern_ops` sur
 * `(normaliser_recherche(marque), normaliser_recherche(modele))`) — voir son en-tête, § « Mode 2 ».
 * Un `recherche` absent ou vide NE FILTRE PAS : c'est le cas « les plus fréquents », jamais confondu
 * avec un filtre qui ne matche rien (piège vérifié de ce dépôt : un filtre accepté mais jamais
 * appliqué au SQL rend silencieusement la liste complète au lieu d'une liste vide).
 *
 * `rechercherMarques` consulte AUSSI `type_approbation_ch_marque_alias` (migration 0051) — une
 * marque introuvable par son nom canonique ASTRA peut l'être par un alias (« volkswagen » -> VW).
 * Seulement quand `recherche` est renseigné : sans terme tapé, un alias n'a rien à résoudre, et la
 * requête « les plus fréquents » reste EXACTEMENT celle d'avant 0051 (aucun coût ajouté au chemin
 * le plus fréquent — voir la CTE `candidats_directs`, autonome et jamais rejointe pour ce cas).
 * Un match direct est TOUJOURS préféré à un match par alias pour une même marque (`not exists`
 * dans `alias_correspondants`) : `aliasTrouve` ne vaut jamais une fausse impression d'ambiguïté
 * quand le nom canonique matchait déjà tout seul.
 */
@Injectable()
export class ServiceReferentielVehiculesCh {
  constructor(@Inject(JETON_DB) private readonly acces: AccesBase) {}

  async rechercherMarques(
    ctx: ContexteTenant,
    params: ParametresRechercheMarquesVehiculesCh,
  ): Promise<ReponseMarquesVehiculesCh> {
    const motif = construireMotifPrefixe(params.recherche);

    return this.acces.enTenant(ctx, async (tx) => {
      const resultat = await tx.execute<LigneMarqueBrute>(sql`
        with candidats_directs as (
          select marque,
                 count(distinct modele) as "nombreModeles"
            from public.type_approbation_ch
           where (
                   ${motif}::text is null
                   or public.normaliser_recherche(marque) like public.normaliser_recherche(${motif})
                 )
           group by marque
        ),
        alias_correspondants as (
          select distinct a.marque_canonique, a.alias
            from public.type_approbation_ch_marque_alias a
           where ${motif}::text is not null
             and public.normaliser_recherche(a.alias) like public.normaliser_recherche(${motif})
             and not exists (
               select 1 from candidats_directs d where d.marque = a.marque_canonique
             )
        ),
        candidats_via_alias as (
          select ac.marque_canonique as marque,
                 count(distinct t.modele) as "nombreModeles",
                 max(ac.alias) as "aliasTrouve"
            from alias_correspondants ac
            join public.type_approbation_ch t
              on public.normaliser_recherche(t.marque) = public.normaliser_recherche(ac.marque_canonique)
           group by ac.marque_canonique
        )
        select marque, "nombreModeles", null::text as "aliasTrouve" from candidats_directs
        union all
        select marque, "nombreModeles", "aliasTrouve" from candidats_via_alias
        order by "nombreModeles" desc, marque asc
        limit ${params.limite}
      `);

      return {
        marques: resultat.rows.map((ligne) => ({
          nom: ligne.marque,
          nombreModeles: Number(ligne.nombreModeles),
          aliasTrouve: ligne.aliasTrouve,
        })),
      };
    });
  }

  async rechercherModeles(
    ctx: ContexteTenant,
    params: ParametresRechercheModelesVehiculesCh,
  ): Promise<ReponseModelesVehiculesCh> {
    const motif = construireMotifPrefixe(params.recherche);

    return this.acces.enTenant(ctx, async (tx) => {
      const resultat = await tx.execute<LigneModeleBrute>(sql`
        select modele,
               case when count(distinct code_type_ch) = 1
                    then max(code_type_ch)
                    else null
               end as "codeTypeCh"
          from public.type_approbation_ch
         where public.normaliser_recherche(marque) = public.normaliser_recherche(${params.marque})
           and (
                 ${motif}::text is null
                 or public.normaliser_recherche(modele) like public.normaliser_recherche(${motif})
               )
         group by modele
         order by count(*) desc, modele asc
         limit ${params.limite}
      `);

      return {
        modeles: resultat.rows.map((ligne) => ({
          nom: ligne.modele,
          codeTypeCh: ligne.codeTypeCh,
        })),
      };
    });
  }
}

/**
 * `undefined`/`''` (recherche absente ou vide, déjà `trim()`-é par le schéma zod) → `null`, pour
 * DÉSACTIVER le filtre côté SQL (branche `... is null` ci-dessus) plutôt que de construire un motif
 * `'%'` qui matcherait tout — les deux produisent le même résultat ici, mais `null` documente
 * l'intention (« pas de filtre ») au lieu de la déduire d'un motif qui matche accidentellement tout.
 *
 * Motif ancré au DÉBUT seulement (`prefixe%`, jamais `%prefixe%`) : c'est ce que sert
 * `text_pattern_ops` sur l'index 0050, une autocomplétion classique « depuis le premier caractère ».
 */
export function construireMotifPrefixe(recherche: string | undefined): string | null {
  return recherche ? `${recherche}%` : null;
}
