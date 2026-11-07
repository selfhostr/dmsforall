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
  PREREGLAGES,
  droitsBaissent,
  incoherencesDeGrille,
  type EntreeCreationUtilisateur,
  type EntreeModificationCapacites,
  type EntreeModificationUtilisateur,
  type GrilleCapacites,
  type PageUtilisateurResume,
  type ReponseAccesTemporaire,
  type ReponseCreationUtilisateur,
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
import {
  verifierAttributionRoleAutorisee,
  verifierCibleModifiable,
  verifierGrilleAttribuable,
  verifierPasAutoModification,
  resoudrePrereglage,
  type ActeurGouvernance,
} from '../auth/gouvernance-roles';
import {
  capacitesPersonneDe,
  colonnesDepuisGrille,
  grilleDepuisLigne,
} from '../auth/grille-utilisateur';
import {
  JETON_SERVICE_MOT_DE_PASSE,
  JETON_SERVICE_REINITIALISATION_MOT_DE_PASSE,
} from '../auth/jetons';
import type { ServiceMotDePasse, ServiceReinitialisationMotDePasse } from '../auth/auth.types';

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
    @Inject(JETON_SERVICE_REINITIALISATION_MOT_DE_PASSE)
    private readonly serviceReinitialisation: ServiceReinitialisationMotDePasse,
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
    acteur: ActeurGouvernance,
  ): Promise<ReponseCreationUtilisateur> {
    // Garde n°1 (« personne ne s'octroie plus de droits qu'il n'en a ») — AVANT tout accès base.
    const acteurRole = typeof acteur === 'string' ? acteur : acteur.role;
    verifierAttributionRoleAutorisee(acteurRole, entree.role);
    const choix = resoudrePrereglage(entree.role, entree.prereglage);
    const grilleInitiale = PREREGLAGES[choix?.id ?? entree.role].grille;
    verifierGrilleAttribuable(acteur, grilleInitiale, { prereglage: true });

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
            ...colonnesDepuisGrille(grilleInitiale),
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
        apres: {
          role: entree.role,
          statut: 'actif',
          prereglage: choix?.id ?? entree.role,
          capacites: grilleInitiale,
        },
      });

      const sites = await this.chargerSites(tx, ctx, entree.siteIds);
      return {
        utilisateur: versUtilisateurResume(ligne, sites),
        acces: { motDePasseTemporaire: motDePasseClair },
      };
    });
  }

  /** Modifie le rôle (= applique un préréglage) et/ou les sites d'un employé. Au moins un des deux
   *  champs est déjà garanti présent par `schemaModificationUtilisateur` (zod `.refine`).
   *  Changer de rôle REMPLACE la grille de la personne par le préréglage du nouveau rôle (les
   *  personnalisations sont perdues, l'audit garde l'avant/après). */
  async modifier(
    ctx: ContexteTenant,
    utilisateurId: string,
    entree: EntreeModificationUtilisateur,
    acteur: ActeurGouvernance,
  ): Promise<UtilisateurResume> {
    const acteurRole = typeof acteur === 'string' ? acteur : acteur.role;
    const choix = resoudrePrereglage(entree.role, entree.prereglage);
    if (choix !== null) {
      verifierAttributionRoleAutorisee(acteurRole, choix.role);
      verifierPasAutoModification(ctx.utilisateurId ?? null, utilisateurId);
      verifierGrilleAttribuable(acteur, PREREGLAGES[choix.id].grille, { prereglage: true });
    }

    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await this.chargerUtilisateurPourEcriture(tx, ctx, utilisateurId);

      if (choix !== null) {
        const grilleAvant = grilleDepuisLigne(ligne);
        verifierCibleModifiable(acteur, ligne.role, grilleAvant);
        const grilleApres = PREREGLAGES[choix.id].grille;
        // Un préréglage nommé s'applique toujours (c'est le moyen de « remettre à zéro » une grille
        // personnalisée) ; un simple rôle identique au rôle actuel ne touche à rien.
        const change = choix.role !== ligne.role || entree.prereglage !== undefined;
        if (change) {
          await this.verifierPasDernierPatron(tx, ctx, ligne, grilleApres);
          await tx
            .update(utilisateur)
            .set({ role: choix.role, ...colonnesDepuisGrille(grilleApres) })
            .where(and(eq(utilisateur.tenantId, ctx.tenantId), eq(utilisateur.id, utilisateurId)));
          if (droitsBaissent(grilleAvant, grilleApres)) {
            await this.revoquerSessionsActives(tx, ctx, utilisateurId);
          }
          await this.ecrireAudit(tx, ctx, {
            utilisateurCibleId: utilisateurId,
            action: 'modification_role',
            avant: { role: ligne.role, capacites: grilleAvant },
            apres: { role: choix.role, prereglage: choix.id, capacites: grilleApres },
          });
        }
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

  /**
   * `PATCH /utilisateurs/{id}/capacites` — ajuste la grille d'UNE personne (niveaux, encadrer,
   * options). Gardes, dans l'ordre : pas de modification de soi-même ; la cible ne doit pas
   * dépasser l'acteur ; la nouvelle grille ne doit pas dépasser l'acteur ; `gererEmployes` et
   * `patron` ne bougent pas ici. Les sessions de la personne sont révoquées si ses droits baissent.
   */
  async modifierCapacites(
    ctx: ContexteTenant,
    utilisateurId: string,
    entree: EntreeModificationCapacites,
    acteur: ActeurGouvernance,
  ): Promise<UtilisateurResume> {
    verifierPasAutoModification(ctx.utilisateurId ?? null, utilisateurId);

    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await this.chargerUtilisateurPourEcriture(tx, ctx, utilisateurId);
      const avant = grilleDepuisLigne(ligne);
      verifierCibleModifiable(acteur, ligne.role, avant);

      const apres: GrilleCapacites = {
        niveaux: { ...avant.niveaux, ...definis(entree.niveaux) },
        encadrer: entree.encadrer ?? avant.encadrer,
        gererEmployes: avant.gererEmployes,
        patron: avant.patron,
        options: { ...avant.options, ...definis(entree.options) },
      };
      const incoherences = incoherencesDeGrille(apres);
      if (incoherences.length > 0) {
        throw new ErreurMetier(
          'VALIDATION_ECHOUEE',
          'Grille incohérente : sans « voit les montants », on ne facture pas, on ne vend pas et on n’accède pas aux finances.',
          {
            erreurs: incoherences.map((champ) => ({
              champ,
              code: 'grille_incoherente',
              message: 'Incompatible avec l’option « voit les montants » désactivée.',
            })),
          },
        );
      }
      verifierGrilleAttribuable(acteur, apres, { prereglage: false });

      await tx
        .update(utilisateur)
        .set(colonnesDepuisGrille(apres))
        .where(and(eq(utilisateur.tenantId, ctx.tenantId), eq(utilisateur.id, utilisateurId)));

      if (droitsBaissent(avant, apres)) {
        await this.revoquerSessionsActives(tx, ctx, utilisateurId);
      }
      await this.ecrireAudit(tx, ctx, {
        utilisateurCibleId: utilisateurId,
        action: 'modification_role',
        avant: { role: ligne.role, capacites: avant },
        apres: { role: ligne.role, capacites: apres },
      });

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

      // Un jeton de réinitialisation en libre-service émis AVANT ce geste admin resterait sinon
      // utilisable APRÈS que l'admin/direction a repris la main sur le compte — voir l'en-tête de
      // `auth/services/reinitialisation-mot-de-passe.service.ts` et de `auth.types.ts
      // ::ServiceReinitialisationMotDePasse.revoquerJetonsActifsDansTransaction`. Passé DANS cette
      // transaction (jamais un `enTenant()` séparé — non atomique, voir CONTRIBUTING.md).
      await this.serviceReinitialisation.revoquerJetonsActifsDansTransaction(
        tx,
        ctx,
        utilisateurId,
      );

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
        if (statutCible === 'suspendu') {
          await this.verifierPasDernierPatron(tx, ctx, ligne, null);
        }
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

  /**
   * Un garage ne reste jamais sans patron : si `ligne` est un patron ACTIF qui cesserait de l'être
   * (grille de remplacement sans `patron`, ou désactivation quand `grilleApres` est `null`), il
   * doit en rester au moins un autre actif dans le tenant. Sans quoi plus personne ne pourrait
   * gérer les comptes ni modifier l'IBAN.
   */
  private async verifierPasDernierPatron(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    ligne: LigneUtilisateur,
    grilleApres: GrilleCapacites | null,
  ): Promise<void> {
    if (!ligne.estPatron || ligne.statut !== 'actif') return;
    if (grilleApres !== null && grilleApres.patron) return;
    const [autres] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(utilisateur)
      .where(
        and(
          eq(utilisateur.tenantId, ctx.tenantId),
          eq(utilisateur.estPatron, true),
          eq(utilisateur.statut, 'actif'),
          ne(utilisateur.id, ligne.id),
          CONDITION_ROLE_PERSONNE,
        ),
      );
    if ((autres?.n ?? 0) === 0) {
      throw new ErreurMetier(
        'CONFLIT',
        'Dernier patron du garage : désignez d’abord un autre patron avant de modifier ou désactiver ce compte.',
        {
          erreurs: [
            {
              champ: 'utilisateurId',
              code: 'dernier_patron',
              message: 'Un garage doit garder au moins un patron actif.',
            },
          ],
        },
      );
    }
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
    capacites: capacitesPersonneDe(ligne.role, grilleDepuisLigne(ligne)),
    statut: ligne.statut,
    sites: [...sites].sort((a, b) => a.nom.localeCompare(b.nom)),
    derniereConnexionLe: ligne.derniereConnexionLe ? ligne.derniereConnexionLe.toISOString() : null,
    creeLe: ligne.creeLe.toISOString(),
  };
}

/** Retire les clés `undefined` d'un objet partiel (un spread laisserait `undefined` écraser). */
function definis<T extends object>(partiel: T | undefined): Partial<T> {
  if (partiel === undefined) return {};
  return Object.fromEntries(
    Object.entries(partiel).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}
