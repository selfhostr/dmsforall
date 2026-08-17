/**
 * Émission d'un événement temps réel. Port PUBLIC du module : tout module métier futur (scan de
 * permis, clôture de pointage, facture émise…) importe `TempsReelModule` et injecte
 * `ServiceEvenementsTempsReel` directement (classe concrète, comme `ServiceImpressionOr` injecte
 * `ServiceOr` — pas de jeton nécessaire, `temps-reel/` ne dépend d'AUCUN module métier, donc aucun
 * risque de cycle dans ce sens).
 *
 * PUBLISH Redis, jamais une écriture en base : ce canal est ÉPHÉMÈRE, distinct de l'outbox
 * `evenement_metier` (`common/evenements/`, durable, destinée aux webhooks et à l'audit). Un poste
 * non connecté au moment de l'émission ne rattrape rien — c'est le comportement voulu pour une
 * notification (« untel est déjà présenté au comptoir »), pas un fait qui doit survivre.
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  DonneesEvenementTempsReel,
  RoleUtilisateur,
  TypeEvenementTempsReel,
} from '@dfa/shared';

import { canalTenant } from './canal-tenant';
import type { EnveloppeEvenementTempsReelInterne } from './enveloppe-interne';
import { JETON_REDIS_TEMPS_REEL_PUBLIEUR } from './temps-reel.jetons';

/** Sous-ensemble structurel d'ioredis effectivement utilisé ici — permet de substituer un faux
 *  client en test sans dépendre du type `Redis` complet (voir `service-evenements-temps-reel.spec.ts`). */
export interface ClientRedisPublieurTempsReel {
  publish(canal: string, message: string): Promise<number>;
}

@Injectable()
export class ServiceEvenementsTempsReel {
  constructor(
    @Inject(JETON_REDIS_TEMPS_REEL_PUBLIEUR)
    private readonly publieur: ClientRedisPublieurTempsReel,
  ) {}

  /**
   * `rolesCibles` : les SEULS rôles autorisés à recevoir cet événement, décidés PAR L'APPELANT
   * (qui connaît la sensibilité métier de la donnée) — jamais un défaut « tout le monde » choisi
   * ici. Un tableau vide est valide (personne ne reçoit rien, publié quand même pour rester
   * observable) plutôt qu'une erreur : ce n'est pas à ce service de juger qu'un appelant s'est
   * trompé de périmètre.
   */
  async publier<T extends TypeEvenementTempsReel>(
    tenantId: string,
    type: T,
    donnees: DonneesEvenementTempsReel[T],
    rolesCibles: readonly RoleUtilisateur[],
  ): Promise<void> {
    const enveloppe: EnveloppeEvenementTempsReelInterne<T> = {
      type,
      emisLe: new Date().toISOString(),
      donnees,
      rolesCibles,
    };
    await this.publieur.publish(canalTenant(tenantId), JSON.stringify(enveloppe));
  }
}
