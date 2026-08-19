import type { TypeEvenementTempsReel } from './enums';

/**
 * Charge par type d'événement, MINIMALE À DESSEIN (consigne de la tâche : « aucune donnée
 * personnelle au-delà du strict nécessaire »). L'écran qui reçoit l'événement va rechercher la
 * fiche par les endpoints existants (`GET /clients/{id}`…), qui appliquent déjà les droits du
 * rôle — ce canal ne sert JAMAIS de source de vérité pour un nom, une adresse ou un téléphone.
 *
 * `Record` exhaustif sur `TypeEvenementTempsReel` (même doctrine que `Action` dans
 * `auth/matrice-droits.ts` : le compilateur refuse qu'un type ajouté à l'union reste sans charge
 * définie ici).
 */
export interface DonneesEvenementTempsReel {
  readonly 'vehicule.correspondance_scan_permis': {
    /** Identifiant du client déjà connu — jamais son nom, sa plaque ou son adresse. */
    readonly clientId: string;
  };
}

/**
 * Événement tel que REÇU par le client (navigateur) sur `GET /evenements-temps-reel/flux` — une
 * ligne `data:` du flux SSE, une fois désérialisée. Ne porte PAS `rolesCibles` : ce champ est
 * interne au serveur (voir `EnveloppeEvenementTempsReel`, `apps/api/src/temps-reel/`), le filtrage
 * par rôle a déjà eu lieu avant l'émission — le navigateur ne reçoit que ce qu'il a le droit de
 * voir, jamais la liste des rôles qui y ont accès.
 */
export interface EvenementTempsReel<T extends TypeEvenementTempsReel = TypeEvenementTempsReel> {
  readonly type: T;
  /** ISO 8601 UTC — horodatage d'émission, pas de réception. */
  readonly emisLe: string;
  readonly donnees: DonneesEvenementTempsReel[T];
}
