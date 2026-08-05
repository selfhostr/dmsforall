import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type {
  EntreeChangementSaisonDepotPneus,
  EntreeCreationDepotPneus,
  EntreeSortieDepotPneus,
  FiltresARelancerPneus,
  FiltresDepotsPneusVehicule,
  FiltresHangarPneus,
  PageCurseur,
  ReponseDepotPneus,
  RoleUtilisateur,
  SaisonPneu,
} from '@dfa/shared';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import { JETON_DB } from '../db';
import { depotPneus, site, vehicule } from '../db/schema';
import type { LigneDepotPneus, NouveauDepotPneus } from '../db/schema';
import { remonterCausePg } from '../common/erreurs-pg/remonter-cause-pg';
import { ErreurMetier } from '../common/erreurs';
import { JETON_IDEMPOTENCE } from '../common/idempotence';
import type {
  ReponseMemorisable,
  ResultatIdempotent,
  ServiceIdempotence,
} from '../common/idempotence';

import {
  ROLES_PNEUS_DEPOT_ECRITURE,
  ROLES_PNEUS_DEPOT_LECTURE,
  verifierRoleAutorise,
} from './droits-provisoires';
import { versDepotPneusResponse } from './mappers';
import {
  construireConditionKeyset,
  construireOrderBy,
  decoderCurseurPourTri,
  encoderCurseurTrie,
  expressionTriValeur,
  valeurCurseurDepuisTri,
  type DefinitionTri,
} from './pagination-triee';

/**
 * Délai par défaut avant relance automatique d'un jeu oublié (RPP-04). La spec (§3) propose un
 * paramètre PAR SITE (`delai_relance_mois`) — aucune table de paramétrage pneus n'existe encore
 * (hors périmètre de ce lot, signalé au rapport de livraison) : valeur FIXE, le défaut proposé
 * par la spec (24 mois). À rendre paramétrable par site quand `parametrage_pneus` (ou équivalent)
 * existera.
 */
const DELAI_RELANCE_MOIS_DEFAUT = 24;

const COLONNES_DEPOT_ALIASEES = sql`
  d.id as "id", d.vehicule_id as "vehiculeId", d.site_id as "siteId", d.saison as "saison",
  d.statut as "statut", d.code_case as "codeCase", d.dimension as "dimension", d.etat as "etat",
  d.entre_le as "entreLe", d.dernier_mouvement_le as "dernierMouvementLe",
  d.motif_sortie as "motifSortie", d.ligne_or_dernier_changement_id as "ligneOrDernierChangementId",
  d.cree_le as "creeLe", d.modifie_le as "modifieLe"
`;

const DEFINITIONS_TRI_HANGAR: Readonly<Record<FiltresHangarPneus['tri'], DefinitionTri>> = {
  'dernierMouvementLe:desc': {
    expression: sql`d.dernier_mouvement_le`,
    sens: 'desc',
    nullable: false,
    temporel: true,
  },
  'dernierMouvementLe:asc': {
    expression: sql`d.dernier_mouvement_le`,
    sens: 'asc',
    nullable: false,
    temporel: true,
  },
  'entreLe:desc': { expression: sql`d.entre_le`, sens: 'desc', nullable: false, temporel: true },
  'entreLe:asc': { expression: sql`d.entre_le`, sens: 'asc', nullable: false, temporel: true },
};

const DEFINITIONS_TRI_VEHICULE: Readonly<Record<FiltresDepotsPneusVehicule['tri'], DefinitionTri>> =
  {
    'entreLe:desc': { expression: sql`d.entre_le`, sens: 'desc', nullable: false, temporel: true },
    'entreLe:asc': { expression: sql`d.entre_le`, sens: 'asc', nullable: false, temporel: true },
  };

