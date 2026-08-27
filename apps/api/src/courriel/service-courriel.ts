import { Inject, Injectable } from '@nestjs/common';
import { ErreurMetier } from '../common/erreurs/erreur-metier';
import { ServiceJournal } from '../common/journal/service-journal';
import { JETON_CONFIG, type Config } from '../config';
import { EXPEDITEUR_DFA_PAR_DEFAUT } from './config-courriel';
import { JETON_TRANSPORT_COURRIEL } from './courriel.jetons';
import {
  TAILLE_MAX_PIECE_JOINTE_OCTETS,
  type PieceJointeCourriel,
  type ResultatEnvoiCourriel,
  type TransportCourriel,
} from './transport-courriel.interface';

/**
 * Message à envoyer — interface publique ÉTROITE de ce module, socle seul. Pas de gabarit HTML
 * métier, pas de logique de relance/facture/invitation : ces usages sont branchés par d'AUTRES
 * modules, plus tard, qui appellent `ServiceCourriel.envoyer`. L'i18n du sujet/corps est la
 * responsabilité de l'appelant.
 */
export interface MessageCourriel {
  readonly destinataires: readonly string[];
  readonly sujet: string;
  readonly corpsTexte?: string;
  readonly corpsHtml?: string;
  /** Nom du garage, pour le nom affiché de l'expéditeur (« <nomGarage> via dmsforall »). */
  readonly nomGarage: string;
  /** Adresse de réponse du garage — posée en `Reply-To`, jamais comme adresse d'expédition
   *  technique (voir tête de fichier `config-courriel.ts` : pas de SPF/DKIM côté garage). */
  readonly adresseReponseGarage: string;
  /** Voir `EnveloppeCourriel.piecesJointes` (`transport-courriel.interface.ts`) — taille cumulée
   *  bornée par `TAILLE_MAX_PIECE_JOINTE_OCTETS`, vérifiée par `envoyer()` ci-dessous. */
  readonly piecesJointes?: readonly PieceJointeCourriel[];
}

/**
 * Taille cumulée de `piecesJointes`, en octets — fonction pure, exportée pour être réutilisée par
 * le test de non-régression sans dupliquer le calcul.
 */
function tailleCumuleePiecesJointes(piecesJointes: readonly PieceJointeCourriel[]): number {
  return piecesJointes.reduce((total, p) => total + p.contenu.byteLength, 0);
}

/**
 * Service d'envoi de courriel — expéditeur unique multi-tenant, deux transports possibles
 * derrière `TransportCourriel` (réel ou capture), sélectionnés une fois pour toutes par
 * `courriel.module.ts` selon la config. Ce service ne sait PAS lequel des deux est actif : il ne
 * fait que construire l'enveloppe et journaliser le résultat.
 */
@Injectable()
export class ServiceCourriel {
  constructor(
    @Inject(JETON_TRANSPORT_COURRIEL) private readonly transport: TransportCourriel,
    @Inject(JETON_CONFIG) private readonly config: Config,
    private readonly journal: ServiceJournal,
  ) {}

  async envoyer(message: MessageCourriel): Promise<ResultatEnvoiCourriel> {
    const piecesJointes = message.piecesJointes ?? [];
    if (piecesJointes.length > 0) {
      const tailleTotale = tailleCumuleePiecesJointes(piecesJointes);
      if (tailleTotale > TAILLE_MAX_PIECE_JOINTE_OCTETS) {
        // Refuse AVANT tout appel réseau — voir `TAILLE_MAX_PIECE_JOINTE_OCTETS`
        // (`transport-courriel.interface.ts`) pour la justification de la borne. Jamais le nom de
        // fichier dans le message d'exception à ce niveau : `ErreurMetier.message` peut atterrir
        // dans un log `warn`/`error` (voir `FiltreProbleme`), même doctrine PII que le reste de ce
        // module.
        throw new ErreurMetier(
          'VALIDATION_ECHOUEE',
          `Pièce(s) jointe(s) trop volumineuse(s) : ${String(tailleTotale)} octet(s) au total, ` +
            `maximum ${String(TAILLE_MAX_PIECE_JOINTE_OCTETS)} octet(s).`,
        );
      }
    }

    const resultat = await this.transport.envoyer({
      // Expéditeur TOUJOURS `SMTP_EXPEDITEUR` (no-reply@dmsforall.example) — jamais dérivé du garage
      // ni de `adresseReponseGarage`, voir l'arbitrage en tête de `config-courriel.ts`.
      de: this.config.SMTP_EXPEDITEUR ?? EXPEDITEUR_DFA_PAR_DEFAUT,
      nomExpediteurAffiche: `${message.nomGarage} via dmsforall`,
      repondreA: message.adresseReponseGarage,
      destinataires: message.destinataires,
      sujet: message.sujet,
      corpsTexte: message.corpsTexte,
      corpsHtml: message.corpsHtml,
      piecesJointes: message.piecesJointes,
    });

    // Journalisation structurée du RÉSULTAT — jamais le corps complet, jamais le mot de passe
    // (qui ne transite de toute façon jamais jusqu'ici, voir `resoudreConfigSmtp`).
    //
    // Les adresses des destinataires et le sujet sont des données personnelles de clients de
    // garage : jamais à hauteur `info`/`warn` (niveau actif par défaut en production, voir
    // `LOG_NIVEAU`). Ce qui reste au niveau `info`/`warn` — succès/échec, identifiant du message,
    // nombre de destinataires — suffit à diagnostiquer un incident d'envoi sans exposer QUI a été
    // contacté ni À PROPOS DE QUOI. Le détail complet est journalisé une seconde fois en `debug`,
    // désactivé par défaut en production, pour l'investigation locale/dev quand il faut vraiment
    // relire l'adresse ou le sujet exact. `ServiceJournal` redacte aussi ces champs par défense en
    // profondeur (voir `CHAMPS_DONNEES_PERSONNELLES`), mais ne pas s'y fier comme unique garde ici
    // — le détail complet doit rester réservé à `debug`, pas juste redacté à `info`.
    // `nombrePiecesJointes` : un COMPTE, jamais un nom de fichier (voir `PieceJointeCourriel.
    // nomFichier` — potentiellement identifiant côté client) — sûr à hauteur `info`/`warn`, même
    // doctrine que `nombreDestinataires`.
    if (resultat.succes) {
      this.journal.info('Courriel envoyé', {
        idMessage: resultat.idMessage,
        nombreDestinataires: message.destinataires.length,
        nombrePiecesJointes: piecesJointes.length,
      });
      this.journal.debug('Courriel envoyé — détail', {
        idMessage: resultat.idMessage,
        destinataires: message.destinataires,
        sujet: message.sujet,
        nomsPiecesJointes: piecesJointes.map((p) => p.nomFichier),
      });
    } else {
      this.journal.warn('Échec d’envoi de courriel', {
        nombreDestinataires: message.destinataires.length,
        nombrePiecesJointes: piecesJointes.length,
        erreur: resultat.erreur,
      });
      this.journal.debug('Échec d’envoi de courriel — détail', {
        destinataires: message.destinataires,
        sujet: message.sujet,
        nomsPiecesJointes: piecesJointes.map((p) => p.nomFichier),
      });
    }

    return resultat;
  }
}
