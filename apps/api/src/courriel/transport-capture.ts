import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ServiceJournal } from '../common/journal/service-journal';
import type {
  EnveloppeCourriel,
  ResultatEnvoiCourriel,
  TransportCourriel,
} from './transport-courriel.interface';

/**
 * Transport de capture — AUCUN envoi réseau, jamais. C'est le transport par défaut : voir
 * `courrielDoitEnvoyerReellement` (`config-courriel.ts`) pour le verrou à deux clés qui décide
 * quand `TransportSmtp` est utilisé à la place. Utilisé en développement et en test — contrainte
 * de sécurité, pas un confort : le jeu de démo contient des adresses de clients de test qui ne
 * doivent jamais être atteintes.
 *
 * Journalisation structurée (nombre de destinataires, longueur du corps) au niveau `info` —
 * JAMAIS le corps complet, JAMAIS les adresses ni le sujet en clair à ce niveau : un courriel de
 * test peut porter des données de démo (adresses de clients de test), et le corps n'a de toute
 * façon aucune valeur diagnostique ici (ce socle ne connaît aucun gabarit métier). Le détail
 * (destinataires, sujet, `repondreA`) est journalisé séparément en `debug`, désactivé par défaut
 * en production — voir `ServiceCourriel.envoyer` pour la même doctrine côté transport réel.
 */
@Injectable()
export class TransportCapture implements TransportCourriel {
  constructor(private readonly journal: ServiceJournal) {}

  async envoyer(enveloppe: EnveloppeCourriel): Promise<ResultatEnvoiCourriel> {
    const idMessage = `capture-${randomUUID()}`;
    const piecesJointes = enveloppe.piecesJointes ?? [];
    // Trace de la/les pièce(s) jointe(s) — JAMAIS perdue en silence : en développement, c'est le
    // SEUL moyen de vérifier qu'une facture serait effectivement partie AVEC son PDF (aucun envoi
    // réel n'a lieu ici). Compte + taille cumulée au niveau `info` (sûrs, aucune donnée
    // personnelle) ; noms de fichier au niveau `debug` uniquement — voir `PieceJointeCourriel.
    // nomFichier`, potentiellement identifiant côté client (numéro de facture/dossier).
    this.journal.info('Courriel capturé (aucun envoi réel — voir COURRIEL_ENVOI_REEL)', {
      idMessage,
      nombreDestinataires: enveloppe.destinataires.length,
      longueurCorpsTexte: enveloppe.corpsTexte?.length ?? 0,
      longueurCorpsHtml: enveloppe.corpsHtml?.length ?? 0,
      nombrePiecesJointes: piecesJointes.length,
      taillePiecesJointesOctets: piecesJointes.reduce(
        (total, p) => total + p.contenu.byteLength,
        0,
      ),
    });
    this.journal.debug('Courriel capturé — détail', {
      idMessage,
      destinataires: enveloppe.destinataires,
      sujet: enveloppe.sujet,
      repondreA: enveloppe.repondreA,
      nomsPiecesJointes: piecesJointes.map((p) => p.nomFichier),
    });
    return Promise.resolve({ succes: true, idMessage });
  }
}
