import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { FiltresSuiviVente, LigneSuiviVente, PageCurseur, RoleUtilisateur } from '@dfa/shared';

import { JETON_DB, type AccesBase, type ContexteTenant } from '../db';
import { Horloge } from '../common/horloge/horloge';
import { roleVoitLesMontants } from '../facturation/documents/mappeurs';

import {
  construireConditionKeyset,
  construireOrderBy,
  decoderCurseurPourTri,
  encoderCurseurTrie,
  type DefinitionTri,
} from './pagination-triee';
import { versLigneSuiviVente, type EntreeLigneSuiviVenteBrut } from './suivi-mappers';

/**
 * Suivi financement/garantie (`GET /ventes/suivi`) — VUE dérivée en lecture seule sur
 * `dossier_vente` × `financement_vente` × `vehicule` (garantie), AUCUNE nouvelle table, AUCUNE
 * nouvelle écriture. Voir l'en-tête de `contrats/ventes/suivi.ts` pour la doctrine complète
 * (ce qui est calculable, la garde RF-116).
 *
 * UNE SEULE requête SQL brute par page (pas de N+1 : contrairement à
 * `ServiceDossierVente.lister()`, qui recharge chaque dossier via `chargerDossierVente()` +
 * `assembler()` après la page keyset, cette vue est délibérément allégée — elle ne recompose ni
 * les documents, ni la check-list, ni l'historique complet des financements — donc tout ce dont
 * `versLigneSuiviVente` a besoin est sélectionné directement dans la requête de page, sans second
 * aller-retour par ligne).
 *
 * GARDE RF-116 TRANSITIVE SUR LA CLÉ DE TRI/FILTRE (IMPORTANT, LIRE AVANT DE MODIFIER) —
 *
 * Le curseur de pagination (`PageCurseur.curseurSuivant`) encode sa valeur de tri en CLAIR
 * (base64url, jamais chiffré — voir `contrats/pagination.ts::DonneesCurseurV2`, "opaque" y
 * signifie "le client ne doit pas le construire à la main", pas "le contenu est secret"). Si la
 * clé de tri (`prochaineEcheanceLe`) était calculée à partir de `financement.echeanceLe` MÊME
 * pour un rôle qui n'a pas `roleVoitLesMontants(role)` (donc pour qui ce champ est OMIS de la
 * réponse JSON, RF-116), un tel rôle pourrait décoder son propre curseur et reconstituer la date
 * d'échéance masquée — un contournement trivial de l'omission RF-116, alors même que
 * `versLigneSuiviVente` (`suivi-mappers.ts`) l'omet correctement du corps de la réponse.
 *
 * D'où `construireExpressionEcheanceFinancement(role)` ci-dessous : quand `!roleVoitLesMontants
 * (role)`, l'expression SQL de l'échéance financement est remplacée par un `null` SQL LITTÉRAL —
 * elle ne contribue alors JAMAIS à `prochaineEcheanceLe` (ni au tri, ni au curseur, ni au filtre
 * `dansJours`) pour ce rôle. Conséquence assumée, documentée : l'ORDRE de la liste (et les pages
 * qui en résultent) diffère entre un rôle qui voit les montants et un rôle qui ne les voit pas —
 * c'est le prix nécessaire pour que l'omission RF-116 tienne de bout en bout, pas seulement dans
 * le corps de la première page. La garantie, elle, n'est jamais gatée (voir l'en-tête du contrat)
 * et contribue donc identiquement à `prochaineEcheanceLe` quel que soit le rôle.
 */

/** `credit`/`leasing` uniquement — un `comptant` n'est pas un financement (RV-44), rien à suivre. */
const EXPR_ECHEANCE_FINANCEMENT: SQL = sql`
  case
    when fc.statut = 'confirme' and fc.confirme_le is not null and fc.duree_mois is not null
      then (fc.confirme_le::date + (fc.duree_mois || ' months')::interval)::date
    else null
  end`;

const EXPR_ECHEANCE_GARANTIE: SQL = sql`
  case
    when v.garantie_debut is not null and v.garantie_mois is not null
      then (v.garantie_debut + (v.garantie_mois || ' months')::interval)::date
    else null
  end`;

/** `null` SQL littéral pour un rôle sans droit financier — voir la garde RF-116 en tête de
 *  fichier : l'échéance financement ne doit JAMAIS contribuer au tri/curseur/filtre pour ce rôle,
 *  pas seulement être omise du corps de la réponse. */
function construireExpressionEcheanceFinancement(role: RoleUtilisateur): SQL {
  return roleVoitLesMontants(role) ? EXPR_ECHEANCE_FINANCEMENT : sql`null`;
}

