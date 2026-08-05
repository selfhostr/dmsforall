import { Inject, Injectable } from '@nestjs/common';
import type { NomInterfaceConnecteur } from '@dfa/shared';

import type { ContexteTenant } from '../db';
import { ServiceJournal } from '../common/journal';

import type { AdaptateurConnecteur } from './adaptateur-connecteur';
import {
  JETON_ADAPTATEURS_CONNECTEUR,
  JETON_SOURCE_ACTIVATIONS_CONNECTEUR,
} from './connecteurs.jetons';
import type {
  DescripteurActivationConnecteur,
  SourceActivationsConnecteur,
} from './source-activations-connecteur';

/** Résultat d'une résolution réussie — l'adaptateur À APPELER et l'activation qui a mené à lui
 *  (utile à l'appelant pour lire `politiqueNouvellesTentatives`, `siteId`, etc.). */
export interface ConnecteurResolu {
  readonly adaptateur: AdaptateurConnecteur;
  readonly activation: DescripteurActivationConnecteur;
}

/**
 * Point d'entrée UNIQUE pour résoudre, à l'exécution, quel adaptateur sert une interface donnée
 * pour le tenant courant — item A du socle (étape 5).
 *
 * `resoudre` rend `null` dans TROIS cas, tous normaux, aucun ne doit être traité comme une
 * erreur par l'appelant :
 *  1. aucune activation n'existe pour ce tenant/cette interface (le cas de loin le plus
 *     fréquent aujourd'hui — cent pour cent des tenants, `SourceActivationsConnecteurAucune`) ;
 *  2. une activation existe mais son `typeConnecteurCode` ne correspond à AUCUN adaptateur
 *     déployé dans ce processus (catalogue en avance sur l'implémentation, `RC-20` dernier
 *     paragraphe : « au rythme des agréments obtenus ») — journalisé en `warn`, jamais en
 *     erreur bloquante ;
 *  3. — pas un cas géré ici, voir `resilience/` pour la troisième famille de « connecteur
 *     indisponible » : un adaptateur RÉSOLU mais qui ÉCHOUE à l'exécution (délai, panne tiers).
 *
 * Ne fait AUCUN appel réseau, AUCUNE écriture — une résolution pure à partir de
 * `SourceActivationsConnecteur` (aujourd'hui : `SourceActivationsConnecteurAucune`, voir son
 * en-tête pour l'état réel de la persistance).
 */
@Injectable()
export class RegistreConnecteursService {
  constructor(
    @Inject(JETON_SOURCE_ACTIVATIONS_CONNECTEUR)
    private readonly source: SourceActivationsConnecteur,
    @Inject(JETON_ADAPTATEURS_CONNECTEUR)
    private readonly adaptateurs: readonly AdaptateurConnecteur[],
    private readonly journal: ServiceJournal,
  ) {}

  async resoudre(
    contexte: ContexteTenant,
    nomInterface: NomInterfaceConnecteur,
    siteId: string | null = null,
  ): Promise<ConnecteurResolu | null> {
    const activation = await this.source.activationActive(contexte, nomInterface, siteId);
    if (!activation) {
      return null;
    }

    const adaptateur = this.adaptateurs.find(
      (candidat) => candidat.typeConnecteurCode === activation.typeConnecteurCode,
    );
    if (!adaptateur) {
      this.journal.warn('connecteurs.registre.adaptateur_introuvable', {
        tenantId: contexte.tenantId,
        typeConnecteurCode: activation.typeConnecteurCode,
        nomInterface,
      });
      return null;
    }

    return { adaptateur, activation };
  }
}
