import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { ClientResume, EtatAfficheOrdreReparation, OrdreReparationResume, PageCurseur, VehiculeResume } from '@dfa/shared';

import type { AccesBase, ContexteTenant } from '../db';
import { enDate, JETON_DB } from '../db';
import { client } from '../db/schema';
import { ErreurMetier } from '../common/erreurs';

import { versClientResume } from './mappers';
import {
  construireConditionKeyset,
  construireOrderBy,
  decoderCurseurPourTri,
  encoderCurseurTrie,
  expressionTriValeur,
  valeurCurseurDepuisTri,
  type DefinitionTri,
} from './pagination-triee';
import type { ParametresListeOrDuClient } from './schemas';

/**
 * `GET /clients/{id}/ordres-reparation` — RM-21 : les OR restent attachés au client de l'époque.
 * Projection `OrdreReparationResume` (`@dfa/shared`).
 *
 * RISQUE DE DIVERGENCE SIGNALÉ EN RÉPONSE DE TÂCHE (propriété réelle : `apps/api/src/atelier/**`,
 * L1-12/13, hors périmètre de cet agent) : `etatAffiche` dérive de `ligne_or.blocage`
 * (priorité accord > pieces > externe, RM-58) et `totalTtcCentimes` agrège `ligne_or`. Ce fichier
 * réimplémente cette dérivation en LECTURE SEULE sur le schéma pour honorer cet endpoint, sans
 * dépendre du module atelier (parallélisme des agents). Si le module atelier calcule ces mêmes
 * champs différemment pour `GET /ordres-reparation`, c'est une source de vérité concurrente à
 * réconcilier à l'intégration (L1-16) — voir aussi L1-10 sur ce même risque pour `contexte-atelier`.
 */
const DEFINITIONS_TRI_OR: Readonly<Record<ParametresListeOrDuClient['tri'], DefinitionTri>> = {
  'ouvertLe:asc': { expression: sql`o.ouvert_le`, sens: 'asc', nullable: true, temporel: true },
  'ouvertLe:desc': { expression: sql`o.ouvert_le`, sens: 'desc', nullable: true, temporel: true },
};

/** Lignes exclues des totaux et de la détection de blocage : annulée n'a jamais eu lieu, refusée n'est pas retenue. */
const STATUTS_LIGNE_HORS_TOTAL = ['annulee', 'refusee'] as const;

type LigneOrDuClientBrute = {
  readonly id: string;
  readonly numero: string;
  readonly statut: OrdreReparationResume['statut'];
  readonly type: OrdreReparationResume['type'];
  readonly localisation: OrdreReparationResume['localisation'];
  // `Date | string` : SQL brut (`tx.execute`) — mesuré, le pilote `pg` y rend en fait `timestamptz`
  // en `Date` (pas en chaîne) par défaut ; `enDate()` reste défensif au cas où un chemin
  // d'exécution différent rendrait un jour une chaîne à la place (voir `enDate()`,
  // `db/acces-amorcage.service.ts`). Purement des champs d'AFFICHAGE (`versOrdreReparationResume`),
  // sans rapport avec `triValeur` ci-dessous — qui, lui, DOIT être du texte natif PostgreSQL, voir
  // sa déclaration.
  readonly ouvertLe: Date | string | null;
  readonly restitutionPromiseLe: Date | string | null;
  readonly vehiculeId: string;
  readonly vehiculePlaque: string | null;
  readonly vehiculeCanton: string | null;
  readonly vehiculeDesignation: string;
  readonly vehiculeVin: string | null;
  readonly vehiculePremiereMiseEnCirculationLe: string | null;
  readonly vehiculeIdentificationIncomplete: boolean;
  readonly nombreLignes: number;
  readonly totalTtcCentimes: number;
  readonly aAttenteAccord: boolean;
  readonly aAttentePieces: boolean;
  readonly aAttenteExterne: boolean;
  // `string | number | null`, jamais `Date` : `ouvertLe:asc/desc` est `temporel: true`
  // (`DEFINITIONS_TRI_OR` ci-dessus), donc `expressionTriValeur()` cast explicitement cette colonne
  // en `::text` dans le `SELECT` — pour empêcher le pilote de la rendre en `Date` et d'en tronquer
  // la microseconde avant que la valeur de curseur ne soit construite (voir `pagination-triee.ts`,
  // `valeurCurseurDepuisTri()`, et `common/pagination/valeur-temporelle.ts`).
  readonly triValeur: string | number | null;
}

