/**
 * Cycle de vie de `dossier_reprise` — création, lecture, liste paginée, annulation, et le petit
 * utilitaire de transition (`transiter`) réutilisé par les autres services du module (dépôt,
 * analyse, plan, import) pour faire progresser la machine à états du dossier dans LA MÊME
 * transaction que leur propre écriture (jamais deux commits séparés pour « j'ai fini » + « je
 * fais avancer le dossier »).
 */

import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  type EntreeCreationDossierReprise,
  type FiltresDossiersReprise,
  type PageDossierReprise,
  type ReponseCreationDossierReprise,
  type ReponseDossierReprise,
  type StatutDossierReprise,
  TAILLE_TRANCHE_RECOMMANDEE_OCTETS_DEFAUT,
} from '@dfa/shared';

import { JETON_DB, type AccesBase, type ContexteTenant, type TransactionDfa } from '../db';
import { ErreurMetier } from '../common/erreurs';
import {
  type ReponseMemorisable,
  type ResultatIdempotent,
  type ServiceIdempotence,
} from '../common/idempotence';
import { JETON_IDEMPOTENCE } from '../common/idempotence';

import { type LigneDossierRepriseBrute, projeterDossierReprise } from './db-reprise.types';
import { JETON_STOCKAGE_ARCHIVE_REPRISE } from './reprise.jetons';
import type { PortStockageArchiveReprise } from './depot/stockage-archive-reprise';
import { annulationRecevable, transitionAutorisee } from './transitions-dossier-reprise';

export interface ReponseDossierRepriseMemorisable extends ReponseMemorisable {
  readonly corps: ReponseCreationDossierReprise;
}

async function lireLigneDossier(
  tx: TransactionDfa,
  tenantId: string,
  dossierId: string,
): Promise<LigneDossierRepriseBrute | null> {
  const resultat = await tx.execute<LigneDossierRepriseBrute>(sql`
    select
      d.*,
      d.cree_le::text as cree_le, d.modifie_le::text as modifie_le,
      d.purgee_le::text as purgee_le, d.annule_le::text as annule_le,
      a.id as analyse_id, p.id as plan_id, i.id as import_id,
      -- Une fois l'intégrité vérifiée (ServiceDepotReprise.finaliser), les tranches sont purgées
      -- (défaut 2) : sommer reprise_tranche rendrait alors 0 pour un dossier pourtant COMPLET.
      -- finaliser() exige déjà octets_recus = taille_octets_annoncee avant de valider l'intégrité,
      -- donc ce repli est exact, pas une approximation — voir ServiceDepotReprise.sommeOctets.
      coalesce(
        case when d.integrite_validee then d.taille_octets_annoncee
             else (select sum(t.taille_octets) from public.reprise_tranche t
                    where t.tenant_id = ${tenantId} and t.dossier_reprise_id = d.id)
        end, 0)::text as octets_recus
    from public.dossier_reprise d
    left join public.reprise_analyse a on a.tenant_id = d.tenant_id and a.dossier_reprise_id = d.id
    left join public.reprise_plan    p on p.tenant_id = d.tenant_id and p.dossier_reprise_id = d.id
    left join public.reprise_import  i on i.tenant_id = d.tenant_id and i.dossier_reprise_id = d.id
    where d.tenant_id = ${tenantId} and d.id = ${dossierId}
  `);
  return resultat.rows[0] ?? null;
}

function exigerLigneDossier(
  ligne: LigneDossierRepriseBrute | null,
  dossierId: string,
): LigneDossierRepriseBrute {
  if (ligne === null) {
    throw new ErreurMetier(
      'RESSOURCE_INTROUVABLE',
      `Dossier de reprise ${dossierId} introuvable pour ce tenant.`,
    );
  }
  return ligne;
}

