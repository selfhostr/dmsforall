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
 * Journalisation structurée (destinataires, sujet, longueur du corps) — JAMAIS le corps complet
 * ni son contenu : un courriel de test peut porter des données de démo, et le corps n'a de toute
 * façon aucune valeur diagnostique ici (ce socle ne connaît aucun gabarit métier).
 */
@Injectable()
export class TransportCapture implements TransportCourriel {
  constructor(private readonly journal: ServiceJournal) {}

  async envoyer(enveloppe: EnveloppeCourriel): Promise<ResultatEnvoiCourriel> {
    const idMessage = `capture-${randomUUID()}`;
    this.journal.info('Courriel capturé (aucun envoi réel — voir COURRIEL_ENVOI_REEL)', {
      idMessage,
      destinataires: enveloppe.destinataires,
      sujet: enveloppe.sujet,
      repondreA: enveloppe.repondreA,
      longueurCorpsTexte: enveloppe.corpsTexte?.length ?? 0,
      longueurCorpsHtml: enveloppe.corpsHtml?.length ?? 0,
    });
    return Promise.resolve({ succes: true, idMessage });
  }
}
