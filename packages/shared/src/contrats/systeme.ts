/** `GET /systeme/version` — version installée et dernière version publiée. */
export interface VersionSysteme {
  /** Version installée, sans métadonnée de build (`0.3.0`). */
  readonly actuelle: string;
  /** Dernière version publiée, `null` si inconnue (vérification désactivée ou injoignable). */
  readonly derniere: string | null;
  readonly miseAJourDisponible: boolean;
  /** Notes de version de `derniere`, `null` si inconnue. */
  readonly urlNotes: string | null;
}
