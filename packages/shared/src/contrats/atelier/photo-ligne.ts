/**
 * Photos jointes à une ligne d'OR (travail constaté) — contrat API <-> web.
 *
 * Le mécanicien photographie le défaut sur la tablette ; le bureau et le client le voient avec le
 * devis. Binaire servi par `GET /photos/{id}` (image) et `GET /photos/{id}/vignette` ; les
 * métadonnées par les listes ci-dessous. Envoi en `multipart/form-data` : champ fichier `photo`,
 * champ fichier facultatif `vignette` (JPEG réduit à 320 px, produit par le navigateur : le
 * serveur ne retraite jamais l'image), champ texte facultatif `legende`.
 *
 * Formats : JPEG et PNG seulement. Le navigateur réencode toujours en JPEG avant l'envoi (ce qui
 * convertit aussi le HEIC des iPhone quand le navigateur sait le lire) ; un HEIC brut arrivé
 * jusqu'au serveur est refusé avec un message clair.
 */

import { z } from 'zod';

export const LIMITE_TAILLE_PHOTO_LIGNE_OCTETS = 8 * 1024 * 1024;
export const LIMITE_TAILLE_VIGNETTE_PHOTO_OCTETS = 512 * 1024;
export const NOMBRE_MAX_PHOTOS_PAR_LIGNE = 20;
export const LONGUEUR_MAX_LEGENDE_PHOTO = 200;
/** Plus grand côté de la vignette produite par le navigateur. */
export const DIMENSION_VIGNETTE_PHOTO_PX = 320;
/** Plus grand côté de la photo après réduction côté navigateur (la source est souvent 4000+ px). */
export const DIMENSION_MAX_PHOTO_PX = 1920;

export const TYPES_MIME_PHOTO_LIGNE = ['image/jpeg', 'image/png'] as const;
export type TypeMimePhotoLigne = (typeof TYPES_MIME_PHOTO_LIGNE)[number];

/** Champs texte du `multipart` d'envoi. */
export const schemaCreationPhotoLigne = z.object({
  legende: z
    .string()
    .trim()
    .max(LONGUEUR_MAX_LEGENDE_PHOTO)
    .optional()
    .transform((v) => (v === undefined || v === '' ? undefined : v)),
});
export type EntreeCreationPhotoLigne = z.infer<typeof schemaCreationPhotoLigne>;

export interface ReponsePhotoLigne {
  readonly id: string;
  readonly ordreReparationId: string;
  readonly ligneId: string;
  readonly legende: string | null;
  readonly typeMime: TypeMimePhotoLigne;
  readonly tailleOctets: number;
  /** `false` : la vignette n'a pas été fournie, `/vignette` sert alors la photo entière. */
  readonly vignetteDisponible: boolean;
  readonly creeParId: string | null;
  readonly creeLe: string;
  /** Le demandeur peut supprimer cette photo (auteur ou encadrement, OR non facturé). */
  readonly supprimable: boolean;
}

export interface ReponseListePhotosLigne {
  readonly donnees: readonly ReponsePhotoLigne[];
}
