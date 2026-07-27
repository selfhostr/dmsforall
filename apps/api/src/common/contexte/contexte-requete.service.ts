import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import type { ContexteTenant } from '../../db';
import type { ContexteRequete, PrincipalAuthentifie } from './contexte-requete.types';

/** Variante mutable interne : seul `principal` change (une fois) pendant la vie du contexte. */
interface ContexteRequeteInterne extends Omit<ContexteRequete, 'principal'> {
  principal: PrincipalAuthentifie | null;
}

/**
 * Porte le contexte de la requête courante (id, langue, principal authentifié…) sur toute
 * la durée de vie de la requête, via `AsyncLocalStorage` — accessible depuis n'importe quel
 * service injecté sans avoir à faire traverser le paramètre par toute la pile d'appels.
 *
 * `attacherPrincipal` ne doit être appelée qu'une seule fois, par `GardeSession` : c'est ce
 * qui interdit à toute couche ultérieure de changer le tenant en cours de requête.
 */
@Injectable()
export class ServiceContexteRequete {
  private readonly stockage = new AsyncLocalStorage<ContexteRequeteInterne>();

  demarrer<T>(init: Omit<ContexteRequete, 'principal'>, suite: () => T): T {
    const contexte: ContexteRequeteInterne = { ...init, principal: null };
    return this.stockage.run(contexte, suite);
  }

  actuel(): ContexteRequete {
    const contexte = this.stockage.getStore();
    if (!contexte) {
      throw new Error(
        'ServiceContexteRequete.actuel() appelé hors d\'une requête HTTP : MiddlewareContexteRequete n\'a pas tourné.',
      );
    }
    return contexte;
  }

  actuelOuNull(): ContexteRequete | null {
    return this.stockage.getStore() ?? null;
  }

  /** Appelée UNE SEULE FOIS par GardeSession ; lève au 2e appel. */
  attacherPrincipal(principal: PrincipalAuthentifie): void {
    const contexte = this.stockage.getStore();
    if (!contexte) {
      throw new Error(
        'ServiceContexteRequete.attacherPrincipal() appelé hors d\'une requête HTTP : MiddlewareContexteRequete n\'a pas tourné.',
      );
    }
    if (contexte.principal !== null) {
      throw new Error(
        'ServiceContexteRequete.attacherPrincipal() appelée deux fois sur la même requête : un changement de tenant en cours de requête est interdit.',
      );
    }
    contexte.principal = principal;
  }

  exigerPrincipal(): PrincipalAuthentifie {
    const { principal } = this.actuel();
    if (!principal) {
      throw new Error('Aucun principal authentifié dans le contexte de la requête courante.');
    }
    return principal;
  }

  contexteTenant(): ContexteTenant {
    const contexte = this.actuel();
    const principal = this.exigerPrincipal();
    return {
      tenantId: principal.tenantId,
      utilisateurId: principal.utilisateurId,
      requeteId: contexte.requeteId,
    };
  }
}
