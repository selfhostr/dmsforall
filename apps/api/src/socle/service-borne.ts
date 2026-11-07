/**
 * Bornes d'atelier (comptes de service `poste_atelier`) gérées par le garage lui-même.
 *
 * Jusqu'ici une borne ne pouvait être créée que par `db/seed/seed-dev.ts`. Une borne est un
 * compte `utilisateur` ordinaire (voir `auth/comptes-de-service.ts`) rattaché à UN site, qui se
 * connecte avec un identifiant et un mot de passe générés ici et rendus UNE SEULE FOIS. Les PIN de
 * pointage ne sont pas gérés ici : ils sont par technicien (`PUT /pointage/pins`).
 *
 * Même doctrine que `ServiceUtilisateur` : le tenant vient du `ContexteTenant` (session), jamais
 * d'un paramètre ; chaque requête filtre explicitement `tenant_id` ET `role = 'poste_atelier'`
 * (l'id d'une personne est un 404 ici, comme l'id d'une borne l'est côté employés).
 */
import { randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, getTableColumns, inArray, isNull, sql } from 'drizzle-orm';
import {
  TRI_DEFAUT_CREATION,
  type BorneResume,
  type EntreeCreationBorne,
  type PageBorneResume,
  type ReponseAccesTemporaire,
  type ReponseCreationBorne,
} from '@dfa/shared';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import { JETON_DB } from '../db/db.jetons';
import { auditUtilisateur, session, site, utilisateur, type LigneUtilisateur } from '../db/schema';
import {
  decoderCurseurTrie,
  encoderCurseurTrie,
  valeurCurseurTimestamptz,
} from '../common/pagination';
import { ErreurMetier } from '../common/erreurs';
import { remonterCauseParCode } from '../common/erreurs-pg';
import { genererMotDePasseTemporaire } from '../auth/generateur-mot-de-passe-temporaire';
import { JETON_SERVICE_MOT_DE_PASSE } from '../auth/jetons';
import type { ServiceMotDePasse } from '../auth/auth.types';

const SQLSTATE_UNICITE = '23505';
/** `.invalid` est réservé (RFC 2606) : l'identifiant ne peut jamais recevoir de courriel. */
const DOMAINE_IDENTIFIANT_BORNE = 'bornes.dmsforall.invalid';

export interface ParametresListeBornes {
  readonly limite: number;
  readonly curseur?: string;
}

type SiteRef = { readonly id: string; readonly nom: string };

