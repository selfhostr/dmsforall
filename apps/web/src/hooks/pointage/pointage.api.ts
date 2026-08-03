import type {
  EntreeArretPointage,
  EntreeCorrectionPointage,
  EntreeDemarragePointage,
  EntreeDeverrouillagePeriodePointage,
  EntreeVerrouillagePeriodePointage,
  NatureActivitePointage,
  PageCurseur,
  ReponseAvecAvertissements,
  ReponseDeverrouillagePeriodePointage,
  ReponsePointage,
  ReponseVerrouillagePeriodePointage,
  StatutPointage,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';

/**
 * Couche transport du pointage — même convention que `hooks/atelier/ordres-reparation.api.ts` :
 * types consommés depuis `@dfa/shared` (contrat gelé), filtres sérialisés à la main en
 * `URLSearchParams` (les `statut[]`/`nature[]` répétés, même patron que
 * `hooks/pieces/reservations.api.ts`/`hooks/facturation/documents-vente.api.ts`).
 *
 * Racine `/pointages` — PAS nichée sous `/ordres-reparation/{orId}` (voir l'en-tête de
 * `apps/api/src/pointage/pointage.controller.ts` : un pointage `indirect` n'a pas d'OR).
 */

export interface FiltresListePointages {
  readonly siteId?: string;
  readonly technicienId?: string;
  readonly ordreReparationId?: string;
  readonly ligneOrId?: string;
  readonly statut?: readonly StatutPointage[];
  readonly nature?: readonly NatureActivitePointage[];
  readonly anomalie?: boolean;
  readonly debutDu?: string;
  readonly debutAu?: string;
  readonly tri: 'debutLe:asc' | 'debutLe:desc';
}

export interface PagePointages {
  readonly limite: number;
  readonly curseur?: string;
}

function construireParametres(filtres: FiltresListePointages, page: PagePointages): string {
  const parametres = new URLSearchParams();
  if (filtres.siteId) parametres.set('siteId', filtres.siteId);
  if (filtres.technicienId) parametres.set('technicienId', filtres.technicienId);
  if (filtres.ordreReparationId) parametres.set('ordreReparationId', filtres.ordreReparationId);
  if (filtres.ligneOrId) parametres.set('ligneOrId', filtres.ligneOrId);
  for (const valeur of filtres.statut ?? []) parametres.append('statut', valeur);
  for (const valeur of filtres.nature ?? []) parametres.append('nature', valeur);
  if (filtres.anomalie !== undefined) parametres.set('anomalie', String(filtres.anomalie));
  if (filtres.debutDu) parametres.set('debutDu', filtres.debutDu);
  if (filtres.debutAu) parametres.set('debutAu', filtres.debutAu);
  parametres.set('tri', filtres.tri);
  parametres.set('limite', String(page.limite));
  if (page.curseur) parametres.set('curseur', page.curseur);
  return parametres.toString();
}

/** `GET /pointages` — `atelier.pointage.lire` ; un rôle sans `lire_equipe` (constante SERVEUR
 *  `ROLES_AVEC_VUE_EQUIPE_POINTAGE`, pas un droit exposé) ne voit que ses propres pointages quel
 *  que soit `technicienId` demandé — restriction appliquée côté service, jamais côté front. */
export async function listerPointages(
  filtres: FiltresListePointages,
  page: PagePointages,
): Promise<PageCurseur<ReponsePointage>> {
  const reponse = await requeteApi<PageCurseur<ReponsePointage>>(
    `/pointages?${construireParametres(filtres, page)}`,
    {
      method: 'GET',
    },
  );
  return reponse ?? { donnees: [], curseurSuivant: null, limite: page.limite };
}

/** `GET /pointages/{id}` — `RESSOURCE_INTROUVABLE` (pas `DROIT_INSUFFISANT`) sur le pointage
 *  d'autrui sans vue équipe : ne révèle pas son existence. */
export async function obtenirPointage(id: string): Promise<ReponsePointage> {
  const pointage = await requeteApi<ReponsePointage>(`/pointages/${id}`, { method: 'GET' });
  if (!pointage) {
    throw new Error(`Réponse vide inattendue : GET /pointages/${id}.`);
  }
  return pointage;
}

/** `POST /pointages` — `Idempotency-Key` OBLIGATOIRE (porte l'ÉVÉNEMENT « démarrer », distincte de
 *  `entree.id` qui porte l'identité DU POINTAGE — voir l'en-tête de `contrats/pointage/pointage.ts`
 *  pour la déviation assumée). `201` à la création, `200` sur un rejeu idempotent. */
export async function demarrerPointage(
  entree: EntreeDemarragePointage,
  idempotencyKey: string,
): Promise<ReponseAvecAvertissements<ReponsePointage>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponsePointage>>('/pointages', {
    method: 'POST',
    body: JSON.stringify(entree),
    idempotencyKey,
  });
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /pointages.');
  }
  return reponse;
}

