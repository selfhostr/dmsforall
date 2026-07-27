/**
 * Implémentation de `ServiceAuthentification` (contrat gelé étape 0, §2.10 et §4 endpoint 1-3).
 *
 * Orchestre mot de passe, session, limitation de débit et journal de sécurité. Règle absolue :
 * **email inconnu et mot de passe faux renvoient rigoureusement la même erreur**
 * `401 AUTH_IDENTIFIANTS_INVALIDES`, avec un temps de réponse égalisé par
 * `ServiceMotDePasse.verifierLeurre()` — sinon la simple observation du code d'erreur (ou de sa
 * latence) permet d'énumérer les comptes existants.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import type { EntreeConnexion, SessionCourante, TypeEvenementSecurite } from '@dfa/shared';

import { JETON_CONFIG } from '../../config/config.jetons';
import type { Config } from '../../config/config.types';
import { JETON_DB, JETON_DB_AMORCAGE } from '../../db/db.jetons';
import type { AccesAmorcage, AccesBase } from '../../db/db.types';
import { session, site, tenant, utilisateur } from '../../db/schema';
import { ServiceContexteRequete } from '../../common/contexte/contexte-requete.service';
import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';
import { JETON_SERVICE_LIMITATION_DEBIT } from '../../common/limitation/limitation-debit.jetons';
import type { ServiceLimitationDebit } from '../../common/limitation/limitation-debit.types';
import { JETON_SERVICE_MOT_DE_PASSE, JETON_SERVICE_SESSION } from '../jetons';
import type { ServiceAuthentification, ServiceMotDePasse, ServiceSession, SessionOuverte } from '../auth.types';
import {
  ErreurCompteSuspendu,
  ErreurCompteVerrouille,
  ErreurIdentifiantsInvalides,
  ErreurTenantSuspendu,
  ErreurTropDeTentatives,
} from '../erreurs-auth';

/** Échecs consécutifs avant le premier verrouillage du compte. */
const SEUIL_VERROUILLAGE = 5;

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

    await this.verifierLimitationDebit(email, ip);

    const u = await this.accesAmorcage.utilisateurParEmail(email);

    if (!u) {
      // Coût CPU équivalent à un vrai `verifier()`, pour ne pas laisser filtrer par chronométrage
      // le fait que cet email n'existe pas.
      await this.servicePwd.verifierLeurre();
      await this.journaliser('connexion_echouee', null, null, email, ip, ua, {
        raison: 'email_inconnu',
      });
      throw new ErreurIdentifiantsInvalides();
    }

    if (u.verrouilleJusquA !== null && u.verrouilleJusquA.getTime() > Date.now()) {
      await this.journaliser('compte_verrouille', u.tenantId, u.id, email, ip, ua, {
        raison: 'deja_verrouille',
      });
      throw new ErreurCompteVerrouille(this.secondesAvant(u.verrouilleJusquA));
    }

    const motDePasseValide = await this.servicePwd.verifier(u.motDePasseHash, entree.motDePasse);

    if (!motDePasseValide) {
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
      // MÊME code d'erreur que « email inconnu » ci-dessus — voir le commentaire d'en-tête.
      throw new ErreurIdentifiantsInvalides();
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
    await this.serviceSession.fermer(principal);
    const ctx = this.contexte.actuelOuNull();
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
          })
          .from(utilisateur)
          .where(eq(utilisateur.id, principal.utilisateurId));

        const [ligneTenant] = await tx
          .select({
            id: tenant.id,
            slug: tenant.slug,
            raisonSociale: tenant.raisonSociale,
            langueDefaut: tenant.langueDefaut,
          })
          .from(tenant)
          .where(eq(tenant.id, principal.tenantId));

        const lignesSites = await tx
          .select({ id: site.id, code: site.code, nom: site.nom, actif: site.actif })
          .from(site)
          .where(eq(site.tenantId, principal.tenantId))
          .orderBy(asc(site.code));

        const [ligneSession] = await tx
          .select({ expireLe: session.expireLe })
          .from(session)
          .where(eq(session.id, principal.sessionId));

        if (!ligneUtilisateur || !ligneTenant || !ligneSession) {
          // Ne devrait jamais arriver : RLS + FK garantissent la cohérence tenant/utilisateur/
          // session. Un principal résolu sans ligne correspondante est une incohérence interne,
          // pas une 404 côté client (le client est authentifié, la ressource DEVRAIT exister).
          throw new Error(
            `Principal résolu sans ligne correspondante en base (utilisateurId=${principal.utilisateurId}).`,
          );
        }

        return {
          utilisateur: ligneUtilisateur,
          tenant: ligneTenant,
          sites: lignesSites,
          expireLe: ligneSession.expireLe.toISOString(),
        } satisfies SessionCourante;
      },
    );
  }

  private async verifierLimitationDebit(email: string, ip: string | null): Promise<void> {
    if (ip !== null) {
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
    if (nouveauxEchecs < SEUIL_VERROUILLAGE) return null;
    const indexPalier = Math.min(
      nouveauxEchecs - SEUIL_VERROUILLAGE,
      PALIERS_VERROUILLAGE_MINUTES.length - 1,
    );
    const minutes = PALIERS_VERROUILLAGE_MINUTES[indexPalier] ?? PALIERS_VERROUILLAGE_MINUTES[0];
    return new Date(Date.now() + minutes * MS_PAR_MINUTE);
  }

  private secondesAvant(date: Date): number {
    return Math.max(1, Math.ceil((date.getTime() - Date.now()) / MS_PAR_SECONDE));
  }

  private rehacherEnArrierePlan(utilisateurId: string, tenantId: string, motDePasseClair: string): void {
    this.servicePwd
      .hacher(motDePasseClair)
      .then((nouveauHash) =>
        this.accesBase.enTenant(
          { tenantId, utilisateurId, requeteId: this.contexte.actuelOuNull()?.requeteId ?? null },
          async (tx) => {
            await tx
              .update(utilisateur)
              .set({ motDePasseHash: nouveauHash })
              .where(eq(utilisateur.id, utilisateurId));
          },
        ),
      )
      .catch((erreur: unknown) => {
        // Best-effort : un échec de rehachage ne doit jamais faire échouer le login qui vient de
        // réussir. Le prochain login réussi retentera.
        this.logger.warn(`Échec non bloquant de rehachage Argon2 (utilisateurId=${utilisateurId}) : ${String(erreur)}`);
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
    try {
      await this.accesAmorcage.journaliserSecurite({
        type,
        tenantId,
        utilisateurId,
        emailTente,
        ip,
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
