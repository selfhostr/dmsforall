import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { schemaCleIdempotence, RETENTION_IDEMPOTENCE_JOURS } from '@dfa/shared';

import { JETON_DB, type AccesBase, type ContexteTenant, type TransactionDfa } from '../../db';
import { ErreurMetier } from '../erreurs/erreur-metier';
import { Horloge } from '../horloge/horloge';
import { calculerEmpreinte } from './empreinte';
import { deciderIdempotence, type LigneCleIdempotenceExistante } from './decision-idempotence';
import type {
  ReponseMemorisable,
  RequeteIdempotente,
  ResultatIdempotent,
  ServiceIdempotence,
} from './idempotence.types';

const MILLISECONDES_PAR_JOUR = 24 * 60 * 60 * 1000;

/**
 * Colonnes lues brutes (snake_case, telles que le driver `pg` les rend hors mapping Drizzle).
 * Alias de type et non `interface` : Drizzle contraint le paramètre de `execute<T>` à
 * `Record<string, unknown>`, contrainte qu'un alias satisfait par signature d'index implicite,
 * mais qu'une interface ne satisfait pas (même convention que `PostureTable`,
 * `db/acces-base.service.ts`).
 */
type LigneCleIdempotenceBrute = {
  readonly empreinte_requete: Buffer;
  readonly statut: 'en_cours' | 'termine';
  readonly statut_http: number | null;
  readonly reponse: unknown;
};

/**
 * Implémentation SQL directe (pas de schéma Drizzle `cle_idempotence` : la table est créée par la
 * migration `0004` — L1-04, en parallèle de cet agent — donc pas encore disponible au moment où ce
 * fichier est écrit). Colonnes utilisées, conformes à `plan-lot1-execution.md` §L1-04 :
 * `cle_idempotence(tenant_id, methode, chemin, cle, empreinte_requete bytea, statut,
 * statut_http, reponse jsonb, cree_le, expire_le)`, `unique (tenant_id, methode, chemin, cle)`.
 * Si la migration livrée s'écarte de ces noms, seule cette classe doit changer — l'interface
 * `ServiceIdempotence` ne dépend d'aucun détail de colonne.
 */
@Injectable()
export class ServiceIdempotenceImpl implements ServiceIdempotence {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    private readonly horloge: Horloge,
  ) {}

  async executer<T extends ReponseMemorisable>(
    ctx: ContexteTenant,
    requete: RequeteIdempotente,
    travail: (tx: TransactionDfa) => Promise<T>,
  ): Promise<ResultatIdempotent<T>> {
    const validation = schemaCleIdempotence.safeParse(requete.cle);
    if (!validation.success) {
      throw new ErreurMetier('VALIDATION_ECHOUEE', "Clé d'idempotence invalide.", {
        erreurs: [
          {
            champ: 'Idempotency-Key',
            code: 'cle_invalide',
            message: "La clé d'idempotence doit être un uuid v4.",
          },
        ],
      });
    }

    const empreinte = calculerEmpreinte(requete.corps);

    return this.acces.enTenant(ctx, async (tx) => {
      const maintenant = this.horloge.maintenant();
      const expireLe = new Date(
        maintenant.getTime() + RETENTION_IDEMPOTENCE_JOURS * MILLISECONDES_PAR_JOUR,
      );

      // Tentative d'insertion atomique : sous "read committed", un INSERT qui entre en conflit
      // avec une ligne pas encore committée BLOQUE jusqu'à la fin de cette transaction concurrente
      // puis réévalue le conflit — c'est ce qui garantit "un rejeu, jamais deux créations" sans
      // verrou explicite supplémentaire.
      const insertion = await tx.execute<{ cle: string }>(sql`
        insert into public.cle_idempotence
          (tenant_id, methode, chemin, cle, empreinte_requete, statut, cree_le, expire_le)
        values (${ctx.tenantId}, ${requete.methode}, ${requete.chemin}, ${requete.cle}, ${empreinte}, 'en_cours', ${maintenant}, ${expireLe})
        on conflict (tenant_id, methode, chemin, cle) do nothing
        returning cle
      `);
      const aGagneLaCourse = insertion.rows.length > 0;

      let ligneExistante: LigneCleIdempotenceExistante | null = null;
      if (!aGagneLaCourse) {
        const lecture = await tx.execute<LigneCleIdempotenceBrute>(sql`
          select empreinte_requete, statut, statut_http, reponse
            from public.cle_idempotence
           where tenant_id = ${ctx.tenantId} and methode = ${requete.methode}
             and chemin = ${requete.chemin} and cle = ${requete.cle}
        `);
        const brute = lecture.rows[0];
        ligneExistante = brute
          ? {
              empreinteRequete: brute.empreinte_requete,
              statut: brute.statut,
              statutHttp: brute.statut_http,
              reponse: brute.reponse,
            }
          : null;
      }

      const decision = deciderIdempotence(aGagneLaCourse, ligneExistante, empreinte);

      switch (decision.type) {
        case 'nouvelle_execution': {
          const resultat = await travail(tx);
          await tx.execute(sql`
            update public.cle_idempotence
               set statut = 'termine', statut_http = ${resultat.statutHttp}, reponse = ${JSON.stringify(resultat.corps)}::jsonb
             where tenant_id = ${ctx.tenantId} and methode = ${requete.methode}
               and chemin = ${requete.chemin} and cle = ${requete.cle}
          `);
          return { reponse: resultat, rejoue: false };
        }
        case 'rejeu':
          // Reconstruction du type T annoncé par l'appelant à partir de la mémorisation JSON :
          // ServiceIdempotence ne connaît pas T, seule la forme ReponseMemorisable qu'il a
          // lui-même écrite. C'est la frontière assumée de ce mécanisme de rejeu générique.
          return {
            reponse: { statutHttp: decision.statutHttp, corps: decision.corps } as T,
            rejoue: true,
          };
        case 'conflit_empreinte':
          throw new ErreurMetier(
            'IDEMPOTENCE_CONFLIT',
            "La même clé d'idempotence a déjà été utilisée avec un corps de requête différent.",
          );
        case 'requete_en_cours':
          throw new ErreurMetier(
            'IDEMPOTENCE_CONFLIT',
            "La requête initiale portant cette clé d'idempotence est encore en cours de traitement.",
            { enTetes: { 'Retry-After': '1' } },
          );
        case 'anomalie':
          throw new ErreurMetier(
            'ERREUR_INTERNE',
            "Anomalie d'idempotence : ligne introuvable après un conflit d'insertion dans la même transaction.",
          );
      }
    });
  }
}
