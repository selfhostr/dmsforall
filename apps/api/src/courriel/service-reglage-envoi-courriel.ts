import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type {
  CauseEchecEnvoiCourriel,
  EntreeModificationEnvoiCourriel,
  Langue,
  ReglageEnvoiCourriel,
  ReponseEnvoiCourriel,
  ReponseTestEnvoiCourriel,
  SourceEnvoiCourriel,
} from '@dfa/shared';

import { ErreurMetier } from '../common/erreurs';
import { Horloge } from '../common/horloge';
import { ServiceJournal } from '../common/journal/service-journal';
import { JETON_CONFIG, type Config } from '../config';
import { JETON_DB, schema, type AccesBase, type ContexteTenant } from '../db';
import { auditAtelier } from '../db/schema';
import { courrielDoitEnvoyerReellement, type ConfigSmtpResolue } from './config-courriel';
import {
  chiffrerSecret,
  decoderCleChiffrement,
  dechiffrerSecret,
  ErreurDechiffrementSecret,
} from './chiffrement-secrets';
import { FabriqueTransportSmtp } from './fabrique-transport-smtp';
import { ErreurHoteSmtpInterdit, resoudreHoteSmtp } from './garde-hote-smtp';
import { libellesCourrielEssai } from './libelles-courriel-essai';
import type { LigneParametreEnvoiCourriel } from '../db/schema/parametre-envoi-courriel';

const { parametreEnvoiCourriel: table } = schema;

/** Réglage du garage prêt à servir : mot de passe déchiffré, hôte déjà vérifié. */
export interface EnvoiGarageResolu {
  readonly smtp: ConfigSmtpResolue;
  readonly nomAffiche: string | null;
  readonly adresseReponse: string | null;
}

const CODE_ERREUR_PAR_CAUSE: Readonly<
  Record<
    CauseEchecEnvoiCourriel,
    | 'COURRIEL_AUTHENTIFICATION_ECHEC'
    | 'COURRIEL_CONNEXION_ECHEC'
    | 'COURRIEL_TLS_ECHEC'
    | 'COURRIEL_ENVOI_ECHEC'
  >
> = {
  authentification: 'COURRIEL_AUTHENTIFICATION_ECHEC',
  connexion: 'COURRIEL_CONNEXION_ECHEC',
  hote_interdit: 'COURRIEL_CONNEXION_ECHEC',
  tls: 'COURRIEL_TLS_ECHEC',
  refuse: 'COURRIEL_ENVOI_ECHEC',
  inconnue: 'COURRIEL_ENVOI_ECHEC',
};

function versReglage(ligne: LigneParametreEnvoiCourriel): ReglageEnvoiCourriel {
  return {
    hote: ligne.hote,
    port: ligne.port,
    securite: ligne.securite,
    utilisateur: ligne.utilisateur,
    motDePasseDefini: ligne.motDePasseChiffre !== null,
    adresseExpediteur: ligne.adresseExpediteur,
    nomAffiche: ligne.nomAffiche,
    adresseReponse: ligne.adresseReponse,
    dernierTest:
      ligne.dernierTestLe === null || ligne.dernierTestSucces === null
        ? null
        : {
            le: ligne.dernierTestLe.toISOString(),
            succes: ligne.dernierTestSucces,
            cause: ligne.dernierTestCause,
          },
  };
}

/**
 * Réglage d'envoi des e-mails d'un garage (`parametre_envoi_courriel`, migration 0098).
 *
 * Le tenant vient toujours du `ContexteTenant`, jamais d'un paramètre client. Le mot de passe est
 * chiffré avant d'atteindre la base et ne ressort JAMAIS de ce service sous une forme lisible par
 * l'API : seul `resoudreEnvoiGarage` le déchiffre, pour construire le transport.
 */