function construireExpressionProchaineEcheance(role: RoleUtilisateur): SQL {
  const exprFinancement = construireExpressionEcheanceFinancement(role);
  return sql`
    case
      when ${exprFinancement} is null then ${EXPR_ECHEANCE_GARANTIE}
      when ${EXPR_ECHEANCE_GARANTIE} is null then ${exprFinancement}
      else least(${exprFinancement}, ${EXPR_ECHEANCE_GARANTIE})
    end`;
}

/** Déjà castée en texte (pas de colonne `timestamptz` en jeu ici, l'expression source est une
 *  `date` — `date::text` rend `"aaaa-mm-jj"`, comparable lexicographiquement dans le même ordre
 *  que la date qu'elle représente ; `temporel` (mécanisme dédié aux `timestamptz`, voir
 *  `pagination-triee.ts`) n'est pas nécessaire ici). */
function construireDefinitionTri(role: RoleUtilisateur): DefinitionTri {
  return {
    expression: sql`(${construireExpressionProchaineEcheance(role)})::text`,
    sens: 'asc',
    nullable: true,
  };
}

/**
 * Alias de type et non `interface` : Drizzle contraint le paramètre de `tx.execute<T>()` à
 * `Record<string, unknown>`, contrainte qu'un alias satisfait par signature d'index implicite,
 * mais qu'une interface ne satisfait pas (même doctrine que `PostureTable`,
 * `db/acces-base.service.ts`, et `mappers.ts::LigneArticle & {...}` côté `pieces/`).
 */
type LigneSuiviVenteBrute = {
  readonly dossierVenteId: string;
  readonly siteId: string;
  readonly dossierStatut: string;
  readonly clientAcheteurId: string;
  readonly clientAcheteurType: string;
  readonly clientAcheteurNom: string | null;
  readonly clientAcheteurPrenom: string | null;
  readonly clientAcheteurRaisonSociale: string | null;
  readonly vehiculeId: string | null;
  readonly vehiculeMarque: string | null;
  readonly vehiculeModele: string | null;
  readonly vehiculeVersion: string | null;
  readonly vehiculeVin: string | null;
  readonly garantieDebut: string | null;
  readonly garantieMois: number | null;
  readonly garantieKm: number | null;
  readonly dernierKilometrageKm: number | null;
  readonly financementId: string | null;
  readonly financementType: string | null;
  readonly financementStatut: string | null;
  readonly financementConfirmeLe: string | null;
  readonly financementDureeMois: number | null;
  readonly organismeId: string | null;
  readonly organismeType: string | null;
  readonly organismeNom: string | null;
  readonly organismePrenom: string | null;
  readonly organismeRaisonSociale: string | null;
  readonly triValeur: string | null;
};

