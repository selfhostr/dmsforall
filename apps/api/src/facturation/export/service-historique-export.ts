/**
 * Historique des exports fiduciaires et relecture du fichier (`GET /exports-fiduciaires`,
 * `GET /exports-fiduciaires/{id}/fichier`). Lecture seule : `export_comptable` est conservé à vie
 * (MD-91), le fichier est celui stocké (gzip, migration 0084) — jamais régénéré, donc identique
 * octet pour octet à celui remis à la fiduciaire (empreinte SHA-256 revérifiée à la lecture).
 */

import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import type {
  CibleExport,
  ExportHistorique,
  ModeGranulariteExport,
  PageCurseur,
  ParametresListeExports,
} from '@dfa/shared';

import { JETON_DB, type AccesBase, type ContexteTenant } from '../../db';
import { ErreurMetier } from '../../common/erreurs';
import {
  construireConditionKeyset,
  construireOrderBy,
  decoderCurseurPourTri,
  encoderCurseurTrie,
  expressionTriValeur,
  valeurCurseurDepuisTri,
  type DefinitionTri,
} from '../../common/pagination';

const TRI = 'genereLe:desc';
const DEFINITION_TRI: DefinitionTri = {
  expression: sql`e.genere_le`,
  sens: 'desc',
  nullable: false,
  temporel: true,
};
const DEFINITIONS = { [TRI]: DEFINITION_TRI } as const;

interface LigneHistorique extends Record<string, unknown> {
  id: string;
  tri_valeur: string;
  genere_le_iso: string;
  periode_debut: string;
  periode_fin: string;
  cible: CibleExport;
  mode: ModeGranulariteExport;
  statut: string;
  nb_ecritures: number;
  total_debit: string;
  total_credit: string;
  nb_factures: number | null;
  nb_avoirs: number | null;
  nb_encaissements: number | null;
  total_ht: string | null;
  total_tva: string | null;
  total_ttc: string | null;
  facture_premier: string | null;
  facture_dernier: string | null;
  avoir_premier: string | null;
  avoir_dernier: string | null;
  genere_par_id: string | null;
  prenom: string | null;
  nom: string | null;
  empreinte_sha256: string;
  nom_fichier: string | null;
}

export interface FichierExport {
  readonly nomFichier: string;
  readonly typeMime: string;
  readonly contenu: Buffer;
  readonly empreinteSha256: string;
}

const enNombre = (v: string | null): number | null => (v === null ? null : Number(v));

function plage(premier: string | null, dernier: string | null) {
  return premier !== null && dernier !== null ? { premier, dernier } : null;
}

@Injectable()
export class ServiceHistoriqueExport {
  constructor(@Inject(JETON_DB) private readonly acces: AccesBase) {}

  async lister(
    ctx: ContexteTenant,
    params: ParametresListeExports,
  ): Promise<PageCurseur<ExportHistorique>> {
    const curseur = decoderCurseurPourTri(params.curseur, TRI, DEFINITIONS);

    return this.acces.enTenant(ctx, async (tx) => {
      const conditions: SQL[] = [sql`e.tenant_id = ${ctx.tenantId}`];
      if (params.cible !== undefined) {
        conditions.push(sql`e.cible = ${params.cible}::public.cible_export`);
      }
      if (curseur) {
        conditions.push(
          construireConditionKeyset(DEFINITION_TRI, sql`e.id`, curseur.valeur, curseur.id),
        );
      }

      const resultat = await tx.execute<LigneHistorique>(sql`
        select e.id,
               ${expressionTriValeur(DEFINITION_TRI)} as tri_valeur,
               to_char(e.genere_le at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as genere_le_iso,
               e.periode_debut::text as periode_debut,
               e.periode_fin::text as periode_fin,
               e.cible, e.mode, e.statut,
               e.nb_ecritures,
               e.total_debit_centimes::text as total_debit,
               e.total_credit_centimes::text as total_credit,
               e.nb_factures, e.nb_avoirs, e.nb_encaissements,
               e.total_ht_centimes::text as total_ht,
               e.total_tva_centimes::text as total_tva,
               e.total_ttc_centimes::text as total_ttc,
               e.facture_premier, e.facture_dernier, e.avoir_premier, e.avoir_dernier,
               e.genere_par_id, u.prenom, u.nom,
               e.empreinte_sha256,
               f.nom_fichier
          from public.export_comptable e
          left join public.utilisateur u on u.tenant_id = e.tenant_id and u.id = e.genere_par_id
          left join public.export_comptable_fichier f on f.tenant_id = e.tenant_id and f.export_id = e.id
         where ${sql.join(conditions, sql` and `)}
         order by ${construireOrderBy(DEFINITION_TRI, sql`e.id`)}
         limit ${params.limite + 1}
      `);

      const lignes = resultat.rows;
      const suite = lignes.length > params.limite;
      const page = suite ? lignes.slice(0, params.limite) : lignes;
      const derniere = page[page.length - 1];

      return {
        donnees: page.map(versHistorique),
        curseurSuivant:
          suite && derniere
            ? encoderCurseurTrie({
                tri: TRI,
                valeur: valeurCurseurDepuisTri(DEFINITION_TRI, derniere.tri_valeur),
                id: derniere.id,
              })
            : null,
        limite: params.limite,
      };
    });
  }

