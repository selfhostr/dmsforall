/**
 * Registre EN MÉMOIRE des connexions SSE ouvertes sur CETTE instance, indexées par tenant, et
 * routeur des messages Redis reçus vers les callbacks concernées.
 *
 * S'abonne (`SUBSCRIBE`) au canal d'un tenant seulement quand au moins un poste de ce tenant est
 * connecté à CETTE instance, et s'en désabonne dès que le dernier repart — c'est la barrière
 * d'isolation tenant côté transport (voir `canal-tenant.ts`). Le filtrage par rôle
 * (`rolesCibles`) est une seconde barrière, appliquée ici en mémoire.
 *
 * `Map<tenantId, Set<callback>>` plutôt qu'un `EventEmitter` Node : un `EventEmitter` impose une
 * limite par défaut de 10 écouteurs par événement (avertissement bruyant dès le 11e poste connecté
 * pour le même tenant) et n'offre rien de plus ici qu'un `Set` — écrit à la main pour un contrôle
 * explicite, pas par dogme anti-bibliothèque.
 */
import { droitsDe } from '../auth/droits-personne';
import type { Action } from '../auth/matrice-droits';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import type { RoleUtilisateur } from '@dfa/shared';

import { canalTenant, tenantIdDepuisCanal } from './canal-tenant';
import type { EnveloppeEvenementTempsReelInterne } from './enveloppe-interne';
import { JETON_REDIS_TEMPS_REEL_ABONNE } from './temps-reel.jetons';

/** Sous-ensemble structurel d'ioredis en mode abonnement — voir
 *  `service-evenements-temps-reel.ts::ClientRedisPublieurTempsReel` pour la même intention. */
export interface ClientRedisAbonneTempsReel {
  on(evenement: 'message', gestionnaire: (canal: string, message: string) => void): unknown;
  subscribe(canal: string): Promise<number>;
  unsubscribe(canal: string): Promise<number>;
}

/** Ce que reçoit un abonné local — l'enveloppe SANS `rolesCibles` (déjà consommé pour filtrer,
 *  jamais transmis plus loin : le contrôleur SSE le sérialise tel quel vers le navigateur). */
export type EvenementDiffuseLocalement<
  T extends EnveloppeEvenementTempsReelInterne = EnveloppeEvenementTempsReelInterne,
> = Omit<T, 'rolesCibles'>;

type Rappel = (evenement: EvenementDiffuseLocalement) => void;
/** Forme réellement stockée dans `abonnesParTenant` : reçoit l'enveloppe INTERNE complète
 *  (`rolesCibles` inclus) pour pouvoir filtrer par rôle avant d'appeler le `Rappel` public. */
type FiltreInterne = (enveloppe: EnveloppeEvenementTempsReelInterne) => void;

@Injectable()
export class RegistreAbonnesTempsReel implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RegistreAbonnesTempsReel.name);
  private readonly abonnesParTenant = new Map<string, Set<FiltreInterne>>();

  constructor(
    @Inject(JETON_REDIS_TEMPS_REEL_ABONNE) private readonly abonneRedis: ClientRedisAbonneTempsReel,
  ) {}

  onModuleInit(): void {
    this.abonneRedis.on('message', (canal, message) => this.distribuer(canal, message));
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(
      [...this.abonnesParTenant.keys()].map((tenantId) =>
        this.abonneRedis.unsubscribe(canalTenant(tenantId)).catch(() => undefined),
      ),
    );
    this.abonnesParTenant.clear();
  }

  /**
   * Enregistre `rappel` pour tout événement PUBLIÉ POUR `tenantId` ET dont `rolesCibles` inclut
   * `role`. Rend une fonction de désabonnement — À APPELER OBLIGATOIREMENT (fermeture de
   * connexion, déconnexion réseau du client, timeout) : c'est ce qui permet à l'instance de se
   * désabonner du canal Redis du tenant dès que son dernier poste repart, et donc de libérer la
   * ressource sans attendre un redémarrage.
   */
  enregistrer(
    tenantId: string,
    role: RoleUtilisateur,
    rappel: Rappel,
    aLeDroit: (action: Action) => boolean = droitsDe(role).aLeDroit,
  ): () => void {
    const filtreInterne: FiltreInterne = (enveloppe) => {
      if (!enveloppe.rolesCibles.includes(role)) return;
      // Second filtre : le DROIT de la personne (sa grille), pas seulement son rôle d'origine.
      if (enveloppe.droitRequis !== undefined && !aLeDroit(enveloppe.droitRequis)) return;
      const visible: EvenementDiffuseLocalement = {
        type: enveloppe.type,
        emisLe: enveloppe.emisLe,
        donnees: enveloppe.donnees,
      };
      rappel(visible);
    };

    let ensemble = this.abonnesParTenant.get(tenantId);
    const premierAbonneDuTenant = !ensemble;
    if (!ensemble) {
      ensemble = new Set();
      this.abonnesParTenant.set(tenantId, ensemble);
    }
    ensemble.add(filtreInterne);

    if (premierAbonneDuTenant) {
      this.abonneRedis
        .subscribe(canalTenant(tenantId))
        .catch((erreur: unknown) =>
          this.logger.error(
            `Échec d'abonnement au canal du tenant ${tenantId} : ${String(erreur)}`,
          ),
        );
    }

    return () => {
      const ensembleActuel = this.abonnesParTenant.get(tenantId);
      if (!ensembleActuel) return;
      ensembleActuel.delete(filtreInterne);
      if (ensembleActuel.size === 0) {
        this.abonnesParTenant.delete(tenantId);
        this.abonneRedis
          .unsubscribe(canalTenant(tenantId))
          .catch((erreur: unknown) =>
            this.logger.error(`Échec de désabonnement du tenant ${tenantId} : ${String(erreur)}`),
          );
      }
    };
  }

  private distribuer(canal: string, message: string): void {
    const tenantId = tenantIdDepuisCanal(canal);
    if (!tenantId) return; // canal étranger à ce module — jamais reçu en pratique (abonnement ciblé), garde-fou

    const ensemble = this.abonnesParTenant.get(tenantId);
    if (!ensemble || ensemble.size === 0) return;

    let enveloppe: EnveloppeEvenementTempsReelInterne;
    try {
      enveloppe = JSON.parse(message) as EnveloppeEvenementTempsReelInterne;
    } catch (erreur) {
      this.logger.warn(
        `Message temps réel malformé sur le canal ${canal}, ignoré : ${String(erreur)}`,
      );
      return;
    }

    for (const filtreInterne of ensemble) filtreInterne(enveloppe);
  }
}
