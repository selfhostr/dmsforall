/**
 * Installation d'une instance neuve : code d'installation et création du premier garage.
 *
 * Règles de sécurité (instance exposée avant que son propriétaire n'arrive) :
 *  - le code n'existe en clair que dans les journaux de l'API au démarrage ; la base n'en garde
 *    que l'empreinte salée (`amorcage.code_installation`, migration 0099), visible du seul rôle
 *    propriétaire. Il change à chaque démarrage tant qu'aucun garage n'existe et disparaît dès
 *    qu'un garage existe ;
 *  - création sérialisée par un verrou consultatif de session : deux requêtes simultanées ne
 *    créent jamais deux garages, la seconde voit le premier et reçoit `INSTALLATION_DEJA_FAITE` ;
 *  - comparaison en temps constant, limitation de débit par IP et globale, avant tout calcul coûteux ;
 *  - la création elle-même est `creerGarage` (la fonction du CLI `creer-garage`) : mêmes valeurs
 *    par défaut, mêmes refus.
 *
 * Seul le processus API appelle `preparerCodeDemarrage` (voir `main.ts`), jamais le worker : le
 * code vit donc dans UN seul processus qui l'écrit et l'affiche. Plusieurs réplicas d'API
 * s'écraseraient mutuellement le code à leur démarrage : on ne déploie qu'une API par base.
 */
import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { EntreePremierGarage } from '@dfa/shared';

import { ErreurCreerGarage, creerGarage } from '../cli/creer-garage.service';
import { ErreurMetier } from '../common/erreurs';
import { JETON_SERVICE_LIMITATION_DEBIT } from '../common/limitation/limitation-debit.jetons';
import type { ServiceLimitationDebit } from '../common/limitation/limitation-debit.types';
import { JETON_SERVICE_MOT_DE_PASSE } from '../auth/jetons';
import type { ServiceMotDePasse } from '../auth/auth.types';
import { JETON_CONFIG } from '../config/config.jetons';
import type { Config } from '../config/config.types';
import {
  codeInstallationCorrespond,
  empreinterCodeInstallation,
  genererCodeInstallation,
} from './code-installation';
import {
  JETON_CONNEXION_INSTALLATION,
  type ConnexionInstallation,
  type FournisseurConnexionInstallation,
} from './installation.types';

/** Verrou consultatif de session propre à l'installation (distinct de celui des migrations). */
const VERROU_INSTALLATION = '4820251104';
/** Tentatives de création autorisées par IP et par fenêtre (`LIMITE_FENETRE_SECONDES`). */
const LIMITE_PAR_IP = 5;
/** Plafond tous clients confondus : borne une attaque répartie sur de nombreuses adresses. */
const LIMITE_GLOBALE = 30;

export interface ResultatPremierGarage {
  readonly email: string;
}

@Injectable()
export class ServiceInstallation implements OnModuleDestroy {
  private readonly logger = new Logger(ServiceInstallation.name);
  /** Un garage existe : état définitif pour la vie du processus, plus aucune requête base. */
  private garageExiste = false;

  constructor(
    @Inject(JETON_CONNEXION_INSTALLATION)
    private readonly connexions: FournisseurConnexionInstallation,
    @Inject(JETON_SERVICE_MOT_DE_PASSE) private readonly motDePasse: ServiceMotDePasse,
    @Inject(JETON_SERVICE_LIMITATION_DEBIT) private readonly limiteur: ServiceLimitationDebit,
    @Inject(JETON_CONFIG) private readonly config: Config,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.connexions.fermer();
  }

  /** `GET /installation/etat`. */
  async premierGarageRequis(): Promise<boolean> {
    if (this.garageExiste) return false;
    const connexion = await this.connexions.emprunter();
    try {
      const existe = await this.unGarageExiste(connexion);
      if (existe) this.garageExiste = true;
      connexion.liberer(false);
      return !existe;
    } catch (erreur) {
      connexion.liberer(true);
      throw erreur;
    }
  }

  /**
   * Au démarrage de l'API : sans garage, tire un nouveau code, n'en stocke que l'empreinte et
   * l'affiche dans les journaux ; avec un garage, supprime tout code restant. Rend le code en
   * clair (ou `null`) pour que l'appelant l'affiche — il n'est conservé nulle part ailleurs.
   */
  async preparerCodeDemarrage(): Promise<string | null> {
    const connexion = await this.connexions.emprunter();
    let detruire = false;
    try {
      await connexion.query('select pg_advisory_lock($1::bigint)', [VERROU_INSTALLATION]);
      try {
        if (await this.unGarageExiste(connexion)) {
          this.garageExiste = true;
          await connexion.query('delete from amorcage.code_installation');
          return null;
        }
        const code = genererCodeInstallation();
        const { sel, empreinte } = empreinterCodeInstallation(code);
        await connexion.query(
          `insert into amorcage.code_installation (singleton, sel, empreinte)
           values (true, $1, $2)
           on conflict (singleton) do update
             set sel = excluded.sel, empreinte = excluded.empreinte, cree_le = now()`,
          [sel, empreinte],
        );
        return code;
      } finally {
        detruire = !(await this.deverrouiller(connexion));
      }
    } catch (erreur) {
      detruire = true;
      throw erreur;
    } finally {
      connexion.liberer(detruire);
    }
  }

