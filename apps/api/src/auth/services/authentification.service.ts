/**
 * Implémentation de `ServiceAuthentification` (contrat gelé étape 0, §2.10 et §4 endpoint 1-3).
 *
 * Orchestre mot de passe, session, limitation de débit et journal de sécurité. Règle absolue :
 * **email inconnu et mot de passe faux renvoient rigoureusement la même erreur**
 * `401 AUTH_IDENTIFIANTS_INVALIDES`, avec un temps de réponse égalisé par
 * `ServiceMotDePasse.verifierLeurre()` — sinon la simple observation du code d'erreur (ou de sa
 * latence) permet d'énumérer les comptes existants.
 */
import { isIP } from 'node:net';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import type { EntreeConnexion, SessionCourante, TypeEvenementSecurite } from '@dfa/shared';

import { JETON_CONFIG } from '../../config/config.jetons';
import type { Config } from '../../config/config.types';
import { enDate } from '../../db';
import { JETON_DB, JETON_DB_AMORCAGE } from '../../db/db.jetons';
import type { AccesAmorcage, AccesBase } from '../../db/db.types';
import { session, site, tenant, utilisateur } from '../../db/schema';
import { ServiceContexteRequete } from '../../common/contexte/contexte-requete.service';
import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';
import { JETON_SERVICE_LIMITATION_DEBIT } from '../../common/limitation/limitation-debit.jetons';
import type { ServiceLimitationDebit } from '../../common/limitation/limitation-debit.types';
import { JETON_SERVICE_MOT_DE_PASSE, JETON_SERVICE_SESSION } from '../jetons';
import type {
  ServiceAuthentification,
  ServiceMotDePasse,
  ServiceSession,
  SessionOuverte,
} from '../auth.types';
import {
  ErreurCompteSuspendu,
  ErreurCompteVerrouille,
  ErreurIdentifiantsInvalides,
  ErreurTenantSuspendu,
  ErreurTropDeTentatives,
} from '../erreurs-auth';

/**
 * Verrouillage progressif : plus un compte accumule d'échecs au-delà du seuil, plus la durée de
 * verrouillage s'allonge. Freine un brute-force distribué (qui contournerait la seule limitation
 * de débit par IP) sans jamais bannir définitivement un utilisateur légitime qui a oublié son
 * mot de passe.
 */
const PALIERS_VERROUILLAGE_MINUTES = [1, 5, 15, 60, 240] as const;

const MS_PAR_SECONDE = 1_000;
const MS_PAR_MINUTE = 60_000;

@Injectable()
export class ServiceAuthentificationImpl implements ServiceAuthentification {
  private readonly logger = new Logger(ServiceAuthentificationImpl.name);