/** Priorité `accord > pieces > externe` (RM-58), et UNIQUEMENT sur un OR encore actif. */
function calculerEtatAffiche(ligne: LigneOrDuClientBrute): EtatAfficheOrdreReparation {
  const actif = ligne.statut === 'ouvert' || ligne.statut === 'en_cours';
  if (actif && ligne.aAttenteAccord) return 'attente_accord';
  if (actif && ligne.aAttentePieces) return 'attente_pieces';
  if (actif && ligne.aAttenteExterne) return 'attente_externe';
  return ligne.statut;
}

function versVehiculeResume(ligne: LigneOrDuClientBrute): VehiculeResume {
  return {
    id: ligne.vehiculeId,
    plaque: ligne.vehiculePlaque,
    canton: ligne.vehiculeCanton,
    designation: ligne.vehiculeDesignation,
    vin: ligne.vehiculeVin,
    premiereMiseEnCirculationLe: ligne.vehiculePremiereMiseEnCirculationLe,
    identificationIncomplete: ligne.vehiculeIdentificationIncomplete,
  };
}

function versOrdreReparationResume(
  ligne: LigneOrDuClientBrute,
  clientResume: ClientResume,
  avecMontants: boolean,
): OrdreReparationResume {
  return {
    id: ligne.id,
    numero: ligne.numero,
    statut: ligne.statut,
    etatAffiche: calculerEtatAffiche(ligne),
    type: ligne.type,
    localisation: ligne.localisation,
    ouvertLe: ligne.ouvertLe ? enDate(ligne.ouvertLe).toISOString() : null,
    restitutionPromiseLe: ligne.restitutionPromiseLe ? enDate(ligne.restitutionPromiseLe).toISOString() : null,
    vehicule: versVehiculeResume(ligne),
    client: clientResume,
    nombreLignes: ligne.nombreLignes,
    ...(avecMontants ? { totalTtcCentimes: ligne.totalTtcCentimes } : {}),
  };
}

@Injectable()
export class ServiceClientOrdresReparation {
  constructor(@Inject(JETON_DB) private readonly acces: AccesBase) {}