@Injectable()
export class ServiceSuiviVente {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    private readonly horloge: Horloge,
  ) {}

  async lister(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    filtres: FiltresSuiviVente,
  ): Promise<PageCurseur<LigneSuiviVente>> {
    const definition = construireDefinitionTri(role);
    const idExpr = sql`dv.id`;
    // Un seul tri exposé par ce module (`TRIS_SUIVI_VENTE`, voir `contrats/ventes/suivi.ts`) : la
    // table `definitions` attendue par `decoderCurseurPourTri` se réduit à une seule entrée, celle
    // du tri effectivement demandé — cohérent avec `construireDefinitionTri(role)` ci-dessus, qui
    // ne connaît elle non plus qu'un seul tri. `definition.temporel` est `undefined` ici (voir son
    // en-tête : l'expression est déjà `(...)::text` sur une `date`, pas un `timestamptz`).
    const curseurDecode = decoderCurseurPourTri(filtres.curseur, filtres.tri, {
      [filtres.tri]: definition,
    });
    const exprProchaineEcheance = construireExpressionProchaineEcheance(role);
    const maintenant = this.horloge.maintenant();

    return this.acces.enTenant(ctx, async (tx) => {
      const conditions = [
        sql`dv.tenant_id = ${ctx.tenantId}`,
        // Un dossier n'a rien à suivre ici sans financement credit/leasing NI garantie connue
        // (voir l'en-tête de `contrats/ventes/suivi.ts`) — condition d'EXISTENCE, jamais gatée
        // par rôle : un rôle sans droit financier voit toujours que ce dossier a un financement
        // en cours, seuls son détail monétaire et son échéance sont omis.
        sql`(fc.id is not null or v.garantie_debut is not null)`,
      ];
      if (filtres.siteId) conditions.push(sql`dv.site_id = ${filtres.siteId}`);
      if (filtres.dansJours != null) {
        conditions.push(sql`${exprProchaineEcheance} is not null`);
        conditions.push(sql`${exprProchaineEcheance} >= current_date`);
        conditions.push(
          sql`${exprProchaineEcheance} <= (current_date + (${filtres.dansJours})::integer * interval '1 day')::date`,
        );
      }
      if (curseurDecode) {
        conditions.push(
          construireConditionKeyset(definition, idExpr, curseurDecode.valeur, curseurDecode.id),
        );
      }

      const requete = sql`
        select
          dv.id as "dossierVenteId",
          dv.site_id as "siteId",
          dv.statut as "dossierStatut",
          ca.id as "clientAcheteurId",
          ca.type as "clientAcheteurType",
          ca.nom as "clientAcheteurNom",
          ca.prenom as "clientAcheteurPrenom",
          ca.raison_sociale as "clientAcheteurRaisonSociale",
          v.id as "vehiculeId",
          v.marque as "vehiculeMarque",
          v.modele as "vehiculeModele",
          v.version as "vehiculeVersion",
          v.vin as "vehiculeVin",
          v.garantie_debut::text as "garantieDebut",
          v.garantie_mois as "garantieMois",
          v.garantie_km as "garantieKm",
          km."valeurKm" as "dernierKilometrageKm",
          fc.id as "financementId",
          fc.type as "financementType",
          fc.statut as "financementStatut",
          fc.confirme_le::text as "financementConfirmeLe",
          fc.duree_mois as "financementDureeMois",
          fc.organisme_id as "organismeId",
          org.type as "organismeType",
          org.nom as "organismeNom",
          org.prenom as "organismePrenom",
          org.raison_sociale as "organismeRaisonSociale",
          ${definition.expression} as "triValeur"
        from public.dossier_vente dv
        join public.client ca on ca.tenant_id = dv.tenant_id and ca.id = dv.client_acheteur_id
        left join public.vehicule_stock vs on vs.tenant_id = dv.tenant_id and vs.id = dv.vehicule_id
        left join public.vehicule v on v.tenant_id = vs.tenant_id and v.id = vs.id
        left join lateral (
          select vk.valeur_km as "valeurKm"
          from public.vehicule_kilometrage vk
          where vk.tenant_id = dv.tenant_id and vk.vehicule_id = v.id
          order by vk.releve_le desc
          limit 1
        ) km on true
        left join lateral (
          select f.*
          from public.financement_vente f
          where f.tenant_id = dv.tenant_id
            and f.dossier_vente_id = dv.id
            and f.type in ('credit', 'leasing')
          order by (f.statut = 'refuse') asc, f.cree_le desc
          limit 1
        ) fc on true
        left join public.client org on org.tenant_id = dv.tenant_id and org.id = fc.organisme_id
        where ${sql.join(conditions, sql` and `)}
        order by ${construireOrderBy(definition, idExpr)}
        limit ${filtres.limite + 1}
      `;

      const resultat = await tx.execute<LigneSuiviVenteBrute>(requete);
      const lignes = resultat.rows;
      const aUnePageSuivante = lignes.length > filtres.limite;
      const pageLignes = aUnePageSuivante ? lignes.slice(0, filtres.limite) : lignes;
      const derniere = pageLignes[pageLignes.length - 1];

      const donnees = pageLignes.map((l) =>
        versLigneSuiviVente(versEntreeBrute(l), role, maintenant),
      );

      return {
        donnees,
        curseurSuivant:
          aUnePageSuivante && derniere
            ? encoderCurseurTrie({
                tri: filtres.tri,
                valeur: derniere.triValeur,
                id: derniere.dossierVenteId,
              })
            : null,
        limite: filtres.limite,
      };
    });
  }
}

function versEntreeBrute(l: LigneSuiviVenteBrute): EntreeLigneSuiviVenteBrut {
  return {
    dossierVenteId: l.dossierVenteId,
    siteId: l.siteId,
    dossierStatut: l.dossierStatut,
    clientAcheteurId: l.clientAcheteurId,
    clientAcheteurType: l.clientAcheteurType,
    clientAcheteurNom: l.clientAcheteurNom,
    clientAcheteurPrenom: l.clientAcheteurPrenom,
    clientAcheteurRaisonSociale: l.clientAcheteurRaisonSociale,
    vehiculeId: l.vehiculeId,
    vehiculeMarque: l.vehiculeMarque,
    vehiculeModele: l.vehiculeModele,
    vehiculeVersion: l.vehiculeVersion,
    vehiculeVin: l.vehiculeVin,
    garantieDebut: l.garantieDebut,
    garantieMois: l.garantieMois,
    garantieKm: l.garantieKm,
    dernierKilometrageKm: l.dernierKilometrageKm,
    financement: {
      id: l.financementId,
      type: l.financementType,
      statut: l.financementStatut,
      confirmeLe: l.financementConfirmeLe,
      dureeMois: l.financementDureeMois,
      organismeId: l.organismeId,
      organismeType: l.organismeType,
      organismeNom: l.organismeNom,
      organismePrenom: l.organismePrenom,
      organismeRaisonSociale: l.organismeRaisonSociale,
    },
  };
}
