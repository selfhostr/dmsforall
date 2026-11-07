import type { EntreeCreationClient, EntreeCreationVehicule } from '@dfa/shared';

/**
 * Logique pure du parcours « ouvrir un OR depuis une plaque » : créer le client puis le véhicule
 * quand ils n'existent pas encore, en séquence, avec REPRISE en cas d'échec.
 *
 * Il n'existe pas (encore) de `POST` atomique client + véhicule + OR : trois appels, donc trois
 * pannes possibles. Si le véhicule échoue après la création du client, le client NE DOIT PAS être
 * recréé au second essai (doublon) : `ProgressionCreation` retient ce qui est déjà en base et
 * `preparerClientEtVehicule` saute les étapes faites.
 */

export type EtapeCreation = 'client' | 'vehicule' | 'or';

export type PlanClient =
  | { readonly mode: 'existant'; readonly id: string }
  | { readonly mode: 'nouveau'; readonly entree: EntreeCreationClient };

export type EntreeVehiculeRapide = Omit<EntreeCreationVehicule, 'detenteurId'>;

export type PlanVehicule =
  | { readonly mode: 'existant'; readonly id: string }
  | { readonly mode: 'nouveau'; readonly entree: EntreeVehiculeRapide };

/** Ce qui est déjà créé en base pendant cette saisie — jamais recréé à un second essai. */
export interface ProgressionCreation {
  clientId?: string;
  vehiculeId?: string;
}

export interface DependancesCreation {
  readonly creerClient: (entree: EntreeCreationClient) => Promise<{ readonly id: string }>;
  readonly creerVehicule: (entree: EntreeCreationVehicule) => Promise<{ readonly id: string }>;
  readonly surEtape?: (etape: EtapeCreation) => void;
}

/** Échec d'UNE étape : porte l'étape pour que l'écran dise ce qui est déjà fait et ce qui reste. */
export class EchecEtapeCreation extends Error {
  constructor(
    readonly etape: EtapeCreation,
    readonly erreur: unknown,
  ) {
    super(`Échec de l'étape « ${etape} »`);
    this.name = 'EchecEtapeCreation';
  }
}

export async function preparerClientEtVehicule(
  plan: { readonly client: PlanClient; readonly vehicule: PlanVehicule },
  progression: ProgressionCreation,
  deps: DependancesCreation,
): Promise<{ readonly clientId: string; readonly vehiculeId: string }> {
  if (plan.client.mode === 'existant') {
    progression.clientId = plan.client.id;
  } else if (progression.clientId === undefined) {
    deps.surEtape?.('client');
    try {
      progression.clientId = (await deps.creerClient(plan.client.entree)).id;
    } catch (erreur) {
      throw new EchecEtapeCreation('client', erreur);
    }
  }
  const clientId = progression.clientId;
  if (clientId === undefined) throw new Error('Client introuvable après préparation.');

  if (plan.vehicule.mode === 'existant') {
    progression.vehiculeId = plan.vehicule.id;
  } else if (progression.vehiculeId === undefined) {
    deps.surEtape?.('vehicule');
    try {
      progression.vehiculeId = (
        await deps.creerVehicule({ ...plan.vehicule.entree, detenteurId: clientId })
      ).id;
    } catch (erreur) {
      throw new EchecEtapeCreation('vehicule', erreur);
    }
  }
  const vehiculeId = progression.vehiculeId;
  if (vehiculeId === undefined) throw new Error('Véhicule introuvable après préparation.');

  return { clientId, vehiculeId };
}

/** Téléphone suisse saisi au comptoir : au moins 4 caractères (contrat `telephones[].valeur`). */
export function telephoneValide(saisie: string): boolean {
  return saisie.trim().length >= 4;
}