  /** `POST /installation/premier-garage`. Lève `ErreurMetier` pour tout refus attendu. */
  async creerPremierGarage(
    entree: EntreePremierGarage,
    ip: string | null,
  ): Promise<ResultatPremierGarage> {
    await this.limiterDebit(ip);

    const connexion = await this.connexions.emprunter();
    let detruire = false;
    try {
      await connexion.query('select pg_advisory_lock($1::bigint)', [VERROU_INSTALLATION]);
      try {
        if (await this.unGarageExiste(connexion)) {
          this.garageExiste = true;
          throw this.erreurDejaFaite();
        }
        await this.verifierCode(connexion, entree.codeInstallation);

        const resultat = await creerGarage(
          connexion,
          {
            garage: entree.garage,
            email: entree.email,
            motDePasse: entree.motDePasse,
            prenom: entree.prenom,
            nom: entree.nom,
            source: 'web',
          },
          (clair) => this.motDePasse.hacher(clair),
        );
        this.garageExiste = true;
        await connexion.query('delete from amorcage.code_installation');
        this.logger.log(`First garage created from the web (tenant ${resultat.tenantId}).`);
        return { email: resultat.email };
      } finally {
        detruire = !(await this.deverrouiller(connexion));
      }
    } catch (erreur) {
      if (erreur instanceof ErreurCreerGarage) throw this.traduireErreurCreation(erreur);
      throw erreur;
    } finally {
      connexion.liberer(detruire);
    }
  }

  private async unGarageExiste(connexion: ConnexionInstallation): Promise<boolean> {
    const { rows } = await connexion.query('select exists (select 1 from tenant) as existe');
    return rows[0]?.existe === true;
  }

  /** `false` si le verrou n'a pas pu être rendu : la connexion doit alors être détruite. */
  private async deverrouiller(connexion: ConnexionInstallation): Promise<boolean> {
    try {
      await connexion.query('select pg_advisory_unlock($1::bigint)', [VERROU_INSTALLATION]);
      return true;
    } catch (erreur) {
      this.logger.error(`Could not release the installation lock: ${String(erreur)}`);
      return false;
    }
  }

  private async verifierCode(connexion: ConnexionInstallation, saisie: string): Promise<void> {
    const { rows } = await connexion.query(
      'select sel, empreinte from amorcage.code_installation where singleton',
    );
    const ligne = rows[0];
    const stocke =
      ligne && Buffer.isBuffer(ligne.sel) && Buffer.isBuffer(ligne.empreinte)
        ? { sel: ligne.sel, empreinte: ligne.empreinte }
        : null;
    // Sans code stocké on compare quand même à une empreinte factice : même travail, même durée.
    const correspond = codeInstallationCorrespond(
      saisie,
      stocke ?? empreinterCodeInstallation(genererCodeInstallation()),
    );
    if (stocke === null || !correspond) {
      throw new ErreurMetier('INSTALLATION_CODE_INVALIDE', "Code d'installation invalide.");
    }
  }

  private async limiterDebit(ip: string | null): Promise<void> {
    const fenetre = this.config.LIMITE_FENETRE_SECONDES;
    const limites: ReadonlyArray<readonly [string, number]> = [
      [`installation:ip:${ip ?? 'inconnue'}`, LIMITE_PAR_IP],
      ['installation:global', LIMITE_GLOBALE],
    ];
    for (const [cle, limite] of limites) {
      const resultat = await this.limiteur.consommer(cle, limite, fenetre);
      if (!resultat.autorise) {
        const attente = resultat.resteSecondes > 0 ? resultat.resteSecondes : fenetre;
        throw new ErreurMetier(
          'AUTH_TROP_DE_TENTATIVES',
          "Trop de tentatives d'installation, réessayez plus tard.",
          { enTetes: { 'Retry-After': String(attente) } },
        );
      }
    }
  }

  private erreurDejaFaite(): ErreurMetier {
    return new ErreurMetier('INSTALLATION_DEJA_FAITE', 'Un garage existe déjà sur cette instance.');
  }

  /** Les refus de `creerGarage` deviennent des erreurs métier typées (problem+json). */
  private traduireErreurCreation(erreur: ErreurCreerGarage): ErreurMetier {
    switch (erreur.code) {
      case 'GARAGE_INVALIDE':
        return this.erreurChamp('garage', erreur);
      case 'COURRIEL_INVALIDE':
        return this.erreurChamp('email', erreur);
      case 'MOT_DE_PASSE_FAIBLE':
        return this.erreurChamp('motDePasse', erreur);
      case 'GARAGE_EXISTANT':
        return this.erreurDejaFaite();
      case 'COURRIEL_EXISTANT':
        return new ErreurMetier('CONFLIT', 'Cette adresse e-mail est déjà utilisée.');
    }
  }

  private erreurChamp(champ: string, erreur: ErreurCreerGarage): ErreurMetier {
    return new ErreurMetier('VALIDATION_ECHOUEE', 'Validation échouée.', {
      erreurs: [{ champ, code: erreur.code, message: erreur.message }],
    });
  }
}
