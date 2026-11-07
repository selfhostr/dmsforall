/**
 * Implémentation de `ServiceSession` (contrat gelé étape 0, §2.10).
 *
 * Le jeton en clair (32 octets CSPRNG, base64url) n'existe QUE dans la valeur rendue par
 * `ouvrir()` (destinée au cookie et à la réponse) et dans le cookie du navigateur. Seule son
 * empreinte SHA-256 est écrite en base (`session.empreinte_token`, voir
 * `apps/api/src/db/schema/session.ts`).
 *
 * Deux modes d'accès base bien distincts, conformément à `AccesAmorcage` (§2.8) :
 * - `ouvrir()`/`fermer()` connaissent déjà le tenant (celui de l'utilisateur qui vient de
 *   s'authentifier / du principal courant) : ce sont des écritures normales, protégées par RLS,
 *   via `AccesBase.enTenant()` — PAS des opérations d'amorçage.
 * - `resoudre()` ne connaît PAS encore le tenant au moment de l'appel (c'est précisément ce que
 *   la requête cherche à établir à partir du seul cookie) : c'est la raison d'être de
 *   `AccesAmorcage.sessionParEmpreinte`, une des 6 opérations `SECURITY DEFINER` hors contexte
 *   tenant.
 */
import { createHash, randomBytes } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import { JETON_CONFIG } from '../../config/config.jetons';
import type { Config } from '../../config/config.types';
import { JETON_DB, JETON_DB_AMORCAGE } from '../../db/db.jetons';
import type {
  AccesAmorcage,
  AccesBase,
  ContexteTenant,
  UtilisateurAmorcage,
} from '../../db/db.types';
import { session } from '../../db/schema';
import { ServiceContexteRequete } from '../../common/contexte/contexte-requete.service';
import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';
import { ErreurSessionAbsente, ErreurSessionExpiree } from '../erreurs-auth';
import { dureeSessionMinutes, inactiviteSessionMinutes } from '../comptes-de-service';
import type { ServiceSession, SessionOuverte } from '../auth.types';

const MILLISECONDES_PAR_MINUTE = 60_000;
/** Seuil sous lequel on n'écrit pas `vu_le` à nouveau — voir le commentaire dans `resoudre()`. */
const SEUIL_TOUCHER_SESSION_MS = 60_000;

@Injectable()
export class ServiceSessionImpl implements ServiceSession {
  private readonly logger = new Logger(ServiceSessionImpl.name);

