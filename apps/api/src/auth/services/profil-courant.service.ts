/**
 * Gestes de la personne connectée sur SON PROPRE compte : changer son mot de passe (issue #58) et
 * choisir sa langue d'interface (issue #62).
 *
 * L'identité (tenant + utilisateur) vient EXCLUSIVEMENT du principal résolu depuis le cookie de
 * session -- jamais d'un paramètre de requête, donc aucun moyen d'agir sur le compte d'autrui ni
 * d'un autre tenant.
 */
import { isIP } from 'node:net';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull, ne } from 'drizzle-orm';
import type {
  EntreeChangementLangue,
  EntreeChangementMotDePasse,
  TypeEvenementSecurite,
} from '@dfa/shared';

import { JETON_CONFIG } from '../../config/config.jetons';
import type { Config } from '../../config/config.types';
import { JETON_DB, JETON_DB_AMORCAGE } from '../../db/db.jetons';
import type { AccesAmorcage, AccesBase } from '../../db/db.types';
import { session, utilisateur } from '../../db/schema';
import { ServiceContexteRequete } from '../../common/contexte/contexte-requete.service';
import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';
import { JETON_SERVICE_LIMITATION_DEBIT } from '../../common/limitation/limitation-debit.jetons';
import type { ServiceLimitationDebit } from '../../common/limitation/limitation-debit.types';
import { ErreurMetier } from '../../common/erreurs';
import { JETON_SERVICE_MOT_DE_PASSE } from '../jetons';
import { ServicePolitiqueMotDePasse } from '../politique-mot-de-passe';
import type { ServiceMotDePasse } from '../auth.types';
import { ErreurSessionExpiree, ErreurTropDeTentatives } from '../erreurs-auth';

@Injectable()
export class ServiceProfilCourant {
  private readonly logger = new Logger(ServiceProfilCourant.name);