const DEFINITIONS_TRI_RELANCE: Readonly<Record<FiltresARelancerPneus['tri'], DefinitionTri>> = {
  'dernierMouvementLe:desc': {
    expression: sql`d.dernier_mouvement_le`,
    sens: 'desc',
    nullable: false,
    temporel: true,
  },
  'dernierMouvementLe:asc': {
    expression: sql`d.dernier_mouvement_le`,
    sens: 'asc',
    nullable: false,
    temporel: true,
  },
};

export interface ResultatCreationDepotPneus {
  readonly statutHttp: number;
  readonly corps: ReponseDepotPneus;
}

/**
 * Service hangar à pneus (`docs/specification-parc-et-hangar-pneus.md`, RPP-01 → RPP-08).
 *
 * Droits PROVISOIRES (voir `droits-provisoires.ts`, tête de fichier) : `verifierRoleAutorise` est
 * appelée en tout DÉBUT de chaque méthode publique, avant tout accès base — même doctrine que
 * `tableau-bord/service-tableau-bord-activite.ts`.
 */
@Injectable()
export class ServiceDepotPneus {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_IDEMPOTENCE) private readonly idempotence: ServiceIdempotence,
  ) {}

  /** `GET /sites/{siteId}/hangar-pneus` — vue hangar (spec §5, §6). */
  async hangar(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    siteId: string,
    params: FiltresHangarPneus,
  ): Promise<PageCurseur<ReponseDepotPneus>> {
    verifierRoleAutorise(role, ROLES_PNEUS_DEPOT_LECTURE, 'pneus.depot.lire');
    const definition = DEFINITIONS_TRI_HANGAR[params.tri];
    const idExpr = sql`d.id`;
    const curseurDecode = decoderCurseurPourTri(params.curseur, params.tri);

    return this.acces.enTenant(ctx, async (tx) => {
      await this.chargerSiteOu404(tx, ctx, siteId);
      await this.appliquerRelancesEnRetard(tx, ctx);

      const conditions = [sql`d.tenant_id = ${ctx.tenantId}`, sql`d.site_id = ${siteId}`];
      if (params.statut && params.statut.length > 0) {
        conditions.push(
          sql`d.statut::text in (${sql.join(
            params.statut.map((s) => sql`${s}`),
            sql`, `,
          )})`,
        );
      }
      if (params.saison) conditions.push(sql`d.saison = ${params.saison}`);
      if (curseurDecode) {
        conditions.push(
          construireConditionKeyset(definition, idExpr, curseurDecode.valeur, curseurDecode.id),
        );
      }

      const resultat = await tx.execute<
        LigneDepotPneus & { triValeur: string | number | null }
      >(sql`
        select ${COLONNES_DEPOT_ALIASEES}, ${expressionTriValeur(definition)} as "triValeur"
          from public.depot_pneus d
         where ${sql.join(conditions, sql` and `)}
         order by ${construireOrderBy(definition, idExpr)}
         limit ${params.limite + 1}
      `);
      return this.construireReponsePage(resultat.rows, params.limite, definition, params.tri);
    });
  }

  /** `GET /vehicules/{id}/depots-pneus` — historique COMPLET (tous statuts) d'un véhicule. */
  async parVehicule(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    vehiculeId: string,
    params: FiltresDepotsPneusVehicule,
  ): Promise<PageCurseur<ReponseDepotPneus>> {
    verifierRoleAutorise(role, ROLES_PNEUS_DEPOT_LECTURE, 'pneus.depot.lire');
    const definition = DEFINITIONS_TRI_VEHICULE[params.tri];
    const idExpr = sql`d.id`;
    const curseurDecode = decoderCurseurPourTri(params.curseur, params.tri);

    return this.acces.enTenant(ctx, async (tx) => {
      await this.chargerVehiculeOu404(tx, ctx, vehiculeId);
      await this.appliquerRelancesEnRetard(tx, ctx);

      const conditions = [sql`d.tenant_id = ${ctx.tenantId}`, sql`d.vehicule_id = ${vehiculeId}`];
      if (params.statut && params.statut.length > 0) {
        conditions.push(
          sql`d.statut::text in (${sql.join(
            params.statut.map((s) => sql`${s}`),
            sql`, `,
          )})`,
        );
      }
      if (curseurDecode) {
        conditions.push(
          construireConditionKeyset(definition, idExpr, curseurDecode.valeur, curseurDecode.id),
        );
      }

      const resultat = await tx.execute<
        LigneDepotPneus & { triValeur: string | number | null }
      >(sql`
        select ${COLONNES_DEPOT_ALIASEES}, ${expressionTriValeur(definition)} as "triValeur"
          from public.depot_pneus d
         where ${sql.join(conditions, sql` and `)}
         order by ${construireOrderBy(definition, idExpr)}
         limit ${params.limite + 1}
      `);
      return this.construireReponsePage(resultat.rows, params.limite, definition, params.tri);
    });
  }

  /** `GET /depots-pneus/a-relancer` — jeux oubliés (RPP-04), site ou tenant entier. */
  async aRelancer(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    params: FiltresARelancerPneus,
  ): Promise<PageCurseur<ReponseDepotPneus>> {
    verifierRoleAutorise(role, ROLES_PNEUS_DEPOT_LECTURE, 'pneus.depot.lire');
    const definition = DEFINITIONS_TRI_RELANCE[params.tri];
    const idExpr = sql`d.id`;
    const curseurDecode = decoderCurseurPourTri(params.curseur, params.tri);

    return this.acces.enTenant(ctx, async (tx) => {
      if (params.siteId) await this.chargerSiteOu404(tx, ctx, params.siteId);
      await this.appliquerRelancesEnRetard(tx, ctx);

      const conditions = [sql`d.tenant_id = ${ctx.tenantId}`, sql`d.statut = 'a_relancer'`];
      if (params.siteId) conditions.push(sql`d.site_id = ${params.siteId}`);
      if (curseurDecode) {
        conditions.push(
          construireConditionKeyset(definition, idExpr, curseurDecode.valeur, curseurDecode.id),
        );
      }

      const resultat = await tx.execute<
        LigneDepotPneus & { triValeur: string | number | null }
      >(sql`
        select ${COLONNES_DEPOT_ALIASEES}, ${expressionTriValeur(definition)} as "triValeur"
          from public.depot_pneus d
         where ${sql.join(conditions, sql` and `)}
         order by ${construireOrderBy(definition, idExpr)}
         limit ${params.limite + 1}
      `);
      return this.construireReponsePage(resultat.rows, params.limite, definition, params.tri);
    });
  }

  /**
   * `POST /vehicules/{id}/depots-pneus` — entrée d'un jeu en dépôt. `Idempotency-Key`
   * obligatoire (création sensible, garde physique d'un bien du client). Refusé (`409 CONFLIT`)
   * si un jeu actif existe déjà pour ce véhicule et cette saison (RPP-02,
   * `depot_pneus_actif_uk`).
   */
  async creer(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    vehiculeId: string,
    entree: EntreeCreationDepotPneus,
    cleIdempotence: string,
  ): Promise<ResultatIdempotent<ResultatCreationDepotPneus & ReponseMemorisable>> {
    verifierRoleAutorise(role, ROLES_PNEUS_DEPOT_ECRITURE, 'pneus.depot.creer');
    return this.idempotence.executer(
      ctx,
      {
        methode: 'POST',
        chemin: '/vehicules/{id}/depots-pneus',
        cle: cleIdempotence,
        corps: { vehiculeId, ...entree },
      },
      async (tx) => {
        const vehiculeLigne = await this.chargerVehiculeOu404(tx, ctx, vehiculeId);
        await this.chargerSiteOu404(tx, ctx, entree.siteId);

        const dimensionRecopiee =
          entree.saison === 'ete' ? vehiculeLigne.pneusEte : vehiculeLigne.pneusHiver;
        const dimension = entree.dimension ?? dimensionRecopiee ?? null;

        const valeurs: NouveauDepotPneus = {
          tenantId: ctx.tenantId,
          vehiculeId,
          siteId: entree.siteId,
          saison: entree.saison,
          codeCase: entree.codeCase ?? null,
          dimension,
          etat: entree.etat ?? null,
        };

        let ligne: LigneDepotPneus | undefined;
        try {
          const inserees = await tx.insert(depotPneus).values(valeurs).returning();
          ligne = inserees[0];
        } catch (erreur) {
          if (estViolationUniciteActif(erreur)) {
            throw new ErreurMetier(
              'CONFLIT',
              `Un jeu de pneus "${entree.saison}" est déjà en dépôt ou monté pour ce véhicule (RPP-02).`,
            );
          }
          throw erreur;
        }
        if (!ligne) {
          throw new ErreurMetier(
            'ERREUR_INTERNE',
            "La création du dépôt pneus n'a rendu aucune ligne.",
          );
        }
        return { statutHttp: 201, corps: versDepotPneusResponse(ligne) };
      },
    );
  }

  /**
   * `POST /depots-pneus/{id}/changer-saison` — RPP-03. Inverse `monte ↔ en_depot` du jeu visé ET
   * de son jumeau actif (même véhicule, saison opposée) s'il existe ; sinon, inverse seulement le
   * jeu visé (aucun jumeau jamais entré en dépôt).
   *
   * Verrouillage dans un ordre TOTAL (id croissant), jamais dans l'ordre où les lignes sont
   * découvertes : deux appels concurrents visant les deux moitiés de la MÊME paire été/hiver
   * verrouillent alors toujours dans le même ordre — ce qui exclut un deadlock symétrique
   * (A verrouille été puis attend hiver, B verrouille hiver puis attend été).
   */
  async changerSaison(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    depotId: string,
    entree: EntreeChangementSaisonDepotPneus,
  ): Promise<ReponseDepotPneus> {
    verifierRoleAutorise(role, ROLES_PNEUS_DEPOT_ECRITURE, 'pneus.depot.gerer');
    return this.acces.enTenant(ctx, async (tx) => {
      const cible = await this.chargerOu404(tx, ctx, depotId);
      if (cible.statut !== 'en_depot' && cible.statut !== 'monte') {
        throw new ErreurMetier(
          'CONFLIT',
          `Transition interdite : le dépôt est "${cible.statut}", ni "en_depot" ni "monte" (RPP-03).`,
        );
      }
      const saisonOpposee: SaisonPneu = cible.saison === 'ete' ? 'hiver' : 'ete';
      const jumeauCandidat = await this.trouverJumeauActif(
        tx,
        ctx,
        cible.vehiculeId,
        saisonOpposee,
      );

      const idsATrier = jumeauCandidat ? [depotId, jumeauCandidat.id].sort() : [depotId];
      const verrouilles = new Map<string, LigneDepotPneus>();
      for (const id of idsATrier) {
        // Verrouillage SÉQUENTIEL et ORDONNÉ (pas de Promise.all) : c'est exactement la
        // contrainte qui prévient le deadlock décrit dans le commentaire ci-dessus. `no-await-in-loop`
        // n'est pas activée dans ce dépôt (voir l'avertissement « directive inutile » constaté à
        // la vérification) ; le commentaire reste pour documenter l'intention au lecteur humain.
        const ligne = await this.chargerPourVerrouOu404(tx, ctx, id);
        verrouilles.set(id, ligne);
      }

      const cibleVerrouillee = verrouilles.get(depotId);
      if (
        !cibleVerrouillee ||
        (cibleVerrouillee.statut !== 'en_depot' && cibleVerrouillee.statut !== 'monte')
      ) {
        throw new ErreurMetier(
          'CONFLIT',
          'Transition interdite : le dépôt a changé de statut entre sa lecture et son verrouillage (RPP-03).',
        );
      }

      try {
        const nouveauStatutCible = cibleVerrouillee.statut === 'monte' ? 'en_depot' : 'monte';
        await tx.execute(sql`
          update public.depot_pneus
             set statut = ${nouveauStatutCible}, dernier_mouvement_le = now(),
                 ligne_or_dernier_changement_id = ${entree.ligneOrId ?? null}
           where tenant_id = ${ctx.tenantId} and id = ${depotId}
        `);

        const jumeauVerrouille = jumeauCandidat ? verrouilles.get(jumeauCandidat.id) : undefined;
        if (
          jumeauVerrouille &&
          (jumeauVerrouille.statut === 'en_depot' || jumeauVerrouille.statut === 'monte')
        ) {
          const nouveauStatutJumeau = jumeauVerrouille.statut === 'monte' ? 'en_depot' : 'monte';
          await tx.execute(sql`
            update public.depot_pneus
               set statut = ${nouveauStatutJumeau}, dernier_mouvement_le = now(),
                   ligne_or_dernier_changement_id = ${entree.ligneOrId ?? null}
             where tenant_id = ${ctx.tenantId} and id = ${jumeauVerrouille.id}
          `);
        }
      } catch (erreur) {
        if (estViolationFk(erreur)) {
          throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Ligne OR introuvable pour ce tenant.');
        }
        throw erreur;
      }

      const ligneMaj = await this.chargerOu404(tx, ctx, depotId);
      return versDepotPneusResponse(ligneMaj);
    });
  }

  /** `POST /depots-pneus/{id}/sortir` — RPP-05, statut TERMINAL, motif obligatoire. */
  async sortir(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    depotId: string,
    entree: EntreeSortieDepotPneus,
  ): Promise<ReponseDepotPneus> {
    verifierRoleAutorise(role, ROLES_PNEUS_DEPOT_ECRITURE, 'pneus.depot.gerer');
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await this.chargerPourVerrouOu404(tx, ctx, depotId);
      if (ligne.statut === 'sorti') {
        throw new ErreurMetier(
          'CONFLIT',
          'Transition interdite : ce dépôt est déjà "sorti" (RPP-05).',
        );
      }

      await tx.execute(sql`
        update public.depot_pneus
           set statut = 'sorti', motif_sortie = ${entree.motif}, dernier_mouvement_le = now()
         where tenant_id = ${ctx.tenantId} and id = ${depotId}
      `);

      const ligneMaj = await this.chargerOu404(tx, ctx, depotId);
      return versDepotPneusResponse(ligneMaj);
    });
  }

  /**
   * RPP-04 : bascule `en_depot → a_relancer` tout jeu sans mouvement depuis
   * `DELAI_RELANCE_MOIS_DEFAUT`. Appelée avant CHAQUE lecture de collection (hangar, historique
   * véhicule, liste à relancer) — pas de dépendance à un job planifié externe (aucun n'existe
   * encore dans ce dépôt, voir le rapport de livraison) : la transition applicative garantit que
   * `statut` reste correct pour tout lecteur, un vrai job BullMQ pourra appeler la même requête
   * en tâche de fond plus tard sans rien changer ici.
   */
  private async appliquerRelancesEnRetard(tx: TransactionDfa, ctx: ContexteTenant): Promise<void> {
    await tx.execute(sql`
      update public.depot_pneus
         set statut = 'a_relancer'
       where tenant_id = ${ctx.tenantId} and statut = 'en_depot'
         and dernier_mouvement_le < now() - make_interval(months => ${DELAI_RELANCE_MOIS_DEFAUT})
    `);
  }

  private async trouverJumeauActif(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    vehiculeId: string,
    saison: SaisonPneu,
  ): Promise<LigneDepotPneus | undefined> {
    const resultat = await tx.execute<LigneDepotPneus>(sql`
      select ${COLONNES_DEPOT_ALIASEES} from public.depot_pneus d
       where d.tenant_id = ${ctx.tenantId} and d.vehicule_id = ${vehiculeId}
         and d.saison = ${saison} and d.statut in ('en_depot', 'monte')
       limit 1
    `);
    return resultat.rows[0];
  }

  private async chargerOu404(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    depotId: string,
  ): Promise<LigneDepotPneus> {
    const resultat = await tx.execute<LigneDepotPneus>(sql`
      select ${COLONNES_DEPOT_ALIASEES} from public.depot_pneus d
       where d.tenant_id = ${ctx.tenantId} and d.id = ${depotId}
    `);
    const ligne = resultat.rows[0];
    if (!ligne) throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Dépôt de pneus introuvable.');
    return ligne;
  }

  /** `select … for update` : sérialise les transitions concurrentes sur la MÊME ligne. */
  private async chargerPourVerrouOu404(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    depotId: string,
  ): Promise<LigneDepotPneus> {
    const resultat = await tx.execute<LigneDepotPneus>(sql`
      select ${COLONNES_DEPOT_ALIASEES} from public.depot_pneus d
       where d.tenant_id = ${ctx.tenantId} and d.id = ${depotId}
       for update
    `);
    const ligne = resultat.rows[0];
    if (!ligne) throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Dépôt de pneus introuvable.');
    return ligne;
  }

  private async chargerVehiculeOu404(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    vehiculeId: string,
  ): Promise<{
    readonly id: string;
    readonly pneusEte: string | null;
    readonly pneusHiver: string | null;
  }> {
    const lignes = await tx
      .select({ id: vehicule.id, pneusEte: vehicule.pneusEte, pneusHiver: vehicule.pneusHiver })
      .from(vehicule)
      .where(and(eq(vehicule.tenantId, ctx.tenantId), eq(vehicule.id, vehiculeId)))
      .limit(1);
    const ligne = lignes[0];
    if (!ligne) throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Véhicule introuvable.');
    return ligne;
  }

  private async chargerSiteOu404(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    siteId: string,
  ): Promise<void> {
    const lignes = await tx
      .select({ id: site.id })
      .from(site)
      .where(and(eq(site.tenantId, ctx.tenantId), eq(site.id, siteId)))
      .limit(1);
    if (!lignes[0]) throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Site introuvable.');
  }

  private construireReponsePage(
    lignes: readonly (LigneDepotPneus & { triValeur: string | number | null })[],
    limite: number,
    definition: DefinitionTri,
    triDemande: string,
  ): PageCurseur<ReponseDepotPneus> {
    const aUnePageSuivante = lignes.length > limite;
    const pageLignes = aUnePageSuivante ? lignes.slice(0, limite) : lignes;
    const derniere = pageLignes[pageLignes.length - 1];

    return {
      donnees: pageLignes.map((l) => versDepotPneusResponse(l)),
      curseurSuivant:
        aUnePageSuivante && derniere
          ? encoderCurseurTrie({
              tri: triDemande,
              valeur: valeurCurseurDepuisTri(definition, derniere.triValeur),
              id: derniere.id,
            })
          : null,
      limite,
    };
  }
}

/**
 * `23505` = `unique_violation`. `depot_pneus_actif_uk` (index unique partiel, RPP-02) — comme
 * tout index unique, une violation cite son NOM en `constraint`. Exportée (comme
 * `ventes/service-reprise.ts::estViolationCleUnique`) pour un test unitaire direct de la
 * traduction SQLSTATE, sans construire une vraie violation en base.
 */
export function estViolationUniciteActif(erreur: unknown): boolean {
  const brute = remonterCausePg(erreur);
  return brute?.code === '23505' && brute.constraint === 'depot_pneus_actif_uk';
}

/** `23503` = `foreign_key_violation` — `ligneOrId` fourni mais introuvable pour ce tenant
 *  (`depot_pneus_fk_ligne_or_dernier_changement`, 0043). Exportée pour la même raison que
 *  `estViolationUniciteActif` ci-dessus. */
export function estViolationFk(erreur: unknown): boolean {
  return remonterCausePg(erreur)?.code === '23503';
}