@Injectable()
export class ServiceReglageEnvoiCourriel {
  private readonly cle: Buffer | null;

  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_CONFIG) private readonly config: Config,
    private readonly fabrique: FabriqueTransportSmtp,
    private readonly horloge: Horloge,
    private readonly journal: ServiceJournal,
  ) {
    this.cle = config.CLE_CHIFFREMENT_SECRETS
      ? decoderCleChiffrement(config.CLE_CHIFFREMENT_SECRETS)
      : null;
  }

  private autoriserReseauPrive(): boolean {
    return this.config.NODE_ENV !== 'production' || this.config.COURRIEL_RESEAU_PRIVE_AUTORISE;
  }

  private instanceDisponible(): boolean {
    return (
      courrielDoitEnvoyerReellement(this.config) &&
      Boolean(
        this.config.SMTP_HOTE && this.config.SMTP_UTILISATEUR && this.config.SMTP_MOT_DE_PASSE,
      )
    );
  }

  private async lire(ctx: ContexteTenant): Promise<LigneParametreEnvoiCourriel | null> {
    return this.acces.enTenant(ctx, async (tx) => {
      const [ligne] = await tx.select().from(table).where(eq(table.tenantId, ctx.tenantId));
      return ligne ?? null;
    });
  }

  async obtenir(ctx: ContexteTenant): Promise<ReponseEnvoiCourriel> {
    return this.composerReponse(await this.lire(ctx));
  }

  private composerReponse(ligne: LigneParametreEnvoiCourriel | null): ReponseEnvoiCourriel {
    const instanceDisponible = this.instanceDisponible();
    const source: SourceEnvoiCourriel = ligne
      ? 'garage'
      : instanceDisponible
        ? 'instance'
        : 'aucune';
    return {
      reglage: ligne ? versReglage(ligne) : null,
      source,
      // Hors production, tout est capturé : un garage sans serveur reste utilisable pour essayer.
      configure: source !== 'aucune',
      modeCapture: this.config.NODE_ENV !== 'production',
      instanceDisponible,
      chiffrementDisponible: this.cle !== null,
    };
  }

  async modifier(
    ctx: ContexteTenant,
    entree: EntreeModificationEnvoiCourriel,
  ): Promise<ReponseEnvoiCourriel> {
    if (typeof entree.motDePasse === 'string' && this.cle === null) {
      throw new ErreurMetier(
        'COURRIEL_CLE_CHIFFREMENT_ABSENTE',
        'CLE_CHIFFREMENT_SECRETS absente : impossible de chiffrer le mot de passe.',
      );
    }

    return this.acces.enTenant(ctx, async (tx) => {
      const [avant] = await tx.select().from(table).where(eq(table.tenantId, ctx.tenantId));

      const hote = entree.hote ?? avant?.hote;
      const port = entree.port ?? avant?.port;
      const securite = entree.securite ?? avant?.securite;
      const adresseExpediteur = entree.adresseExpediteur ?? avant?.adresseExpediteur;
      const manquants = (
        [
          ['hote', hote],
          ['port', port],
          ['securite', securite],
          ['adresseExpediteur', adresseExpediteur],
        ] as const
      ).filter(([, v]) => v === undefined);
      if (manquants.length > 0) {
        throw new ErreurMetier('VALIDATION_ECHOUEE', 'Réglage d’envoi incomplet.', {
          erreurs: manquants.map(([champ]) => ({
            champ,
            code: 'obligatoire',
            message: 'Ce champ est obligatoire pour enregistrer le serveur d’envoi.',
          })),
        });
      }

      const utilisateur =
        entree.utilisateur === undefined ? (avant?.utilisateur ?? null) : entree.utilisateur;
      if (typeof entree.motDePasse === 'string' && utilisateur === null) {
        throw new ErreurMetier('VALIDATION_ECHOUEE', 'Mot de passe sans identifiant.', {
          erreurs: [
            {
              champ: 'utilisateur',
              code: 'obligatoire',
              message: 'Indiquez l’identifiant auquel ce mot de passe appartient.',
            },
          ],
        });
      }
      // Un secret ne suit pas un changement de destination : changer de serveur ou d'identifiant
      // oblige à ressaisir le mot de passe, sinon l'ancien partirait vers un hôte arbitraire.
      const destinationChangee =
        avant !== undefined &&
        ((entree.hote !== undefined && entree.hote.toLowerCase() !== avant.hote.toLowerCase()) ||
          utilisateur !== avant.utilisateur);
      let motDePasseChiffre: string | null;
      if (entree.motDePasse === null || utilisateur === null) {
        motDePasseChiffre = null;
      } else if (typeof entree.motDePasse === 'string') {
        motDePasseChiffre = chiffrerSecret(entree.motDePasse, this.cle as Buffer, ctx.tenantId);
      } else {
        motDePasseChiffre = destinationChangee ? null : (avant?.motDePasseChiffre ?? null);
      }

      const valeurs = {
        hote: hote as string,
        port: port as number,
        securite: securite as NonNullable<typeof securite>,
        utilisateur,
        motDePasseChiffre,
        adresseExpediteur: adresseExpediteur as string,
        nomAffiche:
          entree.nomAffiche === undefined ? (avant?.nomAffiche ?? null) : entree.nomAffiche,
        adresseReponse:
          entree.adresseReponse === undefined
            ? (avant?.adresseReponse ?? null)
            : entree.adresseReponse,
        // Tout changement invalide le dernier test : il portait sur un autre réglage.
        dernierTestLe: null,
        dernierTestSucces: null,
        dernierTestCause: null,
      };
      const [apres] = await tx
        .insert(table)
        .values({ tenantId: ctx.tenantId, ...valeurs })
        .onConflictDoUpdate({ target: table.tenantId, set: valeurs })
        .returning();
      if (!apres)
        throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Garage introuvable pour cette session.');

      // Journal d'audit : jamais le secret, seulement « défini / non défini ».
      const champs: ReadonlyArray<readonly [string, unknown, unknown]> = [
        ['envoi_courriel.hote', avant?.hote ?? null, apres.hote],
        ['envoi_courriel.port', avant?.port ?? null, apres.port],
        ['envoi_courriel.securite', avant?.securite ?? null, apres.securite],
        ['envoi_courriel.utilisateur', avant?.utilisateur ?? null, apres.utilisateur],
        [
          'envoi_courriel.mot_de_passe_defini',
          avant ? avant.motDePasseChiffre !== null : false,
          apres.motDePasseChiffre !== null,
        ],
        ['envoi_courriel.mot_de_passe_remplace', false, typeof entree.motDePasse === 'string'],
        [
          'envoi_courriel.adresse_expediteur',
          avant?.adresseExpediteur ?? null,
          apres.adresseExpediteur,
        ],
        ['envoi_courriel.nom_affiche', avant?.nomAffiche ?? null, apres.nomAffiche],
        ['envoi_courriel.adresse_reponse', avant?.adresseReponse ?? null, apres.adresseReponse],
      ];
      for (const [champ, valeurAvant, valeurApres] of champs) {
        if (valeurAvant === valeurApres) continue;
        await tx.insert(auditAtelier).values({
          tenantId: ctx.tenantId,
          entite: 'tenant',
          entiteId: ctx.tenantId,
          action: 'modification',
          champ,
          valeurAvant,
          valeurApres,
          utilisateurId: ctx.utilisateurId,
          requeteId: ctx.requeteId,
        });
      }
      return this.composerReponse(apres);
    });
  }

  /** Retire le réglage du garage : il retombe sur le serveur de l'instance, s'il y en a un. */
  async reinitialiser(ctx: ContexteTenant): Promise<ReponseEnvoiCourriel> {
    await this.acces.enTenant(ctx, async (tx) => {
      const supprimees = await tx
        .delete(table)
        .where(eq(table.tenantId, ctx.tenantId))
        .returning({ hote: table.hote });
      if (supprimees.length === 0) return;
      await tx.insert(auditAtelier).values({
        tenantId: ctx.tenantId,
        entite: 'tenant',
        entiteId: ctx.tenantId,
        action: 'modification',
        champ: 'envoi_courriel.reglage',
        valeurAvant: 'garage',
        valeurApres: null,
        utilisateurId: ctx.utilisateurId,
        requeteId: ctx.requeteId,
      });
    });
    return this.composerReponse(null);
  }

  /**
   * Réglage du garage prêt à servir, ou `null` s'il n'en a pas. Lève `ErreurHoteSmtpInterdit` si
   * l'hôte vise un réseau privé en production, `ErreurDechiffrementSecret` si le secret est illisible.
   */
  async resoudreEnvoiGarage(ctx: ContexteTenant): Promise<EnvoiGarageResolu | null> {
    const ligne = await this.lire(ctx);
    return ligne ? this.resoudre(ctx.tenantId, ligne) : null;
  }

  private async resoudre(
    tenantId: string,
    ligne: LigneParametreEnvoiCourriel,
  ): Promise<EnvoiGarageResolu> {
    const hoteResolu = await resoudreHoteSmtp(ligne.hote, this.autoriserReseauPrive());
    let motDePasse = '';
    if (ligne.motDePasseChiffre !== null) {
      if (this.cle === null) throw new ErreurDechiffrementSecret();
      motDePasse = dechiffrerSecret(ligne.motDePasseChiffre, this.cle, tenantId);
    }
    return {
      smtp: {
        hote: ligne.hote,
        port: ligne.port,
        securise: ligne.securite === 'tls_implicite',
        securite: ligne.securite,
        sansAuthentification: ligne.utilisateur === null,
        utilisateur: ligne.utilisateur ?? '',
        motDePasse,
        expediteur: ligne.adresseExpediteur,
        adresseConnexion: hoteResolu.adresse,
      },
      nomAffiche: ligne.nomAffiche,
      adresseReponse: ligne.adresseReponse,
    };
  }

  /**
   * Envoie un e-mail d'essai avec le réglage ENREGISTRÉ du garage. L'envoi est réel même hors
   * production : c'est un geste explicite de la direction, vers une seule adresse qu'elle saisit,
   * et sans lui un réglage ne pourrait jamais être vérifié avant la mise en service. Le résultat
   * (réussi ou non, jamais le détail du serveur) est conservé pour l'écran.
   */
  async tester(
    ctx: ContexteTenant,
    destinataire: string,
    langue: Langue,
  ): Promise<ReponseTestEnvoiCourriel> {
    const { ligne, raisonSociale } = await this.acces.enTenant(ctx, async (tx) => {
      const [l] = await tx.select().from(table).where(eq(table.tenantId, ctx.tenantId));
      const [t] = await tx
        .select({ raisonSociale: schema.tenant.raisonSociale })
        .from(schema.tenant)
        .where(eq(schema.tenant.id, ctx.tenantId));
      return { ligne: l ?? null, raisonSociale: t?.raisonSociale ?? '' };
    });
    if (ligne === null) {
      throw new ErreurMetier(
        'COURRIEL_NON_CONFIGURE',
        'Aucun serveur d’envoi enregistré pour ce garage : enregistrez le réglage avant de tester.',
      );
    }

    let cause: CauseEchecEnvoiCourriel | null = null;
    try {
      const garage = await this.resoudre(ctx.tenantId, ligne);
      const { sujet, texte } = libellesCourrielEssai(langue, ligne.nomAffiche ?? raisonSociale);
      const resultat = await this.fabrique.creer(garage.smtp).envoyer({
        de: ligne.adresseExpediteur,
        nomExpediteurAffiche: ligne.nomAffiche ?? raisonSociale,
        repondreA: ligne.adresseReponse ?? ligne.adresseExpediteur,
        destinataires: [destinataire],
        sujet,
        corpsTexte: texte,
      });
      if (!resultat.succes) cause = resultat.cause ?? 'inconnue';
    } catch (erreur) {
      cause =
        erreur instanceof ErreurHoteSmtpInterdit ? 'hote_interdit' : classerExceptionLocale(erreur);
    }

    await this.acces.enTenant(ctx, async (tx) => {
      await tx
        .update(table)
        .set({
          dernierTestLe: this.horloge.maintenant(),
          dernierTestSucces: cause === null,
          dernierTestCause: cause,
        })
        .where(eq(table.tenantId, ctx.tenantId));
    });
    // Jamais l'adresse du destinataire ni le message du serveur dans le journal courant.
    this.journal.info('Essai d’envoi de courriel', { reussi: cause === null, cause });

    if (cause !== null) {
      throw new ErreurMetier(CODE_ERREUR_PAR_CAUSE[cause], `Essai d’envoi échoué (${cause}).`);
    }
    return { envoyeLe: this.horloge.maintenant().toISOString() };
  }
}

/** Échec local (DNS, secret illisible) : le code Node `ENOTFOUND` etc. est une panne de connexion. */
function classerExceptionLocale(erreur: unknown): CauseEchecEnvoiCourriel {
  if (erreur instanceof ErreurDechiffrementSecret) return 'authentification';
  const code = (erreur as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT)$/.test(code)
    ? 'connexion'
    : 'inconnue';
}
