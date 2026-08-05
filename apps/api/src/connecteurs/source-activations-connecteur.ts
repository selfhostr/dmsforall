import type { NomInterfaceConnecteur, PolitiqueNouvellesTentativesConnecteur } from '@dfa/shared';

import type { ContexteTenant } from '../db';

/**
 * Port déclaré par le REGISTRE (`service-registre-connecteurs.ts`) pour lire, pour un tenant
 * donné, quelle activation de connecteur est active — jamais l'inverse : ce fichier ne connaît
 * pas la source des données, seulement la forme dont le registre a besoin (même doctrine que
 * `atelier/atelier.jetons.ts` : « le port est déclaré par le consommateur »).
 *
 * ÉTAT RÉEL AU MOMENT D'ÉCRIRE CECI (voir le rapport d'accompagnement) : AUCUNE table ne
 * persiste `connecteur_activation` dans ce dépôt — le contrat HTTP existe
 * (`packages/shared/src/contrats/connecteurs/connecteur.ts::ReponseConnecteurActivation`), le
 * schéma Drizzle et la migration n'existent pas. Cette tâche N'A PAS le droit de poser de
 * migration (créneaux `0043`/`0044` déjà pris par d'autres chantiers, coordination requise) :
 * `SourceActivationsConnecteurAucune` ci-dessous est donc l'implémentation FOURNIE PAR DÉFAUT,
 * et reste la bonne réponse tant qu'aucune table n'existe — « aucun connecteur actif » est le
 * cas NORMAL aujourd'hui pour cent pour cent des tenants, pas une exception à contourner.
 *
 * Le jour où la table existe, une implémentation Drizzle de ce même port se substitue par DI
 * (`JETON_SOURCE_ACTIVATIONS_CONNECTEUR`, `connecteurs.jetons.ts`) — aucun consommateur du
 * registre n'a alors à changer.
 */

/** Vue minimale d'une activation, strictement ce dont le registre a besoin pour résoudre un
 *  adaptateur — pas le DTO HTTP complet (`ReponseConnecteurActivation` porte aussi la santé,
 *  les horodatages d'audit, etc., hors de propos ici). */
export interface DescripteurActivationConnecteur {
  readonly id: string;
  readonly typeConnecteurCode: string;
  readonly nomInterface: NomInterfaceConnecteur;
  /** `null` = portée tenant entier — même sémantique que `ReponseConnecteurActivation.siteId`. */
  readonly siteId: string | null;
  /** `null` = politique par défaut de la plateforme (`resilience/politique-resilience.ts`) —
   *  même sémantique que `ReponseConnecteurActivation.politiqueNouvellesTentatives`. */
  readonly politiqueNouvellesTentatives: PolitiqueNouvellesTentativesConnecteur | null;
}

export interface SourceActivationsConnecteur {
  /**
   * Rend l'activation ACTIVE (`statut = 'actif'`) pour ce tenant/cette interface, ou `null` si
   * aucune — le cas normal aujourd'hui. `siteId` : quand fourni, ne retient que l'activation
   * scopée à ce site OU l'activation tenant-entier (`siteId: null`) ; l'ordre de préférence entre
   * les deux (un site pourrait avoir sa propre activation ET le tenant une activation générale)
   * est un détail d'implémentation de la source réelle, pas de ce port.
   */
  activationActive(
    contexte: ContexteTenant,
    nomInterface: NomInterfaceConnecteur,
    siteId?: string | null,
  ): Promise<DescripteurActivationConnecteur | null>;
}

/**
 * Implémentation par défaut — AUCUNE activation, pour AUCUN tenant, jamais. Câblée par
 * `ConnecteursModule` tant qu'aucune source persistée n'existe (voir l'en-tête ci-dessus).
 * Même patron que `LecturePointageVide` (`atelier/atelier.jetons.ts`) : le cas « rien n'est
 * configuré » doit être un chemin normal du code, jamais une branche d'exception.
 */
export class SourceActivationsConnecteurAucune implements SourceActivationsConnecteur {
  async activationActive(): Promise<DescripteurActivationConnecteur | null> {
    return null;
  }
}