@Injectable()
export class ServiceBorne {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_SERVICE_MOT_DE_PASSE) private readonly motDePasse: ServiceMotDePasse,
  ) {}

  async lister(ctx: ContexteTenant, params: ParametresListeBornes): Promise<PageBorneResume> {
    const { limite } = params;
    let curseur: { creeLeTexte: string; id: string } | null = null;
    if (params.curseur) {
      const donnees = decoderCurseurTrie(params.curseur, TRI_DEFAUT_CREATION, 'temporel');
      if (typeof donnees.valeur !== 'string') {
        throw new ErreurMetier('VALIDATION_ECHOUEE', 'Curseur de pagination invalide.');
      }
      curseur = { creeLeTexte: donnees.valeur, id: donnees.id };
    }

    return this.acces.enTenant(ctx, async (tx) => {
      const conditionBase = and(
        eq(utilisateur.tenantId, ctx.tenantId),
        eq(utilisateur.role, 'poste_atelier'),
      );
      const conditionCurseur = curseur
        ? sql`(${utilisateur.creeLe}, ${utilisateur.id}) < (${curseur.creeLeTexte}::timestamptz, ${curseur.id})`
        : undefined;
      const lignes = await tx
        .select({
          ...getTableColumns(utilisateur),
          creeLeTexte: sql<string>`${utilisateur.creeLe}::text`,
        })
        .from(utilisateur)
        .where(conditionCurseur ? and(conditionBase, conditionCurseur) : conditionBase)
        .orderBy(desc(utilisateur.creeLe), desc(utilisateur.id))
        .limit(limite + 1);

      const aSuite = lignes.length > limite;
      const page = aSuite ? lignes.slice(0, limite) : lignes;
      const derniere = page[page.length - 1];
      const sites = await this.chargerSites(
        tx,
        ctx,
        page.map((l) => l.siteId),
      );

      return {
        donnees: page.map((l) => versBorneResume(l, sites.get(l.siteId ?? '') ?? null)),
        curseurSuivant:
          aSuite && derniere
            ? encoderCurseurTrie({
                tri: TRI_DEFAUT_CREATION,
                valeur: valeurCurseurTimestamptz(derniere.creeLeTexte),
                id: derniere.id,
              })
            : null,
        limite,
      };
    });
  }

  async creer(ctx: ContexteTenant, entree: EntreeCreationBorne): Promise<ReponseCreationBorne> {
    const motDePasseClair = genererMotDePasseTemporaire();
    const motDePasseHash = await this.motDePasse.hacher(motDePasseClair);
    const identifiant = `borne-${randomBytes(4).toString('hex')}@${DOMAINE_IDENTIFIANT_BORNE}`;

    return this.acces.enTenant(ctx, async (tx) => {
      const sites = await this.chargerSites(tx, ctx, [entree.siteId]);
      const siteTrouve = sites.get(entree.siteId);
      if (!siteTrouve) {
        throw new ErreurMetier('VALIDATION_ECHOUEE', 'Site introuvable pour ce tenant.', {
          erreurs: [
            {
              champ: 'siteId',
              code: 'site_introuvable',
              message: `Site ${entree.siteId} introuvable pour ce tenant.`,
            },
          ],
        });
      }

      let ligne: LigneUtilisateur | undefined;
      try {
        [ligne] = await tx
          .insert(utilisateur)
          .values({
            tenantId: ctx.tenantId,
            email: identifiant,
            motDePasseHash,
            prenom: 'Borne',
            nom: entree.nom,
            role: 'poste_atelier',
            siteId: entree.siteId,
            statut: 'actif',
          })
          .returning();
      } catch (erreur) {
        if (remonterCauseParCode(erreur, SQLSTATE_UNICITE) !== null) {
          throw new ErreurMetier('CONFLIT', 'Identifiant de borne déjà pris, réessayez.');
        }
        throw erreur;
      }
      if (!ligne) throw new ErreurMetier('ERREUR_INTERNE', 'Échec de la création de la borne.');

      await this.ecrireAudit(tx, ctx, ligne.id, 'creation', null, {
        role: 'poste_atelier',
        siteId: entree.siteId,
        statut: 'actif',
      });

      return {
        borne: versBorneResume(ligne, siteTrouve),
        acces: { motDePasseTemporaire: motDePasseClair },
      };
    });
  }

  /** Désactive la borne et révoque ses sessions (longue durée) : sinon la tablette resterait
   *  connectée jusqu'à l'expiration de sa session. */
  async desactiver(ctx: ContexteTenant, borneId: string): Promise<BorneResume> {
    return this.basculer(ctx, borneId, 'suspendu', 'desactivation');
  }

  async reactiver(ctx: ContexteTenant, borneId: string): Promise<BorneResume> {
    return this.basculer(ctx, borneId, 'actif', 'reactivation');
  }

  /** Nouveau mot de passe (tablette remplacée ou mot de passe perdu) ; sessions révoquées. */
  async reinitialiserAcces(ctx: ContexteTenant, borneId: string): Promise<ReponseAccesTemporaire> {
    const motDePasseClair = genererMotDePasseTemporaire();
    const motDePasseHash = await this.motDePasse.hacher(motDePasseClair);

    await this.acces.enTenant(ctx, async (tx) => {
      await this.chargerBorne(tx, ctx, borneId);
      await tx
        .update(utilisateur)
        .set({ motDePasseHash, echecsConnexion: 0, verrouilleJusquA: null })
        .where(this.conditionBorne(ctx, borneId));
      await this.revoquerSessions(tx, ctx, borneId);
      await this.ecrireAudit(tx, ctx, borneId, 'reinitialisation_acces', null, null);
    });
    return { motDePasseTemporaire: motDePasseClair };
  }

  // -----------------------------------------------------------------------------------------

  private conditionBorne(ctx: ContexteTenant, borneId: string) {
    return and(
      eq(utilisateur.tenantId, ctx.tenantId),
      eq(utilisateur.id, borneId),
      eq(utilisateur.role, 'poste_atelier'),
    );
  }

  private async basculer(
    ctx: ContexteTenant,
    borneId: string,
    statutCible: 'actif' | 'suspendu',
    action: 'desactivation' | 'reactivation',
  ): Promise<BorneResume> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await this.chargerBorne(tx, ctx, borneId);
      if (ligne.statut !== statutCible) {
        await tx
          .update(utilisateur)
          .set({ statut: statutCible })
          .where(this.conditionBorne(ctx, borneId));
        if (statutCible === 'suspendu') await this.revoquerSessions(tx, ctx, borneId);
        await this.ecrireAudit(
          tx,
          ctx,
          borneId,
          action,
          { statut: ligne.statut },
          { statut: statutCible },
        );
      }
      const finale = await this.chargerBorne(tx, ctx, borneId);
      const sites = await this.chargerSites(tx, ctx, [finale.siteId]);
      return versBorneResume(finale, sites.get(finale.siteId ?? '') ?? null);
    });
  }

  private async chargerBorne(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    borneId: string,
  ): Promise<LigneUtilisateur> {
    const [ligne] = await tx
      .select()
      .from(utilisateur)
      .where(this.conditionBorne(ctx, borneId))
      .limit(1);
    // 404, jamais 403 : une borne d'un autre tenant, ou un compte de personne, n'existe pas ici.
    if (!ligne) throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Borne introuvable.');
    return ligne;
  }

  private async chargerSites(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    siteIds: ReadonlyArray<string | null>,
  ): Promise<Map<string, SiteRef>> {
    const ids = [...new Set(siteIds.filter((id): id is string => id !== null))];
    const resultat = new Map<string, SiteRef>();
    if (ids.length === 0) return resultat;
    const lignes = await tx
      .select({ id: site.id, nom: site.nom })
      .from(site)
      .where(and(eq(site.tenantId, ctx.tenantId), inArray(site.id, ids)));
    for (const l of lignes) resultat.set(l.id, l);
    return resultat;
  }

  private async revoquerSessions(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    borneId: string,
  ): Promise<void> {
    await tx
      .update(session)
      .set({ revoqueeLe: new Date() })
      .where(
        and(
          eq(session.tenantId, ctx.tenantId),
          eq(session.utilisateurId, borneId),
          isNull(session.revoqueeLe),
        ),
      );
  }

  private async ecrireAudit(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    borneId: string,
    action: 'creation' | 'desactivation' | 'reactivation' | 'reinitialisation_acces',
    avant: Record<string, unknown> | null,
    apres: Record<string, unknown> | null,
  ): Promise<void> {
    if (!ctx.utilisateurId) {
      throw new ErreurMetier(
        'ERREUR_INTERNE',
        'Geste de gestion de borne sans acteur identifié — audit impossible.',
      );
    }
    await tx.insert(auditUtilisateur).values({
      tenantId: ctx.tenantId,
      utilisateurCibleId: borneId,
      actionParId: ctx.utilisateurId,
      action,
      avant,
      apres,
    });
  }
}

function versBorneResume(ligne: LigneUtilisateur, siteRef: SiteRef | null): BorneResume {
  return {
    id: ligne.id,
    nom: ligne.nom,
    identifiant: ligne.email,
    // Invariant en base (`utilisateur_site_compte_de_service_chk`) : une borne a toujours un site.
    site: siteRef ?? { id: ligne.siteId ?? '', nom: '' },
    statut: ligne.statut,
    derniereConnexionLe: ligne.derniereConnexionLe ? ligne.derniereConnexionLe.toISOString() : null,
    creeLe: ligne.creeLe.toISOString(),
  };
}
