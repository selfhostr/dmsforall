import type { RoleUtilisateur } from '@dfa/shared';
import type { DonneesEvenementTempsReel, TypeEvenementTempsReel } from '@dfa/shared';

/**
 * Forme du message tel que publié sur Redis — INTERNE au serveur, jamais envoyée telle quelle au
 * navigateur. Porte `rolesCibles` en plus de `EvenementTempsReel` (`@dfa/shared`) : c'est la trace
 * de la décision « qui a le droit de voir ceci », prise par le code métier appelant
 * `ServiceEvenementsTempsReel.publier()` AU MOMENT DE L'ÉMISSION (voir consigne n°3 de la tâche —
 * filtrer à l'émission, pas à l'affichage). `RegistreAbonnesTempsReel` compare `rolesCibles` au
 * rôle du principal de CHAQUE connexion avant de relayer quoi que ce soit — un rôle absent de
 * cette liste ne reçoit jamais le message, il n'est pas seulement invité à l'ignorer.
 */
export interface EnveloppeEvenementTempsReelInterne<
  T extends TypeEvenementTempsReel = TypeEvenementTempsReel,
> {
  readonly type: T;
  readonly emisLe: string;
  readonly donnees: DonneesEvenementTempsReel[T];
  readonly rolesCibles: readonly RoleUtilisateur[];
}