@Injectable()
export class ServiceCycleVieDossierReprise {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_IDEMPOTENCE) private readonly idempotence: ServiceIdempotence,
    @Inject(JETON_STOCKAGE_ARCHIVE_REPRISE) private readonly stockage: PortStockageArchiveReprise,
  ) {}

  async creer(
    ctx: ContexteTenant,
    entree: EntreeCreationDossierReprise,
    cleIdempotence: string,
  ): Promise<ResultatIdempotent<ReponseDossierRepriseMemorisable>> {
    if (ctx.utilisateurId === null) {
      throw new ErreurMetier(
        'ERREUR_INTERNE',
        'ServiceCycleVieDossierReprise.creer exige un utilisateur authentifié.',
      );
    }
    const utilisateurId = ctx.utilisateurId;

    return this.idempotence.executer(
      ctx,
      { methode: 'POST', chemin: '/reprise/dossiers', cle: cleIdempotence, corps: entree },
      async (tx) => {
        const id = randomUUID();
        const racine = this.stockage.racineDossier(ctx.tenantId, id);
        const empreinte = Buffer.from(entree.empreinteSha256Annoncee, 'hex');

        const resultat = await tx.execute<LigneDossierRepriseBrute>(sql`
          insert into public.dossier_reprise
            (id, tenant_id, statut, taille_octets_annoncee, empreinte_sha256_annoncee,
             nom_archive_original, stockage_chemin, cree_par_id)
          values
            (${id}, ${ctx.tenantId}, 'depot_en_cours', ${entree.tailleOctetsAnnoncee}, ${empreinte},
             ${entree.nomArchiveOriginal ?? null}, ${racine}, ${utilisateurId})
          returning *, cree_le::text as cree_le, modifie_le::text as modifie_le,
                    purgee_le::text as purgee_le, annule_le::text as annule_le
        `);
        const ligne = resultat.rows[0];
        if (ligne === undefined) {
          throw new ErreurMetier(
            'ERREUR_INTERNE',
            `Échec de création du dossier de reprise ${id}.`,
          );
        }

        const corps: ReponseCreationDossierReprise = {
          dossier: projeterDossierReprise(ligne, 0),
          tailleTrancheRecommandeeOctets: TAILLE_TRANCHE_RECOMMANDEE_OCTETS_DEFAUT,
        };
        return { statutHttp: 201, corps };
      },
    );
  }

  async lire(ctx: ContexteTenant, dossierId: string): Promise<ReponseDossierReprise> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = exigerLigneDossier(
        await lireLigneDossier(tx, ctx.tenantId, dossierId),
        dossierId,
      );
      return projeterDossierReprise(ligne, Number(ligne.octets_recus ?? '0'));
    });
  }

  async lister(ctx: ContexteTenant, filtres: FiltresDossiersReprise): Promise<PageDossierReprise> {
    return this.acces.enTenant(ctx, async (tx) => {
      const limite = filtres.limite;
      const descendant = filtres.tri !== 'creeLe:asc';
      const curseur = filtres.curseur ? decoderCurseurSimple(filtres.curseur) : null;
      const statuts = filtres.statut;

      const conditionStatut =
        statuts && statuts.length > 0
          ? sql`and d.statut = any(${sql`array[${sql.join(
              statuts.map((s) => sql`${s}`),
              sql`, `,
            )}]`}::public.statut_dossier_reprise[])`
          : sql``;

      const conditionCurseur = curseur
        ? descendant
          ? sql`and (d.cree_le, d.id) < (${curseur.creeLe}::timestamptz, ${curseur.id})`
          : sql`and (d.cree_le, d.id) > (${curseur.creeLe}::timestamptz, ${curseur.id})`
        : sql``;

      const ordre = descendant ? sql`d.cree_le desc, d.id desc` : sql`d.cree_le asc, d.id asc`;

      const resultat = await tx.execute<LigneDossierRepriseBrute>(sql`
        select d.*, d.cree_le::text as cree_le, d.modifie_le::text as modifie_le,
               d.purgee_le::text as purgee_le, d.annule_le::text as annule_le,
               a.id as analyse_id, p.id as plan_id, i.id as import_id,
               -- Voir le commentaire équivalent de lireLigneDossier ci-dessus.
               coalesce(
                 case when d.integrite_validee then d.taille_octets_annoncee
                      else (select sum(t.taille_octets) from public.reprise_tranche t
                             where t.tenant_id = d.tenant_id and t.dossier_reprise_id = d.id)
                 end, 0)::text as octets_recus
          from public.dossier_reprise d
          left join public.reprise_analyse a on a.tenant_id = d.tenant_id and a.dossier_reprise_id = d.id
          left join public.reprise_plan    p on p.tenant_id = d.tenant_id and p.dossier_reprise_id = d.id
          left join public.reprise_import  i on i.tenant_id = d.tenant_id and i.dossier_reprise_id = d.id
         where d.tenant_id = ${ctx.tenantId}
               ${conditionStatut}
               ${conditionCurseur}
         order by ${ordre}
         limit ${limite + 1}
      `);

      const aSuivant = resultat.rows.length > limite;
      const lignes = resultat.rows.slice(0, limite);
      const donnees = lignes.map((l) => projeterDossierReprise(l, Number(l.octets_recus ?? '0')));
      const dernier = lignes.at(-1);
      const curseurSuivant =
        aSuivant && dernier
          ? encoderCurseurSimple({ creeLe: dernier.cree_le, id: dernier.id })
          : null;

      return { donnees, curseurSuivant, limite };
    });
  }

  async annuler(
    ctx: ContexteTenant,
    dossierId: string,
    motif: string,
  ): Promise<ReponseDossierReprise> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = exigerLigneDossier(
        await lireLigneDossier(tx, ctx.tenantId, dossierId),
        dossierId,
      );
      if (!annulationRecevable(ligne.statut)) {
        throw new ErreurMetier(
          'REPRISE_DOSSIER_TRANSITION_INTERDITE',
          `Annulation impossible depuis l'état « ${ligne.statut} » (dossier ${dossierId}).`,
        );
      }

      const resultat = await tx.execute<LigneDossierRepriseBrute>(sql`
        update public.dossier_reprise
           set statut = 'annule', annule_le = now(), annule_motif = ${motif},
               -- Défaut 3 (mandat reprise) : les tranches vont être purgées ci-dessous (RGPD/nLPD).
               -- Si l'archive n'avait JAMAIS été intégralement vérifiée (integrite_validee pas
               -- true), dernier_numero_tranche_recu_contigu devient trompeur une fois les tranches
               -- disparues — un instantané qui affiche encore « 142 » alors qu'aucune tranche n'est
               -- plus retenue nulle part. On l'aligne sur octets_recus (qui retombera à 0, voir
               -- lireLigneDossier/lister ci-dessus). Si l'archive AVAIT été vérifiée avant
               -- l'annulation, integrite_validee reste true et octets_recus continue de rendre
               -- taille_octets_annoncee : ce champ reste alors une métadonnée cohérente, inutile de
               -- l'effacer.
               dernier_numero_tranche_recu_contigu =
                 case when integrite_validee then dernier_numero_tranche_recu_contigu else null end
         where tenant_id = ${ctx.tenantId} and id = ${dossierId}
        returning *, cree_le::text as cree_le, modifie_le::text as modifie_le,
                  purgee_le::text as purgee_le, annule_le::text as annule_le
      `);
      const apres = resultat.rows[0];
      if (apres === undefined) {
        throw new ErreurMetier('ERREUR_INTERNE', `Échec d'annulation du dossier ${dossierId}.`);
      }

      // Purge immédiate — données personnelles, un dossier annulé n'a plus vocation à conserver
      // les tranches déposées. Best-effort disque APRÈS le commit logique (la ligne base fait foi
      // même si la purge disque échoue — rejouable par un job de rattrapage, hors périmètre ici).
      await tx.execute(sql`
        delete from public.reprise_tranche where tenant_id = ${ctx.tenantId} and dossier_reprise_id = ${dossierId}
      `);
      await this.stockage.purgerDossier(ligne.stockage_chemin).catch(() => undefined);
      await tx.execute(sql`
        update public.dossier_reprise set purgee_le = now()
         where tenant_id = ${ctx.tenantId} and id = ${dossierId}
      `);

      // Défaut 3 (suite) : après purge, octets_recus doit suivre EXACTEMENT la même règle que
      // lireLigneDossier/lister (sinon la réponse de CET appel contredirait le prochain GET) —
      // taille_octets_annoncee si l'archive avait été intégralement vérifiée avant l'annulation
      // (métadonnée encore significative), 0 sinon (rien n'est plus retenu, cohérent avec
      // dernier_numero_tranche_recu_contigu remis à null juste au-dessus).
      const octetsRecusApres = apres.integrite_validee ? Number(apres.taille_octets_annoncee) : 0;
      return projeterDossierReprise(apres, octetsRecusApres);
    });
  }

  /**
   * Fait progresser `dossier_reprise.statut`, sous garde de `transitionAutorisee`, DANS la
   * transaction `tx` fournie par l'appelant (dépôt/analyse/plan/import) — jamais une transaction
   * séparée : l'écriture du service appelant et la transition du dossier commitent ensemble.
   */
  async transiter(
    tx: TransactionDfa,
    tenantId: string,
    dossierId: string,
    vers: StatutDossierReprise,
    assignationsSupplementaires: ReturnType<typeof sql>[] = [],
  ): Promise<LigneDossierRepriseBrute> {
    const ligne = exigerLigneDossier(await lireLigneDossier(tx, tenantId, dossierId), dossierId);
    if (!transitionAutorisee(ligne.statut, vers)) {
      throw new ErreurMetier(
        'REPRISE_DOSSIER_TRANSITION_INTERDITE',
        `Transition ${ligne.statut} → ${vers} interdite pour le dossier ${dossierId}.`,
      );
    }

    const assignations = [sql`statut = ${vers}`, ...assignationsSupplementaires];
    const resultat = await tx.execute<LigneDossierRepriseBrute>(sql`
      update public.dossier_reprise
         set ${sql.join(assignations, sql`, `)}
       where tenant_id = ${tenantId} and id = ${dossierId}
      returning *, cree_le::text as cree_le, modifie_le::text as modifie_le,
                purgee_le::text as purgee_le, annule_le::text as annule_le
    `);
    const apres = resultat.rows[0];
    if (apres === undefined) {
      throw new ErreurMetier(
        'ERREUR_INTERNE',
        `Échec de transition ${ligne.statut} → ${vers} pour le dossier ${dossierId}.`,
      );
    }
    return apres;
  }

  async ligneBrute(
    tx: TransactionDfa,
    tenantId: string,
    dossierId: string,
  ): Promise<LigneDossierRepriseBrute> {
    return exigerLigneDossier(await lireLigneDossier(tx, tenantId, dossierId), dossierId);
  }
}