  async lister(
    ctx: ContexteTenant,
    clientId: string,
    params: ParametresListeOrDuClient,
    avecMontants: boolean,
  ): Promise<PageCurseur<OrdreReparationResume>> {
    const definition = DEFINITIONS_TRI_OR[params.tri];
    const idExpr = sql`o.id`;
    const curseurDecode = decoderCurseurPourTri(params.curseur, params.tri);

    return this.acces.enTenant(ctx, async (tx) => {
      const lignesClient = await tx.select().from(client).where(and(eq(client.tenantId, ctx.tenantId), eq(client.id, clientId))).limit(1);
      const ligneClient = lignesClient[0];
      if (!ligneClient) throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Client introuvable.');
      // Une seule requête supplémentaire, exécutée UNE FOIS pour ce client (pas par ligne d'OR) :
      // même doctrine « pas de N+1 » que `ServiceClient.lister`, ici triviale puisque tous les OR
      // de cette page partagent le même client.
      const extraResultat = await tx.execute<{
        localite: string | null;
        nombreVehicules: number;
        // `Date | string` : SQL brut — voir `enDate()`.
        dernierPassageLe: Date | string | null;
      }>(sql`
        select
          (select ca.localite
             from public.client_adresse ca
            where ca.tenant_id = ${ctx.tenantId} and ca.client_id = ${clientId} and ca.type = 'principale' and ca.actif = true
            order by ca.cree_le desc
            limit 1) as "localite",
          (select count(*)::int
             from public.vehicule_detention vd
            where vd.tenant_id = ${ctx.tenantId} and vd.client_id = ${clientId} and vd.au is null) as "nombreVehicules",
          (select max(o.ouvert_le)
             from public.ordre_reparation o
            where o.tenant_id = ${ctx.tenantId} and o.client_id = ${clientId}) as "dernierPassageLe"
      `);
      const extraClient = extraResultat.rows[0] ?? { localite: null, nombreVehicules: 0, dernierPassageLe: null };
      const clientResume = versClientResume(ligneClient, extraClient);

      const conditions = [sql`o.tenant_id = ${ctx.tenantId}`, sql`o.client_id = ${clientId}`];
      if (params.statut && params.statut.length > 0) {
        conditions.push(sql`o.statut::text in (${sql.join(params.statut.map((s) => sql`${s}`), sql`, `)})`);
      }
      if (curseurDecode) {
        conditions.push(construireConditionKeyset(definition, idExpr, curseurDecode.valeur, curseurDecode.id));
      }

      const requete = sql`
        select
          o.id as "id", o.numero as "numero", o.statut as "statut", o.type as "type",
          o.localisation as "localisation", o.ouvert_le as "ouvertLe", o.restitution_promise_le as "restitutionPromiseLe",
          v.id as "vehiculeId", p.valeur as "vehiculePlaque", p.canton as "vehiculeCanton",
          (v.marque || ' ' || v.modele || coalesce(' ' || v.version, '')) as "vehiculeDesignation",
          v.vin as "vehiculeVin", v.date_1re_circulation as "vehiculePremiereMiseEnCirculationLe",
          v.identification_incomplete as "vehiculeIdentificationIncomplete",
          (select count(*) from public.ligne_or l where l.tenant_id = o.tenant_id and l.ordre_reparation_id = o.id and l.statut <> 'annulee') as "nombreLignes",
          (select coalesce(sum(l.montant_ttc_centimes), 0) from public.ligne_or l where l.tenant_id = o.tenant_id and l.ordre_reparation_id = o.id and l.statut::text not in (${sql.join(STATUTS_LIGNE_HORS_TOTAL.map((s) => sql`${s}`), sql`, `)})) as "totalTtcCentimes",
          exists (select 1 from public.ligne_or l where l.tenant_id = o.tenant_id and l.ordre_reparation_id = o.id and l.blocage = 'accord' and l.statut::text not in (${sql.join(STATUTS_LIGNE_HORS_TOTAL.map((s) => sql`${s}`), sql`, `)})) as "aAttenteAccord",
          exists (select 1 from public.ligne_or l where l.tenant_id = o.tenant_id and l.ordre_reparation_id = o.id and l.blocage = 'pieces' and l.statut::text not in (${sql.join(STATUTS_LIGNE_HORS_TOTAL.map((s) => sql`${s}`), sql`, `)})) as "aAttentePieces",
          exists (select 1 from public.ligne_or l where l.tenant_id = o.tenant_id and l.ordre_reparation_id = o.id and l.blocage = 'externe' and l.statut::text not in (${sql.join(STATUTS_LIGNE_HORS_TOTAL.map((s) => sql`${s}`), sql`, `)})) as "aAttenteExterne",
          ${expressionTriValeur(definition)} as "triValeur"
        from public.ordre_reparation o
        join public.vehicule v on v.tenant_id = o.tenant_id and v.id = o.vehicule_id
        left join public.vehicule_plaque p on p.tenant_id = v.tenant_id and p.vehicule_id = v.id and p.au is null
        where ${sql.join(conditions, sql` and `)}
        order by ${construireOrderBy(definition, idExpr)}
        limit ${params.limite + 1}
      `;

      const resultat = await tx.execute<LigneOrDuClientBrute>(requete);
      const lignes = resultat.rows;
      const aUnePageSuivante = lignes.length > params.limite;
      const pageLignes = aUnePageSuivante ? lignes.slice(0, params.limite) : lignes;
      const derniere = pageLignes[pageLignes.length - 1];

      return {
        donnees: pageLignes.map((ligne) => versOrdreReparationResume(ligne, clientResume, avecMontants)),
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
}
