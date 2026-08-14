/**
 * Gestion des employés par le garage lui-même (issue #137) — jusqu'ici, un compte se créait
 * uniquement par insertion directe en base (`db/seed/seed-dev.ts`), aucun endpoint n'existait.
 *
 * Deux gardes de sécurité, dans cet ordre :
 *   1. `UtilisateurController` exige `socle.utilisateur.{lire,creer,modifier,desactiver,
 *      reinitialiser_acces}` (matrice-droits.ts) — seuls `direction` et `admin` les détiennent.
 *   2. CE service vérifie en plus, pour toute création/modification de rôle,
 *      `verifierAttributionRoleAutorisee` (`auth/gouvernance-roles.ts`) : `direction` ne peut
 *      jamais créer ni promouvoir un `admin`, même s'il détient par ailleurs le droit
 *      `socle.utilisateur.creer`/`.modifier` — la matrice dit QUI peut agir sur des comptes, cette
 *      fonction dit QUEL rôle il a le droit de leur donner.
 *
 * Le tenant ne vient JAMAIS d'un paramètre : chaque méthode reçoit `ContexteTenant`, construit
 * exclusivement depuis la session par `ServiceContexteRequete.contexteTenant()` — même doctrine
 * que `ServiceSite`/`ServiceTenant`.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, getTableColumns, inArray, isNull, ne, sql } from 'drizzle-orm';
import {
  TRI_DEFAUT_CREATION,
  type EntreeCreationUtilisateur,
  type EntreeModificationUtilisateur,
  type PageUtilisateurResume,
  type ReponseAccesTemporaire,
  type ReponseCreationUtilisateur,
  type RoleUtilisateur,
  type UtilisateurResume,
} from '@dfa/shared';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import { JETON_DB } from '../db/db.jetons';
import {
  auditUtilisateur,
  session,
  site,
  utilisateur,
  utilisateurSite,
  type LigneUtilisateur,
} from '../db/schema';
import {
  decoderCurseurTrie,
  encoderCurseurTrie,
  valeurCurseurTimestamptz,
} from '../common/pagination';
import { ErreurMetier } from '../common/erreurs';
import { remonterCauseParCode } from '../common/erreurs-pg';
import { genererMotDePasseTemporaire } from '../auth/generateur-mot-de-passe-temporaire';
import { verifierAttributionRoleAutorisee } from '../auth/gouvernance-roles';
import { JETON_SERVICE_MOT_DE_PASSE } from '../auth/jetons';
import type { ServiceMotDePasse } from '../auth/auth.types';

const SQLSTATE_UNICITE = '23505';

export interface ParametresListeUtilisateurs {
  readonly limite: number;
  readonly curseur?: string;
}

/**
 * `role != 'poste_atelier'` partout dans ce service : un compte de service (borne d'atelier) se
 * gère via `auth/comptes-de-service.ts`, un chemin distinct — il ne doit ni apparaître dans cette
 * liste d'employés, ni être manipulable par ces endpoints (id d'une borne = 404 ici, pas un
 * contournement du droit dédié aux comptes de service).
 */
const CONDITION_ROLE_PERSONNE = ne(utilisateur.role, 'poste_atelier');

function estViolationUnicite(erreur: unknown): boolean {
  return remonterCauseParCode(erreur, SQLSTATE_UNICITE) !== null;
}

function decoderCurseurUtilisateur(curseur: string): {
  readonly creeLeTexte: string;
  readonly id: string;
} {
  const donnees = decoderCurseurTrie(curseur, TRI_DEFAUT_CREATION, 'temporel');
  if (typeof donnees.valeur !== 'string') {
    throw new ErreurMetier('VALIDATION_ECHOUEE', 'Curseur de pagination invalide.', {
      erreurs: [
        { champ: 'curseur', code: 'curseur_invalide', message: 'Curseur de pagination illisible.' },
      ],
    });
  }
  return { creeLeTexte: donnees.valeur, id: donnees.id };
}