// ---------------------------------------------------------------------------------------------
// Curseur v1 minimal — (creeLe, id), même forme que `common/pagination/curseur.ts` mais copié
// localement pour ne dépendre que de deux champs (contrat reprise n'expose que deux tris,
// creeLe:desc/asc, sur la MÊME colonne) plutôt que de la mécanique v2 triable multi-colonnes.
// ---------------------------------------------------------------------------------------------

function encoderCurseurSimple(donnees: { readonly creeLe: string; readonly id: string }): string {
  const brut = JSON.stringify({ c: new Date(donnees.creeLe).toISOString(), i: donnees.id });
  return Buffer.from(brut, 'utf8').toString('base64url');
}

function decoderCurseurSimple(curseur: string): { readonly creeLe: string; readonly id: string } {
  let objet: unknown;
  try {
    objet = JSON.parse(Buffer.from(curseur, 'base64url').toString('utf8'));
  } catch {
    throw erreurCurseurInvalide();
  }
  if (
    typeof objet !== 'object' ||
    objet === null ||
    typeof (objet as { c?: unknown }).c !== 'string' ||
    typeof (objet as { i?: unknown }).i !== 'string'
  ) {
    throw erreurCurseurInvalide();
  }
  const { c, i } = objet as { c: string; i: string };
  if (Number.isNaN(new Date(c).getTime())) throw erreurCurseurInvalide();
  return { creeLe: c, id: i };
}

function erreurCurseurInvalide(): ErreurMetier {
  return new ErreurMetier('VALIDATION_ECHOUEE', 'Curseur de pagination invalide.', {
    erreurs: [{ champ: 'curseur', code: 'curseur_invalide', message: 'Curseur illisible.' }],
  });
}