  constructor(
    @Inject(JETON_CONFIG) private readonly config: Config,
    @Inject(JETON_DB) private readonly accesBase: AccesBase,
    @Inject(JETON_DB_AMORCAGE) private readonly accesAmorcage: AccesAmorcage,
    @Inject(JETON_SERVICE_MOT_DE_PASSE) private readonly servicePwd: ServiceMotDePasse,
    @Inject(JETON_SERVICE_LIMITATION_DEBIT) private readonly limiteur: ServiceLimitationDebit,
    private readonly politique: ServicePolitiqueMotDePasse,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  /**
   * Remplace le mot de passe de la personne connectée. Le mot de passe actuel est exigé. Succès :
   * `mot_de_passe_a_changer` repasse à false, les AUTRES sessions de la personne sont révoquées
   * (la session courante survit : l'employé continue sur le même écran).
   */
  async changerMotDePasse(
    principal: PrincipalAuthentifie,
    entree: EntreeChangementMotDePasse,
    ip: string | null,
    ua: string | null,
  ): Promise<void> {
    const ctx = {
      tenantId: principal.tenantId,
      utilisateurId: principal.utilisateurId,
      requeteId: this.contexte.actuelOuNull()?.requeteId ?? null,
    };

    const ligne = await this.accesBase.enTenant(ctx, async (tx) => {
      const [l] = await tx
        .select({
          email: utilisateur.email,
          motDePasseHash: utilisateur.motDePasseHash,
          motDePasseAChanger: utilisateur.motDePasseAChanger,
        })
        .from(utilisateur)
        .where(
          and(
            eq(utilisateur.id, principal.utilisateurId),
            eq(utilisateur.tenantId, principal.tenantId),
          ),
        );
      return l;
    });
    if (!ligne) throw new ErreurSessionExpiree();

    const actuelValide = await this.servicePwd.verifier(
      ligne.motDePasseHash,
      entree.motDePasseActuel,
    );
    if (!actuelValide) {
      // Budget consommé sur ÉCHEC seulement (même doctrine que la connexion) : une session volée
      // ne permet pas de deviner le mot de passe actuel pour le changer.
      const budget = await this.limiteur.consommer(
        `auth:changement-mdp:utilisateur:${principal.utilisateurId}`,
        this.config.LIMITE_CONNEXION_COMPTE,
        this.config.LIMITE_FENETRE_SECONDES,
      );
      await this.journaliser('connexion_echouee', principal, ligne.email, ip, ua, {
        raison: 'changement_mot_de_passe_actuel_invalide',
      });
      if (!budget.autorise) {
        throw new ErreurTropDeTentatives(
          budget.resteSecondes ?? this.config.LIMITE_FENETRE_SECONDES,
        );
      }
      throw new ErreurMetier('VALIDATION_ECHOUEE', 'Le mot de passe actuel est incorrect.', {
        erreurs: [
          {
            champ: 'motDePasseActuel',
            code: 'mot_de_passe_actuel_incorrect',
            message: 'Le mot de passe actuel est incorrect.',
          },
        ],
      });
    }

    if (entree.nouveauMotDePasse === entree.motDePasseActuel) {
      throw new ErreurMetier(
        'VALIDATION_ECHOUEE',
        'Le nouveau mot de passe doit être différent du mot de passe actuel.',
        {
          erreurs: [
            {
              champ: 'nouveauMotDePasse',
              code: 'mot_de_passe_identique',
              message: 'Choisissez un mot de passe différent du mot de passe temporaire.',
            },
          ],
        },
      );
    }
    this.politique.verifier(entree.nouveauMotDePasse, { email: ligne.email });

    const motDePasseHash = await this.servicePwd.hacher(entree.nouveauMotDePasse);

    await this.accesBase.enTenant(ctx, async (tx) => {
      await tx
        .update(utilisateur)
        .set({
          motDePasseHash,
          motDePasseAChanger: false,
          echecsConnexion: 0,
          verrouilleJusquA: null,
        })
        .where(
          and(
            eq(utilisateur.id, principal.utilisateurId),
            eq(utilisateur.tenantId, principal.tenantId),
          ),
        );
      await tx
        .update(session)
        .set({ revoqueeLe: new Date() })
        .where(
          and(
            eq(session.tenantId, principal.tenantId),
            eq(session.utilisateurId, principal.utilisateurId),
            ne(session.id, principal.sessionId),
            isNull(session.revoqueeLe),
          ),
        );
    });

    await this.journaliser('reinitialisation_reussie', principal, ligne.email, ip, ua, {
      etape: 'changement',
      obligatoire: ligne.motDePasseAChanger,
    });
  }

  /** Enregistre la langue d'interface dans le PROFIL de la personne connectée (issue #62). */
  async changerLangue(
    principal: PrincipalAuthentifie,
    entree: EntreeChangementLangue,
  ): Promise<void> {
    await this.accesBase.enTenant(
      {
        tenantId: principal.tenantId,
        utilisateurId: principal.utilisateurId,
        requeteId: this.contexte.actuelOuNull()?.requeteId ?? null,
      },
      async (tx) => {
        await tx
          .update(utilisateur)
          .set({ langue: entree.langue })
          .where(
            and(
              eq(utilisateur.id, principal.utilisateurId),
              eq(utilisateur.tenantId, principal.tenantId),
            ),
          );
      },
    );
  }

  private async journaliser(
    type: TypeEvenementSecurite,
    principal: PrincipalAuthentifie,
    email: string,
    ip: string | null,
    userAgent: string | null,
    details: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.accesAmorcage.journaliserSecurite({
        type,
        tenantId: principal.tenantId,
        utilisateurId: principal.utilisateurId,
        emailTente: email,
        ip: ip !== null && isIP(ip) !== 0 ? ip : null,
        userAgent,
        details,
      });
    } catch (erreur) {
      this.logger.error(`Échec de journalisation sécurité (type=${type}) : ${String(erreur)}`);
    }
  }
}