  constructor(
    @Inject(JETON_CONFIG) private readonly config: Config,
    @Inject(JETON_DB) private readonly accesBase: AccesBase,
    @Inject(JETON_DB_AMORCAGE) private readonly accesAmorcage: AccesAmorcage,
    @Inject(JETON_SERVICE_MOT_DE_PASSE) private readonly servicePwd: ServiceMotDePasse,
    @Inject(JETON_SERVICE_SESSION) private readonly serviceSession: ServiceSession,
    @Inject(JETON_SERVICE_LIMITATION_DEBIT) private readonly limiteur: ServiceLimitationDebit,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  async connecter(
    entree: EntreeConnexion,
    ip: string | null,
    ua: string | null,
  ): Promise<{ session: SessionOuverte; corps: SessionCourante }> {
    // Normalisation défensive : le schéma zod (`schemaConnexion`) normalise déjà trim+lowercase,
    // mais ce service ne doit pas dépendre de son appelant pour une propriété aussi structurante
    // (une même adresse doit toujours désigner le même compte, quelle que soit la casse saisie).
    const email = entree.email.trim().toLowerCase();

    // Budget par IP : inconditionnel, consommé sur TOUTE tentative (succès compris). C'est la
    // seule des deux limitations Redis qui reste ainsi — voir `verifierLimitationDebitEmail`
    // ci-dessous pour le pourquoi de l'asymétrie (bloquant B2, rapport QA étape 0).
    await this.verifierLimitationDebitIp(ip);

    const u = await this.accesAmorcage.utilisateurParEmail(email);

    if (!u) {
      // Budget par email consommé ICI (échec) — voir `verifierLimitationDebitEmail`.
      await this.verifierLimitationDebitEmail(email);
      // Coût CPU équivalent à un vrai `verifier()`, pour ne pas laisser filtrer par chronométrage
      // le fait que cet email n'existe pas.
      await this.servicePwd.verifierLeurre();
      await this.journaliser('connexion_echouee', null, null, email, ip, ua, {
        raison: 'email_inconnu',
      });
      throw new ErreurIdentifiantsInvalides();
    }

    // Le mot de passe est vérifié AVANT le verrouillage (et non l'inverse) : un compte verrouillé
    // ne fait l'objet d'aucun court-circuit avant Argon2, pour deux raisons (finding sécurité
    // #3) :
    // 1. Latence : un court-circuit avant Argon2 répondrait en quelques ms pour un compte
    //    verrouillé contre ~50ms (`verifierLeurre()`) pour un email inconnu — un oracle de
    //    chronométrage qui, combiné au code 423 lui-même, permet d'énumérer les comptes existants
    //    et même de verrouiller à volonté le compte d'un employé nommément identifié.
    // 2. Confidentialité du statut : tant que le mot de passe n'est pas prouvé correct, révéler
    //    « ce compte est verrouillé » (423) est une fuite d'existence de compte au même titre
    //    qu'un email inconnu — voir le commentaire d'en-tête de ce fichier. Le 423 n'est donc
    //    renvoyé que si le mot de passe fourni est le bon (l'attaquant qui le connaît déjà
    //    n'apprend rien de nouveau) ; sinon, EXACTEMENT le même 401 générique que pour un mot de
    //    passe faux sur un compte non verrouillé.
    //
    // Défense en profondeur sur le typage : `u.verrouilleJusquA` est contractuellement `Date |
    // null` (`db/db.types.ts`), mais rien ne garantit à l'exécution qu'un pilote SQL renvoie une
    // véritable instance `Date` sur CE chemin précis — les 6 fonctions d'amorçage passent par du
    // SQL non typé par le schéma Drizzle habituel. Une chaîne ISO brute ferait planter
    // `.getTime()` (ligne plus bas) avec un `TypeError` NON typé, capturé par `FiltreProbleme`
    // comme `500 ERREUR_INTERNE` au lieu du `423 AUTH_COMPTE_VERROUILLE` attendu — précisément
    // sur le chemin qui vérifie le verrouillage d'un compte. Coercition défensive plutôt que
    // confiance aveugle dans le typage d'une frontière externe (même principe que `isIP()` dans
    // `journaliser()` plus bas).
    const dejaVerrouilleJusquA = this.versDateOuNull(u.verrouilleJusquA);

    const motDePasseValide = await this.servicePwd.verifier(u.motDePasseHash, entree.motDePasse);

    if (!motDePasseValide) {
      // Budget par email consommé ICI (échec) — voir `verifierLimitationDebitEmail`. Une
      // connexion réussie, elle, ne l'atteint jamais (bloquant B2).
      await this.verifierLimitationDebitEmail(email);
      const nouveauxEchecs = u.echecsConnexion + 1;
      const verrouilleJusquA = this.calculerVerrouillage(nouveauxEchecs);
      await this.accesAmorcage.enregistrerEchecConnexion(u.id, verrouilleJusquA);
      await this.journaliser('connexion_echouee', u.tenantId, u.id, email, ip, ua, {
        raison: 'mot_de_passe_invalide',
        echecsConnexion: nouveauxEchecs,
      });
      if (verrouilleJusquA !== null) {
        await this.journaliser('compte_verrouille', u.tenantId, u.id, email, ip, ua, {
          echecsConnexion: nouveauxEchecs,
        });
      }
      // MÊME code d'erreur que « email inconnu » ci-dessus, QUE le compte ait déjà été verrouillé
      // ou non avant cette tentative — voir le commentaire d'en-tête.
      throw new ErreurIdentifiantsInvalides();
    }

    if (dejaVerrouilleJusquA !== null && dejaVerrouilleJusquA.getTime() > Date.now()) {
      await this.journaliser('compte_verrouille', u.tenantId, u.id, email, ip, ua, {
        raison: 'deja_verrouille',
      });
      throw new ErreurCompteVerrouille(this.secondesAvant(dejaVerrouilleJusquA));
    }

    // Mot de passe prouvé correct : à partir d'ici, révéler un statut suspendu ne constitue plus
    // une énumération de comptes (l'attaquant devrait déjà connaître le mot de passe).
    if (u.statut !== 'actif') {
      await this.journaliser('connexion_echouee', u.tenantId, u.id, email, ip, ua, {
        raison: 'compte_suspendu',
      });
      throw new ErreurCompteSuspendu();
    }
    if (u.statutTenant !== 'actif') {
      await this.journaliser('connexion_echouee', u.tenantId, u.id, email, ip, ua, {
        raison: 'tenant_suspendu',
      });
      throw new ErreurTenantSuspendu();
    }

    await this.accesAmorcage.reinitialiserEchecsConnexion(u.id, new Date());

    const sessionOuverte = await this.serviceSession.ouvrir(u, ip, ua);

    const principal: PrincipalAuthentifie = {
      sessionId: sessionOuverte.sessionId,
      tenantId: u.tenantId,
      utilisateurId: u.id,
      role: u.role,
      langue: u.langue,
      // `utilisateur_par_email` ne projette pas `site_id` (elle n'en a pas besoin : seul `role`
      // détermine la durée de session). Le site est donc laissé à `undefined` ICI, sur le seul
      // chemin de connexion, et `sessionCourante()` ci-dessous le lit directement en base pour
      // construire la réponse. La valeur faisant foi sur toutes les requêtes SUIVANTES est celle
      // que `ServiceSessionImpl.resoudre()` remonte depuis `amorcage.session_par_empreinte`.
      // `siteImposeAuPrincipal()` est fail-closed sur ce champ absent : aucun geste de compte de
      // service ne peut donc s'appuyer sur ce principal-là, et c'est voulu — la connexion n'est
      // pas un geste métier.
    };

    // Montée de version des coûts Argon2 : rehachage best-effort, jamais bloquant pour le login.
    if (this.servicePwd.doitEtreRehache(u.motDePasseHash)) {
      this.rehacherEnArrierePlan(u.id, u.tenantId, entree.motDePasse);
    }

    const corps = await this.sessionCourante(principal);

    await this.journaliser('connexion_reussie', u.tenantId, u.id, email, ip, ua, null);

    return { session: sessionOuverte, corps };
  }

  async deconnecter(principal: PrincipalAuthentifie): Promise<void> {
    const ctx = this.contexte.actuelOuNull();

    try {
      await this.serviceSession.fermer(principal);
    } catch (erreur) {
      // Finding sécurité #7 : le contrôleur (`auth.controller.ts`) reste délibérément idempotent
      // — 204 systématique même si CET appel échoue, cookie effacé côté client dans tous les cas
      // (le bon choix pour une tablette d'atelier partagée : « se déconnecter » ne doit jamais
      // planter). Mais côté serveur, si `fermer()` échoue, `revoquee_le` reste NULL et le jeton
      // reste valide jusqu'à expiration naturelle (8h, ou 2h d'inactivité) : quiconque a capté le
      // cookie garde un accès authentifié. On ne doit donc PAS avaler cette erreur en silence :
      // on la crie fort en log ET on journalise un événement de sécurité distinct pour que
      // l'échec reste reconstituable a posteriori dans `journal_securite`, puis on la
      // repropage (le contrôleur, lui, l'avale volontairement).
      // Limite résiduelle documentée : tant que cette écriture échoue, aucune action côté serveur
      // ne révoque la session immédiatement ; seule l'expiration naturelle, une nouvelle tentative
      // de déconnexion réussie, ou une révocation manuelle y met fin.
      this.logger.error(
        `Échec de révocation de session à la déconnexion (sessionId=${principal.sessionId}, ` +
          `utilisateurId=${principal.utilisateurId}) : ${String(erreur)}`,
      );
      await this.journaliser(
        'deconnexion',
        principal.tenantId,
        principal.utilisateurId,
        null,
        ctx?.ip ?? null,
        ctx?.userAgent ?? null,
        {
          resultat: 'echec_revocation',
          erreur: String(erreur),
        },
      );
      throw erreur;
    }

    await this.journaliser(
      'deconnexion',
      principal.tenantId,
      principal.utilisateurId,
      null,
      ctx?.ip ?? null,
      ctx?.userAgent ?? null,
      null,
    );
  }

  async sessionCourante(principal: PrincipalAuthentifie): Promise<SessionCourante> {
    return this.accesBase.enTenant(
      {
        tenantId: principal.tenantId,
        utilisateurId: principal.utilisateurId,
        requeteId: this.contexte.actuelOuNull()?.requeteId ?? null,
      },
      async (tx) => {
        const [ligneUtilisateur] = await tx
          .select({
            id: utilisateur.id,
            email: utilisateur.email,
            prenom: utilisateur.prenom,
            nom: utilisateur.nom,
            role: utilisateur.role,
            langue: utilisateur.langue,
            // Hors de `UtilisateurCourant` (le contrat n'expose pas le site DANS l'utilisateur) :
            // sert ici à borner `sites` et à remplir `siteRattachementId`. Lu depuis la base à
            // chaque appel, jamais depuis le principal — `connecter()` construit un principal
            // sans site (voir son commentaire), et cette méthode sert les deux chemins.
            siteId: utilisateur.siteId,
          })
          .from(utilisateur)
          .where(
            // Le RLS est le filet, pas le mécanisme : cette requête reste scopée tenant
            // explicitement, même si `enTenant()` positionne déjà le contexte RLS ci-dessus
            // (finding sécurité #9 — voir `ServiceSession.fermer()` pour la même forme).
            and(
              eq(utilisateur.id, principal.utilisateurId),
              eq(utilisateur.tenantId, principal.tenantId),
            ),
          );

        const [ligneTenant] = await tx
          .select({
            id: tenant.id,
            slug: tenant.slug,
            raisonSociale: tenant.raisonSociale,
            langueDefaut: tenant.langueDefaut,
          })
          .from(tenant)
          .where(eq(tenant.id, principal.tenantId));

        // `sites` = les sites sur lesquels CE COMPTE peut agir, jamais « tous les sites du
        // tenant » par principe. Pour un compte de personne, les deux coïncident et le
        // comportement est inchangé depuis l'étape 0 (aucune autorisation du produit n'est scopée
        // par site : la matrice est rôle × action, l'étanchéité est tenant). Pour un compte de
        // SERVICE, la liste se réduit à son unique site de rattachement — une borne ne doit pas
        // même APPRENDRE que d'autres sites existent, et le front n'a alors aucun sélecteur de
        // site à proposer.
        //
        // Filtre sur `utilisateur.site_id` lu ci-dessus, pas sur le rôle : si la biconditionnelle
        // `utilisateur_site_compte_de_service_chk` venait à être relâchée un jour, ce code suivrait
        // la donnée réelle plutôt qu'une hypothèse sur les rôles.
        const siteRattachementId = ligneUtilisateur?.siteId ?? null;
        const conditionSites =
          siteRattachementId !== null
            ? and(eq(site.tenantId, principal.tenantId), eq(site.id, siteRattachementId))
            : eq(site.tenantId, principal.tenantId);

        const lignesSites = await tx
          .select({ id: site.id, code: site.code, nom: site.nom, actif: site.actif })
          .from(site)
          .where(conditionSites)
          .orderBy(asc(site.code));

        const [ligneSession] = await tx
          .select({ expireLe: session.expireLe })
          .from(session)
          .where(
            // Idem — voir le commentaire au-dessus, sur la requête `utilisateur`.
            and(eq(session.id, principal.sessionId), eq(session.tenantId, principal.tenantId)),
          );

        if (!ligneUtilisateur || !ligneTenant || !ligneSession) {
          // Ne devrait jamais arriver : RLS + FK garantissent la cohérence tenant/utilisateur/
          // session. Un principal résolu sans ligne correspondante est une incohérence interne,
          // pas une 404 côté client (le client est authentifié, la ressource DEVRAIT exister).
          throw new Error(
            `Principal résolu sans ligne correspondante en base (utilisateurId=${principal.utilisateurId}).`,
          );
        }

        // `siteId` est retiré de l'objet `utilisateur` : le contrat `UtilisateurCourant` ne porte
        // pas de site (c'est une propriété du COMPTE, exposée à part en `siteRattachementId`), et
        // renvoyer un champ non déclaré au contrat le ferait diverger de l'OpenAPI généré.
        return {
          utilisateur: {
            id: ligneUtilisateur.id,
            email: ligneUtilisateur.email,
            prenom: ligneUtilisateur.prenom,
            nom: ligneUtilisateur.nom,
            role: ligneUtilisateur.role,
            langue: ligneUtilisateur.langue,
          },
          tenant: ligneTenant,
          sites: lignesSites,
          siteRattachementId,
          expireLe: ligneSession.expireLe.toISOString(),
        } satisfies SessionCourante;
      },
    );
  }

  /**
   * Budget Redis PAR IP — inconditionnel, consommé sur TOUTE tentative (échec comme succès).
   * Seul rempart contre un brute-force distribué sur de nombreux comptes depuis une même
   * source ; ne peut donc pas être conditionné au résultat de la tentative comme le budget par
   * email ci-dessous (bloquant B2, rapport QA étape 0).
   */
  private async verifierLimitationDebitIp(ip: string | null): Promise<void> {
    if (ip === null) return;
    const resultatIp = await this.limiteur.consommer(
      `auth:connexion:ip:${ip}`,
      this.config.LIMITE_CONNEXION_IP,
      this.config.LIMITE_FENETRE_SECONDES,
    );
    if (!resultatIp.autorise) {
      throw new ErreurTropDeTentatives(
        resultatIp.resteSecondes ?? this.config.LIMITE_FENETRE_SECONDES,
      );
    }
  }

  /**
   * Budget Redis PAR EMAIL — appelé UNIQUEMENT depuis les branches d'échec de `connecter()`
   * (email inconnu, mot de passe invalide), JAMAIS depuis le chemin de succès.
   *
   * Bloquant B2 (rapport QA étape 0) : consommer ce budget sur toute tentative, succès compris,
   * finit par bloquer un utilisateur légitime qui enchaîne des connexions réussies sur des
   * postes partagés (le mode d'usage normal d'un garage) avec un message « trop de tentatives »
   * qui n'a aucun sens pour lui. Un budget qui ne se consomme que sur échec reste un frein
   * efficace contre le devinage de mot de passe sans jamais gêner un utilisateur légitime.
   *
   * Effet de bord notable sur le bloquant B1 : en ne consommant plus JAMAIS ce budget sur le
   * chemin de succès, la 6e requête d'un scénario « 5 échecs puis bon mot de passe » n'a plus
   * aucune raison de heurter ce limiteur — elle atteint la vérification du verrouillage et rend
   * 423 comme attendu, indépendamment de la valeur de LIMITE_CONNEXION_COMPTE. La séparation de
   * LIMITE_CONNEXION_COMPTE et SEUIL_VERROUILLAGE_COMPTE (voir `charger-config.ts`) reste une
   * seconde barrière indépendante, pas la seule ligne de défense.
   */
  private async verifierLimitationDebitEmail(email: string): Promise<void> {
    const resultatEmail = await this.limiteur.consommer(
      `auth:connexion:email:${email}`,
      this.config.LIMITE_CONNEXION_COMPTE,
      this.config.LIMITE_FENETRE_SECONDES,
    );
    if (!resultatEmail.autorise) {
      throw new ErreurTropDeTentatives(
        resultatEmail.resteSecondes ?? this.config.LIMITE_FENETRE_SECONDES,
      );
    }
  }

  private calculerVerrouillage(nouveauxEchecs: number): Date | null {
    const seuil = this.config.SEUIL_VERROUILLAGE_COMPTE;
    if (nouveauxEchecs < seuil) return null;
    const indexPalier = Math.min(nouveauxEchecs - seuil, PALIERS_VERROUILLAGE_MINUTES.length - 1);
    const minutes = PALIERS_VERROUILLAGE_MINUTES[indexPalier] ?? PALIERS_VERROUILLAGE_MINUTES[0];
    return new Date(Date.now() + minutes * MS_PAR_MINUTE);
  }

  private secondesAvant(date: Date): number {
    return Math.max(1, Math.ceil((date.getTime() - Date.now()) / MS_PAR_SECONDE));
  }

  /** Voir le commentaire au point d'appel (défense en profondeur sur `verrouilleJusquA`). */
  private versDateOuNull(valeur: Date | string | null): Date | null {
    return valeur === null ? null : enDate(valeur);
  }

  private rehacherEnArrierePlan(
    utilisateurId: string,
    tenantId: string,
    motDePasseClair: string,
  ): void {
    this.servicePwd
      .hacher(motDePasseClair)
      .then((nouveauHash) =>
        this.accesBase.enTenant(
          { tenantId, utilisateurId, requeteId: this.contexte.actuelOuNull()?.requeteId ?? null },
          async (tx) => {
            await tx
              .update(utilisateur)
              .set({ motDePasseHash: nouveauHash })
              .where(
                // Le RLS est le filet, pas le mécanisme : cette requête reste scopée tenant
                // explicitement, même si `enTenant()` positionne déjà le contexte RLS ci-dessus
                // (même défense qu'en haut de ce fichier, voir `sessionCourante()` — finding
                // sécurité #9).
                and(eq(utilisateur.id, utilisateurId), eq(utilisateur.tenantId, tenantId)),
              );
          },
        ),
      )
      .catch((erreur: unknown) => {
        // Best-effort : un échec de rehachage ne doit jamais faire échouer le login qui vient de
        // réussir. Le prochain login réussi retentera.
        this.logger.warn(
          `Échec non bloquant de rehachage Argon2 (utilisateurId=${utilisateurId}) : ${String(erreur)}`,
        );
      });
  }

  private async journaliser(
    type: TypeEvenementSecurite,
    tenantId: string | null,
    utilisateurId: string | null,
    emailTente: string | null,
    ip: string | null,
    userAgent: string | null,
    details: Record<string, unknown> | null,
  ): Promise<void> {
    // Défense en profondeur (finding sécurité #6, volet auth) : une IP malformée envoyée telle
    // quelle finirait en `${ip}::inet` côté base, ferait échouer l'INSERT (22P02 — cast Postgres
    // invalide) et ferait disparaître l'ÉVÉNEMENT DE SÉCURITÉ ENTIER dans le catch ci-dessous, pas
    // seulement l'IP. `isIP()` (contrairement à un motif regex) ne laisse passer que de vraies
    // IPv4/IPv6 ; toute autre valeur est journalisée avec `ip = null` plutôt que de risquer
    // l'échec de l'écriture — perdre l'IP est acceptable, perdre l'événement ne l'est pas. (Le
    // même filet existe indépendamment côté `db/acces-amorcage.service.ts`, propriété d'un autre
    // agent — ceci est le filet côté service auth, au point d'entrée unique de tous ses
    // événements.)
    const ipValidee = ip !== null && isIP(ip) !== 0 ? ip : null;
    try {
      await this.accesAmorcage.journaliserSecurite({
        type,
        tenantId,
        utilisateurId,
        emailTente,
        ip: ipValidee,
        userAgent,
        details,
      });
    } catch (erreur) {
      // Un échec de journalisation ne doit jamais faire échouer une connexion/déconnexion, mais
      // c'est un trou dans l'audit trail : on le crie fort en log.
      this.logger.error(`Échec de journalisation sécurité (type=${type}) : ${String(erreur)}`);
    }
  }
}
