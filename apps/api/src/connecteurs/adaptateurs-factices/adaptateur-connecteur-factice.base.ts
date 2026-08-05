import { Injectable } from '@nestjs/common';
import type { NomInterfaceConnecteur, ResumeExecutionConnecteur } from '@dfa/shared';

import { ServiceJournal } from '../../common/journal';
import type {
  AdaptateurConnecteur,
  RequeteOperationConnecteur,
  ResultatOperationConnecteur,
} from '../adaptateur-connecteur';

/** Aucune ligne traitée pour de vrai — un adaptateur factice ne fait jamais rien de plus que
 *  journaliser (voir la classe ci-dessous). */
const RESUME_VIDE: ResumeExecutionConnecteur = {
  lignesTotal: 0,
  lignesCreees: 0,
  lignesMajees: 0,
  lignesRejetees: 0,
  lignesIgnorees: 0,
};

/**
 * Base commune aux CINQ adaptateurs factices — un par `NomInterfaceConnecteur`
 * (`NOMS_INTERFACE_CONNECTEUR`, `@dfa/shared`) — item B du socle d'exécution (étape 5) :
 * « un adaptateur factice par interface, explicitement nommé comme tel, qui journalise au lieu
 * d'appeler quoi que ce soit ».
 *
 * RECHERCHE MENÉE AVANT D'ÉCRIRE CE FICHIER (voir le rapport d'accompagnement) : ce dépôt ne
 * contient PAS aujourd'hui de « fournisseur d'e-mail factice » ni d'équivalent nommé `*Factice`
 * ailleurs que dans des fixtures de test (`journalFactice()`, motif répété dans une trentaine de
 * `*.spec.ts`). La prémisse « le dépôt a déjà cette idée ailleurs » ne s'est pas vérifiée telle
 * quelle — ce module est donc le premier de ce genre CÔTÉ SERVICE (pas fixture de test) dans ce
 * dépôt ; il en reprend l'esprit (journaliser plutôt qu'appeler) et le préfixe `*Factice` déjà en
 * usage dans les tests.
 *
 * NE FAIT JAMAIS d'appel réseau, NE LÈVE JAMAIS d'erreur par construction — un échec de connecteur
 * (délai, panne tiers) se simule au niveau de `resilience/` avec un faux adaptateur DÉDIÉ
 * (`vi.fn().mockRejectedValue`, voir `service-executeur-connecteur-resilient.spec.ts`), jamais
 * ici : le rôle de ces cinq classes est de prouver qu'« un connecteur factice répond, et le fait
 * savoir dans le journal » est un chemin séparé et propre, distinct d'« aucun connecteur n'est
 * configuré » (`RegistreConnecteursService`) et d'« un connecteur réel échoue »
 * (`ServiceExecuteurConnecteurResilient`).
 *
 * JOURNALISATION SANS SECRET : seuls des champs nommément listés partent vers `ServiceJournal` —
 * jamais `requete.donnees`, même doctrine que `resilience/service-executeur-connecteur-
 * resilient.ts`.
 */
@Injectable()
export abstract class AdaptateurConnecteurFactice implements AdaptateurConnecteur {
  abstract readonly nomInterface: NomInterfaceConnecteur;
  /** `factice_*` — jamais un nom de partenaire, règle transversale du domaine connecteurs. */
  abstract readonly typeConnecteurCode: string;

  constructor(protected readonly journal: ServiceJournal) {}

  async executer(requete: RequeteOperationConnecteur): Promise<ResultatOperationConnecteur> {
    this.journal.info('connecteurs.adaptateur_factice.execution', {
      typeConnecteurCode: this.typeConnecteurCode,
      nomInterface: this.nomInterface,
      operation: requete.operation,
      nature: requete.nature,
      objetId: requete.objetId ?? null,
    });
    return { resume: RESUME_VIDE, erreurs: [] };
  }
}
