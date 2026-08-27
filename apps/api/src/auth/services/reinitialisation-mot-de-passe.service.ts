/**
 * Implémentation de `ServiceReinitialisationMotDePasse` (voir `auth.types.ts`) — réinitialisation
 * de mot de passe en LIBRE-SERVICE (« mot de passe oublié »), distincte de la réinitialisation
 * d'accès par un admin/direction (`socle/service-utilisateur.ts::reinitialiserAcces`).
 *
 * Trois pièges classiques de ce genre de flux, traités explicitement :
 *  1. anti-énumération — `demander()` ne révèle JAMAIS si l'email correspond à un compte réel
 *     (même réponse, même absence d'exception, dans tous les cas) ; `confirmer()` lève TOUJOURS
 *     la même erreur générique pour toute issue négative (email inconnu, jeton invalide/expiré/
 *     déjà utilisé, compte/tenant suspendu).
 *  2. usage unique + expiration courte — `utilise_le`/`expire_le`
 *     (`db/schema/jeton-reinitialisation-mot-de-passe.ts`), et un jeton plus ancien encore valide
 *     est révoqué dès qu'une nouvelle demande aboutit (un seul jeton vivant à la fois par compte).
 *  3. révocation des sessions en cours — `confirmer()` révoque TOUTES les sessions actives de
 *     l'utilisateur en cas de succès (sinon un attaquant qui avait déjà une session la garde
 *     après que la victime a repris son compte).
 *
 * PAS de `verifierLeurre()` ici (contrairement à `authentification.service.ts`) : la vérification
 * du jeton compare une empreinte SHA-256 via un SELECT indexé, pas un hash Argon2 — il n'existe
 * aucun coût CPU différentiel entre « jeton inconnu » et « jeton invalide » à égaliser. Le seul
 * coût Argon2 de ce flux (`hacher()` du nouveau mot de passe) n'est payé qu'APRÈS que le jeton a
 * été prouvé valide, donc jamais observable par un appelant qui ne le connaît pas déjà.
 */