@Injectable()
export class ServiceUtilisateur {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_SERVICE_MOT_DE_PASSE) private readonly motDePasse: ServiceMotDePasse,
  ) {}

  async lister(
    ctx: ContexteTenant,
    params: ParametresListeUtilisateurs,
  ): Promise<PageUtilisateurResume> {
    const { limite } = params;
    const curseurDecode = params.curseur ? decoderCurseurUtilisateur(params.curseur) : null;

    return this.acces.enTenant(ctx, async (tx) => {
      const lignes = await this.chargerPageUtilisateurs(tx, ctx, limite, curseurDecode);
      const aUnePageSuivante = lignes.length > limite;
      const pageLignes = aUnePageSuivante ? lignes.slice(0, limite) : lignes;
      const derniere = pageLignes[pageLignes.length - 1];

      const sitesParUtilisateur = await this.chargerSitesParUtilisateur(
        tx,
        ctx,
        pageLignes.map((l) => l.id),
      );

      return {
        donnees: pageLignes.map((l) =>
          versUtilisateurResume(l, sitesParUtilisateur.get(l.id) ?? []),
        ),
        curseurSuivant:
          aUnePageSuivante && derniere
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

  /**
   * Création d'un employé — RF-137. `entree.role`/`entree.siteIds` déjà validés en forme par
   * `schemaCreationUtilisateur` (zod, `.strict()` — un `tenantId` glissé dans le corps est rejeté
   * AVANT d'atteindre ce service, jamais lu ici). Personne ne choisit le mot de passe de
   * l'employé : le serveur en génère un et le rend une seule fois dans la réponse.
   */
  async creer(
    ctx: ContexteTenant,
    entree: EntreeCreationUtilisateur,
    acteurRole: RoleUtilisateur,
  ): Promise<ReponseCreationUtilisateur> {
    // Garde n°1 (« personne ne s'octroie plus de droits qu'il n'en a ») — AVANT tout accès base.
    verifierAttributionRoleAutorisee(acteurRole, entree.role);

    const motDePasseClair = genererMotDePasseTemporaire();
    const motDePasseHash = await this.motDePasse.hacher(motDePasseClair);

    return this.acces.enTenant(ctx, async (tx) => {
      await this.verifierSitesDuTenant(tx, ctx, entree.siteIds);

      let ligne: LigneUtilisateur | undefined;
      try {
        [ligne] = await tx
          .insert(utilisateur)
          .values({
            tenantId: ctx.tenantId,
            email: entree.email,
            motDePasseHash,
            prenom: entree.prenom,
            nom: entree.nom,
            role: entree.role,
            // Un mot de passe réel existe déjà : `actif`, jamais `invite` (« invite » = créé mais
            // mot de passe jamais posé — voir db/schema/utilisateur.ts).
            statut: 'actif',
          })
          .returning();
      } catch (erreur) {
        if (estViolationUnicite(erreur)) {
          throw new ErreurMetier(
            'CONFLIT',
            `Un compte existe déjà avec l'adresse ${entree.email}.`,
            {
              erreurs: [
                { champ: 'email', code: 'email_deja_utilise', message: 'Adresse déjà utilisée.' },
              ],
            },
          );
        }
        throw erreur;
      }
      if (!ligne) throw new ErreurMetier('ERREUR_INTERNE', "Échec de la création de l'employé.");

      if (entree.siteIds.length > 0) {
        await tx.insert(utilisateurSite).values(
          entree.siteIds.map((siteId) => ({
            tenantId: ctx.tenantId,
            utilisateurId: ligne.id,
            siteId,
          })),
        );
      }

      await this.ecrireAudit(tx, ctx, {
        utilisateurCibleId: ligne.id,
        action: 'creation',
        avant: null,
        apres: { role: entree.role, statut: 'actif' },
      });

      const sites = await this.chargerSites(tx, ctx, entree.siteIds);
      return {
        utilisateur: versUtilisateurResume(ligne, sites),
        acces: { motDePasseTemporaire: motDePasseClair },
      };
    });
  }

  /** Modifie le rôle et/ou les sites d'un employé. Au moins un des deux champs est déjà garanti
   *  présent par `schemaModificationUtilisateur` (zod `.refine`). */
  async modifier(
    ctx: ContexteTenant,
    utilisateurId: string,
    entree: EntreeModificationUtilisateur,
    acteurRole: RoleUtilisateur,
  ): Promise<UtilisateurResume> {
    if (entree.role !== undefined) {
      verifierAttributionRoleAutorisee(acteurRole, entree.role);
    }

    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await this.chargerUtilisateurPourEcriture(tx, ctx, utilisateurId);

      if (entree.role !== undefined && entree.role !== ligne.role) {
        await tx
          .update(utilisateur)
          .set({ role: entree.role })
          .where(and(eq(utilisateur.tenantId, ctx.tenantId), eq(utilisateur.id, utilisateurId)));
        await this.ecrireAudit(tx, ctx, {
          utilisateurCibleId: utilisateurId,
          action: 'modification_role',
          avant: { role: ligne.role },
          apres: { role: entree.role },
        });
      }

      if (entree.siteIds !== undefined) {
        await this.verifierSitesDuTenant(tx, ctx, entree.siteIds);
        const sitesAvant = await this.chargerSitesParUtilisateur(tx, ctx, [utilisateurId]);
        await tx
          .delete(utilisateurSite)
          .where(
            and(
              eq(utilisateurSite.tenantId, ctx.tenantId),
              eq(utilisateurSite.utilisateurId, utilisateurId),
            ),
          );
        if (entree.siteIds.length > 0) {
          await tx
            .insert(utilisateurSite)
            .values(
              entree.siteIds.map((siteId) => ({ tenantId: ctx.tenantId, utilisateurId, siteId })),
            );
        }
        await this.ecrireAudit(tx, ctx, {
          utilisateurCibleId: utilisateurId,
          action: 'modification_sites',
          avant: { siteIds: (sitesAvant.get(utilisateurId) ?? []).map((s) => s.id) },
          apres: { siteIds: entree.siteIds },
        });
      }

      const ligneFinale = await this.chargerUtilisateurPourEcriture(tx, ctx, utilisateurId);
      const sites = await this.chargerSitesParUtilisateur(tx, ctx, [utilisateurId]);
      return versUtilisateurResume(ligneFinale, sites.get(utilisateurId) ?? []);
    });
  }

  /** Désactive un employé (`statut = 'suspendu'`) — jamais une suppression, l'historique (OR,
   *  factures, pointages) doit rester attribuable des années plus tard. Révoque immédiatement
   *  toute session active : sans quoi la désactivation resterait cosmétique jusqu'à l'expiration
   *  naturelle de la session en cours. */
  async desactiver(ctx: ContexteTenant, utilisateurId: string): Promise<UtilisateurResume> {
    if (utilisateurId === ctx.utilisateurId) {
      throw new ErreurMetier(
        'CONFLIT',
        'Impossible de désactiver son propre compte — demandez à un autre titulaire de direction/admin.',
      );
    }
    return this.basculerStatut(ctx, utilisateurId, 'suspendu', 'desactivation', true);
  }

  /** Réactive un employé précédemment désactivé (`statut = 'actif'`). */
  async reactiver(ctx: ContexteTenant, utilisateurId: string): Promise<UtilisateurResume> {
    return this.basculerStatut(ctx, utilisateurId, 'actif', 'reactivation', false);
  }

  /**
   * Réinitialise l'accès d'un employé : nouveau mot de passe temporaire (haché, jamais persisté
   * en clair), compteur d'échecs et verrouillage remis à zéro, toute session active révoquée.
   * Tracé dans l'audit (qui/quand/sur qui) — jamais la valeur du mot de passe.
   */
  async reinitialiserAcces(
    ctx: ContexteTenant,
    utilisateurId: string,
  ): Promise<ReponseAccesTemporaire> {
    const motDePasseClair = genererMotDePasseTemporaire();
    const motDePasseHash = await this.motDePasse.hacher(motDePasseClair);

    await this.acces.enTenant(ctx, async (tx) => {
      await this.chargerUtilisateurPourEcriture(tx, ctx, utilisateurId);

      await tx
        .update(utilisateur)
        .set({ motDePasseHash, echecsConnexion: 0, verrouilleJusquA: null })
        .where(and(eq(utilisateur.tenantId, ctx.tenantId), eq(utilisateur.id, utilisateurId)));

      await this.revoquerSessionsActives(tx, ctx, utilisateurId);

      await this.ecrireAudit(tx, ctx, {
        utilisateurCibleId: utilisateurId,
        action: 'reinitialisation_acces',
        avant: null,
        apres: null,
      });
    });

    return { motDePasseTemporaire: motDePasseClair };
  }

  // -----------------------------------------------------------------------------------------
  // Aides privées
  // -----------------------------------------------------------------------------------------

  private async basculerStatut(
    ctx: ContexteTenant,
    utilisateurId: string,
    statutCible: 'actif' | 'suspendu',
    action: 'desactivation' | 'reactivation',
    revoquerSessions: boolean,
  ): Promise<UtilisateurResume> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await this.chargerUtilisateurPourEcriture(tx, ctx, utilisateurId);

      if (ligne.statut !== statutCible) {
        await tx
          .update(utilisateur)
          .set({ statut: statutCible })
          .where(and(eq(utilisateur.tenantId, ctx.tenantId), eq(utilisateur.id, utilisateurId)));

        if (revoquerSessions) {
          await this.revoquerSessionsActives(tx, ctx, utilisateurId);
        }

        await this.ecrireAudit(tx, ctx, {
          utilisateurCibleId: utilisateurId,
          action,
          avant: { statut: ligne.statut },
          apres: { statut: statutCible },
        });
      }

      const ligneFinale = await this.chargerUtilisateurPourEcriture(tx, ctx, utilisateurId);
      const sites = await this.chargerSitesParUtilisateur(tx, ctx, [utilisateurId]);
      return versUtilisateurResume(ligneFinale, sites.get(utilisateurId) ?? []);
    });
  }

  private async chargerUtilisateurPourEcriture(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    utilisateurId: string,
  ): Promise<LigneUtilisateur> {
    const lignes = await tx
      .select()
      .from(utilisateur)
      .where(
        and(
          eq(utilisateur.tenantId, ctx.tenantId),
          eq(utilisateur.id, utilisateurId),
          CONDITION_ROLE_PERSONNE,
        ),
      )
      .limit(1);
    const ligne = lignes[0];
    // 404, jamais 403 : un employé d'un autre tenant (ou une borne d'atelier, gérée ailleurs) ne
    // doit même pas laisser deviner qu'il existe.
    if (!ligne) throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Employé introuvable.');
    return ligne;
  }

  private async verifierSitesDuTenant(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    siteIds: readonly string[],
  ): Promise<void> {
    if (siteIds.length === 0) return;
    const trouves = await tx
      .select({ id: site.id })
      .from(site)
      .where(and(eq(site.tenantId, ctx.tenantId), inArray(site.id, [...siteIds])));
    const idsTrouves = new Set(trouves.map((s) => s.id));
    const manquants = siteIds.filter((id) => !idsTrouves.has(id));
    if (manquants.length > 0) {
      throw new ErreurMetier(
        'VALIDATION_ECHOUEE',
        `Site(s) introuvable(s) pour ce tenant : ${manquants.join(', ')}.`,
        {
          erreurs: manquants.map((id) => ({
            champ: 'siteIds',
            code: 'site_introuvable',
            message: `Site ${id} introuvable pour ce tenant.`,
          })),
        },
      );
    }
  }

  private async chargerSites(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    siteIds: readonly string[],
  ): Promise<ReadonlyArray<{ readonly id: string; readonly nom: string }>> {
    if (siteIds.length === 0) return [];
    return tx
      .select({ id: site.id, nom: site.nom })
      .from(site)
      .where(and(eq(site.tenantId, ctx.tenantId), inArray(site.id, [...siteIds])));
  }

  private async chargerSitesParUtilisateur(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    utilisateurIds: readonly string[],
  ): Promise<Map<string, ReadonlyArray<{ readonly id: string; readonly nom: string }>>> {
    const parUtilisateur = new Map<string, Array<{ readonly id: string; readonly nom: string }>>();
    if (utilisateurIds.length === 0) return parUtilisateur;

    const lignes = await tx
      .select({
        utilisateurId: utilisateurSite.utilisateurId,
        siteId: site.id,
        siteNom: site.nom,
      })
      .from(utilisateurSite)
      .innerJoin(
        site,
        and(eq(site.tenantId, utilisateurSite.tenantId), eq(site.id, utilisateurSite.siteId)),
      )
      .where(
        and(
          eq(utilisateurSite.tenantId, ctx.tenantId),
          inArray(utilisateurSite.utilisateurId, [...utilisateurIds]),
        ),
      );

    for (const l of lignes) {
      const liste = parUtilisateur.get(l.utilisateurId) ?? [];
      liste.push({ id: l.siteId, nom: l.siteNom });
      parUtilisateur.set(l.utilisateurId, liste);
    }
    return parUtilisateur;
  }

  private async chargerPageUtilisateurs(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    limite: number,
    curseurDecode: { readonly creeLeTexte: string; readonly id: string } | null,
  ): Promise<ReadonlyArray<LigneUtilisateur & { readonly creeLeTexte: string }>> {
    const conditionTenant = and(eq(utilisateur.tenantId, ctx.tenantId), CONDITION_ROLE_PERSONNE);
    const conditionCurseur = curseurDecode
      ? sql`(${utilisateur.creeLe}, ${utilisateur.id}) < (${curseurDecode.creeLeTexte}::timestamptz, ${curseurDecode.id})`
      : undefined;
    const conditionFinale = conditionCurseur
      ? and(conditionTenant, conditionCurseur)
      : conditionTenant;

    return tx
      .select({
        ...getTableColumns(utilisateur),
        creeLeTexte: sql<string>`${utilisateur.creeLe}::text`,
      })
      .from(utilisateur)
      .where(conditionFinale)
      .orderBy(desc(utilisateur.creeLe), desc(utilisateur.id))
      .limit(limite + 1);
  }

  private async revoquerSessionsActives(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    utilisateurId: string,
  ): Promise<void> {
    await tx
      .update(session)
      .set({ revoqueeLe: new Date() })
      .where(
        and(
          eq(session.tenantId, ctx.tenantId),
          eq(session.utilisateurId, utilisateurId),
          isNull(session.revoqueeLe),
        ),
      );
  }

  private async ecrireAudit(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    entree: {
      readonly utilisateurCibleId: string;
      readonly action:
        | 'creation'
        | 'modification_role'
        | 'modification_sites'
        | 'desactivation'
        | 'reactivation'
        | 'reinitialisation_acces';
      readonly avant: Record<string, unknown> | null;
      readonly apres: Record<string, unknown> | null;
    },
  ): Promise<void> {
    if (!ctx.utilisateurId) {
      // Ne devrait jamais arriver (ces méthodes sont toujours appelées avec un principal
      // authentifié — aucune tâche système n'appelle ce service) : fail-closed plutôt qu'une
      // ligne d'audit sans auteur.
      throw new ErreurMetier(
        'ERREUR_INTERNE',
        'Geste de gestion de compte sans acteur identifié — audit impossible.',
      );
    }
    await tx.insert(auditUtilisateur).values({
      tenantId: ctx.tenantId,
      utilisateurCibleId: entree.utilisateurCibleId,
      actionParId: ctx.utilisateurId,
      action: entree.action,
      avant: entree.avant,
      apres: entree.apres,
    });
  }
}

function versUtilisateurResume(
  ligne: LigneUtilisateur,
  sites: ReadonlyArray<{ readonly id: string; readonly nom: string }>,
): UtilisateurResume {
  return {
    id: ligne.id,
    prenom: ligne.prenom,
    nom: ligne.nom,
    email: ligne.email,
    // `role` est garanti `RolePersonne` par `CONDITION_ROLE_PERSONNE` (jamais `poste_atelier`
    // sur les lignes que ce service charge) — cast local plutôt qu'un filtrage TypeScript
    // impossible à exprimer depuis `LigneUtilisateur.role: RoleUtilisateur`.
    role: ligne.role as UtilisateurResume['role'],
    statut: ligne.statut,
    sites: [...sites].sort((a, b) => a.nom.localeCompare(b.nom)),
    derniereConnexionLe: ligne.derniereConnexionLe ? ligne.derniereConnexionLe.toISOString() : null,
    creeLe: ligne.creeLe.toISOString(),
  };
}
