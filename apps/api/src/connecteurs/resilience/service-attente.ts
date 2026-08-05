import { Injectable } from '@nestjs/common';

/**
 * Source d'attente injectable pour la pause CROISSANTE entre deux tentatives (`RC-04`) — même
 * doctrine que `Horloge` (`common/horloge/horloge.ts`) : tout code qui doit « attendre »
 * passe par ici plutôt que par `setTimeout` directement, pour rester testable sans horloge
 * réelle (un test fournit une attente factice qui résout immédiatement tout en enregistrant les
 * délais demandés).
 *
 * Le délai maximal PAR TENTATIVE (`avecDelaiMax`, `service-executeur-connecteur-resilient.ts`)
 * n'utilise PAS ce service : c'est un filet de sécurité contre une promesse qui ne se résout
 * jamais, posé sur `setTimeout` réel directement — voir l'en-tête de ce fichier pour la
 * distinction.
 */
@Injectable()
export class ServiceAttente {
  attendre(delaiMs: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, delaiMs);
    });
  }
}