  constructor(
    @Inject(JETON_CONFIG) private readonly config: Config,
    @Inject(JETON_DB) private readonly accesBase: AccesBase,
    @Inject(JETON_DB_AMORCAGE) private readonly accesAmorcage: AccesAmorcage,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  async ouvrir(
    u: UtilisateurAmorcage,
    ip: string | null,
    ua: string | null,
  ): Promise<SessionOuverte> {
    const tokenClair = randomBytes(32).toString('base64url');
    const empreinte = this.empreinteDe(tokenClair);
    const maintenant = new Date();
    // La durée dépend de la NATURE du compte, pas de la configuration seule : un compte de service
    // (borne d'atelier) reçoit une session longue, sans quoi il faudrait retaper son mot de passe
    // devant l'atelier chaque matin — ce qui détruirait la prémisse même de l'anti-balayage du PIN
    // (RM-129). Voir `auth/comptes-de-service.ts` pour le raisonnement et le risque assumé.
    const expireLe = new Date(
      maintenant.getTime() +
        dureeSessionMinutes(u.role, this.config.SESSION_DUREE_MINUTES) * MILLISECONDES_PAR_MINUTE,
    );

    const sessionId = await this.accesBase.enTenant(
      this.contexteTenantPour(u.tenantId, u.id),
      async (tx) => {
        const [ligne] = await tx
          .insert(session)
          .values({
            tenantId: u.tenantId,
            utilisateurId: u.id,
            empreinteToken: empreinte,
            expireLe,
            vuLe: maintenant,
            ip,
            userAgent: ua,
          })
          .returning({ id: session.id });

        if (!ligne) {
          // Ne devrait jamais arriver (un INSERT sans conflit renvoie toujours sa ligne) — mais un
          // throw explicite vaut mieux qu'un `sessionId: undefined` qui se propagerait en silence.
          throw new Error('Échec de création de session : aucune ligne retournée par le INSERT.');
        }
        return ligne.id;
      },
    );

    return { tokenClair, sessionId, expireLe };
  }

  /**
   * Distinction délibérée entre les deux codes 401, sur indication d'l'équipe base de données :
   * `amorcage.session_par_empreinte` est volontairement « bête » — elle rend la ligne
   * correspondant à l'empreinte SANS filtrer expiration ni révocation, précisément pour que ce
   * service puisse distinguer :
   * - empreinte inconnue de la base                → `AUTH_SESSION_ABSENTE` (jamais eu de session)
   * - empreinte connue mais invalide (expirée,      → `AUTH_SESSION_EXPIREE` (en a eu une, plus
   *   révoquée, compte/tenant non actifs)              valide maintenant)
   * Si la fonction SQL filtrait elle-même, ces deux cas deviendraient indiscernables ici.
   */
  async resoudre(tokenClair: string): Promise<PrincipalAuthentifie | null> {
    if (!tokenClair) throw new ErreurSessionAbsente();

    const empreinte = this.empreinteDe(tokenClair);
    const s = await this.accesAmorcage.sessionParEmpreinte(empreinte);
    if (!s) throw new ErreurSessionAbsente(); // empreinte inconnue

    const maintenant = Date.now();

    if (s.revoqueeLe !== null) throw new ErreurSessionExpiree();
    if (maintenant > s.expireLe.getTime()) throw new ErreurSessionExpiree(); // expiration absolue

    const limiteInactivite =
      s.vuLe.getTime() +
      inactiviteSessionMinutes(s.role, this.config.SESSION_INACTIVITE_MINUTES) *
        MILLISECONDES_PAR_MINUTE;
    if (maintenant > limiteInactivite) throw new ErreurSessionExpiree(); // expiration glissante

    if (s.statutUtilisateur !== 'actif') throw new ErreurSessionExpiree();
    if (s.statutTenant !== 'actif') throw new ErreurSessionExpiree();

    // Effet de bord toléré (voir §2.10) : n'écrire `vu_le` que si la dernière activité connue a
    // plus de 60s, pour éviter une écriture en base à quasi CHAQUE requête authentifiée — qui
    // représente l'écrasante majorité du trafic de l'application une fois connecté.
    if (maintenant - s.vuLe.getTime() > SEUIL_TOUCHER_SESSION_MS) {
      try {
        await this.accesAmorcage.toucherSession(s.sessionId, new Date(maintenant));
      } catch (erreur) {
        // Ne jamais faire échouer une requête authentifiée parce que la mise à jour de `vu_le` a
        // échoué : la session reste valide pour CETTE requête, on retentera au prochain appel.
        this.logger.warn(
          `Échec non bloquant de toucherSession(${s.sessionId}) : ${String(erreur)}`,
        );
      }
    }

    return {
      sessionId: s.sessionId,
      tenantId: s.tenantId,
      utilisateurId: s.utilisateurId,
      role: s.role,
      langue: s.langue,
      // Toujours renseigné (`string` pour un compte de service, `null` pour une personne) — c'est
      // l'invariant sur lequel repose `siteImposeAuPrincipal()`. Résolu ICI, depuis le seul
      // cookie, jamais depuis la requête : même doctrine que le tenant, et la raison directe pour
      // laquelle une borne ne peut pas consulter les PIN d'un autre site.
      siteId: s.siteId,
      // Relue de la base à chaque requête avec le rôle (`amorcage.session_par_empreinte`) :
      // une baisse de droits prend effet immédiatement, sans attendre la fin de la session.
      capacites: s.capacites,
    };
  }

  async fermer(principal: PrincipalAuthentifie): Promise<void> {
    await this.accesBase.enTenant(
      this.contexteTenantPour(principal.tenantId, principal.utilisateurId),
      async (tx) => {
        await tx
          .update(session)
          .set({ revoqueeLe: new Date() })
          .where(
            and(eq(session.id, principal.sessionId), eq(session.tenantId, principal.tenantId)),
          );
      },
    );
  }

  private contexteTenantPour(tenantId: string, utilisateurId: string): ContexteTenant {
    return {
      tenantId,
      utilisateurId,
      requeteId: this.contexte.actuelOuNull()?.requeteId ?? null,
    };
  }

  /**
   * `empreinte` = SHA-256 (32 octets) du jeton en clair — cf. commentaire de
   * `apps/api/src/db/schema/session.ts`. On hache la représentation base64url plutôt que les
   * octets bruts : c'est la seule forme dont on dispose côté résolution (le cookie ne contient
   * que la chaîne), et l'encodage base64url est une bijection donc n'affaiblit pas l'entropie.
   */
  private empreinteDe(tokenClair: string): Buffer {
    return createHash('sha256').update(tokenClair, 'utf8').digest();
  }
}