  async fichier(ctx: ContexteTenant, exportId: string): Promise<FichierExport> {
    return this.acces.enTenant(ctx, async (tx) => {
      const resultat = await tx.execute<{
        empreinte_sha256: string;
        nom_fichier: string | null;
        type_mime: string | null;
        contenu_gz: Buffer | null;
      }>(sql`
        select e.empreinte_sha256, f.nom_fichier, f.type_mime, f.contenu_gz
          from public.export_comptable e
          left join public.export_comptable_fichier f on f.tenant_id = e.tenant_id and f.export_id = e.id
         where e.tenant_id = ${ctx.tenantId} and e.id = ${exportId}
      `);
      const ligne = resultat.rows[0];
      if (!ligne) {
        throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Export introuvable.', {
          detail: `export_comptable ${exportId} introuvable pour ce tenant.`,
        });
      }
      if (ligne.contenu_gz === null || ligne.nom_fichier === null || ligne.type_mime === null) {
        throw new ErreurMetier(
          'RESSOURCE_INTROUVABLE',
          "Le fichier de cet export n'a pas été conservé.",
          {
            detail: `export_comptable ${exportId} antérieur à la migration 0084 : fichier non conservé.`,
          },
        );
      }

      const contenu = gunzipSync(ligne.contenu_gz);
      const empreinte = createHash('sha256').update(contenu).digest('hex');
      if (empreinte !== ligne.empreinte_sha256) {
        // Jamais livrer un fichier qui n'est plus celui que la fiduciaire a reçu.
        throw new ErreurMetier('ERREUR_INTERNE', 'Empreinte du fichier conservé incohérente.', {
          detail: `export_comptable ${exportId} : SHA-256 recalculé ${empreinte} ≠ ${ligne.empreinte_sha256}.`,
        });
      }
      return {
        nomFichier: ligne.nom_fichier,
        typeMime: ligne.type_mime,
        contenu,
        empreinteSha256: empreinte,
      };
    });
  }
}

function versHistorique(l: LigneHistorique): ExportHistorique {
  const nomComplet = l.prenom !== null && l.nom !== null ? `${l.prenom} ${l.nom}` : null;
  return {
    id: l.id,
    genereLe: l.genere_le_iso,
    periodeDu: l.periode_debut,
    periodeAu: l.periode_fin,
    cible: l.cible,
    granularite: l.mode,
    statut: l.statut,
    nbEcritures: l.nb_ecritures,
    totalDebitCentimes: Number(l.total_debit),
    totalCreditCentimes: Number(l.total_credit),
    nbFactures: l.nb_factures,
    nbAvoirs: l.nb_avoirs,
    nbEncaissements: l.nb_encaissements,
    totalHtCentimes: enNombre(l.total_ht),
    totalTvaCentimes: enNombre(l.total_tva),
    totalTtcCentimes: enNombre(l.total_ttc),
    plageNumeros: {
      factures: plage(l.facture_premier, l.facture_dernier),
      avoirs: plage(l.avoir_premier, l.avoir_dernier),
    },
    genereParId: l.genere_par_id,
    genereParNom: nomComplet,
    empreinteSha256: l.empreinte_sha256,
    nomFichier: l.nom_fichier,
    fichierDisponible: l.nom_fichier !== null,
  };
}