import { createHash, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type {
  EntreeConfirmationReinitialisationMotDePasse,
  EntreeDemandeReinitialisationMotDePasse,
  TypeEvenementSecurite,
} from '@dfa/shared';

import { JETON_CONFIG } from '../../config/config.jetons';
import type { Config } from '../../config/config.types';
import { ServiceCourriel } from '../../courriel';
import { EXPEDITEUR_DFA_PAR_DEFAUT } from '../../courriel/config-courriel';
import { JETON_DB, JETON_DB_AMORCAGE } from '../../db/db.jetons';
import type { AccesAmorcage, AccesBase, ContexteTenant, TransactionDfa } from '../../db/db.types';
import { jetonReinitialisationMotDePasse, session, tenant, utilisateur } from '../../db/schema';
import { ServiceContexteRequete } from '../../common/contexte/contexte-requete.service';
import { JETON_SERVICE_LIMITATION_DEBIT } from '../../common/limitation/limitation-debit.jetons';
import type { ServiceLimitationDebit } from '../../common/limitation/limitation-debit.types';
import { libellesReinitialisationMotDePasse } from '../libelles-reinitialisation-mot-de-passe';
import { ServicePolitiqueMotDePasse } from '../politique-mot-de-passe';
import { JETON_SERVICE_MOT_DE_PASSE } from '../jetons';
import type { ServiceMotDePasse, ServiceReinitialisationMotDePasse } from '../auth.types';
import { ErreurJetonReinitialisationInvalide, ErreurTropDeTentatives } from '../erreurs-auth';

/** Volontairement court : un lien de réinitialisation qui reste valide des heures est une
 *  fenêtre d'attaque sur une boîte courriel compromise, pas un confort utilisateur — voir
 *  `schemaMotDePasseNouveau` (`@dfa/shared`) pour le raisonnement complet sur la politique. */
const DUREE_JETON_REINITIALISATION_MINUTES = 30;
const MS_PAR_MINUTE = 60_000;

@Injectable()
export class ServiceReinitialisationMotDePasseImpl implements ServiceReinitialisationMotDePasse {
  private readonly logger = new Logger(ServiceReinitialisationMotDePasseImpl.name);

  constructor(
    @Inject(JETON_CONFIG) private readonly config: Config,
    @Inject(JETON_DB) private readonly accesBase: AccesBase,
    @Inject(JETON_DB_AMORCAGE) private readonly accesAmorcage: AccesAmorcage,
    @Inject(JETON_SERVICE_MOT_DE_PASSE) private readonly servicePwd: ServiceMotDePasse,
    @Inject(JETON_SERVICE_LIMITATION_DEBIT) private readonly limiteur: ServiceLimitationDebit,
    // Injecté par classe, comme partout ailleurs où `ServiceCourriel` est consommé (voir son
    // en-tête : « ces usages viendront plus tard, par d'autres modules qui injecteront
    // ServiceCourriel ») — pas de jeton dédié, `CourrielModule` exporte la classe elle-même.
    private readonly courriel: ServiceCourriel,
    private readonly politique: ServicePolitiqueMotDePasse,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  async demander(
    entree: EntreeDemandeReinitialisationMotDePasse,
    ip: string | null,
    ua: string | null,
  ): Promise<void> {
    const email = entree.email.trim().toLowerCase();

    await this.verifierLimitationDebit('demande', 'ip', ip);
    // Budget PAR EMAIL consommé sur TOUTE tentative (succès compris), contrairement au budget
    // équivalent de la connexion : ici, la ressource protégée n'est pas « empêcher de deviner un
    // mot de passe » mais « empêcher qu'on fasse recevoir des courriels en boucle au titulaire de
    // cette adresse » — ce risque existe QUE l'email corresponde à un compte réel ou non.
    await this.verifierLimitationDebit('demande', 'email', email);

    const u = await this.accesAmorcage.utilisateurParEmail(email);

    if (!u || u.statut !== 'actif' || u.statutTenant !== 'actif') {
      await this.journaliser(
        'reinitialisation_echouee',
        u?.tenantId ?? null,
        u?.id ?? null,
        email,
        ip,
        ua,
        {
          etape: 'demande',
          raison: !u
            ? 'email_inconnu'
            : u.statut !== 'actif'
              ? 'compte_suspendu'
              : 'tenant_suspendu',
        },
      );
      return; // anti-énumération : réponse identique au cas réussi, voir l'en-tête du fichier.
    }

    const tokenClair = randomBytes(32).toString('base64url');
    const empreinte = this.empreinteDe(tokenClair);
    const expireLe = new Date(Date.now() + DUREE_JETON_REINITIALISATION_MINUTES * MS_PAR_MINUTE);
    const ctx: ContexteTenant = {
      tenantId: u.tenantId,
      utilisateurId: u.id,
      requeteId: this.contexte.actuelOuNull()?.requeteId ?? null,
    };

    const raisonSociale = await this.accesBase.enTenant(ctx, async (tx) => {
      // Un seul jeton vivant à la fois par compte : une demande plus récente invalide toute
      // demande antérieure encore valide, sans quoi plusieurs liens resteraient utilisables en
      // parallèle (ex. plusieurs demandes accidentelles) — voir l'en-tête de ce fichier.
      await this.revoquerJetonsActifsDansTransaction(tx, ctx, u.id);

      await tx.insert(jetonReinitialisationMotDePasse).values({
        tenantId: u.tenantId,
        utilisateurId: u.id,
        empreinteJeton: empreinte,
        expireLe,
        ip,
        userAgent: ua,
      });

      const [ligneTenant] = await tx
        .select({ raisonSociale: tenant.raisonSociale })
        .from(tenant)
        .where(eq(tenant.id, u.tenantId));
      return ligneTenant?.raisonSociale ?? 'dmsforall';
    });

    await this.journaliser('reinitialisation_demandee', u.tenantId, u.id, email, ip, ua, {
      etape: 'demande',
    });

    const lien = this.construireLien(email, tokenClair);
    const libelles = libellesReinitialisationMotDePasse(u.langue);
    try {
      const resultat = await this.courriel.envoyer({
        destinataires: [email],
        sujet: libelles.sujet,
        corpsTexte: libelles.corpsTexte(lien, DUREE_JETON_REINITIALISATION_MINUTES),
        nomGarage: raisonSociale,
        // Un courriel de sécurité du SOCLE (pas une correspondance du garage avec son client) :
        // aucune adresse de garage n'est pertinente comme Reply-To ici — même adresse technique
        // que l'expéditeur (voir l'en-tête de `courriel/config-courriel.ts` : `no-reply@dmsforall.example`).
        adresseReponseGarage: this.config.SMTP_EXPEDITEUR ?? EXPEDITEUR_DFA_PAR_DEFAUT,
      });
      if (!resultat.succes) {
        // Best-effort : le jeton existe déjà en base et reste valide 30 minutes — un nouvel
        // appel à /auth/mot-de-passe/oubli (ou l'expiration naturelle) reste le chemin de
        // récupération, jamais une 500 qui romprait l'anti-énumération de cet endpoint.
        this.logger.warn(
          `Échec d'envoi du courriel de réinitialisation (utilisateurId=${u.id}) : ${resultat.erreur}`,
        );
      }
    } catch (erreur) {
      this.logger.error(
        `Erreur inattendue à l'envoi du courriel de réinitialisation (utilisateurId=${u.id}) : ${String(erreur)}`,
      );
    }
  }

  async confirmer(
    entree: EntreeConfirmationReinitialisationMotDePasse,
    ip: string | null,
    ua: string | null,
  ): Promise<void> {
    const email = entree.email.trim().toLowerCase();

    await this.verifierLimitationDebit('confirmation', 'ip', ip);

    const u = await this.accesAmorcage.utilisateurParEmail(email);

    if (!u || u.statut !== 'actif' || u.statutTenant !== 'actif') {
      await this.verifierLimitationDebit('confirmation', 'email', email);
      await this.journaliser(
        'reinitialisation_echouee',
        u?.tenantId ?? null,
        u?.id ?? null,
        email,
        ip,
        ua,
        {
          etape: 'confirmation',
          raison: !u
            ? 'email_inconnu'
            : u.statut !== 'actif'
              ? 'compte_suspendu'
              : 'tenant_suspendu',
        },
      );
      throw new ErreurJetonReinitialisationInvalide();
    }

    const empreinte = this.empreinteDe(entree.jeton);
    const ctx: ContexteTenant = {
      tenantId: u.tenantId,
      utilisateurId: u.id,
      requeteId: this.contexte.actuelOuNull()?.requeteId ?? null,
    };

    try {
      await this.accesBase.enTenant(ctx, async (tx) => {
        // `for('update')` verrouille la ligne jusqu'au COMMIT/ROLLBACK de cette transaction —
        // même patron que `atelier/or-requetes.ts::chargerOrOuNull(pourEcriture=true)` : sans
        // lui, deux confirmations concurrentes portant le MÊME jeton pourraient toutes deux lire
        // « valide » avant qu'aucune des deux n'ait encore marqué `utilise_le`, et toutes deux
        // changer le mot de passe (TOCTOU). Le lock rend la seconde tentative concurrente bloquée
        // jusqu'à ce que la première commit — à ce moment-là, `utilise_le` n'est plus NULL, donc
        // la condition du WHERE ne matche plus rien pour elle non plus.
        const [ligne] = await tx
          .select({ id: jetonReinitialisationMotDePasse.id })
          .from(jetonReinitialisationMotDePasse)
          .where(
            and(
              eq(jetonReinitialisationMotDePasse.tenantId, u.tenantId),
              eq(jetonReinitialisationMotDePasse.utilisateurId, u.id),
              eq(jetonReinitialisationMotDePasse.empreinteJeton, empreinte),
              isNull(jetonReinitialisationMotDePasse.utiliseLe),
              isNull(jetonReinitialisationMotDePasse.revoqueLe),
              gt(jetonReinitialisationMotDePasse.expireLe, new Date()),
            ),
          )
          .limit(1)
          .for('update');

        if (!ligne) throw new ErreurJetonReinitialisationInvalide();

        // Politique de mot de passe (blocklist + email) DANS la transaction, jeton déjà verrouillé
        // mais PAS encore marqué utilisé : un refus (VALIDATION_ECHOUEE) annule la transaction et
        // laisse le jeton intact — l'employé peut réessayer avec un meilleur mot de passe SANS
        // redemander un nouveau lien, tant que les 30 minutes ne sont pas écoulées.
        this.politique.verifier(entree.nouveauMotDePasse, { email });

        const motDePasseHash = await this.servicePwd.hacher(entree.nouveauMotDePasse);

        await tx
          .update(jetonReinitialisationMotDePasse)
          .set({ utiliseLe: new Date() })
          .where(eq(jetonReinitialisationMotDePasse.id, ligne.id));

        await tx
          .update(session)
          .set({ revoqueeLe: new Date() })
          .where(
            and(
              eq(session.tenantId, u.tenantId),
              eq(session.utilisateurId, u.id),
              isNull(session.revoqueeLe),
            ),
          );

        await tx
          .update(utilisateur)
          .set({ motDePasseHash, echecsConnexion: 0, verrouilleJusquA: null })
          .where(and(eq(utilisateur.tenantId, u.tenantId), eq(utilisateur.id, u.id)));
      });
    } catch (erreur) {
      if (erreur instanceof ErreurJetonReinitialisationInvalide) {
        await this.verifierLimitationDebit('confirmation', 'email', email);
        await this.journaliser('reinitialisation_echouee', u.tenantId, u.id, email, ip, ua, {
          etape: 'confirmation',
          raison: 'jeton_invalide',
        });
      }
      // Toute autre erreur (dont VALIDATION_ECHOUEE, mot de passe refusé) : pas de budget email
      // consommé, pas de journal d'échec dédié — le jeton reste utilisable, ce n'est pas une
      // tentative suspecte à comptabiliser comme telle.
      throw erreur;
    }

    await this.journaliser('reinitialisation_reussie', u.tenantId, u.id, email, ip, ua, {
      etape: 'confirmation',
    });
  }

  async revoquerJetonsActifsDansTransaction(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    utilisateurId: string,
  ): Promise<void> {
    await tx
      .update(jetonReinitialisationMotDePasse)
      .set({ revoqueLe: new Date() })
      .where(
        and(
          eq(jetonReinitialisationMotDePasse.tenantId, ctx.tenantId),
          eq(jetonReinitialisationMotDePasse.utilisateurId, utilisateurId),
          isNull(jetonReinitialisationMotDePasse.utiliseLe),
          isNull(jetonReinitialisationMotDePasse.revoqueLe),
        ),
      );
  }

  private construireLien(email: string, tokenClair: string): string {
    const base = this.config.WEB_URL_PUBLIQUE.replace(/\/+$/, '');
    const params = new URLSearchParams({ email, jeton: tokenClair });
    return `${base}/reinitialiser-mot-de-passe?${params.toString()}`;
  }

  private empreinteDe(valeurClair: string): Buffer {
    return createHash('sha256').update(valeurClair, 'utf8').digest();
  }

  /**
   * Budgets Redis dédiés à ce flux — clés distinctes de celles de la connexion
   * (`auth:connexion:*`), MÊMES valeurs numériques de configuration (LIMITE_CONNEXION_IP/
   * LIMITE_CONNEXION_COMPTE/LIMITE_FENETRE_SECONDES) : pas de nouvelle variable d'environnement
   * pour un besoin qui n'a pas de raison métier de diverger — un budget anti-abus générique,
   * pas un second dispositif indépendant comme SEUIL_VERROUILLAGE_COMPTE/LIMITE_CONNEXION_COMPTE
   * (voir `charger-config.ts` pour pourquoi CE couple-là, lui, doit rester distinct).
   */
  private async verifierLimitationDebit(
    etape: 'demande' | 'confirmation',
    portee: 'ip' | 'email',
    valeur: string | null,
  ): Promise<void> {
    if (valeur === null) return;
    const limite =
      portee === 'ip' ? this.config.LIMITE_CONNEXION_IP : this.config.LIMITE_CONNEXION_COMPTE;
    const resultat = await this.limiteur.consommer(
      `auth:reinit-${etape}:${portee}:${valeur}`,
      limite,
      this.config.LIMITE_FENETRE_SECONDES,
    );
    if (!resultat.autorise) {
      throw new ErreurTropDeTentatives(
        resultat.resteSecondes ?? this.config.LIMITE_FENETRE_SECONDES,
      );
    }
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
    // Défense en profondeur (même garde qu'`authentification.service.ts::journaliser`) : une IP
    // malformée ferait échouer le `::inet` côté base et ferait disparaître l'ÉVÉNEMENT ENTIER
    // dans le catch ci-dessous, pas seulement l'IP.
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
      this.logger.error(`Échec de journalisation sécurité (type=${type}) : ${String(erreur)}`);
    }
  }
}