/** `POST /pointages/{id}/arreter` — `Idempotency-Key` OBLIGATOIRE ICI AUSSI (déviation documentée
 *  du reste de l'API : un rejeu réseau sur un arrêt déjà réussi ne doit jamais renvoyer un faux
 *  `409 POINTAGE_TRANSITION_INTERDITE`). C'est aussi le mécanisme d'une pause (RM-116) : arrêter
 *  puis démarrer un nouveau pointage `indirect`/`pause`, jamais un troisième état. */
export async function arreterPointage(
  id: string,
  entree: EntreeArretPointage,
  idempotencyKey: string,
): Promise<ReponseAvecAvertissements<ReponsePointage>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponsePointage>>(
    `/pointages/${id}/arreter`,
    {
      method: 'POST',
      body: JSON.stringify(entree),
      idempotencyKey,
    },
  );
  if (!reponse) {
    throw new Error(`Réponse vide inattendue : POST /pointages/${id}/arreter.`);
  }
  return reponse;
}

/** `POST /pointages/{id}/corriger` — `atelier.pointage.corriger_autrui` (le SEUL droit de
 *  correction qui existe à ce jour : il n'y a pas de `corriger_soi_meme`, voir
 *  `apps/api/src/auth/matrice-droits.ts`, donc réservé à l'encadrement même pour corriger son
 *  propre pointage). Motif exigé par le serveur (`400 POINTAGE_MOTIF_REQUIS`) UNIQUEMENT si un
 *  champ change réellement — rien à valider côté client au-delà de la présence du motif saisi. */
export async function corrigerPointage(
  id: string,
  entree: EntreeCorrectionPointage,
  idempotencyKey: string,
): Promise<ReponseAvecAvertissements<ReponsePointage>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponsePointage>>(
    `/pointages/${id}/corriger`,
    {
      method: 'POST',
      body: JSON.stringify(entree),
      idempotencyKey,
    },
  );
  if (!reponse) {
    throw new Error(`Réponse vide inattendue : POST /pointages/${id}/corriger.`);
  }
  return reponse;
}

/** `POST /pointages/verrouiller-periode` — `atelier.pointage.verrouiller_periode` (RM-95).
 *  `409 CONFLIT` si un pointage `en_cours` tombe dans la plage — jamais fermé de force. */
export async function verrouillerPeriodePointage(
  entree: EntreeVerrouillagePeriodePointage,
): Promise<ReponseVerrouillagePeriodePointage> {
  const reponse = await requeteApi<ReponseVerrouillagePeriodePointage>(
    '/pointages/verrouiller-periode',
    {
      method: 'POST',
      body: JSON.stringify(entree),
    },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /pointages/verrouiller-periode.');
  }
  return reponse;
}

/** `POST /pointages/deverrouiller-periode` — `atelier.pointage.deverrouiller_periode`, réservé à
 *  `direction`/`admin` SEULS (déviation documentée côté API : `comptable` verrouille mais ne
 *  déverrouille pas, même précédent que `atelier.or.rouvrir`). Motif OBLIGATOIRE (contre-passation). */
export async function deverrouillerPeriodePointage(
  entree: EntreeDeverrouillagePeriodePointage,
): Promise<ReponseDeverrouillagePeriodePointage> {
  const reponse = await requeteApi<ReponseDeverrouillagePeriodePointage>(
    '/pointages/deverrouiller-periode',
    {
      method: 'POST',
      body: JSON.stringify(entree),
    },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /pointages/deverrouiller-periode.');
  }
  return reponse;
}
